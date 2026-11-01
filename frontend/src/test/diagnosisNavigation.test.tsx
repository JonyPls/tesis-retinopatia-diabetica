// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import type { DiagnosisResult, DetalleDiagnosticoExistente } from "../features/diagnosis/api/diagnosisService";
import type { EyeKey } from "../features/diagnosis/types";
import { revokePreviewUrl } from "../lib/imageUtils";
import { confirmManualPhotos } from "./diagnosisTestActions";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (original) => ({
  ...await original<typeof import("../features/diagnosis/api/diagnosisService")>(),
  sha256Blob: vi.fn().mockResolvedValue("a".repeat(64)),
}));
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn().mockImplementation(async (file: File) => `blob:${file.name}`),
  revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const get = vi.mocked(api.get);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" };
const resultFor = (eye: EyeKey): DiagnosisResult => ({
  visita_id: 30, diagnostico_retinopatia_id: 9, detalle_id: eye === "OD" ? 11 : 12,
  diagnostico_codigo: 2, diagnostico_texto: "Moderada", confianza_general: 80,
  probabilidades_detalle: { moderada: 80 }, gradcam_url: `${eye}-gradcam.jpg`, mensaje: "Registrado",
});
const detailFor = (eye: EyeKey): DetalleDiagnosticoExistente => ({
  detalle_id: eye === "OD" ? 11 : 12, ojo: eye, resultado_ia: 2,
  diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: { moderada: 80 },
  diagnostico_final: null, estado_validacion: "PENDIENTE", comentario_medico: null, motivo_correccion: null,
  imagen_url: `${eye}-original.jpg`, gradcam_url: `${eye}-gradcam.jpg`,
});
const responseFor = (eye: EyeKey) => ({ data: { success: true, data: resultFor(eye) } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function selected(visitId?: number) {
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoadingRecent).toBe(false));
  act(() => {
    hook.result.current.selectPatient(patient);
    hook.result.current.selectVisita(visitId ? { visita_id: visitId } as Parameters<typeof hook.result.current.selectVisita>[0] : null);
    hook.result.current.goNext();
  });
  return hook;
}

async function prepared(first: EyeKey = "OD", visitId?: number) {
  const hook = await selected(visitId);
  await act(async () => hook.result.current.handleFile(first, new File([first], `${first}-original.jpg`)));
  act(() => hook.result.current.goNext());
  confirmManualPhotos(hook.result);
  await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
  return hook;
}

function clinicalState(state: ReturnType<typeof useDiagnosis>) {
  return {
    selectedPatient: state.selectedPatient, selectedVisita: state.selectedVisita,
    confirmedVisitId: state.confirmedVisitId, eyes: state.eyes, results: state.results,
    finalSelection: state.finalSelection, comments: state.comments, correctionReasons: state.correctionReasons,
    validatedEyes: state.validatedEyes, eyeProcessing: state.eyeProcessing, processingNotice: state.processingNotice,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReset().mockResolvedValue({ data: { data: { ojos: [] } } });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url !== "/diagnosticar" || !(body instanceof FormData)) throw new Error("POST no previsto");
    return responseFor(body.get("ojo_evaluado") === "Derecho" ? "OD" : "OI");
  });
  put.mockReset().mockResolvedValue({ data: { success: true, data: { estado_validacion: "CORREGIDO" } } });
});
afterEach(cleanup);

describe("navegación local sin operaciones clínicas", () => {
  it.each(["OD", "OI"] as const)("consulta solo %s sin procesar el archivo del otro ojo ni perder decisiones", async (first) => {
    const hook = await prepared(first);
    const other = first === "OD" ? "OI" : "OD";
    act(() => {
      hook.result.current.setFinalSelection(first, 3);
      hook.result.current.setCorrectionReason(first, "Motivo local");
      hook.result.current.setComment(first, "Comentario local");
      hook.result.current.goBack();
    });
    await act(async () => hook.result.current.handleFile(other, new File([other], `${other}-pendiente.jpg`)));
    const before = clinicalState(hook.result.current);
    vi.mocked(revokePreviewUrl).mockClear();
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.canNext).toBe(true);
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(3);
    expect(clinicalState(hook.result.current)).toEqual(before);
    expect(hook.result.current.results[other]).toBeUndefined();
    expect(hook.result.current.activeEye).toBe(first);
    expect(post).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(revokePreviewUrl).not.toHaveBeenCalled();
    act(() => hook.result.current.goBack());
    act(() => hook.result.current.returnToResults());
    expect(clinicalState(hook.result.current)).toEqual(before);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("sin resultados no avanza por la acción de consulta y mantiene el procesamiento original", async () => {
    const hook = await selected();
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.canNext).toBe(false);
    expect(post).not.toHaveBeenCalled();
    await act(async () => hook.result.current.handleFile("OD", new File(["od"], "original.jpg")));
    expect(hook.result.current.canNext).toBe(true);
    act(() => hook.result.current.returnToResults());
    expect(post).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe(2);
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    expect(post).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  });

  it("con ambos ojos registrados no permite el retroceso genérico a fotografías", async () => {
    const hook = await prepared();
    act(() => hook.result.current.goBack());
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi.jpg")));
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    const before = clinicalState(hook.result.current);
    act(() => hook.result.current.goBack());
    expect(hook.result.current.step).toBe(3);
    expect(clinicalState(hook.result.current)).toEqual(before);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("un cambio de contexto retira los resultados disponibles para la consulta local", async () => {
    const hook = await prepared();
    act(() => hook.result.current.goBack());
    act(() => hook.result.current.selectVisita(null));
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.confirmedVisitId).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("continuidad del ojo pendiente", () => {
  it.each([undefined, 30])("incorpora OI usando la visita confirmada (selección inicial: %s) sin reenviar OD", async (visitId) => {
    const hook = await prepared("OD", visitId);
    act(() => {
      hook.result.current.setFinalSelection("OD", 3);
      hook.result.current.setCorrectionReason("OD", "Motivo OD");
      hook.result.current.setComment("OD", "Nota OD");
    });
    const original = clinicalState(hook.result.current);
    act(() => hook.result.current.goBack());
    await act(async () => hook.result.current.handleFile("OD", new File(["wrong"], "wrong.jpg")));
    await act(async () => hook.result.current.clearEye("OD"));
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi.jpg")));
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    expect(post).toHaveBeenCalledTimes(2);
    const forms = post.mock.calls.map(([, body]) => body as FormData);
    expect(forms.map((body) => body.get("ojo_evaluado"))).toEqual(["Derecho", "Izquierdo"]);
    expect(forms[0].get("visita_id")).toBe(visitId ? "30" : null);
    expect(forms[1].get("visita_id")).toBe("30");
    expect(forms[1].get("paciente_id")).toBe("7");
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.selectedVisita).toBe(original.selectedVisita);
    expect(hook.result.current.selectedPatient).toBe(original.selectedPatient);
    expect(hook.result.current.results.OD).toBe(original.results.OD);
    expect(hook.result.current.eyes.OD).toBe(original.eyes.OD);
    expect(hook.result.current.finalSelection).toEqual({ OD: 3, OI: 2 });
    expect(hook.result.current.correctionReasons).toEqual({ OD: "Motivo OD", OI: "" });
    expect(hook.result.current.comments).toEqual({ OD: "Nota OD", OI: "" });
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("conserva una validación OD ya persistida al consultar y añadir OI", async () => {
    const hook = await prepared();
    act(() => {
      hook.result.current.setFinalSelection("OD", 3);
      hook.result.current.setCorrectionReason("OD", "Motivo confirmado");
      hook.result.current.setComment("OD", "Nota confirmada");
    });
    await act(async () => hook.result.current.validateDiagnosis("OD"));
    expect(put).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.goBack());
    act(() => hook.result.current.returnToResults());
    expect(put).toHaveBeenCalledTimes(1);
    expect(hook.result.current.validatedEyes).toEqual({ OD: "CORREGIDO" });
    act(() => hook.result.current.goBack());
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi.jpg")));
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    expect(hook.result.current.validatedEyes).toEqual({ OD: "CORREGIDO" });
    expect(hook.result.current.eyeProcessing).toEqual({ OD: "validado", OI: "pendiente_validacion" });
    expect(hook.result.current.finalSelection.OD).toBe(3);
    expect(hook.result.current.comments.OD).toBe("Nota confirmada");
    expect(hook.result.current.correctionReasons.OD).toBe("Motivo confirmado");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("conserva la confirmación OI al navegar, bloquea su POST pendiente y consume solo ese ojo", async () => {
    const hook = await prepared();
    const original = hook.result.current.eyes.OD;
    act(() => hook.result.current.goBack());
    const candidate = { filename: "synthetic_Color_L_1.png", ojo: "OI", ojo_original: "L",
      tipo_imagen: "Color", secuencia: 1, extension: "png", fecha_exportacion: "2026-01-01T10:00:00", mime_type: "image/png" };
    get.mockResolvedValueOnce({ data: { data: { paciente_id: 7, encontradas: 1,
      imagenes: { OI: candidate }, candidatas: [candidate] } } });
    await act(async () => hook.result.current.autoSelectRetinographImages());
    get.mockResolvedValueOnce({ data: new Blob(["synthetic"], { type: "image/png" }) });
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    const confirmation = { paciente_id: 7, ojo_confirmado: "Izquierdo", estado: "CONFIRMADA",
      identificador: "d".repeat(64), fecha_expiracion: "2099-01-01T00:00:00Z", vigente: true, expirada: false };
    const pending = deferred<{ data: { confirmacion: typeof confirmation } }>();
    post.mockReturnValueOnce(pending.promise);
    let confirming!: Promise<void>;
    act(() => {
      confirming = hook.result.current.confirmEye("OI");
      hook.result.current.returnToResults();
      hook.result.current.goBack();
    });
    expect(hook.result.current.step).toBe(2);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await act(async () => { pending.resolve({ data: { confirmacion: confirmation } }); await confirming; });
    const confirmed = hook.result.current.eyes.OI;
    expect(confirmed.confirmation).toBe("CONFIRMADA");
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.eyes.OI).toBe(confirmed);
    expect(hook.result.current.eyes.OD).toBe(original);
    expect(post).toHaveBeenCalledTimes(2); // Inferencia OD y declaración OI; navegar no envía nada.
    expect(get).toHaveBeenCalledTimes(2); // Selección y vista previa, sin conciliación.
    act(() => hook.result.current.goBack());
    post.mockResolvedValueOnce({ data: { confirmacion: confirmation } });
    act(() => hook.result.current.goNext());
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
    const analyses = post.mock.calls.filter(([url]) => url === "/diagnosticar");
    expect(analyses).toHaveLength(2);
    const oi = analyses[1][1] as FormData;
    expect(oi.get("ojo_evaluado")).toBe("Izquierdo");
    expect(oi.get("visita_id")).toBe("30");
    expect(oi.get("confirmacion_exportacion")).toBe(confirmation.identificador);
    expect(oi.has("imagen")).toBe(false);
    expect(hook.result.current.eyes.OI.confirmation).toBe("CONSUMIDA");
    expect(hook.result.current.eyes.OD).toBe(original);
    expect(put).not.toHaveBeenCalled();
  });

  it.each([422, 500, undefined])("si OI falla (%s), OD sigue consultable y el ojo incierto no se reenvía", async (status) => {
    const hook = await prepared();
    act(() => {
      hook.result.current.setFinalSelection("OD", 3);
      hook.result.current.setCorrectionReason("OD", "Conservar motivo");
      hook.result.current.setComment("OD", "Conservar comentario");
      hook.result.current.goBack();
    });
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi.jpg")));
    post.mockRejectedValueOnce(status ? { response: { status } } : new Error("Respuesta perdida"));
    // La conciliación ya existente recupera el OD pendiente; no debe reiniciar su propuesta.
    get.mockResolvedValueOnce({ data: { data: { ojos: [detailFor("OD")] } } });
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.finalSelection.OD).toBe(3);
    expect(hook.result.current.correctionReasons.OD).toBe("Conservar motivo");
    expect(hook.result.current.comments.OD).toBe("Conservar comentario");
    expect(hook.result.current.eyeProcessing.OI).toBe(status === 422 ? "error" : "incierto");
    act(() => hook.result.current.goBack());
    const before = clinicalState(hook.result.current);
    const reads = get.mock.calls.length;
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(3);
    expect(clinicalState(hook.result.current)).toEqual(before);
    expect(get).toHaveBeenCalledTimes(reads);
    if (status !== 422) {
      act(() => hook.result.current.goBack());
      expect(hook.result.current.canNext).toBe(false);
      act(() => hook.result.current.goNext());
      act(() => hook.result.current.returnToResults());
    }
    expect(post).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });

  it("solo incertidumbre, sin resultado ni visita confirmada, no habilita consulta ni reenvío", async () => {
    const hook = await selected();
    await act(async () => hook.result.current.handleFile("OD", new File(["od"], "od.jpg")));
    post.mockRejectedValueOnce(new Error("Respuesta perdida"));
    act(() => hook.result.current.goNext());
    confirmManualPhotos(hook.result);
    await waitFor(() => expect(hook.result.current.isSaving).toBe(false));
    expect(hook.result.current.eyeProcessing.OD).toBe("incierto");
    expect(hook.result.current.confirmedVisitId).toBeNull();
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.results).toEqual({});
    act(() => hook.result.current.goNext());
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("exclusión interna durante operaciones pendientes", () => {
  it("bloquea transiciones incluso en el mismo tick en que se inicia la inferencia OI", async () => {
    const hook = await prepared();
    act(() => hook.result.current.goBack());
    await act(async () => hook.result.current.handleFile("OI", new File(["oi"], "oi.jpg")));
    const pending = deferred<ReturnType<typeof responseFor>>();
    post.mockReturnValueOnce(pending.promise);
    act(() => hook.result.current.goNext());
    const review = hook.result.current.manualReview!;
    act(() => {
      hook.result.current.confirmManualReview(review, true);
      hook.result.current.returnToResults();
      hook.result.current.goBack();
      hook.result.current.goNext();
    });
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.isNavigationBusy).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(responseFor("OI")));
    await waitFor(() => expect(hook.result.current.step).toBe(3), { timeout: 3500 });
  });

  it("no vuelve a resultados mientras una validación enviada desde Paso 2 espera respuesta", async () => {
    const hook = await prepared();
    act(() => hook.result.current.goBack());
    const pending = deferred<{ data: { success: boolean; data: { estado_validacion: string } } }>();
    put.mockReturnValueOnce(pending.promise);
    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.validateDiagnosis("OD");
      hook.result.current.returnToResults();
      hook.result.current.goBack();
      hook.result.current.goNext();
    });
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.isNavigationBusy).toBe(true);
    await act(async () => {
      pending.resolve({ data: { success: true, data: { estado_validacion: "APROBADO" } } });
      await saving;
    });
    act(() => hook.result.current.returnToResults());
    expect(hook.result.current.step).toBe(3);
    expect(hook.result.current.validatedEyes).toEqual({ OD: "APROBADO" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
