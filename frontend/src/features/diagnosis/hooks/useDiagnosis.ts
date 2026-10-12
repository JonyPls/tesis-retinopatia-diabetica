import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl, revokePreviewUrl } from "@/lib/imageUtils";
import {
  buscarPacientesPaginado,
  DiagnosticoVisita,
  obtenerPacientesRecientes,
  obtenerVisitasPaciente,
  PatientSearchResult,
} from "@/features/patients/api/patientService";
import {
  crearDiagnostico,
  DiagnosisResult,
  obtenerDetallesVisita,
  resultadoPersistido,
  descargarImagenRetinografo,
  obtenerSeleccionAutomaticaRetinografo,
  validarDetalleDiagnostico,
} from "@/features/diagnosis/api/diagnosisService";
import { patientRequestError, PatientRequestError } from "@/features/patients/patientAccess";
import { EyeKey, EyeState, EyeProcessingStatus, DiagnosisHook } from "../types";

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
  const [isAutoSelectingImages, setIsAutoSelectingImages] = useState(false);

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
    contextVersion.current++;
    confirmedVisitRef.current = null;
    resultsRef.current = {};
    setConfirmedVisitId(null);
    setProcessingNotice(null);
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
      Object.values(eyesRef.current).forEach((eyeState) => {
        revokePreviewUrl(eyeState.preview);
      });
    };
  }, []);

  const resetUploadedEyes = () => {
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
          const visitTime = new Date(visit.fecha_visita).getTime();
          if (Number.isNaN(visitTime)) return false;
          const diffHours = (now - visitTime) / (1000 * 60 * 60);
          return diffHours >= 0 && diffHours <= RECENT_VISIT_HOURS;
        })
        .sort(
          (a, b) =>
            new Date(b.fecha_visita).getTime() -
            new Date(a.fecha_visita).getTime(),
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
  const handleFile = async (eye: EyeKey, file?: File) => {
    if (!file) return;
    const version = contextVersion.current;
    try {
      const preview = await convertToPreviewUrl(file);
      if (version !== contextVersion.current) { revokePreviewUrl(preview); return; }
      setEyes((prev) => {
        revokePreviewUrl(prev[eye].preview);
        return { ...prev, [eye]: { file, preview, isExistingImage: false } };
      });
    } catch {
      if (version !== contextVersion.current) return;
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

  const clearEye = (eye: EyeKey) => {
    setEyes((prev) => {
      revokePreviewUrl(prev[eye].preview);
      return { ...prev, [eye]: { ...EMPTY_EYE } };
    });
  };

  const autoSelectRetinographImages = async () => {
    if (!selectedPatient) {
      toast({
        title: "Seleccione un paciente",
        description: "Primero debe seleccionar el paciente a evaluar.",
        variant: "destructive",
      });
      return;
    }

    setIsAutoSelectingImages(true);
    const version = contextVersion.current;
    try {
      const selection = await obtenerSeleccionAutomaticaRetinografo(
        selectedPatient.id,
      );
      const availableEyes = (["OD", "OI"] as EyeKey[]).filter(
        (eye) => selection.imagenes[eye],
      );

      if (availableEyes.length === 0) {
        toast({
          title: "Sin imágenes disponibles",
          description:
            "No se encontraron imágenes exportadas para el documento del paciente.",
        });
        return;
      }

      const loadedEntries = await Promise.all(
        availableEyes.map(async (eye) => {
          const image = selection.imagenes[eye]!;
          const blob = await descargarImagenRetinografo(
            selectedPatient.id,
            image.filename,
          );
          const file = new File([blob], image.filename, {
            type: image.mime_type || inferMimeType(image.filename),
            lastModified: new Date(image.fecha_exportacion).getTime(),
          });

          let preview: string | null = null;
          try {
            preview = await convertToPreviewUrl(file);
          } catch {
            preview = null;
          }

          return [eye, { file, preview, isExistingImage: false }] as const;
        }),
      );

      if (version !== contextVersion.current) {
        loadedEntries.forEach(([, state]) => revokePreviewUrl(state.preview));
        return;
      }

      setEyes((prev) => {
        const next = { ...prev };
        loadedEntries.forEach(([eye, state]) => {
          revokePreviewUrl(prev[eye].preview);
          next[eye] = state;
        });
        return next;
      });
      // Cambiar archivos nunca borra resultados confirmados de la visita.
      setValidationConflict(false);
      setFinalSelectionState({ OD: 0, OI: 0 });
      setComments({ OD: "", OI: "" });
      setCorrectionReasons({ OD: "", OI: "" });

      toast({
        title: "Selección automática lista",
        description: `Se cargó ${availableEyes.length} imagen${
          availableEyes.length === 1 ? "" : "es"
        } desde el retinógrafo.`,
      });
    } catch (err: any) {
      if (version !== contextVersion.current) return;
      toast({
        title: "No se pudo hacer la selección automática",
        description:
          err.response?.data?.message ||
          "Revise que la carpeta del retinógrafo exista y tenga imágenes válidas.",
        variant: "destructive",
      });
    } finally {
      if (version === contextVersion.current) setIsAutoSelectingImages(false);
    }
  };

  // ── Guardar y procesar ────────────────────────────────────────────
  const MIN_VALIDATE_MS = 0;
  const MIN_ANALYZE_MS = 500;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleSave = async () => {
    if (!selectedPatient || selectedVisita === undefined || savingRef.current) return;
    if (!confirmedVisitRef.current &&
        (eyeProcessing.OD === "incierto" || eyeProcessing.OI === "incierto")) {
      setProcessingNotice("No se confirmó el ID de visita. Consulte el historial antes de procesar otro ojo o repetir la solicitud.");
      return;
    }

    const eyesToProcess = (["OD", "OI"] as EyeKey[]).filter((eye) =>
      eyes[eye].file !== null && !resultsRef.current[eye] &&
      eyeProcessing[eye] !== "incierto" && eyeProcessing[eye] !== "procesando");
    if (!eyesToProcess.length) {
      setProcessingNotice("No hay ojos sin procesar. Si un resultado es incierto, consulte la visita antes de continuar.");
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

      try {
        const ojoDominante = eye === "OD" ? "Derecho" : "Izquierdo";
        const result = await crearDiagnostico(
          selectedPatient.id,
          ojoDominante,
          eyes[eye].file!,
          sharedVisitaId,
        );
        if (version !== contextVersion.current) break;
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
        const uncertain = status === 409 || status === 500 || status === undefined;
        setEyeProcessing((prev) => ({ ...prev, [eye]: uncertain ? "incierto" : "error" }));
        let message = processingFailure(status);
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
    (step === 2 && (eyes.OD.file !== null || eyes.OI.file !== null));

  const goNext = () => {
    if (step === 2) {
      handleSave();
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const resetAll = () => {
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
    handleQueryChange,
    loadMorePatients,
    selectPatient,
    selectVisita,
    clearPatient,
    eyes,
    handleFile,
    autoSelectRetinographImages,
    clearEye,
    results,
    eyeProcessing,
    confirmedVisitId,
    processingNotice,
    reconcileResults,
    activeEye,
    setActiveEye,
  };
}
