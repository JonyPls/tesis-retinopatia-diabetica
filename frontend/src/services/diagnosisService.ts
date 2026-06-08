import api from "./api";

export interface DiagnosisResult {
  diagnostico_id: number;
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
): Promise<DiagnosisResult> => {
  const formData = new FormData();
  formData.append("paciente_id", String(pacienteId));
  formData.append("ojo_evaluado", ojoDominante);
  formData.append("imagen", imagen);

  const response = await api.post("/diagnosticar", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
};

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
