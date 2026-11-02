// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { diagnosisDiscardEnabled } from "../lib/clinicalFeatures";
import { useDiagnosisCorrection } from "../features/diagnosis/hooks/useDiagnosisCorrection";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { useAuthStore } from "../features/auth/store/authStore";
import { hydrateDiscardMarkers, recordDiscard, retainDiscardMarker, retireDiscardMarker, useDiagnosisDiscardStore } from "../features/diagnosis/store/diagnosisDiscardStore";
import type { PendingDiscard } from "../features/diagnosis/store/diagnosisDiscardStore";
import type { DiscardContext, DiscardOperation } from "../features/diagnosis/api/diagnosisDiscardService";
import type { DiagnosisResult, DetalleDiagnosticoExistente } from "../features/diagnosis/api/diagnosisService";
import { obtenerPacientesRecientes, obtenerVisitasPaciente } from "../features/patients/api/patientService";
import { convertToPreviewUrl } from "../lib/imageUtils";
import fixture from "./fixtures/diagnosisDiscardContract74.json";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../lib/clinicalFeatures", () => ({ diagnosisDiscardEnabled: vi.fn(() => true) }));
vi.mock("../features/patients/api/patientService", () => ({
  obtenerPacientesRecientes: vi.fn().mockResolvedValue([]), obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("../lib/imageUtils", () => ({ convertToPreviewUrl: vi.fn(async () => "blob:synthetic"), revokePreviewUrl: vi.fn() }));

const key = "codn.discard-recovery.v1.1";
const operationPath = `/diagnosticar/visita/30/operaciones-descarte/${fixture.request.operacion_id}`;
const contextPath = "/diagnosticar/visita/30/contexto-descarte";
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const envelope = (data: unknown) => ({ data: { success: true, data } });
const resetMemory = () => useDiagnosisDiscardStore.setState({ entries: [], markers: [], recoveryActorId: null, storageError: false });
const makeEntry = (): PendingDiscard => ({ actorId: 1, visitId: 30, status: "uncertain",
  request: { ...fixture.request, confirmo_descarte: true }, targets: [{ eye: "OI", detailId: 12 }] });
function persist(entry = makeEntry()) {
  hydrateDiscardMarkers(1);
  expect(retainDiscardMarker(entry)).toBe(true);
}
const markers = () => JSON.parse(sessionStorage.getItem(key) ?? "[]");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
type Options = Parameters<typeof useDiagnosisCorrection>[0];
const options = (overrides: Partial<Options> = {}): Options => ({ step: 1, patientId: null, visitId: null, results: {},
  version: () => 0, busy: () => false, apply: vi.fn(() => false), ...overrides });
const result = (id: number): DiagnosisResult => ({ visita_id: 30, detalle_id: id, diagnostico_codigo: 2,
  diagnostico_texto: "Moderada", confianza_general: 80, probabilidades_detalle: {}, mensaje: "Registrado" });
let context: DiscardContext;
let operation: DiscardOperation | null;
let details: DetalleDiagnosticoExistente[];

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear(); resetMemory();
  vi.mocked(diagnosisDiscardEnabled).mockReturnValue(true);
  vi.mocked(obtenerPacientesRecientes).mockResolvedValue([]);
  vi.mocked(obtenerVisitasPaciente).mockResolvedValue([]);
  vi.mocked(convertToPreviewUrl).mockResolvedValue("blob:synthetic");
  useAuthStore.getState().login("synthetic-session", { id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético",
    roles: ["Oftalmologo"], permisos: ["diagnostico_retinopatia.descartar_pendiente"] });
  vi.stubGlobal("crypto", { randomUUID: () => fixture.request.operacion_id });
  context = structuredClone(fixture.remaining.body.data) as DiscardContext;
  operation = structuredClone(fixture.operation.body.data.operacion) as DiscardOperation;
  details = [{ detalle_id: 11, ojo: "OD", resultado_ia: 2, diagnostico_texto: "Moderada", confianza_general: 80,
    probabilidades_detalle: { moderada: 80 }, diagnostico_final: null, estado_validacion: "PENDIENTE",
    comentario_medico: null, motivo_correccion: null, imagen_url: "OD-current.jpg", gradcam_url: "OD-current-gradcam.jpg" }];
  get.mockReset().mockImplementation(async (url) => {
    if (String(url).includes("/operaciones-descarte/")) return envelope({ conciliacion: operation ? "CONFIRMADA" : "NO_CONFIRMADA", operacion: operation });
    if (url === contextPath) return envelope(structuredClone(context));
    if (url === "/diagnosticar/visita/30/detalles") return envelope({ ojos: structuredClone(details) });
    throw new Error(`GET no previsto: ${url}`);
  });
  post.mockReset(); vi.mocked(api.put).mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useAuthStore.getState().logout(); resetMemory(); sessionStorage.clear(); });

async function openNormal() {
  context = structuredClone(fixture.context.body.data) as DiscardContext;
  const hook = renderHook(() => useDiagnosisCorrection(options({ step: 3, patientId: 7, visitId: 30,
    results: { OD: result(11), OI: result(12) }, apply: vi.fn(() => true) })));
  await waitFor(() => expect(hook.result.current.canOpen).toBe(true));
  await act(async () => { await hook.result.current.open(); });
  return hook;
}

describe("marcador mínimo y POST rastreable", () => {
  it("verifica UUID en sessionStorage antes del POST y lo conserva hasta aplicar", async () => {
    const hook = await openNormal();
    post.mockImplementationOnce(async () => {
      expect(markers()).toEqual([{ version: 1, actorId: 1, visitId: 30, operationId: fixture.request.operacion_id }]);
      expect(sessionStorage.getItem(key)).not.toMatch(/token|jwt|paciente|nombres|DNI|detalle_ids|resultado|fotograf|comentario|grado|probabil|revision/i);
      return { data: fixture.discard.body };
    });
    await act(async () => { await hook.result.current.confirm(hook.result.current.review!, [12], true); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(markers()).toEqual([]);
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("applied");
  });
  it.each(["throw", "silent", "read"] as const)("almacenamiento %s impide enviar el descarte", async (mode) => {
    const hook = await openNormal();
    if (mode === "read") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    else vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { if (mode === "throw") throw new Error("quota"); });
    await act(async () => { await hook.result.current.confirm(hook.result.current.review!, [12], true); });
    expect(post).not.toHaveBeenCalled();
    expect(hook.result.current.blocked()).toBe(true);
    expect(hook.result.current.notice).toContain("almacenamiento");
  });
  it.each([400, 401, 403, 409])("rechazo definitivo del único POST (%s) retira su marcador", async (status) => {
    const hook = await openNormal();
    post.mockRejectedValueOnce({ response: { status } });
    await act(async () => { await hook.result.current.confirm(hook.result.current.review!, [12], true); });
    expect(markers()).toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("rejected");
  });
  it("timeout conserva exactamente el UUID y no acepta un segundo POST", async () => {
    const hook = await openNormal(); operation = null;
    const review = hook.result.current.review!;
    post.mockRejectedValueOnce(new Error("timeout"));
    await act(async () => { await hook.result.current.confirm(review, [12], true); });
    await act(async () => { await hook.result.current.confirm(review, [12], true); await hook.result.current.reconcile(); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(markers()[0].operationId).toBe(fixture.request.operacion_id);
    expect(get.mock.calls.filter(([url]) => String(url).includes("/operaciones-descarte/")).every(([url]) => url === operationPath)).toBe(true);
  });
  it("fallo al retirar no borra el UUID ni libera el contexto", () => {
    persist();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(retireDiscardMarker(useDiagnosisDiscardStore.getState().markers[0])).toBe(false);
    expect(markers()).toHaveLength(1);
    expect(useDiagnosisDiscardStore.getState().storageError).toBe(true);
  });
  it("si falla retirar después de aplicar, una recarga todavía puede consultar el UUID", async () => {
    const hook = await openNormal();
    const write = Storage.prototype.setItem;
    let writes = 0;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === key && ++writes === 2) throw new Error("retire unavailable");
      write.call(this, k, v);
    });
    post.mockResolvedValueOnce({ data: fixture.discard.body });
    await act(async () => { await hook.result.current.confirm(hook.result.current.review!, [12], true); });
    expect(useDiagnosisDiscardStore.getState().entries[0].status).toBe("applied");
    expect(markers()).toHaveLength(1);
    hook.unmount(); spy.mockRestore(); resetMemory();
    context = structuredClone(fixture.remaining.body.data) as DiscardContext;
    const recover = vi.fn(async () => true);
    renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(markers()).toEqual([]); expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("recarga y GET autorizado sin replay", () => {
  it("recarga entre commit y aplicación conserva identidad hasta completar conciliación", async () => {
    persist(); recordDiscard({ ...makeEntry(), status: "confirmed", operation: operation! });
    resetMemory(); // Solo se pierde memoria; sessionStorage sobrevive.
    const applied = deferred<boolean>();
    const recover = vi.fn(() => applied.promise);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(hook.result.current.blocked()).toBe(true);
    expect(markers()).toHaveLength(1);
    await act(async () => { applied.resolve(true); await applied.promise; });
    await waitFor(() => expect(hook.result.current.blocked()).toBe(false));
    expect(markers()).toEqual([]);
    expect(get).toHaveBeenCalledWith(operationPath);
    expect(get).toHaveBeenCalledWith(contextPath, { params: { operacion_id: fixture.request.operacion_id } });
    expect(post).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 500, 503])("GET %s conserva marcador y bloqueo", async (status) => {
    persist(); resetMemory();
    get.mockRejectedValue({ response: { status } });
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30 })));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => { await hook.result.current.reconcile(); });
    expect(hook.result.current.blocked()).toBe(true);
    expect(markers()[0].operationId).toBe(fixture.request.operacion_id);
    expect(post).not.toHaveBeenCalled();
  });
  it("NO_CONFIRMADA permite una consulta real posterior con el mismo UUID", async () => {
    persist(); resetMemory(); operation = null;
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    await waitFor(() => expect(hook.result.current.notice).toContain("aún no"));
    expect(hook.result.current.blocked()).toBe(true);
    operation = fixture.operation.body.data.operacion as DiscardOperation;
    await act(async () => { await hook.result.current.reconcile(); });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(markers()).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });
  it("sin selección clínica consulta UUID pero no adopta ni libera contexto", async () => {
    persist(); resetMemory();
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ recover })));
    await waitFor(() => expect(hook.result.current.recoveries[0]?.notice).toContain("confirmada"));
    expect(recover).not.toHaveBeenCalled();
    expect(markers()).toHaveLength(1);
    expect(get).not.toHaveBeenCalledWith(contextPath);
    expect(hook.result.current.blocked()).toBe(false); // Otros contextos/módulos no se bloquean.
    await act(async () => { await hook.result.current.recoveries[0].consult(); });
    expect(get.mock.calls.filter(([url]) => url === operationPath)).toHaveLength(2);
  });
  it("UUID o visita no coincidentes nunca habilitan recuperación", async () => {
    persist(); resetMemory(); operation!.operacion_id = "22222222-2222-4222-8222-222222222222";
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    await waitFor(() => expect(hook.result.current.notice).toContain("No se pudo"));
    expect(recover).not.toHaveBeenCalled(); expect(markers()).toHaveLength(1);
  });
  it("operación confirmada con contexto 403 permanece bloqueada sin perder identidad", async () => {
    persist(); resetMemory();
    get.mockImplementation(async (url) => {
      if (url === operationPath) return { data: fixture.operation.body };
      throw { response: { status: 403 } };
    });
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    await waitFor(() => expect(hook.result.current.notice).toContain("No se pudo"));
    expect(hook.result.current.blocked()).toBe(true);
    expect(recover).not.toHaveBeenCalled(); expect(markers()).toHaveLength(1);
  });
  it("ausencia manipulada en storage no invalida evidencia que sigue en memoria", () => {
    persist(); recordDiscard(makeEntry());
    sessionStorage.removeItem(key);
    hydrateDiscardMarkers(1);
    expect(useDiagnosisDiscardStore.getState().markers[0].operationId).toBe(fixture.request.operacion_id);
  });
  it("registrar otra visita no pierde un marcador conocido aunque falte en storage", () => {
    persist();
    sessionStorage.removeItem(key);
    const second = makeEntry(); second.visitId = 31;
    second.request.operacion_id = "22222222-2222-4222-8222-222222222222";
    expect(retainDiscardMarker(second)).toBe(true);
    expect(markers().map((m: { visitId: number }) => m.visitId)).toEqual([30, 31]);
  });
  it("lectura inaccesible conserva los marcadores ya conocidos y falla cerrada", () => {
    persist();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    hydrateDiscardMarkers(1);
    expect(useDiagnosisDiscardStore.getState().markers[0].operationId).toBe(fixture.request.operacion_id);
    expect(useDiagnosisDiscardStore.getState().storageError).toBe(true);
  });
});

describe("identidad, sesión, pestaña y contenido inválido", () => {
  it("otro usuario no consulta ni ve el marcador anterior; el autor puede volver", async () => {
    persist(); resetMemory();
    act(() => useAuthStore.getState().login("other", { id: 2, username: "other", nombres: "Otro", apellidos: "Sintético", roles: ["Oftalmologo"] }));
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30 })));
    expect(hook.result.current.pending).toBe(false); expect(hook.result.current.recoveries).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    act(() => useAuthStore.getState().logout());
    expect(hook.result.current.recoveries).toEqual([]);
    expect(markers()).toHaveLength(1);
    act(() => useAuthStore.getState().login("again", { id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético", roles: ["Oftalmologo"] }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(operationPath));
    expect(hook.result.current.pending).toBe(true);
  });
  it.each(["{", '[{"version":0}]', JSON.stringify([{ version: 1, actorId: 2, visitId: 30, operationId: fixture.request.operacion_id }]),
    JSON.stringify([{ version: 1, actorId: 1, visitId: 30, operationId: fixture.request.operacion_id, extra: "no" }])])("marcador malformado no autoriza nada (%s)", (raw) => {
    sessionStorage.setItem(key, raw);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30 })));
    expect(hook.result.current.blocked()).toBe(true);
    expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it("respuesta tardía de recuperación no se aplica al cambiar visita", async () => {
    persist(); resetMemory();
    const response = deferred<ReturnType<typeof envelope>>(); get.mockReturnValueOnce(response.promise);
    const recover = vi.fn(async () => true);
    const hook = renderHook(({ visit }) => useDiagnosisCorrection(options({ patientId: 7, visitId: visit, recover })), { initialProps: { visit: 30 } });
    hook.rerender({ visit: 31 });
    await act(async () => { response.resolve(envelope(fixture.operation.body.data)); await response.promise; });
    expect(recover).not.toHaveBeenCalled(); expect(markers()).toHaveLength(1);
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.blocked()).toBe(false);
  });
  it("logout invalida incluso una respuesta de la misma cuenta restaurada", async () => {
    persist(); resetMemory();
    const response = deferred<ReturnType<typeof envelope>>(); get.mockReturnValueOnce(response.promise);
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30, recover })));
    act(() => useAuthStore.getState().logout());
    await act(async () => { response.resolve(envelope(fixture.operation.body.data)); await response.promise; });
    expect(recover).not.toHaveBeenCalled();
    expect(hook.result.current.recoveries).toEqual([]);
    expect(markers()).toHaveLength(1);
  });
  it("dos sessionStorage de pestañas permanecen independientes", () => {
    const secondTab = new Map<string, string>();
    persist(); resetMemory();
    const firstTab = sessionStorage;
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue({
      getItem: (k) => secondTab.get(k) ?? null, setItem: (k, v) => { secondTab.set(k, v); },
      removeItem: (k) => { secondTab.delete(k); }, clear: () => secondTab.clear(), key: () => null,
      get length() { return secondTab.size; },
    });
    hydrateDiscardMarkers(1);
    expect(useDiagnosisDiscardStore.getState().markers).toEqual([]);
    expect(firstTab.getItem(key)).toContain(fixture.request.operacion_id);
    expect(secondTab.size).toBe(0);
  });
  it("flag apagada no lee storage ni consulta endpoints, incluso con marcador", () => {
    persist(); resetMemory(); vi.mocked(diagnosisDiscardEnabled).mockReturnValue(false);
    const access = vi.spyOn(window, "sessionStorage", "get");
    const hook = renderHook(() => useDiagnosisCorrection(options({ patientId: 7, visitId: 30 })));
    expect(access).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(hook.result.current.blocked()).toBe(false); expect(hook.result.current.notice).toBeNull();
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" };
async function selectRecoveredVisit() {
  const visit = { visita_id: 30, fecha_visita: "2020-01-01T10:00:00Z", fecha_visita_origen: "UTC_VERIFICADO" as const,
    medico_tratante: "Profesional sintético", tiene_diagnostico_ia: 1, estado: "ACTIVA" };
  vi.mocked(obtenerVisitasPaciente).mockResolvedValue([visit]);
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => hook.result.current.selectPatient(patient));
  await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
  expect(hook.result.current.visitasRecientes.map((v) => v.visita_id)).toContain(30);
  act(() => hook.result.current.selectVisita(visit));
  return hook;
}
describe("adopción real de contexto en useDiagnosis tras recargar", () => {
  it("consulta estado actual, conserva OD validado y libera solo OI con la misma visita", async () => {
    persist(); resetMemory();
    context.estado_diagnostico = "VALIDADO";
    context.detalles[0].estado_validacion = "CORREGIDO";
    details[0] = { ...details[0], estado_validacion: "CORREGIDO", diagnostico_final: 3,
      comentario_medico: "Comentario persistido", motivo_correccion: "Motivo persistido" };
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(hook.result.current.step).toBe(2));
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.validatedEyes.OD).toBe("CORREGIDO");
    expect(hook.result.current.finalSelection.OD).toBe(3);
    expect(hook.result.current.comments.OD).toBe("Comentario persistido");
    expect(hook.result.current.correctionReasons.OD).toBe("Motivo persistido");
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.eyes.OD.file).toBeNull(); expect(hook.result.current.eyes.OI.file).toBeNull();
    await act(async () => { await hook.result.current.handleFile("OD", new File(["x"], "OD.jpg")); });
    expect(hook.result.current.eyes.OD.file).toBeNull();
    await act(async () => { await hook.result.current.handleFile("OI", new File(["x"], "OI.jpg")); });
    act(() => hook.result.current.goNext());
    expect(hook.result.current.manualReview?.images.map((i) => i.eye)).toEqual(["OI"]);
    expect(markers()).toEqual([]); expect(post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });
  it("padre vacío no restaura resultados antiguos ni crea otra visita", async () => {
    const entry = makeEntry(); entry.request.operacion_id = fixture.lastDiscard.body.data.operacion_id;
    persist(entry); resetMemory(); operation = fixture.lastDiscard.body.data as DiscardOperation;
    context = fixture.emptyVisit.body.data as DiscardContext;
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(hook.result.current.step).toBe(2));
    expect(hook.result.current.results).toEqual({}); expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(get).not.toHaveBeenCalledWith("/diagnosticar/visita/30/detalles");
    expect(post).not.toHaveBeenCalled(); expect(markers()).toEqual([]);
  });
  it("un nuevo detalle OI se consulta por su ID actual y nunca se limpia como el antiguo", async () => {
    persist(); resetMemory();
    context.detalles.push({ detalle_id: 13, ojo: "OI", estado_validacion: "PENDIENTE", elegible: true, bloqueo: null });
    details.push({ ...details[0], detalle_id: 13, ojo: "OI", imagen_url: "OI-new.jpg" });
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(hook.result.current.step).toBe(2));
    expect(hook.result.current.results.OI?.detalle_id).toBe(13);
    expect(Object.values(hook.result.current.results).some((r) => r?.detalle_id === 12)).toBe(false);
    expect(markers()).toEqual([]); expect(post).not.toHaveBeenCalled();
  });
  it("snapshot que cambia durante la consulta no se adopta ni retira marcador", async () => {
    persist(); resetMemory();
    const original = get.getMockImplementation()!;
    let count = 0;
    get.mockImplementation(async (url, config) => {
      if (url === contextPath && ++count === 2) return envelope({ ...context, revision: 2 });
      return original(url, config);
    });
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(count).toBe(2));
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.correction.blocked()).toBe(true); expect(markers()).toHaveLength(1);
  });
  it("contexto de otro paciente no se aplica", async () => {
    persist(); resetMemory(); context.paciente_id = 8;
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(hook.result.current.correction.notice).toContain("No se pudo"));
    expect(hook.result.current.selectedPatient?.id).toBe(7); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.correction.blocked()).toBe(true); expect(markers()).toHaveLength(1);
  });
  it("cambiar paciente mientras llegan detalles no instala resultados en el nuevo contexto", async () => {
    persist(); resetMemory();
    const response = deferred<ReturnType<typeof envelope>>();
    const original = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === "/diagnosticar/visita/30/detalles" ? response.promise : original(url, config));
    const hook = await selectRecoveredVisit();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/diagnosticar/visita/30/detalles"));
    act(() => { hook.result.current.selectPatient({ ...patient, id: 8 }); });
    await act(async () => { response.resolve(envelope({ ojos: details })); await response.promise; });
    expect(hook.result.current.selectedPatient?.id).toBe(8);
    expect(hook.result.current.results).toEqual({}); expect(hook.result.current.step).toBe(1);
    expect(markers()).toHaveLength(1); expect(post).not.toHaveBeenCalled();
  });
});
