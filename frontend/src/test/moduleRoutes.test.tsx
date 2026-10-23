// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import api, { ACCESS_DENIED_EVENT } from "../lib/api";
import { canAccessModule, isModuleAccessDenial } from "../features/auth/moduleAccess";
import { useAuthStore, type User } from "../features/auth/store/authStore";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() }, ACCESS_DENIED_EVENT: "app:access-denied" }));
vi.mock("../features/auth/pages/Login", () => ({ default: () => <p>Login simulado</p> }));
vi.mock("../features/dashboard/pages/Dashboard", () => ({ default: () => <p>Dashboard simulado</p> }));
vi.mock("../features/patients/pages/Patients", () => ({ default: () => <p>Pacientes simulado</p> }));
vi.mock("../features/patients/pages/PatientProfile", () => ({ default: () => <p>Perfil simulado</p> }));
vi.mock("../features/patients/pages/PatientVisitDetail", () => ({ default: () => <p>Visita simulada</p> }));
vi.mock("../features/diagnosis/pages/Diagnosis", () => ({ default: () => <p>Diagnóstico simulado</p> }));
vi.mock("../features/reports/pages/ClinicalReports", () => ({ default: () => <p>Informes simulado</p> }));
vi.mock("../features/configuration/pages/Configuration", () => ({ default: () => <p>Configuración simulada</p> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

const get = vi.mocked(api.get);
const admin: User = {
  id: 1, username: "admin", nombres: "Admin", apellidos: "Prueba",
  roles: ["Administrador del sistema"], permisos: ["configuracion.ver"],
};
const doctor: User = {
  ...admin, id: 2, username: "doctor", roles: ["Oftalmologo"],
  permisos: ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver", "diagnostico_retinopatia.crear",
    "imagenes.ver", "informes.ver", "informes.crear"],
};
const token = (seconds = 3600) => `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.signature`;
const allowed = () => get.mockImplementation(async (url) => {
  if (url === "/pacientes/0/visitas") throw { response: { status: 404, data: { success: false, message: "Paciente no encontrado" } } };
  if (url === "/diagnosticar/visita/0/detalles") throw { response: { status: 404, data: { success: false, message: "Diagnóstico no encontrado." } } };
  if (url === "/informes/0") throw { response: { status: 404, data: { success: false, message: "Informe no encontrado." } } };
  return { data: { success: true } } as never;
});
const visit = (path: string, user: User, accessToken = token()) => {
  useAuthStore.getState().login(accessToken, user);
  window.history.replaceState({}, "", path);
  render(<App />);
};

beforeEach(() => {
  useAuthStore.getState().logout();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  get.mockReset();
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Acceso a módulos y enlaces según B1", () => {
  it.each([
    ["/pacientes", "Pacientes simulado"],
    ["/pacientes/8", "Perfil simulado"],
    ["/pacientes/8/visitas/5", "Visita simulada"],
    ["/diagnostico", "Diagnóstico simulado"],
    ["/informes", "Informes simulado"],
  ])("administrador sin acceso directo a %s", async (path, protectedText) => {
    allowed();
    visit(path, admin);
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText(protectedText)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo");
    expect(get).not.toHaveBeenCalledWith("/pacientes/buscar?q=");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("permisos clínicos asignados al administrador no sustituyen OFTALMOLOGO", async () => {
    const user = { ...admin, permisos: [...doctor.permisos!, "configuracion.ver"] };
    expect(canAccessModule(user, "diagnosis")).toBe(false);
    expect(canAccessModule(user, "reports")).toBe(false);
    allowed();
    visit("/diagnostico", user);
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
  });

  it("administrador accede a Configuración solo después del GET autorizado", async () => {
    let resolve!: (value: unknown) => void;
    get.mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    visit("/configuracion", admin);
    expect(screen.getByText("Comprobando acceso...")).toBeInTheDocument();
    expect(screen.queryByText("Configuración simulada")).not.toBeInTheDocument();
    await act(async () => resolve({ data: { success: true } }));
    expect(await screen.findByText("Configuración simulada")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo");
  });

  it("oftalmólogo accede a módulos clínicos, pero no a Configuración", async () => {
    allowed();
    visit("/diagnostico", doctor);
    expect(await screen.findByText("Diagnóstico simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/pacientes/buscar?q=");
    expect(get).toHaveBeenCalledWith("/diagnosticar/visita/0/detalles");
    expect(canAccessModule(doctor, "configuration")).toBe(false);
  });

  it("informes y pacientes aceptan al oftalmólogo tras B1, sin montar antes de la respuesta", async () => {
    allowed();
    visit("/informes", doctor);
    expect(screen.queryByText("Informes simulado")).not.toBeInTheDocument();
    expect(await screen.findByText("Informes simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/informes/0");
    cleanup();
    visit("/pacientes", doctor);
    expect(await screen.findByText("Pacientes simulado")).toBeInTheDocument();
  });

  it("el historial de visitas exige permisos clínicos adicionales al acceso a pacientes", async () => {
    const nurse = { ...doctor, roles: ["Enfermero"], permisos: ["pacientes.ver"] };
    expect(canAccessModule(nurse, "patients")).toBe(true);
    expect(canAccessModule(nurse, "patientVisit")).toBe(false);
    allowed();
    visit("/pacientes/8/visitas/5", nurse);
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText("Visita simulada")).not.toBeInTheDocument();
    cleanup();
    visit("/pacientes/8/visitas/5", doctor);
    expect(await screen.findByText("Visita simulada")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/pacientes/0/visitas");
  });

  it("ambos roles habilitan sus accesos independientes; el servidor vuelve a decidir", async () => {
    const dual = { ...doctor, roles: [...doctor.roles, ...admin.roles], permisos: [...doctor.permisos!, ...admin.permisos!] };
    expect(canAccessModule(dual, "configuration")).toBe(true);
    expect(canAccessModule(dual, "diagnosis")).toBe(true);
    allowed();
    visit("/configuracion", dual);
    expect(await screen.findByText("Configuración simulada")).toBeInTheDocument();
  });

  it("un 403 en B1 redirige y oculta el enlace durante la sesión", async () => {
    get.mockImplementation(async (url) => {
      if (url === "/pacientes/buscar?q=") throw { response: { status: 403 } };
      return { data: { success: true } } as never;
    });
    visit("/pacientes", doctor);
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(canAccessModule(doctor, "patients", useAuthStore.getState().deniedModules)).toBe(false);
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo");
  });

  it("una respuesta 403 posterior del módulo retira acceso sin exponer pantalla", async () => {
    allowed();
    visit("/pacientes", doctor);
    expect(await screen.findByText("Pacientes simulado")).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, {
      detail: { url: "/pacientes", method: "GET" },
    })));
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(canAccessModule(doctor, "patients", useAuthStore.getState().deniedModules)).toBe(false);
  });

  it("al volver a la pestaña revalida el acceso antes de mostrar la pantalla", async () => {
    allowed();
    visit("/informes", doctor);
    expect(await screen.findByText("Informes simulado")).toBeInTheDocument();
    get.mockImplementation(async (url) => {
      if (url === "/informes/0") throw { response: { status: 403 } };
      return { data: { success: true } } as never;
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.queryByText("Informes simulado")).not.toBeInTheDocument();
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
  });

  it("el 403 de una función optativa no bloquea el acceso limitado a pacientes", () => {
    expect(isModuleAccessDenial("patients", "/diagnosticos/paciente/5", "GET")).toBe(false);
    expect(isModuleAccessDenial("patients", "/pacientes", "POST")).toBe(false);
    expect(isModuleAccessDenial("reports", "/informes/5/versiones", "GET")).toBe(false);
    expect(isModuleAccessDenial("reports", "/pacientes/5/visitas", "GET")).toBe(false);
    const nurse = { ...doctor, roles: ["Enfermero"], permisos: ["pacientes.ver"] };
    expect(canAccessModule(nurse, "patients")).toBe(true);
    expect(canAccessModule(nurse, "reports")).toBe(false);
  });

  it("401 y token expirado llevan a login sin bucle ni pantalla clínica", async () => {
    get.mockRejectedValue({ response: { status: 401 } });
    visit("/pacientes", doctor);
    expect(await screen.findByText("Login simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    cleanup();
    get.mockReset();
    visit("/pacientes", doctor, token(-60));
    expect(await screen.findByText("Login simulado")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("Dashboard espera validación del servidor y acepta el 403 propio de un oftalmólogo", async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    visit("/dashboard", doctor);
    expect(screen.queryByText("Dashboard simulado")).not.toBeInTheDocument();
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo");
  });

  it("Dashboard también redirige al login si el servidor invalida la cuenta", async () => {
    get.mockRejectedValue({ response: { status: 401 } });
    visit("/dashboard", admin);
    expect(await screen.findByText("Login simulado")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard simulado")).not.toBeInTheDocument();
  });

  it("hidratar la sesión no equivale a denegar acceso", () => {
    vi.spyOn(useAuthStore.persist, "hasHydrated").mockReturnValue(false);
    visit("/pacientes", doctor);
    expect(screen.getByText("Comprobando sesión...")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("fallos de red no abren ni redirigen: ofrecen reintentar", async () => {
    get.mockRejectedValue(new Error("Sin red"));
    visit("/pacientes", doctor);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo verificar el acceso");
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/pacientes"));
  });

  it("la ruta temporal de paginación retirada muestra 404 sin consultar pacientes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState({}, "", "/_dev/paginacion");
    render(<App />);
    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.queryByText("Vista temporal de paginación")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
