import api from "@/lib/api";
import type { EyeKey } from "../types";

const CONFIRMATIONS = "/diagnosticar/retinografo/confirmaciones";

export interface RetinographConfirmationStatus {
  paciente_id: number;
  ojo_confirmado: "Derecho" | "Izquierdo";
  estado: "CONFIRMADA" | "REVOCADA" | "CONSUMIDA";
  vigente?: boolean;
  expirada?: boolean;
  fecha_expiracion?: string;
}

export const registrarConfirmacionRetinografo = async (data: {
  paciente_id: number;
  nombre_exportacion: string;
  ojo_confirmado: "Derecho" | "Izquierdo";
  sha256_previsualizacion: string;
}): Promise<RetinographConfirmationStatus & { identificador: string }> => {
  const response = await api.post(CONFIRMATIONS, { ...data, confirmo_asociacion: true });
  return response.data.confirmacion;
};

export const consultarConfirmacionRetinografo = async (identificador: string): Promise<RetinographConfirmationStatus> => {
  const response = await api.post(`${CONFIRMATIONS}/estado`, { identificador });
  return response.data.confirmacion;
};

export const revocarConfirmacionRetinografo = async (identificador: string): Promise<RetinographConfirmationStatus> => {
  const response = await api.post(`${CONFIRMATIONS}/revocar`, { identificador });
  return response.data.confirmacion;
};

export const sha256Blob = async (blob: Blob): Promise<string> => {
  if (!globalThis.crypto?.subtle?.digest || typeof blob.arrayBuffer !== "function")
    throw new Error("SHA-256 no disponible en este navegador.");
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new Error("SHA-256 no pudo calcularse en este navegador.");
  }
};

export interface DiagnosisResult {
  visita_id: number;
  diagnostico_id?: number;
  diagnostico_retinopatia_id?: number;
  detalle_id: number;
  diagnostico_codigo: number;
  diagnostico_texto: string;
  confianza_general: number;
  probabilidades_detalle: Record<string, number>;
  mensaje: string;
  gradcam_url?: string;
  imagen_url?: string;
  estado_validacion?: DetalleDiagnosticoExistente["estado_validacion"];
  diagnostico_final?: number | null;
}

export const crearDiagnostico = async (
  pacienteId: number,
  ojoDominante: "Derecho" | "Izquierdo",
  imagen: File,
  visitaId?: number,
): Promise<DiagnosisResult> => {
  const formData = new FormData();
  formData.append("paciente_id", String(pacienteId));
  formData.append("ojo_evaluado", ojoDominante);
  formData.append("imagen", imagen);
  if (visitaId !== undefined) {
    formData.append("visita_id", String(visitaId));
  }

  const response = await api.post("/diagnosticar", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};

export interface DetalleDiagnosticoExistente {
  detalle_id: number;
  ojo: 'OD' | 'OI';
  resultado_ia: number;
  diagnostico_texto: string;
  confianza_general: number;
  probabilidades_detalle: Record<string, number> | null;
  diagnostico_final: number | null;
  estado_validacion: "PENDIENTE" | "APROBADO" | "CORREGIDO";
  comentario_medico: string | null;
  motivo_correccion: string | null;
  imagen_url: string;
  gradcam_url: string | null;
}

export const obtenerDetallesVisita = async (visitaId: number): Promise<DetalleDiagnosticoExistente[]> => {
  const response = await api.get(`/diagnosticar/visita/${visitaId}/detalles`);
  return response.data.data.ojos;
};

export const crearDiagnosticoConfirmado = async (
  pacienteId: number,
  ojo: "Derecho" | "Izquierdo",
  identificador: string,
  visitaId?: number,
): Promise<DiagnosisResult> => {
  const formData = new FormData();
  formData.append("paciente_id", String(pacienteId));
  formData.append("ojo_evaluado", ojo);
  formData.append("confirmacion_exportacion", identificador);
  if (visitaId !== undefined) formData.append("visita_id", String(visitaId));
  const response = await api.post("/diagnosticar", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};

export const obtenerDetallesDiagnostico = obtenerDetallesVisita;

/** El GET por visita devuelve únicamente ojos persistidos, nunca un POST nuevo. */
export function resultadoPersistido(
  visitaId: number,
  detail: DetalleDiagnosticoExistente,
): DiagnosisResult {
  return {
    visita_id: visitaId,
    detalle_id: detail.detalle_id,
    diagnostico_codigo: detail.resultado_ia,
    diagnostico_texto: detail.diagnostico_texto,
    confianza_general: detail.confianza_general,
    probabilidades_detalle: detail.probabilidades_detalle ?? {},
    mensaje: "Resultado consultado en la visita.",
    imagen_url: detail.imagen_url,
    gradcam_url: detail.gradcam_url ?? undefined,
    estado_validacion: detail.estado_validacion,
    diagnostico_final: detail.diagnostico_final,
  };
}

export const validarDiagnostico = async (
  diagnosticoId: number,
  diagnostico_final: number,
  comentario_medico?: string,
) => {
  const payload: any = { diagnostico_final };
  if (comentario_medico) payload.comentario_medico = comentario_medico;
  const response = await api.put(
    `/diagnosticar/${diagnosticoId}/validar`,
    payload,
  );
  return response.data;
};

export const validarDetalleDiagnostico = async (
  detalleId: number,
  diagnostico_final: number,
  comentario_medico?: string,
  motivo_correccion?: string,
) => {
  const payload: any = { diagnostico_final };
  const comentario = comentario_medico?.trim();
  const motivo = motivo_correccion?.trim();
  if (comentario) payload.comentario_medico = comentario;
  if (motivo) payload.motivo_correccion = motivo;
  const response = await api.put(
    `/diagnosticar/detalle/${detalleId}/validar`,
    payload,
  );
  return response.data;
};

export interface RetinographAutoImage {
  filename: string;
  ojo: EyeKey;
  ojo_original: "R" | "L";
  tipo_imagen: string;
  secuencia: number;
  extension: string;
  fecha_exportacion: string;
  mime_type: string;
}

export interface RetinographAutoSelection {
  paciente_id: number;
  encontradas: number;
  imagenes: Partial<Record<EyeKey, RetinographAutoImage | null>>;
  candidatas?: RetinographAutoImage[];
}

export const obtenerSeleccionAutomaticaRetinografo = async (
  pacienteId: number,
  signal?: AbortSignal,
): Promise<RetinographAutoSelection> => {
  const response = await api.get(
    `/diagnosticar/retinografo/auto-seleccion/${pacienteId}`,
    { signal },
  );
  return response.data.data;
};

export const descargarImagenRetinografo = async (
  pacienteId: number,
  filename: string,
  signal?: AbortSignal,
): Promise<Blob> => {
  const response = await api.get("/diagnosticar/retinografo/imagen", {
    params: { paciente_id: pacienteId, filename },
    responseType: "blob",
    signal,
  });
  return response.data;
};
