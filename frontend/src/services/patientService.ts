import api from "./api";

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