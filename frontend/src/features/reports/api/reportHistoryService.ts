import api from "@/lib/api";
import type {
  HistoricalReportDetail,
  HistoricalReportSummary,
  ReportHistoryPagination,
} from "../types";

interface HistoryResponse<T> {
  data: T;
  pagination: ReportHistoryPagination;
}

export async function getPatientReportHistory(
  patientId: number,
  page = 1,
  signal?: AbortSignal,
): Promise<HistoryResponse<HistoricalReportSummary[]>> {
  const response = await api.get(`/informes/historial/paciente/${patientId}`, {
    params: { page, per_page: 10 }, signal,
  });
  return { data: response.data.data, pagination: response.data.pagination };
}

export async function getReportVersions(
  reportId: number,
  page = 1,
  signal?: AbortSignal,
): Promise<HistoryResponse<HistoricalReportDetail>> {
  const response = await api.get(`/informes/${reportId}/versiones`, {
    params: { page, per_page: 10 }, signal,
  });
  return { data: response.data.data, pagination: response.data.pagination };
}
