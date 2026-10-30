// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import api from "../lib/api";
import { useAuthStore } from "../features/auth/store/authStore";
import Dashboard from "../features/dashboard/pages/Dashboard";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import { DiagnosisPatientStep } from "../features/diagnosis/components/DiagnosisPatientStep";
import { useReports } from "../features/reports/hooks/useReports";
import { PatientSelectorStep } from "../features/reports/components/PatientSelectorStep";
import {
  buscarPacientes,
  buscarPacientesPaginado,
  obtenerPacientesRecientes,
} from "../features/patients/api/patientService";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));
vi.mock("../features/patients/api/patientService", () => ({
  buscarPacientes: vi.fn(),
  buscarPacientesPaginado: vi.fn(),
  obtenerPacientesRecientes: vi.fn(),
  obtenerVisitasPaciente: vi.fn(),
}));

const recent = vi.mocked(obtenerPacientesRecientes);
const paginated = vi.mocked(buscarPacientesPaginado);
const search = vi.mocked(buscarPacientes);
const get = vi.mocked(api.get);
const patient = {
  id: 7, tipo_doc_abrev: "DNI", nro_documento: "00000007",
  nombres: "Paciente", apellidos: "Sintético", ultima_visita: null,
};
const page = (data: typeof patient[], has_more = false) => ({
  data, pagination: { page: 1, per_page: 10, total: data.length, has_more },
});
const denied = { response: { status: 403, data: { message: "internal details must not appear" } } };
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function renderDashboard() {
  return render(<MemoryRouter initialEntries={["/dashboard"]}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

function DiagnosisLookup() {
  const hook = useDiagnosis();
  return <DiagnosisPatientStep
    {...hook}
    isLoadingMore={hook.isLoadingMorePatients}
    registrationDialog={null}
    onQueryChange={hook.handleQueryChange}
    onLoadMore={hook.loadMorePatients}
    onSelect={hook.selectPatient}
    onSelectVisita={hook.selectVisita}
    onClear={hook.clearPatient}
  />;
}

function ReportLookup() {
  const hook = useReports();
  return <PatientSelectorStep
    {...hook}
    onQueryChange={hook.handleQueryChange}
    onSelect={hook.selectPatient}
    onClear={hook.clearPatient}
  />;
}

function login(roles: string[], permisos = ["pacientes.ver"]) {
  useAuthStore.getState().login("synthetic-only", {
    id: 9, username: "synthetic", nombres: "Usuario", apellidos: "Prueba", roles, permisos,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  recent.mockResolvedValue([]);
  get.mockResolvedValue({ data: { data: [] } });
  useAuthStore.getState().logout();
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false, media: "", addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  window.localStorage.clear();
});

describe("B1 búsqueda y recientes (HTTP simulado, UI real)", () => {
  it("muestra pacientes encontrados y conserva paginación", async () => {
    paginated.mockResolvedValue(page([patient], true));
    render(<DiagnosisLookup />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Pac" } });
    expect(await screen.findByRole("button", { name: /Paciente Sintético/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar más pacientes" })).toBeEnabled();
    expect(paginated).toHaveBeenCalledWith("Pac", { page: 1, perPage: 10 });
  });

  it("distingue una respuesta 200 vacía de un rechazo", async () => {
    paginated.mockResolvedValue(page([]));
    render(<DiagnosisLookup />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Nada" } });
    expect(await screen.findByText("No se encontraron pacientes")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("anexa una segunda página sin perder los resultados anteriores", async () => {
    const second = { ...patient, id: 8, nombres: "Segundo" };
    paginated.mockResolvedValueOnce(page([patient], true)).mockResolvedValueOnce({
      data: [second], pagination: { page: 2, per_page: 10, total: 2, has_more: false },
    });
    render(<DiagnosisLookup />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Pac" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más pacientes" }));
    expect(await screen.findByRole("button", { name: /Segundo Sintético/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paciente Sintético/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más pacientes" })).not.toBeInTheDocument();
    expect(paginated).toHaveBeenLastCalledWith("Pac", { page: 2, perPage: 10 });
  });

  it("limpia resultados anteriores y muestra 403 sin detalles internos ni reintentos", async () => {
    recent.mockResolvedValue([patient]);
    paginated.mockResolvedValueOnce(page([patient])).mockRejectedValueOnce(denied);
    render(<DiagnosisLookup />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Pac" } });
    expect(await screen.findByRole("button", { name: /Paciente Sintético/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Otro" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByText("No se encontraron pacientes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Paciente Sintético/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/internal details/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/dashboard");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No tiene autorización");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect(paginated).toHaveBeenCalledTimes(2);
  });

  it("el rechazo 403 de recientes muestra alerta accesible, sin fingir lista vacía", async () => {
    recent.mockRejectedValue(denied);
    render(<DiagnosisLookup />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByText("Empiece buscando un paciente")).not.toBeInTheDocument();
    expect(recent).toHaveBeenCalledTimes(1);
  });

  it("el rechazo al cargar otra página elimina resultados ya visibles", async () => {
    paginated.mockResolvedValueOnce(page([patient], true)).mockRejectedValueOnce(denied);
    render(<DiagnosisLookup />, { wrapper });
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente" }), { target: { value: "Pac" } });
    await screen.findByRole("button", { name: "Cargar más pacientes" });
    fireEvent.click(screen.getByRole("button", { name: "Cargar más pacientes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByRole("button", { name: /Paciente Sintético/ })).not.toBeInTheDocument();
    expect(paginated).toHaveBeenCalledTimes(2);
  });

  it("distingue 401, red y 500 sin mostrar texto del backend", async () => {
    paginated.mockRejectedValueOnce({ response: { status: 401 } })
      .mockRejectedValueOnce(new Error("private network details"))
      .mockRejectedValueOnce({ response: { status: 500, data: { message: "private server details" } } });
    render(<DiagnosisLookup />, { wrapper });
    const input = screen.getByRole("textbox", { name: "Buscar paciente" });
    fireEvent.change(input, { target: { value: "uno" } });
    expect(await screen.findByRole("link", { name: "Ir a inicio de sesión" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "dos" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
    fireEvent.change(input, { target: { value: "tres" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Inténtelo más tarde");
    expect(screen.queryByText(/private/)).not.toBeInTheDocument();
  });

  it("ignora respuestas de búsquedas anteriores cuando cambia el filtro", async () => {
    let resolveFirst!: (value: ReturnType<typeof page>) => void;
    paginated.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(page([]));
    render(<DiagnosisLookup />, { wrapper });
    const input = screen.getByRole("textbox", { name: "Buscar paciente" });
    fireEvent.change(input, { target: { value: "Pac" } });
    await waitFor(() => expect(paginated).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "Otro" } });
    expect(await screen.findByText("No se encontraron pacientes")).toBeInTheDocument();
    await act(async () => { resolveFirst(page([patient])); });
    expect(screen.queryByRole("button", { name: /Paciente Sintético/ })).not.toBeInTheDocument();
  });

  it("informes muestra recientes y búsqueda con éxito, y luego un 403 limpio", async () => {
    recent.mockResolvedValue([patient]);
    search.mockResolvedValueOnce([patient]).mockRejectedValueOnce(denied);
    render(<ReportLookup />, { wrapper });
    expect(await screen.findByText("Pacientes recientes")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Buscar paciente" });
    fireEvent.change(input, { target: { value: "Pac" } });
    expect(await screen.findByText("Resultados de búsqueda")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Otro" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByText("Resultados de búsqueda")).not.toBeInTheDocument();
    expect(screen.queryByText("No se encontraron pacientes")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("informes distingue lista vacía, red y 403 en recientes", async () => {
    recent.mockRejectedValue(denied);
    search.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("network"));
    render(<ReportLookup />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    const input = screen.getByRole("textbox", { name: "Buscar paciente" });
    fireEvent.change(input, { target: { value: "Nada" } });
    expect(await screen.findByText("No se encontraron pacientes")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Red" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
    expect(screen.queryByText("No se encontraron pacientes")).not.toBeInTheDocument();
  });
});

describe("B1 inicio por perfil", () => {
  it("Administrador solo no consulta ni muestra datos clínicos ni métricas inventadas", () => {
    login(["Administrador del sistema"]);
    renderDashboard();
    expect(screen.getByText("Bienvenido al sistema")).toBeInTheDocument();
    expect(screen.queryByText("Últimos Pacientes Atendidos")).not.toBeInTheDocument();
    expect(screen.queryByText("Pacientes Registrados")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Diagnóstico IA" })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("el nombre heredado Admin tampoco dispara consultas clínicas", () => {
    login(["Admin"]);
    renderDashboard();
    expect(screen.getByText("Bienvenido al sistema")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("Administrador + Oftalmólogo conserva navegación clínica y consulta de pacientes", async () => {
    login(["Administrador del sistema", "Oftalmologo"], [
      "pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver", "diagnostico_retinopatia.crear", "imagenes.ver",
    ]);
    get.mockResolvedValueOnce({ data: { success: true, data: {
      kpis: { patients: 0, evaluations: 0, validated: 0, pending: 0 }, severity: [], recent_patients: [],
      actions: { patients: true, diagnosis: true, reports: false },
    } } });
    renderDashboard();
    expect(await screen.findByText("Actividad reciente")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nueva Evaluación IA/ })).toHaveAttribute("href", "/diagnostico");
    expect(screen.getByRole("link", { name: "Diagnóstico IA" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/dashboard/clinico");
  });

  it("Oftalmólogo muestra pacientes reales y 403 no se transforma en lista vacía", async () => {
    login(["Oftalmologo"], ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver"]);
    get.mockRejectedValueOnce(denied);
    renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByText("No hay pacientes con visitas registradas.")).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("Oftalmólogo muestra únicamente pacientes que devuelve la consulta", async () => {
    login(["Oftalmologo"], ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver"]);
    get.mockResolvedValueOnce({ data: { success: true, data: {
      kpis: { patients: 1, evaluations: 0, validated: 0, pending: 0 }, severity: [],
      recent_patients: [{ ...patient, ultima_visita: "2026-01-01T00:00:00Z", ultima_visita_origen: "UTC_VERIFICADO" }],
      actions: { patients: true, diagnosis: false, reports: false },
    } } });
    renderDashboard();
    expect(await screen.findByText("Paciente Sintético")).toBeInTheDocument();
    expect(screen.getByText("Pacientes registrados")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("sin permiso de paciente evita la consulta incluso con rol oftalmológico local", () => {
    login(["Oftalmologo"], []);
    renderDashboard();
    expect(screen.getByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(get).not.toHaveBeenCalled();
  });
});
