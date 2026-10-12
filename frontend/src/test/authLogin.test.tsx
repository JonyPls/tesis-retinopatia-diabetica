// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../App";
import { LoginForm } from "../features/auth/components/LoginForm";
import { useLogin } from "../features/auth/hooks/useLogin";
import { login as loginService } from "../features/auth/api/authService";
import { useAuthStore } from "../features/auth/store/authStore";

vi.mock("../features/auth/api/authService", () => ({ login: vi.fn() }));
vi.mock("../features/auth/pages/Login", () => ({ default: () => <p>Acceso de prueba</p> }));
vi.mock("../features/dashboard/pages/Dashboard", () => ({ default: () => <p>Panel de prueba</p> }));
vi.mock("../features/patients/pages/Patients", () => ({ default: () => <p>Pacientes de prueba</p> }));
vi.mock("../features/patients/pages/PatientProfile", () => ({ default: () => <p>Perfil de prueba</p> }));
vi.mock("../features/patients/pages/PatientVisitDetail", () => ({ default: () => <p>Visita de prueba</p> }));
vi.mock("../features/diagnosis/pages/Diagnosis", () => ({ default: () => <p>Diagnóstico de prueba</p> }));
vi.mock("../features/reports/pages/ClinicalReports", () => ({ default: () => <p>Informe de prueba</p> }));
vi.mock("../pages/Placeholder", () => ({ default: () => <p>Configuración de prueba</p> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

const mockLogin = vi.mocked(loginService);
const fakeUser = {
  id: 42,
  username: "medico_ficticio",
  nombres: "NombreFicticio",
  apellidos: "ApellidoFicticio",
  roles: ["Médico"],
  permisos: ["pacientes.ver"],
};

function FormWithHook() {
  return <LoginForm {...useLogin()} />;
}

function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<FormWithHook />} />
        <Route path="/dashboard" element={<p>Panel después del login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: fakeUser.username } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "synthetic-only" } });
}

beforeEach(() => {
  useAuthStore.getState().logout();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("LoginForm y useLogin: HTTP siempre simulado", () => {
  it("CP-01 navega y persiste sesión tras un login simulado válido", async () => {
    mockLogin.mockResolvedValue({ token: "synthetic-token-placeholder", user: fakeUser });
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByText("Verificado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verificado" })).toBeDisabled();
    expect(await screen.findByText("Panel después del login")).toBeInTheDocument();
    expect(mockLogin).toHaveBeenCalledWith(fakeUser.username, "synthetic-only");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("CP-02 muestra un rechazo simulado sin guardar sesión", async () => {
    mockLogin.mockRejectedValue({ response: { status: 401, data: { message: "Credenciales incorrectas." } } });
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByText("Credenciales incorrectas.")).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(screen.queryByText("Panel después del login")).not.toBeInTheDocument();
  });

  it("A1-FORM exige ambos campos y evita un segundo envío mientras carga", () => {
    mockLogin.mockReturnValue(new Promise<Awaited<ReturnType<typeof loginService>>>(() => {}));
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(mockLogin).not.toHaveBeenCalled();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Verificando/ })).toBeDisabled();
  });

  it("A1-NET presenta mensaje alternativo ante error de red simulado", async () => {
    mockLogin.mockRejectedValue(new Error("network unavailable"));
    renderLogin();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Error al iniciar sesión. Verifica tus credenciales.")).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe("Rutas y persistencia locales (sin navegador/API real)", () => {
  it("CP-04 redirige una ruta privada sin sesión al login", () => {
    window.history.replaceState({}, "", "/pacientes");
    render(<App />);
    expect(screen.getByText("Acceso de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes de prueba")).not.toBeInTheDocument();
  });

  it("A1-ROLE redirige un rol no autorizado desde configuración", () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    window.history.replaceState({}, "", "/configuracion");
    render(<App />);
    expect(screen.getByText("Panel de prueba")).toBeInTheDocument();
    expect(screen.queryByText("Configuración de prueba")).not.toBeInTheDocument();
  });

  it("A1-RELOAD rehidrata una sesión local y permite navegación protegida", async () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    const saved = window.localStorage.getItem("auth-storage");
    expect(saved).not.toBeNull();
    useAuthStore.getState().logout();
    window.localStorage.setItem("auth-storage", saved!);
    await act(async () => { await useAuthStore.persist.rehydrate(); });

    window.history.replaceState({}, "", "/pacientes");
    render(<App />);
    expect(screen.getByText("Pacientes de prueba")).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.fails("A1-EXPIRED-UI debería impedir mostrar una ruta con sesión local caducada", () => {
    // Estado sintético: el guard solo conoce el indicador persistido, no comprueba exp.
    useAuthStore.getState().login("expired-synthetic-placeholder", fakeUser);
    window.history.replaceState({}, "", "/pacientes");
    render(<App />);
    expect(screen.getByText("Pacientes de prueba")).toBeInTheDocument(); // Observado.
    expect(screen.getByText("Acceso de prueba")).toBeInTheDocument(); // Objetivo, falla hoy.
  });

  it("A1-LOGOUT borra la sesión local, no revoca tokens del servidor", () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("auth-storage")!).state.token).toBeNull();
  });
});
