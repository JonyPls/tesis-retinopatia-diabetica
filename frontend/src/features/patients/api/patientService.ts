import api from "@/lib/api";

export interface PatientSearchResult {
  id: number;
  tipo_doc_abrev: string;
  nro_documento: string;
  nombres: string;
  apellidos: string;
}

export const buscarPacientes = async (
  q: string,
): Promise<PatientSearchResult[]> => {
  const response = await api.get("/pacientes/buscar", { params: { q } });
  return response.data.data;
};

export const obtenerPacientesRecientes = async (): Promise<PatientSearchResult[]> => {
  const response = await api.get("/pacientes/recientes");
  return response.data.data;
};

export interface DiagnosticoVisita {
  diagnostico_id: number;
  fecha_visita: string;
  medico_tratante: string;
}

export const obtenerDiagnosticosPaciente = async (pacienteId: number): Promise<DiagnosticoVisita[]> => {
  const response = await api.get(`/diagnosticos/paciente/${pacienteId}`);
  return response.data.data;
};