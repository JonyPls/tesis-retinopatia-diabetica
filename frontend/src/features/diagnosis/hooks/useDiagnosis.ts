import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl } from "@/lib/imageUtils";
import {
  buscarPacientesPaginado,
  obtenerPacientesRecientes,
  PatientSearchResult,
} from "@/features/patients/api/patientService";
import {
  crearDiagnostico,
  DiagnosisResult,
  descargarImagenRetinografo,
  obtenerSeleccionAutomaticaRetinografo,
  validarDetalleDiagnostico,
} from "@/features/diagnosis/api/diagnosisService";
import { useAuthStore } from "@/features/auth/store/authStore";
import { EyeKey, EyeState, DiagnosisHook } from "../types";

const EMPTY_EYE: EyeState = { file: null, preview: null, isExistingImage: false };
const PATIENT_SEARCH_PAGE_SIZE = 10;

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Paso 2
  const [eyes, setEyes] = useState<Record<EyeKey, EyeState>>({
    OD: { ...EMPTY_EYE },
    OI: { ...EMPTY_EYE },
  });
  const [isAutoSelectingImages, setIsAutoSelectingImages] = useState(false);

  // Paso 3
  const [results, setResults] = useState<
    Partial<Record<EyeKey, DiagnosisResult>>
  >({});
  const [activeEye, setActiveEye] = useState<EyeKey>("OD");
  // Validación
  const [finalSelection, setFinalSelectionState] = useState<
    Record<EyeKey, number>
  >({ OD: 0, OI: 0 });
  const [comments, setComments] = useState<Record<EyeKey, string>>({
    OD: "",
    OI: "",
  });
  const [isValidating, setIsValidating] = useState(false);

  const navigate = useNavigate();

  // Cargar recientes al montar
  useEffect(() => {
    obtenerPacientesRecientes(6)
      .then(setRecentPatients)
      .catch(() => {});
  }, []);

  // ── Paso 1 ────────────────────────────────────────────────────────
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (selectedPatient) setSelectedPatient(null);
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
        setSearchResults(response.data);
        setSearchPage(response.pagination.page);
        setHasMoreSearchResults(response.pagination.has_more);
      } catch {
        toast({
          title: "Error",
          description: "No se pudo conectar con el servidor.",
          variant: "destructive",
        });
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const loadMorePatients = async () => {
    const term = query.trim();
    if (term.length < 2 || isLoadingMorePatients || !hasMoreSearchResults) return;

    setIsLoadingMorePatients(true);
    try {
      const nextPage = searchPage + 1;
      const response = await buscarPacientesPaginado(term, {
        page: nextPage,
        perPage: PATIENT_SEARCH_PAGE_SIZE,
      });
      setSearchResults((prev) => [...prev, ...response.data]);
      setSearchPage(response.pagination.page);
      setHasMoreSearchResults(response.pagination.has_more);
    } catch {
      toast({
        title: "Error",
        description: "No se pudieron cargar más pacientes.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingMorePatients(false);
    }
  };

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setQuery(`${p.nombres} ${p.apellidos}`);
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setEyes({ OD: { ...EMPTY_EYE }, OI: { ...EMPTY_EYE } });
    setResults({});
    setFinalSelectionState({ OD: 0, OI: 0 });
    setComments({ OD: "", OI: "" });
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setEyes({ OD: { ...EMPTY_EYE }, OI: { ...EMPTY_EYE } });
    setResults({});
  };

  // ── Paso 2 ────────────────────────────────────────────────────────
  const handleFile = async (eye: EyeKey, file?: File) => {
    if (!file) return;
    try {
      const preview = await convertToPreviewUrl(file);
      setEyes((prev) => ({ ...prev, [eye]: { file, preview } }));
    } catch {
      setEyes((prev) => ({ ...prev, [eye]: { file, preview: null } }));
      toast({
        title: "Vista previa no disponible",
        description: "El archivo se procesará correctamente al guardar.",
      });
    }
  };

  const clearEye = (eye: EyeKey) => {
    setEyes((prev) => ({ ...prev, [eye]: { ...EMPTY_EYE } }));
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

      setEyes((prev) => {
        const next = { ...prev };
        loadedEntries.forEach(([eye, state]) => {
          next[eye] = state;
        });
        return next;
      });
      setResults({});
      setFinalSelectionState({ OD: 0, OI: 0 });
      setComments({ OD: "", OI: "" });

      toast({
        title: "Selección automática lista",
        description: `Se cargó ${availableEyes.length} imagen${
          availableEyes.length === 1 ? "" : "es"
        } desde el retinógrafo.`,
      });
    } catch (err: any) {
      toast({
        title: "No se pudo hacer la selección automática",
        description:
          err.response?.data?.message ||
          "Revise que la carpeta del retinógrafo exista y tenga imágenes válidas.",
        variant: "destructive",
      });
    } finally {
      setIsAutoSelectingImages(false);
    }
  };

  // ── Guardar y procesar ────────────────────────────────────────────
  const MIN_VALIDATE_MS = 1500;
  const MIN_ANALYZE_MS = 2000;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleSave = async () => {
    if (!selectedPatient) return;

    const eyesToProcess = (["OD", "OI"] as EyeKey[]).filter((eye) => eyes[eye].file !== null);

    const newResults: Partial<Record<EyeKey, DiagnosisResult>> = {};
    const N = eyesToProcess.length;
    let completedSegments = 0;
    let hasError = false;

    setIsSaving(true);
    setModalPhase("validating");
    setValidationError(null);
    setModalProgress(0);

    // ── Loop 1: Validación (1 segmento por ojo) ──────────────────────
    let sharedVisitaId: number | undefined;

    for (let i = 0; i < N; i++) {
      const eye = eyesToProcess[i];
      setProcessingEye(eye);
      const segmentStart = Date.now();

      try {
        const ojoDominante = eye === "OD" ? "Derecho" : "Izquierdo";
        const result = await crearDiagnostico(
          selectedPatient.id,
          ojoDominante,
          eyes[eye].file!,
          sharedVisitaId,
        );

        if (i === 0) {
          sharedVisitaId = result.visita_id ?? result.diagnostico_id;
        }

        // Garantizar tiempo mínimo de validación
        const elapsed = Date.now() - segmentStart;
        if (elapsed < MIN_VALIDATE_MS) {
          await sleep(MIN_VALIDATE_MS - elapsed);
        }

        newResults[eye] = result;
        completedSegments++;
        setModalProgress((completedSegments / (2 * N)) * 100);
      } catch (err: any) {
        hasError = true;
        const status = err.response?.status;
        const msg = err.response?.data?.message || "Error inesperado.";

        if (status === 400 || status === 422) {
          setFailedEye(eye);
          setValidationError(msg);
          setModalPhase("error");
        } else {
          toast({
            title: `Error al procesar ${eye === "OD" ? "Ojo Derecho" : "Ojo Izquierdo"}`,
            description: msg,
            variant: "destructive",
          });
          setModalPhase("idle");
          setIsSaving(false);
        }
        break;
      }
    }

    if (hasError) return;

    // ── Loop 2: Análisis (1 segmento por ojo, solo visual) ──────────
    setModalPhase("analyzing");

    for (let i = 0; i < N; i++) {
      const eye = eyesToProcess[i];
      setProcessingEye(eye);

      // Construir URL Grad-CAM
      const result = newResults[eye]!;
      const BACKEND_URL =
        import.meta.env.VITE_API_URL || "http://localhost:5000";
      if (result.gradcam_url) {
        const token = useAuthStore.getState().token;
        result.gradcam_url = `${BACKEND_URL}/uploads/retinas/${result.gradcam_url}?token=${token}`;
      }

      const segmentStart = Date.now();
      await sleep(MIN_ANALYZE_MS);

      completedSegments++;
      setModalProgress((completedSegments / (2 * N)) * 100);
    }

    // ── Finalizar ────────────────────────────────────────────────────
    setProcessingEye(null);
    setModalPhase("idle");
    setIsSaving(false);

    const init: Partial<Record<EyeKey, number>> = {};

    (Object.keys(newResults) as EyeKey[]).forEach((e) => {
      init[e] = newResults[e]!.diagnostico_codigo;
    });

    setResults(newResults);
    setActiveEye(eyesToProcess[0]);
    setFinalSelectionState((prev) => ({ ...prev, ...init }));
    setComments({ OD: "", OI: "" });

    toast({
      title: "Diagnóstico guardado",
      description: "Los resultados han sido guardados correctamente.",
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
  };

  const setComment = (eye: EyeKey, text: string) => {
    setComments((prev) => ({ ...prev, [eye]: text }));
  };

  const validateDiagnosis = async (eye: EyeKey) => {
    const current = results[eye];
    if (!current) return;
    const detalleId = current.detalle_id;
    setIsValidating(true);
    try {
      const resp = await validarDetalleDiagnostico(
        detalleId,
        finalSelection[eye],
        comments[eye],
      );
      if (resp.success) {
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
        description: err?.message || "Error al validar.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  /** Valida todos los diagnósticos disponibles (OD/OI) y redirige al dashboard si todo OK */
  const validateAll = async () => {
    const availableEyes = (Object.keys(results) as EyeKey[]).filter(
      (e) => !!results[e],
    );
    if (availableEyes.length === 0) return;
    setIsValidating(true);
    let hasError = false;

    for (const eye of availableEyes) {
      const current = results[eye];
      if (!current) continue;
      const detalleId = current.detalle_id;
      try {
        const resp = await validarDetalleDiagnostico(
          detalleId,
          finalSelection[eye],
          comments[eye],
        );
        if (!resp.success) {
          hasError = true;
          toast({
            title: "Error",
            description: resp.message || `Error al validar ${eye}`,
            variant: "destructive",
          });
        }
      } catch (err: any) {
        hasError = true;
        toast({
          title: "Error",
          description: err?.message || `Error al validar ${eye}`,
          variant: "destructive",
        });
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
    (step === 1 && selectedPatient !== null) ||
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
    setStep(1);
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSearchPage(1);
    setHasMoreSearchResults(false);
    setEyes({ OD: { ...EMPTY_EYE }, OI: { ...EMPTY_EYE } });
    setResults({});
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
    validateDiagnosis,
    validateAll,
    isValidating,
    query,
    searchResults,
    recentPatients,
    selectedPatient,
    isSearching,
    isLoadingMorePatients,
    hasMoreSearchResults,
    isAutoSelectingImages,
    handleQueryChange,
    loadMorePatients,
    selectPatient,
    clearPatient,
    eyes,
    handleFile,
    autoSelectRetinographImages,
    clearEye,
    results,
    activeEye,
    setActiveEye,
  };
}
