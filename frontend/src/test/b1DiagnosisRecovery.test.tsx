// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { crearDiagnostico, descargarImagenRetinografo, obtenerDetallesVisita, obtenerSeleccionAutomaticaRetinografo, resultadoPersistido } from "../features/diagnosis/api/diagnosisService";
import type { DetalleDiagnosticoExistente, DiagnosisResult } from "../features/diagnosis/api/diagnosisService";
import { toast } from "../hooks/use-toast";
import { revokePreviewUrl } from "../lib/imageUtils";
import { obtenerVisitasPaciente } from "../features/patients/api/patientService";
import { confirmManualPhotos } from "./diagnosisTestActions";
import { DiagnosisPatientStep } from "../features/diagnosis/components/DiagnosisPatientStep";
import { formatClinicalInstant } from "../lib/clinicalDates";

vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/diagnosis/api/diagnosisService")>();
  return { ...original, crearDiagnostico: vi.fn(), obtenerDetallesVisita: vi.fn(),
    obtenerSeleccionAutomaticaRetinografo: vi.fn(), descargarImagenRetinografo: vi.fn() };
});
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn().mockResolvedValue("blob:synthetic"), revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const create = vi.mocked(crearDiagnostico);
const read = vi.mocked(obtenerDetallesVisita);
const selectExport = vi.mocked(obtenerSeleccionAutomaticaRetinografo);
const downloadExport = vi.mocked(descargarImagenRetinografo);
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
  confirmManualPhotos(hook.result);
  await waitFor(() => expect(hook.result.current.isSaving).toBe(false), { timeout: 3500 });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async (_id, eye) => result(eye === "Derecho" ? "OD" : "OI"));
  read.mockResolvedValue([]);
});

describe("creación secuencial y conciliación por ojo", () => {
  it("selecciona visitas UTC acreditadas de las últimas 24 h, incluso con históricos ambiguos", async () => {
    const now = new Date("2030-01-02T00:30:00Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const visits = vi.mocked(obtenerVisitasPaciente);
    visits.mockResolvedValueOnce([
      { visita_id: 9, fecha_visita: "2030-01-02T00:30:00", fecha_visita_origen: "NO_VERIFICADO", estado: "ACTIVA", tiene_diagnostico_ia: 0 },
      { visita_id: 10, fecha_visita: new Date(now - 24 * 3600_000).toISOString(), fecha_visita_origen: "UTC_VERIFICADO", estado: "ACTIVA", tiene_diagnostico_ia: 0 },
      { visita_id: 11, fecha_visita: new Date(now - 24 * 3600_000 - 1).toISOString(), fecha_visita_origen: "UTC_VERIFICADO", estado: "ACTIVA", tiene_diagnostico_ia: 0 },
      { visita_id: 12, fecha_visita: new Date(now - 3600_000).toISOString(), fecha_visita_origen: "UTC_VERIFICADO", estado: "ACTIVA", tiene_diagnostico_ia: 0 },
      { visita_id: 13, fecha_visita: new Date(now - 3600_000).toISOString(), estado: "ACTIVA", tiene_diagnostico_ia: 0 },
    ] as Awaited<ReturnType<typeof obtenerVisitasPaciente>>);
    try {
      const hook = renderHook(() => useDiagnosis(), { wrapper });
      act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
      await waitFor(() => expect(hook.result.current.visitasRecientes.map((v) => v.visita_id)).toEqual([12, 10]));
      hook.unmount();
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    { name: "ACTIVA reciente sin IA", state: "ACTIVA", diagnosis: 0, ageMs: 3600_000, eligible: true },
    { name: "ACTIVA reciente con IA", state: "ACTIVA", diagnosis: 1, ageMs: 3600_000, eligible: false },
    { name: "CERRADA reciente", state: "CERRADA", diagnosis: 0, ageMs: 3600_000, eligible: false },
    { name: "ANULADA reciente", state: "ANULADA", diagnosis: 0, ageMs: 3600_000, eligible: false },
    { name: "estado ausente", state: undefined, diagnosis: 0, ageMs: 3600_000, eligible: false },
    { name: "estado desconocido", state: "DESCONOCIDA", diagnosis: 0, ageMs: 3600_000, eligible: false },
    { name: "ACTIVA con más de 24 horas", state: "ACTIVA", diagnosis: 0, ageMs: 24 * 3600_000 + 1, eligible: false },
    { name: "límite exacto de 24 horas", state: "ACTIVA", diagnosis: 0, ageMs: 24 * 3600_000, eligible: true },
    { name: "instante actual", state: "ACTIVA", diagnosis: 0, ageMs: 0, eligible: true },
    { name: "fecha futura", state: "ACTIVA", diagnosis: 0, ageMs: -1, eligible: false },
  ])("elegibilidad: $name", async ({ state, diagnosis, ageMs, eligible }) => {
    const now = Date.parse("2030-01-02T02:30:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([{
      visita_id: 30, fecha_visita: new Date(now - ageMs).toISOString(),
      fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético",
      estado: state, tiene_diagnostico_ia: diagnosis,
    }]);
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    try {
      act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
      await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
      expect(hook.result.current.visitasRecientes.map((v) => v.visita_id)).toEqual(eligible ? [30] : []);
      expect(obtenerVisitasPaciente).toHaveBeenCalledWith(7);
      expect(hook.result.current.selectedVisita).toBeUndefined();
      expect(hook.result.current.canNext).toBe(false);
      expect(create).not.toHaveBeenCalled();
    } finally {
      hook.unmount(); clock.mockRestore();
    }
  });

  it("UTC y Lima representan la misma visita reciente aunque cambie el día civil", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-02T02:30:00Z"));
    const utc = "2030-01-02T00:30:00Z";
    const lima = "2030-01-01T19:30:00-05:00";
    vi.mocked(obtenerVisitasPaciente).mockResolvedValueOnce([utc, lima].map((date, index) => ({
      visita_id: 30 + index, fecha_visita: date, fecha_visita_origen: "UTC_VERIFICADO",
      medico_tratante: "Sintético", estado: "ACTIVA", tiene_diagnostico_ia: 0,
    })));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    try {
      act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
      await waitFor(() => expect(hook.result.current.visitasRecientes).toHaveLength(2));
      expect(formatClinicalInstant(utc)).toBe(formatClinicalInstant(lima));
      expect(formatClinicalInstant(utc)).toContain("01/01/2030");
      expect(formatClinicalInstant(utc)).toContain("19:30");
    } finally {
      hook.unmount(); clock.mockRestore();
    }
  });

  it("una respuesta tardía no incorpora visitas del paciente anterior", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof obtenerVisitasPaciente>>) => void;
    vi.mocked(obtenerVisitasPaciente).mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce([]);
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    try {
      act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
      act(() => hook.result.current.selectPatient({ id: 8 } as Parameters<typeof hook.result.current.selectPatient>[0]));
      await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
      await act(async () => { resolve([{
        visita_id: 30, fecha_visita: new Date().toISOString(), fecha_visita_origen: "UTC_VERIFICADO",
        medico_tratante: "Sintético", estado: "ACTIVA", tiene_diagnostico_ia: 0,
      }]); });
      expect(hook.result.current.selectedPatient?.id).toBe(8);
      expect(hook.result.current.visitasRecientes).toEqual([]);
      expect(hook.result.current.selectedVisita).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("explica que el selector no es el historial y conserva la opción Nueva visita", () => {
    const select = vi.fn();
    const view = render(<DiagnosisPatientStep query="" searchResults={[]} recentPatients={[]}
      selectedPatient={{ id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" }}
      isSearching={false} isLoadingMore={false} hasMoreSearchResults={false} searchError={null} recentError={null}
      hasSearched={false} isLoadingRecent={false} visitasRecientes={[]} selectedVisita={undefined} isLoadingVisitas={false}
      registrationDialog={null} onQueryChange={vi.fn()} onLoadMore={vi.fn()} onSelect={vi.fn()}
      onSelectVisita={select} onClear={vi.fn()} />);
    try {
      expect(screen.getByText("No hay visitas recientes elegibles.")).toBeTruthy();
      expect(screen.getByText("Este selector muestra atenciones de las últimas 24 horas sin resultados IA registrados; no muestra todo el historial.")).toBeTruthy();
      expect(screen.queryByText("No hay visitas disponibles de las últimas 24 horas.")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Nueva visita/i }));
      expect(select).toHaveBeenCalledWith(null);
    } finally {
      view.unmount();
    }
  });

  it("la selección automática queda como candidata y no habilita inferencia sin confirmación 28C", async () => {
    selectExport.mockResolvedValueOnce({ paciente_id: 7, encontradas: 2, imagenes: {
      OD: { filename: "12345678_01012026_101010_Color_R_1.jpg", ojo: "OD", ojo_original: "R",
        tipo_imagen: "Color", secuencia: 1, extension: "jpg", fecha_exportacion: "2026-01-01T10:10:10", mime_type: "image/jpeg" },
      OI: { filename: "12345678_01012026_101010_Color_L_1.png", ojo: "OI", ojo_original: "L",
        tipo_imagen: "Color", secuencia: 1, extension: "png", fecha_exportacion: "2026-01-01T10:10:10", mime_type: "image/png" },
    } });
    downloadExport.mockResolvedValue(new Blob(["synthetic"]));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => {
      hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]);
      hook.result.current.selectVisita(null);
    });
    await act(async () => hook.result.current.autoSelectRetinographImages());
    expect(downloadExport).not.toHaveBeenCalled();
    expect(hook.result.current.autoCandidates).toHaveLength(2);
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.eyes.OI.file).toBeNull();
    act(() => hook.result.current.goNext());
    expect(hook.result.current.canNext).toBe(false);
    act(() => hook.result.current.goNext());
    expect(create).not.toHaveBeenCalled();
    expect(hook.result.current.processingNotice).toMatch(/confirmar/i);
    hook.unmount();
  });
  it.each([401, 403, 404, undefined])("distingue denegación/sesión/recurso/red %s sin conservar vistas denegadas", async (status) => {
    selectExport.mockResolvedValueOnce({ paciente_id: 7, encontradas: 1, imagenes: {
      OD: { filename: "12345678_01012026_101010_Color_R_1.jpg", ojo: "OD", ojo_original: "R",
        tipo_imagen: "Color", secuencia: 1, extension: "jpg", fecha_exportacion: "2026-01-01T10:10:10", mime_type: "image/jpeg" },
    } });
    downloadExport.mockResolvedValueOnce(new Blob(["synthetic"]));
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    await act(async () => hook.result.current.autoSelectRetinographImages());
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    expect(hook.result.current.autoPreview?.preview).toBe("blob:synthetic");
    selectExport.mockRejectedValueOnce(status ? { response: { status } } : new Error("Network Error"));
    await act(async () => hook.result.current.autoSelectRetinographImages());
    const message = vi.mocked(toast).mock.lastCall?.[0]?.description;
    expect(message).toMatch(status === 401 ? /sesión/i : status === 403 ? /autorización/i
      : status === 404 ? /no se encontró/i : /conexión/i);
    if (status) {
      expect(hook.result.current.autoPreview).toBeNull();
      expect(revokePreviewUrl).toHaveBeenCalledWith("blob:synthetic");
    }
    hook.unmount();
  });

  it("libera la vista del ojo descargado si el otro falla", async () => {
    selectExport.mockResolvedValueOnce({ paciente_id: 7, encontradas: 2, imagenes: {
      OD: { filename: "12345678_01012026_101010_Color_R_1.jpg", ojo: "OD", ojo_original: "R",
        tipo_imagen: "Color", secuencia: 1, extension: "jpg", fecha_exportacion: "2026-01-01T10:10:10", mime_type: "image/jpeg" },
      OI: { filename: "12345678_01012026_101010_Color_L_1.jpg", ojo: "OI", ojo_original: "L",
        tipo_imagen: "Color", secuencia: 1, extension: "jpg", fecha_exportacion: "2026-01-01T10:10:10", mime_type: "image/jpeg" },
    } });
    downloadExport.mockResolvedValueOnce(new Blob(["synthetic"])).mockRejectedValueOnce({ response: { status: 403 } });
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => hook.result.current.selectPatient({ id: 7 } as Parameters<typeof hook.result.current.selectPatient>[0]));
    await act(async () => hook.result.current.autoSelectRetinographImages());
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[0]));
    await act(async () => hook.result.current.selectAutoCandidate(hook.result.current.autoCandidates[1]));
    expect(revokePreviewUrl).toHaveBeenCalledWith("blob:synthetic");
    expect(hook.result.current.eyes.OD.file).toBeNull();
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(create).not.toHaveBeenCalled();
    hook.unmount();
  });
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

  it.each([
    { code: "DESCARTE_NO_INSTALADO", expected: "configuración de base de datos está incompleta" },
    { code: "VALIDADOR_IMAGEN_NO_DISPONIBLE", expected: "La validación de imagen no está disponible" },
    { code: undefined, expected: "El procesamiento no está disponible temporalmente" },
    { code: "DESCONOCIDO", expected: "El procesamiento no está disponible temporalmente" },
  ])("distingue la causa del 503 de OI sin culpar a la imagen: $code", async ({ code, expected }) => {
    create.mockResolvedValueOnce(result("OD")).mockRejectedValueOnce({ response: {
      status: 503, data: { code, message: "internal private details must not be rendered" },
    } });
    const hook = await start(["OD", "OI"]);
    expect(hook.result.current.processingNotice).toContain(expected);
    expect(hook.result.current.processingNotice).not.toContain("internal private");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Procesamiento interrumpido: OI", description: expect.stringContaining(expected),
    }));
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.eyes.OI.file).not.toBeNull();
    expect(hook.result.current.eyeProcessing.OI).toBe("error");
    expect(create).toHaveBeenCalledTimes(2); expect(read).not.toHaveBeenCalled();
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
    confirmManualPhotos(hook.result);
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
