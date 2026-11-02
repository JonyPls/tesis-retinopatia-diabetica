import type { DiagnosisResult, RetinographAutoImage } from "@/features/diagnosis/api/diagnosisService";
import {
  DiagnosticoVisita,
  PatientSearchResult,
} from "@/features/patients/api/patientService";
import type { PatientRequestError } from "@/features/patients/patientAccess";

export type EyeKey = "OD" | "OI";
export type EyeProcessingStatus = "sin_procesar" | "procesando" | "pendiente_validacion" |
  "validado" | "error" | "incierto";

export interface EyeState {
  file: File | null;
  preview: string | null;
  isExistingImage?: boolean;
  candidate?: RetinographAutoImage;
  confirmation?: "pendiente" | "registrando" | "CONFIRMADA" | "EXPIRADA" | "REVOCADA" | "CONSUMIDA" | "incierta";
  expiresAt?: string;
  hasConfirmation?: boolean;
}

export interface AutoPreview {
  image: RetinographAutoImage;
  file: File;
  preview: string | null;
}

export interface ManualImageReview {
  patient: PatientSearchResult;
  images: { eye: EyeKey; file: File; preview: string | null }[];
}

export interface DiagnosisHook {
  correction: ReturnType<typeof import("./hooks/useDiagnosisCorrection").useDiagnosisCorrection>;
  // Navegación
  step: number;
  goNext: () => void;
  goBack: () => void;
  returnToResults: () => void;
  isNavigationBusy: boolean;
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
  isLoadingMorePatients: boolean;
  hasMoreSearchResults: boolean;
  searchError: PatientRequestError | null;
  recentError: PatientRequestError | null;
  hasSearched: boolean;
  isLoadingRecent: boolean;
  visitasRecientes: DiagnosticoVisita[];
  selectedVisita: DiagnosticoVisita | null | undefined;
  isLoadingVisitas: boolean;
  isAutoSelectingImages: boolean;
  busyEyes: Record<EyeKey, boolean>;
  eyeActionError: Partial<Record<EyeKey, string>>;
  autoModalOpen: boolean;
  autoCandidates: RetinographAutoImage[];
  autoPreview: AutoPreview | null;
  autoFocusEye: EyeKey | null;
  autoPreviewLoading: boolean;
  handleQueryChange: (value: string) => void;
  loadMorePatients: () => Promise<void>;
  selectPatient: (p: PatientSearchResult) => void;
  selectVisita: (visita: DiagnosticoVisita | null) => void;
  clearPatient: () => void;

  // Paso 2 — Imágenes
  manualReview: ManualImageReview | null;
  cancelManualReview: () => void;
  confirmManualReview: (review: ManualImageReview, accepted: boolean) => void;
  eyes: Record<EyeKey, EyeState>;
  handleFile: (eye: EyeKey, file?: File) => Promise<void>;
  autoSelectRetinographImages: () => Promise<void>;
  selectAutoCandidate: (image: RetinographAutoImage) => Promise<void>;
  closeAutoSelection: () => void;
  clearEye: (eye: EyeKey) => Promise<void>;
  confirmEye: (eye: EyeKey) => Promise<void>;
  checkConfirmation: (eye: EyeKey) => Promise<EyeState["confirmation"] | null>;
  revokeConfirmation: (eye: EyeKey) => Promise<void>;

  // Paso 3 — Resultados
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  eyeProcessing: Record<EyeKey, EyeProcessingStatus>;
  confirmedVisitId: number | null;
  processingNotice: string | null;
  reconcileResults: () => Promise<void>;
  activeEye: EyeKey;
  setActiveEye: (eye: EyeKey) => void;
  // Validación
  finalSelection: Record<EyeKey, number>;
  setFinalSelection: (eye: EyeKey, value: number) => void;
  comments: Record<EyeKey, string>;
  setComment: (eye: EyeKey, text: string) => void;
  correctionReasons: Record<EyeKey, string>;
  setCorrectionReason: (eye: EyeKey, text: string) => void;
  validateDiagnosis: (eye: EyeKey) => Promise<void>;
  validateAll: () => Promise<void>;
  isValidating: boolean;
  validatedEyes: Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">>;
  validationConflict: boolean;
}
