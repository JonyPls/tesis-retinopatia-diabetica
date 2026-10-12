// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import api from "../lib/api";
import { PatientTable } from "../features/patients/components/PatientTable";
import { PatientInfoCard } from "../features/patients/components/PatientInfoCard";
import { usePatients } from "../features/patients/hooks/usePatients";
import { usePatientProfile } from "../features/patients/hooks/usePatientProfile";
import { usePatientVisitDetail } from "../features/patients/hooks/usePatientVisitDetail";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(api.get);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const patient = { id: 7, tipo_doc_abrev: "DNI", nro_documento: "00000007",
  nombres: "Paciente", apellidos: "Sintético", sexo: "F", fecha_nacimiento: "2000-01-01",
  antecedentes_clinicos: "antecedente sintético", alergias: "alergia sintética" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

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

  it("404 de visitas no se presenta como paciente inexistente", async () => {
    get.mockResolvedValueOnce({ data: { success: true, scope: "clinical",
      history_available: true, data: patient } })
      .mockRejectedValueOnce({ response: { status: 404 } });
    const { result } = renderHook(() => usePatientVisitDetail("7", "13"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("load_error");
    expect(result.current.requestError?.status).toBe(404);
    expect(result.current.patient?.id).toBe(7);
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
});
