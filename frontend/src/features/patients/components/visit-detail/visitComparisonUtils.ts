import { RDLevel, RD_LEVELS } from "@/data/rdLevels";
import type { DetalleDiagnosticoExistente } from "@/features/diagnosis/api/diagnosisService";
import type { Diagnosis, PatientDiagnosisEyeDetail, PatientVisitReport } from "../../types";
import { verifiedVisitInstant } from "@/lib/clinicalDates";

export type EyeKey = "OD" | "OI";
export type EffectiveGradeSource = "medical" | "ia_pending" | "none";

export const RETINOPATHY_SCALE = [
  { level: 0, label: "Sin RD" },
  { level: 1, label: "RD leve" },
  { level: 2, label: "RD moderada" },
  { level: 3, label: "RD severa" },
  { level: 4, label: "RD proliferativa" },
] as const;

export function eyeKeyFromLabel(eye: string): EyeKey {
  return eye === "Derecho" || eye === "OD" ? "OD" : "OI";
}

export function eyeDisplayName(eye: EyeKey) {
  return eye === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)";
}

export function getRetinopathyGradeLabel(level?: number | null) {
  if (level === null || level === undefined) return "No disponible";
  return RD_LEVELS[level as RDLevel]?.label ?? `Grado ${level}`;
}

export function getShortRetinopathyGradeLabel(level?: number | null) {
  if (level === null || level === undefined) return "No disponible";
  return RETINOPATHY_SCALE.find((item) => item.level === Number(level))?.label ?? `Grado ${level}`;
}

export function compareRetinopathyGrades(previous?: number | null, later?: number | null) {
  if (
    previous === null ||
    previous === undefined ||
    later === null ||
    later === undefined
  ) {
    return {
      diff: null,
      label: "Cambio no calculable",
      shortLabel: "No calculable",
    };
  }

  const diff = Number(later) - Number(previous);
  if (diff === 0) {
    return {
      diff,
      label: "Sin cambio de nivel registrado",
      shortLabel: "Sin cambio",
    };
  }

  const abs = Math.abs(diff);
  return {
    diff,
    label: `${diff > 0 ? "Aumento" : "Disminución"} de ${abs} nivel${
      abs === 1 ? "" : "es"
    } registrado`,
    shortLabel: `${diff > 0 ? "+" : ""}${diff} nivel${abs === 1 ? "" : "es"}`,
  };
}

export function percent(value?: number | null) {
  if (value === null || value === undefined) return "No disponible";
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

export function getEyeDetail(visit: Diagnosis, eye: EyeKey) {
  return (
    visit.diagnostico_ia?.detalles.find(
      (detail) => eyeKeyFromLabel(detail.ojo_evaluado) === eye,
    ) ?? null
  );
}

export function getExtraDetail(
  detail: PatientDiagnosisEyeDetail | null,
  extraDetails: DetalleDiagnosticoExistente[],
  eye: EyeKey,
) {
  if (!detail) {
    return extraDetails.find((item) => item.ojo === eye) ?? null;
  }

  return (
    extraDetails.find((item) => item.detalle_id === detail.detalle_id) ??
    extraDetails.find((item) => item.ojo === eye) ??
    null
  );
}

export function getEffectiveRetinopathyGrade(
  detail: PatientDiagnosisEyeDetail | null,
  extra: DetalleDiagnosticoExistente | null,
) {
  if (!detail && !extra) {
    return {
      confidence: null,
      finalLevel: null,
      iaLevel: null,
      level: null,
      label: "No disponible",
      source: "none" as EffectiveGradeSource,
      validation: null,
    };
  }

  const iaLevel = detail?.resultado_ia_id ?? extra?.resultado_ia ?? null;
  const finalLevel = detail?.resultado_final_id ?? extra?.diagnostico_final ?? null;
  const validation = detail?.estado_validacion ?? extra?.estado_validacion ?? null;
  const effectiveLevel = finalLevel ?? iaLevel;
  const source: EffectiveGradeSource = finalLevel !== null ? "medical" : "ia_pending";

  return {
    confidence: detail?.probabilidad_ia ?? extra?.confianza_general ?? null,
    finalLevel,
    iaLevel,
    level: effectiveLevel,
    label: getRetinopathyGradeLabel(effectiveLevel),
    source,
    validation,
  };
}

export function orderVisitsChronologically(
  currentVisit: Diagnosis,
  selectedVisit: Diagnosis,
  currentDetails: DetalleDiagnosticoExistente[],
  selectedDetails: DetalleDiagnosticoExistente[],
) {
  const currentTime = verifiedVisitInstant(currentVisit)?.getTime();
  const selectedTime = verifiedVisitInstant(selectedVisit)?.getTime();
  if (currentTime === undefined || selectedTime === undefined) {
    throw new Error("No se puede ordenar visitas sin procedencia temporal acreditada");
  }
  const currentFirst = currentTime <= selectedTime;

  return {
    previous: currentFirst ? currentVisit : selectedVisit,
    previousDetails: currentFirst ? currentDetails : selectedDetails,
    later: currentFirst ? selectedVisit : currentVisit,
    laterDetails: currentFirst ? selectedDetails : currentDetails,
  };
}

export function daysBetweenVisits(previous: Diagnosis, later: Diagnosis) {
  const laterTime = verifiedVisitInstant(later)?.getTime();
  const previousTime = verifiedVisitInstant(previous)?.getTime();
  if (laterTime === undefined || previousTime === undefined) return null;
  const diffMs = laterTime - previousTime;
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

export function groupReportsByType(reports: PatientVisitReport[] = []) {
  return reports.reduce<Record<string, PatientVisitReport[]>>((acc, report) => {
    const key = report.tipo_informe_nombre || `Informe ${report.tipo_informe_id}`;
    acc[key] = [...(acc[key] ?? []), report];
    return acc;
  }, {});
}
