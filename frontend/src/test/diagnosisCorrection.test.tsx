// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { diagnosisDiscardEnabled } from "../lib/clinicalFeatures";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { useDiagnosisCorrection } from "../features/diagnosis/hooks/useDiagnosisCorrection";
import { useAuthStore } from "../features/auth/store/authStore";
import { recordDiscard, useDiagnosisDiscardStore } from "../features/diagnosis/store/diagnosisDiscardStore";
import { CorrectPhotographsModal } from "../features/diagnosis/components/CorrectPhotographsModal";
import { revokePreviewUrl } from "../lib/imageUtils";
import { isModuleAccessDenial } from "../features/auth/moduleAccess";
import type { DiscardContext, DiscardOperation, DiscardRequest } from "../features/diagnosis/api/diagnosisDiscardService";
import type { EyeKey } from "../features/diagnosis/types";
import type { DiagnosisResult } from "../features/diagnosis/api/diagnosisService";
import { confirmManualPhotos } from "./diagnosisTestActions";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../lib/clinicalFeatures", () => ({ diagnosisDiscardEnabled: vi.fn(() => true) }));
vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]), obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/imageUtils", () => ({ convertToPreviewUrl: vi.fn(async (file: File) => `blob:${file.name}`), revokePreviewUrl: vi.fn() }));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" };
const contextPath = "/diagnosticar/visita/30/contexto-descarte";
const discardPath = "/diagnosticar/visita/30/descartar-resultados";
const post = vi.mocked(api.post);
const get = vi.mocked(api.get);
let context: DiscardContext;
let saved: DiscardOperation | null;
let nextOI: number;
let behavior: "ok" | "timeout" | "lost" | "conflict" | "forbidden";
const envelope = (data: unknown) => ({ data: { success: true, data } });
const failure = (status: number) => ({ response: { status } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function operation(request: DiscardRequest): DiscardOperation {
  const remaining = context.detalles.filter((d) => !request.detalle_ids.includes(d.detalle_id)).map((d) => d.detalle_id);
  return { operacion_id: request.operacion_id, persistencia: "CONFIRMADA", limpieza: "PENDIENTE", fecha_utc: "2026-11-01T10:00:00Z",
    resultado: { visita_id: 30, detalle_ids_descartados: request.detalle_ids, detalle_ids_restantes: remaining,
      diagnostico_retinopatia_id: remaining.length ? 9 : null, estado_diagnostico: remaining.length ? "PROCESADO" : null,
      revision: request.revision_esperada + 1 } };
}
async function prepared() {
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoadingRecent).toBe(false));
  act(() => { hook.result.current.selectPatient(patient); hook.result.current.selectVisita(null); hook.result.current.goNext(); });
  await act(async () => {
    await hook.result.current.handleFile("OD", new File(["OD"], "OD.jpg"));
    await hook.result.current.handleFile("OI", new File(["OI"], "OI.jpg"));
  });
  act(() => hook.result.current.goNext());
  confirmManualPhotos(hook.result);
  await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
  if (diagnosisDiscardEnabled()) await waitFor(() => expect(hook.result.current.correction.canOpen).toBe(true));
  return hook;
}
async function open(hook: Awaited<ReturnType<typeof prepared>>) {
  await act(async () => { await hook.result.current.correction.open(); });
  expect(hook.result.current.correction.review).not.toBeNull();
  return hook.result.current.correction.review!;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diagnosisDiscardEnabled).mockReturnValue(true);
  sessionStorage.clear();
  useDiagnosisDiscardStore.setState({ entries: [], markers: [], recoveryActorId: null, storageError: false });
  useAuthStore.getState().login("synthetic-session", { id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético",
    roles: ["Oftalmologo"], permisos: ["diagnostico_retinopatia.descartar_pendiente"] });
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  saved = null; nextOI = 12; behavior = "ok";
  context = { visita_id: 30, paciente_id: 7, estado_visita: "ACTIVA", diagnostico_retinopatia_id: 9,
    estado_diagnostico: "PROCESADO", revision: 0, detalles: (["OD", "OI"] as EyeKey[]).map((ojo, i) =>
      ({ ojo, detalle_id: 11 + i, estado_validacion: "PENDIENTE", elegible: true, bloqueo: null })) };
  get.mockReset().mockImplementation(async (url) => {
    if (url === contextPath) return envelope(structuredClone(context));
    if (String(url).includes("/operaciones-descarte/")) return envelope({ conciliacion: saved ? "CONFIRMADA" : "NO_CONFIRMADA", operacion: saved });
    return envelope({ ojos: [] });
  });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === discardPath) {
      if (behavior === "conflict") throw failure(409);
      if (behavior === "forbidden") throw failure(403);
      if (behavior === "timeout") throw new Error("Respuesta perdida");
      saved = operation(body as DiscardRequest);
      if (behavior === "lost") throw new Error("Commit confirmado, respuesta perdida");
      return envelope(saved);
    }
    if (url !== "/diagnosticar" || !(body instanceof FormData)) throw new Error("POST no previsto");
    const eye = body.get("ojo_evaluado") === "Derecho" ? "OD" : "OI";
    return envelope({ visita_id: 30, diagnostico_retinopatia_id: nextOI === 13 ? 10 : 9,
      detalle_id: eye === "OD" ? 11 : nextOI, diagnostico_codigo: 2, diagnostico_texto: "Moderada",
      confianza_general: 80, probabilidades_detalle: { moderada: 80 }, gradcam_url: `${eye}.jpg`, mensaje: "Registrado" });
  });
  vi.mocked(api.put).mockReset().mockResolvedValue(envelope({ estado_validacion: "APROBADO" }));
});
afterEach(() => { cleanup(); useDiagnosisDiscardStore.setState({ entries: [] }); useAuthStore.getState().logout(); vi.unstubAllGlobals(); });

describe("descarte confirmado en la misma visita", () => {
  it("apagado no consulta la capacidad ni ofrece corrección", async () => {
    vi.mocked(diagnosisDiscardEnabled).mockReturnValue(false);
    const hook = await prepared();
    expect(hook.result.current.correction.canOpen).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
  it("la autoridad backend excluye retinógrafo y validados aunque el archivo local sea manual", async () => {
    const hook = await prepared();
    context.detalles[0] = { ...context.detalles[0], elegible: false, bloqueo: "COMPROBANTE_VINCULADO" };
    const review = await open(hook);
    await act(async () => hook.result.current.correction.confirm(review, [11], true));
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(0);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
  });
  it("cancelar o no aceptar no escribe ni libera fotografías", async () => {
    const hook = await prepared(); const review = await open(hook);
    const previous = hook.result.current.results;
    await act(async () => hook.result.current.correction.confirm(review, [12], false));
    act(() => hook.result.current.correction.close());
    expect(hook.result.current.results).toBe(previous);
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(0);
  });
  it("descarta solo OI, conserva íntegramente OD validado y sus borradores", async () => {
    const hook = await prepared();
    act(() => { hook.result.current.setComment("OD", "Nota OD"); hook.result.current.setFinalSelection("OD", 2); });
    await act(async () => hook.result.current.validateDiagnosis("OD"));
    context.detalles[0] = { ...context.detalles[0], elegible: false, estado_validacion: "APROBADO", bloqueo: "RESULTADO_VALIDADO" };
    const original = hook.result.current.results.OD;
    const review = await open(hook);
    vi.mocked(revokePreviewUrl).mockClear();
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.results.OD).toBe(original);
    expect(hook.result.current.validatedEyes.OD).toBe("APROBADO");
    expect(hook.result.current.comments.OD).toBe("Nota OD");
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(hook.result.current.eyeProcessing.OI).toBe("sin_procesar");
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.selectedPatient).toEqual(patient);
    expect(revokePreviewUrl).toHaveBeenCalledExactlyOnceWith("blob:OI.jpg");
    expect(post.mock.calls.find(([url]) => url === discardPath)?.[1]).toEqual({ paciente_id: 7, diagnostico_retinopatia_id: 9,
      detalle_ids: [12], revision_esperada: 0, operacion_id: "11111111-1111-4111-8111-111111111111", confirmo_descarte: true });
  });
  it("ambos ojos quedan editables sin conservar el padre eliminado ni perder visita", async () => {
    const hook = await prepared(); const review = await open(hook);
    await act(async () => hook.result.current.correction.confirm(review, [11, 12], true));
    expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.step).toBe(2);
  });
  it("la fotografía corregida exige nueva revisión manual y reutiliza handleSave solo para OI", async () => {
    const hook = await prepared(); const review = await open(hook);
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    nextOI = 13;
    await act(async () => hook.result.current.handleFile("OI", new File(["correcta"], "correcta.jpg")));
    act(() => hook.result.current.goNext());
    expect(hook.result.current.manualReview?.images.map((i) => i.eye)).toEqual(["OI"]);
    expect(post.mock.calls.filter(([url]) => url === "/diagnosticar")).toHaveLength(2);
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.step).toBe(3));
    const forms = post.mock.calls.filter(([url]) => url === "/diagnosticar").map(([, body]) => body as FormData);
    expect(forms.map((f) => f.get("ojo_evaluado"))).toEqual(["Derecho", "Izquierdo", "Izquierdo"]);
    expect(forms[2].get("visita_id")).toBe("30");
    expect(hook.result.current.results.OI?.detalle_id).toBe(13);
  });
  it("una conciliación posterior no recupera el ID descartado", async () => {
    const hook = await prepared(); const review = await open(hook);
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    get.mockResolvedValueOnce(envelope({ ojos: [{ detalle_id: 12, ojo: "OI", resultado_ia: 2 }] }));
    await act(async () => hook.result.current.reconcileResults());
    expect(hook.result.current.results.OI).toBeUndefined();
  });
});

describe("exclusión, conflictos y respuestas inciertas", () => {
  it("doble clic produce un solo POST y no habilita otra escritura durante el envío", async () => {
    const hook = await prepared(); const review = await open(hook);
    const response = deferred<ReturnType<typeof envelope>>();
    post.mockImplementationOnce(() => response.promise);
    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.correction.confirm(review, [12], true);
      void hook.result.current.correction.confirm(review, [12], true);
      void hook.result.current.validateAll(); hook.result.current.goBack();
    });
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.results.OI).toBeDefined();
    expect(api.put).not.toHaveBeenCalled();
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(1);
    await act(async () => { response.resolve(envelope(operation(post.mock.calls.at(-1)![1] as DiscardRequest))); await first; });
    expect(hook.result.current.step).toBe(2);
  });
  it("bloquea navegación contextual y consultas de conciliación en el mismo tick del POST", async () => {
    const hook = await prepared();
    // Solo OD registrado: en ausencia del bloqueo síncrono, Añadir OI permitiría navegar.
    await act(async () => hook.result.current.correction.open());
    const initial = hook.result.current.correction.review!;
    await act(async () => hook.result.current.correction.confirm(initial, [12], true));
    context.detalles = context.detalles.filter((d) => d.ojo === "OD");
    context.revision = 1;
    vi.stubGlobal("crypto", { randomUUID: () => "22222222-2222-4222-8222-222222222222" });
    act(() => hook.result.current.returnToResults());
    await waitFor(() => expect(hook.result.current.correction.canOpen).toBe(true));
    const review = await open(hook);
    const response = deferred<ReturnType<typeof envelope>>(); post.mockImplementationOnce(() => response.promise);
    get.mockClear();
    let request!: Promise<void>;
    act(() => {
      request = hook.result.current.correction.confirm(review, [11], true);
      hook.result.current.goBack();
      void hook.result.current.correction.reconcile();
    });
    expect(hook.result.current.step).toBe(3);
    expect(get).not.toHaveBeenCalled();
    const body = post.mock.calls.at(-1)![1] as DiscardRequest;
    await act(async () => { response.resolve(envelope(operation(body))); await request; });
    expect(hook.result.current.step).toBe(2);
  });
  it("un hecho confirmado no se degrada por una respuesta anterior incierta", () => {
    const request: DiscardRequest = { paciente_id: 7, diagnostico_retinopatia_id: 9, detalle_ids: [12],
      revision_esperada: 0, operacion_id: "11111111-1111-4111-8111-111111111111", confirmo_descarte: true };
    const entry = { actorId: 1, visitId: 30, request, targets: [{ eye: "OI" as const, detailId: 12 }] };
    const confirmed = { ...entry, status: "confirmed" as const, operation: operation(request) };
    recordDiscard(confirmed);
    recordDiscard({ ...entry, status: "uncertain" });
    expect(useDiagnosisDiscardStore.getState().entries[0]).toBe(confirmed);
    recordDiscard({ ...confirmed, status: "applied" });
    recordDiscard(confirmed);
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("applied");
  });
  it.each(["conflict", "forbidden"] as const)("%s conserva contexto y resultados sin reenviar", async (mode) => {
    const hook = await prepared(); const review = await open(hook); const original = hook.result.current.results;
    behavior = mode;
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.results).toBe(original);
    expect(hook.result.current.step).toBe(3);
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(1);
  });
  it("timeout sin confirmación conserva UUID y bloquea acciones incluso con modal cerrado", async () => {
    const hook = await prepared(); const review = await open(hook); behavior = "timeout";
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.correction.review).toBeNull();
    expect(hook.result.current.correction.pending).toBe(true);
    expect(hook.result.current.isNavigationBusy).toBe(true);
    await act(async () => hook.result.current.validateAll());
    act(() => { hook.result.current.goBack(); hook.result.current.goNext(); });
    expect(hook.result.current.step).toBe(3);
    expect(api.put).not.toHaveBeenCalled();
    expect(hook.result.current.results.OI?.detalle_id).toBe(12);
    expect(useDiagnosisDiscardStore.getState().entries[0].request.operacion_id).toBe("11111111-1111-4111-8111-111111111111");
  });
  it.each([404, 500, 503])("un POST %s incierto no se reenvía ni libera fotografías", async (status) => {
    const hook = await prepared(); const review = await open(hook);
    post.mockRejectedValueOnce(failure(status));
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.correction.pending).toBe(true);
    expect(hook.result.current.results.OI?.detalle_id).toBe(12);
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(1);
    expect(get.mock.calls.some(([url]) => String(url).includes("/operaciones-descarte/"))).toBe(true);
  });
  it("una respuesta 200 no verificable mantiene incertidumbre hasta confirmar la operación", async () => {
    const hook = await prepared(); const review = await open(hook);
    post.mockResolvedValueOnce(envelope({ persistencia: "CONFIRMADA" }));
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.correction.pending).toBe(true);
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.results.OI?.detalle_id).toBe(12);
  });
  it("IDs restantes desconocidos fallan cerrados sin degradar el hecho confirmado", async () => {
    const hook = await prepared(); const review = await open(hook); const original = hook.result.current.results;
    post.mockImplementationOnce(async (_, body) => {
      const confirmed = operation(body as DiscardRequest);
      confirmed.resultado.detalle_ids_restantes = [99];
      return envelope(confirmed);
    });
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.results).toBe(original);
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.correction.pending).toBe(true);
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("confirmed");
    get.mockClear();
    await act(async () => hook.result.current.correction.reconcile());
    expect(get).not.toHaveBeenCalled();
    expect(hook.result.current.results).toBe(original);
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("confirmed");
  });
  it("respuesta perdida tras commit se concilia y limpia solo OI", async () => {
    const hook = await prepared(); const review = await open(hook); behavior = "lost";
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.step).toBe(2);
    expect(get.mock.calls.some(([url]) => String(url).endsWith("/operaciones-descarte/11111111-1111-4111-8111-111111111111"))).toBe(true);
  });
  it("404 de conciliación no prueba rollback ni libera resultados", async () => {
    const hook = await prepared(); const review = await open(hook); behavior = "timeout";
    get.mockImplementation(async (url) => { if (String(url).includes("operaciones-descarte")) throw failure(404); return envelope(context); });
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(hook.result.current.correction.pending).toBe(true);
    expect(hook.result.current.results.OI).toBeDefined();
  });
  it("respuesta tardía no modifica otro paciente y conserva el hecho de la operación", async () => {
    const hook = await prepared(); const review = await open(hook);
    const response = deferred<ReturnType<typeof envelope>>(); post.mockImplementationOnce(() => response.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.correction.confirm(review, [12], true); });
    const body = post.mock.calls.at(-1)![1] as DiscardRequest;
    act(() => { hook.result.current.selectPatient({ ...patient, id: 8 }); hook.result.current.selectVisita(null); });
    await act(async () => { response.resolve(envelope(operation(body))); await request; });
    expect(hook.result.current.selectedPatient?.id).toBe(8);
    expect(hook.result.current.step).not.toBe(2);
    expect(hook.result.current.results).toEqual({});
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("confirmed");
  });
  it("un cambio de sesión invalida la revisión antes del POST", async () => {
    const hook = await prepared(); const review = await open(hook);
    act(() => useAuthStore.getState().logout());
    await act(async () => hook.result.current.correction.confirm(review, [12], true));
    expect(post.mock.calls.filter(([url]) => url === discardPath)).toHaveLength(0);
  });
  it("al desmontar conserva la identidad y una confirmación tardía para consulta posterior", async () => {
    const hook = await prepared(); const review = await open(hook);
    const response = deferred<ReturnType<typeof envelope>>(); post.mockImplementationOnce(() => response.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.correction.confirm(review, [12], true); });
    const body = post.mock.calls.at(-1)![1] as DiscardRequest;
    hook.unmount();
    await act(async () => { response.resolve(envelope(operation(body))); await request; });
    const entry = useDiagnosisDiscardStore.getState().entries[0];
    expect(entry.status).toBe("confirmed");
    expect(entry.request).toEqual(body);
    expect(entry.operation?.operacion_id).toBe(body.operacion_id);
  });
  it("una operación antigua no aplica su respuesta a un detalle nuevo del mismo ojo", async () => {
    const makeResult = (id: number): DiagnosisResult => ({ visita_id: 30, detalle_id: id,
      diagnostico_codigo: 2, diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Registrado" });
    const apply = vi.fn(() => false);
    let version = 0;
    const hook = renderHook(({ detail }) => useDiagnosisCorrection({ step: 3, patientId: 7, visitId: 30,
      results: { OD: makeResult(11), OI: makeResult(detail) }, version: () => version, busy: () => false, apply }),
      { initialProps: { detail: 12 } });
    await waitFor(() => expect(hook.result.current.canOpen).toBe(true));
    await act(async () => { await hook.result.current.open(); });
    const review = hook.result.current.review!;
    const response = deferred<ReturnType<typeof envelope>>(); post.mockImplementationOnce(() => response.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.confirm(review, [12], true); });
    const body = post.mock.calls.at(-1)![1] as DiscardRequest;
    version++;
    hook.rerender({ detail: 13 });
    await act(async () => { response.resolve(envelope(operation(body))); await request; });
    expect(apply).not.toHaveBeenCalled();
    expect(useDiagnosisDiscardStore.getState().entries[0].targets).toEqual([{ eye: "OI", detailId: 12 }]);
  });
  it("una disponibilidad 403 conserva resultados y no ofrece el modal", async () => {
    const hook = await prepared(); const original = hook.result.current.results;
    get.mockRejectedValueOnce(failure(403));
    await act(async () => { await hook.result.current.correction.open(); });
    expect(hook.result.current.correction.review).toBeNull();
    expect(hook.result.current.correction.canOpen).toBe(false);
    expect(hook.result.current.results).toBe(original);
    expect(hook.result.current.correction.notice).toContain("autorización");
  });
});

describe("modal accesible y autorización por operación", () => {
  it("identifica paciente/visita, inicia vacío y exige selección más aceptación", () => {
    const confirm = vi.fn(); const cancel = vi.fn();
    render(<CorrectPhotographsModal context={context} patientLabel="Paciente Sintético · DNI 00000000" visitLabel="Visita actual"
      onCancel={cancel} onConfirm={confirm} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Corregir fotografías");
    expect(screen.getByText("Visita actual")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") === "false")).toBe(true);
    const button = screen.getByRole("button", { name: "Descartar resultados" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Descartar OI" }));
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que deseo/ }));
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(context, [12], true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["RESULTADO_VALIDADO", "COMPROBANTE_VINCULADO"])("%s no puede seleccionarse", (reason) => {
    context.detalles[0] = { ...context.detalles[0], elegible: false, bloqueo: reason };
    render(<CorrectPhotographsModal context={context} patientLabel="Paciente" visitLabel="Visita" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Descartar OD" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Descartar OI" })).toBeEnabled();
  });
  it("Escape cierra sin escribir y cambiar la selección reinicia la aceptación", () => {
    const cancel = vi.fn(); const confirm = vi.fn();
    render(<CorrectPhotographsModal context={context} patientLabel="Paciente" visitLabel="Visita" onCancel={cancel} onConfirm={confirm} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Descartar OI" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que deseo/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Descartar OD" }));
    expect(screen.getByRole("checkbox", { name: /Confirmo que deseo/ })).not.toBeChecked();
    const button = screen.getByRole("button", { name: "Cancelar" });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("403 de corrección no revoca el módulo; inferencia y lecturas originales conservan su guardia", () => {
    expect(isModuleAccessDenial("diagnosis", discardPath, "POST")).toBe(false);
    expect(isModuleAccessDenial("diagnosis", contextPath, "GET")).toBe(false);
    expect(isModuleAccessDenial("diagnosis", "/diagnosticar/visita/30/operaciones-descarte/a-b", "GET")).toBe(false);
    expect(isModuleAccessDenial("diagnosis", "/diagnosticar", "POST")).toBe(true);
    expect(isModuleAccessDenial("diagnosis", "/diagnosticar/visita/30/detalles", "GET")).toBe(true);
  });
});
