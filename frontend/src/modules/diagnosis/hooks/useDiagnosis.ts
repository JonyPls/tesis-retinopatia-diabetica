import { useState, useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { convertToPreviewUrl } from "@/lib/imageUtils";
import {
  buscarPacientes,
  obtenerPacientesRecientes,
  PatientSearchResult,
} from "@/services/patientService";
import { crearDiagnostico, DiagnosisResult } from "@/services/diagnosisService";
import { EyeKey, EyeState, DiagnosisHook } from "../types";

const EMPTY_EYE: EyeState = { file: null, preview: null };

export function useDiagnosis(): DiagnosisHook {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

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
      try {
        const ojoDominante = eye === "OD" ? "Derecho" : "Izquierdo";
        const result = await crearDiagnostico(
          selectedPatient.id,
          ojoDominante,
          eyes[eye].file!,
        );
        newResults[eye] = result;
      } catch (err: any) {
        hasError = true;
        toast({
          title: `Error al procesar ${eye === "OD" ? "Ojo Derecho" : "Ojo Izquierdo"}`,
          description: err.response?.data?.error || "Error inesperado.",
          variant: "destructive",
        });
      }
    }

    setIsSaving(false);

    if (!hasError && Object.keys(newResults).length > 0) {
      setResults(newResults);
      setActiveEye(eyesToProcess[0]);
      toast({
        title: "Diagnóstico guardado",
        description: "Los resultados han sido guardados correctamente.",
      });
      setStep(3);
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
