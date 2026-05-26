import api from "./api";

export interface DiagnosisResult {
  success: boolean;
  diagnostico_id: number;
  diagnostico_codigo: number;
  diagnostico_texto: string;
  confianza_general: number;
  probabilidades_detalle: Record<string, number>;
  mensaje: string;
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
  return response.data;
};
