import { civilAge, formatCivilDay } from "@/lib/clinicalDates";
import { localCivilDate } from "./birthDate";
import type { Patient } from "./types";

export type PatientSort = { field: "patient" | "age"; direction: "asc" | "desc" } | null;

const spanish = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export function sortPatients(patients: Patient[], sort: PatientSort, today = new Date()): Patient[] {
  if (!sort) return patients;
  const currentDay = localCivilDate(today);
  const age = (patient: Patient) => {
    const date = patient.fecha_nacimiento;
    return date && formatCivilDay(date) !== "Fecha no registrada" && date <= currentDay
      ? civilAge(date, today) : null;
  };
  const ages = sort.field === "age" ? new Map(patients.map((patient) => [patient, age(patient)])) : null;
  const byName = (a: Patient, b: Patient) =>
    spanish.compare(a.nombres || a.nombres_apellidos || "", b.nombres || b.nombres_apellidos || "") ||
    spanish.compare(a.apellidos || "", b.apellidos || "");
  const byId = (a: Patient, b: Patient) => Number(a.id) - Number(b.id) ||
    spanish.compare(`${a.tipo_doc_id ?? a.tipo_doc_abrev ?? ""}:${a.nro_documento}`,
      `${b.tipo_doc_id ?? b.tipo_doc_abrev ?? ""}:${b.nro_documento}`);

  return [...patients].sort((a, b) => {
    if (sort.field === "age") {
      const first = ages!.get(a) ?? null;
      const second = ages!.get(b) ?? null;
      if (first === null || second === null) {
        if (first === null && second !== null) return 1;
        if (first !== null && second === null) return -1;
      } else if (first !== second) {
        return sort.direction === "asc" ? first - second : second - first;
      }
    }
    const names = byName(a, b);
    return (sort.field === "patient" && sort.direction === "desc" ? -names : names) || byId(a, b);
  });
}

export function formatPatientListPhone(phone?: string | null): string {
  if (!phone?.trim()) return "Sin teléfono";
  const value = phone.trim();
  if (value.startsWith("+51")) {
    const national = value.slice(3).trim();
    const digits = national.replace(/[\s-]/g, "");
    if (/^\d{8,9}$/.test(digits) && /^[\d\s-]+$/.test(national)) {
      return /^9\d{8}$/.test(national) ? national.replace(/(\d{3})(?=\d)/g, "$1 ") : national;
    }
  }
  if (/^9\d{8}$/.test(value)) return value.replace(/(\d{3})(?=\d)/g, "$1 ");
  return value;
}

export function patientPageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total < 1) return [];
  const visible = new Set([1, total]);
  for (let page = Math.max(1, current - 2); page <= Math.min(total, current + 2); page++) {
    visible.add(page);
  }
  const pages = [...visible].sort((a, b) => a - b);
  const items: (number | "ellipsis")[] = [];
  pages.forEach((page, index) => {
    if (index && page - pages[index - 1] === 2) items.push(pages[index - 1] + 1);
    else if (index && page - pages[index - 1] > 2) items.push("ellipsis");
    items.push(page);
  });
  return items;
}
