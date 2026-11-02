import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuthStore } from "@/features/auth/store/authStore";
import { hasOphthalmologistRole } from "@/features/patients/patientAccess";
import { diagnosisDiscardEnabled } from "@/lib/clinicalFeatures";
import { discardResults, getDiscardContext, getDiscardOperation } from "../api/diagnosisDiscardService";
import type { DiscardContext, DiscardOperation } from "../api/diagnosisDiscardService";
import type { DiagnosisResult } from "../api/diagnosisService";
import { hydrateDiscardMarkers, recordDiscard, retainDiscardMarker, retireDiscardMarker, useDiagnosisDiscardStore } from "../store/diagnosisDiscardStore";
import type { DiscardMarker, PendingDiscard } from "../store/diagnosisDiscardStore";
import type { EyeKey } from "../types";

interface Options {
  step: number;
  patientId: number | null;
  visitId: number | null;
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  version: () => number;
  busy: () => boolean;
  apply: (entry: PendingDiscard, operation: DiscardOperation) => boolean;
  recover?: (context: DiscardContext, operation: DiscardOperation, current: () => boolean) => Promise<boolean>;
}
const pending = (e: PendingDiscard) => e.status !== "applied" && e.status !== "rejected";
const status = (error: unknown) => (error as { response?: { status?: number } }).response?.status;
const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

export function useDiagnosisCorrection(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const reader = useRef<object | null>(null);
  const checking = useRef(new Set<string>());
  const sessionVersion = useRef(0);
  const [checkingIds, setCheckingIds] = useState<string[]>([]);
  const [recoveryMessages, setRecoveryMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<DiscardContext | null>(null);
  const [review, setReview] = useState<DiscardContext | null>(null);
  const reviewRef = useRef<{ data: DiscardContext; current: () => boolean } | null>(null);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const { entries, markers, recoveryActorId, storageError } = useDiagnosisDiscardStore();
  const enabled = diagnosisDiscardEnabled();
  const actorId = authenticated ? user?.id ?? null : null;
  const authorizedLocally = !!user && hasOphthalmologistRole(user) &&
    !!user.permisos?.includes("diagnostico_retinopatia.descartar_pendiente");
  const matches = (e: PendingDiscard) => pending(e) && e.actorId === useAuthStore.getState().user?.id &&
    e.visitId === latest.current.visitId && e.request.paciente_id === latest.current.patientId;
  const currentPending = () => useDiagnosisDiscardStore.getState().entries.find(matches);
  const entry = entries.find(matches);
  const currentMarker = () => useDiagnosisDiscardStore.getState().markers.find((m) =>
    m.actorId === useAuthStore.getState().user?.id && m.visitId === latest.current.visitId);
  const marker = actorId === recoveryActorId ? currentMarker() : undefined;
  const blocked = () => {
    if (!enabled) return false;
    const state = useDiagnosisDiscardStore.getState();
    return !!reader.current || !!reviewRef.current || !!currentPending() || !!currentMarker() ||
      (!!actorId && (state.recoveryActorId !== actorId || state.storageError));
  };
  const markerFor = (e: PendingDiscard): DiscardMarker => ({ version: 1, actorId: e.actorId,
    visitId: e.visitId, operationId: e.request.operacion_id });
  const close = () => {
    reviewRef.current = null;
    setReview(null);
  };
  const snapshot = () => {
    const original = latest.current;
    const version = original.version();
    const session = useAuthStore.getState();
    const sessionId = sessionVersion.current;
    const expected = Object.entries(original.results).map(([eye, result]) => [eye as EyeKey, result!.detalle_id] as const);
    return () => {
      const now = latest.current;
      const auth = useAuthStore.getState();
      return mounted.current && version === now.version() && original.patientId === now.patientId &&
        sessionId === sessionVersion.current &&
        original.visitId === now.visitId && session.token === auth.token && session.user === auth.user &&
        session.isAuthenticated === auth.isAuthenticated &&
        expected.every(([eye, id]) => now.results[eye]?.detalle_id === id) &&
        expected.length === Object.keys(now.results).length;
    };
  };
  useLayoutEffect(() => {
    mounted.current = true;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user !== previous.user || next.token !== previous.token || next.isAuthenticated !== previous.isAuthenticated) {
        sessionVersion.current++;
      }
    });
    return () => { mounted.current = false; reader.current = null; reviewRef.current = null; unsubscribe(); };
  }, []);
  useLayoutEffect(() => {
    if (enabled) hydrateDiscardMarkers(actorId);
    setRecoveryMessages({});
    setCheckingIds([]);
  }, [enabled, actorId]);

  const load = async (open: boolean) => {
    const now = latest.current;
    if (!enabled || !authorizedLocally || !now.patientId || !now.visitId || now.busy() || blocked()) return;
    const request = {};
    const isCurrent = snapshot();
    reader.current = request;
    setLoading(true);
    try {
      const data = await getDiscardContext(now.visitId);
      if (!isCurrent() || reader.current !== request) return;
      if (data.paciente_id !== now.patientId || !data.diagnostico_retinopatia_id ||
          data.detalles.some((d) => now.results[d.ojo]?.detalle_id !== d.detalle_id) ||
          data.detalles.length !== Object.keys(now.results).length) throw new Error("Contexto cambiado");
      setContext(data);
      if (open) setNotice(null);
      if (open) {
        reviewRef.current = { data, current: isCurrent };
        setReview(data);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setContext(null);
      setNotice(status(error) === 403 ? "La corrección no está habilitada o no tiene autorización para esta operación. Sus resultados se conservan."
        : "No se pudo verificar la disponibilidad de la corrección. Sus resultados se conservan.");
    } finally {
      if (reader.current === request) { reader.current = null; if (mounted.current) setLoading(false); }
    }
  };
  const idsKey = Object.values(options.results).map((r) => r?.detalle_id).join(",");
  useEffect(() => {
    reader.current = null;
    setLoading(false);
    close();
    setContext(null);
    setNotice(null);
    if (enabled && options.step === 3 && Object.values(options.results).some((r) =>
        r?.estado_validacion !== "APROBADO" && r?.estado_validacion !== "CORREGIDO")) void load(false);
    // Identidad de contexto y sesión: nunca reutilizar una revisión anterior.
  }, [enabled, options.step, options.patientId, options.visitId, idsKey, token, user]);

  const acceptOperation = (target: PendingDiscard, operation: DiscardOperation, isCurrent: () => boolean) => {
    const request = target.request;
    const result = operation.resultado;
    if (operation.operacion_id !== request.operacion_id || result.visita_id !== target.visitId ||
        !sameIds(result.detalle_ids_descartados, request.detalle_ids) || result.revision !== request.revision_esperada + 1) {
      throw new Error("Respuesta de otra operación");
    }
    const confirmed: PendingDiscard = { ...target, status: "confirmed", operation };
    recordDiscard(confirmed); // También si la respuesta llega tras salir/cambiar sesión.
    if (!isCurrent()) return;
    if (latest.current.apply(confirmed, operation)) {
      recordDiscard({ ...confirmed, status: "applied" });
      retireDiscardMarker(markerFor(confirmed)); // Solo después de la transición local.
      close();
      setContext(null);
      setNotice(null);
      return true;
    } else {
      setNotice("El descarte está confirmado para resultados anteriores. No se modificó un resultado nuevo; consulte el contexto antes de continuar.");
    }
    return false;
  };
  const consultMarker = async (saved: DiscardMarker) => {
    const session = useAuthStore.getState();
    if (!enabled || !session.isAuthenticated || session.user?.id !== saved.actorId || checking.current.has(saved.operationId)) return;
    const target = useDiagnosisDiscardStore.getState().entries.find((e) => e.actorId === saved.actorId && e.request.operacion_id === saved.operationId);
    if (target?.status === "sending") return;
    if (target?.status === "rejected") { retireDiscardMarker(saved); return; }
    const isCurrent = snapshot();
    const sessionId = sessionVersion.current;
    const sameSession = () => mounted.current && sessionId === sessionVersion.current &&
      session.token === useAuthStore.getState().token && session.user === useAuthStore.getState().user &&
      useAuthStore.getState().isAuthenticated;
    const message = (text: string) => { if (sameSession()) setRecoveryMessages((prev) => ({ ...prev, [saved.operationId]: text })); };
    checking.current.add(saved.operationId);
    setCheckingIds([...checking.current]);
    try {
      // Un hecho ya confirmado no se degrada por una lectura posterior ausente.
      const operation = target?.operation ?? await getDiscardOperation(saved.visitId, saved.operationId);
      if (!operation) {
        if (target) recordDiscard({ ...target, status: "uncertain" });
        message("Existe una corrección cuyo resultado aún no se ha podido confirmar. Verifique su estado antes de continuar con esta evaluación.");
        return;
      }
      const result = operation.resultado;
      if (operation.operacion_id !== saved.operationId || result.visita_id !== saved.visitId || result.revision < 1 ||
          (result.diagnostico_retinopatia_id === null) !== (result.detalle_ids_restantes.length === 0) ||
          result.detalle_ids_descartados.some((id) => result.detalle_ids_restantes.includes(id))) throw new Error("Otra operación");
      if (target && target.status !== "applied") {
        if (acceptOperation(target, operation, () => sameSession() && isCurrent() && latest.current.visitId === saved.visitId)) return;
      }
      message("La corrección está confirmada. Seleccione de nuevo el paciente y la visita para consultar su contexto actual; no se recuperaron fotografías ni borradores locales.");
      if (!sameSession() || !isCurrent() || latest.current.visitId !== saved.visitId || !latest.current.patientId || latest.current.busy()) return;
      if (Object.keys(latest.current.results).length && target?.status !== "applied") return;
      const context = await getDiscardContext(saved.visitId, saved.operationId);
      if (!sameSession() || !isCurrent()) return;
      if (context.paciente_id !== latest.current.patientId || context.revision < result.revision || context.estado_visita !== "ACTIVA" ||
          context.detalles.some((d) => result.detalle_ids_descartados.includes(d.detalle_id)) ||
          (context.diagnostico_retinopatia_id === null) !== (context.detalles.length === 0) ||
          context.estado_diagnostico !== (!context.detalles.length ? null :
            context.detalles.some((d) => d.estado_validacion === "PENDIENTE") ? "PROCESADO" : "VALIDADO")) throw new Error("Contexto no verificable");
      const local = Object.entries(latest.current.results);
      const alreadyApplied = target?.status === "applied" && local.length === context.detalles.length && local.every(([eye, r]) =>
        context.detalles.some((d) => d.ojo === eye && d.detalle_id === r?.detalle_id && d.estado_validacion === (r.estado_validacion ?? "PENDIENTE")));
      const adopted = alreadyApplied || await latest.current.recover?.(context, operation, () => sameSession() && isCurrent());
      if (adopted) {
        if (target) recordDiscard({ ...target, operation, status: "applied" });
        if (retireDiscardMarker(saved)) {
          message("Contexto actual verificado. Puede continuar en la misma visita.");
          if (sameSession()) setNotice(null);
        }
      }
    } catch {
      message("No se pudo verificar la corrección o el contexto actual. La evaluación afectada sigue bloqueada; vuelva a consultar la misma operación.");
    } finally {
      checking.current.delete(saved.operationId);
      if (sameSession()) setCheckingIds([...checking.current]);
    }
  };
  const markerIds = markers.map((m) => `${m.operationId}@${m.visitId}`).join(",");
  useEffect(() => {
    if (enabled && actorId && recoveryActorId === actorId && !storageError) {
      markers.forEach((m) => { void consultMarker(m); });
    }
  }, [enabled, actorId, recoveryActorId, markerIds, storageError, options.patientId, options.visitId, token, user]);
  const reconcile = (target = currentPending()) => {
    const saved = target ? markerFor(target) : currentMarker();
    return saved ? consultMarker(saved) : Promise.resolve();
  };
  const confirm = async (data: DiscardContext, selected: number[], accepted: boolean) => {
    const binding = reviewRef.current;
    const now = latest.current;
    if (!enabled || !accepted || !binding || binding.data !== data || !binding.current() || now.busy() ||
        currentPending() || currentMarker() || storageError || !selected.length || new Set(selected).size !== selected.length || !data.diagnostico_retinopatia_id ||
        selected.some((id) => !data.detalles.some((d) => d.detalle_id === id && d.elegible && d.estado_validacion === "PENDIENTE"))) return;
    const actorId = useAuthStore.getState().user?.id;
    if (!actorId || !globalThis.crypto?.randomUUID) { setNotice("No se pudo generar una identidad segura de operación."); return; }
    const target: PendingDiscard = {
      actorId, visitId: data.visita_id, status: "sending",
      request: { paciente_id: data.paciente_id, diagnostico_retinopatia_id: data.diagnostico_retinopatia_id,
        detalle_ids: [...selected].sort((a, b) => a - b), revision_esperada: data.revision,
        operacion_id: crypto.randomUUID(), confirmo_descarte: true },
      targets: data.detalles.filter((d) => selected.includes(d.detalle_id)).map((d) => ({ eye: d.ojo, detailId: d.detalle_id })),
    };
    const isCurrent = binding.current;
    if (!retainDiscardMarker(target)) {
      close();
      setNotice("No se pudo conservar y verificar la identidad de la corrección en esta pestaña. No se envió el descarte.");
      return;
    }
    recordDiscard(target); // Exclusión síncrona, anterior al primer await.
    close();
    try {
      acceptOperation(target, await discardResults(target.visitId, target.request), isCurrent);
    } catch (error) {
      const code = status(error);
      if (code === 409 || code === 400 || code === 401 || code === 403) {
        recordDiscard({ ...target, status: "rejected" });
        retireDiscardMarker(markerFor(target)); // Rechazo definitivo de ESTE único POST.
        if (!isCurrent()) return;
        setContext(null);
        setNotice(code === 403 ? "No tiene autorización para descartar estos resultados. Se conservó la evaluación."
          : "La corrección no se confirmó: cambió el estado o la elegibilidad. Actualice la información antes de otro intento.");
        // Lectura solamente. Un 409 no limpia ni repite el POST.
        if (code === 409) void load(false);
      } else {
        recordDiscard({ ...target, status: "uncertain" });
        if (isCurrent()) setNotice("No se confirmó la respuesta del descarte. No repita el análisis mientras se consulta la misma operación.");
        await reconcile(target);
      }
    }
  };
  return {
    context, review, loading: loading || entry?.status === "sending" || !!marker && checkingIds.includes(marker.operationId), blocked,
    canOpen: enabled && authorizedLocally && !!context?.detalles.some((d) => d.elegible) && !entry && !marker && !storageError,
    pending: enabled && (!!entry || !!marker),
    notice: !enabled ? null : storageError ? "No se pudo verificar el almacenamiento técnico de esta pestaña. No se permiten nuevas escrituras de Diagnóstico IA hasta verificarlo; los demás módulos siguen disponibles."
      : (marker && recoveryMessages[marker.operationId]) || notice || (entry || marker ? "Existe una corrección pendiente de conciliación. No repita el análisis ni la validación." : null),
    recoveries: enabled && recoveryActorId === actorId ? markers.filter((m) => m.visitId !== options.visitId).map((m) => ({
      operationId: m.operationId, loading: checkingIds.includes(m.operationId) || entries.some((e) => e.request.operacion_id === m.operationId && e.status === "sending"),
      notice: recoveryMessages[m.operationId] ?? "Existe una corrección pendiente de verificar en esta pestaña. Seleccione el paciente y la visita correspondientes antes de continuar con esa evaluación.",
      consult: () => consultMarker(m),
    })) : [],
    otherPending: enabled ? entries.filter((e) => pending(e) && e.actorId === user?.id && !matches(e)).length : 0,
    open: () => load(true), refresh: () => { if (storageError) hydrateDiscardMarkers(actorId); else return load(false); },
    close, confirm, reconcile: () => reconcile(),
  };
}
