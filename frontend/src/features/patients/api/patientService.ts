import api from "@/lib/api";

export interface PatientSearchResult {
  id: number;
  tipo_doc_abrev: string;
  tipo_doc?: string;
  tipo_doc_id?: number;
  nro_documento: string;
  nombres: string;
  apellidos: string;
  ultima_visita?: string | null;
}

export interface PatientSearchPagination {
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
}

export interface PatientSearchResponse {
  data: PatientSearchResult[];
  pagination: PatientSearchPagination;
}

interface PatientSearchOptions {
  page?: number;
  perPage?: number;
}

export const buscarPacientes = async (
  q: string,
): Promise<PatientSearchResult[]> => {
  const response = await api.get("/pacientes/buscar", { params: { q } });
  return response.data.data;
};

export const buscarPacientesPaginado = async (
  q: string,
  options: PatientSearchOptions = {},
): Promise<PatientSearchResponse> => {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 10;
  const response = await api.get("/pacientes/buscar", {
    params: { q, page, per_page: perPage },
  });

  return {
    data: response.data.data,
    pagination: response.data.pagination ?? {
      page,
      per_page: perPage,
      total: response.data.data.length,
      has_more: false,
    },
  };
};

export const obtenerPacientesRecientes = async (
  limit?: number,
): Promise<PatientSearchResult[]> => {
  const response = await api.get("/pacientes/recientes", {
    params: limit ? { limit } : undefined,
  });
  return response.data.data;
};

export interface VisitaClinica {
  visita_id: number;
  diagnostico_id?: number;
  diagnostico_retinopatia_id?: number | null;
  fecha_visita: string;
  medico_tratante: string;
  motivo_consulta?: string | null;
  observaciones?: string | null;
  estado?: string;
  tiene_diagnostico_ia?: number;
  tiene_informes?: number;
  diagnostico_ia?: {
    id: number;
    estado: "PENDIENTE" | "PROCESADO" | "VALIDADO" | "ANULADO";
    modelo_nombre?: string | null;
    modelo_version?: string | null;
    detalles: {
      detalle_id: number;
      ojo_evaluado: "Derecho" | "Izquierdo";
      resultado_ia_id: number | null;
      resultado_ia_nombre?: string | null;
      resultado_final_id: number | null;
      resultado_final_nombre?: string | null;
      probabilidad_ia?: number | null;
      estado_validacion: "PENDIENTE" | "APROBADO" | "CORREGIDO";
      comentario_medico?: string | null;
      motivo_correccion?: string | null;
      imagen_original_url?: string | null;
      imagen_gradcam_url?: string | null;
      nombre_archivo_original?: string | null;
      fecha_validacion?: string | null;
    }[];
  } | null;
  informes?: {
    id: number;
    tipo_informe_id: number;
    tipo_informe_nombre: string;
    conclusion?: string | null;
    estado: "ACTIVO" | "INACTIVO" | "ANULADO";
    fecha_creado: string;
    fecha_actualizado: string;
  }[];
}

export type DiagnosticoVisita = VisitaClinica;

export const obtenerVisitasPaciente = async (pacienteId: number): Promise<VisitaClinica[]> => {
  const response = await api.get(`/pacientes/${pacienteId}/visitas`);
  return response.data.data;
};

export const obtenerDiagnosticosPaciente = obtenerVisitasPaciente;
