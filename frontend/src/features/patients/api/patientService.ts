import api from "@/lib/api";
import type { PatientReportDetail } from "../types";

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
    datos_estructurados?: Record<string, any>;
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

export const obtenerInformeClinico = async (
  informeId: number,
): Promise<PatientReportDetail> => {
  const response = await api.get(`/informes/${informeId}`);
  return response.data.data;
};

function filenameFromDisposition(disposition?: string) {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].trim());
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() ?? null;
}

export const descargarReporteDiagnostico = async (
  visitaId: number,
): Promise<{ blob: Blob; filename: string }> => {
  const response = await api.get(`/visitas/${visitaId}/reporte-diagnostico`, {
    responseType: "blob",
  });

  return {
    blob: response.data,
    filename:
      filenameFromDisposition(response.headers["content-disposition"]) ??
      `reporte_RD_visita_${visitaId}.pdf`,
  };
};
