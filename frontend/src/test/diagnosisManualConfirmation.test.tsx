// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { ManualImageConfirmation } from "../features/diagnosis/components/ManualImageConfirmation";
import { useAuthStore } from "../features/auth/store/authStore";
import { convertToPreviewUrl } from "../lib/imageUtils";
import type { DiagnosisHook, EyeKey } from "../features/diagnosis/types";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]), obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (original) => ({
  ...await original<typeof import("../features/diagnosis/api/diagnosisService")>(),
  sha256Blob: vi.fn().mockResolvedValue("a".repeat(64)),
}));
vi.mock("../lib/imageUtils", () => ({ convertToPreviewUrl: vi.fn(), revokePreviewUrl: vi.fn() }));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

let work: DiagnosisHook;
const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" };
const post = vi.mocked(api.post);
const get = vi.mocked(api.get);
const confirmationPath = "/diagnosticar/retinografo/confirmaciones";
const confirmation = (eye: string) => ({ paciente_id: 7, ojo_confirmado: eye, estado: "CONFIRMADA",
  identificador: (eye === "Derecho" ? "d" : "e").repeat(64), vigente: true, expirada: false,
  fecha_expiracion: "2099-01-01T00:00:00Z" });
const inferenceResponse = (eye: string) => ({ data: { success: true, data: {
  visita_id: 30, diagnostico_retinopatia_id: 9, detalle_id: eye === "Derecho" ? 11 : 12,
  diagnostico_codigo: 2, diagnostico_texto: "Moderada", confianza_general: 80,
  probabilidades_detalle: { moderada: 80 }, gradcam_url: `${eye}-gradcam.jpg`, mensaje: "Registrado",
} } });
const candidates = (["OD", "OI"] as const).map((eye) => ({ filename: `synthetic_Color_${eye === "OD" ? "R" : "L"}_1.png`,
  ojo: eye, ojo_original: eye === "OD" ? "R" : "L", tipo_imagen: "Color", secuencia: 1, extension: "png",
  fecha_exportacion: "2026-01-01T10:00:00", mime_type: "image/png" }));

function Workflow() {
  work = useDiagnosis();
  return <>
    <button onClick={work.goNext}>Guardar y analizar</button>
    {work.manualReview && <ManualImageConfirmation review={work.manualReview}
      onCancel={work.cancelManualReview} onConfirm={work.confirmManualReview} />}
  </>;
}

async function setup() {
  const ui = render(<MemoryRouter><Workflow /></MemoryRouter>);
  await waitFor(() => expect(work.isLoadingRecent).toBe(false));
  act(() => { work.selectPatient(patient); work.selectVisita(null); work.goNext(); });
  return ui;
}
async function manual(eye: EyeKey) {
  await act(async () => work.handleFile(eye, new File([eye], `${eye}-manual.jpg`, { type: "image/jpeg" })));
}
async function automatic(eyes: EyeKey[]) {
  await act(async () => work.autoSelectRetinographImages());
  for (const eye of eyes) {
    await act(async () => work.selectAutoCandidate(work.autoCandidates.find((image) => image.ojo === eye)!));
    await act(async () => work.confirmEye(eye));
  }
  act(() => work.closeAutoSelection());
}
function openReview() { fireEvent.click(screen.getByRole("button", { name: "Guardar y analizar" })); }
function acceptReview() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar y analizar" }));
}
const analyses = () => post.mock.calls.filter(([url]) => url === "/diagnosticar");

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().login("synthetic-session", {
    id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético", roles: ["Oftalmologo"],
  });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === "/diagnosticar" && body instanceof FormData) return inferenceResponse(String(body.get("ojo_evaluado")));
    if (url === confirmationPath && body && typeof body === "object" && "ojo_confirmado" in body) {
      return { data: { confirmacion: confirmation(String(body.ojo_confirmado)) } };
    }
    if (url === `${confirmationPath}/estado` && body && typeof body === "object" && "identificador" in body) {
      return { data: { confirmacion: confirmation(body.identificador === "d".repeat(64) ? "Derecho" : "Izquierdo") } };
    }
    throw new Error("POST no previsto");
  });
  get.mockReset().mockImplementation(async (url) => {
    if (url === "/diagnosticar/retinografo/auto-seleccion/7") return { data: { data: {
      paciente_id: 7, encontradas: 2, imagenes: { OD: candidates[0], OI: candidates[1] }, candidatas: candidates,
    } } };
    if (url === "/diagnosticar/retinografo/imagen") return { data: new Blob(["synthetic"], { type: "image/png" }) };
    return { data: { data: { ojos: [] } } };
  });
  vi.mocked(convertToPreviewUrl).mockReset().mockImplementation(async (file) => `blob:${file.name}`);
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("revisión exclusiva de fotografías manuales", () => {
  it.each([["OD"], ["OI"], ["OD", "OI"]] as EyeKey[][])("revisa %j con paciente real, casilla desmarcada y ningún envío anticipado", async (...eyes) => {
    await setup();
    for (const eye of eyes) await manual(eye);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openReview();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Confirmar fotografías seleccionadas");
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Paciente Sintético · DNI 00000000");
    expect(screen.getAllByText("Paciente Sintético · DNI 00000000")).toHaveLength(1);
    expect(screen.queryByText(/^Verifique que las fotografías seleccionadas/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(eyes.length);
    for (const eye of eyes) expect(screen.getByAltText(`Fotografía manual ${eye}`)).toHaveClass("object-contain");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Confirmar y analizar" })).toBeDisabled();
    act(() => work.confirmManualReview(work.manualReview!, false));
    expect(post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    const originalEyes = work.eyes;
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(work.eyes).toBe(originalEyes);
    expect(work.step).toBe(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("confirma una sola vez ambos ojos, secuencialmente y con la misma visita, incluso ante doble clic", async () => {
    await setup(); await manual("OD"); await manual("OI"); openReview();
    const review = work.manualReview!;
    let resolve!: (response: ReturnType<typeof inferenceResponse>) => void;
    post.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Confirmar y analizar" });
    fireEvent.click(button);
    fireEvent.click(button);
    act(() => work.confirmManualReview(review, true));
    expect(analyses()).toHaveLength(1);
    expect(work.manualReview).toBeNull();
    await act(async () => resolve(inferenceResponse("Derecho")));
    await waitFor(() => expect(work.step).toBe(3), { timeout: 3500 });
    const forms = analyses().map(([, body]) => body as FormData);
    expect(forms.map((form) => form.get("ojo_evaluado"))).toEqual(["Derecho", "Izquierdo"]);
    expect(forms[0].get("visita_id")).toBeNull();
    expect(forms[1].get("visita_id")).toBe("30");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("cada nueva apertura descarta la casilla anterior y Escape no envía solicitudes", async () => {
    await setup(); await manual("OD"); openReview();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    openReview();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it("sin vista previa no permite declarar una revisión visual", async () => {
    await setup();
    vi.mocked(convertToPreviewUrl).mockRejectedValueOnce(new Error("Vista no disponible"));
    await manual("OD"); openReview();
    expect(screen.getByRole("alert")).toHaveTextContent("Vista previa no disponible");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    act(() => work.confirmManualReview(work.manualReview!, true));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Selección Auto y lotes mixtos", () => {
  it("ambos ojos automáticos conservan una sola confirmación por ojo y no abren revisión manual", async () => {
    await setup(); await automatic(["OD", "OI"]);
    openReview();
    expect(work.manualReview).toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(work.step).toBe(3), { timeout: 3500 });
    expect(post.mock.calls.filter(([url]) => url === confirmationPath)).toHaveLength(2);
    expect(analyses()).toHaveLength(2);
    for (const [, body] of analyses()) {
      expect((body as FormData).has("confirmacion_exportacion")).toBe(true);
      expect((body as FormData).has("imagen")).toBe(false);
    }
  });

  it.each(["REVOCADA", "CONSUMIDA", "EXPIRADA"])("un comprobante automático %s no se habilita con una revisión manual", async (state) => {
    await setup(); await automatic(["OD"]);
    post.mockResolvedValueOnce({ data: { confirmacion: { ...confirmation("Derecho"),
      estado: state === "EXPIRADA" ? "CONFIRMADA" : state, vigente: false, expirada: state === "EXPIRADA" } } });
    openReview();
    await waitFor(() => expect(work.isSaving).toBe(false));
    expect(work.manualReview).toBeNull();
    expect(analyses()).toHaveLength(0);
    expect(post.mock.calls.filter(([url]) => url === confirmationPath)).toHaveLength(1);
  });

  it("en lote mixto solo revisa OI manual; cancelar no procesa OD ni altera su comprobante", async () => {
    await setup(); await automatic(["OD"]); await manual("OI");
    const original = work.eyes;
    openReview();
    expect(screen.queryByAltText("Fotografía manual OD")).not.toBeInTheDocument();
    expect(screen.getByAltText("Fotografía manual OI")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(work.eyes).toBe(original);
    expect(analyses()).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(1); // Solo la declaración original del retinógrafo.
    openReview(); acceptReview();
    await waitFor(() => expect(work.step).toBe(3), { timeout: 3500 });
    const forms = analyses().map(([, body]) => body as FormData);
    expect(forms[0].get("confirmacion_exportacion")).toBe("d".repeat(64));
    expect(forms[0].has("imagen")).toBe(false);
    expect(forms[1].get("imagen")).toBe(original.OI.file);
    expect(forms[1].get("visita_id")).toBe("30");
    expect(post.mock.calls.filter(([url]) => url === confirmationPath)).toHaveLength(1);
    expect(work.eyes.OD.confirmation).toBe("CONSUMIDA");
  });

  it("si vence OD automático durante la revisión de OI, no procesa el lote revisado", async () => {
    await setup(); await automatic(["OD"]); await manual("OI"); openReview();
    const review = work.manualReview!;
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date("2099-01-02T00:00:00Z").getTime());
    try {
      act(() => work.confirmManualReview(review, true));
      expect(work.manualReview).toBeNull();
      expect(analyses()).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });

  it("una consulta que revoca la elegibilidad automática cierra la revisión mixta sin analizar", async () => {
    await setup(); await automatic(["OD"]); await manual("OI"); openReview();
    const review = work.manualReview!;
    post.mockResolvedValueOnce({ data: { confirmacion: { ...confirmation("Derecho"), estado: "REVOCADA", vigente: false } } });
    await act(async () => { await work.checkConfirmation("OD"); });
    expect(work.manualReview).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => work.confirmManualReview(review, true));
    expect(analyses()).toHaveLength(0);
  });
});

describe("continuidad e invalidación del contexto", () => {
  it.each(["fotografía", "paciente", "visita", "ojo adicional", "retirar imagen"])("cambiar %s invalida una revisión ya marcada", async (change) => {
    await setup(); await manual("OD"); openReview();
    fireEvent.click(screen.getByRole("checkbox"));
    const review = work.manualReview!;
    if (change === "fotografía") await manual("OD");
    if (change === "ojo adicional") await manual("OI");
    if (change === "retirar imagen") await act(async () => work.clearEye("OD"));
    if (change === "paciente") act(() => work.selectPatient({ ...patient, id: 8 }));
    if (change === "visita") act(() => work.selectVisita(null));
    expect(work.manualReview).toBeNull();
    act(() => work.confirmManualReview(review, true));
    expect(post).not.toHaveBeenCalled();
    if (change === "fotografía" || change === "ojo adicional") {
      openReview();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      act(() => work.confirmManualReview(review, true));
      expect(post).not.toHaveBeenCalled();
    }
  });

  it("la sustitución iniciada en el mismo tick invalida la foto anterior antes de resolver su vista previa", async () => {
    await setup(); await manual("OD"); openReview();
    const review = work.manualReview!;
    let resolve!: (preview: string) => void;
    vi.mocked(convertToPreviewUrl).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    let replacement!: Promise<void>;
    act(() => {
      replacement = work.handleFile("OD", new File(["other"], "other.jpg"));
      work.confirmManualReview(review, true);
    });
    expect(post).not.toHaveBeenCalled();
    await act(async () => { resolve("blob:other"); await replacement; });
    expect(work.manualReview).toBeNull();
  });

  it("al añadir OI conserva OD, decisiones médicas y visita; volver a resultados no pide revisión", async () => {
    await setup(); await manual("OD"); openReview(); acceptReview();
    await waitFor(() => expect(work.step).toBe(3), { timeout: 3500 });
    const original = work.eyes.OD;
    act(() => {
      work.setFinalSelection("OD", 3); work.setCorrectionReason("OD", "Motivo OD");
      work.setComment("OD", "Nota OD"); work.goBack();
    });
    await manual("OI");
    act(() => work.returnToResults());
    expect(work.manualReview).toBeNull();
    expect(analyses()).toHaveLength(1);
    act(() => work.goBack()); openReview();
    expect(screen.queryByAltText("Fotografía manual OD")).not.toBeInTheDocument();
    expect(screen.getByAltText("Fotografía manual OI")).toBeInTheDocument();
    const stale = work.manualReview!;
    act(() => work.returnToResults());
    act(() => work.confirmManualReview(stale, true));
    expect(analyses()).toHaveLength(1);
    act(() => work.goBack()); openReview(); acceptReview();
    await waitFor(() => expect(work.step).toBe(3), { timeout: 3500 });
    expect(analyses()).toHaveLength(2);
    expect((analyses()[1][1] as FormData).get("visita_id")).toBe("30");
    expect(work.eyes.OD).toBe(original);
    expect(work.finalSelection.OD).toBe(3);
    expect(work.correctionReasons.OD).toBe("Motivo OD");
    expect(work.comments.OD).toBe("Nota OD");
  });

  it("un envío manual incierto no se reintenta ni vuelve a ofrecer revisión", async () => {
    await setup(); await manual("OD"); openReview();
    post.mockRejectedValueOnce(new Error("Respuesta perdida"));
    acceptReview();
    await waitFor(() => expect(work.isSaving).toBe(false));
    expect(work.eyeProcessing.OD).toBe("incierto");
    openReview();
    expect(work.manualReview).toBeNull();
    expect(analyses()).toHaveLength(1);
  });

  it.each(["sesión", "desmontaje"])("no utiliza una revisión antigua tras cambiar %s", async (change) => {
    const ui = await setup(); await manual("OD"); openReview();
    const review = work.manualReview!;
    const confirm = work.confirmManualReview;
    if (change === "sesión") act(() => useAuthStore.getState().logout());
    else ui.unmount();
    act(() => confirm(review, true));
    expect(post).not.toHaveBeenCalled();
  });
});
