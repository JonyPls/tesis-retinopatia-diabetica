// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { crearDiagnostico, obtenerDetallesVisita, validarDetalleDiagnostico } from "../features/diagnosis/api/diagnosisService";
import { toast } from "../hooks/use-toast";

vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", () => ({
  crearDiagnostico: vi.fn(), obtenerDetallesVisita: vi.fn(), validarDetalleDiagnostico: vi.fn(),
  resultadoPersistido: (id: number, detail: { detalle_id: number; ojo: string; resultado_ia: number; diagnostico_texto: string; estado_validacion: string; diagnostico_final: number | null; confianza_general: number; probabilidades_detalle: Record<string, number>; imagen_url: string; gradcam_url: string }) => ({
    visita_id: id, detalle_id: detail.detalle_id, diagnostico_codigo: detail.resultado_ia,
    diagnostico_texto: detail.diagnostico_texto, confianza_general: detail.confianza_general,
    probabilidades_detalle: detail.probabilidades_detalle, estado_validacion: detail.estado_validacion,
    diagnostico_final: detail.diagnostico_final, imagen_url: detail.imagen_url, gradcam_url: detail.gradcam_url,
  }),
}));
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn().mockResolvedValue("blob:synthetic-preview"),
  revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const create = vi.mocked(crearDiagnostico);
const validate = vi.mocked(validarDetalleDiagnostico);
const details = vi.mocked(obtenerDetallesVisita);
const notify = vi.mocked(toast);

async function prepared() {
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => {
    hook.result.current.selectPatient({ id: 7, nombres: "Paciente", apellidos: "Ficticio" } as Parameters<typeof hook.result.current.selectPatient>[0]);
    hook.result.current.selectVisita(null);
  });
  await act(async () => {
    await hook.result.current.handleFile("OD", new File(["a"], "od.jpg"));
    await hook.result.current.handleFile("OI", new File(["b"], "oi.jpg"));
  });
  act(() => hook.result.current.goNext());
  act(() => hook.result.current.goNext());
  await waitFor(() => expect(hook.result.current.results.OI?.detalle_id).toBe(12), { timeout: 3500 });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  details.mockResolvedValue([]);
  create.mockImplementation(async (_id, eye) => ({
    visita_id: 30, detalle_id: eye === "Derecho" ? 11 : 12, diagnostico_codigo: 2,
    diagnostico_texto: "RD Moderada", confianza_general: 0.8,
    probabilidades_detalle: {}, mensaje: "", gradcam_url: "synthetic-gradcam.jpg",
  }));
});

describe("primera validación médica por ojo", () => {
  it("marca solo OD confirmado, no repite OD y conserva OI pendiente tras un error", async () => {
    validate.mockResolvedValueOnce({ success: true, data: { estado_validacion: "APROBADO" }, message: "Guardado" } as Awaited<ReturnType<typeof validarDetalleDiagnostico>>)
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({ success: true, data: { estado_validacion: "APROBADO" }, message: "Guardado" } as Awaited<ReturnType<typeof validarDetalleDiagnostico>>);
    const hook = await prepared();
    await act(async () => { await hook.result.current.validateAll(); });
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO" });
    expect(validate.mock.calls.map(([id]) => id)).toEqual([11, 12]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ description: "No tiene permiso vigente para validar diagnósticos." }));
    await act(async () => { await hook.result.current.validateAll(); });
    expect(validate.mock.calls.map(([id]) => id)).toEqual([11, 12, 12]);
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO", OI: "APROBADO" });
    hook.unmount();
  });

  it("409 no supone una validación local y solicita actualizar la vista", async () => {
    validate.mockRejectedValueOnce({ response: { status: 409 } });
    const hook = await prepared();
    await act(async () => { await hook.result.current.validateAll(); });
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(hook.result.current.validationConflict).toBe(true);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("Actualice la vista") }));
    await act(async () => { await hook.result.current.validateAll(); });
    expect(validate).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("401 y 400 no se presentan como diagnóstico inexistente ni confirman el ojo", async () => {
    validate.mockRejectedValueOnce({ response: { status: 401 } })
      .mockRejectedValueOnce({ response: { status: 400, data: { message: "Grado final no permitido." } } });
    const hook = await prepared();
    await act(async () => { await hook.result.current.validateAll(); });
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("sesión") }));
    await act(async () => { await hook.result.current.validateAll(); });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ description: "Grado final no permitido." }));
    expect(validate.mock.calls.map(([id]) => id)).toEqual([11, 11]);
    hook.unmount();
  });

  it("el POST rechazado con 403, 409 o 503 no muestra un diagnóstico nuevo ni rechazo clínico", async () => {
    for (const status of [403, 409, 503]) {
      const message = status === 403 ? "No autorizado." : status === 409
        ? "Ya existe un resultado para este ojo." : "Validación de imagen no disponible.";
      create.mockRejectedValueOnce({ response: { status,
        data: { message } } });
      const hook = renderHook(() => useDiagnosis(), { wrapper });
      act(() => {
        hook.result.current.selectPatient({ id: 7, nombres: "Paciente", apellidos: "Ficticio" } as Parameters<typeof hook.result.current.selectPatient>[0]);
        hook.result.current.selectVisita(null);
      });
      await act(async () => { await hook.result.current.handleFile("OD", new File(["a"], "od.jpg")); });
      act(() => hook.result.current.goNext());
      act(() => hook.result.current.goNext());
      await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
      expect(hook.result.current.modalPhase).toBe("idle");
      expect(hook.result.current.results).toEqual({});
      expect(hook.result.current.validatedEyes).toEqual({});
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        description: expect.stringContaining(status === 403 ? "autorización" : status === 409 ? "No se recibió un ID" : "validación de imagen"),
      }));
      hook.unmount();
    }
  });
});
