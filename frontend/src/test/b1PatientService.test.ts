import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import {
  buscarPacientes,
  buscarPacientesPaginado,
  obtenerPacientesRecientes,
} from "../features/patients/api/patientService";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(api.get);

beforeEach(() => { vi.clearAllMocks(); });

describe("B1 contrato frontend de las dos rutas", () => {
  it("la búsqueda usada por informes conserva q y el arreglo data", async () => {
    const data = [{ id: 7, nombres: "Paciente", apellidos: "Sintético" }];
    get.mockResolvedValueOnce({ data: { success: true, data } });
    expect(await buscarPacientes("Pac")).toEqual(data);
    expect(get).toHaveBeenCalledWith("/pacientes/buscar", { params: { q: "Pac" } });
  });

  it("la búsqueda paginada usada por diagnóstico conserva filtros y paginación", async () => {
    const response = { data: [], pagination: { page: 2, per_page: 10, total: 11, has_more: false } };
    get.mockResolvedValueOnce({ data: { success: true, ...response } });
    expect(await buscarPacientesPaginado("Pac", { page: 2, perPage: 10 })).toEqual(response);
    expect(get).toHaveBeenCalledWith("/pacientes/buscar", {
      params: { q: "Pac", page: 2, per_page: 10 },
    });
  });

  it("recientes conserva límite y arreglo data", async () => {
    get.mockResolvedValueOnce({ data: { success: true, data: [] } });
    expect(await obtenerPacientesRecientes(6)).toEqual([]);
    expect(get).toHaveBeenCalledWith("/pacientes/recientes", { params: { limit: 6 } });
  });

  it("acepta la proyección administrativa sin ultima_visita en ambos consumidores", async () => {
    const administrative = {
      id: 7, tipo_doc_abrev: "DNI", nro_documento: "00000007",
      nombres: "Paciente", apellidos: "Sintético",
    };
    get.mockResolvedValueOnce({ data: {
      success: true, data: [administrative],
      pagination: { page: 1, per_page: 10, total: 1, has_more: false },
    } }).mockResolvedValueOnce({ data: { success: true, data: [administrative] } });
    expect((await buscarPacientesPaginado("Pac")).data[0].ultima_visita).toBeUndefined();
    expect((await obtenerPacientesRecientes())[0].ultima_visita).toBeUndefined();
  });
});
