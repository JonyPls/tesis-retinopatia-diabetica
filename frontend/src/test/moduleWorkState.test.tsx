// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ModuleRoute } from "../features/auth/components/ModuleRoute";
import type { ModuleName } from "../features/auth/moduleAccess";
import { useAuthStore } from "../features/auth/store/authStore";
import { usePatients } from "../features/patients/hooks/usePatients";
import { useReports } from "../features/reports/hooks/useReports";
import { ReportForm } from "../features/reports/components/ReportForm";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { obtenerPacientesRecientes, obtenerVisitasPaciente } from "../features/patients/api/patientService";
import {
  consultarConfirmacionRetinografo, crearDiagnostico, crearDiagnosticoConfirmado,
  descargarImagenRetinografo, obtenerSeleccionAutomaticaRetinografo,
  registrarConfirmacionRetinografo, revocarConfirmacionRetinografo, sha256Blob,
} from "../features/diagnosis/api/diagnosisService";
import { revokePreviewUrl } from "../lib/imageUtils";
import api from "../lib/api";

// HTTP, fotografías y persistencia siempre simulados; los hooks y el guard son reales.
vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ACCESS_DENIED_EVENT: "app:access-denied" }));
vi.mock("../features/patients/api/patientService", () => ({
  buscarPacientes: vi.fn(), buscarPacientesPaginado: vi.fn(),
  obtenerPacientesRecientes: vi.fn(), obtenerVisitasPaciente: vi.fn(),
}));
vi.mock("../features/diagnosis/api/diagnosisService", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/diagnosis/api/diagnosisService")>(),
  consultarConfirmacionRetinografo: vi.fn(), crearDiagnostico: vi.fn(), crearDiagnosticoConfirmado: vi.fn(),
  descargarImagenRetinografo: vi.fn(), obtenerSeleccionAutomaticaRetinografo: vi.fn(),
  registrarConfirmacionRetinografo: vi.fn(), revocarConfirmacionRetinografo: vi.fn(), sha256Blob: vi.fn(),
}));
vi.mock("../lib/imageUtils", () => ({
  convertToPreviewUrl: vi.fn(async (file: File) => `blob:synthetic-${file.name}`), revokePreviewUrl: vi.fn(),
}));
vi.mock("../hooks/use-toast", () => ({ toast: vi.fn() }));

const patient = { id: 7, nombres: "Paciente", apellidos: "Sintético", tipo_doc_abrev: "DNI", nro_documento: "00000007" };
const visit = { visita_id: 3, fecha_visita: "2026-10-13T17:51:00Z", fecha_visita_origen: "UTC_VERIFICADO" as const,
  medico_tratante: "Profesional sintético", total_informes: 0 };
const reportType = { id: 4, nombre: "Paquimetría", descripcion: "" };
const candidates = (["OD", "OI"] as const).map((ojo) => ({
  filename: `synthetic_Color_${ojo === "OD" ? "R" : "L"}.png`, ojo,
  ojo_original: ojo === "OD" ? "R" as const : "L" as const, tipo_imagen: "Color", secuencia: 1,
  extension: "png", fecha_exportacion: "2026-10-13T10:00:00", mime_type: "image/png",
}));
const confirmation = (eye: "Derecho" | "Izquierdo") => ({
  paciente_id: 7, ojo_confirmado: eye, identificador: (eye === "Derecho" ? "d" : "e").repeat(64),
  estado: "CONFIRMADA" as const, fecha_expiracion: "2099-01-01T00:00:00Z",
});
const get = vi.mocked(api.get);

function wrapperFor(module: ModuleName) {
  return function Protected({ children }: { children: ReactNode }) {
    return <MemoryRouter><ModuleRoute module={module}><>{children}</></ModuleRoute></MemoryRouter>;
  };
}

function resume() {
  act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

function pendingProbe() {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
  return () => finish({ data: { success: true } });
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url === "/diagnosticar/visita/0/detalles") throw { response: { status: 404, data: { success: false, message: "Diagnóstico no encontrado." } } };
    if (url === "/informes/0") throw { response: { status: 404, data: { success: false, message: "Informe no encontrado." } } };
    const data = url === "/pacientes" ? Array.from({ length: 24 }, (_, i) => ({
      id: i + 1, nombres: `Paciente ${i + 1}`, apellidos: "Sintético", nro_documento: String(i + 1), sexo: "F",
    })) : url === "/tipos-informe" ? [reportType] : [];
    return { data: { success: true, data, scope: "clinical" } } as never;
  });
  vi.mocked(obtenerPacientesRecientes).mockResolvedValue([]);
  vi.mocked(obtenerVisitasPaciente).mockResolvedValue([visit]);
  vi.mocked(obtenerSeleccionAutomaticaRetinografo).mockResolvedValue({
    paciente_id: 7, encontradas: 2, imagenes: { OD: candidates[0], OI: candidates[1] }, candidatas: candidates,
  });
  vi.mocked(descargarImagenRetinografo).mockResolvedValue(new Blob(["synthetic"], { type: "image/png" }));
  vi.mocked(sha256Blob).mockResolvedValue("a".repeat(64));
  vi.mocked(registrarConfirmacionRetinografo).mockImplementation(async ({ ojo_confirmado }) => confirmation(ojo_confirmado));
  vi.mocked(consultarConfirmacionRetinografo).mockImplementation(async (id) => ({
    ...confirmation(id === "d".repeat(64) ? "Derecho" : "Izquierdo"), vigente: true, expirada: false,
  }));
  const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  useAuthStore.getState().login(token, { id: 2, username: "synthetic", nombres: "Usuario", apellidos: "Prueba",
    roles: ["Oftalmologo"], permisos: ["pacientes.ver", "imagenes.ver", "diagnostico_retinopatia.ver",
      "diagnostico_retinopatia.crear", "informes.ver", "informes.crear"] });
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Trabajo en memoria durante revalidaciones del guard", () => {
  it("Pacientes conserva búsqueda, paginación, orden, vista y formulario sin volver a cargar el listado", async () => {
    const hook = renderHook(() => usePatients(), { wrapper: wrapperFor("patients") });
    await waitFor(() => expect(hook.result.current?.totalItems).toBe(24));
    act(() => {
      hook.result.current.setQuery("Paciente");
      hook.result.current.setItemsPerPage(5);
      hook.result.current.toggleSort("patient");
      hook.result.current.setViewMode("cards");
      hook.result.current.setOpen(true);
      hook.result.current.handleChange("nombres", "Borrador sin guardar");
    });
    act(() => hook.result.current.setCurrentPage(3));
    const rows = hook.result.current.currentData;
    const finish = pendingProbe();
    resume();
    expect(hook.result.current.query).toBe("Paciente");
    expect(hook.result.current.currentPage).toBe(3);
    await act(async () => finish());
    expect(hook.result.current.itemsPerPage).toBe(5);
    expect(hook.result.current.currentData).toEqual(rows);
    expect(hook.result.current.sort).toEqual({ field: "patient", direction: "asc" });
    expect(hook.result.current.viewMode).toBe("cards");
    expect(hook.result.current.open).toBe(true);
    expect(hook.result.current.formData.nombres).toBe("Borrador sin guardar");
    expect(get.mock.calls.filter(([url]) => url === "/pacientes")).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("Diagnóstico conserva OD/OI y sus comprobantes sin reconfirmar ni iniciar inferencia", async () => {
    const hook = renderHook(() => useDiagnosis(), { wrapper: wrapperFor("diagnosis") });
    await waitFor(() => expect(hook.result.current?.step).toBe(1));
    act(() => { hook.result.current.selectPatient(patient); hook.result.current.selectVisita(null); });
    act(() => hook.result.current.goNext());
    await act(async () => hook.result.current.autoSelectRetinographImages());
    for (const candidate of candidates) {
      await act(async () => hook.result.current.selectAutoCandidate(candidate));
      await act(async () => hook.result.current.confirmEye(candidate.ojo));
    }
    act(() => hook.result.current.setComment("OD", "Observación pendiente"));
    const files = { OD: hook.result.current.eyes.OD.file, OI: hook.result.current.eyes.OI.file };
    const previews = { OD: hook.result.current.eyes.OD.preview, OI: hook.result.current.eyes.OI.preview };
    const revocations = vi.mocked(revokePreviewUrl).mock.calls.length;
    const finish = pendingProbe();
    resume();
    expect(hook.result.current.step).toBe(2);
    await act(async () => finish());
    expect(hook.result.current.selectedPatient).toBe(patient);
    expect(hook.result.current.selectedVisita).toBeNull();
    expect(hook.result.current.comments.OD).toBe("Observación pendiente");
    for (const eye of ["OD", "OI"] as const) {
      expect(hook.result.current.eyes[eye].file).toBe(files[eye]);
      expect(hook.result.current.eyes[eye].preview).toBe(previews[eye]);
      expect(hook.result.current.eyes[eye].confirmation).toBe("CONFIRMADA");
    }
    expect(hook.result.current.canNext).toBe(true); // Incluye bound() contra el comprobante conservado.
    expect(revokePreviewUrl).toHaveBeenCalledTimes(revocations);
    expect(registrarConfirmacionRetinografo).toHaveBeenCalledTimes(2);
    expect(crearDiagnostico).not.toHaveBeenCalled();
    expect(crearDiagnosticoConfirmado).not.toHaveBeenCalled();
    expect(revocarConfirmacionRetinografo).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.checkConfirmation("OD"); });
    expect(consultarConfirmacionRetinografo).toHaveBeenCalledWith("d".repeat(64));
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe("auth-storage");
    expect(sessionStorage.length).toBe(0);
  });

  it("no cancela ni pierde una confirmación en curso al recuperar visibilidad", async () => {
    const hook = renderHook(() => useDiagnosis(), { wrapper: wrapperFor("diagnosis") });
    await waitFor(() => expect(hook.result.current?.step).toBe(1));
    act(() => { hook.result.current.selectPatient(patient); hook.result.current.selectVisita(null); });
    act(() => hook.result.current.goNext());
    await act(async () => hook.result.current.autoSelectRetinographImages());
    await act(async () => hook.result.current.selectAutoCandidate(candidates[0]));
    let finishConfirmation!: (value: ReturnType<typeof confirmation>) => void;
    vi.mocked(registrarConfirmacionRetinografo).mockImplementationOnce(() => new Promise((resolve) => { finishConfirmation = resolve; }));
    act(() => { void hook.result.current.confirmEye("OD"); });
    await waitFor(() => expect(registrarConfirmacionRetinografo).toHaveBeenCalledOnce());
    const finishProbe = pendingProbe();
    resume();
    await act(async () => finishConfirmation(confirmation("Derecho")));
    expect(hook.result.current.eyes.OD.confirmation).toBe("CONFIRMADA");
    await act(async () => finishProbe());
    expect(hook.result.current.canNext).toBe(true);
    expect(hook.result.current.step).toBe(2);
    expect(registrarConfirmacionRetinografo).toHaveBeenCalledOnce();
    expect(crearDiagnosticoConfirmado).not.toHaveBeenCalled();
  });

  it("Informes conserva paciente, visita, tipo y los campos reales del formulario sin guardarlos", async () => {
    let work!: ReturnType<typeof useReports>;
    function ReportWork() {
      work = useReports();
      return work.step === 3 ? <ReportForm tipo={reportType} isSaving={work.isSaving}
        ref={(form) => { work.formRefs.current[4] = form; }} /> : <p>Selección inicial</p>;
    }
    render(<ReportWork />, { wrapper: wrapperFor("reports") });
    await screen.findByText("Selección inicial");
    act(() => work.toggleTipo(reportType));
    act(() => work.goNext());
    act(() => work.selectPatient(patient));
    await waitFor(() => expect(work.isLoadingVisitas).toBe(false));
    act(() => work.selectVisita(visit));
    act(() => work.goNext());
    await waitFor(() => expect(work.isLoadingInformesExistentes).toBe(false));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "555" } });
    fireEvent.change(inputs[1], { target: { value: "540" } });
    const finish = pendingProbe();
    resume();
    expect(screen.getAllByRole("spinbutton")[0]).toBe(inputs[0]);
    await act(async () => finish());
    expect(work.step).toBe(3);
    expect(work.selectedPatient).toBe(patient);
    expect(work.selectedVisita).toBe(visit);
    expect(work.selectedTipos).toEqual([reportType]);
    expect(work.activeTipoIndex).toBe(0);
    expect(screen.getAllByRole("spinbutton")[0]).toBe(inputs[0]);
    expect(inputs[0]).toHaveValue(555);
    expect(inputs[1]).toHaveValue(540);
    expect(work.formRefs.current[4]?.getData()).toEqual({ ojos: ["OD", "OI"], valores: { od: 555, oi: 540 } });
    expect(api.post).not.toHaveBeenCalled();
  });
});
