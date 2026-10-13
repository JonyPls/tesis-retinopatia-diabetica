// A zone suffix is necessary but not sufficient: use these functions only for
// instants whose API origin is accredited. Legacy HTTP GMT is not proof of UTC.
const explicitZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/i;
const lima = "America/Lima";
export const unknownClinicalDate = "Fecha pendiente de conciliación";

export type ClinicalOrigin = "NO_VERIFICADO" | "UTC_VERIFICADO";

export function clinicalInstant(value: string | null | undefined, origin?: ClinicalOrigin): Date | null {
  if (origin === "NO_VERIFICADO" || !value || !explicitZone.test(value)) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function clinicalTimestamp(value: string | null | undefined): number | null {
  return clinicalInstant(value)?.getTime() ?? null;
}

export function compareClinicalDesc(a: string | null | undefined, b: string | null | undefined): number {
  const first = clinicalTimestamp(a);
  const second = clinicalTimestamp(b);
  // Keep upstream order when either instant lacks verified provenance.
  return first === null || second === null ? 0 : second - first;
}

type DatedVisit = { visita_id: number; fecha_visita: string; fecha_visita_origen?: ClinicalOrigin };

export function verifiedVisitInstant(visit: Pick<DatedVisit, "fecha_visita" | "fecha_visita_origen">): Date | null {
  return visit.fecha_visita_origen === "UTC_VERIFICADO"
    ? clinicalInstant(visit.fecha_visita, visit.fecha_visita_origen) : null;
}

export function compareVisitGroups(a: DatedVisit, b: DatedVisit, ascending = false): number {
  const first = verifiedVisitInstant(a)?.getTime() ?? null;
  const second = verifiedVisitInstant(b)?.getTime() ?? null;
  if (first !== null && second === null) return -1;
  if (first === null && second !== null) return 1;
  if (first !== null && second !== null && first !== second) {
    return ascending ? first - second : second - first;
  }
  // Unverified entries have an operational ID order, not an inferred time.
  return b.visita_id - a.visita_id;
}

export function compareReportGroups(
  a: { id: number; fecha_creado: string; fecha_creado_origen?: ClinicalOrigin },
  b: { id: number; fecha_creado: string; fecha_creado_origen?: ClinicalOrigin },
): number {
  const first = a.fecha_creado_origen === "UTC_VERIFICADO"
    ? clinicalInstant(a.fecha_creado, a.fecha_creado_origen)?.getTime() : undefined;
  const second = b.fecha_creado_origen === "UTC_VERIFICADO"
    ? clinicalInstant(b.fecha_creado, b.fecha_creado_origen)?.getTime() : undefined;
  if (first !== undefined && second === undefined) return -1;
  if (first === undefined && second !== undefined) return 1;
  if (first !== undefined && second !== undefined && first !== second) return second - first;
  return b.id - a.id;
}

export function formatClinicalInstant(value: string | null | undefined, origin?: ClinicalOrigin): string {
  const instant = clinicalInstant(value, origin);
  if (!instant) return unknownClinicalDate;
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: lima, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(instant);
}

export function clinicalDayKey(value: string | null | undefined): string | null {
  const instant = clinicalInstant(value);
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: lima, day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(instant);
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatClinicalDay(value: string | null | undefined): string {
  const key = clinicalDayKey(value);
  if (!key) return unknownClinicalDate;
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

export function formatCivilDay(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Fecha no registrada";
  const [year, month, day] = value.split("-");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return "Fecha no registrada";
  }
  return `${day}/${month}/${year}`;
}

export function civilAge(value: string | null | undefined, today = new Date()): number | null {
  if (formatCivilDay(value) === "Fecha no registrada" || !value) return null;
  const day = clinicalDayKey(today.toISOString());
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  const [birthYear, birthMonth, birthDate] = value.split("-").map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && date < birthDate) ? 1 : 0);
}
