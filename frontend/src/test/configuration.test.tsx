// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Configuration from "../features/configuration/pages/Configuration";
import { useAuthStore } from "../features/auth/store/authStore";
import { CatalogFormatError, createUser, editUser, getCatalog, getRolePermissions, getUsers, updatePermissions, updateRoles, updateState } from
  "../features/configuration/api/configurationService";

vi.mock("../features/configuration/api/configurationService", () => ({
  CatalogFormatError: class extends Error {},
  createUser: vi.fn(), editUser: vi.fn(), getCatalog: vi.fn(), getUsers: vi.fn(),
  getRolePermissions: vi.fn(), updatePermissions: vi.fn(), updateRoles: vi.fn(), updateState: vi.fn(),
}));
const catalog = {
  roles: [
    { id: 1, nombre: "Administrador", codigo: "ADMINISTRADOR_SISTEMA", descripcion: null,
      estado: "ACTIVO", permission_ids: [8] },
    { id: 2, nombre: "Especialista", codigo: "OFTALMOLOGO", descripcion: null,
      estado: "ACTIVO", permission_ids: [] },
  ],
  permissions: [
    { id: 8, codigo: "configuracion.ver", nombre: "Ver configuración", descripcion: null, modulo: "Configuración", estado: "ACTIVO" },
    { id: 9, codigo: "usuarios.ver", nombre: "Ver usuarios", descripcion: null, modulo: "Usuarios", estado: "ACTIVO" },
    { id: 10, codigo: "roles.asignar_permisos", nombre: "Asignar permisos", descripcion: null, modulo: "Configuración", estado: "ACTIVO" },
  ],
  document_types: [
    { id: 1, nombre: "Documento Nacional de Identidad", codigo: "DNI" },
    { id: 2, nombre: "Carne de Extranjeria", codigo: "CE" },
    { id: 3, nombre: "Pasaporte", codigo: "PAS" },
  ], positions: [{ id: 2, nombre: "Profesional" }],
};
const user = { id: 4, nombres: "Persona", apellidos: "Ejemplo", username: "persona_ejemplo",
  correo: "persona@example.invalid", tipo_doc_id: 1, nro_documento: "12345678", cargo_id: 2,
  cargo: "Profesional", cmp: null, rne: null, estado: "ACTIVO" as const, role_ids: [1] };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getCatalog).mockResolvedValue({ data: catalog, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  vi.mocked(getRolePermissions).mockImplementation(async (id) => ({ id, nombre: catalog.roles.find((r) => r.id === id)!.nombre,
    permission_ids: catalog.roles.find((r) => r.id === id)!.permission_ids }));
  vi.mocked(updatePermissions).mockResolvedValue({} as never);
  vi.mocked(getUsers).mockResolvedValue([user]);
  vi.mocked(createUser).mockResolvedValue({} as never);
  vi.mocked(updateRoles).mockResolvedValue({} as never);
  vi.mocked(editUser).mockResolvedValue({} as never);
  vi.mocked(updateState).mockResolvedValue({} as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

async function openCreateDialog() {
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
  return within(screen.getByRole("dialog", { name: "Registrar Nuevo Usuario" }));
}

function fillValidUser(dialog: ReturnType<typeof within>, documentType = "1") {
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: documentType } });
  for (const [label, value] of [["Nombres", "María-José"], ["Apellidos", "Peña O'Neil"],
    ["Nombre de usuario", "maria_jose"], ["Correo electrónico", "maria@example.invalid"],
    ["Número de documento", "00001234"], ["Contraseña", "clave-segura-10"],
    ["Confirmar contraseña", "clave-segura-10"]]) {
    fireEvent.change(dialog.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
  }
  fireEvent.change(dialog.getByLabelText(/^Cargo/), { target: { value: "2" } });
  fireEvent.click(dialog.getByRole("checkbox", { name: "Especialista" }));
}

it("presenta carga, usuarios, búsqueda y matriz de permisos sin escritura", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: catalog, permissions_editable: false,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  render(<Configuration />);
  expect(screen.getByText("Cargando configuración...")).toBeInTheDocument();
  expect(await screen.findByText("persona_ejemplo")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar usuarios" }), { target: { value: "desconocido" } });
  expect(screen.getByText("No se encontraron usuarios.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar usuarios" }), { target: { value: "Persona" } });
  expect(screen.getByText("persona_ejemplo")).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Roles y permisos" }), { button: 0 });
  expect(screen.getByText("Ver configuración")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Ver configuración" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
  expect(updatePermissions).not.toHaveBeenCalled();
});

it("guarda solo al confirmar, cancela y vuelve a consultar los permisos persistidos", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<Configuration />);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Roles y permisos" }), { button: 0 });
  await waitFor(() => expect(getRolePermissions).toHaveBeenCalledWith(1));
  const toggle = screen.getByRole("checkbox", { name: "Ver usuarios" });
  fireEvent.click(toggle);
  expect(screen.getByText("Cambios sin guardar.")).toBeInTheDocument();
  expect(updatePermissions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Especialista" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("heading", { name: "Administrador" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  vi.mocked(getRolePermissions).mockResolvedValueOnce({ id: 1, nombre: "Administrador", permission_ids: [8, 9] });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(updatePermissions).toHaveBeenCalledWith(1, [8, 9]));
  expect(await screen.findByText("Permisos actualizados.")).toBeInTheDocument();
  expect(toggle).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Especialista" }));
  expect(screen.getByRole("heading", { name: "Especialista" })).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

it("advierte al cambiar de rol y protege los permisos administrativos esenciales", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
  render(<Configuration />);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Roles y permisos" }), { button: 0 });
  await waitFor(() => expect(getRolePermissions).toHaveBeenCalledWith(1));
  expect(screen.getByRole("checkbox", { name: "Ver configuración" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Asignar permisos" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Ver usuarios" }));
  fireEvent.click(screen.getByRole("button", { name: "Especialista" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(getRolePermissions).toHaveBeenCalledWith(2));
  expect(screen.getByRole("checkbox", { name: "Ver usuarios" })).not.toBeChecked();
  confirm.mockRestore();
});

it("un error al guardar no muestra éxito ni altera el catálogo guardado", async () => {
  vi.mocked(updatePermissions).mockRejectedValueOnce({ response: { status: 409, data: { message: "Conflicto al actualizar." } } });
  render(<Configuration />);
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Roles y permisos" }), { button: 0 });
  await waitFor(() => expect(getRolePermissions).toHaveBeenCalledWith(1));
  fireEvent.click(screen.getByRole("checkbox", { name: "Ver usuarios" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conflicto al actualizar.");
  expect(screen.queryByText("Permisos actualizados.")).not.toBeInTheDocument();
  expect(getRolePermissions).toHaveBeenCalledTimes(1);
});

it("valida el registro, notifica duplicados y solo refresca cuando se guarda", async () => {
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Registrar Nuevo Usuario" })).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText(/^Tipo de documento/), { target: { value: "1" } });
  for (const [label, value] of [["Nombres", "Nueva"], ["Apellidos", "Persona"],
    ["Nombre de usuario", "nueva_persona"], ["Correo electrónico", "nueva@example.invalid"],
    ["Número de documento", "98765432"], ["Contraseña", "synthetic-long-only"],
    ["Confirmar contraseña", "synthetic-long-only"]]) {
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${label}`)), { target: { value } });
  }
  fireEvent.change(within(dialog).getByLabelText(/^Cargo/), { target: { value: "2" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Especialista" }));
  vi.mocked(createUser).mockRejectedValueOnce({ response: { status: 409, data: { message: "Ya existe un usuario con estos datos." } } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Registrar Usuario" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ya existe un usuario");
  expect(getUsers).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Registrar Usuario" }));
  await waitFor(() => expect(screen.getByText("Usuario registrado.")).toBeInTheDocument());
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ role_ids: [2], username: "nueva_persona" }));
  expect(getUsers).toHaveBeenCalledTimes(2);
});

it("agrupa las cuatro secciones, adapta columnas y mantiene el footer fuera del scroll", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: { ...catalog, roles: [...catalog.roles,
    { id: 3, nombre: "Enfermero", codigo: "ENFERMERO", descripcion: null, estado: "ACTIVO", permission_ids: [] },
    { id: 4, nombre: "Asistente administrativo", codigo: "ASISTENTE_ADMINISTRATIVO", descripcion: null,
      estado: "ACTIVO", permission_ids: [] }] }, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  const dialog = await openCreateDialog();
  for (const heading of ["Identificación", "Datos de la cuenta", "Información profesional", "Roles iniciales"]) {
    expect(dialog.getByRole("heading", { name: heading })).toBeInTheDocument();
  }
  const body = document.getElementById("create-user-body")!;
  expect(body).toHaveClass("overflow-y-auto", "min-h-0", "flex-1", "bg-muted/65");
  expect(body.querySelectorAll("section.rounded-xl.border.bg-card")).toHaveLength(4);
  expect(body.querySelectorAll(".sm\\:grid-cols-2")).not.toHaveLength(0);
  expect(body.nextElementSibling).toHaveClass("shrink-0");
  expect(body.nextElementSibling).toContainElement(dialog.getByRole("button", { name: "Cancelar" }));
  expect(body.nextElementSibling).toContainElement(dialog.getByRole("button", { name: "Registrar Usuario" }));
  for (const role of ["Administrador", "Especialista", "Enfermero", "Asistente administrativo"]) {
    expect(dialog.getByRole("checkbox", { name: role })).toBeInTheDocument();
  }
  fireEvent.click(dialog.getByText("Enfermero"));
  expect(dialog.getByRole("checkbox", { name: "Enfermero" })).toBeChecked();
  expect(dialog.getByLabelText(/^Contraseña/)).toHaveAttribute("type", "password");
  expect(dialog.getByLabelText(/^Confirmar contraseña/)).toHaveAttribute("type", "password");
  fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog", { name: "Registrar Nuevo Usuario" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo usuario" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Registrar Nuevo Usuario" })).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Registrar Nuevo Usuario" })).not.toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
});

it("muestra errores simultáneos, enfoca el primero y conserva los demás al corregir un campo", async () => {
  const dialog = await openCreateDialog();
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).not.toHaveBeenCalled();
  expect(dialog.getByLabelText(/^Nombres/)).toHaveFocus();
  expect(dialog.getByText("Debe ingresar nombres.")).toBeInTheDocument();
  expect(dialog.getByText("Debe ingresar apellidos.")).toBeInTheDocument();
  expect(dialog.getByText("Seleccione al menos un rol activo.")).toBeInTheDocument();
  expect(dialog.getByLabelText(/^Correo electrónico/)).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(dialog.getByLabelText(/^Nombres/), { target: { value: "Ángela" } });
  expect(dialog.queryByText("Debe ingresar nombres.")).not.toBeInTheDocument();
  expect(dialog.getByText("Debe ingresar apellidos.")).toBeInTheDocument();
  expect(getUsers).toHaveBeenCalledTimes(1);
});

it("filtra nombres sin perder composición y conserva ceros documentales según el contrato de usuarios", async () => {
  const dialog = await openCreateDialog();
  const name = dialog.getByLabelText(/^Nombres/) as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Lu5cía@ Peña" } });
  expect(name).toHaveValue("Lucía Peña");
  fireEvent.compositionStart(name);
  fireEvent.change(name, { target: { value: "Ña7" } });
  expect(name).toHaveValue("Ña7");
  fireEvent.compositionEnd(name);
  expect(name).toHaveValue("Ña");
  fireEvent.change(dialog.getByLabelText(/^Apellidos/), { target: { value: "O'Neil-Ñúñez7" } });
  expect(dialog.getByLabelText(/^Apellidos/)).toHaveValue("O'Neil-Ñúñez");
  const document = dialog.getByLabelText(/^Número de documento/);
  expect(document).toHaveAttribute("type", "text");
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("1");
  expect(document).toBeEnabled();
  expect(document).toHaveAttribute("placeholder", "8 dígitos");
  fireEvent.change(document, { target: { value: "00001234" } });
  expect(document).toHaveValue("00001234");
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("1");
  fireEvent.change(document, { target: { value: "" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText("El DNI debe tener exactamente 8 dígitos.")).toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
});

it("inicia con DNI válido del catálogo y limita escritura y pegado sin seleccionar el tipo manualmente", async () => {
  const dialog = await openCreateDialog();
  const document = dialog.getByLabelText(/^Número de documento/);
  const type = dialog.getByLabelText(/^Tipo de documento/);
  expect(type).toHaveValue("1");
  expect(within(type).queryByRole("option", { name: "Seleccione" })).not.toBeInTheDocument();
  expect(document).toBeEnabled();
  expect(document).toHaveAttribute("placeholder", "8 dígitos");
  expect(document).toHaveAttribute("maxLength", "8");
  expect(document).toHaveValue("");
  fireEvent.change(document, { target: { value: "12345678901234567890" } });
  expect(document).toHaveValue("12345678");
  fireEvent.change(document, { target: { value: "" } });
  fireEvent.paste(document, { clipboardData: { getData: () => "00-123456789xx" } });
  expect(document).toHaveValue("00123456");
  fireEvent.change(document, { target: { value: "123" } });
  fireEvent.blur(document);
  expect(dialog.getByText("El DNI debe tener exactamente 8 dígitos.")).toBeInTheDocument();
  expect(document).toHaveAttribute("aria-invalid", "true");
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).not.toHaveBeenCalled();
});

it("espera el catálogo asíncrono, usa el ID real de DNI y reinicia número y tipo al reabrir", async () => {
  let resolveCatalog!: (response: Awaited<ReturnType<typeof getCatalog>>) => void;
  vi.mocked(getCatalog).mockReturnValueOnce(new Promise((resolve) => { resolveCatalog = resolve; }));
  render(<Configuration />);
  expect(screen.getByText("Cargando configuración...")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  await act(async () => resolveCatalog({ data: { ...catalog, document_types: [
    { id: 72, nombre: "Carné de extranjería", codigo: "CE" },
    { id: 84, nombre: "Documento Nacional de Identidad", codigo: "DNI" }] },
    permissions_editable: true, capabilities: { read: true, create: true, edit: true, assign_roles: true } }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo usuario" }));
  let dialog = within(screen.getByRole("dialog", { name: "Registrar Nuevo Usuario" }));
  const document = dialog.getByLabelText(/^Número de documento/);
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("84");
  expect(dialog.getByRole("option", { name: "Documento Nacional de Identidad" })).toBeInTheDocument();
  expect(document).toBeEnabled();
  expect(document).toHaveAttribute("placeholder", "8 dígitos");
  fireEvent.change(document, { target: { value: "00001234" } });
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "72" } });
  fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo usuario" }));
  dialog = within(screen.getByRole("dialog", { name: "Registrar Nuevo Usuario" }));
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("84");
  expect(dialog.getByLabelText(/^Número de documento/)).toBeEnabled();
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("");
  expect(createUser).not.toHaveBeenCalled();

  cleanup();
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: { ...catalog, document_types: [
    { id: 73, nombre: "DNI", codigo: "DNI" }] }, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
  dialog = within(screen.getByRole("dialog", { name: "Registrar Nuevo Usuario" }));
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("73");
  expect(dialog.getByLabelText(/^Número de documento/)).toBeEnabled();
  expect(getCatalog).toHaveBeenCalledTimes(2);
  fillValidUser(dialog, "73");
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ tipo_doc_id: 73, nro_documento: "00001234" }));
});

it("sin DNI en catálogo informa el problema y no inventa un tipo ni permite registrar", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: { ...catalog, document_types: [
    { id: 72, nombre: "Carné de extranjería", codigo: "CE" }] }, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  const dialog = await openCreateDialog();
  expect(dialog.getByRole("alert")).toHaveTextContent("El tipo de documento DNI no está disponible");
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("");
  expect(dialog.getByLabelText(/^Tipo de documento/)).toBeDisabled();
  expect(dialog.getByLabelText(/^Número de documento/)).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Registrar Usuario" })).toBeDisabled();
  expect(createUser).not.toHaveBeenCalled();
});

it("si falla la carga del catálogo no abre un alta sin tipo documental", async () => {
  vi.mocked(getCatalog).mockRejectedValueOnce(new Error("Fallo de red"));
  render(<Configuration />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo completar la operación");
  expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
  expect(within(screen.getByRole("dialog")).getByLabelText(/^Tipo de documento/)).toHaveValue("1");
  expect(getCatalog).toHaveBeenCalledTimes(2);
});

it("reproduce la respuesta antigua sin código como error de catálogo, distinto de DNI ausente", async () => {
  vi.mocked(getCatalog).mockRejectedValueOnce(new CatalogFormatError(
    "El catálogo de tipos de documento no está disponible o está desactualizado. Reintente cargar la configuración."));
  render(<Configuration />);
  expect(await screen.findByRole("alert")).toHaveTextContent("está desactualizado");
  expect(screen.queryByText("DNI no disponible")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
  expect(within(screen.getByRole("dialog")).getByLabelText(/^Número de documento/)).toBeEnabled();
  expect(getCatalog).toHaveBeenCalledTimes(2);
});

it("cambia de tipo documental sin borrar el identificador y aplica sus reglas", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: { ...catalog, document_types: [
    { id: 1, nombre: "DNI", codigo: "DNI" }, { id: 3, nombre: "Carné de extranjería", codigo: "CE" }] }, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "3" } });
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("00001234");
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveAttribute("placeholder", "8 a 12 caracteres");
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  await waitFor(() => expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ tipo_doc_id: 3,
    nro_documento: "00001234" })));
});

it("filtra pegados DNI y longitud, exige ocho dígitos y no trunca al cambiar desde CE o PAS", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: { ...catalog, document_types: [
    { id: 84, nombre: "DNI", codigo: "DNI" }, { id: 72, nombre: "CE", codigo: "CE" },
    { id: 93, nombre: "Pasaporte", codigo: "PAS" }] }, permissions_editable: true,
    capabilities: { read: true, create: true, edit: true, assign_roles: true } });
  const dialog = await openCreateDialog();
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("84");
  expect(dialog.getByLabelText(/^Número de documento/)).toBeEnabled();
  fillValidUser(dialog, "84");
  const type = dialog.getByLabelText(/^Tipo de documento/);
  const document = dialog.getByLabelText(/^Número de documento/);
  fireEvent.change(document, { target: { value: "0ab0-0123456789" } });
  expect(document).toHaveValue("00012345");
  expect(document).toHaveAttribute("maxLength", "8");
  fireEvent.change(document, { target: { value: "" } });
  fireEvent.paste(document, { clipboardData: { getData: () => "xx00-001234aa" } });
  expect(document).toHaveValue("00001234");
  fireEvent.change(document, { target: { value: "0000123" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText("El DNI debe tener exactamente 8 dígitos.")).toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
  fireEvent.change(type, { target: { value: "72" } });
  fireEvent.change(document, { target: { value: "ab-0012345678" } });
  expect(document).toHaveValue("AB0012345678");
  expect(document).toHaveAttribute("maxLength", "12");
  expect(dialog.queryByText("El DNI debe tener exactamente 8 dígitos.")).not.toBeInTheDocument();
  fireEvent.change(type, { target: { value: "84" } });
  expect(document).toHaveValue("AB0012345678");
  expect(dialog.getByText("El DNI debe tener exactamente 8 dígitos.")).toBeInTheDocument();
  expect(document).toHaveAttribute("aria-invalid", "true");
  expect(document).toHaveAttribute("placeholder", "8 dígitos");
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).not.toHaveBeenCalled();
  fireEvent.change(type, { target: { value: "93" } });
  expect(document).toHaveValue("AB0012345678");
  expect(dialog.getByText("El Pasaporte debe tener entre 3 y 9 caracteres alfanuméricos.")).toBeInTheDocument();
  expect(document).toHaveAttribute("placeholder", "3 a 9 caracteres");
  fireEvent.change(document, { target: { value: "a-001" } });
  expect(document).toHaveValue("A001");
  expect(document).toHaveAttribute("maxLength", "9");
  expect(dialog.queryByText(/Pasaporte debe/)).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ tipo_doc_id: 93, nro_documento: "A001" }));
});

it("valida correo obligatorio y sintaxis sin espacios internos, permite recortar bordes y detecta duplicado", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  const email = dialog.getByLabelText(/^Correo electrónico/);
  for (const invalid of ["usuario@dominio..com", "usuario@dominio", "usu ario@dominio.com", " "]) {
    fireEvent.change(email, { target: { value: invalid } });
    fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
    expect(dialog.getByText(/correo electrónico válido/)).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  }
  fireEvent.change(email, { target: { value: "persona@example.invalid" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText("El correo ya está registrado.")).toBeInTheDocument();
  fireEvent.change(email, { target: { value: "  nuevo@example.com  " } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ correo: "nuevo@example.com" }));
});

it("mantiene ojos independientes, foco y valores, e indica coincidencia exacta sin anticiparse al vacío", async () => {
  const dialog = await openCreateDialog();
  const password = dialog.getByLabelText(/^Contraseña/) as HTMLInputElement;
  const confirm = dialog.getByLabelText(/^Confirmar contraseña/) as HTMLInputElement;
  expect(password).toHaveAttribute("type", "password");
  expect(confirm).toHaveAttribute("type", "password");
  expect(dialog.queryByText(/Las contraseñas (no )?coinciden/)).not.toBeInTheDocument();
  fireEvent.change(password, { target: { value: "clave-segura-10" } });
  expect(dialog.queryByText(/Las contraseñas (no )?coinciden/)).not.toBeInTheDocument();
  const eyes = dialog.getAllByRole("button", { name: "Mostrar contraseña" });
  expect(eyes).toHaveLength(2);
  expect(eyes[0]).toHaveAttribute("type", "button");
  password.focus();
  fireEvent.mouseDown(eyes[0]);
  fireEvent.click(eyes[0]);
  expect(password).toHaveFocus();
  expect(password).toHaveAttribute("type", "text");
  expect(confirm).toHaveAttribute("type", "password");
  expect(password).toHaveValue("clave-segura-10");
  fireEvent.click(dialog.getByRole("button", { name: "Ocultar contraseña" }));
  expect(password).toHaveAttribute("type", "password");
  fireEvent.click(eyes[1]);
  expect(confirm).toHaveAttribute("type", "text");
  expect(password).toHaveAttribute("type", "password");
  fireEvent.change(confirm, { target: { value: "clave-segura-10 " } });
  const mismatch = dialog.getByText("Las contraseñas no coinciden");
  expect(mismatch.parentElement).toHaveClass("justify-end", "sm:col-span-2", "min-h-4");
  expect(mismatch).toHaveClass("text-right", "text-destructive");
  expect(mismatch.closest("section")).toHaveAttribute("aria-labelledby", "user-account-title");
  fireEvent.change(confirm, { target: { value: "clave-segura-10" } });
  const match = dialog.getByText("Las contraseñas coinciden");
  expect(match.parentElement).toHaveClass("justify-end", "sm:col-span-2", "min-h-4");
  expect(match).toHaveClass("text-right", "text-green-700");
  fireEvent.change(password, { target: { value: "clave-segura-11" } });
  expect(dialog.getByText("Las contraseñas no coinciden")).toBeInTheDocument();
  fireEvent.change(confirm, { target: { value: "" } });
  expect(dialog.queryByText(/Las contraseñas (no )?coinciden/)).not.toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
});

it("filtra CMP/RNE, preserva ceros iniciales, rechaza solo ceros y nunca asigna roles", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  const cmp = dialog.getByLabelText(/^CMP/);
  const rne = dialog.getByLabelText(/^RNE/);
  fireEvent.change(cmp, { target: { value: "0A0-012" } });
  fireEvent.change(rne, { target: { value: "00x987+" } });
  expect(cmp).toHaveValue("00012");
  expect(rne).toHaveValue("00987");
  fireEvent.change(cmp, { target: { value: "0000" } });
  fireEvent.change(rne, { target: { value: "00" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText(/CMP debe contener/)).toBeInTheDocument();
  expect(dialog.getByText(/RNE debe contener/)).toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
  fireEvent.change(cmp, { target: { value: "00012" } });
  fireEvent.change(rne, { target: { value: "00987" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ cmp: "00012", rne: "00987", role_ids: [2] }));
});

it("valida usuario, correo, contraseña, confirmación y CMP/RNE sin exigir los opcionales", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  fireEvent.change(dialog.getByLabelText(/^Nombre de usuario/), { target: { value: "x!" } });
  fireEvent.change(dialog.getByLabelText(/^Correo electrónico/), { target: { value: "bad@domain" } });
  fireEvent.change(dialog.getByLabelText(/^Contraseña/), { target: { value: "corta" } });
  fireEvent.change(dialog.getByLabelText(/^CMP/), { target: { value: "1".repeat(21) } });
  fireEvent.change(dialog.getByLabelText(/^RNE/), { target: { value: "2".repeat(21) } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText(/usuario debe tener de 3 a 50/)).toBeInTheDocument();
  expect(dialog.getByText(/correo electrónico válido/)).toBeInTheDocument();
  expect(dialog.getByText(/entre 10 y 128/)).toBeInTheDocument();
  expect(dialog.getByText("Las contraseñas no coinciden")).toBeInTheDocument();
  expect(dialog.getByText(/CMP debe contener de 1 a 20/)).toBeInTheDocument();
  expect(dialog.getByText(/RNE debe contener de 1 a 20/)).toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
});

it("marca usuario conocido duplicado y conflictos 409 identificables junto al campo; 403 sigue siendo autorización", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  fireEvent.change(dialog.getByLabelText(/^Nombre de usuario/), { target: { value: "persona_ejemplo" } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText("El nombre de usuario ya está registrado.")).toBeInTheDocument();
  expect(createUser).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText(/^Nombre de usuario/), { target: { value: "maria_jose" } });
  vi.mocked(createUser).mockRejectedValueOnce({ response: { status: 409, data: { message: "Correo ya registrado." } } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(await dialog.findByText("El correo ya está registrado.")).toBeInTheDocument();
  expect(dialog.getByLabelText(/^Nombre de usuario/)).toHaveValue("maria_jose");
  fireEvent.change(dialog.getByLabelText(/^Correo electrónico/), { target: { value: "nuevo@example.invalid" } });
  vi.mocked(createUser).mockRejectedValueOnce({ response: { status: 403 } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(await dialog.findByText(/Acceso restringido/)).toBeInTheDocument();
  expect(dialog.queryByText("El correo ya está registrado.")).not.toBeInTheDocument();
  expect(getUsers).toHaveBeenCalledTimes(1);
});

it("muestra errores 400 del servidor junto a su campo y restringe el alta si faltan permisos B1", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  vi.mocked(createUser).mockRejectedValueOnce({ response: { status: 400, data: { message: "nro_documento: valor inválido." } } });
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(await dialog.findByText("nro_documento: valor inválido.")).toBeInTheDocument();
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveAttribute("aria-invalid", "true");
  cleanup();
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: catalog, permissions_editable: false,
    capabilities: { read: true, create: true, edit: true, assign_roles: false } });
  render(<Configuration />);
  expect(await screen.findByText("persona_ejemplo")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  expect(createUser).toHaveBeenCalledTimes(1);
});

it("desplaza solo el cuerpo hasta el primer error bajo el pliegue y deja fijo el footer", async () => {
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  fireEvent.click(dialog.getByRole("checkbox", { name: "Especialista" }));
  const body = document.getElementById("create-user-body")!;
  const roles = document.getElementById("user-role_ids")!;
  const scroll = vi.fn();
  body.scrollTo = scroll;
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: 160 },
    scrollHeight: { configurable: true, value: 900 },
  });
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 260, height: 160 } as DOMRect);
  vi.spyOn(roles, "getBoundingClientRect").mockReturnValue({ top: 450, bottom: 550, height: 100 } as DOMRect);
  const focus = vi.spyOn(roles, "focus");
  const intoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = intoView;
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByText("Seleccione al menos un rol activo.")).toBeInTheDocument();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(scroll).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "smooth" });
  expect(intoView).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").scrollTop).toBe(0);
  expect(body.nextElementSibling).toHaveClass("shrink-0");
  expect(createUser).not.toHaveBeenCalled();
});

it("bloquea el envío doble mientras espera el POST y completa el alta sintética", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(createUser).mockReturnValueOnce(new Promise((done) => { resolve = done; }) as never);
  const dialog = await openCreateDialog();
  fillValidUser(dialog);
  fireEvent.click(dialog.getByRole("button", { name: "Registrar Usuario" }));
  expect(dialog.getByRole("button", { name: "Registrando..." })).toBeDisabled();
  expect(createUser).toHaveBeenCalledTimes(1);
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ nro_documento: "00001234", cmp: null, rne: null,
    role_ids: [2], nombres: "María-José" }));
  await act(async () => resolve({}));
  expect(await screen.findByText("Usuario registrado.")).toBeInTheDocument();
  expect(getUsers).toHaveBeenCalledTimes(2);
});

it("gestiona roles con guardar/cancelar, edita usuario y cambia estado", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar roles" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Especialista" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(updateRoles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Gestionar roles" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Especialista" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar roles" }));
  await waitFor(() => expect(updateRoles).toHaveBeenCalledWith(4, [1, 2]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Editar" }));
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/^Nombres/), { target: { value: "Editada" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(editUser).toHaveBeenCalledWith(4, expect.objectContaining({ nombres: "Editada" })));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
  await waitFor(() => expect(updateState).toHaveBeenCalledWith(4, "INACTIVO"));
  confirm.mockRestore();
});

it("un cambio de roles fallido mantiene el modal abierto y no recarga usuarios", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(updateRoles).mockRejectedValueOnce({ response: { status: 409, data: { message: "Debe permanecer una cuenta administradora activa." } } });
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar roles" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Especialista" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar roles" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Debe permanecer");
  expect(getUsers).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  confirm.mockRestore();
});

it("edición muestra tres secciones, datos previos, scroll interno y footer estable sin contraseña ni roles", async () => {
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const modal = screen.getByRole("dialog", { name: "Editar usuario" });
  const dialog = within(modal);
  for (const heading of ["Identificación", "Datos de la cuenta", "Información profesional"]) {
    expect(dialog.getByRole("heading", { name: heading })).toBeInTheDocument();
  }
  expect(dialog.getByLabelText(/^Nombres/)).toHaveValue("Persona");
  expect(dialog.getByLabelText(/^Apellidos/)).toHaveValue("Ejemplo");
  expect(dialog.getByLabelText(/^Tipo de documento/)).toHaveValue("1");
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("12345678");
  expect(dialog.getByLabelText(/^Correo electrónico/)).toHaveValue("persona@example.invalid");
  expect(dialog.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(modal.querySelector("#edit-user-body")).toHaveClass("overflow-y-auto", "min-h-0");
  expect(modal.querySelector("#edit-user-body")?.contains(dialog.getByRole("button", { name: "Guardar cambios" }))).toBe(false);
  fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("editar valida varios campos a la vez, enfoca el primero, filtra nombres y conserva el documento incompatible", async () => {
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/^Nombres/), { target: { value: "123@@" } });
  expect(dialog.getByLabelText(/^Nombres/)).not.toHaveValue("123@@");
  fireEvent.change(dialog.getByLabelText(/^Nombres/), { target: { value: " " } });
  fireEvent.change(dialog.getByLabelText(/^Apellidos/), { target: { value: " " } });
  fireEvent.change(dialog.getByLabelText(/^Correo electrónico/), { target: { value: "invalido" } });
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "3" } });
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("12345678");
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "1" } });
  fireEvent.change(dialog.getByLabelText(/^Número de documento/), { target: { value: "00001234" } });
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("00001234");
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "2" } });
  fireEvent.change(dialog.getByLabelText(/^Número de documento/), { target: { value: "ABCDEFGHIJKL" } });
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "1" } });
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveValue("ABCDEFGHIJKL");
  expect(dialog.getByLabelText(/^Número de documento/)).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(dialog.getByLabelText(/^CMP \(opcional\)/), { target: { value: "000" } });
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  expect(dialog.getByLabelText(/^Nombres/)).toHaveFocus();
  expect(dialog.getAllByRole("alert").length).toBeGreaterThanOrEqual(5);
  expect(editUser).not.toHaveBeenCalled();
});

it("editar conserva valores y muestra duplicados al recibir 409; corrige y guarda solo con datos válidos", async () => {
  const other = { ...user, id: 5, username: "existente", correo: "otro@example.invalid", cmp: "12345" };
  vi.mocked(getUsers).mockResolvedValue([user, other]);
  vi.mocked(editUser).mockRejectedValueOnce({ response: { status: 409, data: { message: "Ya existe un usuario con estos datos." } } });
  render(<Configuration />);
  fireEvent.click(await screen.findAllByRole("button", { name: "Editar" }).then((buttons) => buttons[0]));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText(/^Nombres/), { target: { value: "María" } });
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("Ya existe");
  expect(dialog.getByLabelText(/^Nombres/)).toHaveValue("María");
  fireEvent.change(dialog.getByLabelText(/^Correo electrónico/), { target: { value: "otro@example.invalid" } });
  fireEvent.change(dialog.getByLabelText(/^CMP \(opcional\)/), { target: { value: "12345" } });
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  expect(dialog.getByText("El correo ya está registrado.")).toBeInTheDocument();
  expect(dialog.getByText("El CMP ya está registrado.")).toBeInTheDocument();
  expect(editUser).toHaveBeenCalledTimes(1);
  fireEvent.change(dialog.getByLabelText(/^Correo electrónico/), { target: { value: "nuevo@example.invalid" } });
  fireEvent.change(dialog.getByLabelText(/^CMP \(opcional\)/), { target: { value: "00001234" } });
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(editUser).toHaveBeenCalledTimes(2));
  expect(editUser).toHaveBeenLastCalledWith(4, expect.objectContaining({ cmp: "00001234", correo: "nuevo@example.invalid" }));
});

it("roles usa tarjetas de dos columnas, confirmación explícita y sólo persiste tras respuesta exitosa", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  let resolveSave!: (value: never) => void;
  vi.mocked(updateRoles).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar roles" }));
  const modal = screen.getByRole("dialog", { name: "Gestionar roles" });
  const dialog = within(modal);
  expect(modal).toHaveClass("sm:max-w-[520px]");
  expect(dialog.getByRole("heading", { name: "Roles asignados" }).parentElement?.nextElementSibling).toHaveClass("sm:grid-cols-2");
  expect(dialog.getByRole("checkbox", { name: "Administrador" })).toBeChecked();
  const card = dialog.getByRole("checkbox", { name: "Especialista" }).closest("label")!;
  fireEvent.click(card);
  expect(dialog.getByRole("checkbox", { name: "Especialista" })).toBeChecked();
  fireEvent.click(dialog.getByRole("button", { name: "Guardar roles" }));
  expect(updateRoles).not.toHaveBeenCalled();
  expect(dialog.getByRole("checkbox", { name: "Especialista" })).toBeChecked();
  fireEvent.click(dialog.getByRole("button", { name: "Guardar roles" }));
  expect(updateRoles).toHaveBeenCalledWith(4, [1, 2]);
  expect(dialog.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  expect(screen.queryByText("Roles actualizados.")).not.toBeInTheDocument();
  resolveSave({} as never);
  await waitFor(() => expect(screen.getByText("Roles actualizados.")).toBeInTheDocument());
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockRestore();
});

it("edición limita DNI al pegar, conserva ceros, valida profesionales y no trunca documentos históricos al cambiar de tipo", async () => {
  vi.mocked(getUsers).mockResolvedValueOnce([{ ...user, tipo_doc_id: 2, nro_documento: "ABCD12345678" }]);
  render(<Configuration />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const dialog = within(screen.getByRole("dialog"));
  const documentInput = dialog.getByLabelText(/^Número de documento/) as HTMLInputElement;
  fireEvent.change(dialog.getByLabelText(/^Tipo de documento/), { target: { value: "1" } });
  expect(documentInput).toHaveValue("ABCD12345678");
  expect(documentInput).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(documentInput, { target: { value: "ABCD1234567" } });
  expect(documentInput).toHaveValue("ABCD1234567");
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  expect(editUser).not.toHaveBeenCalled();
  fireEvent.change(documentInput, { target: { value: "" } });
  fireEvent.paste(documentInput, { clipboardData: { getData: () => "0000123456789" } });
  expect(documentInput).toHaveValue("00001234");
  fireEvent.change(dialog.getByLabelText(/^RNE \(opcional\)/), { target: { value: "abc000" } });
  expect(dialog.getByLabelText(/^RNE \(opcional\)/)).toHaveValue("000");
  fireEvent.click(dialog.getByRole("button", { name: "Guardar cambios" }));
  expect(dialog.getByText(/El RNE debe contener/)).toBeInTheDocument();
  expect(editUser).not.toHaveBeenCalled();
});

it("no expone gestión de roles propios (B1)", async () => {
  useAuthStore.setState({ user: { id: 1, username: "actual", nombres: "Usuario", apellidos: "Actual", roles: [] } });
  vi.mocked(getUsers).mockResolvedValueOnce([{ ...user, id: 1 }]);
  render(<Configuration />);
  await screen.findByText("persona_ejemplo");
  expect(screen.queryByRole("button", { name: "Gestionar roles" })).not.toBeInTheDocument();
  expect(updateRoles).not.toHaveBeenCalled();
});

it("deniega acceso sin pintar controles y distingue un error real de lista vacía", async () => {
  vi.mocked(getCatalog).mockRejectedValueOnce({ response: { status: 403 } });
  const view = render(<Configuration />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Acceso restringido");
  expect(getUsers).not.toHaveBeenCalled();
  view.unmount();
  vi.mocked(getCatalog).mockResolvedValueOnce({ data: catalog, permissions_editable: false,
    capabilities: { read: false, create: false, edit: false, assign_roles: false } });
  render(<Configuration />);
  expect(await screen.findByText("No tiene acceso al listado de usuarios.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
  expect(getUsers).not.toHaveBeenCalled();
});

it("si falla el listado muestra el error y permite reintentar, sin llamarlo lista vacía", async () => {
  vi.mocked(getUsers).mockRejectedValueOnce(new Error("sin conexión"));
  render(<Configuration />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo completar la operación");
  expect(screen.queryByText("No se encontraron usuarios.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("persona_ejemplo")).toBeInTheDocument();
});
