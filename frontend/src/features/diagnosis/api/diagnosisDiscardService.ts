import api from "@/lib/api";
import type { EyeKey } from "../types";

export interface DiscardDetail {
  detalle_id: number;
  ojo: EyeKey;
  estado_validacion: "PENDIENTE" | "APROBADO" | "CORREGIDO";
  elegible: boolean;
  bloqueo: string | null;
}
export interface DiscardContext {
  visita_id: number;
  paciente_id: number;
  estado_visita: "ACTIVA" | "CERRADA" | "ANULADA";
  diagnostico_retinopatia_id: number | null;
  estado_diagnostico: string | null;
  revision: number;
  detalles: DiscardDetail[];
}
export interface DiscardRequest {
  paciente_id: number;
  diagnostico_retinopatia_id: number;
  detalle_ids: number[];
  revision_esperada: number;
  operacion_id: string;
  confirmo_descarte: true;
}
export interface DiscardOperation {
  operacion_id: string;
  persistencia: "CONFIRMADA";
  resultado: {
    visita_id: number;
    detalle_ids_descartados: number[];
    detalle_ids_restantes: number[];
    diagnostico_retinopatia_id: number | null;
    estado_diagnostico: string | null;
    revision: number;
  };
  limpieza: "PENDIENTE" | "COMPLETADA" | "CONFLICTO";
  fecha_utc: string;
}
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const ids = (value: unknown): value is number[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
function invalid(): never { throw new Error("No se pudo verificar el contrato de corrección del servidor."); }
function envelope(response: { data: unknown }): Record<string, unknown> {
  if (!record(response.data) || response.data.success !== true || !record(response.data.data)) return invalid();
  return response.data.data;
}
function operation(value: unknown): DiscardOperation {
  if (!record(value) || typeof value.operacion_id !== "string" || value.persistencia !== "CONFIRMADA" ||
      !["PENDIENTE", "COMPLETADA", "CONFLICTO"].includes(String(value.limpieza)) || typeof value.fecha_utc !== "string" ||
      !record(value.resultado)) return invalid();
  const result = value.resultado;
  if (!id(result.visita_id) || !ids(result.detalle_ids_descartados) || !result.detalle_ids_descartados.length ||
      !ids(result.detalle_ids_restantes) || !revision(result.revision) ||
      !(result.diagnostico_retinopatia_id === null || id(result.diagnostico_retinopatia_id)) ||
      !(result.estado_diagnostico === null || typeof result.estado_diagnostico === "string")) return invalid();
  return value as unknown as DiscardOperation;
}
export async function getDiscardContext(visitId: number, operationId?: string): Promise<DiscardContext> {
  const path = `/diagnosticar/visita/${visitId}/contexto-descarte`;
  const data = envelope(await (operationId ? api.get(path, { params: { operacion_id: operationId } }) : api.get(path)));
  if (data.visita_id !== visitId || !id(data.paciente_id) || !revision(data.revision) ||
      !["ACTIVA", "CERRADA", "ANULADA"].includes(String(data.estado_visita)) ||
      !(data.diagnostico_retinopatia_id === null || id(data.diagnostico_retinopatia_id)) ||
      !(data.estado_diagnostico === null || typeof data.estado_diagnostico === "string") ||
      !Array.isArray(data.detalles) || data.detalles.length > 2) return invalid();
  const details = data.detalles;
  if (details.some((d) => !record(d) || !id(d.detalle_id) || !["OD", "OI"].includes(String(d.ojo)) ||
      !["PENDIENTE", "APROBADO", "CORREGIDO"].includes(String(d.estado_validacion)) || typeof d.elegible !== "boolean" ||
      !(d.bloqueo === null || typeof d.bloqueo === "string")) ||
      new Set(details.map((d) => d.detalle_id)).size !== details.length ||
      new Set(details.map((d) => d.ojo)).size !== details.length) return invalid();
  return data as unknown as DiscardContext;
}
export async function discardResults(visitId: number, request: DiscardRequest): Promise<DiscardOperation> {
  return operation(envelope(await api.post(`/diagnosticar/visita/${visitId}/descartar-resultados`, request)));
}
export async function getDiscardOperation(visitId: number, operationId: string): Promise<DiscardOperation | null> {
  const data = envelope(await api.get(`/diagnosticar/visita/${visitId}/operaciones-descarte/${operationId}`));
  if (data.conciliacion === "NO_CONFIRMADA" && data.operacion === null) return null;
  if (data.conciliacion !== "CONFIRMADA") return invalid();
  return operation(data.operacion);
}
export async function getInferenceRevision(visitId: number, patientId: number): Promise<number> {
  const data = envelope(await api.get(`/visitas/${visitId}/revision-inferencia`));
  if (data.visita_id !== visitId || data.paciente_id !== patientId || !revision(data.revision_inferencia)) return invalid();
  return data.revision_inferencia;
}
