// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import api from "../lib/api";
import { PatientTable } from "../features/patients/components/PatientTable";
import { PatientInfoCard } from "../features/patients/components/PatientInfoCard";
import { usePatients } from "../features/patients/hooks/usePatients";
import { usePatientProfile } from "../features/patients/hooks/usePatientProfile";
import { usePatientVisitDetail } from "../features/patients/hooks/usePatientVisitDetail";
import { useAuthStore } from "../features/auth/store/authStore";
import { CreatePatientDialog } from "../features/patients/components/CreatePatientDialog";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, tipo_doc_abrev: "DNI", nro_documento: "00000007",
  nombres: "Paciente", apellidos: "Sintético", sexo: "F", fecha_nacimiento: "2000-01-01",
  antecedentes_clinicos: "antecedente sintético", alergias: "alergia sintética" };

beforeEach(() => { vi.clearAllMocks(); useAuthStore.getState().logout(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuthStore.getState().logout(); });

function login(roles: string[]) {
  useAuthStore.getState().login("synthetic-only", {
    id: 1, username: "ficticio", nombres: "Persona", apellidos: "Ficticia", roles,
  });
}

function fillRegistration(result: { current: ReturnType<typeof usePatients> }) {
  act(() => {
    result.current.setFormData({ tipo_doc: "DNI", nro_documento: "90000001",
      nombres: "Paciente", apellidos: "Ficticio", sexo: "Femenino",
      fecha_nacimiento: "2000-01-01", telefono: "900000000", correo: "", direccion: "",
      antecedentes_clinicos: "Antecedente sintético", alergias: "Alergia sintética" });
    result.current.setConsent(true);
  });
}

describe("B1 listado y detalle", () => {
  it("el listado administrativo no interpreta campos clínicos omitidos como Sin Evaluar", async () => {
    get.mockResolvedValue({ data: { success: true, scope: "administrative", data: [patient] } });
    const { result } = renderHook(() => usePatients(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.scope).toBe("administrative");
    render(<PatientTable patients={result.current.patients} scope={result.current.scope}
      isLoading={false} calculateAge={() => 26} />, { wrapper });
    expect(screen.queryByText("Sin Evaluar")).not.toBeInTheDocument();
    expect(screen.queryByText("Última Visita")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver/ })).toHaveAttribute("href", "/pacientes/7");
  });

  it("el detalle administrativo no solicita visitas ni muestra datos omitidos", async () => {
    get.mockResolvedValue({ data: { success: true, scope: "administrative", data: {
      id: 7, nro_documento: patient.nro_documento, nombres: patient.nombres,
      apellidos: patient.apellidos, sexo: patient.sexo, fecha_nacimiento: patient.fecha_nacimiento,
    } } });
    const { result } = renderHook(() => usePatientProfile("7"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.patient?.id).toBe(7);
    expect(result.current.patientError).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    render(<PatientInfoCard patient={result.current.patient!} scope={result.current.scope}
      calculateAge={() => 26} getInitials={() => "PS"} />);
    expect(screen.queryByText("Antecedentes")).not.toBeInTheDocument();
    expect(screen.queryByText("Alergias")).not.toBeInTheDocument();
    expect(screen.queryByText("Consentimiento")).not.toBeInTheDocument();
  });

  it("404 del paciente no se confunde con 403 y no inicia consulta de visitas", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    const { result } = renderHook(() => usePatientProfile("404"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.patient).toBeNull();
    expect(result.current.patientError).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("404 del historial identifica al paciente que dejó de existir", async () => {
    get.mockResolvedValueOnce({ data: { success: true, scope: "clinical",
      history_available: true, data: patient } })
      .mockRejectedValueOnce({ response: { status: 404 } });
    const { result } = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("patient_not_found");
    expect(result.current.requestError).toBeNull();
    expect(result.current.patient).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("404 del detalle de paciente en visita sí se presenta como paciente inexistente", async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } });
    const { result } = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("patient_not_found");
    expect(result.current.requestError).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("el perfil médico distingue 403 revocado, 404 del paciente y ausencia de diagnósticos", async () => {
    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockRejectedValueOnce({ response: { status: 403 } });
    const denied = renderHook(() => usePatientProfile("7"), { wrapper });
    await waitFor(() => expect(denied.result.current.isLoading).toBe(false));
    expect(denied.result.current.patient?.id).toBe(7);
    expect(denied.result.current.historyError?.status).toBe(403);
    expect(denied.result.current.diagnoses).toEqual([]);
    denied.unmount();

    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockResolvedValueOnce({ data: { success: true, data: [{ visita_id: 13,
        fecha_visita: "2030-01-01", tiene_diagnostico_ia: 0, tiene_informes: 0,
        diagnostico_ia: null, informes: [] }] } });
    const authorized = renderHook(() => usePatientProfile("7"), { wrapper });
    await waitFor(() => expect(authorized.result.current.isLoading).toBe(false));
    expect(authorized.result.current.historyError).toBeNull();
    expect(authorized.result.current.diagnoses).toHaveLength(1);
    authorized.unmount();

    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockRejectedValueOnce({ response: { status: 404 } });
    const missing = renderHook(() => usePatientProfile("7"), { wrapper });
    await waitFor(() => expect(missing.result.current.isLoading).toBe(false));
    expect(missing.result.current.patient).toBeNull();
    expect(missing.result.current.historyError).toBeNull();
    missing.unmount();
  });

  it("el detalle de visita distingue revocación de una visita sin IA", async () => {
    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockRejectedValueOnce({ response: { status: 403 } });
    const denied = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
    await waitFor(() => expect(denied.result.current.isLoading).toBe(false));
    expect(denied.result.current.requestError?.status).toBe(403);
    expect(denied.result.current.error).toBe("load_error");
    denied.unmount();

    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockResolvedValueOnce({ data: { success: true, data: [{ visita_id: 13,
        fecha_visita: "2030-01-01", tiene_diagnostico_ia: 0, tiene_informes: 0,
        diagnostico_ia: null, informes: [] }] } });
    const authorized = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
    await waitFor(() => expect(authorized.result.current.isLoading).toBe(false));
    expect(authorized.result.current.error).toBeNull();
    expect(authorized.result.current.requestError).toBeNull();
    expect(authorized.result.current.visit?.visita_id).toBe(13);
    authorized.unmount();
  });

  it("el GET independiente distingue 401/403 de un 404 sin diagnóstico", async () => {
    const visits = [{ visita_id: 13, tiene_diagnostico_ia: 1,
      diagnostico_ia: { detalles: [] }, informes: [] }];
    for (const status of [401, 403, 404]) {
      get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
        .mockResolvedValueOnce({ data: { success: true, data: visits } })
        .mockRejectedValueOnce({ response: { status } });
      const { result, unmount } = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(get).toHaveBeenLastCalledWith("/diagnosticar/visita/13/detalles");
      if (status === 404) {
        expect(result.current.error).toBeNull();
        expect(result.current.requestError).toBeNull();
        expect(result.current.visit?.visita_id).toBe(13);
        expect(result.current.diagnosisDetails).toEqual([]);
      } else {
        expect(result.current.error).toBe("load_error");
        expect(result.current.requestError?.status).toBe(status);
        expect(result.current.diagnosisDetails).toEqual([]);
      }
      unmount();
    }
  });

  it("el detalle independiente autorizado conserva ambos ojos y un 403 de comparación no se oculta", async () => {
    const visits = [13, 14].map((visita_id) => ({ visita_id, tiene_diagnostico_ia: 1,
      diagnostico_ia: { detalles: [] }, informes: [] }));
    const eyes = [{ detalle_id: 1, ojo: "OD", resultado_ia: 2, diagnostico_final: 3,
      estado_validacion: "CORREGIDO", imagen_url: "synthetic-only.jpg" },
    { detalle_id: 2, ojo: "OI", resultado_ia: 1, diagnostico_final: 1,
      estado_validacion: "APROBADO", imagen_url: "synthetic-left.jpg" }];
    get.mockResolvedValueOnce({ data: { scope: "clinical", history_available: true, data: patient } })
      .mockResolvedValueOnce({ data: { success: true, data: visits } })
      .mockResolvedValueOnce({ data: { success: true, data: { ojos: eyes } } })
      .mockRejectedValueOnce({ response: { status: 403 } });
    const { result, unmount } = renderHook(() => usePatientVisitDetail("7", "13", "14"), { wrapper });
    await waitFor(() => expect(result.current.comparisonRequestError?.status).toBe(403));
    expect(result.current.diagnosisDetails).toEqual(eyes);
    expect(result.current.comparisonDiagnosisDetails).toEqual([]);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      "/pacientes/7", "/pacientes/7/visitas", "/diagnosticar/visita/13/detalles",
      "/diagnosticar/visita/14/detalles",
    ]);
    unmount();
  });

  it("el perfil asistencial no carga un historial compuesto fuera de su alcance", async () => {
    get.mockResolvedValue({ data: { success: true, scope: "assistance", data: patient } });
    const { result } = renderHook(() => usePatientProfile("7"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.patient?.id).toBe(7);
    expect(result.current.diagnoses).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("el listado descarta resultados anteriores ante un 403", async () => {
    get.mockResolvedValueOnce({ data: { scope: "clinical", data: [patient] } });
    const { result } = renderHook(() => usePatients(), { wrapper });
    await waitFor(() => expect(result.current.patients).toHaveLength(1));
    get.mockRejectedValueOnce({ response: { status: 403 } });
    await act(async () => { await result.current.fetchPatients(); });
    expect(result.current.patients).toEqual([]);
    expect(result.current.loadError?.status).toBe(403);
  });

  it("el detalle muestra 401 y 403 sin confundirlos con paciente inexistente", async () => {
    for (const status of [401, 403]) {
      get.mockRejectedValueOnce({ response: { status } });
      const { result, unmount } = renderHook(() => usePatientProfile("7"), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.patientError?.status).toBe(status);
      expect(result.current.patient).toBeNull();
      unmount();
    }
  });

  it("asistente envía solo identificación, contacto y constancia física; callback no expone clínica", async () => {
    login(["Asistente administrativo"]);
    post.mockResolvedValue({ data: { success: true, data: { id: 77, nro_documento: "90000001" } } });
    const onCreated = vi.fn();
    const { result } = renderHook(() => usePatients({ autoFetch: false, onCreated }), { wrapper });
    fillRegistration(result);
    // La UI no debe registrar a escondidas datos clínicos escritos antes de un cambio de perfil.
    await act(async () => { await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    expect(post).not.toHaveBeenCalled();
    act(() => { result.current.setFormData((previous) => ({ ...previous,
      antecedentes_clinicos: "", alergias: "" })); });
    await act(async () => { await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    expect(post).toHaveBeenCalledWith("/pacientes", expect.not.objectContaining({
      antecedentes_clinicos: expect.anything(), alergias: expect.anything(),
    }));
    expect(post.mock.calls[0][1]).toMatchObject({ consentimiento_informado: true });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 77, nombres: "Paciente" }));
    expect(onCreated.mock.calls[0][0]).not.toHaveProperty("antecedentes_clinicos");
  });

  it("enfermero no envía antecedentes y oftalmólogo conserva el registro clínico", async () => {
    for (const [role, expectedScope] of [["Enfermero", "assistance"], ["Oftalmologo", "clinical"]] as const) {
      login([role]);
      post.mockResolvedValueOnce({ data: { data: { id: 77 } } });
      const { result, unmount } = renderHook(() => usePatients({ autoFetch: false }), { wrapper });
      expect(result.current.registrationScope).toBe(expectedScope);
      fillRegistration(result);
      if (role === "Enfermero") {
        act(() => { result.current.setFormData((previous) => ({ ...previous, antecedentes_clinicos: "" })); });
      }
      await act(async () => { await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
      const payload = post.mock.lastCall?.[1] as Record<string, unknown>;
      expect(payload.alergias).toBe("Alergia sintética");
      expect("antecedentes_clinicos" in payload).toBe(role === "Oftalmologo");
      unmount();
    }
  });

  it("401/403 del alta no invocan callback ni cierran el formulario", async () => {
    login(["Asistente administrativo"]);
    const onCreated = vi.fn();
    const { result } = renderHook(() => usePatients({ autoFetch: false, onCreated }), { wrapper });
    fillRegistration(result);
    act(() => { result.current.setFormData((previous) => ({ ...previous,
      antecedentes_clinicos: "", alergias: "" })); result.current.setOpen(true); });
    for (const status of [401, 403]) {
      post.mockRejectedValueOnce({ response: { status, data: { message: "secreto" } } });
      await act(async () => { await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
      expect(result.current.open).toBe(true);
      expect(onCreated).not.toHaveBeenCalled();
    }
  });

  it("el formulario oculta secciones clínicas según el perfil orientativo", () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const formData = { tipo_doc: "DNI", nro_documento: "", nombres: "", apellidos: "",
      sexo: "", fecha_nacimiento: "", telefono: "", correo: "", direccion: "",
      antecedentes_clinicos: "", alergias: "" };
    const props = { open: true, onOpenChange: vi.fn(), formData, isSubmitting: false,
      consent: false, onConsentChange: vi.fn(), onDocumentChange: vi.fn(),
       onPhoneChange: vi.fn(), onFieldChange: vi.fn(), onNameBlur: vi.fn(), onSubmit: vi.fn(),
      onTipoDocChange: vi.fn(), hasUnsavedChanges: false, onDiscard: vi.fn() };
    const { rerender } = render(<CreatePatientDialog {...props} registrationScope="administrative" />);
    expect(screen.queryByText("Información clínica básica")).not.toBeInTheDocument();
    expect(screen.getByText("Consentimiento Informado Físico Archivado")).toBeInTheDocument();
    rerender(<CreatePatientDialog {...props} registrationScope="assistance" />);
    expect(screen.queryByText("Antecedentes clínicos")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Alergias/)).toBeInTheDocument();
    rerender(<CreatePatientDialog {...props} registrationScope="clinical" />);
    expect(screen.getByLabelText(/Antecedentes clínicos/)).toBeInTheDocument();
  });
});
