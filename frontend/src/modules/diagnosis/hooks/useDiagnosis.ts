import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl } from "@/lib/imageUtils";
import {
  buscarPacientes,
  obtenerPacientesRecientes,
  PatientSearchResult,
} from "@/services/patientService";
import {
  crearDiagnostico,
  DiagnosisResult,
  validarDiagnostico,
} from "@/services/diagnosisService";
import { useAuthStore } from "@/store/authStore";
import { EyeKey, EyeState, DiagnosisHook } from "../types";

const EMPTY_EYE: EyeState = { file: null, preview: null };

export function useDiagnosis(): DiagnosisHook {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [processingEye, setProcessingEye] = useState<EyeKey | null>(null);

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
  const handleSave = async () => {
    if (!selectedPatient) return;
    setIsSaving(true);

    const eyesToProcess = (["OD", "OI"] as EyeKey[]).filter(
      (eye) => eyes[eye].file !== null,
    );

    const newResults: Partial<Record<EyeKey, DiagnosisResult>> = {};
    let hasError = false;

    for (const eye of eyesToProcess) {
      setProcessingEye(eye);
      try {
        const ojoDominante = eye === "OD" ? "Derecho" : "Izquierdo";
        const result = await crearDiagnostico(
          selectedPatient.id,
          ojoDominante,
          eyes[eye].file!,
        );

        // 2. Se construye la URL completa para el Grad-CAM si existe
        const BACKEND_URL =
          import.meta.env.VITE_API_URL || "http://localhost:5000";
        if (result.gradcam_url) {
          const token = useAuthStore.getState().token;
          result.gradcam_url = `${BACKEND_URL}/uploads/retinas/${result.gradcam_url}?token=${token}`;
        }

        newResults[eye] = result;
      } catch (err: any) {
        hasError = true;
        toast({
          title: `Error al procesar ${eye === "OD" ? "Ojo Derecho" : "Ojo Izquierdo"}`,
          description: err.response?.data?.message || "Error inesperado.",
          variant: "destructive",
        });
      }
    }

    setProcessingEye(null);
    setIsSaving(false);

    if (!hasError && Object.keys(newResults).length > 0) {
      setResults(newResults);
      setActiveEye(eyesToProcess[0]);
      // Inicializar selecciones finales con lo que predijo la IA
      const init: Record<EyeKey, number> = { OD: 0, OI: 0 };
      (Object.keys(newResults) as EyeKey[]).forEach((e) => {
        init[e] = newResults[e]!.diagnostico_codigo;
      });
      setFinalSelectionState((prev) => ({ ...prev, ...init }));
      setComments({ OD: "", OI: "" });
      toast({
        title: "Diagnóstico guardado",
        description: "Los resultados han sido guardados correctamente.",
      });
      setStep(3);
    }
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
    const diagnosticoId = current.diagnostico_id;
    setIsValidating(true);
    try {
      const resp = await validarDiagnostico(
        diagnosticoId,
        finalSelection[eye],
        comments[eye],
      );
      if (resp.success) {
        toast({ title: "Validación guardada", description: resp.message });
        // Opcional: marcar en resultados que fue validado (no tenemos campo específico)
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
      const diagnosticoId = current.diagnostico_id;
      try {
        const resp = await validarDiagnostico(
          diagnosticoId,
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
    eyes,
    handleFile,
    clearEye,
    results,
    activeEye,
    setActiveEye,
  };
}
