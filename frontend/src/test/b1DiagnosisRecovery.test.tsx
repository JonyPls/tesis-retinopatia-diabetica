// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { crearDiagnostico, obtenerDetallesVisita, resultadoPersistido } from "../features/diagnosis/api/diagnosisService";
import type { DetalleDiagnosticoExistente, DiagnosisResult } from "../features/diagnosis/api/diagnosisService";
import { toast } from "../hooks/use-toast";

vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/diagnosis/api/diagnosisService")>();
  return { ...original, crearDiagnostico: vi.fn(), obtenerDetallesVisita: vi.fn() };
});
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn().mockResolvedValue("blob:synthetic"), revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const create = vi.mocked(crearDiagnostico);
const read = vi.mocked(obtenerDetallesVisita);
const result = (eye: "OD" | "OI", visitId = 30): DiagnosisResult => ({
  visita_id: visitId, detalle_id: eye === "OD" ? 11 : 12, diagnostico_codigo: 2,
  diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {},
  gradcam_url: "synthetic-gradcam.jpg", mensaje: "Guardado",
});
const detail = (eye: "OD" | "OI", state: DetalleDiagnosticoExistente["estado_validacion"] = "PENDIENTE"): DetalleDiagnosticoExistente => ({
  detalle_id: eye === "OD" ? 11 : 12, ojo: eye, resultado_ia: 2,
  diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {},
  diagnostico_final: state === "CORREGIDO" ? 3 : state === "APROBADO" ? 2 : null,
  estado_validacion: state, comentario_medico: null, motivo_correccion: null,
  imagen_url: "original.jpg", gradcam_url: "synthetic-gradcam.jpg",
});

async function start(eyes: ("OD" | "OI")[], visitId?: number) {
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => {
    hook.result.current.selectPatient({ id: 7, nombres: "Paciente", apellidos: "Ficticio" } as Parameters<typeof hook.result.current.selectPatient>[0]);
    hook.result.current.selectVisita(visitId ? { visita_id: visitId } as Parameters<typeof hook.result.current.selectVisita>[0] : null);
  });
  await act(async () => {
    for (const eye of eyes) await hook.result.current.handleFile(eye, new File([eye], `${eye}.jpg`));
  });
  act(() => hook.result.current.goNext());
  act(() => hook.result.current.goNext());
  await waitFor(() => expect(hook.result.current.isSaving).toBe(false), { timeout: 3500 });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async (_id, eye) => result(eye === "Derecho" ? "OD" : "OI"));
  read.mockResolvedValue([]);
});

describe("creación secuencial y conciliación por ojo", () => {
  it("conserva ambos éxitos, visita y validación pendiente", async () => {
    const hook = await start(["OD", "OI"]);
    expect(hook.result.current.step).toBe(3);
    expect(create.mock.calls.map(([, eye, , id]) => [eye, id])).toEqual([["Derecho", undefined], ["Izquierdo", 30]]);
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.eyeProcessing).toEqual({ OD: "pendiente_validacion", OI: "pendiente_validacion" });
    expect(hook.result.current.validatedEyes).toEqual({});
    hook.unmount();
  });

  it.each([422, 503, 413, 403, 401, 400])("retiene OD y clasifica el fallo %i de OI", async (status) => {
    create.mockResolvedValueOnce(result("OD")).mockRejectedValueOnce({ response: { status } });
    const hook = await start(["OD", "OI"]);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.eyeProcessing.OI).toBe("error");
    expect(hook.result.current.step).toBe(3);
    expect(read).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    if (status === 503) expect(hook.result.current.processingNotice).not.toMatch(/no retiniana/i);
    hook.unmount();
  });

  it.each([409, 500, undefined])("reconcilia %s con GET sin reenviar el POST", async (status) => {
    create.mockResolvedValueOnce(result("OD")).mockRejectedValueOnce(status
      ? { response: { status } } : new Error("Network Error"));
    read.mockResolvedValueOnce([detail("OD"), detail("OI", "CORREGIDO")]);
    const hook = await start(["OD", "OI"]);
    expect(read).toHaveBeenCalledWith(30);
    expect(hook.result.current.results.OI).toEqual(expect.objectContaining({ detalle_id: 12, diagnostico_final: 3 }));
    expect(hook.result.current.validatedEyes).toEqual({ OI: "CORREGIDO" });
    expect(hook.result.current.eyeProcessing.OI).toBe("validado");
    expect(create).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it.each([401, 403, 404, undefined])("si GET devuelve %s no supone ausencia del resultado", async (status) => {
    create.mockResolvedValueOnce(result("OD")).mockRejectedValueOnce({ response: { status: 500 } });
    read.mockRejectedValueOnce(status ? { response: { status } } : new Error("Network Error"));
    const hook = await start(["OD", "OI"]);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.eyeProcessing.OI).toBe("incierto");
    expect(hook.result.current.processingNotice).toMatch(status === 403 ? /no tiene autorización/i : /no (fue|se pudo|se encontró|es válida)/i);
    act(() => { hook.result.current.goBack(); hook.result.current.goNext(); });
    expect(create).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("sin ID conocido no inventa una visita ni repite un POST incierto", async () => {
    create.mockRejectedValueOnce({ response: { status: 500 } });
    const hook = await start(["OD"]);
    expect(read).not.toHaveBeenCalled();
    expect(hook.result.current.confirmedVisitId).toBeNull();
    expect(hook.result.current.eyeProcessing.OD).toBe("incierto");
    act(() => hook.result.current.goNext());
    expect(create).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("admite OI como primer ojo sin afirmar OD", async () => {
    const hook = await start(["OI"], 30);
    expect(create).toHaveBeenCalledWith(7, "Izquierdo", expect.any(File), 30);
    expect(hook.result.current.eyeProcessing).toEqual({ OD: "sin_procesar", OI: "pendiente_validacion" });
    hook.unmount();
  });

  it("una respuesta tardía de otra visita/paciente no modifica el contexto actual", async () => {
    let resolve!: (value: DiagnosisResult) => void;
    create.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => {
      hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]);
      hook.result.current.selectVisita({ visita_id: 30 } as Parameters<typeof hook.result.current.selectVisita>[0]);
    });
    await act(async () => hook.result.current.handleFile("OD", new File(["a"], "a.jpg")));
    act(() => hook.result.current.goNext());
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    act(() => { hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]); hook.result.current.selectVisita(null); });
    await act(async () => resolve(result("OD", 30)));
    expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.confirmedVisitId).toBeNull();
    hook.unmount();
  });

  it("adapta detalles reales de lectura conservando IA y decisión médica separadas", () => {
    const pending = resultadoPersistido(30, detail("OD"));
    const confirmed = resultadoPersistido(30, detail("OI", "CORREGIDO"));
    expect(pending).toEqual(expect.objectContaining({ diagnostico_codigo: 2, diagnostico_final: null, estado_validacion: "PENDIENTE" }));
    expect(confirmed).toEqual(expect.objectContaining({ diagnostico_codigo: 2, diagnostico_final: 3, estado_validacion: "CORREGIDO" }));
  });
});
