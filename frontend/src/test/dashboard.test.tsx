// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import api from "../lib/api";
import { useAuthStore } from "../features/auth/store/authStore";
import Dashboard from "../features/dashboard/pages/Dashboard";

vi.mock("../lib/api", () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(api.get);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const clinicalPermissions = ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver"];
const summary = {
  kpis: { patients: 8, evaluations: 5, validated: 2, pending: 3 },
  severity: Array.from({ length: 5 }, (_, level) => ({ level, label: `Grado catálogo ${level}`, count: level === 4 ? 2 : 0 })),
  actions: { patients: true, diagnosis: true, reports: true },
  recent_patients: [{ id: 7, nro_documento: "00000007", nombres: "Paciente", apellidos: "Sintético",
    ultima_visita: "2026-10-20T15:00:00Z", ultima_visita_origen: "UTC_VERIFICADO" }],
};

function login(roles: string[], permisos: string[]) {
  useAuthStore.getState().login("token-sintetico", {
    id: 1, username: "test", nombres: "Usuario", apellidos: "Prueba", roles, permisos,
  });
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  get.mockReset();
  useAuthStore.getState().logout();
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("Dashboard clínico", () => {
  it("muestra conteos y catálogo del servidor, no cifras históricas", async () => {
    login(["Oftalmologo"], [...clinicalPermissions, "diagnostico_retinopatia.crear", "imagenes.ver",
      "informes.ver", "informes.crear"]);
    get.mockResolvedValue({ data: { success: true, data: summary } });
    render(<Dashboard />, { wrapper });
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(await screen.findByText(/N4 · Grado catálogo 4/)).toBeInTheDocument();
    expect(screen.getByText("Evaluaciones IA")).toBeInTheDocument();
    for (const [label, tone] of [["Pacientes registrados", "bg-primary/10"], ["Evaluaciones IA", "bg-blue-50"],
      ["Diagnósticos validados", "bg-emerald-50"], ["Pendientes de validación", "bg-amber-50"]]) {
      expect(screen.getByText(label).parentElement?.firstElementChild).toHaveClass(tone);
    }
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Paciente Sintético")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("Total de ojos validados")).toBeInTheDocument();
    expect(screen.getByText("2 ojos validados")).toBeInTheDocument();
    expect(screen.queryByText("Total mes")).not.toBeInTheDocument();
    expect(screen.queryByText("57 evaluaciones")).not.toBeInTheDocument();
    expect(screen.queryByText("Crítico")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva Evaluación IA" })).toHaveAttribute("href", "/diagnostico");
    expect(screen.getByRole("link", { name: "Informes Clínicos" })).toHaveAttribute("href", "/informes");
    const middle = screen.getByRole("group", { name: "Actividad clínica y gravedad" });
    expect(middle).toHaveClass("lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]");
    expect(middle.querySelector("table")).toBeInTheDocument();
    expect(middle.querySelectorAll("thead th")).toHaveLength(3);
    expect(middle).toHaveTextContent("Distribución de gravedad por ojo validado");
    expect(screen.getByRole("heading", { name: "Accesos rápidos" }).parentElement).toHaveClass("space-y-3");
    expect(screen.getAllByText(/Grado catálogo/)).toHaveLength(5);
    const level = screen.getByText(/N4 · Grado catálogo 4/).closest("div")?.nextElementSibling?.firstElementChild;
    expect(level).toHaveStyle({ width: "100%", backgroundColor: "hsl(var(--rd-4))" });
    expect(screen.queryByText(/\+\d+|vs\. ayer|esta semana|Crítico|Seguimiento/)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledExactlyOnceWith("/dashboard/clinico");
  });

  it("distingue cero registros de error de carga", async () => {
    login(["Oftalmologo"], clinicalPermissions);
    get.mockResolvedValueOnce({ data: { success: true, data: {
      kpis: { patients: 0, evaluations: 0, validated: 0, pending: 0 },
      severity: summary.severity.map((row) => ({ ...row, count: 0 })), recent_patients: [],
      actions: { patients: true, diagnosis: false, reports: false },
    } } });
    render(<Dashboard />, { wrapper });
    expect(await screen.findByText("Todavía no hay resultados validados para mostrar")).toBeInTheDocument();
    expect(screen.getByText("No hay visitas con fecha verificada para mostrar.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0 ojos validados\b/)).toBeInTheDocument();
    expect(screen.getByText("Distribución de gravedad por ojo validado").closest(".shadow-card")?.querySelector('[style*="width:"]'))
      .not.toBeInTheDocument();
  });

  it("mantiene accesos rápidos de consulta sin ofrecer creación al especialista de solo lectura", async () => {
    login(["Oftalmologo"], clinicalPermissions);
    get.mockResolvedValueOnce({ data: { success: true, data: summary } });
    render(<Dashboard />, { wrapper });
    expect(await screen.findByText("Distribución de gravedad por ojo validado")).toBeInTheDocument();
    const shortcuts = within(screen.getByRole("heading", { name: "Accesos rápidos" }).parentElement!);
    expect(shortcuts.getByRole("link", { name: "Pacientes" })).toHaveAttribute("href", "/pacientes");
    expect(screen.queryByRole("link", { name: "Nueva Evaluación IA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Informes Clínicos" })).not.toBeInTheDocument();
  });

  it("no sustituye 403 ni errores de red por ceros", async () => {
    login(["Oftalmologo"], clinicalPermissions);
    get.mockRejectedValueOnce({ response: { status: 403 } });
    const view = render(<Dashboard />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(screen.queryByText("Evaluaciones IA")).not.toBeInTheDocument();
    view.unmount();
    get.mockRejectedValueOnce(new Error("sin red"));
    render(<Dashboard />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
  });

  it("oculta el resumen a enfermería y administración; presenta solo accesos permitidos", () => {
    login(["Enfermero"], clinicalPermissions);
    const view = render(<Dashboard />, { wrapper });
    expect(screen.getByText("Bienvenido al sistema")).toBeInTheDocument();
    expect(screen.queryByText("Evaluaciones IA")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nueva Evaluación IA" })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    view.unmount();
    login(["Administrador del sistema"], ["configuracion.ver"]);
    render(<Dashboard />, { wrapper });
    expect(screen.getByRole("link", { name: "Configuración y usuarios" })).toHaveAttribute("href", "/configuracion");
    expect(screen.queryByText("Paciente Sintético")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("si se revoca un permiso local, no pide datos; roles combinados se validan en Flask", () => {
    login(["Administrador del sistema", "Oftalmologo"], ["pacientes.ver", "diagnostico_retinopatia.ver"]);
    render(<Dashboard />, { wrapper });
    expect(screen.getByRole("alert")).toHaveTextContent("No tiene autorización");
    expect(get).not.toHaveBeenCalled();
  });
});
