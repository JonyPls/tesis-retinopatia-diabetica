// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { useAuthStore } from "../features/auth/store/authStore";
import { usePatients } from "../features/patients/hooks/usePatients";
import { CreatePatientDialog } from "../features/patients/components/CreatePatientDialog";
import { localCivilDate } from "../features/patients/birthDate";
import { PatientInfoCard } from "../features/patients/components/PatientInfoCard";
import type { Patient } from "../features/patients/types";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const post = vi.mocked(api.post);
let patientHook: ReturnType<typeof usePatients>;
const onCreated = vi.fn();

function Registration({ fromDiagnosis = false }: { fromDiagnosis?: boolean }) {
  const hook = usePatients({ autoFetch: false, onCreated });
  patientHook = hook;
  return <CreatePatientDialog
    open={hook.open} onOpenChange={hook.setOpen} formData={hook.formData}
    isSubmitting={hook.isSubmitting} consent={hook.consent}
    onConsentChange={hook.handleConsentChange} validationErrors={hook.validationErrors}
    validationFocus={hook.validationFocus} onNameBlur={hook.handleNameBlur}
    onDocumentChange={(value) => hook.handleDocumentChange(value, hook.formData.tipo_doc)}
    onPhoneChange={hook.handlePhoneChange} onFieldChange={hook.handleChange}
    onTipoDocChange={hook.handleDocumentTypeChange} onSubmit={hook.handleSubmit}
    hasUnsavedChanges={hook.hasPatientFormChanges} onDiscard={hook.resetPatientForm}
    registrationScope={hook.registrationScope}
    triggerLabel={fromDiagnosis ? "Nuevo paciente" : "Nuevo Paciente"}
  />;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  useAuthStore.getState().login("synthetic-only", {
    id: 1, username: "medico-ficticio", nombres: "Médico", apellidos: "Prueba", roles: ["Oftalmologo"],
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

function open(fromDiagnosis = false) {
  render(<Registration fromDiagnosis={fromDiagnosis} />);
  fireEvent.click(screen.getByRole("button", { name: fromDiagnosis ? "Nuevo paciente" : "Nuevo Paciente" }));
}

describe("Modal de registro simplificado", () => {
  it("abre, muestra tres grupos visuales y permite cerrar sin cambios", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Registrar Nuevo Paciente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Identificación" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contacto" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Información clínica y consentimiento" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Consentimiento Informado Físico Archivado/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dirección/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Número de documento/)).toHaveAttribute("required");
    expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveAttribute("required");
    expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveAttribute("min", "1900-01-01");
    expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveAttribute("max", localCivilDate());
    expect(screen.getByText(/Obligatorio/)).toBeInTheDocument();
    expect(screen.queryByText("(opcional)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Registrar Nuevo Paciente" })).not.toBeInTheDocument();
  });

  it("adapta fondo, superficies y acentos de la referencia sin volver los campos de solo lectura", () => {
    open();
    const form = document.getElementById("patient-form")!;
    expect(form.parentElement).toHaveClass("bg-muted/65", "overflow-y-auto");
    const sections = Array.from(form.children) as HTMLElement[];
    expect(sections).toHaveLength(3);
    sections.forEach((section) => {
      expect(section).toHaveClass("rounded-xl", "border", "bg-card", "p-4");
      expect(section.querySelector(".bg-primary.h-5.w-1")).toBeInTheDocument();
    });
    const identification = sections[0].querySelector(".grid")!;
    expect(identification).toHaveClass("grid-cols-1", "sm:grid-cols-12", "gap-y-3");
    expect(Array.from(identification.children).map((field) => field.querySelector("label")?.getAttribute("for")))
      .toEqual(["tipo_doc", "nro_documento", "nombres", "apellidos", "sexo", "fecha_nacimiento"]);
    const contact = sections[1].querySelector(".grid")!;
    expect(contact).toHaveClass("grid-cols-1", "sm:grid-cols-2");
    expect(contact.lastElementChild).toHaveClass("sm:col-span-2");
    expect(sections[2]).toContainElement(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    expect(form.parentElement?.nextElementSibling).toHaveClass("shrink-0");
    expect(screen.getByLabelText(/Nombres/)).not.toHaveAttribute("readonly");
  });

  it("muestra error junto al campo, lo enfoca y conserva datos para corregir", async () => {
    open();
    fireEvent.change(screen.getByLabelText(/Número de documento/), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("El DNI debe tener exactamente 8 dígitos.")).toBeInTheDocument();
    expect(screen.getByText("Debe ingresar nombres.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Número de documento/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Número de documento/)).toHaveValue("123");
    expect(screen.getByLabelText(/Número de documento/)).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Número de documento/), { target: { value: "12345678" } });
    expect(screen.queryByText("El DNI debe tener exactamente 8 dígitos.")).not.toBeInTheDocument();
  });

  it("impide enviar nombres inválidos y correo con dominio incorrecto sin perder lo escrito", async () => {
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "Ana3", apellidos: "O'Connor", sexo: "Femenino",
      fecha_nacimiento: "2000-01-01", correo: "a@b..com",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("Ingresa un nombre válido, sin números ni símbolos.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Nombres/), { target: { value: "Ana María" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo/)).toHaveValue("a@b..com");
    expect(post).not.toHaveBeenCalled();
  });

  it("filtra escritura y pegado conservando selección y composición de texto", () => {
    open();
    const name = screen.getByLabelText(/Nombres/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "María O'Connor-Ñuñez" } });
    expect(name).toHaveValue("María O'Connor-Ñuñez");
    name.focus();
    name.setSelectionRange(3, 3);
    fireEvent.change(name, { target: { value: "Mar5ía O'Connor-Ñuñez", selectionStart: 4, selectionEnd: 4 } });
    expect(name).toHaveValue("María O'Connor-Ñuñez");
    expect(name.selectionStart).toBe(3);
    fireEvent.change(name, { target: { value: "María 3💡 López@", selectionStart: 16, selectionEnd: 16 } });
    expect(name).toHaveValue("María  López");
    fireEvent.compositionStart(name);
    fireEvent.change(name, { target: { value: "Mari\u0301a" } });
    fireEvent.compositionEnd(name, { data: "í" });
    expect(name).toHaveValue("María");
    const surname = screen.getByLabelText(/Apellidos/) as HTMLInputElement;
    fireEvent.change(surname, { target: { value: "García9-Ló@pez" } });
    expect(surname).toHaveValue("García-López");
    fireEvent.change(name, { target: { value: "Ana--" } });
    fireEvent.blur(name);
    expect(screen.getByText("Ingresa un nombre válido, sin números ni símbolos.")).toBeInTheDocument();
  });

  it("valida todos los campos a la vez y los corrige de forma independiente", async () => {
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "Ana-", apellidos: "José--López",
      sexo: "Femenino", fecha_nacimiento: "2099-01-01", correo: "sin-arroba",
    })));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("Ingresa un nombre válido, sin números ni símbolos.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa un apellido válido, sin números ni símbolos.")).toBeInTheDocument();
    expect(screen.getByText("La fecha de nacimiento no puede ser futura.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombres/)).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Nombres/), { target: { value: "Ana María" } });
    expect(screen.queryByText("Ingresa un nombre válido, sin números ni símbolos.")).not.toBeInTheDocument();
    expect(screen.getByText("Ingresa un apellido válido, sin números ni símbolos.")).toBeInTheDocument();
    expect(screen.getByText("La fecha de nacimiento no puede ser futura.")).toBeInTheDocument();
  });

  it.each([300, 140])("desplaza solo el cuerpo hasta el consentimiento sin mover el footer (alto %i)", (height) => {
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "Ana", apellidos: "López",
      sexo: "Femenino", fecha_nacimiento: "2000-01-01",
      antecedentes_clinicos: "Antecedentes extensos ".repeat(30),
    })));
    const form = document.getElementById("patient-form")!;
    const body = form.parentElement!;
    const dialog = screen.getByRole("dialog", { name: "Registrar Nuevo Paciente" });
    const footer = body.nextElementSibling!;
    const checkbox = screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ });
    const card = checkbox.closest("[data-consent-card]")!;
    const scroll = vi.fn();
    body.scrollTo = scroll;
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: height },
      scrollHeight: { configurable: true, get: () => document.getElementById("consent-error") ? 1100 : 900 },
    });
    body.scrollTop = 900 - height; // el usuario llegó al final antes de aparecer el error
    const initialScroll = body.scrollTop;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 100 + height, height,
    } as DOMRect);
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      top: 120 + height, bottom: 200 + height, height: 80,
    } as DOMRect);
    const focus = vi.spyOn(checkbox, "focus");

    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(screen.getByText("Debe confirmar el archivo físico del consentimiento informado.")).toBeInTheDocument();
    expect(checkbox).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0].top).toBeGreaterThan(initialScroll);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(dialog.scrollTop).toBe(0);
    expect(form.parentElement).toHaveClass("overflow-y-auto", "min-h-0", "flex-1");
    expect(footer).toHaveClass("shrink-0");
    expect(footer).toContainElement(screen.getByRole("button", { name: "Cancelar" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(card);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(scroll).toHaveBeenCalledTimes(1); // corregir no debe volver a desplazar
  });

  it("con errores múltiples enfoca el primero y respeta movimiento reducido", () => {
    open();
    const form = document.getElementById("patient-form")!;
    const body = form.parentElement!;
    const scroll = vi.fn();
    body.scrollTo = scroll;
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 220 },
      scrollHeight: { configurable: true, value: 800 },
    });
    body.scrollTop = 500;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 320, height: 220,
    } as DOMRect);
    const documentField = screen.getByLabelText(/Número de documento/);
    vi.spyOn(documentField.parentElement!, "getBoundingClientRect").mockReturnValue({
      top: -160, bottom: -90, height: 70,
    } as DOMRect);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(documentField).toHaveFocus();
    expect(screen.getByText("Debe ingresar nombres.")).toBeInTheDocument();
    expect(screen.getByText("Debe confirmar el archivo físico del consentimiento informado.")).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "auto" });
    expect(scroll.mock.calls[0][0].top).toBeLessThan(500);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("presenta varios errores del servidor y mantiene los datos", async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { errors: {
      nro_documento: "El documento ya se encuentra registrado en el sistema.",
      correo: "El correo ya se encuentra registrado en el sistema.",
    } } } });
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "00000001", nombres: "Ana", apellidos: "García", sexo: "Femenino",
      fecha_nacimiento: "2000-01-01", correo: "  ANA@CLINICA.COM  ",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("El documento ya se encuentra registrado en el sistema.")).toBeInTheDocument();
    expect(screen.getByText("El correo ya se encuentra registrado en el sistema.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Número de documento/)).toHaveValue("00000001");
    expect(patientHook.formData.correo).toBe("  ANA@CLINICA.COM  ");
    expect(screen.getByLabelText(/Número de documento/)).toHaveFocus();
    fireEvent.change(screen.getByLabelText(/Correo/), { target: { value: "otro@clinica.com" } });
    expect(screen.queryByText("El correo ya se encuentra registrado en el sistema.")).not.toBeInTheDocument();
    expect(screen.getByText("El documento ya se encuentra registrado en el sistema.")).toBeInTheDocument();
  });

  it("mantiene los rechazos 403 como autorización y no como error de campo", async () => {
    post.mockRejectedValueOnce({ response: { status: 403, data: { message: "No autorizado" } } });
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "00000001", nombres: "Ana", apellidos: "García", sexo: "Femenino",
      fecha_nacimiento: "2000-01-01",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/Número de documento/)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Correo/)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "Registrar Nuevo Paciente" })).toBeInTheDocument();
  });

  it("asocia simultáneamente errores 400 estructurados a sus campos", async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { errors: {
      nombres: "Corrige los nombres.", fecha_nacimiento: "Verifica la fecha de nacimiento ingresada.",
    } } } });
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "00000001", nombres: "Ana", apellidos: "García", sexo: "Femenino",
      fecha_nacimiento: "2000-01-01",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(await screen.findByText("Corrige los nombres.")).toBeInTheDocument();
    expect(screen.getByText("Verifica la fecha de nacimiento ingresada.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombres/)).toHaveFocus();
    expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveValue("2000-01-01");
  });

  it("distingue al recién nacido de una edad desconocida en la ficha", () => {
    const patient = { id: 100, nombres: "Bebé", apellidos: "Prueba", sexo: "Femenino",
      tipo_doc: "DNI", nro_documento: "00000001", fecha_nacimiento: localCivilDate() } as Patient;
    const props = { patient, scope: "administrative" as const, getInitials: () => "BP" };
    const { rerender } = render(<PatientInfoCard {...props} calculateAge={() => 0} />);
    expect(screen.getByText("Menor de 1 año")).toBeInTheDocument();
    rerender(<PatientInfoCard {...props} calculateAge={() => null} />);
    expect(screen.queryByText("Menor de 1 año")).not.toBeInTheDocument();
    expect(screen.getAllByText("No registrado").length).toBeGreaterThan(0);
  });

  it("checkbox, texto, espacio libre y teclado cambian el consentimiento una sola vez", () => {
    open();
    const checkbox = screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ });
    const card = checkbox.closest("div.cursor-pointer")!;
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(card).toHaveClass("bg-primary/[0.09]");
    fireEvent.click(screen.getByText("Consentimiento Informado Físico Archivado"));
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    fireEvent.click(card);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText("Confirme que el documento firmado está archivado."));
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    const link = document.createElement("a");
    link.href = "#informacion";
    link.textContent = "Más información";
    card.append(link);
    fireEvent.click(link);
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: " ", code: "Space" });
    fireEvent.click(checkbox); // Click nativo que genera el navegador tras pulsar Espacio.
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(checkbox).toHaveFocus();
  });

  it("confirma antes de descartar y mantiene el formulario al seguir editando", async () => {
    open();
    fireEvent.change(screen.getByLabelText(/Nombres/), { target: { value: "Paciente" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByText("Descartar registro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByLabelText(/Nombres/)).toHaveValue("Paciente");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(patientHook.formData.nombres).toBe("");
  });

  it("registra desde el disparador de Diagnóstico IA sin cambiar el contrato", async () => {
    post.mockResolvedValueOnce({ data: { data: { id: 77, tipo_doc_abrev: "DNI" } } });
    open(true);
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "Paciente", apellidos: "Prueba",
      sexo: "Femenino", fecha_nacimiento: "2000-01-01", alergias: "Ninguna",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/pacientes", expect.objectContaining({
      nro_documento: "90000001", consentimiento_informado: true, alergias: "Ninguna", correo: null,
    }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 77, nombres: "Paciente" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Registrar Nuevo Paciente" })).not.toBeInTheDocument());
  });

  it("registra desde Pacientes con correo opcional y conserva el bloqueo durante el envío", async () => {
    let finishRequest!: (value: { data: { data: { id: number; tipo_doc_abrev: string } } }) => void;
    post.mockImplementationOnce(() => new Promise((resolve) => { finishRequest = resolve; }));
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "María José", apellidos: "García-López",
      sexo: "Femenino", fecha_nacimiento: "2000-02-29", correo: "  maria@clinica.com.pe  ",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/pacientes", expect.objectContaining({
      nombres: "María José", apellidos: "García-López", correo: "maria@clinica.com.pe",
    }));
    expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled();
    await act(async () => finishRequest({ data: { data: { id: 78, tipo_doc_abrev: "DNI" } } }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 78 }));
  });

  it("el cuerpo es desplazable y el footer queda fuera del scroll; error del servidor no borra datos", async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { message: "Documento duplicado" } } });
    open();
    act(() => patientHook.setFormData((previous) => ({ ...previous,
      nro_documento: "90000001", nombres: "Paciente", apellidos: "Prueba",
      sexo: "Femenino", fecha_nacimiento: "2000-01-01",
    })));
    fireEvent.click(screen.getByRole("checkbox", { name: /Consentimiento Informado Físico Archivado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar Paciente" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/Nombres/)).toHaveValue("Paciente");
    const form = document.getElementById("patient-form")!;
    const body = form.parentElement!;
    expect(body).toHaveClass("overflow-y-auto");
    expect(body.nextElementSibling).toContainElement(screen.getByRole("button", { name: "Registrar Paciente" }));
    expect(body.nextElementSibling).toHaveClass("shrink-0");
    const identification = form.querySelector(".sm\\:grid-cols-12")!;
    expect(identification).toBeInTheDocument();
    expect(identification.children).toHaveLength(6);
    expect(Array.from(identification.children).map((field) => field.className))
      .toEqual([expect.stringContaining("sm:col-span-4"), expect.stringContaining("sm:col-span-8"),
        ...Array(4).fill(expect.stringContaining("sm:col-span-6"))]);
    expect(screen.getByLabelText(/Número de documento/)).toHaveClass("h-10", "sm:h-[38px]");
    expect(form).toHaveClass("space-y-3");
  });
});
