import { beforeEach, expect, it, vi } from "vitest";
import api from "../lib/api";
import { CatalogFormatError, getCatalog } from "../features/configuration/api/configurationService";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it("acepta el contrato del catálogo real: nombre descriptivo, código DNI e ID numérico", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: {
    success: true, data: { document_types: [
      { id: 1, nombre: "Documento Nacional de Identidad", codigo: "DNI" },
      { id: 2, nombre: "Carne de Extranjeria", codigo: "CE" },
      { id: 3, nombre: "Pasaporte", codigo: "PAS" },
    ], roles: [], positions: [], permissions: [] },
    capabilities: { read: true, create: true, edit: true, assign_roles: true }, permissions_editable: false,
  } } as never);
  const result = await getCatalog();
  expect(api.get).toHaveBeenCalledWith("/configuracion/catalogo");
  expect(result.data.document_types.find((type) => type.codigo === "DNI"))
    .toEqual({ id: 1, nombre: "Documento Nacional de Identidad", codigo: "DNI" });
});

it.each<{ document_types: unknown[] }>([
  { document_types: [{ id: 1, nombre: "Documento Nacional de Identidad" }] }, // respuesta del servidor anterior
  { document_types: [] },
  { document_types: [{ id: "1", nombre: "Documento Nacional de Identidad", codigo: "DNI" }] },
])("rechaza catálogo incompleto en vez de interpretar DNI como ausente: $document_types", async ({ document_types }) => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: { success: true, data: { document_types } } } as never);
  await expect(getCatalog()).rejects.toThrow(CatalogFormatError);
});
