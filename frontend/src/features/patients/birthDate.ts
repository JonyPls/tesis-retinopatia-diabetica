import { clinicalDayKey } from "@/lib/clinicalDates";

export const MIN_BIRTH_DATE = "1900-01-01";
export const MAX_PATIENT_AGE = 120;

export function localCivilDate(today = new Date()): string {
  // La fecha de referencia es la del centro, no la zona del navegador.
  const day = clinicalDayKey(today.toISOString());
  if (!day) throw new RangeError("Fecha actual no válida.");
  return day;
}

export function validateBirthDate(value: string, today = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Verifica la fecha de nacimiento ingresada.";
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return "Verifica la fecha de nacimiento ingresada.";
  }
  if (value < MIN_BIRTH_DATE) return "La fecha de nacimiento debe ser igual o posterior al 01/01/1900.";
  const current = localCivilDate(today);
  if (value > current) return "La fecha de nacimiento no puede ser futura.";
  const [currentYear, currentMonth, currentDay] = current.split("-").map(Number);
  const age = currentYear - year -
    (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
  if (age > MAX_PATIENT_AGE) return `La edad del paciente no puede superar ${MAX_PATIENT_AGE} años.`;
  return null;
}
