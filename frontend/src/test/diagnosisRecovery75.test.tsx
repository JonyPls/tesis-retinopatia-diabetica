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
import type { VisitaClinica } from "../features/patients/api/patientService";
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
    if (url === "/pacientes/7") return { data: { success: true, scope: "clinical", history_available: true, data: patient } };
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
describe("consulta de recuperación independiente del selector estricto", () => {
  it.each([
    { name: "reciente con IA", state: "ACTIVA", diagnosis: 1, hours: 1 },
    { name: "antigua con IA", state: "ACTIVA", diagnosis: 1, hours: 36 },
    { name: "antigua sin IA", state: "ACTIVA", diagnosis: 0, hours: 36 },
    { name: "cerrada reciente", state: "CERRADA", diagnosis: 0, hours: 1 },
    { name: "anulada reciente", state: "ANULADA", diagnosis: 0, hours: 1 },
  ])("el marcador no abre la visita $name, pero conserva la consulta autorizada del UUID", async ({ state, diagnosis, hours }) => {
    persist(); resetMemory();
    vi.mocked(obtenerVisitasPaciente).mockResolvedValue([{
      visita_id: 30, fecha_visita: new Date(Date.now() - hours * 3600_000).toISOString(),
      fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético", estado: state,
      tiene_diagnostico_ia: diagnosis,
    }]);
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    act(() => hook.result.current.selectPatient(patient));
    await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
    await waitFor(() => expect(hook.result.current.correction.recoveries[0]?.notice).toContain("confirmada"));
    expect(hook.result.current.visitasRecientes).toEqual([]);
    expect(hook.result.current.selectedVisita).toBeUndefined();
    expect(hook.result.current.step).toBe(1);
    expect(hook.result.current.results).toEqual({});
    expect(markers()[0].operationId).toBe(fixture.request.operacion_id);
    expect(get).toHaveBeenCalledWith(operationPath);
    expect(get.mock.calls.some(([url]) => String(url).includes("contexto-descarte"))).toBe(false);
    await act(async () => { await hook.result.current.correction.recoveries[0].consult(); });
    expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });
});

const recentRecoveryVisit = (): VisitaClinica => ({
  visita_id: 30, fecha_visita: new Date(Date.now() - 3600_000).toISOString(),
  fecha_visita_origen: "UTC_VERIFICADO", medico_tratante: "Sintético", estado: "ACTIVA",
  diagnostico_retinopatia_id: context.diagnostico_retinopatia_id,
  tiene_diagnostico_ia: context.detalles.length ? 1 : 0, tiene_informes: 0, total_informes: 0,
});
async function pendingReload(visit = recentRecoveryVisit(), confirmed = true) {
  persist(); resetMemory();
  if (!confirmed) operation = null;
  vi.mocked(obtenerVisitasPaciente).mockResolvedValue([visit]);
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  await waitFor(() => expect(hook.result.current.correction.recoveries[0]?.notice).toContain(confirmed ? "confirmada" : "aún no"));
  return hook;
}

describe("82: reanudación explícita ligada al marcador, sin abrir el selector", () => {
  it("recarga confirmada reconstruye paciente y visita actuales y conserva íntegro el otro ojo validado", async () => {
    context.estado_diagnostico = "VALIDADO";
    context.detalles[0] = { ...context.detalles[0], estado_validacion: "CORREGIDO", elegible: false, bloqueo: "RESULTADO_VALIDADO" };
    details[0] = { ...details[0], estado_validacion: "CORREGIDO", diagnostico_final: 3,
      comentario_medico: "Comentario actual", motivo_correccion: "Motivo actual" };
    const hook = await pendingReload();
    expect(hook.result.current.selectedPatient).toBeNull();
    expect(hook.result.current.selectedVisita).toBeUndefined();
    expect(hook.result.current.visitasRecientes).toEqual([]);
    expect(hook.result.current.step).toBe(1); // Los GET automáticos nunca adoptan contexto.
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.selectedPatient).toEqual(patient);
    expect(hook.result.current.selectedVisita?.visita_id).toBe(30);
    expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.results.OD?.detalle_id).toBe(11);
    expect(hook.result.current.results.OI).toBeUndefined();
    expect(hook.result.current.validatedEyes.OD).toBe("CORREGIDO");
    expect(hook.result.current.finalSelection.OD).toBe(3);
    expect(hook.result.current.comments.OD).toBe("Comentario actual");
    expect(hook.result.current.correctionReasons.OD).toBe("Motivo actual");
    expect(hook.result.current.eyes).toMatchObject({ OD: { file: null, preview: null }, OI: { file: null, preview: null } });
    expect(hook.result.current.activeEye).toBe("OI");
    expect(hook.result.current.visitasRecientes).toEqual([]);
    expect(get).toHaveBeenCalledWith("/pacientes/7");
    expect(get).toHaveBeenCalledWith(contextPath, { params: { operacion_id: fixture.request.operacion_id } });
    expect(obtenerVisitasPaciente).toHaveBeenCalledWith(7);
    expect(markers()).toEqual([]);
    expect(post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });

  it("recupera una visita vacía tras descartar ambos ojos sin resucitar el padre ni otra visita", async () => {
    const entry = makeEntry(); entry.request.operacion_id = fixture.lastDiscard.body.data.operacion_id;
    persist(entry); resetMemory(); operation = fixture.lastDiscard.body.data as DiscardOperation;
    context = fixture.emptyVisit.body.data as DiscardContext;
    vi.mocked(obtenerVisitasPaciente).mockResolvedValue([recentRecoveryVisit()]);
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    await waitFor(() => expect(hook.result.current.correction.recoveries[0]?.notice).toContain("confirmada"));
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.step).toBe(2); expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(hook.result.current.results).toEqual({}); expect(markers()).toEqual([]);
    expect(get).not.toHaveBeenCalledWith("/diagnosticar/visita/30/detalles");
    expect(post).not.toHaveBeenCalled();
  });

  it("NO_CONFIRMADA conserva UUID y deja consultar/reanudar después, sin POST", async () => {
    const hook = await pendingReload(recentRecoveryVisit(), false);
    const resume = hook.result.current.correction.recoveries[0].resume!;
    await act(async () => { await resume(); });
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.results).toEqual({});
    expect(markers()[0].operationId).toBe(fixture.request.operacion_id);
    expect(get).not.toHaveBeenCalledWith(contextPath, { params: { operacion_id: fixture.request.operacion_id } });
    operation = structuredClone(fixture.operation.body.data.operacion) as DiscardOperation;
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.step).toBe(2); expect(markers()).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500, 503])("GET de reanudación %s no libera ni repite el descarte", async (status) => {
    const hook = await pendingReload();
    get.mockRejectedValueOnce({ response: { status } });
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.selectedPatient).toBeNull();
    expect(markers()).toHaveLength(1);
    expect(hook.result.current.correction.recoveries[0].notice).toContain("No se pudo");
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { name: "fuera de 24 horas", change: { fecha_visita: "2020-01-01T10:00:00Z" }, message: "24 horas" },
    { name: "CERRADA", change: { estado: "CERRADA" }, message: "ACTIVA" },
    { name: "ANULADA", change: { estado: "ANULADA" }, message: "ACTIVA" },
    { name: "fecha no verificada", change: { fecha_visita_origen: "NO_VERIFICADO" as const }, message: "fecha verificada" },
    { name: "fecha futura", change: { fecha_visita: "2099-01-01T10:00:00Z" }, message: "24 horas" },
    { name: "informe registrado", change: { tiene_informes: 1 }, message: "informes" },
  ])("no reanuda visita $name", async ({ change, message }) => {
    const hook = await pendingReload({ ...recentRecoveryVisit(), ...change });
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.correction.recoveries[0].notice).toContain(message);
    expect(hook.result.current.selectedPatient).toBeNull(); expect(hook.result.current.selectedVisita).toBeUndefined();
    expect(hook.result.current.results).toEqual({}); expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("acepta el límite exacto de 24 horas, pero no si vence mientras llegan los detalles", async () => {
    const now = Date.parse("2030-01-02T10:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const visit = { ...recentRecoveryVisit(), fecha_visita: new Date(now - 24 * 3600_000).toISOString() };
    const hook = await pendingReload(visit);
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.step).toBe(2); expect(markers()).toEqual([]);
    hook.unmount();
    const second = await pendingReload(visit);
    const original = get.getMockImplementation()!;
    get.mockImplementation(async (url, config) => {
      if (url === "/diagnosticar/visita/30/detalles") clock.mockReturnValue(now + 1);
      return original(url, config);
    });
    await act(async () => { await second.result.current.correction.recoveries[0].resume!(); });
    expect(second.result.current.step).toBe(1); expect(markers()).toHaveLength(1);
    expect(second.result.current.correction.recoveries[0].notice).toContain("24 horas");
    expect(post).not.toHaveBeenCalled();
  });

  it("sin marcador no ofrece recuperación ni consulta operaciones", () => {
    const hook = renderHook(() => useDiagnosis(), { wrapper });
    expect(hook.result.current.correction.recoveries).toEqual([]);
    expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });

  it("doble clic produce una sola secuencia de GET y nunca un POST", async () => {
    const hook = await pendingReload();
    const before = get.mock.calls.filter(([url]) => url === operationPath).length;
    const resume = hook.result.current.correction.recoveries[0].resume!;
    await act(async () => { await Promise.all([resume(), resume()]); });
    expect(get.mock.calls.filter(([url]) => url === operationPath)).toHaveLength(before + 1);
    expect(hook.result.current.step).toBe(2); expect(post).not.toHaveBeenCalled();
  });

  it("reanudar consulta el estado fresco aunque haya una operación confirmada en memoria", async () => {
    const entry = { ...makeEntry(), status: "confirmed" as const, operation: operation! };
    persist(entry); recordDiscard(entry);
    const recover = vi.fn(async () => true);
    const hook = renderHook(() => useDiagnosisCorrection(options({ recover })));
    await waitFor(() => expect(hook.result.current.recoveries[0]?.notice).toContain("confirmada"));
    const reads = get.mock.calls.filter(([url]) => url === operationPath).length;
    operation = null;
    await act(async () => { await hook.result.current.recoveries[0].resume!(); });
    expect(get.mock.calls.filter(([url]) => url === operationPath)).toHaveLength(reads + 1);
    expect(hook.result.current.recoveries[0].notice).toContain("aún no");
    expect(recover).not.toHaveBeenCalled(); expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("bloquea fotografías nuevas mientras verifica la reanudación", async () => {
    const hook = await pendingReload();
    const response = deferred<ReturnType<typeof envelope>>();
    get.mockReturnValueOnce(response.promise);
    let resume!: Promise<void>;
    act(() => { resume = hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.correction.blocked()).toBe(true);
    await act(async () => { await hook.result.current.handleFile("OI", new File(["local"], "blocked.jpg")); });
    expect(convertToPreviewUrl).not.toHaveBeenCalled();
    await act(async () => { response.resolve(envelope({ conciliacion: "CONFIRMADA", operacion: operation })); await resume; });
    expect(hook.result.current.step).toBe(2);
    expect(hook.result.current.eyes.OI.file).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["usuario", "paciente", "visita"])("respuesta tardía no altera otro contexto al cambiar %s", async (change) => {
    const hook = await pendingReload();
    const response = deferred<ReturnType<typeof envelope>>();
    const original = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === "/diagnosticar/visita/30/detalles" ? response.promise : original(url, config));
    let resume!: Promise<void>;
    act(() => { resume = hook.result.current.correction.recoveries[0].resume!(); });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/diagnosticar/visita/30/detalles"));
    act(() => {
      if (change === "usuario") useAuthStore.getState().login("other", { id: 2, username: "other", nombres: "Otro", apellidos: "Sintético", roles: ["Oftalmologo"] });
      if (change === "paciente") hook.result.current.selectPatient({ ...patient, id: 8 });
      if (change === "visita") hook.result.current.selectVisita({ ...recentRecoveryVisit(), visita_id: 31 });
    });
    await act(async () => { response.resolve(envelope({ ojos: details })); await resume; });
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.results).toEqual({});
    if (change === "usuario") expect(hook.result.current.correction.recoveries).toEqual([]);
    if (change === "paciente") expect(hook.result.current.selectedPatient?.id).toBe(8);
    if (change === "visita") expect(hook.result.current.selectedVisita?.visita_id).toBe(31);
    expect(markers()).toHaveLength(1); expect(post).not.toHaveBeenCalled();
  });

  it.each(["revision", "detalles", "paciente", "uuid"])("rechaza identidad o contexto cambiado: %s", async (change) => {
    const hook = await pendingReload();
    const original = get.getMockImplementation()!;
    let reads = 0;
    get.mockImplementation(async (url, config) => {
      if (change === "revision" && url === contextPath && ++reads === 2) return envelope({ ...context, revision: context.revision + 1 });
      if (change === "detalles" && url === "/diagnosticar/visita/30/detalles") return envelope({ ojos: [{ ...details[0], detalle_id: 99 }] });
      if (change === "paciente" && url === "/pacientes/7") return { data: { success: true, scope: "clinical", history_available: true, data: { ...patient, id: 8 } } };
      if (change === "uuid" && url === operationPath) return envelope({ conciliacion: "CONFIRMADA", operacion: { ...operation, operacion_id: "22222222-2222-4222-8222-222222222222" } });
      return original(url, config);
    });
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.selectedPatient).toBeNull(); expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("una fotografía local impide sustituir la evaluación durante la recuperación", async () => {
    const hook = await pendingReload();
    act(() => { hook.result.current.selectPatient(patient); hook.result.current.selectVisita(null); });
    await act(async () => { await hook.result.current.handleFile("OI", new File(["local"], "OI-local.jpg")); });
    const file = hook.result.current.eyes.OI.file;
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    expect(hook.result.current.eyes.OI.file).toBe(file); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.confirmedVisitId).toBeNull(); expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("una vista previa manual aún pendiente impide reanudar sin perder la fotografía", async () => {
    const hook = await pendingReload();
    act(() => { hook.result.current.selectPatient(patient); hook.result.current.selectVisita(null); });
    const preview = deferred<string>();
    vi.mocked(convertToPreviewUrl).mockReturnValueOnce(preview.promise);
    const file = new File(["local"], "OI-pending.jpg");
    let selection!: Promise<void>;
    act(() => { selection = hook.result.current.handleFile("OI", file); });
    await waitFor(() => expect(hook.result.current.correction.recoveries[0].loading).toBe(false));
    expect(convertToPreviewUrl).toHaveBeenCalledWith(file);
    await act(async () => { await hook.result.current.correction.recoveries[0].resume!(); });
    await act(async () => { preview.resolve("blob:pending-local"); await selection; });
    expect(hook.result.current.eyes.OI.file).toBe(file);
    expect(hook.result.current.eyes.OI.preview).toBe("blob:pending-local");
    expect(hook.result.current.confirmedVisitId).toBeNull();
    expect(hook.result.current.results).toEqual({}); expect(markers()).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });
});

async function adoptKnownRecoverySelection() {
  const visit = { visita_id: 30, fecha_visita: new Date(Date.now() - 3600_000).toISOString(), fecha_visita_origen: "UTC_VERIFICADO" as const,
    medico_tratante: "Profesional sintético", tiene_diagnostico_ia: 1, estado: "ACTIVA",
    diagnostico_retinopatia_id: context.diagnostico_retinopatia_id };
  vi.mocked(obtenerVisitasPaciente).mockResolvedValue([visit]);
  const hook = renderHook(() => useDiagnosis(), { wrapper });
  act(() => hook.result.current.selectPatient(patient));
  await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
  expect(hook.result.current.visitasRecientes.map((v) => v.visita_id)).not.toContain(30);
  // Prueba un contexto ya seleccionado, no una vía de acceso desde el selector.
  // La limitación de reanudación tras recarga se comprueba y documenta aparte.
  act(() => hook.result.current.selectVisita(visit));
  return hook;
}
describe("adopción segura en useDiagnosis con contexto ya seleccionado, no desde el selector", () => {
  it("consulta estado actual, conserva OD validado y libera solo OI con la misma visita", async () => {
    persist(); resetMemory();
    context.estado_diagnostico = "VALIDADO";
    context.detalles[0].estado_validacion = "CORREGIDO";
    details[0] = { ...details[0], estado_validacion: "CORREGIDO", diagnostico_final: 3,
      comentario_medico: "Comentario persistido", motivo_correccion: "Motivo persistido" };
    const hook = await adoptKnownRecoverySelection();
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
    const hook = await adoptKnownRecoverySelection();
    await waitFor(() => expect(hook.result.current.step).toBe(2));
    expect(hook.result.current.results).toEqual({}); expect(hook.result.current.confirmedVisitId).toBe(30);
    expect(get).not.toHaveBeenCalledWith("/diagnosticar/visita/30/detalles");
    expect(post).not.toHaveBeenCalled(); expect(markers()).toEqual([]);
  });
  it("un nuevo detalle OI se consulta por su ID actual y nunca se limpia como el antiguo", async () => {
    persist(); resetMemory();
    context.detalles.push({ detalle_id: 13, ojo: "OI", estado_validacion: "PENDIENTE", elegible: true, bloqueo: null });
    details.push({ ...details[0], detalle_id: 13, ojo: "OI", imagen_url: "OI-new.jpg" });
    const hook = await adoptKnownRecoverySelection();
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
    const hook = await adoptKnownRecoverySelection();
    await waitFor(() => expect(count).toBe(2));
    expect(hook.result.current.step).toBe(1); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.correction.blocked()).toBe(true); expect(markers()).toHaveLength(1);
  });
  it("contexto de otro paciente no se aplica", async () => {
    persist(); resetMemory(); context.paciente_id = 8;
    const hook = await adoptKnownRecoverySelection();
    await waitFor(() => expect(hook.result.current.correction.notice).toContain("otro paciente"));
    expect(hook.result.current.selectedPatient?.id).toBe(7); expect(hook.result.current.results).toEqual({});
    expect(hook.result.current.correction.blocked()).toBe(true); expect(markers()).toHaveLength(1);
  });
  it("cambiar paciente mientras llegan detalles no instala resultados en el nuevo contexto", async () => {
    persist(); resetMemory();
    const response = deferred<ReturnType<typeof envelope>>();
    const original = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === "/diagnosticar/visita/30/detalles" ? response.promise : original(url, config));
    const hook = await adoptKnownRecoverySelection();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/diagnosticar/visita/30/detalles"));
    act(() => { hook.result.current.selectPatient({ ...patient, id: 8 }); });
    await act(async () => { response.resolve(envelope({ ojos: details })); await response.promise; });
    expect(hook.result.current.selectedPatient?.id).toBe(8);
    expect(hook.result.current.results).toEqual({}); expect(hook.result.current.step).toBe(1);
    expect(markers()).toHaveLength(1); expect(post).not.toHaveBeenCalled();
  });
});
