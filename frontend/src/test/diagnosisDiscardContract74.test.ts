import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import fixture from "./fixtures/diagnosisDiscardContract74.json";
import { discardResults, getDiscardContext, getDiscardOperation, getInferenceRevision } from "../features/diagnosis/api/diagnosisDiscardService";
import type { DiscardRequest } from "../features/diagnosis/api/diagnosisDiscardService";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// Este fixture es comparado con rutas/servicios/repositorios reales por
// backend/test_discard_integration74.py. Solo su fecha dinámica está normalizada.
const request: DiscardRequest = { ...fixture.request, confirmo_descarte: true };
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
beforeEach(() => { vi.resetAllMocks(); });

describe("contrato HTTP Flask real → cliente TypeScript", () => {
  it.each(["context", "remaining", "emptyVisit"] as const)("consume contexto %s sin confundir padre y visita", async (name) => {
    get.mockResolvedValueOnce({ data: fixture[name].body });
    expect(await getDiscardContext(30)).toEqual(fixture[name].body.data);
    expect(get).toHaveBeenCalledExactlyOnceWith("/diagnosticar/visita/30/contexto-descarte");
  });
  it.each(["discard", "repeated", "lastDiscard"] as const)("consume operación %s y envía el payload exacto", async (name) => {
    post.mockResolvedValueOnce({ data: fixture[name].body });
    expect(await discardResults(30, request)).toEqual(fixture[name].body.data);
    expect(post).toHaveBeenCalledExactlyOnceWith("/diagnosticar/visita/30/descartar-resultados", request);
  });
  it.each(["operation", "cleaned"] as const)("consume conciliación %s con su estado de limpieza", async (name) => {
    get.mockResolvedValueOnce({ data: fixture[name].body });
    expect(await getDiscardOperation(30, request.operacion_id)).toEqual(fixture[name].body.data.operacion);
  });
  it("la ausencia de operación no se convierte en éxito", async () => {
    get.mockResolvedValueOnce({ data: fixture.unconfirmed.body });
    expect(await getDiscardOperation(30, request.operacion_id)).toBeNull();
  });
  it.each(["revisionBefore", "revisionAfter"] as const)("consume revisión %s", async (name) => {
    get.mockResolvedValueOnce({ data: fixture[name].body });
    expect(await getInferenceRevision(30, 7)).toBe(fixture[name].body.data.revision_inferencia);
    expect(get).toHaveBeenCalledExactlyOnceWith("/visitas/30/revision-inferencia");
  });
  it.each(["invalid", "conflict", "forbidden", "unavailable"] as const)("no transforma el error Flask %s en una confirmación", async (name) => {
    const error = { response: { status: fixture[name].status, data: fixture[name].body } };
    post.mockRejectedValueOnce(error);
    await expect(discardResults(30, request)).rejects.toBe(error);
  });
});
