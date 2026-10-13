export interface TipoInforme {
  id: number;
  nombre: string;
  descripcion: string;
}

export interface Informe {
  id: number;
  visita_id: number;
  diagnostico_id?: number;
  tipo_informe_id: number;
  tipo_informe_nombre?: string;
  schema_version?: number;
  datos_estructurados: Record<string, any>;
  conclusion?: string | null;
  estado: string;
  fecha_creado: string;
  fecha_actualizado: string;
}

export type ReportStatus = "ACTIVO" | "ANULADO" | "INACTIVO";
export type ReportOperation = "CREACION" | "MIGRACION_INICIAL" | "CORRECCION" | "ANULACION" | "INACTIVACION";

export interface ReportHistoryPagination {
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
}

export interface HistoricalReportSummary {
  id: number;
  visita_id: number;
  fecha_visita: string;
  estado_visita: string;
  tipo_informe_id: number;
  tipo_informe_nombre: string;
  usuario_id: number;
  autor_original: { id: number; nombres: string; apellidos: string };
  estado: ReportStatus;
  revision_actual: number;
  fecha_creado: string;
  fecha_actualizado: string;
}

export interface HistoricalReportVersion {
  numero_version: number;
  operacion: ReportOperation;
  schema_version: number;
  datos_estructurados: Record<string, unknown> | null;
  conclusion: string | null;
  estado: ReportStatus;
  autor_operacion_id: number | null;
  autor_operacion: { id: number; nombres: string; apellidos: string } | null;
  fecha_operacion: string;
  motivo: string | null;
  es_actual: boolean;
}

export interface HistoricalReportDetail {
  informe: {
    id: number;
    paciente_id: number;
    visita_id: number;
    fecha_visita: string;
    estado_visita: string;
    tipo_informe_id: number;
    tipo_informe_nombre: string;
    usuario_id: number;
    estado: ReportStatus;
    revision_actual: number;
  };
  versiones: HistoricalReportVersion[];
}

export interface SearchableOption {
  label: string;
  value: string;
  group?: string;
}

export const GONIOSCOPIA_CONCLUSIONES: SearchableOption[] = [
  { label: "Ángulo abierto", value: "ÁNGULO ABIERTO AO", group: "AO" },
  { label: "Ángulo estrecho", value: "ÁNGULO ESTRECHO AO", group: "AO" },
  { label: "Ángulo cerrado", value: "ÁNGULO CERRADO AO", group: "AO" },
  { label: "Ángulo abierto", value: "ÁNGULO ABIERTO OD", group: "OD" },
  { label: "Ángulo estrecho", value: "ÁNGULO ESTRECHO OD", group: "OD" },
  { label: "Ángulo cerrado", value: "ÁNGULO CERRADO OD", group: "OD" },
  { label: "Ángulo abierto", value: "ÁNGULO ABIERTO OI", group: "OI" },
  { label: "Ángulo estrecho", value: "ÁNGULO ESTRECHO OI", group: "OI" },
  { label: "Ángulo cerrado", value: "ÁNGULO CERRADO OI", group: "OI" },
];

export interface ReportFormHandle {
  getData: () => Record<string, any>;
  isValid: () => boolean;
}

export const CUADRANTES = ["superior", "inferior", "nasal", "temporal"] as const;
export const GRADOS = ["I", "II", "III", "IV"] as const;
export const CUADRANTE_LABELS: Record<string, string> = {
  superior: "Superior",
  inferior: "Inferior",
  nasal: "Nasal",
  temporal: "Temporal",
};
