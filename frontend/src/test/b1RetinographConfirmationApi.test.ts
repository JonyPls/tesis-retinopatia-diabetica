// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import {
  consultarConfirmacionRetinografo, crearDiagnostico, crearDiagnosticoConfirmado,
  descargarImagenRetinografo, obtenerSeleccionAutomaticaRetinografo,
  registrarConfirmacionRetinografo, revocarConfirmacionRetinografo, sha256Blob,
} from "../features/diagnosis/api/diagnosisService";

vi.mock("../lib/api", () => ({ default: { post: vi.fn(), get: vi.fn() } }));
const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("contratos B1 de confirmación y bytes originales", () => {
  it("SHA-256 se obtiene de los bytes originales del Blob, no del nombre ni de una vista canvas", async () => {
    const blob = new NodeBlob([new Uint8Array([0, 1, 2, 255])], { type: "image/tiff" }) as unknown as Blob;
    expect(await sha256Blob(blob)).toBe("3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56");
    vi.stubGlobal("crypto", {});
    await expect(sha256Blob(blob)).rejects.toThrow("SHA-256");
  });

  it("registro, estado y revocación usan JSON Bearer del interceptor, sin secreto en URL", async () => {
    const token = "a".repeat(64);
    post.mockResolvedValueOnce({ data: { confirmacion: { identificador: token } } });
    await registrarConfirmacionRetinografo({ paciente_id: 7, nombre_exportacion: "synthetic_R.jpg",
      ojo_confirmado: "Derecho", sha256_previsualizacion: "b".repeat(64) });
    expect(post).toHaveBeenNthCalledWith(1, "/diagnosticar/retinografo/confirmaciones", {
      paciente_id: 7, nombre_exportacion: "synthetic_R.jpg", ojo_confirmado: "Derecho",
      sha256_previsualizacion: "b".repeat(64), confirmo_asociacion: true,
    });
    post.mockResolvedValueOnce({ data: { confirmacion: { estado: "CONFIRMADA" } } });
    await consultarConfirmacionRetinografo(token);
    post.mockResolvedValueOnce({ data: {} });
    await revocarConfirmacionRetinografo(token);
    expect(post).toHaveBeenNthCalledWith(2, "/diagnosticar/retinografo/confirmaciones/estado", { identificador: token });
    expect(post).toHaveBeenNthCalledWith(3, "/diagnosticar/retinografo/confirmaciones/revocar", { identificador: token });
    for (const call of post.mock.calls) expect(call[0]).not.toContain(token);
  });

  it("la inferencia confirmada envía comprobante y nunca imagen; manual conserva su multipart", async () => {
    post.mockResolvedValue({ data: { data: { visita_id: 10 } } });
    const token = "c".repeat(64);
    await crearDiagnosticoConfirmado(7, "Derecho", token, 10);
    const confirmed = post.mock.calls[0][1] as FormData;
    expect(post.mock.calls[0][0]).toBe("/diagnosticar");
    expect(Object.fromEntries(confirmed.entries())).toEqual({ paciente_id: "7", ojo_evaluado: "Derecho",
      confirmacion_exportacion: token, visita_id: "10" });
    expect(confirmed.has("imagen")).toBe(false);
    await crearDiagnostico(7, "Izquierdo", new File(["synthetic"], "synthetic.jpg"));
    const manual = post.mock.calls[1][1] as FormData;
    expect(manual.has("imagen")).toBe(true);
    expect(manual.has("confirmacion_exportacion")).toBe(false);
  });

  it("selección y Blob usan el interceptor, parámetros mínimos y cancelación GET sin comprobante", async () => {
    const controller = new AbortController();
    const blob = new Blob(["synthetic"], { type: "image/png" });
    get.mockResolvedValueOnce({ data: { data: { paciente_id: 7 } } })
      .mockResolvedValueOnce({ data: blob });
    await obtenerSeleccionAutomaticaRetinografo(7, controller.signal);
    expect(await descargarImagenRetinografo(7, "synthetic_R.png", controller.signal)).toBe(blob);
    expect(get).toHaveBeenNthCalledWith(1, "/diagnosticar/retinografo/auto-seleccion/7",
      { signal: controller.signal });
    expect(get).toHaveBeenNthCalledWith(2, "/diagnosticar/retinografo/imagen", {
      params: { paciente_id: 7, filename: "synthetic_R.png" }, responseType: "blob",
      signal: controller.signal,
    });
    expect(JSON.stringify(get.mock.calls)).not.toContain("identificador");
  });
});
