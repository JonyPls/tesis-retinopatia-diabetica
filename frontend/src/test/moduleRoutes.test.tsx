// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import App from "../App";
import { PageContent } from "../components/layout/PageContent";
import api, { ACCESS_DENIED_EVENT } from "../lib/api";
import { canAccessModule, isModuleAccessDenial } from "../features/auth/moduleAccess";
import { useAuthStore, type User } from "../features/auth/store/authStore";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() }, ACCESS_DENIED_EVENT: "app:access-denied" }));
vi.mock("../features/auth/pages/Login", () => ({ default: () => <p>Login simulado</p> }));
vi.mock("../features/dashboard/pages/Dashboard", () => ({ default: () => <p>Dashboard simulado</p> }));
const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("../features/patients/pages/Patients", () => ({ default: function Patients() {
  const [draft, setDraft] = useState("");
  useEffect(() => { lifecycle.mount(); return () => { lifecycle.unmount(); }; }, []);
  return <PageContent title="Pacientes simulado" subtitle="Subtítulo de pacientes" actions={<button>Acción de pacientes</button>}>
    <input aria-label="Borrador de pacientes" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <Link to="/pacientes/8">Abrir perfil</Link>
  </PageContent>;
} }));
vi.mock("../features/patients/pages/PatientProfile", () => ({ default: function Profile() {
  const { id } = useParams();
  return <PageContent title="Perfil simulado" subtitle={`Perfil ${id}`}>
    <Link to="/pacientes/9">Otra ficha</Link>
    <Link to={`/pacientes/${id}/visitas/5`}>Abrir visita</Link>
  </PageContent>;
} }));
vi.mock("../features/patients/pages/PatientVisitDetail", () => ({ default: () => <p>Visita simulada</p> }));
vi.mock("../features/diagnosis/pages/Diagnosis", () => ({ default: () => <p>Diagnóstico simulado</p> }));
vi.mock("../features/reports/pages/ClinicalReports", () => ({ default: () => <p>Informes simulado</p> }));
vi.mock("../features/configuration/pages/Configuration", () => ({ default: () => <p>Configuración simulada</p> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

const get = vi.mocked(api.get);
const probeOptions = expect.objectContaining({ signal: expect.any(AbortSignal) });
const resume = () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
};
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
  if (url === "/pacientes/recientes" || url === "/tipos-informe" || url === "/informes/visita/0")
    return { data: { success: true, data: [] } } as never;
  return { data: { success: true, data: [] } } as never;
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
  lifecycle.mount.mockClear();
  lifecycle.unmount.mockClear();
  document.cookie = "sidebar:state=true; path=/";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "sidebar:state=true; path=/";
});

describe("Layout persistente de rutas protegidas", () => {
  it("conserva shell y colapso durante comprobaciones de módulos y rutas internas, sin dejar títulos ni acciones anteriores", async () => {
    allowed();
    const dual = { ...doctor, roles: [...doctor.roles, ...admin.roles], permisos: [...doctor.permisos!, ...admin.permisos!] };
    visit("/dashboard", dual);
    await screen.findByText("Dashboard simulado");
    const header = screen.getByRole("banner");
    const main = screen.getByRole("main");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    fireEvent.click(within(header).getByRole("button", { name: "Contraer menú" }));

    const routes: [string, string, string][] = [
      ["/pacientes", "Pacientes simulado", "/pacientes/recientes"],
      ["/pacientes/8", "Perfil simulado", "/pacientes/recientes"],
      ["/pacientes/9", "Perfil simulado", "/pacientes/recientes"],
      ["/pacientes/9/visitas/5", "Visita simulada", "/pacientes/buscar?q="],
      ["/diagnostico", "Diagnóstico simulado", "/pacientes/buscar?q="],
      ["/informes", "Informes simulado", "/tipos-informe"],
      ["/configuracion", "Configuración simulada", "/configuracion/catalogo"],
      ["/dashboard", "Dashboard simulado", "/configuracion/catalogo"],
    ];
    for (const [path, text, expectedProbe] of routes) {
      let resolve!: (value: unknown) => void;
      get.mockClear();
      get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
      const link = document.querySelector<HTMLAnchorElement>(`a[href="${path}"]`);
      expect(link).not.toBeNull();
      fireEvent.click(link!);
      expect(within(main).getByText("Comprobando acceso...")).toBeInTheDocument();
      expect(screen.queryByText(text)).not.toBeInTheDocument();
      expect(screen.queryByText("Subtítulo de pacientes")).not.toBeInTheDocument();
      expect(screen.queryByText("Acción de pacientes")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Perfil \d+$/)).not.toBeInTheDocument();
      expect(screen.getByRole("banner")).toBe(header);
      expect(screen.getByRole("main")).toBe(main);
      expect(document.querySelector('[data-sidebar="sidebar"]')).toBe(sidebar);
      expect(within(header).getByRole("button", { name: "Expandir menú" })).toHaveAttribute("aria-expanded", "false");
      await act(async () => resolve({ data: { success: true, data: [] } }));
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByRole("banner")).toBe(header);
      expect(document.querySelector('[data-sidebar="sidebar"]')).toBe(sidebar);
      expect(get).toHaveBeenCalledWith(expectedProbe, probeOptions);
      if (path === "/pacientes") {
        expect(screen.getByText("Subtítulo de pacientes")).toBeInTheDocument();
        expect(screen.getByText("Acción de pacientes")).toBeInTheDocument();
      }
      if (path === "/pacientes/8" || path === "/pacientes/9") {
        expect(screen.getByText(`Perfil ${path.split("/").pop()}`)).toBeInTheDocument();
        expect(screen.queryByText("Acción de pacientes")).not.toBeInTheDocument();
      }
    }
    expect(main.querySelector(".animate-fade-in")).toBeNull();
    fireEvent.click(within(header).getByRole("button", { name: "Expandir menú" }));
    expect(within(header).getByRole("button", { name: "Contraer menú" })).toHaveAttribute("aria-expanded", "true");
  });

  it("no monta el shell para visitantes sin sesión ni en rutas públicas", () => {
    window.history.replaceState({}, "", "/pacientes");
    render(<App />);
    expect(screen.getByText("Login simulado")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="sidebar"]')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("retira el shell al cerrar sesión y no restaura contenido por una comprobación tardía", async () => {
    let resolve!: (value: unknown) => void;
    get.mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    visit("/pacientes", doctor);
    expect(screen.getByText("Comprobando acceso...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(screen.getByText("Login simulado")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    await act(async () => resolve({ data: { success: true, data: [] } }));
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="sidebar"]')).toBeNull();
  });
});

describe("Revalidación de una página previamente autorizada", () => {
  it("conserva instancia y formulario, deduplica foco/visibilidad y vuelve a comprobar sin caché temporal", async () => {
    allowed();
    visit("/pacientes", doctor);
    await screen.findByText("Pacientes simulado");
    const input = screen.getByLabelText("Borrador de pacientes");
    fireEvent.change(input, { target: { value: "trabajo en curso" } });
    let finish!: (value: unknown) => void;
    get.mockClear();
    get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    resume();
    resume();
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Borrador de pacientes")).toBe(input);
    expect(input).toHaveValue("trabajo en curso");
    expect(screen.queryByText("Comprobando acceso...")).not.toBeInTheDocument();
    expect(lifecycle.mount).toHaveBeenCalledOnce();
    expect(lifecycle.unmount).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "edición durante la comprobación" } });
    await act(async () => finish({ data: { success: true, data: [] } }));
    expect(input).toHaveValue("edición durante la comprobación");
    expect(lifecycle.unmount).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(lifecycle.mount).toHaveBeenCalledOnce();
  });

  it("un fallo temporal conserva el borrador y el reintento no remonta la página", async () => {
    allowed();
    visit("/pacientes", doctor);
    await screen.findByText("Pacientes simulado");
    const input = screen.getByLabelText("Borrador de pacientes");
    fireEvent.change(input, { target: { value: "no perder" } });
    get.mockRejectedValueOnce(new Error("network"));
    resume();
    expect(await screen.findByText(/No se pudo volver a verificar el acceso/)).toBeInTheDocument();
    expect(screen.getByLabelText("Borrador de pacientes")).toBe(input);
    expect(input).toHaveValue("no perder");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText(/No se pudo volver a verificar el acceso/)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Borrador de pacientes")).toBe(input);
    expect(lifecycle.mount).toHaveBeenCalledOnce();
    expect(lifecycle.unmount).not.toHaveBeenCalled();
  });

  it("una sonda positiva antigua no rehabilita un módulo revocado", async () => {
    allowed();
    visit("/pacientes", doctor);
    await screen.findByText("Pacientes simulado");
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    resume();
    const signal = get.mock.calls[get.mock.calls.length - 1][1]?.signal;
    act(() => window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, {
      detail: { url: "/pacientes", method: "GET" },
    })));
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish({ data: { success: true, data: [] } }));
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(useAuthStore.getState().deniedModules).toContain("patients");
    expect(lifecycle.unmount).toHaveBeenCalledOnce();
  });

  it("al cambiar pathname cancela la sonda anterior y comprueba la nueva ruta antes de montarla", async () => {
    allowed();
    visit("/pacientes", doctor);
    await screen.findByText("Pacientes simulado");
    let finishOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }) as never);
    resume();
    const oldSignal = get.mock.calls[get.mock.calls.length - 1][1]?.signal;
    let finishNew!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }) as never);
    fireEvent.click(screen.getByRole("link", { name: "Abrir perfil" }));
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByText("Perfil simulado")).not.toBeInTheDocument();
    expect(screen.getByText("Comprobando acceso...")).toBeInTheDocument();
    await act(async () => finishOld({ data: { success: true, data: [] } }));
    expect(screen.queryByText("Perfil simulado")).not.toBeInTheDocument();
    await act(async () => finishNew({ data: { success: true, data: [] } }));
    expect(await screen.findByText("Perfil simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
  });

  it.each([401, 403])("ignora una sonda %s tardía de otra sesión y exige autorización inicial a la nueva", async (status) => {
    allowed();
    visit("/pacientes", doctor);
    await screen.findByText("Pacientes simulado");
    fireEvent.change(screen.getByLabelText("Borrador de pacientes"), { target: { value: "sesión anterior" } });
    let fail!: (reason: unknown) => void;
    get.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }) as never);
    resume();
    const signal = get.mock.calls[get.mock.calls.length - 1][1]?.signal;
    act(() => useAuthStore.getState().login(token(7200), { ...doctor, id: 3 }));
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(screen.getByText("Comprobando acceso...")).toBeInTheDocument();
    await screen.findByText("Pacientes simulado");
    expect(screen.getByLabelText("Borrador de pacientes")).toHaveValue("");
    expect(signal?.aborted).toBe(true);
    await act(async () => fail({ response: { status } }));
    expect(useAuthStore.getState().user?.id).toBe(3);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().deniedModules).toEqual([]);
    expect(screen.getByText("Pacientes simulado")).toBeInTheDocument();
  });

  it("un JWT que expira con una sonda pendiente cierra sesión al recuperar actividad", async () => {
    allowed();
    visit("/pacientes", doctor, token(30));
    await screen.findByText("Pacientes simulado");
    let finish!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    resume();
    const count = get.mock.calls.length;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    resume();
    expect(await screen.findByText("Login simulado")).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(get).toHaveBeenCalledTimes(count);
    await act(async () => finish({ data: { success: true, data: [] } }));
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
  });
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
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo", probeOptions);
    expect(get).not.toHaveBeenCalledWith("/pacientes/buscar?q=", expect.anything());
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
    const header = screen.getByRole("banner");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    expect(screen.getByText("Comprobando acceso...")).toBeInTheDocument();
    expect(screen.queryByText("Configuración simulada")).not.toBeInTheDocument();
    await act(async () => resolve({ data: { success: true, data: [] } }));
    expect(await screen.findByText("Configuración simulada")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(header);
    expect(document.querySelector('[data-sidebar="sidebar"]')).toBe(sidebar);
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo", probeOptions);
  });

  it("oftalmólogo accede a módulos clínicos, pero no a Configuración", async () => {
    allowed();
    visit("/diagnostico", doctor);
    expect(await screen.findByText("Diagnóstico simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/pacientes/buscar?q=", probeOptions);
    expect(get).toHaveBeenCalledWith("/diagnosticar/visita/0/detalles", probeOptions);
    expect(canAccessModule(doctor, "configuration")).toBe(false);
  });

  it("informes y pacientes aceptan al oftalmólogo tras B1, sin montar antes de la respuesta", async () => {
    allowed();
    visit("/informes", doctor);
    expect(screen.queryByText("Informes simulado")).not.toBeInTheDocument();
    expect(await screen.findByText("Informes simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/informes/visita/0", probeOptions);
    expect(get).not.toHaveBeenCalledWith("/informes/0", expect.anything());
    cleanup();
    visit("/pacientes", doctor);
    expect(await screen.findByText("Pacientes simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/pacientes/recientes", probeOptions);
    expect(get).not.toHaveBeenCalledWith("/pacientes/buscar?q=", expect.anything());
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
    expect(get).toHaveBeenCalledWith("/pacientes/0/visitas", probeOptions);
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
      if (url === "/pacientes/recientes") throw { response: { status: 403 } };
      return { data: { success: true, data: [] } } as never;
    });
    visit("/pacientes", doctor);
    const header = screen.getByRole("banner");
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(canAccessModule(doctor, "patients", useAuthStore.getState().deniedModules)).toBe(false);
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo", probeOptions);
    expect(screen.getByRole("banner")).toBe(header);
  });

  it("una respuesta 403 posterior del módulo retira acceso sin exponer pantalla", async () => {
    allowed();
    visit("/pacientes", doctor);
    expect(await screen.findByText("Pacientes simulado")).toBeInTheDocument();
    const header = screen.getByRole("banner");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    act(() => window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, {
      detail: { url: "/pacientes", method: "GET" },
    })));
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(canAccessModule(doctor, "patients", useAuthStore.getState().deniedModules)).toBe(false);
    expect(screen.getByRole("banner")).toBe(header);
    expect(document.querySelector('[data-sidebar="sidebar"]')).toBe(sidebar);
    expect(screen.queryByRole("link", { name: "Pacientes" })).not.toBeInTheDocument();
  });

  it("al volver revalida sin desmontar y retira el contenido si se confirma una revocación", async () => {
    allowed();
    visit("/informes", doctor);
    expect(await screen.findByText("Informes simulado")).toBeInTheDocument();
    const header = screen.getByRole("banner");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    get.mockImplementation(async (url) => {
      if (url === "/informes/visita/0") throw { response: { status: 403 } };
      if (url === "/tipos-informe") return { data: { success: true, data: [] } } as never;
      return { data: { success: true, data: [] } } as never;
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByText("Informes simulado")).toBeInTheDocument();
    expect(screen.queryByText("Comprobando acceso...")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(header);
    expect(document.querySelector('[data-sidebar="sidebar"]')).toBe(sidebar);
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(header);
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
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    cleanup();
    get.mockReset();
    visit("/pacientes", doctor, token(-60));
    expect(await screen.findByText("Login simulado")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("Dashboard espera validación del servidor y acepta el 403 propio de un oftalmólogo", async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    visit("/dashboard", doctor);
    expect(screen.queryByText("Dashboard simulado")).not.toBeInTheDocument();
    expect(await screen.findByText("Dashboard simulado")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/configuracion/catalogo", probeOptions);
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
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("fallos de red no abren ni redirigen: ofrecen reintentar", async () => {
    get.mockRejectedValue(new Error("Sin red"));
    visit("/pacientes", doctor);
    const header = screen.getByRole("banner");
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo verificar el acceso");
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/pacientes"));
    allowed();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.queryByText("Pacientes simulado")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(header);
    expect(await screen.findByText("Pacientes simulado")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(header);
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
