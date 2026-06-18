import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl } from "@/lib/imageUtils";
import {
  buscarPacientes,
  obtenerPacientesRecientes,
  obtenerDiagnosticosPaciente,
  DiagnosticoVisita,
  PatientSearchResult,
} from "@/services/patientService";
import {
  crearDiagnostico,
  DiagnosisResult,
  DetalleDiagnosticoExistente,
  obtenerDetallesDiagnostico,
  validarDetalleDiagnostico,
} from "@/services/diagnosisService";
import { useAuthStore } from "@/store/authStore";
import { EyeKey, EyeState, DiagnosisHook } from "../types";

const EMPTY_EYE: EyeState = { file: null, preview: null, isExistingImage: false };

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visita selector (paso 1)
  const [visitas, setVisitas] = useState<DiagnosticoVisita[]>([]);
  const [selectedVisita, setSelectedVisita] = useState<DiagnosticoVisita | null | undefined>(undefined);
  const [hasMoreVisitas, setHasMoreVisitas] = useState(false);
  const [visitasExpandidas, setVisitasExpandidas] = useState(false);
  const [isLoadingVisitas, setIsLoadingVisitas] = useState(false);
  const maxVisitas = 2;

  // Modal diagnóstico IA existente (Escenario B)
  const [showExistingDiagnosisModal, setShowExistingDiagnosisModal] = useState(false);
  const [existingDetalles, setExistingDetalles] = useState<DetalleDiagnosticoExistente[]>([]);
  const [isCheckingDiagnosis, setIsCheckingDiagnosis] = useState(false);

  // ── Helpers: reconstruir resultados y ojos desde detalles existentes ──
  const construirEyesDesdeDetalles = useCallback((): Record<EyeKey, EyeState> => {
    const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const token = useAuthStore.getState().token;
    const newEyes: Record<EyeKey, EyeState> = {
      OD: { ...EMPTY_EYE },
      OI: { ...EMPTY_EYE },
    };
    existingDetalles.forEach((d) => {
      const eyeKey = d.ojo;
      const imagenUrl = `${BACKEND_URL}/uploads/retinas/${d.imagen_url}?token=${token}`;
      newEyes[eyeKey] = { file: new File([], "existing"), preview: imagenUrl, isExistingImage: true };
    });
    return newEyes;
  }, [existingDetalles]);

  const cargarResultadosExistentes = useCallback(() => {
    const newResults: Partial<Record<EyeKey, DiagnosisResult>> = {};
    const newFinalSelection: Record<EyeKey, number> = { OD: 0, OI: 0 };
    const newComments: Record<EyeKey, string> = { OD: "", OI: "" };

    const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const token = useAuthStore.getState().token;

    existingDetalles.forEach((d) => {
      const eyeKey = d.ojo;
      let gradcamUrl: string | undefined;
      if (d.gradcam_url) {
        gradcamUrl = `${BACKEND_URL}/uploads/retinas/${d.gradcam_url}?token=${token}`;
      }

      newResults[eyeKey] = {
        diagnostico_id: selectedVisita!.diagnostico_id,
        detalle_id: d.detalle_id,
        diagnostico_codigo: d.resultado_ia,
        diagnostico_texto: d.diagnostico_texto,
        confianza_general: d.confianza_general,
        probabilidades_detalle: d.probabilidades_detalle || {},
        mensaje: "Resultado cargado de diagnóstico previo.",
        gradcam_url: gradcamUrl,
      };

      newFinalSelection[eyeKey] = d.diagnostico_final ?? d.resultado_ia;
      newComments[eyeKey] = d.comentario_medico || "";
    });

    setResults(newResults);
    setFinalSelectionState(newFinalSelection);
    setComments(newComments);
    const firstEye = (Object.keys(newResults) as EyeKey[])[0];
    if (firstEye) setActiveEye(firstEye);
  }, [existingDetalles, selectedVisita]);

  // Paso 2
  const [eyes, setEyes] = useState<Record<EyeKey, EyeState>>({
    OD: { ...EMPTY_EYE },
    OI: { ...EMPTY_EYE },
  });

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
    obtenerPacientesRecientes()
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
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await buscarPacientes(value.trim());
        setSearchResults(data);
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

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setQuery(`${p.nombres} ${p.apellidos}`);
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    loadVisitas(p.id);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setQuery("");
    setSearchResults([]);
    setSelectedVisita(undefined);
    setVisitas([]);
    setHasMoreVisitas(false);
    setVisitasExpandidas(false);
  };

  const loadVisitas = async (pacienteId: number) => {
    setIsLoadingVisitas(true);
    setVisitasExpandidas(false);
    try {
      const data = await obtenerDiagnosticosPaciente(pacienteId);
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      setVisitas([]);
    } finally {
      setIsLoadingVisitas(false);
    }
  };

  const selectVisita = async (v: DiagnosticoVisita | null) => {
    setSelectedVisita(v);
    setShowExistingDiagnosisModal(false);
    setExistingDetalles([]);

    if (v && v.diagnostico_id) {
      setIsCheckingDiagnosis(true);
      try {
        const detalles = await obtenerDetallesDiagnostico(v.diagnostico_id);
        if (detalles.length > 0) {
          setExistingDetalles(detalles);
          setShowExistingDiagnosisModal(true);
        }
      } catch {
        // Silently proceed — if the endpoint fails, treat as no IA diagnosis
      } finally {
        setIsCheckingDiagnosis(false);
      }
    }
  };

  const closeExistingDiagnosisModal = () => {
    setShowExistingDiagnosisModal(false);
    setExistingDetalles([]);
    setSelectedVisita(undefined);
  };

  const goToStep2FromExisting = () => {
    setShowExistingDiagnosisModal(false);
    setEyes(construirEyesDesdeDetalles());
    setStep(2);
  };

  const goToStep3FromExisting = () => {
    setShowExistingDiagnosisModal(false);
    cargarResultadosExistentes();
    setEyes(construirEyesDesdeDetalles());
    setStep(3);
  };

  const verMasVisitas = async () => {
    if (!selectedPatient) return;
    setVisitasExpandidas(true);
    try {
      const data = await obtenerDiagnosticosPaciente(selectedPatient.id);
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setVisitas(sorted);
      setHasMoreVisitas(false);
    } catch {
      setVisitasExpandidas(false);
    }
  };

  const verMenosVisitas = async () => {
    if (!selectedPatient) return;
    setVisitasExpandidas(false);
    try {
      const data = await obtenerDiagnosticosPaciente(selectedPatient.id);
      const sorted = (data || []).sort(
        (a, b) => new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
      );
      setHasMoreVisitas(sorted.length > maxVisitas);
      setVisitas(sorted.slice(0, maxVisitas));
    } catch {
      // ignore
    }
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

  // ── Guardar y procesar ────────────────────────────────────────────
  const MIN_VALIDATE_MS = 1500;
  const MIN_ANALYZE_MS = 2000;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const handleSave = async () => {
    if (!selectedPatient) return;

    const eyesToProcess = (["OD", "OI"] as EyeKey[]).filter(
      (eye) => eyes[eye].file !== null && !eyes[eye].isExistingImage,
    );

    // No new images to process — load existing results
    if (eyesToProcess.length === 0) {
      cargarResultadosExistentes();
      setEyes(construirEyesDesdeDetalles());
      toast({
        title: "Sin cambios",
        description: "No se detectaron nuevas imágenes. Mostrando resultados previos.",
      });
      setStep(3);
      return;
    }

    const newResults: Partial<Record<EyeKey, DiagnosisResult>> = {};
    const N = eyesToProcess.length;
    let completedSegments = 0;
    let hasError = false;

    setIsSaving(true);
    setModalPhase("validating");
    setValidationError(null);
    setModalProgress(0);

    // ── Loop 1: Validación (1 segmento por ojo) ──────────────────────
    let sharedDiagnosticoId: number | undefined = selectedVisita?.diagnostico_id;

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
          sharedDiagnosticoId,
        );

        if (i === 0) {
          sharedDiagnosticoId = result.diagnostico_id;
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

    // Merge existing detalle results for eyes that were NOT re-processed
    const reprocessedEyes = new Set(eyesToProcess);
    const init: Partial<Record<EyeKey, number>> = {};
    const mergedComments: Record<EyeKey, string> = { OD: "", OI: "" };

    (Object.keys(newResults) as EyeKey[]).forEach((e) => {
      init[e] = newResults[e]!.diagnostico_codigo;
    });

    const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const token = useAuthStore.getState().token;

    existingDetalles.forEach((d) => {
      const eyeKey = d.ojo;
      if (!reprocessedEyes.has(eyeKey)) {
        let gradcamUrl: string | undefined;
        if (d.gradcam_url) {
          gradcamUrl = `${BACKEND_URL}/uploads/retinas/${d.gradcam_url}?token=${token}`;
        }
        newResults[eyeKey] = {
          diagnostico_id: selectedVisita!.diagnostico_id,
          detalle_id: d.detalle_id,
          diagnostico_codigo: d.resultado_ia,
          diagnostico_texto: d.diagnostico_texto,
          confianza_general: d.confianza_general,
          probabilidades_detalle: d.probabilidades_detalle || {},
          mensaje: "Resultado cargado de diagnóstico previo.",
          gradcam_url: gradcamUrl,
        };
        init[eyeKey] = d.diagnostico_final ?? d.resultado_ia;
        mergedComments[eyeKey] = d.comentario_medico || "";
      }
    });

    setResults(newResults);
    setActiveEye(eyesToProcess[0]);
    setFinalSelectionState((prev) => ({ ...prev, ...init }));
    setComments(mergedComments);

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
    (step === 1 && selectedPatient !== null && selectedVisita !== undefined && !isCheckingDiagnosis && !showExistingDiagnosisModal) ||
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
    setSelectedVisita(undefined);
    setVisitas([]);
    setHasMoreVisitas(false);
    setVisitasExpandidas(false);
    setShowExistingDiagnosisModal(false);
    setExistingDetalles([]);
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
    handleQueryChange,
    selectPatient,
    clearPatient,
    // Visitas
    visitas,
    selectedVisita,
    selectVisita,
    hasMoreVisitas,
    visitasExpandidas,
    verMasVisitas,
    verMenosVisitas,
    isLoadingVisitas,
    // Modal diagnóstico IA existente
    showExistingDiagnosisModal,
    existingDetalles,
    closeExistingDiagnosisModal,
    goToStep2FromExisting,
    goToStep3FromExisting,
    eyes,
    handleFile,
    clearEye,
    results,
    activeEye,
    setActiveEye,
  };
}
