import { create } from "zustand";
import type { DiscardOperation, DiscardRequest } from "../api/diagnosisDiscardService";
import type { EyeKey } from "../types";

export interface PendingDiscard {
  actorId: number;
  visitId: number;
  request: DiscardRequest;
  targets: { eye: EyeKey; detailId: number }[];
  status: "sending" | "uncertain" | "confirmed" | "applied" | "rejected";
  operation?: DiscardOperation;
}
export interface DiscardMarker {
  version: 1;
  actorId: number;
  visitId: number;
  operationId: string;
}
interface DiscardState {
  entries: PendingDiscard[];
  recoveryActorId: number | null;
  markers: DiscardMarker[];
  storageError: boolean;
}
// El journal clínico/técnico completo sigue SOLO en memoria. Únicamente los
// cuatro campos de DiscardMarker pueden llegar a sessionStorage de esta pestaña.
export const useDiagnosisDiscardStore = create<DiscardState>(() => ({
  entries: [], recoveryActorId: null, markers: [], storageError: false,
}));
const key = (actorId: number) => `codn.discard-recovery.v1.${actorId}`;
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function readMarkers(actorId: number): DiscardMarker[] {
  const raw = window.sessionStorage.getItem(key(actorId));
  if (raw === null) return [];
  if (raw.length > 8192) throw new Error("Marcador no verificable");
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 16 || rows.some((row) =>
      !row || typeof row !== "object" || Object.keys(row).sort().join() !== "actorId,operationId,version,visitId" ||
      row.version !== 1 || row.actorId !== actorId || !positive(row.visitId) ||
      typeof row.operationId !== "string" || !uuid.test(row.operationId)) ||
      new Set(rows.map((r) => r.operationId)).size !== rows.length ||
      new Set(rows.map((r) => r.visitId)).size !== rows.length) throw new Error("Marcador no verificable");
  return rows;
}
function publish(actorId: number, markers: DiscardMarker[], storageError = false) {
  if (useDiagnosisDiscardStore.getState().recoveryActorId === actorId) {
    useDiagnosisDiscardStore.setState({ markers, storageError });
  }
}
function writeMarkers(actorId: number, markers: DiscardMarker[]) {
  const raw = JSON.stringify(markers);
  window.sessionStorage.setItem(key(actorId), raw);
  if (window.sessionStorage.getItem(key(actorId)) !== raw) throw new Error("No se verificó el marcador");
}
function includeKnown(actorId: number, markers: DiscardMarker[]) {
  const state = useDiagnosisDiscardStore.getState();
  const known = state.recoveryActorId === actorId ? [...state.markers] : [];
  state.entries.filter((e) => e.actorId === actorId && e.status !== "applied" && e.status !== "rejected").forEach((e) => {
    known.push({ version: 1, actorId, visitId: e.visitId, operationId: e.request.operacion_id });
  });
  known.forEach((m) => {
    const existing = markers.find((row) => row.operationId === m.operationId);
    if (existing && existing.visitId !== m.visitId) throw new Error("Identidades incompatibles");
    if (!existing) markers.push(m);
  });
  if (markers.length > 16 || new Set(markers.map((m) => m.visitId)).size !== markers.length) throw new Error("Identidades incompatibles");
  return markers;
}
export function hydrateDiscardMarkers(actorId: number | null) {
  const previous = useDiagnosisDiscardStore.getState();
  const known = previous.recoveryActorId === actorId ? previous.markers : [];
  useDiagnosisDiscardStore.setState({ recoveryActorId: actorId, markers: known, storageError: false });
  if (actorId === null) return;
  try {
    if (!positive(actorId)) throw new Error("Identidad inválida");
    const markers = readMarkers(actorId);
    const original = JSON.stringify(markers);
    // La ausencia en storage no invalida evidencia pendiente que sigue en memoria.
    includeKnown(actorId, markers);
    if (JSON.stringify(markers) !== original) writeMarkers(actorId, markers);
    publish(actorId, markers);
  } catch {
    publish(actorId, known, true); // No borrar ni sobrescribir contenido corrupto.
  }
}
export function retainDiscardMarker(entry: PendingDiscard): boolean {
  const marker: DiscardMarker = { version: 1, actorId: entry.actorId, visitId: entry.visitId,
    operationId: entry.request.operacion_id };
  try {
    if (!positive(entry.actorId) || !positive(entry.visitId) || !uuid.test(marker.operationId)) throw new Error("Identidad inválida");
    const markers = includeKnown(entry.actorId, readMarkers(entry.actorId));
    if (markers.length >= 16 || markers.some((m) => m.visitId === entry.visitId || m.operationId === marker.operationId)) {
      throw new Error("Ya existe una operación pendiente");
    }
    markers.push(marker);
    writeMarkers(entry.actorId, markers); // Verificación síncrona ANTES del POST.
    publish(entry.actorId, markers);
    return true;
  } catch {
    const state = useDiagnosisDiscardStore.getState();
    publish(entry.actorId, state.markers, true);
    return false;
  }
}
export function retireDiscardMarker(marker: DiscardMarker): boolean {
  try {
    const known = includeKnown(marker.actorId, readMarkers(marker.actorId));
    if (known.some((m) => m.operationId === marker.operationId && m.visitId !== marker.visitId)) throw new Error("Identidades incompatibles");
    const markers = known.filter((m) => m.operationId !== marker.operationId);
    writeMarkers(marker.actorId, markers);
    publish(marker.actorId, markers);
    return true;
  } catch {
    publish(marker.actorId, useDiagnosisDiscardStore.getState().markers, true);
    return false;
  }
}
export function recordDiscard(entry: PendingDiscard) {
  useDiagnosisDiscardStore.setState(({ entries }) => {
    const previous = entries.find((e) => e.request.operacion_id === entry.request.operacion_id);
    if (previous?.status === "applied" || (previous?.status === "confirmed" && entry.status !== "applied")) return { entries };
    return { entries: [...entries.filter((e) => e.request.operacion_id !== entry.request.operacion_id), entry] };
  });
}
