import { DiagnosisResult, DetalleDiagnosticoExistente } from "@/services/diagnosisService";
import { PatientSearchResult, DiagnosticoVisita } from "@/services/patientService";

export type EyeKey = "OD" | "OI";

export interface EyeState {
  file: File | null;
  preview: string | null;
  isExistingImage?: boolean;
}

export interface DiagnosisHook {
  // Navegación
  step: number;
  goNext: () => void;
  goBack: () => void;
  resetAll: () => void;
  canNext: boolean;
  isSaving: boolean;
  processingEye: EyeKey | null;
  modalPhase: "idle" | "validating" | "analyzing" | "error";
  modalProgress: number;
  validationError: string | null;
  dismissError: () => void;

  // Paso 1 — Paciente
  query: string;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  selectedPatient: PatientSearchResult | null;
  isSearching: boolean;
  handleQueryChange: (value: string) => void;
  selectPatient: (p: PatientSearchResult) => void;
  clearPatient: () => void;

  // Visitas (paso 1)
  visitas: DiagnosticoVisita[];
  selectedVisita: DiagnosticoVisita | null | undefined;
  selectVisita: (v: DiagnosticoVisita | null) => void;
  hasMoreVisitas: boolean;
  visitasExpandidas: boolean;
  verMasVisitas: () => Promise<void>;
  verMenosVisitas: () => Promise<void>;
  isLoadingVisitas: boolean;

  // Modal diagnóstico IA existente (Escenario B)
  showExistingDiagnosisModal: boolean;
  existingDetalles: DetalleDiagnosticoExistente[];
  closeExistingDiagnosisModal: () => void;
  goToStep2FromExisting: () => void;
  goToStep3FromExisting: () => void;

  // Paso 2 — Imágenes
  eyes: Record<EyeKey, EyeState>;
  handleFile: (eye: EyeKey, file?: File) => void;
  clearEye: (eye: EyeKey) => void;

  // Paso 3 — Resultados
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  activeEye: EyeKey;
  setActiveEye: (eye: EyeKey) => void;
  // Validación
  finalSelection: Record<EyeKey, number>;
  setFinalSelection: (eye: EyeKey, value: number) => void;
  comments: Record<EyeKey, string>;
  setComment: (eye: EyeKey, text: string) => void;
  validateDiagnosis: (eye: EyeKey) => Promise<void>;
  validateAll: () => Promise<void>;
  isValidating: boolean;
}
