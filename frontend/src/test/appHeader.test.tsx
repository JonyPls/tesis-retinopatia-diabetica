// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { useAuthStore } from "../features/auth/store/authStore";
import { buscarPacientesPaginado } from "../features/patients/api/patientService";

vi.mock("../features/patients/api/patientService", () => ({ buscarPacientesPaginado: vi.fn() }));

const patient = { id: 7, nombres: "María", apellidos: "Pérez", tipo_doc_abrev: "DNI", nro_documento: "00001234" };
const found = (patients = [patient]) => ({ data: patients, pagination: { page: 1, per_page: 5, total: patients.length, has_more: false } });
const path = () => <output data-testid="path">{useLocation().pathname}</output>;
const desktopWidth = window.innerWidth;

function login(roles = ["Oftalmologo"], permisos = ["pacientes.ver"]) {
  useAuthStore.getState().login("token-prueba", {
    id: 2, username: "prueba", nombres: "Usuario", apellidos: "Ejemplo", roles, permisos,
  });
}

function show(title = "Dashboard", subtitle?: string) {
  const Location = path;
  return render(<MemoryRouter initialEntries={["/dashboard"]}>
    <AppLayout title={title} subtitle={subtitle}><Location /></AppLayout>
  </MemoryRouter>);
}

beforeEach(() => {
  document.cookie = "sidebar:state=true; path=/";
  vi.mocked(buscarPacientesPaginado).mockReset();
  vi.mocked(buscarPacientesPaginado).mockResolvedValue(found());
  useAuthStore.getState().logout();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  window.innerWidth = desktopWidth;
  document.cookie = "sidebar:state=true; path=/";
  useAuthStore.getState().logout();
  vi.unstubAllGlobals();
});

it.each(["Dashboard", "Gestión de Pacientes", "Datos del paciente", "Diagnóstico IA", "Informes Clínicos", "Configuración"])(
  "header utilitario en %s sin duplicar título o subtítulo", (title) => {
    login();
    show(title, "Subtítulo único");
    expect(screen.getAllByRole("heading", { name: title })).toHaveLength(1);
    expect(screen.getAllByText("Subtítulo único")).toHaveLength(1);
    expect(screen.getByRole("banner")).not.toHaveTextContent(title);
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Contraer menú" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Buscar paciente o documento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notificaciones" })).toBeInTheDocument();
  });

it("tiene un único control en el header, contrae y expande el sidebar de escritorio", () => {
  login();
  show();
  const header = screen.getByRole("banner");
  const trigger = within(header).getByRole("button", { name: "Contraer menú" });
  const sidebar = document.querySelector('[data-sidebar="sidebar"]');
  const container = sidebar?.parentElement?.parentElement;
  expect(document.querySelectorAll('[data-sidebar="trigger"]')).toHaveLength(1);
  expect(sidebar?.contains(trigger)).toBe(false);
  expect(container).toHaveAttribute("data-state", "expanded");
  expect(trigger.querySelector("svg")).toHaveClass("lucide-panel-left-close");
  expect(header).toHaveClass("items-center");
  expect(trigger).toHaveClass("h-9", "w-9", "focus-visible:ring-2");
  expect(header).toContainElement(screen.getByRole("combobox"));
  expect(header).toContainElement(screen.getByRole("button", { name: "Notificaciones" }));
  fireEvent.click(trigger);
  expect(container).toHaveAttribute("data-state", "collapsed");
  expect(trigger).toHaveAccessibleName("Expandir menú");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger.querySelector("svg")).toHaveClass("lucide-panel-left-open");
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  fireEvent.click(trigger);
  expect(container).toHaveAttribute("data-state", "expanded");
  expect(trigger).toHaveAccessibleName("Contraer menú");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger.querySelector("svg")).toHaveClass("lucide-panel-left-close");
});

it("mantiene búsqueda y campana operativas con el menú contraído y admite el atajo de teclado", async () => {
  login();
  show();
  const trigger = screen.getByRole("button", { name: "Contraer menú" });
  trigger.focus();
  expect(trigger).toHaveFocus();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(trigger).toHaveAccessibleName("Expandir menú");
  const input = screen.getByRole("combobox", { name: "Buscar paciente o documento" });
  fireEvent.change(input, { target: { value: "María" } });
  expect(await screen.findByRole("option", { name: /María Pérez/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));
  expect(await screen.findByText("Notificaciones no disponibles por ahora.")).toBeInTheDocument();
});

it("en móvil abre el panel superpuesto desde el header y permite cerrarlo con Escape", async () => {
  window.innerWidth = 375;
  login();
  show();
  const trigger = within(screen.getByRole("banner")).getByRole("button", { name: "Expandir menú" });
  expect(document.querySelectorAll('[data-sidebar="trigger"]')).toHaveLength(1);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  expect(trigger).toHaveAccessibleName("Contraer menú");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveAccessibleName("Expandir menú"));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("busca con demora y límite SQL, por nombre o documento y navega con teclado", async () => {
  login();
  show();
  const input = screen.getByRole("combobox", { name: "Buscar paciente o documento" });
  fireEvent.change(input, { target: { value: "M" } });
  expect(buscarPacientesPaginado).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "María" } });
  expect(buscarPacientesPaginado).not.toHaveBeenCalled();
  await waitFor(() => expect(buscarPacientesPaginado).toHaveBeenCalledWith("María", { page: 1, perPage: 5 }));
  expect(await screen.findByRole("option", { name: /María Pérez/ })).toHaveTextContent("DNI 00001234");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /María Pérez/ })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("path")).toHaveTextContent("/pacientes/7");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "00001234" } });
  await waitFor(() => expect(buscarPacientesPaginado).toHaveBeenCalledWith("00001234", { page: 1, perPage: 5 }));
});

it("descarta respuestas atrasadas al cambiar la consulta", async () => {
  login();
  let resolveOld!: (value: ReturnType<typeof found>) => void;
  vi.mocked(buscarPacientesPaginado).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(found([{ ...patient, id: 8, nombres: "Lucía" }]));
  show();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "María" } });
  await waitFor(() => expect(buscarPacientesPaginado).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "Lucía" } });
  await waitFor(() => expect(screen.getByRole("option", { name: /Lucía Pérez/ })).toBeInTheDocument());
  await act(async () => resolveOld(found()));
  expect(screen.queryByRole("option", { name: /María Pérez/ })).not.toBeInTheDocument();
});

it("muestra estado vacío o error, cierra con Escape y clic exterior", async () => {
  login();
  vi.mocked(buscarPacientesPaginado).mockResolvedValueOnce(found([]))
    .mockRejectedValueOnce({ response: { status: 500 } });
  show();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "Nada" } });
  expect(await screen.findByText("No se encontraron pacientes.")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByText("No se encontraron pacientes.")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "Otro" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo completar");
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("cierra resultados al pulsar fuera y permite seleccionar con clic sin retener la consulta", async () => {
  login();
  show();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "Pérez" } });
  expect(await screen.findByRole("option", { name: /María Pérez/ })).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.focus(input);
  fireEvent.click(screen.getByRole("option", { name: /María Pérez/ }));
  expect(screen.getByTestId("path")).toHaveTextContent("/pacientes/7");
  expect(input).toHaveValue("");
});

it("no busca ni muestra datos a admin sin permiso y oculta búsqueda cuando B1 deniega rol combinado", async () => {
  login(["Administrador del sistema"], ["configuracion.ver", "pacientes.ver"]);
  const view = show();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(buscarPacientesPaginado).not.toHaveBeenCalled();
  view.unmount();
  login(["Administrador del sistema", "Oftalmologo"], ["configuracion.ver", "pacientes.ver"]);
  vi.mocked(buscarPacientesPaginado).mockRejectedValueOnce({ response: { status: 403 } });
  show();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "María" } });
  await waitFor(() => expect(useAuthStore.getState().deniedModules).toContain("patients"));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it.each(["Enfermero", "Asistente administrativo"])("permite búsqueda identificativa con alcance autorizado de %s", async (role) => {
  login([role], ["pacientes.ver"]);
  show();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "00001234" } });
  expect(await screen.findByRole("option", { name: /María Pérez/ })).toHaveTextContent("DNI 00001234");
  expect(buscarPacientesPaginado).toHaveBeenCalledWith("00001234", { page: 1, perPage: 5 });
  expect(screen.queryByText(/diagnóstico|retinopatía/i)).not.toBeInTheDocument();
});

it("en móvil abre búsqueda sin sustituir la campana; notificaciones no simula alertas", async () => {
  login();
  show();
  fireEvent.click(screen.getByRole("button", { name: "Abrir búsqueda de pacientes" }));
  expect(screen.getByRole("button", { name: "Cerrar búsqueda de pacientes" })).toHaveClass("sm:hidden");
  expect(screen.getByRole("button", { name: "Cerrar búsqueda de pacientes" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("combobox")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar búsqueda de pacientes" }));
  fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));
  expect(await screen.findByText("Notificaciones no disponibles por ahora.")).toBeInTheDocument();
  expect(screen.queryByText(/No hay notificaciones/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+ notificaciones/)).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("Notificaciones no disponibles por ahora.")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));
  expect(screen.getByText("Notificaciones no disponibles por ahora.")).toBeInTheDocument();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByText("Notificaciones no disponibles por ahora.")).not.toBeInTheDocument());
});
