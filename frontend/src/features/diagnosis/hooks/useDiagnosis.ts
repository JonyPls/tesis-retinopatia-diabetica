import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl, revokePreviewUrl } from "@/lib/imageUtils";
import { clinicalInstant, compareVisitGroups } from "@/lib/clinicalDates";
import {
  buscarPacientesPaginado,
  DiagnosticoVisita,
  obtenerPacientesRecientes,
  obtenerVisitasPaciente,
  PatientSearchResult,
} from "@/features/patients/api/patientService";
import {
  crearDiagnostico,
  crearDiagnosticoConfirmado,
  DiagnosisResult,
  obtenerDetallesVisita,
  resultadoPersistido,
  descargarImagenRetinografo,
  obtenerSeleccionAutomaticaRetinografo,
  consultarConfirmacionRetinografo,
  registrarConfirmacionRetinografo,
  revocarConfirmacionRetinografo,
  sha256Blob,
  validarDetalleDiagnostico,
} from "@/features/diagnosis/api/diagnosisService";
import type { RetinographAutoImage } from "@/features/diagnosis/api/diagnosisService";
import { patientRequestError, PatientRequestError } from "@/features/patients/patientAccess";
import { EyeKey, EyeState, EyeProcessingStatus, DiagnosisHook, AutoPreview } from "../types";

type BoundConfirmation = { token: string; patientId: number; eye: EyeKey; filename: string; file: File };
const eyeName = (eye: EyeKey) => eye === "OD" ? "Derecho" : "Izquierdo";
const statusCode = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;

const EMPTY_EYE: EyeState = { file: null, preview: null, isExistingImage: false };
const EMPTY_PROCESSING: Record<EyeKey, EyeProcessingStatus> = { OD: "sin_procesar", OI: "sin_procesar" };

function processingFailure(status?: number): string {
  switch (status) {
    case 400: return "Revise los datos o el formato de la imagen.";
    case 401: return "Su sesión ya no es válida. Inicie sesión nuevamente.";
    case 403: return "No tiene autorización para crear este diagnóstico.";
    case 404: return "No se encontró el recurso solicitado.";
    case 409: return "Ya existe un resultado o la visita no admite el procesamiento. Se consultará el estado registrado.";
    case 413: return "La imagen supera el tamaño permitido.";
    case 422: return "La imagen fue rechazada por la validación semántica.";
    case 503: return "La validación de imagen no está disponible. No se confirmó un resultado nuevo.";
    case 500: return "No se pudo confirmar el guardado. No vuelva a enviar esta imagen sin consultar su estado.";
    default: return "No se pudo confirmar la respuesta del servidor. No vuelva a enviar esta imagen sin consultar su estado.";
  }
}

function reconciliationFailure(status?: number): string {
  switch (status) {
    case 401: return "La sesión ya no es válida; inicie sesión para consultar el resultado.";
    case 403: return "No tiene autorización para consultar el resultado. Esto no significa que no exista.";
    case 404: return "No se encontró un diagnóstico en esta visita al consultar; no se puede descartar un guardado pendiente de confirmación.";
    default: return "No fue posible consultar el resultado registrado. Consulte la visita antes de volver a procesar.";
  }
}
const PATIENT_SEARCH_PAGE_SIZE = 10;
const RECENT_VISIT_HOURS = 24;

function inferMimeType(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "tif":
    case "tiff":
      return "image/tiff";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

export function useDiagnosis(): DiagnosisHook {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [processingEye, setProcessingEye] = useState<EyeKey | null>(null);
  const [modalPhase, setModalPhase] = useState<"idle" | "validating" | "analyzing" | "error">("idle");
  const [modalProgress, setModalProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [failedEye, setFailedEye] = useState<EyeKey | null>(null);

  // Paso 1
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [recentPatients, setRecentPatients] = useState<PatientSearchResult[]>(
    [],
  );
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMorePatients, setIsLoadingMorePatients] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreSearchResults, setHasMoreSearchResults] = useState(false);
  const [searchError, setSearchError] = useState<PatientRequestError | null>(null);
  const [recentError, setRecentError] = useState<PatientRequestError | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const searchRequest = useRef(0);
  const recentDenied = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visitasRecientes, setVisitasRecientes] = useState<DiagnosticoVisita[]>([]);
  const [selectedVisita, setSelectedVisita] =
    useState<DiagnosticoVisita | null | undefined>(undefined);
  const [isLoadingVisitas, setIsLoadingVisitas] = useState(false);

  // Paso 2
  const [eyes, setEyes] = useState<Record<EyeKey, EyeState>>({
    OD: { ...EMPTY_EYE },
    OI: { ...EMPTY_EYE },
  });
  const eyesRef = useRef<Record<EyeKey, EyeState>>(eyes);
  const confirmationsRef = useRef<Partial<Record<EyeKey, BoundConfirmation>>>({});
  const eyeGeneration = useRef<Record<EyeKey, number>>({ OD: 0, OI: 0 });
  const statusRequest = useRef<Record<EyeKey, number>>({ OD: 0, OI: 0 });
  const confirmingRef = useRef<Partial<Record<EyeKey, number>>>({});
  const revokingRef = useRef<Partial<Record<EyeKey, boolean>>>({});
  const [isAutoSelectingImages, setIsAutoSelectingImages] = useState(false);
  const autoSelectingRef = useRef(false);
  const selectionAbort = useRef<AbortController | null>(null);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoCandidates, setAutoCandidates] = useState<RetinographAutoImage[]>([]);
  const [autoPreview, setAutoPreview] = useState<AutoPreview | null>(null);
  const [autoFocusEye, setAutoFocusEye] = useState<EyeKey | null>(null);
  const autoPreviewRef = useRef<AutoPreview | null>(null);
  const [autoPreviewLoading, setAutoPreviewLoading] = useState(false);
  const previewRequest = useRef(0);
  const [busyEyes, setBusyEyes] = useState<Record<EyeKey, boolean>>({ OD: false, OI: false });
  const [eyeActionError, setEyeActionError] = useState<Partial<Record<EyeKey, string>>>({});
  const setEyeError = (eye: EyeKey, message?: string) => setEyeActionError((prev) =>
    ({ ...prev, [eye]: message }));
  const hasPendingAssociation = () => confirmingRef.current.OD !== undefined ||
    confirmingRef.current.OI !== undefined || !!revokingRef.current.OD || !!revokingRef.current.OI;

  // Paso 3
  const [results, setResults] = useState<
    Partial<Record<EyeKey, DiagnosisResult>>
  >({});
  const [eyeProcessing, setEyeProcessing] = useState<Record<EyeKey, EyeProcessingStatus>>({ ...EMPTY_PROCESSING });
  const [confirmedVisitId, setConfirmedVisitId] = useState<number | null>(null);
  const [processingNotice, setProcessingNotice] = useState<string | null>(null);
  const contextVersion = useRef(0);
  const savingRef = useRef(false);
  const confirmedVisitRef = useRef<number | null>(null);
  const resultsRef = useRef<Partial<Record<EyeKey, DiagnosisResult>>>({});

  const keepResults = (next: Partial<Record<EyeKey, DiagnosisResult>>) => {
    resultsRef.current = { ...resultsRef.current, ...next };
    setResults({ ...resultsRef.current });
    const initial: Partial<Record<EyeKey, number>> = {};
    const validated: Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">> = {};
    (Object.keys(next) as EyeKey[]).forEach((eye) => {
      const result = next[eye]!;
      initial[eye] = result.diagnostico_final ?? result.diagnostico_codigo;
      if (result.estado_validacion === "APROBADO" || result.estado_validacion === "CORREGIDO") {
        validated[eye] = result.estado_validacion;
      }
    });
    setFinalSelectionState((prev) => ({ ...prev, ...initial }));
    setValidatedEyes((prev) => ({ ...prev, ...validated }));
    setEyeProcessing((prev) => {
      const updated = { ...prev };
      (Object.keys(next) as EyeKey[]).forEach((eye) => {
        updated[eye] = validated[eye] ? "validado" : "pendiente_validacion";
      });
      return updated;
    });
  };

  const rememberVisit = (id: number) => {
    confirmedVisitRef.current = id;
    setConfirmedVisitId(id);
  };

  const reconcile = async (visitId: number, version: number): Promise<string | null> => {
    try {
      const details = await obtenerDetallesVisita(visitId);
      if (version !== contextVersion.current) return null;
      const persisted: Partial<Record<EyeKey, DiagnosisResult>> = {};
      details.forEach((detail) => {
        if (detail.ojo === "OD" || detail.ojo === "OI") {
          persisted[detail.ojo] = resultadoPersistido(visitId, detail);
        }
      });
      keepResults(persisted);
      if (Object.keys(persisted).length) {
        setActiveEye((Object.keys(persisted) as EyeKey[])[0]);
        setStep(3);
      }
      return null;
    } catch (error) {
      if (version !== contextVersion.current) return null;
      return reconciliationFailure((error as { response?: { status?: number } })?.response?.status);
    }
  };

  const reconcileResults = async () => {
    const visitId = confirmedVisitRef.current;
    if (!visitId) {
      setProcessingNotice("No se recibió un identificador de visita. Consulte el historial antes de volver a procesar.");
      return;
    }
    const version = contextVersion.current;
    const failure = await reconcile(visitId, version);
    if (version === contextVersion.current) {
      setProcessingNotice(failure ?? "Consulta completada. Solo se muestran los ojos registrados; no reenvíe un ojo de estado incierto.");
    }
  };

  const resetProcessing = () => {
    const remotePending = savingRef.current || confirmingRef.current.OD !== undefined ||
      confirmingRef.current.OI !== undefined || revokingRef.current.OD || revokingRef.current.OI;
    const discarded = !!confirmationsRef.current.OD || !!confirmationsRef.current.OI;
    contextVersion.current++;
    selectionAbort.current?.abort();
    previewRequest.current++;
    revokePreviewUrl(autoPreviewRef.current?.preview);
    autoPreviewRef.current = null;
    setAutoPreview(null);
    setAutoFocusEye(null);
    setAutoCandidates([]);
    setAutoModalOpen(false);
    savingRef.current = false;
    setIsSaving(false);
    setModalPhase("idle");
    setProcessingEye(null);
    confirmationsRef.current = {};
    eyeGeneration.current.OD++;
    eyeGeneration.current.OI++;
    confirmedVisitRef.current = null;
    resultsRef.current = {};
    setConfirmedVisitId(null);
    setProcessingNotice(remotePending
      ? "Una solicitud anterior podría haberse registrado aunque se haya abandonado esta pantalla. Consulte el historial o revise de nuevo antes de repetirla."
      : discarded ? "Se descartó un comprobante local; la confirmación en el servidor no se revocó. Revise su estado antes de volver a confirmar." : null);
    setEyeActionError({});
    setEyeProcessing({ ...EMPTY_PROCESSING });
    setResults({});
  };
  const [activeEye, setActiveEye] = useState<EyeKey>("OD");
  // Validación
  const [finalSelection, setFinalSelectionState] = useState<
    Record<EyeKey, number>
  >({ OD: 0, OI: 0 });
  const [comments, setComments] = useState<Record<EyeKey, string>>({
    OD: "",
    OI: "",
  });
  const [correctionReasons, setCorrectionReasons] = useState<
    Record<EyeKey, string>
  >({
    OD: "",
    OI: "",
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validatedEyes, setValidatedEyes] = useState<Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">>>({});
  const [validationConflict, setValidationConflict] = useState(false);

  const validationFailure = (error: unknown, eye: EyeKey) => {
    const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
    if (status === 409) {
      setValidationConflict(true);
      return "Este resultado ya fue validado. Actualice la vista antes de continuar.";
    }
    if (status === 401) return "Su sesión ya no es válida. Inicie sesión nuevamente.";
    if (status === 403) return "No tiene permiso vigente para validar diagnósticos.";
    if (status === 400) return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Revise los datos de validación.";
    return `No se pudo validar ${eye}. Inténtelo nuevamente.`;
  };

  const navigate = useNavigate();

  // Cargar recientes al montar
  useEffect(() => {
    let active = true;
    obtenerPacientesRecientes(6)
      .then((data) => { if (active && !recentDenied.current) setRecentPatients(data); })
      .catch((error) => {
        if (active) {
          setRecentPatients([]);
          setRecentError(patientRequestError(error));
        }
      })
      .finally(() => { if (active) setIsLoadingRecent(false); });
    return () => {
      active = false;
      contextVersion.current++;
      searchRequest.current++;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    eyesRef.current = eyes;
  }, [eyes]);

  useEffect(() => {
    return () => {
      selectionAbort.current?.abort();
      revokePreviewUrl(autoPreviewRef.current?.preview);
      confirmationsRef.current = {};
      Object.values(eyesRef.current).forEach((eyeState) => {
        revokePreviewUrl(eyeState.preview);
      });
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEyes((prev) => {
        if (!(["OD", "OI"] as EyeKey[]).some((eye) => prev[eye].confirmation === "CONFIRMADA" &&
            prev[eye].expiresAt && Date.parse(prev[eye].expiresAt) <= Date.now())) return prev;
        return Object.fromEntries((["OD", "OI"] as EyeKey[]).map((eye) => [eye,
          prev[eye].confirmation === "CONFIRMADA" && prev[eye].expiresAt &&
          Date.parse(prev[eye].expiresAt) <= Date.now()
            ? { ...prev[eye], confirmation: "EXPIRADA" } : prev[eye],
        ])) as Record<EyeKey, EyeState>;
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const resetUploadedEyes = () => {
    confirmationsRef.current = {};
    eyeGeneration.current.OD++;
    eyeGeneration.current.OI++;
    setEyes((prev) => {
      Object.values(prev).forEach((eyeState) => {
        revokePreviewUrl(eyeState.preview);
      });
      return { OD: { ...EMPTY_EYE }, OI: { ...EMPTY_EYE } };
    });
  };

  // ── Paso 1 ────────────────────────────────────────────────────────
  const loadRecentVisits = async (pacienteId: number) => {
    const version = contextVersion.current;
    setIsLoadingVisitas(true);
    setVisitasRecientes([]);
    try {
      const data = await obtenerVisitasPaciente(pacienteId);
      if (version !== contextVersion.current) return;
      const now = Date.now();
      const recent = (data || [])
        .filter((visit) => {
          if (visit.estado === "ANULADA") return false;
          if (Number(visit.tiene_diagnostico_ia) === 1) return false;
          const visitTime = visit.fecha_visita_origen === "UTC_VERIFICADO"
            ? clinicalInstant(visit.fecha_visita, visit.fecha_visita_origen)?.getTime() ?? null
            : null;
          if (visitTime === null) return false;
          const diffHours = (now - visitTime) / (1000 * 60 * 60);
          return diffHours >= 0 && diffHours <= RECENT_VISIT_HOURS;
        })
        .sort(
          (a, b) => compareVisitGroups(a, b),
        );
      setVisitasRecientes(recent);
    } catch {
      if (version !== contextVersion.current) return;
      setVisitasRecientes([]);
      toast({
        title: "No se pudieron cargar las visitas",
        description: "Puede crear una nueva visita para continuar.",
        variant: "warning",
      });
    } finally {
      if (version === contextVersion.current) setIsLoadingVisitas(false);
    }
  };

  const handleQueryChange = (value: string) => {
    const request = ++searchRequest.current;
    setQuery(value);
    setSearchResults([]);
    setSearchError(null);
    setHasSearched(false);
    setHasMoreSearchResults(false);
    setIsSearching(false);
    setIsLoadingMorePatients(false);
    if (selectedPatient) {
      resetProcessing();
      setSelectedPatient(null);
      setSelectedVisita(undefined);
      setVisitasRecientes([]);
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearchPage(1);
      setHasMoreSearchResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await buscarPacientesPaginado(value.trim(), {
          page: 1,
          perPage: PATIENT_SEARCH_PAGE_SIZE,
        });
        if (request !== searchRequest.current) return;
        setSearchResults(response.data);
        setHasSearched(true);
        setSearchPage(response.pagination.page);
        setHasMoreSearchResults(response.pagination.has_more);
      } catch (error) {
        if (request !== searchRequest.current) return;
        const failure = patientRequestError(error);
        setSearchResults([]);
        setHasMoreSearchResults(false);
        setSearchError(failure);
        if (failure.status === 403) {
          recentDenied.current = true;
          setRecentPatients([]);
          setRecentError(failure);
        }
      } finally {
        if (request === searchRequest.current) setIsSearching(false);
      }
    }, 400);
  };

  const loadMorePatients = async () => {
    const term = query.trim();
    if (term.length < 2 || isLoadingMorePatients || !hasMoreSearchResults) return;

    setIsLoadingMorePatients(true);
    const request = searchRequest.current;
    try {
      const nextPage = searchPage + 1;
      const response = await buscarPacientesPaginado(term, {
        page: nextPage,
        perPage: PATIENT_SEARCH_PAGE_SIZE,
      });
      if (request !== searchRequest.current) return;
      setSearchResults((prev) => [...prev, ...response.data]);
      setSearchPage(response.pagination.page);
      setHasMoreSearchResults(response.pagination.has_more);
    } catch (error) {
      if (request !== searchRequest.current) return;
      const failure = patientRequestError(error);
      setSearchResults([]);
      setHasMoreSearchResults(false);
      setSearchError(failure);
      if (failure.status === 403) {
        recentDenied.current = true;
        setRecentPatients([]);
        setRecentError(failure);
      }
    } finally {
      if (request === searchRequest.current) setIsLoadingMorePatients(false);
    }
  };

  const selectPatient = (p: PatientSearchResult) => {
    if (hasPendingAssociation()) return;
    resetProcessing();
    setSelectedPatient(p);
    searchRequest.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setIsLoadingMorePatients(false);
    setSearchError(null);
    setQuery(`${p.nombres} ${p.apellidos}`);
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setSelectedVisita(undefined);
    setVisitasRecientes([]);
    resetUploadedEyes();
    setValidatedEyes({});
    setValidationConflict(false);
    setFinalSelectionState({ OD: 0, OI: 0 });
    setComments({ OD: "", OI: "" });
    setCorrectionReasons({ OD: "", OI: "" });
    loadRecentVisits(p.id);
  };

  const clearPatient = () => {
    if (hasPendingAssociation()) return;
    resetProcessing();
    searchRequest.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setIsLoadingMorePatients(false);
    setSearchError(null);
    setHasSearched(false);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setSelectedVisita(undefined);
    setVisitasRecientes([]);
    resetUploadedEyes();
    setValidatedEyes({});
    setValidationConflict(false);
    setFinalSelectionState({ OD: 0, OI: 0 });
    setComments({ OD: "", OI: "" });
    setCorrectionReasons({ OD: "", OI: "" });
  };

  const selectVisita = (visita: DiagnosticoVisita | null) => {
    if (hasPendingAssociation()) return;
    resetProcessing();
    if (visita) rememberVisit(visita.visita_id);
    setSelectedVisita(visita);
    resetUploadedEyes();
    setValidatedEyes({});
    setValidationConflict(false);
    setFinalSelectionState({ OD: 0, OI: 0 });
    setComments({ OD: "", OI: "" });
    setCorrectionReasons({ OD: "", OI: "" });
  };

  // ── Paso 2 ────────────────────────────────────────────────────────
  const discardEye = (eye: EyeKey) => {
    const current = eyesRef.current[eye];
    eyeGeneration.current[eye]++;
    delete confirmationsRef.current[eye];
    if (autoPreview?.file === current.file && !autoPreviewRef.current) setAutoPreview(null);
    setEyes((prev) => {
      revokePreviewUrl(prev[eye].preview);
      return { ...prev, [eye]: { ...EMPTY_EYE } };
    });
    setEyeError(eye);
    setProcessingNotice(null);
  };

  const removeConfirmed = async (eye: EyeKey): Promise<boolean> => {
    const state = eyesRef.current[eye];
    if (!state.file) return true;
    if (!state.isExistingImage) { discardEye(eye); return true; }
    if (state.confirmation === "CONSUMIDA") {
      setEyeError(eye, "La imagen ya se utilizó en un diagnóstico.");
      return false;
    }
    const patientId = selectedPatient?.id;
    const confirmation = patientId && bound(eye, patientId, state);
    if (!confirmation || revokingRef.current[eye] || savingRef.current) {
      setEyeError(eye, "No se pudo quitar la imagen. Inténtalo nuevamente.");
      return false;
    }
    const version = contextVersion.current;
    const generation = eyeGeneration.current[eye];
    revokingRef.current[eye] = true;
    setBusyEyes((prev) => ({ ...prev, [eye]: true }));
    setEyeError(eye);
    const current = () => version === contextVersion.current && generation === eyeGeneration.current[eye] &&
      bound(eye, patientId, eyesRef.current[eye]) === confirmation;
    try {
      const currentStatus = await checkConfirmation(eye);
      if (!current()) return false;
      if (currentStatus === "CONSUMIDA") {
        setEyeError(eye, "La imagen ya se utilizó en un diagnóstico.");
        return false;
      }
      if (currentStatus === "EXPIRADA" || currentStatus === "REVOCADA") {
        discardEye(eye);
        return true;
      }
      if (currentStatus !== "CONFIRMADA") {
        setEyeError(eye, "No se pudo quitar la imagen. Inténtalo nuevamente.");
        return false;
      }
      try {
        const revoked = await revocarConfirmacionRetinografo(confirmation.token);
        if (!current()) return false;
        if (revoked?.estado !== "REVOCADA" || revoked.paciente_id !== patientId ||
            revoked.ojo_confirmado !== eyeName(eye)) throw new Error("Respuesta no verificable");
        discardEye(eye);
        return true;
      } catch {
        // El POST pudo completarse aunque se perdiera la respuesta: solo consultar, nunca repetir.
        const stateAfterFailure = await checkConfirmation(eye);
        if (!current()) return false;
        if (stateAfterFailure === "EXPIRADA" || stateAfterFailure === "REVOCADA") {
          discardEye(eye);
          return true;
        }
        setEyeError(eye, stateAfterFailure === "CONSUMIDA"
          ? "La imagen ya se utilizó en un diagnóstico."
          : "No se pudo quitar la imagen. Inténtalo nuevamente.");
        return false;
      }
    } finally {
      revokingRef.current[eye] = false;
      setBusyEyes((prev) => ({ ...prev, [eye]: false }));
    }
  };

  const handleFile = async (eye: EyeKey, file?: File) => {
    if (!file || savingRef.current || confirmingRef.current[eye] !== undefined || revokingRef.current[eye]) return;
    if (eyesRef.current[eye].isExistingImage && !await removeConfirmed(eye)) return;
    if (!eyesRef.current[eye].isExistingImage) discardEye(eye);
    if (autoPreviewRef.current?.image.ojo === eye) {
      previewRequest.current++;
      revokePreviewUrl(autoPreviewRef.current.preview);
      autoPreviewRef.current = null;
      setAutoPreview(null);
    }
    const version = contextVersion.current;
    const generation = eyeGeneration.current[eye];
    try {
      const preview = await convertToPreviewUrl(file);
      if (version !== contextVersion.current || generation !== eyeGeneration.current[eye]) { revokePreviewUrl(preview); return; }
      setEyes((prev) => {
        revokePreviewUrl(prev[eye].preview);
        return { ...prev, [eye]: { file, preview, isExistingImage: false } };
      });
    } catch {
      if (version !== contextVersion.current || generation !== eyeGeneration.current[eye]) return;
      setEyes((prev) => {
        revokePreviewUrl(prev[eye].preview);
        return { ...prev, [eye]: { file, preview: null, isExistingImage: false } };
      });
      toast({
        title: "Vista previa no disponible",
        description: "El archivo se procesará correctamente al guardar.",
      });
    }
  };

  const clearEye = async (eye: EyeKey) => {
    if (savingRef.current || confirmingRef.current[eye] !== undefined || revokingRef.current[eye]) return;
    await removeConfirmed(eye);
  };

  const autoSelectRetinographImages = async () => {
    if (autoSelectingRef.current || savingRef.current ||
        hasPendingAssociation()) return;
    if (!selectedPatient) {
      toast({
        title: "Seleccione un paciente",
        description: "Primero debe seleccionar el paciente a evaluar.",
        variant: "destructive",
      });
      return;
    }

    closeAutoSelection();
    autoSelectingRef.current = true;
    setIsAutoSelectingImages(true);
    const version = contextVersion.current;
    const controller = new AbortController();
    selectionAbort.current = controller;
    try {
      const selection = await obtenerSeleccionAutomaticaRetinografo(
        selectedPatient.id,
        controller.signal,
      );
      if (version !== contextVersion.current) return;
      if (selection.paciente_id !== selectedPatient.id) throw new Error("La selección no corresponde al paciente.");
      const candidates = (selection.candidatas ?? Object.values(selection.imagenes).filter(
        (image): image is RetinographAutoImage => !!image)).filter((image) =>
        image.tipo_imagen.toLowerCase() === "color" &&
        (image.ojo === "OD" || image.ojo === "OI") &&
        image.ojo_original === (image.ojo === "OD" ? "R" : "L"));
      if (candidates.length === 0) {
        toast({
          title: "Sin imágenes disponibles",
          description: "No se encontraron fotografías Color verificables para este paciente.",
        });
        return;
      }
      setAutoCandidates(candidates);
      setAutoModalOpen(true);
    } catch (err: any) {
      if (version !== contextVersion.current) return;
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 404) closeAutoSelection();
      toast({
        title: "No se pudo hacer la selección automática",
        description: status === 401 ? "Su sesión ya no es válida. Inicie sesión nuevamente."
          : status === 403 ? "No tiene autorización para consultar exportaciones del retinógrafo."
          : status === 404 ? "No se encontró el paciente o la exportación solicitada."
          : !err.response ? "No se completó la operación. Compruebe su conexión e inténtelo de nuevo."
          : "No se pudo completar la selección de exportaciones.",
        variant: "destructive",
      });
    } finally {
      autoSelectingRef.current = false;
      if (selectionAbort.current === controller) selectionAbort.current = null;
      if (version === contextVersion.current) setIsAutoSelectingImages(false);
    }
  };

  const closeAutoSelection = () => {
    if (hasPendingAssociation()) return;
    selectionAbort.current?.abort();
    previewRequest.current++;
    revokePreviewUrl(autoPreviewRef.current?.preview);
    autoPreviewRef.current = null;
    setAutoPreview(null);
    setAutoCandidates([]);
    setAutoFocusEye(null);
    setAutoModalOpen(false);
    setAutoPreviewLoading(false);
  };

  const selectAutoCandidate = async (image: RetinographAutoImage) => {
    if (!selectedPatient || !autoCandidates.includes(image) ||
        hasPendingAssociation()) return;
    selectionAbort.current?.abort();
    const controller = new AbortController();
    selectionAbort.current = controller;
    const request = ++previewRequest.current;
    const version = contextVersion.current;
    setAutoFocusEye(image.ojo);
    revokePreviewUrl(autoPreviewRef.current?.preview);
    autoPreviewRef.current = null;
    setAutoPreview(null);
    setEyeError(image.ojo);
    setProcessingNotice(null);
    const confirmed = eyesRef.current[image.ojo];
    if (confirmed.candidate?.filename === image.filename &&
        confirmed.confirmation === "CONFIRMADA" && confirmed.file && confirmed.preview) {
      setAutoPreview({ image, file: confirmed.file, preview: confirmed.preview });
      return;
    }
    setAutoPreviewLoading(true);
    try {
      const blob = await descargarImagenRetinografo(selectedPatient.id, image.filename, controller.signal);
      const file = new File([blob], image.filename, {
        type: image.mime_type || inferMimeType(image.filename), lastModified: Date.now(),
      });
      const preview = await convertToPreviewUrl(file);
      if (version !== contextVersion.current || request !== previewRequest.current || !autoModalOpen) {
        revokePreviewUrl(preview);
        return;
      }
      const chosen = { image, file, preview };
      autoPreviewRef.current = chosen;
      setAutoPreview(chosen);
    } catch (error) {
      if (version === contextVersion.current && request === previewRequest.current && !controller.signal.aborted) {
        toast({ title: "No se pudo previsualizar la fotografía", description: "Seleccione otra candidata.", variant: "destructive" });
      }
    } finally {
      if (request === previewRequest.current) setAutoPreviewLoading(false);
    }
  };

  const bound = (eye: EyeKey, patientId: number, state: EyeState) => {
    const confirmation = confirmationsRef.current[eye];
    return confirmation && confirmation.patientId === patientId && confirmation.eye === eye &&
      confirmation.file === state.file && confirmation.filename === state.candidate?.filename
      ? confirmation : null;
  };

  const confirmEye = async (eye: EyeKey) => {
    const patientId = selectedPatient?.id;
    const chosen = autoPreviewRef.current;
    if (!patientId || !chosen || !chosen.preview || !autoModalOpen ||
        confirmingRef.current[eye] !== undefined || revokingRef.current[eye] || isAutoSelectingImages ||
        chosen.image.ojo !== eye || chosen.image.ojo_original !== (eye === "OD" ? "R" : "L") ||
        chosen.file.name !== chosen.image.filename || !autoCandidates.includes(chosen.image)) return;
    const version = contextVersion.current;
    let generation = eyeGeneration.current[eye];
    confirmingRef.current[eye] = generation;
    const stillCurrent = () => version === contextVersion.current &&
      generation === eyeGeneration.current[eye] && autoPreviewRef.current === chosen;
    setIsAutoSelectingImages(true);
    setBusyEyes((prev) => ({ ...prev, [eye]: true }));
    setEyeError(eye);
    try {
      const hash = await sha256Blob(chosen.file);
      if (!stillCurrent()) return;
      if (eyesRef.current[eye].isExistingImage) {
        if (!await removeConfirmed(eye)) return;
        generation = eyeGeneration.current[eye];
        confirmingRef.current[eye] = generation;
        setBusyEyes((prev) => ({ ...prev, [eye]: true }));
        if (!stillCurrent()) return;
      }
      const registered = await registrarConfirmacionRetinografo({
        paciente_id: patientId, nombre_exportacion: chosen.image.filename,
        ojo_confirmado: eyeName(eye), sha256_previsualizacion: hash,
      });
      // No se permite cerrar, reemplazar ni cambiar de paciente mientras espera este POST.
      if (!stillCurrent()) return;
      if (registered.paciente_id !== patientId || registered.ojo_confirmado !== eyeName(eye) ||
          registered.estado !== "CONFIRMADA" || !/^[0-9a-f]{64}$/.test(registered.identificador) ||
          !registered.fecha_expiracion || !(Date.parse(registered.fecha_expiracion) > Date.now())) {
        throw new Error("Respuesta de confirmación no verificable.");
      }
      confirmationsRef.current[eye] = { token: registered.identificador, patientId, eye,
        filename: chosen.image.filename, file: chosen.file };
      eyeGeneration.current[eye]++;
      autoPreviewRef.current = null; // La vista previa pasa a pertenecer al formulario.
      setAutoPreview(chosen);
      setEyes((prev) => {
        revokePreviewUrl(prev[eye].preview);
        return { ...prev, [eye]: { file: chosen.file, preview: chosen.preview,
          isExistingImage: true, candidate: chosen.image, confirmation: "CONFIRMADA",
          hasConfirmation: true, expiresAt: registered.fecha_expiracion } };
      });
      setEyeError(eye);
    } catch (error) {
      if (!stillCurrent()) return;
      const code = statusCode(error);
      setEyeError(eye, code === 409 ? "La confirmación venció. Selecciona la fotografía nuevamente."
        : "No se pudo confirmar la fotografía.");
      // Tras una respuesta incierta no repetir la declaración sobre la misma vista previa.
      if (code === 409 || code === 500 || code === undefined &&
          !(error instanceof Error && error.message.startsWith("SHA-256"))) {
        revokePreviewUrl(chosen.preview);
        autoPreviewRef.current = null;
        setAutoPreview(null);
      }
    } finally {
      if (confirmingRef.current[eye] === generation) delete confirmingRef.current[eye];
      setBusyEyes((prev) => ({ ...prev, [eye]: false }));
      if (version === contextVersion.current) setIsAutoSelectingImages(false);
    }
  };

  const checkConfirmation = async (eye: EyeKey): Promise<EyeState["confirmation"] | null> => {
    const state = eyesRef.current[eye];
    const patientId = selectedPatient?.id;
    if (!patientId) return null;
    const confirmation = bound(eye, patientId, state);
    if (!confirmation) return null;
    const version = contextVersion.current;
    const generation = eyeGeneration.current[eye];
    const request = ++statusRequest.current[eye];
    try {
      const status = await consultarConfirmacionRetinografo(confirmation.token);
      if (version !== contextVersion.current || generation !== eyeGeneration.current[eye] ||
          request !== statusRequest.current[eye] ||
          bound(eye, patientId, eyesRef.current[eye]) !== confirmation) return null;
      if (status.paciente_id !== patientId || status.ojo_confirmado !== eyeName(eye)) throw new Error("Estado incompatible.");
      if (!status.fecha_expiracion || !Number.isFinite(Date.parse(status.fecha_expiracion))) throw new Error("Vigencia no verificable.");
      const next = status.estado === "CONFIRMADA" && (!status.vigente || status.expirada ||
        Date.parse(status.fecha_expiracion) <= Date.now())
        ? "EXPIRADA" : status.estado;
      setEyes((prev) => ({ ...prev, [eye]: { ...prev[eye], confirmation: next,
        expiresAt: status.fecha_expiracion } }));
      if (next === "CONFIRMADA") setEyeError(eye);
      if (next === "EXPIRADA") setEyeError(eye, "La confirmación venció. Selecciona la fotografía nuevamente.");
      if (next === "CONSUMIDA" && !resultsRef.current[eye]) {
        setEyeError(eye, "La imagen ya se utilizó en un diagnóstico.");
      }
      return next;
    } catch (error) {
      if (version !== contextVersion.current || generation !== eyeGeneration.current[eye] ||
          request !== statusRequest.current[eye] ||
          bound(eye, patientId, eyesRef.current[eye]) !== confirmation) return null;
      setEyes((prev) => ({ ...prev, [eye]: { ...prev[eye], confirmation: "incierta" } }));
      setEyeError(eye, "No se pudo comprobar la confirmación. Inténtalo nuevamente.");
      return null;
    }
  };

  const revokeConfirmation = async (eye: EyeKey) => {
    await clearEye(eye);
  };

  // ── Guardar y procesar ────────────────────────────────────────────
  const MIN_VALIDATE_MS = 0;
  const MIN_ANALYZE_MS = 500;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleSave = async () => {
    if (!selectedPatient || selectedVisita === undefined || savingRef.current) return;
    if (isAutoSelectingImages || confirmingRef.current.OD !== undefined ||
        confirmingRef.current.OI !== undefined || revokingRef.current.OD || revokingRef.current.OI) return;
    if (!confirmedVisitRef.current &&
        (eyeProcessing.OD === "incierto" || eyeProcessing.OI === "incierto")) {
      setProcessingNotice("No se confirmó el ID de visita. Consulte el historial antes de procesar otro ojo o repetir la solicitud.");
      return;
    }

    const eyesToProcess = (["OD", "OI"] as EyeKey[]).filter((eye) =>
      eyes[eye].file !== null && !resultsRef.current[eye] &&
      eyeProcessing[eye] !== "incierto" && eyeProcessing[eye] !== "procesando" &&
      (!eyes[eye].isExistingImage || (eyes[eye].confirmation === "CONFIRMADA" &&
        !!bound(eye, selectedPatient.id, eyes[eye]) && !!eyes[eye].expiresAt &&
        Date.parse(eyes[eye].expiresAt) > Date.now())));
    if (!eyesToProcess.length) {
      setProcessingNotice("No hay ojos habilitados. Es necesario confirmar por separado cada exportación; si un resultado es incierto, consulte su estado antes de continuar.");
      return;
    }
    const version = contextVersion.current;
    savingRef.current = true;
    const N = eyesToProcess.length;
    let completedSegments = 0;
    let hasError = false;

    setIsSaving(true);
    setModalPhase("validating");
    setValidationError(null);
    setModalProgress(0);

    // ── Loop 1: Validación (1 segmento por ojo) ──────────────────────
    let sharedVisitaId: number | undefined = confirmedVisitRef.current ?? selectedVisita?.visita_id;

    for (let i = 0; i < N; i++) {
      const eye = eyesToProcess[i];
      if (version !== contextVersion.current) break;
      setProcessingEye(eye);
      setEyeProcessing((prev) => ({ ...prev, [eye]: "procesando" }));
      const segmentStart = Date.now();
      let postStarted = false;

      try {
        const ojoDominante = eye === "OD" ? "Derecho" : "Izquierdo";
        let result: DiagnosisResult;
        if (eyes[eye].isExistingImage) {
          const confirmation = bound(eye, selectedPatient.id, eyes[eye]);
          if (!confirmation || await checkConfirmation(eye) !== "CONFIRMADA") {
            throw new Error("No se pudo comprobar la vigencia de la confirmación.");
          }
          if (version !== contextVersion.current ||
              bound(eye, selectedPatient.id, eyesRef.current[eye]) !== confirmation) break;
          postStarted = true;
          result = await crearDiagnosticoConfirmado(selectedPatient.id, ojoDominante,
            confirmation.token, sharedVisitaId);
        } else {
          postStarted = true;
          result = await crearDiagnostico(selectedPatient.id, ojoDominante,
            eyes[eye].file!, sharedVisitaId);
        }
        if (version !== contextVersion.current) break;
        if (eyes[eye].isExistingImage) {
          delete confirmationsRef.current[eye];
          setEyes((prev) => ({ ...prev, [eye]: { ...prev[eye], confirmation: "CONSUMIDA", hasConfirmation: false } }));
        }
        sharedVisitaId = result.visita_id ?? result.diagnostico_id ?? sharedVisitaId;
        if (sharedVisitaId) rememberVisit(sharedVisitaId);
        keepResults({ [eye]: result });
        setActiveEye(eye);

        // Garantizar tiempo mínimo de validación
        const elapsed = Date.now() - segmentStart;
        if (elapsed < MIN_VALIDATE_MS) {
          await sleep(MIN_VALIDATE_MS - elapsed);
        }

        completedSegments++;
        setModalProgress((completedSegments / (2 * N)) * 100);
      } catch (err: any) {
        if (version !== contextVersion.current) break;
        hasError = true;
        const status = err.response?.status;
        const uncertain = postStarted && (status === 409 || status === 500 || status === undefined);
        setEyeProcessing((prev) => ({ ...prev, [eye]: uncertain ? "incierto" : "error" }));
        let message = !postStarted && eyes[eye].isExistingImage
          ? "La confirmación no está vigente o no pudo comprobarse; no se inició inferencia. Consulte su estado."
          : processingFailure(status);
        if (eyes[eye].isExistingImage && postStarted) {
          if (status === 409) message = "La confirmación o la exportación cambió, o existe un conflicto clínico. Consulte su estado; no reenvíe automáticamente.";
          const current = await checkConfirmation(eye);
          if (version !== contextVersion.current) break;
          if (current === "CONSUMIDA") message += " Confirmación consumida; consulte el historial. La decisión médica no queda validada por ello.";
          else if (current === "EXPIRADA" || current === "REVOCADA") message += " La confirmación ya no puede utilizarse.";
          else if (!current) message += " No se pudo verificar el estado de la confirmación.";
        }
        if (uncertain) {
          if (sharedVisitaId) {
            const failure = await reconcile(sharedVisitaId, version);
            if (version !== contextVersion.current) break;
            if (failure) message += ` ${failure}`;
            else if (resultsRef.current[eye]) message = "Se consultó la visita: este ojo ya tiene un resultado registrado. No se repitió la inferencia.";
            else message += " La consulta no confirmó este ojo; verifique la visita antes de cualquier nuevo intento.";
          } else {
            message += " No se recibió un ID de visita para consultar; revise el historial clínico antes de intentar otra vez.";
          }
        }
        setProcessingNotice(`${eye}: ${message}`);
        toast({ title: `Procesamiento interrumpido: ${eye}`, description: message, variant: "destructive" });
        break;
      }
    }

    if (version !== contextVersion.current) { savingRef.current = false; return; }
    if (hasError) {
      setProcessingEye(null);
      setIsSaving(false);
      savingRef.current = false;
      setModalPhase("idle");
      if (Object.keys(resultsRef.current).length) setStep(3);
      return;
    }

    // ── Loop 2: Análisis (1 segmento por ojo, solo visual) ──────────
    setModalPhase("analyzing");

    for (let i = 0; i < N; i++) {
      const eye = eyesToProcess[i];
      setProcessingEye(eye);

      // La referencia Grad-CAM permanece como nombre de archivo; la vista
      // descargará el Blob con Bearer sin colocar credenciales en la URL.

      const segmentStart = Date.now();
      await sleep(MIN_ANALYZE_MS);
      if (version !== contextVersion.current) break;

      completedSegments++;
      setModalProgress((completedSegments / (2 * N)) * 100);
    }

    // ── Finalizar ────────────────────────────────────────────────────
    savingRef.current = false;
    if (version !== contextVersion.current) return;
    setProcessingEye(null);
    setModalPhase("idle");
    setIsSaving(false);

    setValidationConflict(false);
    setActiveEye(eyesToProcess[0]);

    toast({
      title: "Predicción IA guardada",
      description: "Los ojos procesados han sido guardados. La decisión médica sigue pendiente por ojo.",
    });
    setStep(3);
  };

  const dismissError = () => {
    if (failedEye) clearEye(failedEye);
    setFailedEye(null);
    setModalPhase("idle");
    setModalProgress(0);
    setValidationError(null);
    setProcessingEye(null);
    setIsSaving(false);
  };

  // ── Validación ────────────────────────────────────────────────────
  const setFinalSelection = (eye: EyeKey, value: number) => {
    setFinalSelectionState((prev) => ({ ...prev, [eye]: value }));
    const currentIa = results[eye]?.diagnostico_codigo;
    if (currentIa !== undefined && Number(value) === Number(currentIa)) {
      setCorrectionReasons((prev) => ({ ...prev, [eye]: "" }));
    }
  };

  const setComment = (eye: EyeKey, text: string) => {
    setComments((prev) => ({ ...prev, [eye]: text }));
  };

  const setCorrectionReason = (eye: EyeKey, text: string) => {
    setCorrectionReasons((prev) => ({ ...prev, [eye]: text }));
  };

  const needsCorrectionReason = (eye: EyeKey) => {
    const current = results[eye];
    if (!current) return false;
    return Number(finalSelection[eye]) !== Number(current.diagnostico_codigo);
  };

  const ensureCorrectionReason = (eye: EyeKey) => {
    if (!needsCorrectionReason(eye)) return true;
    if (correctionReasons[eye].trim()) return true;

    setActiveEye(eye);
    toast({
      title: "Motivo de corrección requerido",
      description: `Ingrese el motivo de corrección para ${
        eye === "OD" ? "ojo derecho (OD)" : "ojo izquierdo (OI)"
      }.`,
      variant: "destructive",
    });
    return false;
  };

  const validateDiagnosis = async (eye: EyeKey) => {
    const current = results[eye];
    if (!current || validatedEyes[eye] || validationConflict || isValidating) return;
    if (!ensureCorrectionReason(eye)) return;

    const detalleId = current.detalle_id;
    setIsValidating(true);
    try {
      const resp = await validarDetalleDiagnostico(
        detalleId,
        finalSelection[eye],
        comments[eye],
        correctionReasons[eye],
      );
      if (resp.success && (resp.data?.estado_validacion === "APROBADO" || resp.data?.estado_validacion === "CORREGIDO")) {
        setValidatedEyes((previous) => ({ ...previous, [eye]: resp.data.estado_validacion }));
        setEyeProcessing((previous) => ({ ...previous, [eye]: "validado" }));
        toast({ title: "Validación guardada", description: resp.message });
      } else {
        toast({
          title: "Error",
          description: resp.message || "Error al validar.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: validationFailure(err, eye),
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  /** Valida todos los diagnósticos disponibles (OD/OI) y redirige al dashboard si todo OK */
  const validateAll = async () => {
    if (validationConflict || isValidating) return;
    const availableEyes = (Object.keys(results) as EyeKey[]).filter(
      (e) => !!results[e] && !validatedEyes[e],
    );
    if (availableEyes.length === 0) return;
    setIsValidating(true);
    let hasError = false;

    for (const eye of availableEyes) {
      const current = results[eye];
      if (!current) continue;
      if (!ensureCorrectionReason(eye)) {
        hasError = true;
        break;
      }

      const detalleId = current.detalle_id;
      try {
        const resp = await validarDetalleDiagnostico(
          detalleId,
          finalSelection[eye],
          comments[eye],
          correctionReasons[eye],
        );
        if (resp.success && (resp.data?.estado_validacion === "APROBADO" || resp.data?.estado_validacion === "CORREGIDO")) {
          setValidatedEyes((previous) => ({ ...previous, [eye]: resp.data.estado_validacion }));
          setEyeProcessing((previous) => ({ ...previous, [eye]: "validado" }));
        } else {
          hasError = true;
          toast({
            title: "Error",
            description: resp.message || `Error al validar ${eye}`,
            variant: "destructive",
          });
          break;
        }
      } catch (err: any) {
        hasError = true;
        toast({
          title: "Error",
          description: validationFailure(err, eye),
          variant: "destructive",
        });
        break;
      }
    }

    setIsValidating(false);

    if (!hasError) {
      toast({
        title: "Validaciones guardadas",
        description: "Todos los diagnósticos fueron validados correctamente.",
      });
      // Navegar al dashboard
      try {
        navigate("/dashboard");
      } catch {}
    }
  };

  // ── Navegación ────────────────────────────────────────────────────
  const canNext =
    (step === 1 && selectedPatient !== null && selectedVisita !== undefined) ||
    (step === 2 && (eyes.OD.file !== null || eyes.OI.file !== null) &&
      !isAutoSelectingImages && !isSaving && !busyEyes.OD && !busyEyes.OI && (["OD", "OI"] as EyeKey[]).some((eye) =>
        !!eyes[eye].file && !resultsRef.current[eye] && eyeProcessing[eye] !== "incierto" &&
        (!eyes[eye].isExistingImage || (eyes[eye].confirmation === "CONFIRMADA" &&
          !!selectedPatient && !!bound(eye, selectedPatient.id, eyes[eye]) &&
          !!eyes[eye].expiresAt && Date.parse(eyes[eye].expiresAt) > Date.now()))));

  const goNext = () => {
    if (step === 2) {
      handleSave();
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const goBack = () => { if (!hasPendingAssociation()) setStep((s) => Math.max(1, s - 1)); };

  const resetAll = () => {
    if (hasPendingAssociation()) return;
    resetProcessing();
    searchRequest.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsSearching(false);
    setIsLoadingMorePatients(false);
    setSearchError(null);
    setHasSearched(false);
    setStep(1);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setSelectedVisita(undefined);
    setVisitasRecientes([]);
    resetUploadedEyes();
    setValidatedEyes({});
    setValidationConflict(false);
    setFinalSelectionState({ OD: 0, OI: 0 });
    setComments({ OD: "", OI: "" });
    setCorrectionReasons({ OD: "", OI: "" });
  };

  return {
    step,
    goNext,
    goBack,
    resetAll,
    canNext,
    isSaving,
    processingEye,
    modalPhase,
    modalProgress,
    validationError,
    dismissError,
    // Validación
    finalSelection,
    setFinalSelection,
    comments,
    setComment,
    correctionReasons,
    setCorrectionReason,
    validateDiagnosis,
    validateAll,
    isValidating,
    validatedEyes,
    validationConflict,
    query,
    searchResults,
    recentPatients,
    selectedPatient,
    isSearching,
    isLoadingMorePatients,
    hasMoreSearchResults,
    searchError,
    recentError,
    hasSearched,
    isLoadingRecent,
    visitasRecientes,
    selectedVisita,
    isLoadingVisitas,
    isAutoSelectingImages,
    busyEyes,
    eyeActionError,
    autoModalOpen,
    autoCandidates,
    autoPreview,
    autoFocusEye,
    autoPreviewLoading,
    handleQueryChange,
    loadMorePatients,
    selectPatient,
    selectVisita,
    clearPatient,
    eyes,
    handleFile,
    autoSelectRetinographImages,
    selectAutoCandidate,
    closeAutoSelection,
    clearEye,
    confirmEye,
    checkConfirmation,
    revokeConfirmation,
    results,
    eyeProcessing,
    confirmedVisitId,
    processingNotice,
    reconcileResults,
    activeEye,
    setActiveEye,
  };
}
