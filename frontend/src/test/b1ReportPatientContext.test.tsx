// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { obtenerPacientesRecientes, obtenerVisitasPaciente } from "../features/patients/api/patientService";
import { useReports } from "../features/reports/hooks/useReports";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../features/patients/api/patientService", () => ({
  buscarPacientes: vi.fn(), obtenerPacientesRecientes: vi.fn(), obtenerVisitasPaciente: vi.fn(),
}));

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const patient = (id: number) => ({ id, nombres: `Paciente ${id}`, apellidos: "Sintético",
  tipo_doc_abrev: "DNI", nro_documento: String(id) });
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerPacientesRecientes).mockResolvedValue([]);
  vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
});
afterEach(() => cleanup());

describe("Contexto de paciente en informes", () => {
  const visit = (total: number) => ({ visita_id: 3, fecha_visita: "2026-10-13T17:51:00Z",
    fecha_visita_origen: "UTC_VERIFICADO" as const, medico_tratante: "Profesional", total_informes: total });

  it("vuelve a consultar el conteo al regresar del Paso 3, sin incrementar tras un guardado fallido", async () => {
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([visit(2)]).mockResolvedValueOnce([visit(2)]);
    const { result } = renderHook(() => useReports(), { wrapper });
    act(() => result.current.toggleTipo({ id: 4, nombre: "Paquimetría", descripcion: "" }));
    act(() => result.current.goNext());
    act(() => result.current.selectPatient(patient(7)));
    await waitFor(() => expect(result.current.visitas[0]?.total_informes).toBe(2));
    act(() => result.current.selectVisita(result.current.visitas[0]));
    act(() => result.current.goNext());
    expect(result.current.step).toBe(3);
    result.current.formRefs.current[4] = { isValid: () => true, getData: () => ({ nota: "Sintética" }) };
    vi.mocked(api.post).mockRejectedValueOnce(new Error("no se guardó"));
    await act(async () => result.current.saveAll());
    expect(result.current.step).toBe(3);
    act(() => result.current.goBack());
    await waitFor(() => expect(vi.mocked(obtenerVisitasPaciente)).toHaveBeenCalledTimes(2));
    expect(result.current.visitas[0].total_informes).toBe(2);
  });

  it("consulta el nuevo conteo del servidor después de guardar correctamente y volver a seleccionar paciente", async () => {
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([visit(2)]).mockResolvedValueOnce([visit(3)]);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { data: { visita_id: 3 } } });
    const { result } = renderHook(() => useReports(), { wrapper });
    act(() => result.current.toggleTipo({ id: 4, nombre: "Paquimetría", descripcion: "" }));
    act(() => result.current.goNext());
    act(() => result.current.selectPatient(patient(7)));
    await waitFor(() => expect(result.current.visitas[0]?.total_informes).toBe(2));
    act(() => result.current.selectVisita(result.current.visitas[0]));
    act(() => result.current.goNext());
    result.current.formRefs.current[4] = { isValid: () => true, getData: () => ({ nota: "Sintética" }) };
    await act(async () => result.current.saveAll());
    expect(result.current.step).toBe(1);
    act(() => result.current.selectPatient(patient(7)));
    await waitFor(() => expect(result.current.visitas[0]?.total_informes).toBe(3));
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it("prioriza fechas acreditadas antes del recorte sin ocultar históricos al expandir", async () => {
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([
      { visita_id: 99, fecha_visita: "2099-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 98, fecha_visita: "1900-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 8, fecha_visita: "2030-01-01T01:00:00Z", fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 7, fecha_visita: "2030-01-02T01:00:00Z", fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético" },
    ]);
    const { result } = renderHook(() => useReports(), { wrapper });
    act(() => result.current.selectPatient(patient(7)));
    await waitFor(() => expect(result.current.visitas.map((v) => v.visita_id)).toEqual([7, 8]));
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([
      { visita_id: 99, fecha_visita: "2099-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 98, fecha_visita: "1900-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 8, fecha_visita: "2030-01-01T01:00:00Z", fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético" },
      { visita_id: 7, fecha_visita: "2030-01-02T01:00:00Z", fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético" },
    ]);
    await act(async () => result.current.verMasVisitas());
    expect(result.current.visitas.map((v) => v.visita_id)).toEqual([7, 8, 99, 98]);
  });

  it("no acepta respuestas clínicas tardías de otro paciente ni tras limpiar la selección", async () => {
    const oldVisits = pending<Awaited<ReturnType<typeof obtenerVisitasPaciente>>>();
    const oldReports = pending<{ data: { data: { id: number }[] } }>();
    vi.mocked(obtenerVisitasPaciente).mockImplementation((id) =>
      id === 7 ? oldVisits.promise : Promise.resolve([]));
    vi.mocked(api.get).mockImplementation((url) =>
      url === "/informes/paciente/7" ? oldReports.promise : Promise.resolve({ data: { data: [] } }));
    const { result } = renderHook(() => useReports(), { wrapper });
    act(() => result.current.selectPatient(patient(7)));
    act(() => result.current.selectPatient(patient(8)));
    await waitFor(() => expect(result.current.selectedPatient?.id).toBe(8));
    await act(async () => {
      oldVisits.resolve([{ visita_id: 70, fecha_visita: "2030-01-01", medico_tratante: "Otro" }]);
      oldReports.resolve({ data: { data: [{ id: 71 }] } });
      await oldVisits.promise;
      await oldReports.promise;
    });
    await waitFor(() => expect(result.current.isLoadingVisitas).toBe(false));
    expect(result.current.visitas).toEqual([]);
    expect(result.current.informes).toEqual([]);
    act(() => result.current.clearPatient());
    expect(result.current.selectedPatient).toBeNull();
    expect(result.current.informesExistentes).toEqual([]);
  });
});
