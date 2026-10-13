// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { ImageUploader } from "../features/diagnosis/components/ImageUploader";
import { AutoSelectionModal } from "../features/diagnosis/components/AutoSelectionModal";
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

const candidate = (eye: EyeKey) => ({ filename: `synthetic_Color_${eye === "OD" ? "R" : "L"}.png`,
  ojo: eye, ojo_original: eye === "OD" ? "R" as const : "L" as const,
  tipo_imagen: "Color", secuencia: 1, extension: "png", fecha_exportacion: "2026-01-01T10:00:00",
  mime_type: "image/png" });

async function setup(eyes: EyeKey[] = ["OD"], patient = 7) {
  selection.mockResolvedValueOnce({ paciente_id: patient, encontradas: eyes.length,
    imagenes: Object.fromEntries(eyes.map((eye) => [eye, candidate(eye)])),
    candidatas: eyes.map(candidate) });
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => {
    hook.result.current.selectPatient({ id: patient, nombres: "Paciente", apellidos: "Sintético" } as Parameters<typeof hook.result.current.selectPatient>[0]);
    hook.result.current.selectVisita(null);
  });
  await act(async () => hook.result.current.autoSelectRetinographImages());
  if (eyes.length) await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
  act(() => hook.result.current.goNext());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  [selection, download, register, status, revoke, hash, confirmedPost, manualPost].forEach((mock) => mock.mockReset());
  download.mockResolvedValue(new Blob(["original-blob"], { type: "image/png" }));
  hash.mockResolvedValue("a".repeat(64));
  register.mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({
    identificador: token, paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: expires,
  }));
  status.mockImplementation(async () => ({ paciente_id: 7, ojo_confirmado: "Derecho",
    estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: expires }));
  revoke.mockImplementation(async () => ({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "REVOCADA" }));
  confirmedPost.mockResolvedValue({ visita_id: 30, detalle_id: 11, diagnostico_codigo: 2,
    diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Guardado" });
  manualPost.mockResolvedValue({ visita_id: 30, detalle_id: 12, diagnostico_codigo: 2,
    diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Guardado" });
});

describe("28C.5 revisión profesional separada de IA", () => {
  it("ofrece varias fotografías Color de OD y no incorpora ninguna hasta confirmar la elegida", async () => {
    const first = candidate("OD");
    const second = { ...first, filename: "synthetic_Color_R_2.png", secuencia: 2 };
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 3,
      imagenes: { OD: second, OI: candidate("OI") }, candidatas: [first, second, candidate("OI")] });
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => {
      hook.result.current.selectPatient({ id: 7, nombres: "Paciente", apellidos: "Sintético" } as Parameters<typeof hook.result.current.selectPatient>[0]);
      hook.result.current.selectVisita(null);
    });
    await act(async () => hook.result.current.autoSelectRetinographImages());
    expect(hook.result.current.autoCandidates).toHaveLength(3);
    expect(download).not.toHaveBeenCalled();
    await act(async () => hook.result.current.selectAutoCandidate(first));
    await act(async () => hook.result.current.selectAutoCandidate(second));
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(register).not.toHaveBeenCalled();
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ nombre_exportacion: second.filename }));
    expect(hook.result.current.eyes.OD.file?.name).toBe(second.filename);
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(hook.result.current.autoPreview?.image.filename).toBe(second.filename);
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(register).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("OD y OI son candidatas independientes; selección y nombre no inician IA", async () => {
    const hook = await setup(["OD", "OI"]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(hook.result.current.autoCandidates.map((image) => image.ojo_original)).toEqual(["R", "L"]);
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.eyes.OI.file).toBeNull();
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
    expect(hash).toHaveBeenCalledWith(hook.result.current.autoPreview?.file);
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
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.eyeActionError.OD).toMatch(/No se pudo confirmar/);
    expect(hook.result.current.autoFocusEye).toBe("OD");
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
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(hook.result.current.eyeProcessing.OD).toBe("pendiente_validacion");
    expect(hook.result.current.results.OI).toBeUndefined();
    await act(async () => hook.result.current.revokeConfirmation("OD"));
    expect(revoke).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("quita OD solo después de verificar su revocación real y permite reabrir el modal", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.clearEye("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.autoPreview).toBeNull();
    expect(hook.result.current.canNext).toBe(false);
    await act(async () => hook.result.current.clearEye("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    act(() => hook.result.current.closeAutoSelection());
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 1,
      imagenes: { OD: candidate("OD") }, candidatas: [candidate("OD")] });
    await act(async () => hook.result.current.autoSelectRetinographImages());
    expect(hook.result.current.autoModalOpen).toBe(true);
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

  it.each(["OD", "OI"] as EyeKey[])("%s conserva la imagen y el token si falla la revocación", async (eye) => {
    const hook = await setup([eye]);
    status.mockImplementation(async () => ({ paciente_id: 7, ojo_confirmado: eye === "OD" ? "Derecho" : "Izquierdo",
      estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: expires }));
    revoke.mockRejectedValueOnce({ response: { status: 503 } });
    await act(async () => hook.result.current.confirmEye(eye));
    const original = hook.result.current.eyes[eye].file;
    await act(async () => hook.result.current.clearEye(eye));
    expect(hook.result.current.eyes[eye].file).toBe(original);
    expect(hook.result.current.eyes[eye].confirmation).toBe("CONFIRMADA");
    expect(hook.result.current.eyeActionError[eye]).toMatch(/No se pudo quitar/);
    expect(hook.result.current.processingNotice).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
    revoke.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: eye === "OD" ? "Derecho" : "Izquierdo", estado: "REVOCADA" });
    await act(async () => hook.result.current.clearEye(eye));
    expect(hook.result.current.eyes[eye].file).toBeNull();
    expect(hook.result.current.eyeActionError[eye]).toBeUndefined();
    hook.unmount();
  });

  it("quita OI confirmada y permite una carga manual de OD sin revocación de OD", async () => {
    const hook = await setup(["OI"]);
    status.mockResolvedValue({ paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires });
    revoke.mockResolvedValue({ paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "REVOCADA" });
    await act(async () => hook.result.current.confirmEye("OI"));
    await act(async () => hook.result.current.handleFile("OD", new File(["manual"], "manual.jpg", { type: "image/jpeg" })));
    await act(async () => hook.result.current.clearEye("OI"));
    expect(revoke).toHaveBeenCalledWith(token);
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(hook.result.current.eyes.OD.file?.name).toBe("manual.jpg");
    expect(hook.result.current.canNext).toBe(true);
    hook.unmount();
  });

  it("el error OI no se convierte en error OD y la consulta posterior permite reintentar", async () => {
    const hook = await setup(["OD", "OI"]);
    const otherToken = "e".repeat(64);
    register.mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({ identificador: ojo_confirmado === "Derecho" ? token : otherToken,
      paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: expires }));
    status.mockImplementation(async (value) => ({ paciente_id: 7,
      ojo_confirmado: value === token ? "Derecho" : "Izquierdo", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }));
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[1]));
    await act(async () => hook.result.current.confirmEye("OI"));
    status.mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.result.current.clearEye("OI"));
    expect(revoke).not.toHaveBeenCalled();
    expect(hook.result.current.eyeActionError.OI).toBeTruthy();
    expect(hook.result.current.eyeActionError.OD).toBeUndefined();
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    expect(hook.result.current.autoFocusEye).toBe("OD");
    expect(hook.result.current.eyeActionError.OI).toBeTruthy();
    expect(hook.result.current.eyeActionError.OD).toBeUndefined();
    revoke.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "REVOCADA" });
    await act(async () => hook.result.current.clearEye("OI"));
    expect(hook.result.current.eyeActionError.OI).toBeUndefined();
    hook.unmount();
  });

  it("quita OI sin alterar OD y resuelve respuesta perdida consultando estado, sin segundo POST", async () => {
    const hook = await setup(["OD", "OI"]);
    const otherToken = "e".repeat(64);
    register.mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({ identificador: ojo_confirmado === "Derecho" ? token : otherToken,
      paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: expires }));
    status.mockImplementation(async (value) => ({ paciente_id: 7,
      ojo_confirmado: value === token ? "Derecho" : "Izquierdo", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }));
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[1]));
    await act(async () => hook.result.current.confirmEye("OI"));
    revoke.mockRejectedValueOnce(new Error("lost response"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }).mockResolvedValueOnce({
      paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "REVOCADA", vigente: false,
      expirada: false, fecha_expiracion: expires });
    await act(async () => hook.result.current.clearEye("OI"));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    expect(hook.result.current.canNext).toBe(true);
    hook.unmount();
  });

  it("bloquea doble clic, cierre y reemplazo mientras la revocación está pendiente", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    let finish!: (value: Awaited<ReturnType<typeof revocarConfirmacionRetinografo>>) => void;
    revoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.clearEye("OD"); });
    await waitFor(() => expect(revoke).toHaveBeenCalledOnce());
    act(() => { void hook.result.current.clearEye("OD"); hook.result.current.closeAutoSelection();
      void hook.result.current.handleFile("OD", new File(["manual"], "manual.jpg", { type: "image/jpeg" })); });
    expect(hook.result.current.autoModalOpen).toBe(true);
    expect(hook.result.current.eyes.OD.file).not.toBeNull();
    expect(hook.result.current.busyEyes.OD).toBe(true);
    await act(async () => finish({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "REVOCADA" }));
    expect(revoke).toHaveBeenCalledOnce();
    expect(hook.result.current.eyes.OD.file).toBeNull();
    hook.unmount();
  });

  it("si se pierden ambas respuestas, mantiene comprobante y no repite la revocación a ciegas", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    revoke.mockRejectedValueOnce(new Error("lost response"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONFIRMADA",
      vigente: true, expirada: false, fecha_expiracion: expires }).mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.result.current.clearEye("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(2);
    expect(hook.result.current.eyes.OD.file).not.toBeNull();
    expect(hook.result.current.eyes.OD.confirmation).toBe("incierta");
    expect(hook.result.current.canNext).toBe(false);
    expect(hook.result.current.eyeActionError.OD).toMatch(/No se pudo quitar/);
    hook.unmount();
  });

  it("no revoca al previsualizar otra candidata, solo al confirmar sustitución", async () => {
    const first = candidate("OD");
    const second = { ...first, filename: "synthetic_Color_R_2.png", secuencia: 2 };
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 2, imagenes: { OD: first }, candidatas: [first, second] });
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.selectAutoCandidate(second));
    expect(revoke).not.toHaveBeenCalled();
    expect(hook.result.current.eyes.OD.file?.name).toBe(first.filename);
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledTimes(2);
    expect(hook.result.current.eyes.OD.file?.name).toBe(second.filename);
    hook.unmount();
  });

  it("si falla la revocación durante la sustitución no registra la nueva ni pierde la anterior", async () => {
    const first = candidate("OD");
    const second = { ...first, filename: "synthetic_Color_R_2.png", secuencia: 2 };
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 2, imagenes: { OD: first }, candidatas: [first, second] });
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.selectAutoCandidate(second));
    revoke.mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(register).toHaveBeenCalledOnce();
    expect(hook.result.current.eyes.OD.file?.name).toBe(first.filename);
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    expect(hook.result.current.eyeActionError.OD).toMatch(/No se pudo quitar/);
    hook.unmount();
  });

  it("si falla el registro tras revocar la anterior, no anuncia sustitución confirmada", async () => {
    const first = candidate("OD");
    const second = { ...first, filename: "synthetic_Color_R_2.png", secuencia: 2 };
    selection.mockResolvedValueOnce({ paciente_id: 7, encontradas: 2, imagenes: { OD: first }, candidatas: [first, second] });
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.selectAutoCandidate(second));
    register.mockRejectedValueOnce({ response: { status: 503 } });
    await act(async () => hook.result.current.confirmEye("OD"));
    expect(revoke).toHaveBeenCalledOnce();
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.canNext).toBe(false);
    expect(hook.result.current.eyeActionError.OD).toMatch(/No se pudo confirmar/);
    hook.unmount();
  });

  it("reemplazo manual fallido no borra la confirmación; si se revoca, continúa como carga manual", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    revoke.mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.result.current.handleFile("OD", new File(["manual"], "manual.jpg", { type: "image/jpeg" })));
    expect(hook.result.current.eyes.OD.isExistingImage).toBe(true);
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    await act(async () => hook.result.current.handleFile("OD", new File(["manual"], "manual.jpg", { type: "image/jpeg" })));
    expect(hook.result.current.eyes.OD.isExistingImage).toBe(false);
    expect(hook.result.current.eyes.OD.file?.name).toBe("manual.jpg");
    expect(hook.result.current.canNext).toBe(true);
    hook.unmount();
  });

  it("una confirmación expirada se retira sin revocación y una consumida se mantiene", async () => {
    const hook = await setup();
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONFIRMADA",
      vigente: false, expirada: true, fecha_expiracion: "2020-01-01T00:00:00Z" });
    await act(async () => hook.result.current.clearEye("OD"));
    expect(revoke).not.toHaveBeenCalled();
    expect(hook.result.current.eyes.OD.file).toBeNull();
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    await act(async () => hook.result.current.confirmEye("OD"));
    status.mockResolvedValueOnce({ paciente_id: 7, ojo_confirmado: "Derecho", estado: "CONSUMIDA",
      vigente: false, expirada: false, fecha_expiracion: expires });
    await act(async () => hook.result.current.clearEye("OD"));
    expect(hook.result.current.eyes.OD.file).not.toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("impide cambiar de paciente o cerrar modal durante el POST y conserva la respuesta tardía", async () => {
    const hook = await setup();
    let finish!: (value: Awaited<ReturnType<typeof registrarConfirmacionRetinografo>>) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.confirmEye("OD"); });
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    act(() => hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    act(() => hook.result.current.closeAutoSelection());
    expect(hook.result.current.autoModalOpen).toBe(true);
    await act(async () => finish({ identificador: token, paciente_id: 7, ojo_confirmado: "Derecho",
      estado: "CONFIRMADA", fecha_expiracion: expires }));
    expect(JSON.stringify(hook.result.current.eyes)).not.toContain(token);
    expect(hook.result.current.selectedPatient?.id).toBe(7);
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    expect(confirmedPost).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("bloquea reemplazo manual durante el registro y conserva la confirmación tardía", async () => {
    const hook = await setup();
    let finish!: (value: Awaited<ReturnType<typeof registrarConfirmacionRetinografo>>) => void;
    register.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void hook.result.current.confirmEye("OD"); });
    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    await act(async () => hook.result.current.handleFile("OD", new File(["new"], "manual.jpg", { type: "image/jpeg" })));
    await act(async () => finish({ identificador: token, paciente_id: 7, ojo_confirmado: "Derecho",
      estado: "CONFIRMADA", fecha_expiracion: expires }));
    expect(hook.result.current.eyes.OD.candidate?.filename).toBe(candidate("OD").filename);
    expect(JSON.stringify(hook.result.current.eyes)).not.toContain(token);
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    expect(manualPost).not.toHaveBeenCalled();
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
    await act(async () => hook.result.current.autoSelectRetinographImages());
    act(() => { void hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]); });
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
    expect(hook.result.current.eyes.OI.file).toBeNull();
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
    expect(hook.result.current.eyeActionError.OD).toBeTruthy();
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
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[1]));
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

it("modal muestra solo datos clínicamente útiles y exige declaración expresa fuera del formulario", () => {
  const file = new File(["synthetic"], candidate("OD").filename, { type: "image/png" });
  const eyes: Record<EyeKey, EyeState> = { OD: { file: null, preview: null }, OI: { file: null, preview: null } };
  const onConfirm = vi.fn();
  const ui = render(<><ImageUploader eyes={eyes} embedded handleFile={vi.fn()} clearEye={vi.fn()} />
    <AutoSelectionModal open patientName="Paciente Sintético" candidates={[candidate("OD")]}
      chosen={{ image: candidate("OD"), file, preview: "blob:synthetic" }}
      loading={false} confirming={false} eyes={eyes} notice={null} onSelect={vi.fn()}
      onConfirm={onConfirm} onRevoke={vi.fn()} onClose={vi.fn()} /></>);
  expect(screen.getAllByText(/Paciente Sintético/).length).toBeGreaterThan(0);
  expect(screen.getByText("Confirme que la fotografía corresponde al paciente y al ojo indicado. La sugerencia no sustituye la revisión profesional.")).toBeInTheDocument();
  expect(screen.getAllByText(/Color · OD sugerido/)).toHaveLength(1);
  expect(screen.queryByText(/synthetic_Color_R.png/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Confirmo paciente, imagen y ojo OD/i }));
  expect(onConfirm).toHaveBeenCalledWith("OD");
  expect(screen.queryByRole("button", { name: /validar diagnóstico/i })).not.toBeInTheDocument();
  ui.unmount();
});

it("agrupa por ojo, prioriza el pendiente y ofrece acciones secundarias sin botón técnico", () => {
  const photo = candidate("OD");
  const file = new File(["synthetic"], photo.filename, { type: "image/png" });
  const eyes: Record<EyeKey, EyeState> = {
    OD: { file, preview: "blob:synthetic", isExistingImage: true, candidate: photo,
      confirmation: "CONFIRMADA", hasConfirmation: true, expiresAt: expires },
    OI: { file: null, preview: null },
  };
  const onRevoke = vi.fn();
  const ui = render(<AutoSelectionModal open patientName="Paciente Sintético"
    candidates={[photo, candidate("OI"), { ...photo, filename: "synthetic_Color_R_2.png" }]}
    chosen={{ image: photo, file, preview: "blob:synthetic" }} loading={false} confirming={false}
    eyes={eyes} notice={null} onSelect={vi.fn()} onConfirm={vi.fn()}
    onRevoke={onRevoke} onClose={vi.fn()} />);
  const list = screen.getByLabelText("Fotografías candidatas");
  expect(within(list).getAllByRole("region").map((group) => group.getAttribute("aria-label")))
    .toEqual(["Ojo izquierdo (OI)", "Ojo derecho (OD)"]);
  expect(within(list).getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /Confirmo paciente, imagen y ojo OD/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Consultar estado/ })).not.toBeInTheDocument();
  const revokeButton = screen.getByRole("button", { name: "Quitar imagen" });
  expect(screen.getByText("Imagen confirmada")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cambiar imagen" })).toBeInTheDocument();
  expect(screen.queryByText(/Revocar asociación/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Quitar la imagen no revoca una confirmación persistente/)).not.toBeInTheDocument();
  fireEvent.click(revokeButton);
  expect(onRevoke).toHaveBeenCalledOnce();
  expect(onRevoke).toHaveBeenCalledWith("OD");
  ui.unmount();
});
