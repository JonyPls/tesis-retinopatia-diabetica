import type { ClinicalOrigin } from "@/lib/clinicalDates";

export interface Patient {
  id: number;
  nro_documento: string;
  nombres: string;
  apellidos: string;
  ultima_visita: string;
  ultima_visita_origen: ClinicalOrigin;
}

export interface KpiItem {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}

export interface RDLevelRow {
  level: number;
  label: string;
  count: number;
}

export interface DashboardSummary {
  kpis: { patients: number; evaluations: number; validated: number; pending: number };
  severity: RDLevelRow[];
  recent_patients: Patient[];
  actions: { patients: boolean; diagnosis: boolean; reports: boolean };
}
