// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { ImageUploader } from "../features/diagnosis/components/ImageUploader";
import { crearDiagnostico, crearDiagnosticoConfirmado, consultarConfirmacionRetinografo,
  descargarImagenRetinografo, obtenerSeleccionAutomaticaRetinografo,
  registrarConfirmacionRetinografo, revocarConfirmacionRetinografo, sha256Blob,
} from "../features/diagnosis/api/diagnosisService";
import type { EyeKey, EyeState } from "../features/diagnosis/types";
import { revokePreviewUrl } from "../lib/imageUtils";

vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/diagnosis/api/diagnosisService")>();
  return { ...original, crearDiagnostico: vi.fn(), crearDiagnosticoConfirmado: vi.fn(),
    consultarConfirmacionRetinografo: vi.fn(), registrarConfirmacionRetinografo: vi.fn(),
    revocarConfirmacionRetinografo: vi.fn(), sha256Blob: vi.fn(),
    obtenerSeleccionAutomaticaRetinografo: vi.fn(), descargarImagenRetinografo: vi.fn() };
});
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn().mockResolvedValue("blob:synthetic"), revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const selection = vi.mocked(obtenerSeleccionAutomaticaRetinografo);
const download = vi.mocked(descargarImagenRetinografo);
const register = vi.mocked(registrarConfirmacionRetinografo);
const status = vi.mocked(consultarConfirmacionRetinografo);
const revoke = vi.mocked(revocarConfirmacionRetinografo);
const confirmedPost = vi.mocked(crearDiagnosticoConfirmado);
const manualPost = vi.mocked(crearDiagnostico);
const hash = vi.mocked(sha256Blob);
const token = "d".repeat(64);
const expires = "2099-01-01T00:00:00Z";

const candidate = (eye: EyeKey) => ({ filename: `synthetic_fundus_${eye === "OD" ? "R" : "L"}.png`,
  ojo: eye, ojo_original: eye === "OD" ? "R" as const : "L" as const,
  tipo_imagen: "fundus", secuencia: 1, extension: "png", fecha_exportacion: "2026-01-01T10:00:00",
  mime_type: "image/png" });

async function setup(eyes: EyeKey[] = ["OD"], patient = 7) {
  selection.mockResolvedValueOnce({ paciente_id: patient, encontradas: eyes.length,
    imagenes: Object.fromEntries(eyes.map((eye) => [eye, candidate(eye)])) });
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => {
    hook.result.current.selectPatient({ id: patient, nombres: "Paciente", apellidos: "Sintético" } as Parameters<typeof hook.result.current.selectPatient>[0]);
    hook.result.current.selectVisita(null);
  });
  await act(async () => hook.result.current.autoSelectRetinographImages());
  act(() => hook.result.current.goNext());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  download.mockResolvedValue(new Blob(["original-blob"], { type: "image/png" }));
  hash.mockResolvedValue("a".repeat(64));
  register.mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({
    identificador: token, paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: expires,
  }));
  status.mockImplementation(async () => ({ paciente_id: 7, ojo_confirmado: "Derecho",
    estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: expires }));
  confirmedPost.mockResolvedValue({ visita_id: 30, detalle_id: 11, diagnostico_codigo: 2,
    diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Guardado" });
  manualPost.mockResolvedValue({ visita_id: 30, detalle_id: 12, diagnostico_codigo: 2,
    diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Guardado" });
});

describe("28C.5 revisión profesional separada de IA", () => {
  it("OD y OI son candidatas independientes; selección y nombre no inician IA", async () => {
    const hook = await setup(["OD", "OI"]);
    expect(download).toHaveBeenCalledTimes(2);
    expect(hook.result.current.eyes.OD.candidate?.ojo_original).toBe("R");
    expect(hook.result.current.eyes.OI.candidate?.ojo_original).toBe("L");
    expect(hook.result.current.eyes.OD.confirmation).toBe("pendiente");
    expect(hook.result.current.canNext).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:synthetic");
  });

  it.each(["OD", "OI"] as EyeKey[])("confirma expresamente %s con el hash del archivo visualizado, sin duplicar clic", async (eye) => {
    const hook = await setup([eye]);
    let finish!: (value: Awaited<ReturnType<typeof registrarConfirmacionRetinografo>>) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.confirmEye(eye); void hook.result.current.confirmEye(eye); });
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(hash).toHaveBeenCalledWith(hook.result.current.eyes[eye].file);
    expect(register).toHaveBeenCalledWith({ paciente_id: 7, nombre_exportacion: candidate(eye).filename,
      ojo_confirmado: eye === "OD" ? "Derecho" : "Izquierdo", sha256_previsualizacion: "a".repeat(64) });
    await act(async () => finish({ identificador: token, paciente_id: 7,
      ojo_confirmado: eye === "OD" ? "Derecho" : "Izquierdo", estado: "CONFIRMADA", fecha_expiracion: expires }));
    expect(hook.result.current.eyes[eye].confirmation).toBe("CONFIRMADA");
    expect(hook.result.current.eyes[eye === "OD" ? "OI" : "OD"].confirmation).toBeUndefined();
    expect(JSON.stringify(hook.result.current.eyes)).not.toContain(token);
    expect(sessionStorage.length).toBe(0);
    hook.unmount();
  });

  it("sin Web Crypto no envía registro ni habilita inferencia", async () => {
    const hook = await setup();
    hash.mockRejectedValueOnce(new Error("SHA-256 no disponible en este navegador."));
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(register).not.toHaveBeenCalled();
    expect(hook.result.current.eyes.OD.confirmation).toBe("pendiente");
    expect(hook.result.current.processingNotice).toMatch(/SHA-256/);
    expect(hook.result.current.canNext).toBe(false);
    hook.unmount();
  });

  it("OD confirmada puede procesarse sin enviar imagen aunque OI siga pendiente; decisión médica pendiente", async () => {
    const hook = await setup(["OD", "OI"]);
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(hook.result.current.canNext).toBe(true);
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false), { timeout: 3500 });
    expect(status).toHaveBeenCalledWith(token);
    expect(confirmedPost).toHaveBeenCalledWith(7, "Derecho", token, undefined);
    expect(manualPost).not.toHaveBeenCalled();
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONSUMIDA");
    expect(hook.result.current.eyes.OI.confirmation).toBe("pendiente");
    expect(hook.result.current.eyeProcessing.OD).toBe("pendiente_validacion");
    expect(hook.result.current.results.OI).toBeUndefined();
    await act(async () => hook.result.current.revokeConfirmation("OD"));
    expect(revoke).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("revoca solamente confirmación vigente, no consumida, y consulta estados expirado/revocado", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.revokeConfirmation("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    expect(hook.result.current.eyes.OD.confirmation).toBe("REVOCADA");
    expect(hook.result.current.canNext).toBe(false);
    await act(async () => hook.result.current.revokeConfirmation("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it.each(["EXPIRADA", "REVOCADA", "CONSUMIDA"] as const)("estado remoto %s impide inferencia", async (kind) => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho",
      estado: kind === "EXPIRADA" ? "CONFIRMADA" : kind,
      vigente: false, expirada: kind === "EXPIRADA", fecha_expiracion: kind === "EXPIRADA" ? "2020-01-01T00:00:00Z" : expires });
    await act(async () => hook.result.current.checkConfirmation("OD"));
    expect(hook.result.current.eyes.OD.confirmation).toBe(kind);
    expect(hook.result.current.canNext).toBe(false);
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("respuesta tardía de registro no restaura comprobante de otro paciente u otro archivo", async () => {
    const hook = await setup();
    let finish!: (value: Awaited<ReturnType<typeof registrarConfirmacionRetinografo>>) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.confirmEye("OD"); });
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    act(() => hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    await act(async () => finish({ identificador: token, paciente_id: 7, ojo_confirmado: "Derecho",
      estado: "CONFIRMADA", fecha_expiracion: expires }));
    expect(JSON.stringify(hook.result.current.eyes)).not.toContain(token);
    expect(hook.result.current.eyes.OD.confirmation).toBeUndefined();
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("si cambia el archivo durante el registro, descarta la respuesta tardía y no mezcla modalidades", async () => {
    const hook = await setup();
    let finish!: (value: Awaited<ReturnType<typeof registrarConfirmacionRetinografo>>) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.confirmEye("OD"); });
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    await act(async () => hook.result.current.handleFile("OD", new File(["new"], "manual.jpg", { type: "image/jpeg" })));
    await act(async () => finish({ identificador: token, paciente_id: 7, ojo_confirmado: "Derecho",
      estado: "CONFIRMADA", fecha_expiracion: expires }));
    expect(hook.result.current.eyes.OD.candidate).toBeUndefined();
    expect(JSON.stringify(hook.result.current.eyes)).not.toContain(token);
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(manualPost).toHaveBeenCalledOnce();
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("respuesta tardía de selección no repone candidata de otro paciente ni conserva Blob URL", async () => {
    let finish!: (value: Awaited<ReturnType<typeof obtenerSeleccionAutomaticaRetinografo>>) => void;
    selection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    act(() => { void hook.result.current.autoSelectRetinographImages(); });
    act(() => hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    await act(async () => finish({ paciente_id: 7, encontradas: 1, imagenes: { OD: candidate("OD") } }));
    expect(download).not.toHaveBeenCalled();
    expect(hook.result.current.eyes.OD.file).toBeNull();
    hook.unmount();
  });

  it("libera la URL temporal si termina una descarga tras cambiar de paciente", async () => {
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 1, imagenes: { OD: candidate("OD") } });
    let finish!: (value: Blob) => void;
    download.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    act(() => { void hook.result.current.autoSelectRetinographImages(); });
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    act(() => hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    await act(async () => finish(new Blob(["synthetic"], { type: "image/png" })));
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:synthetic");
    hook.unmount();
  });

  it("rechaza respuesta de asociación con paciente u ojo diferente sin conservar comprobante", async () => {
    const hook = await setup(["OI"]);
    register.mockResolvedValueOnce({ identificador: token, paciente_id: 8, ojo_confirmado: "Derecho",
      estado: "CONFIRMADA", fecha_expiracion: expires });
    await act(async () => hook.result.current.confirmEye("OI"));
    expect(hook.result.current.eyes.OI.confirmation).toBe("incierta");
    expect(hook.result.current.eyes.OI.hasConfirmation).toBeUndefined();
    expect(hook.result.current.canNext).toBe(false);
    hook.unmount();
  });

  it("estado ajeno no habilita comprobante y requiere nueva revisión", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockResolvedValueOnce({ paciente_id: 8, ojo_confirmado: "Izquierdo",
      estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: expires });
    await act(async () => hook.result.current.checkConfirmation("OD"));
    expect(hook.result.current.eyes.OD.confirmation).toBe("incierta");
    expect(hook.result.current.canNext).toBe(false);
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("consulta tardía no sustituye un estado CONSUMIDA más reciente", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    let finish!: (value: Awaited<ReturnType<typeof consultarConfirmacionRetinografo>>) => void;
    status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONSUMIDA",
        vigente: false, expirada: false, fecha_expiracion: expires });
    act(() => { void hook.result.current.checkConfirmation("OD"); });
    await act(async () => { await hook.result.current.checkConfirmation("OD"); });
    await act(async () => finish({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }));
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONSUMIDA");
    hook.unmount();
  });

  it("sin respuesta del estado o revocación no presupone operación deshecha", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockRejectedValueOnce({ response: { status: 503 } });
    await act(async () => hook.result.current.checkConfirmation("OD"));
    expect(hook.result.current.eyes.OD.confirmation).toBe("incierta");
    expect(hook.result.current.eyes.OD.hasConfirmation).toBe(true);
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("no confirma cuando la selección asigna R al ojo izquierdo", async () => {
    const hook = await setup([]);
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 1, imagenes: {
      OI: { ...candidate("OI"), ojo_original: "R" },
    } });
    await act(async () => hook.result.current.autoSelectRetinographImages());
    expect(hook.result.current.eyes.OI.candidate).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
    hook.unmount();
  });

  it.each([400, 401, 403, 404, 409, 413, 422, 500, 503, undefined])("registro %s no reintenta ni habilita inferencia", async (code) => {
    const hook = await setup();
    register.mockRejectedValueOnce(code ? { response: { status: code } } : new Error("network"));
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(register).toHaveBeenCalledOnce();
    expect(hook.result.current.canNext).toBe(false);
    expect(hook.result.current.processingNotice).toBeTruthy();
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("500 en inferencia consulta comprobante, no repite POST ni inventa visita", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    confirmedPost.mockRejectedValueOnce({ response: { status: 500 } });
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }).mockResolvedValueOnce({
        paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONSUMIDA", vigente: false,
        expirada: false, fecha_expiracion: expires,
      });
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(confirmedPost).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(2);
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONSUMIDA");
    expect(hook.result.current.eyeProcessing.OD).toBe("incierto");
    expect(hook.result.current.confirmedVisitId).toBeNull();
    expect(hook.result.current.processingNotice).toMatch(/historial/i);
    hook.unmount();
  });

  it("si el estado expiró justo antes del POST, no envía inferencia ni inventa persistencia incierta", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONFIRMADA",
      vigente: false, expirada: true, fecha_expiracion: "2020-01-01T00:00:00Z" });
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(confirmedPost).not.toHaveBeenCalled();
    expect(hook.result.current.eyeProcessing.OD).toBe("error");
    expect(hook.result.current.eyes.OD.confirmation).toBe("EXPIRADA");
    hook.unmount();
  });

  it("503 de inferencia no se presenta como rechazo clínico ni repite el POST", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    confirmedPost.mockRejectedValueOnce({ response: { status: 503 } });
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(confirmedPost).toHaveBeenCalledOnce();
    expect(hook.result.current.eyeProcessing.OD).toBe("error");
    expect(hook.result.current.processingNotice).toMatch(/no está disponible/i);
    expect(hook.result.current.processingNotice).not.toMatch(/no retiniana/i);
    hook.unmount();
  });

  it("OD confirmado conserva su resultado si la inferencia confirmada de OI falla", async () => {
    const hook = await setup(["OD", "OI"]);
    const second = "e".repeat(64);
    register.mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({
      identificador: ojo_confirmado === "Derecho" ? token : second,
      paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: expires,
    }));
    status.mockImplementation(async (value) => ({ paciente_id: 7,
      ojo_confirmado: value === token ? "Derecho" : "Izquierdo",
      estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: expires }));
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.confirmEye("OI"));
    // La primera llamada es OD: éxito; la segunda, OI: fallo controlado.
    confirmedPost.mockReset();
    confirmedPost.mockResolvedValueOnce({ visita_id: 30, detalle_id: 11, diagnostico_codigo: 2,
      diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Guardado" })
      .mockRejectedValueOnce({ response: { status: 503 } });
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(confirmedPost.mock.calls.map(([, eye, value, visit]) => [eye, value, visit]))
      .toEqual([["Derecho", token, undefined], ["Izquierdo", second, 30]]);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.eyeProcessing.OI).toBe("error");
    expect(hook.result.current.validatedEyes).toEqual({});
    hook.unmount();
  });
});

it("interfaz muestra nombre, metadatos y declaración expresa por ojo sin validar diagnóstico IA", () => {
  const file = new File(["synthetic"], candidate("OD").filename, { type: "image/png" });
  const eyes: Record<EyeKey, EyeState> = { OD: { file, preview: "blob:synthetic", isExistingImage: true,
    candidate: candidate("OD"), confirmation: "pendiente" }, OI: { file: null, preview: null } };
  const onConfirm = vi.fn();
  const ui = render(<ImageUploader eyes={eyes} embedded handleFile={vi.fn()} clearEye={vi.fn()}
    patientName="Paciente Sintético" onConfirm={onConfirm} />);
  expect(screen.getByText(/Paciente Sintético/)).toBeInTheDocument();
  expect(screen.getByText(/synthetic_fundus_R.png/)).toBeInTheDocument();
  expect(screen.getByText(/secuencia 1/)).toBeInTheDocument();
  expect(screen.getByText(/pendiente de revisión profesional/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Confirmo paciente, imagen y ojo OD/i }));
  expect(onConfirm).toHaveBeenCalledWith("OD");
  expect(screen.queryByRole("button", { name: /validar diagnóstico/i })).not.toBeInTheDocument();
  ui.unmount();
});
