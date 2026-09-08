import api from "@/lib/api";
import type { EyeKey } from "../types";

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

export const obtenerDetallesDiagnostico = obtenerDetallesVisita;

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
  documento: string;
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
  documento: string;
  directorio: string;
  encontradas: number;
  imagenes: Partial<Record<EyeKey, RetinographAutoImage | null>>;
}

export const obtenerSeleccionAutomaticaRetinografo = async (
  pacienteId: number,
): Promise<RetinographAutoSelection> => {
  const response = await api.get(
    `/diagnosticar/retinografo/auto-seleccion/${pacienteId}`,
  );
  return response.data.data;
};

export const descargarImagenRetinografo = async (
  pacienteId: number,
  filename: string,
): Promise<Blob> => {
  const response = await api.get("/diagnosticar/retinografo/imagen", {
    params: { paciente_id: pacienteId, filename },
    responseType: "blob",
  });
  return response.data;
};
