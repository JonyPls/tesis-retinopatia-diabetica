// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { ReportHistoryPanel } from "../features/reports/components/ReportHistoryPanel";
import { getPatientReportHistory, getReportVersions } from "../features/reports/api/reportHistoryService";
import type { HistoricalReportDetail, HistoricalReportSummary, HistoricalReportVersion } from "../features/reports/types";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));
vi.mock("../features/reports/api/reportHistoryService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/reports/api/reportHistoryService")>();
  return { ...real, getPatientReportHistory: vi.fn(), getReportVersions: vi.fn() };
});

const history = vi.mocked(getPatientReportHistory);
const versions = vi.mocked(getReportVersions);
const patientA = { id: 7, nombres: "Paciente", apellidos: "Ficticia" };
const patientB = { id: 8, nombres: "Otra", apellidos: "Paciente" };
const page = (total: number, number = 1) => ({ page: number, per_page: 10, total, has_more: number * 10 < total });

const summary = (id: number, estado: HistoricalReportSummary["estado"]): HistoricalReportSummary => ({
  id, visita_id: 60 + id, fecha_visita: "2030-01-01T00:00:00", estado_visita: "CERRADA",
  tipo_informe_id: 2, tipo_informe_nombre: `Campo visual ${id}`,
  usuario_id: 12, autor_original: { id: 12, nombres: "Autora", apellidos: "Sintética" },
  estado, revision_actual: id === 1 ? 3 : 1, fecha_creado: "2030-01-01T00:00:00",
  fecha_actualizado: "2030-01-02T00:00:00",
});

const version = (number: number, operation: HistoricalReportVersion["operacion"],
  estado: HistoricalReportVersion["estado"]): HistoricalReportVersion => ({
  numero_version: number, operacion: operation, schema_version: 1,
  datos_estructurados: { nota: `Contenido reservado ${number}` },
  conclusion: `Conclusión de revisión ${number}`, estado,
  autor_operacion_id: operation === "MIGRACION_INICIAL" ? null : 12,
  autor_operacion: operation === "MIGRACION_INICIAL" ? null : { id: 12, nombres: "Autora", apellidos: "Sintética" },
  fecha_operacion: "2030-01-02T00:00:00", motivo: number === 1 ? null : `Motivo ${number}`,
  es_actual: number === 3 || number === 11,
});

const detail = (id: number, patientId: number, estado: HistoricalReportSummary["estado"],
  rows: HistoricalReportVersion[]): HistoricalReportDetail => ({
  informe: { id, paciente_id: patientId, visita_id: 60 + id, fecha_visita: "2030-01-01T00:00:00",
    estado_visita: "CERRADA", tipo_informe_id: 2, tipo_informe_nombre: `Campo visual ${id}`,
    usuario_id: 12, estado, revision_actual: rows.at(-1)?.numero_version ?? 1 },
  versiones: rows,
});

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  history.mockResolvedValue({ data: [summary(1, "ANULADO"), summary(2, "INACTIVO")], pagination: page(2) });
  versions.mockImplementation(async (id) => ({
    data: detail(id, patientA.id, "ANULADO", [
      version(1, "CREACION", "ACTIVO"), version(2, "CORRECCION", "ACTIVO"),
      version(3, "ANULACION", "ANULADO"),
    ]), pagination: page(3),
  }));
});

afterEach(() => cleanup());

describe("Historial B1 (HTTP simulado, interfaz de solo lectura)", () => {
  it("no convierte fechas históricas sin procedencia y presenta Z verificado en Lima", async () => {
    versions.mockResolvedValue({
      data: detail(1, patientA.id, "ANULADO", [
        { ...version(1, "CREACION", "ACTIVO"), fecha_operacion: "2030-01-02T00:30:00Z" },
        version(2, "CORRECCION", "ACTIVO"), version(3, "ANULACION", "ANULADO"),
      ]), pagination: page(3),
    });
    render(<ReportHistoryPanel patient={patientA} />);
    fireEvent.click(await screen.findByRole("button", { name: /Campo visual 1/ }));
    expect(await screen.findByText(/01\/01\/2030,? 19:30/)).toBeInTheDocument();
    expect(screen.getAllByText(/Fecha pendiente de conciliación/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /2 · Corrección/ }));
    expect(screen.getByRole("region", { name: "Contenido de la revisión 2" }))
      .toHaveTextContent("Fecha pendiente de conciliación");
  });

  it("usa únicamente el cliente Axios autenticado, rutas sin token y paginación acotada", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], pagination: page(0) } });
    // Las funciones reales se prueban aisladamente de las peticiones de la vista.
    const real = await vi.importActual<typeof import("../features/reports/api/reportHistoryService")>(
      "../features/reports/api/reportHistoryService");
    const signal = new AbortController().signal;
    await real.getPatientReportHistory(7, 2, signal);
    await real.getReportVersions(42, 3, signal);
    expect(api.get).toHaveBeenNthCalledWith(1, "/informes/historial/paciente/7",
      { params: { page: 2, per_page: 10 }, signal });
    expect(api.get).toHaveBeenNthCalledWith(2, "/informes/42/versiones",
      { params: { page: 3, per_page: 10 }, signal });
  });

  it("distingue creación, corrección y anulación, revisión clínica y contenido previo", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    try {
      render(<ReportHistoryPanel patient={patientA} />);
      expect(await screen.findByRole("button", { name: /Campo visual 1/ })).toBeInTheDocument();
      expect(screen.getByText(/Inactivo · no vigente/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Campo visual 1/ }));
      expect(await screen.findByRole("button", { name: /1 · Creación \(histórica\)/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /2 · Corrección \(histórica\)/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /3 · Anulación \(última\)/ })).toBeInTheDocument();
      expect(screen.getByText(/Revisión clínica actual 3/)).toBeInTheDocument();
      expect(screen.getByText(/Formato clínico \(schema_version\): 1/)).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Contenido de la revisión 1" }))
        .getByText(/Contenido reservado 1/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /2 · Corrección/ }));
      expect(screen.getByRole("region", { name: "Contenido de la revisión 2" }))
        .toHaveTextContent("Conclusión de revisión 2");
      expect(screen.queryByText("Conclusión de revisión 3")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /3 · Anulación/ }));
      expect(screen.getByRole("region", { name: "Contenido de la revisión 3" }))
        .toHaveTextContent("Motivo 3");
      expect(screen.getByText(/Este informe no está vigente/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Editar|Anular|Eliminar|Restaurar/ })).not.toBeInTheDocument();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally { log.mockRestore(); warn.mockRestore(); }
  });

  it("no atribuye una migración inicial a un profesional o creación histórica inventados", async () => {
    history.mockResolvedValue({ data: [summary(3, "INACTIVO")], pagination: page(1) });
    versions.mockResolvedValue({ data: detail(3, 7, "INACTIVO", [
      { ...version(1, "MIGRACION_INICIAL", "INACTIVO"), es_actual: true }]), pagination: page(1) });
    render(<ReportHistoryPanel patient={patientA} />);
    fireEvent.click(await screen.findByRole("button", { name: /Campo visual 3/ }));
    expect(await screen.findByRole("button", { name: /1 · Migración inicial/ })).toBeInTheDocument();
    expect(screen.getByText("Autor histórico no acreditado")).toBeInTheDocument();
    expect(screen.getByText(/Estado conocido en la migración/)).toBeInTheDocument();
    expect(screen.getByText(/Este informe no está vigente/)).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando el paciente no tiene informes", async () => {
    history.mockResolvedValue({ data: [], pagination: page(0) });
    render(<ReportHistoryPanel patient={patientA} />);
    expect(await screen.findByText("No se encontraron informes históricos para este paciente.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(versions).not.toHaveBeenCalled();
  });

  it("descarta respuestas tardías al cambiar de paciente y de informe", async () => {
    const oldCatalog = pending<Awaited<ReturnType<typeof getPatientReportHistory>>>();
    history.mockImplementation((id) => id === patientA.id ? oldCatalog.promise : Promise.resolve({
      data: [summary(4, "ACTIVO"), summary(5, "ANULADO")], pagination: page(2),
    }));
    const { rerender } = render(<ReportHistoryPanel key={patientA.id} patient={patientA} />);
    rerender(<ReportHistoryPanel key={patientB.id} patient={patientB} />);
    expect(await screen.findByRole("button", { name: /Campo visual 4/ })).toBeInTheDocument();
    oldCatalog.resolve({ data: [summary(1, "ANULADO")], pagination: page(1) });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Campo visual 1/ })).not.toBeInTheDocument());

    const oldVersions = pending<Awaited<ReturnType<typeof getReportVersions>>>();
    versions.mockImplementation((id) => id === 4 ? oldVersions.promise : Promise.resolve({
      data: detail(5, patientB.id, "ANULADO", [version(3, "ANULACION", "ANULADO")]), pagination: page(1),
    }));
    fireEvent.click(screen.getByRole("button", { name: /Campo visual 4/ }));
    fireEvent.click(screen.getByRole("button", { name: /Campo visual 5/ }));
    expect(await screen.findByRole("button", { name: /3 · Anulación/ })).toBeInTheDocument();
    oldVersions.resolve({ data: detail(4, patientB.id, "ACTIVO", [version(1, "CREACION", "ACTIVO")]),
      pagination: page(1) });
    await waitFor(() => expect(screen.queryByRole("button", { name: /1 · Creación/ })).not.toBeInTheDocument());
    expect(screen.getByText(/Este informe no está vigente/)).toBeInTheDocument();
  });

  it("pagina sin mezclar versiones ni informes previos", async () => {
    history.mockImplementation(async (_id, number) => ({ data: [summary(number === 1 ? 1 : 2, "ACTIVO")],
      pagination: page(11, number) }));
    versions.mockImplementation(async (id, number) => ({ data: detail(id, 7, "ACTIVO", [
      version(number === 1 ? 1 : 11, number === 1 ? "CREACION" : "CORRECCION", "ACTIVO")]),
      pagination: page(11, number) }));
    render(<ReportHistoryPanel patient={patientA} />);
    fireEvent.click(await screen.findByRole("button", { name: /Campo visual 1/ }));
    expect(await screen.findByRole("button", { name: /1 · Creación/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Siguiente" })[1]);
    expect(await screen.findByRole("button", { name: /11 · Corrección/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^1 · Creación/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Siguiente" })[0]);
    expect(await screen.findByRole("button", { name: /Campo visual 2/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /11 · Corrección/ })).not.toBeInTheDocument();
    expect(history).toHaveBeenCalledWith(7, 2, expect.any(AbortSignal));
    expect(versions).toHaveBeenCalledWith(1, 2, expect.any(AbortSignal));
  });

  it.each([401, 403, 404, 409, 500])("expone un error seguro ante HTTP %s sin contenido privado", async (status) => {
    history.mockRejectedValue({ response: { status, data: { message: "SECRETO DEL SERVIDOR" } } });
    render(<ReportHistoryPanel patient={patientA} />);
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("SECRETO DEL SERVIDOR");
    expect(screen.queryByText(/Contenido reservado/)).not.toBeInTheDocument();
  });

  it("un 403 no confunde historial desactivado con denegación real ni conserva datos anteriores", async () => {
    const { rerender } = render(<ReportHistoryPanel key={patientA.id} patient={patientA} />);
    fireEvent.click(await screen.findByRole("button", { name: /Campo visual 1/ }));
    expect(await screen.findByRole("region", { name: "Contenido de la revisión 1" }))
      .toHaveTextContent("Contenido reservado 1");
    history.mockRejectedValue({ response: { status: 403 } });
    rerender(<ReportHistoryPanel key={patientB.id} patient={patientB} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("El historial no está disponible o el acceso está restringido.");
    expect(screen.queryByText(/Acceso denegado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sesión no está disponible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contenido reservado 1/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Campo visual 1/ })).not.toBeInTheDocument();
    expect(versions).toHaveBeenCalledTimes(1);
  });
});
