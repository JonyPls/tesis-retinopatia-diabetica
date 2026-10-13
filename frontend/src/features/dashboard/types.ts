import type { ClinicalOrigin } from "@/lib/clinicalDates";

export interface Patient {
  id: string | number;
  tipo_doc?: string;
  tipo_doc_abrev?: string;
  nro_documento: string;
  nombres_apellidos?: string;
  nombres?: string;
  apellidos?: string;
  fecha_nacimiento: string;
  ultima_visita?: string;
  ultima_visita_origen?: ClinicalOrigin;
  visitas_sin_fecha_verificada?: number;
  maxima_gravedad?: number | null;
}

export interface KpiItem {
  label: string;
  value: string;
  delta: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "info" | "destructive" | "warning";
}

export interface RDLevelRow {
  level: number;
  label: string;
  count: number;
  pct: number;
}
