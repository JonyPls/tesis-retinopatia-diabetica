import { DiagnosisResult } from "@/services/diagnosisService";
import { PatientSearchResult } from "@/services/patientService";

export type EyeKey = "OD" | "OI";

export interface EyeState {
  file: File | null;
  preview: string | null;
}

export interface DiagnosisHook {
  // Navegación
  step: number;
  goNext: () => void;
  goBack: () => void;
  resetAll: () => void;
  canNext: boolean;
  isSaving: boolean;

  // Paso 1 — Paciente
  query: string;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  selectedPatient: PatientSearchResult | null;
  isSearching: boolean;
  handleQueryChange: (value: string) => void;
  selectPatient: (p: PatientSearchResult) => void;

  // Paso 2 — Imágenes
  eyes: Record<EyeKey, EyeState>;
  handleFile: (eye: EyeKey, file?: File) => void;
  clearEye: (eye: EyeKey) => void;

  // Paso 3 — Resultados
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  activeEye: EyeKey;
  setActiveEye: (eye: EyeKey) => void;
}
