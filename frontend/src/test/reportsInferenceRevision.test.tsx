// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { diagnosisDiscardEnabled } from "../lib/clinicalFeatures";
import { useReports } from "../features/reports/hooks/useReports";
import { useAuthStore } from "../features/auth/store/authStore";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../lib/clinicalFeatures", () => ({ diagnosisDiscardEnabled: vi.fn(() => true) }));
vi.mock("../features/patients/api/patientService", () => ({
  buscarPacientes: vi.fn().mockResolvedValue([]), obtenerPacientesRecientes: vi.fn().mockResolvedValue([]),
  obtenerVisitasPaciente: vi.fn().mockResolvedValue([]),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000000" };
const visit = (id = 30) => ({ visita_id: id, fecha_visita: "2026-11-01T10:00:00Z", fecha_visita_origen: "UTC_VERIFICADO" as const,
  medico_tratante: "Profesional sintético" });
const envelope = (data: unknown) => ({ data: { success: true, data } });
let revision: number;
let structured: Record<string, unknown>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function prepared(existing: boolean = true) {
  const hook = renderHook(() => useReports(), { wrapper });
  act(() => { hook.result.current.toggleTipo({ id: 4, nombre: "Paquimetría", descripcion: "" }); hook.result.current.selectPatient(patient); });
  await waitFor(() => expect(hook.result.current.isLoadingVisitas).toBe(false));
  act(() => hook.result.current.goNext());
  act(() => hook.result.current.selectVisita(existing ? visit() : null));
  await waitFor(() => expect(hook.result.current.revisionLoading).toBe(false));
  act(() => hook.result.current.goNext());
  hook.result.current.formRefs.current[4] = { isValid: () => true, getData: () => structured };
  return hook;
}
beforeEach(() => {
  vi.clearAllMocks();
  revision = 4;
  structured = { nota: "Sintética" };
  vi.mocked(diagnosisDiscardEnabled).mockReturnValue(true);
  get.mockReset().mockImplementation(async (url) => {
    const matched = String(url).match(/^\/visitas\/(\d+)\/revision-inferencia$/);
    if (matched) return envelope({ visita_id: Number(matched[1]), paciente_id: 7, revision_inferencia: revision });
    return envelope([]);
  });
  post.mockReset().mockResolvedValue(envelope({ id: 1, visita_id: 50 }));
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("contrato opt-in de revisión en informes", () => {
  it("apagado conserva exactamente el payload anterior sin consultar revisión", async () => {
    vi.mocked(diagnosisDiscardEnabled).mockReturnValue(false);
    const hook = await prepared();
    await act(async () => hook.result.current.saveAll());
    expect(post).toHaveBeenCalledExactlyOnceWith("/informes", {
      paciente_id: 7, tipo_informe_id: 4, visita_id: 30, datos_estructurados: { nota: "Sintética" },
    });
    expect(get.mock.calls.some(([url]) => String(url).includes("revision-inferencia"))).toBe(false);
  });
  it("apagado no transforma ni reserva la clave en datos estructurados históricos", async () => {
    vi.mocked(diagnosisDiscardEnabled).mockReturnValue(false);
    structured = { nota: "Sintética", revision_inferencia_esperada: 99, anidado: { revision_inferencia_esperada: "texto" } };
    const hook = await prepared();
    await act(async () => hook.result.current.saveAll());
    expect(post.mock.calls[0][1]).toEqual({ paciente_id: 7, tipo_informe_id: 4, visita_id: 30, datos_estructurados: structured });
    expect((post.mock.calls[0][1] as Record<string, unknown>).revision_inferencia_esperada).toBeUndefined();
  });
  it("captura al adoptar visita, conserva la instantánea y envía revisión fuera del JSON clínico", async () => {
    const hook = await prepared();
    expect(get.mock.calls.filter(([url]) => String(url).includes("revision-inferencia"))).toHaveLength(1);
    revision = 8;
    await act(async () => hook.result.current.saveAll());
    expect(post.mock.calls[0][1]).toEqual({ paciente_id: 7, tipo_informe_id: 4, visita_id: 30,
      datos_estructurados: structured, revision_inferencia_esperada: 4 });
    expect(get.mock.calls.filter(([url]) => String(url).includes("revision-inferencia"))).toHaveLength(1);
  });
  it("conflicto obsoleto bloquea el guardado sin refrescar ni reenviar silenciosamente", async () => {
    const hook = await prepared();
    post.mockRejectedValueOnce({ response: { status: 409, data: { code: "CONTEXTO_INFORME_OBSOLETO" } } });
    await act(async () => hook.result.current.saveAll());
    expect(hook.result.current.revisionBlocked).toBe(true);
    expect(hook.result.current.revisionNotice).toContain("evaluación cambió");
    await act(async () => hook.result.current.saveAll());
    expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.filter(([url]) => String(url).includes("revision-inferencia"))).toHaveLength(1);
    expect(hook.result.current.step).toBe(3);
  });
  it("un cambio de visita invalida inmediatamente la anterior y rechaza respuestas tardías", async () => {
    const hook = await prepared();
    const pending = deferred<ReturnType<typeof envelope>>();
    get.mockImplementation(async (url) => String(url) === "/visitas/31/revision-inferencia" ? pending.promise
      : envelope({ visita_id: 32, paciente_id: 7, revision_inferencia: 2 }));
    act(() => hook.result.current.selectVisita(visit(31)));
    expect(hook.result.current.revisionBlocked).toBe(true);
    await act(async () => hook.result.current.saveAll());
    expect(post).not.toHaveBeenCalled();
    act(() => hook.result.current.selectVisita(visit(32)));
    await waitFor(() => expect(hook.result.current.revisionBlocked).toBe(false));
    await act(async () => { pending.resolve(envelope({ visita_id: 31, paciente_id: 7, revision_inferencia: 99 })); await pending.promise; });
    await act(async () => hook.result.current.saveAll());
    expect(post.mock.calls[0][1]).toMatchObject({ visita_id: 32, revision_inferencia_esperada: 2 });
  });
  it.each([403, 503])("revisión no disponible (%s) no se omite", async (status) => {
    get.mockImplementation(async (url) => {
      if (String(url).includes("revision-inferencia")) throw { response: { status } };
      return envelope([]);
    });
    const hook = await prepared();
    expect(hook.result.current.revisionBlocked).toBe(true);
    await act(async () => hook.result.current.saveAll());
    expect(post).not.toHaveBeenCalled();
    expect(hook.result.current.revisionNotice).toBeTruthy();
  });
  it.each([false, true])("informe sin visita mantiene el primer payload anterior (modo=%s)", async (mode) => {
    vi.mocked(diagnosisDiscardEnabled).mockReturnValue(mode);
    const hook = await prepared(false);
    await act(async () => hook.result.current.saveAll());
    expect(post.mock.calls[0][1]).toEqual({ paciente_id: 7, tipo_informe_id: 4, datos_estructurados: structured });
    expect(get.mock.calls.some(([url]) => String(url).includes("revision-inferencia"))).toBe(false);
  });
  it("un lote nuevo reutiliza su visita y envía revisión inicial 0 solo para los siguientes informes", async () => {
    const hook = await prepared(false);
    act(() => hook.result.current.addTipo({ id: 3, nombre: "Gonioscopía", descripcion: "" }));
    hook.result.current.formRefs.current[3] = { isValid: () => true, getData: () => ({ nota: "Segundo" }) };
    await act(async () => hook.result.current.saveAll());
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1]).not.toHaveProperty("revision_inferencia_esperada");
    expect(post.mock.calls[1][1]).toMatchObject({ visita_id: 50, revision_inferencia_esperada: 0 });
  });
  it("cambiar de sesión invalida la revisión, no la vuelve a capturar automáticamente", async () => {
    const hook = await prepared();
    act(() => useAuthStore.getState().login("otra-sesion", { id: 2, username: "otro", nombres: "Otro", apellidos: "Sintético", roles: ["Oftalmologo"] }));
    await act(async () => hook.result.current.saveAll());
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.filter(([url]) => String(url).includes("revision-inferencia"))).toHaveLength(1);
  });
  it("no duplica el lote por dos clics mientras espera el POST", async () => {
    const hook = await prepared(); const pending = deferred<ReturnType<typeof envelope>>();
    post.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>;
    act(() => { first = hook.result.current.saveAll(); void hook.result.current.saveAll(); });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(envelope({ visita_id: 30 })); await first; });
  });
});
