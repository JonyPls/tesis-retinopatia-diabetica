// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { useAuthStore } from "../features/auth/store/authStore";
import { DiagnosisResults } from "../features/diagnosis/components/DiagnosisResults";
import { ImageUploader } from "../features/diagnosis/components/ImageUploader";
import { AutoSelectionModal } from "../features/diagnosis/components/AutoSelectionModal";
import {
  crearDiagnostico, crearDiagnosticoConfirmado, obtenerDetallesVisita,
  validarDetalleDiagnostico, obtenerSeleccionAutomaticaRetinografo,
  descargarImagenRetinografo, registrarConfirmacionRetinografo,
  consultarConfirmacionRetinografo, revocarConfirmacionRetinografo,
} from "../features/diagnosis/api/diagnosisService";
import type { DiagnosisResult, RetinographAutoImage } from "../features/diagnosis/api/diagnosisService";
import type { EyeKey } from "../features/diagnosis/types";
import { convertToPreviewUrl, revokePreviewUrl } from "../lib/imageUtils";
import { toast } from "../hooks/use-toast";
import { confirmManualPhotos } from "./diagnosisTestActions";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(), useNavigate: () => navigate,
}));
vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (original) => ({
  ...await original<typeof import("../features/diagnosis/api/diagnosisService")>(),
  crearDiagnostico: vi.fn(), crearDiagnosticoConfirmado: vi.fn(), obtenerDetallesVisita: vi.fn(),
  validarDetalleDiagnostico: vi.fn(), obtenerSeleccionAutomaticaRetinografo: vi.fn(),
  descargarImagenRetinografo: vi.fn(), registrarConfirmacionRetinografo: vi.fn(),
  consultarConfirmacionRetinografo: vi.fn(), revocarConfirmacionRetinografo: vi.fn(),
  sha256Blob: vi.fn().mockResolvedValue("a".repeat(64)),
}));
vi.mock("../lib/imageUtils", () => ({ convertToPreviewUrl: vi.fn(), revokePreviewUrl: vi.fn() }));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("../hooks/useRetinaImage", () => ({
  useRetinaImage: (filename: string) => ({ src: `blob:${filename}`, error: null, isLoading: false }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const validate = vi.mocked(validarDetalleDiagnostico);
type ValidationResponse = Awaited<ReturnType<typeof validarDetalleDiagnostico>>;
const approved = { success: true, data: { estado_validacion: "APROBADO" }, message: "Guardado sintético" };
const resultFor = (patient: number, eye: EyeKey): DiagnosisResult => ({
  visita_id: patient === 7 ? 30 : 60, detalle_id: patient * 10 + (eye === "OD" ? 1 : 2),
  diagnostico_codigo: 2, diagnostico_texto: "Moderada", confianza_general: 80,
  probabilidades_detalle: { moderada: 80 }, gradcam_url: `${patient}-${eye}-gradcam.jpg`, mensaje: "Registrado",
});
const candidate = (eye: EyeKey): RetinographAutoImage => ({
  filename: `synthetic_Color_${eye === "OD" ? "R" : "L"}.png`, ojo: eye,
  ojo_original: eye === "OD" ? "R" : "L", tipo_imagen: "Color", secuencia: 1,
  extension: "png", fecha_exportacion: "2026-01-01T10:00:00", mime_type: "image/png",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function selected() {
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => {
    hook.result.current.selectPatient({ id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" });
    hook.result.current.selectVisita(null);
    hook.result.current.goNext();
  });
  return hook;
}

async function prepared(eyes: EyeKey[] = ["OD"]) {
  const hook = selected();
  for (const eye of eyes) {
    await act(async () => hook.result.current.handleFile(eye, new File([eye], `${eye}-original.jpg`)));
  }
  act(() => hook.result.current.goNext());
  confirmManualPhotos(hook.result);
  await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  validate.mockReset().mockResolvedValue(approved);
  vi.mocked(crearDiagnostico).mockImplementation(async (patient, eye) => resultFor(patient, eye === "Derecho" ? "OD" : "OI"));
  vi.mocked(crearDiagnosticoConfirmado).mockImplementation(async (patient, eye) => resultFor(patient, eye === "Derecho" ? "OD" : "OI"));
  vi.mocked(convertToPreviewUrl).mockImplementation(async (file) => `blob:${file.name}`);
  vi.mocked(obtenerDetallesVisita).mockResolvedValue([]);
  vi.mocked(obtenerSeleccionAutomaticaRetinografo).mockResolvedValue({ paciente_id: 7, encontradas: 2,
    imagenes: { OD: candidate("OD"), OI: candidate("OI") }, candidatas: [candidate("OD"), candidate("OI")] });
  vi.mocked(descargarImagenRetinografo).mockResolvedValue(new Blob(["synthetic"], { type: "image/png" }));
  vi.mocked(registrarConfirmacionRetinografo).mockImplementation(async ({ paciente_id, ojo_confirmado }) => ({
    identificador: "d".repeat(64), paciente_id, ojo_confirmado, estado: "CONFIRMADA", fecha_expiracion: "2099-01-01T00:00:00Z",
  }));
  vi.mocked(consultarConfirmacionRetinografo).mockResolvedValue({ paciente_id: 7, ojo_confirmado: "Derecho",
    estado: "CONFIRMADA", vigente: true, expirada: false, fecha_expiracion: "2099-01-01T00:00:00Z" });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("correspondencia entre fotografía y resultado registrado", () => {
  it("permite sustituir y retirar fotografías antes de procesarlas", async () => {
    const hook = selected();
    await act(async () => hook.result.current.handleFile("OD", new File(["a"], "first.jpg")));
    await act(async () => hook.result.current.handleFile("OD", new File(["b"], "second.jpg")));
    expect(hook.result.current.eyes.OD.file?.name).toBe("second.jpg");
    expect(hook.result.current.eyes.OD.preview).toBe("blob:second.jpg");
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:first.jpg");
    await act(async () => hook.result.current.clearEye("OD"));
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:second.jpg");
    expect(crearDiagnostico).not.toHaveBeenCalled();
  });

  it("inmoviliza OD procesado, conserva evidencia y permite editar OI", async () => {
    const hook = await prepared();
    const original = hook.result.current.eyes.OD;
    const prediction = hook.result.current.results.OD;
    act(() => hook.result.current.goBack());
    vi.mocked(revokePreviewUrl).mockClear();
    vi.mocked(convertToPreviewUrl).mockClear();
    await act(async () => hook.result.current.handleFile("OD", new File(["replacement"], "wrong.jpg")));
    await act(async () => hook.result.current.clearEye("OD"));
    expect(hook.result.current.eyes.OD).toBe(original);
    expect(hook.result.current.results.OD).toBe(prediction);
    expect(hook.result.current.eyeActionError.OD).toMatch(/análisis registrado/);
    expect(convertToPreviewUrl).not.toHaveBeenCalled();
    expect(revokePreviewUrl).not.toHaveBeenCalledWith(original.preview);
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi-first.jpg")));
    await act(async () => hook.result.current.handleFile("OI", new File(["oi2"], "oi-second.jpg")));
    expect(hook.result.current.eyes.OI.file?.name).toBe("oi-second.jpg");
    expect(hook.result.current.canNext).toBe(true);

    const uploader = render(<ImageUploader embedded {...hook.result.current} lockedEyes={{ OD: true }} />);
    expect(screen.getAllByRole("button", { name: "Reemplazar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Quitar" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reemplazar" })).toBeEnabled();
    expect(screen.getByText("Análisis registrado")).toBeInTheDocument();
    expect(screen.getByAltText("Retina Ojo Derecho")).toHaveAttribute("src", original.preview);
    uploader.unmount();
    render(<DiagnosisResults {...hook.result.current} />);
    expect(screen.getByAltText("Imagen original")).toHaveAttribute("src", original.preview);
    expect(screen.getByAltText("Grad-CAM")).toHaveAttribute("src", `blob:${prediction!.gradcam_url}`);
    expect(crearDiagnostico).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.clearEye("OI"));
    expect(hook.result.current.eyes.OI.file).toBeNull();
  });

  it.each(["manual", "retinógrafo"])("no sustituye el OD registrado por %s mediante otra exportación", async (source) => {
    const hook = source === "manual" ? await prepared() : selected();
    if (source === "retinógrafo") {
      await act(async () => hook.result.current.autoSelectRetinographImages());
      await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
      await act(async () => hook.result.current.confirmEye("OD"));
      act(() => hook.result.current.goNext());
      await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    }
    const original = hook.result.current.eyes.OD;
    act(() => hook.result.current.goBack());
    await act(async () => hook.result.current.autoSelectRetinographImages());
    vi.mocked(descargarImagenRetinografo).mockClear();
    vi.mocked(registrarConfirmacionRetinografo).mockClear();
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    await act(async () => hook.result.current.confirmEye("OD"));
    await act(async () => hook.result.current.revokeConfirmation("OD"));
    await act(async () => hook.result.current.handleFile("OD", new File(["new"], "new.jpg")));
    expect(hook.result.current.eyes.OD).toBe(original);
    expect(descargarImagenRetinografo).not.toHaveBeenCalled();
    expect(registrarConfirmacionRetinografo).not.toHaveBeenCalled();
    expect(revocarConfirmacionRetinografo).not.toHaveBeenCalled();

    const oi = hook.result.current.autoCandidates.find((image) => image.ojo === "OI")!;
    await act(async () => hook.result.current.selectAutoCandidate(oi));
    const modalProps = { open: true, patientName: "Paciente sintético",
      candidates: hook.result.current.autoCandidates, eyes: hook.result.current.eyes,
      lockedEyes: { OD: true }, loading: false, confirming: false, notice: null,
      onSelect: hook.result.current.selectAutoCandidate, onConfirm: hook.result.current.confirmEye,
      onRevoke: hook.result.current.revokeConfirmation, onClose: vi.fn() };
    const modal = render(<AutoSelectionModal {...modalProps}
      chosen={{ image: hook.result.current.autoCandidates[0], file: original.file!, preview: original.preview }} />);
    expect(screen.queryByRole("button", { name: /Confirmo paciente, imagen y ojo OD/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar imagen" })).not.toBeInTheDocument();
    expect(screen.getByText("OD: análisis registrado.")).toBeInTheDocument();
    modal.rerender(<AutoSelectionModal open patientName="Paciente sintético"
      candidates={hook.result.current.autoCandidates} chosen={hook.result.current.autoPreview}
      eyes={hook.result.current.eyes} lockedEyes={{ OD: true }} loading={false} confirming={false}
      notice={null} onSelect={hook.result.current.selectAutoCandidate} onConfirm={hook.result.current.confirmEye}
      onRevoke={hook.result.current.revokeConfirmation} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ver fotografía 1 de OD" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver fotografía 1 de OI" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Confirmo paciente, imagen y ojo OI/ })).toBeEnabled();
    await act(async () => hook.result.current.confirmEye("OI"));
    expect(registrarConfirmacionRetinografo).toHaveBeenCalledTimes(1);
    expect(hook.result.current.eyes.OI.confirmation).toBe("CONFIRMADA");
    expect(hook.result.current.eyes.OD).toBe(original);
  });
});

describe("contexto y exclusión de validaciones médicas", () => {
  it("confirma el contexto actual una sola vez y protege navegación y edición mientras espera", async () => {
    const hook = await prepared();
    const response = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.validateDiagnosis("OD"); void hook.result.current.validateAll(); });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isValidating).toBe(true);
    act(() => {
      hook.result.current.goBack();
      hook.result.current.setFinalSelection("OD", 4);
      hook.result.current.setComment("OD", "No debe sustituir la decisión enviada");
      hook.result.current.setCorrectionReason("OD", "No debe cambiar");
    });
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.finalSelection.OD).toBe(2);
    expect(hook.result.current.comments.OD).toBe("");
    expect(hook.result.current.correctionReasons.OD).toBe("");
    await act(async () => { response.resolve(approved); await pending; });
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO" });
    expect(hook.result.current.eyeProcessing.OD).toBe("validado");
    expect(hook.result.current.isValidating).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Validación guardada" }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["individual", "paciente"], ["individual", "visita"], ["lote", "paciente"], ["lote", "visita"],
  ])("ignora éxito tardío %s al cambiar %s y no continúa el lote", async (mode, change) => {
    const hook = await prepared(["OD", "OI"]);
    const response = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = mode === "lote" ? hook.result.current.validateAll() : hook.result.current.validateDiagnosis("OD"); });
    act(() => {
      if (change === "paciente") hook.result.current.selectPatient({ id: 8, nombres: "Otro", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000001" });
      hook.result.current.selectVisita({ visita_id: 60 } as Parameters<typeof hook.result.current.selectVisita>[0]);
      hook.result.current.setComment("OI", "Nota del nuevo contexto");
    });
    expect(hook.result.current.isValidating).toBe(false);
    vi.mocked(toast).mockClear();
    await act(async () => { response.resolve(approved); await pending; });
    expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(hook.result.current.eyeProcessing).toEqual({ OD: "sin_procesar", OI: "sin_procesar" });
    expect(hook.result.current.comments.OI).toBe("Nota del nuevo contexto");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409])("no aplica error tardío %s a una visita distinta", async (status) => {
    const hook = await prepared();
    const response = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.validateAll(); });
    act(() => hook.result.current.selectVisita(null));
    vi.mocked(toast).mockClear();
    await act(async () => { response.reject({ response: { status } }); await pending; });
    expect(hook.result.current.validationConflict).toBe(false);
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(toast).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["individual", "lote"])("desmontar invalida la validación %s y no produce éxito ni navegación", async (mode) => {
    const hook = await prepared(["OD", "OI"]);
    const response = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = mode === "lote" ? hook.result.current.validateAll() : hook.result.current.validateDiagnosis("OD"); });
    hook.unmount();
    vi.mocked(toast).mockClear();
    await act(async () => { response.resolve(approved); await pending; });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["logout", "otro usuario", "misma sesión restaurada"])("invalida el lote ante %s, incluso sin desmontaje", async (change) => {
    const user = { id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético", roles: ["Oftalmologo"] };
    useAuthStore.getState().login("synthetic-session", user);
    const hook = await prepared(["OD", "OI"]);
    const response = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(response.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.validateAll(); });
    act(() => {
      useAuthStore.getState().logout();
      if (change === "otro usuario") useAuthStore.getState().login("other-synthetic-session", { ...user, id: 2 });
      if (change === "misma sesión restaurada") useAuthStore.getState().login("synthetic-session", user);
    });
    expect(hook.result.current.isValidating).toBe(false);
    vi.mocked(toast).mockClear();
    await act(async () => { response.resolve(approved); await pending; });
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(validate).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("una operación obsoleta no libera el bloqueo de la validación del nuevo paciente", async () => {
    const hook = await prepared();
    const oldResponse = deferred<ValidationResponse>();
    const newResponse = deferred<ValidationResponse>();
    validate.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    let oldPending!: Promise<void>;
    act(() => { oldPending = hook.result.current.validateDiagnosis("OD"); });
    act(() => {
      hook.result.current.selectPatient({ id: 8, nombres: "Otro", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000001" });
      hook.result.current.selectVisita(null);
    });
    await act(async () => hook.result.current.handleFile("OD", new File(["new"], "new-patient.jpg")));
    act(() => hook.result.current.goBack());
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => {
      expect(hook.result.current.results.OD?.detalle_id).toBe(81);
      expect(hook.result.current.step).toBe(3);
    }, { timeout: 3500 });
    let newPending!: Promise<void>;
    act(() => { newPending = hook.result.current.validateDiagnosis("OD"); });
    vi.mocked(toast).mockClear();
    await act(async () => { oldResponse.reject({ response: { status: 409 } }); await oldPending; });
    expect(hook.result.current.isValidating).toBe(true);
    expect(hook.result.current.validationConflict).toBe(false);
    expect(hook.result.current.validatedEyes).toEqual({});
    expect(toast).not.toHaveBeenCalled();
    await act(async () => { newResponse.resolve(approved); await newPending; });
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO" });
    expect(hook.result.current.isValidating).toBe(false);
    expect(validate.mock.calls.map(([id]) => id)).toEqual([71, 81]);
  });

  it("mantiene OD guardado si OI falla, sin reintentos automáticos", async () => {
    const hook = await prepared(["OD", "OI"]);
    validate.mockResolvedValueOnce(approved).mockRejectedValueOnce(new Error("Respuesta de red no recibida"));
    await act(async () => hook.result.current.validateAll());
    expect(validate.mock.calls.map(([id]) => id)).toEqual([71, 72]);
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO" });
    expect(hook.result.current.eyeProcessing.OI).toBe("pendiente_validacion");
    expect(hook.result.current.isValidating).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("finaliza el lote vigente y navega solo tras confirmar ambos ojos", async () => {
    const hook = await prepared(["OD", "OI"]);
    await act(async () => hook.result.current.validateAll());
    expect(validate.mock.calls.map(([id]) => id)).toEqual([71, 72]);
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO", OI: "APROBADO" });
    expect(hook.result.current.isValidating).toBe(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("conserva el motivo obligatorio y el guardado corregido", async () => {
    const hook = await prepared();
    act(() => hook.result.current.setFinalSelection("OD", 3));
    await act(async () => hook.result.current.validateDiagnosis("OD"));
    expect(validate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Motivo de corrección requerido" }));
    act(() => hook.result.current.setCorrectionReason("OD", "Justificación sintética"));
    validate.mockResolvedValueOnce({ ...approved, data: { estado_validacion: "CORREGIDO" } });
    await act(async () => hook.result.current.validateDiagnosis("OD"));
    expect(validate).toHaveBeenCalledWith(71, 3, "", "Justificación sintética");
    expect(hook.result.current.validatedEyes).toEqual({ OD: "CORREGIDO" });
    expect(hook.result.current.results.OD?.diagnostico_codigo).toBe(2);
  });
});
