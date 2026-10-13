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
