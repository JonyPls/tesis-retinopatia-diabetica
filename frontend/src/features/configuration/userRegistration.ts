import { isValidEmailAddress, isValidPersonName, normalizePersonName } from "@/lib/fieldValidation";
import { DOC_RULES, documentError } from "@/lib/documentValidation";
import type { AdminCatalog, AdminForm, AdminUser } from "./api/configurationService";

export type UserField = keyof AdminForm | "confirm";
export type UserErrors = Partial<Record<UserField, string>>;
export const USER_FIELD_ORDER: UserField[] = ["nombres", "apellidos", "tipo_doc_id", "nro_documento",
  "username", "correo", "password", "confirm", "cargo_id", "cmp", "rne", "role_ids"];

export function knownUserDuplicates(form: AdminForm, users: AdminUser[], excludeId?: number): UserErrors {
  const errors: UserErrors = {};
  const matches = (value: string, field: "username" | "correo" | "cmp" | "rne") =>
    !!value && users.some((user) => user.id !== excludeId &&
      user[field]?.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  if (matches(form.username, "username")) errors.username = "El nombre de usuario ya está registrado.";
  if (matches(form.correo, "correo")) errors.correo = "El correo ya está registrado.";
  if (matches(form.cmp ?? "", "cmp")) errors.cmp = "El CMP ya está registrado.";
  if (matches(form.rne ?? "", "rne")) errors.rne = "El RNE ya está registrado.";
  return errors;
}

export function validateUserDetails(form: AdminForm, catalog: AdminCatalog, users: AdminUser[], excludeId?: number): UserErrors {
  const errors: UserErrors = {};
  for (const field of ["nombres", "apellidos"] as const) {
    const name = normalizePersonName(form[field]);
    const max = field === "nombres" ? 80 : 100;
    if (!name) errors[field] = `Debe ingresar ${field}.`;
    else if (name.length > max || !isValidPersonName(form[field])) {
      errors[field] = `Ingresa ${field} válidos, sin números ni símbolos (máximo ${max} caracteres).`;
    }
  }
  const code = catalog.document_types.find((item) => item.id === form.tipo_doc_id)?.codigo;
  if (!code || !DOC_RULES[code]) {
    errors.tipo_doc_id = "Seleccione un tipo de documento válido.";
  }
  else {
    const message = documentError(form.nro_documento, code);
    if (message) errors.nro_documento = message;
  }
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(form.username.trim())) {
    errors.username = "El usuario debe tener de 3 a 50 letras, números, puntos, guiones o guiones bajos.";
  }
  if (!form.correo.trim() || form.correo.trim().length > 150 || !isValidEmailAddress(form.correo)) {
    errors.correo = "Ingresa un correo electrónico válido (máximo 150 caracteres).";
  }
  if (!catalog.positions.some((item) => item.id === form.cargo_id)) errors.cargo_id = "Seleccione un cargo válido.";
  for (const field of ["cmp", "rne"] as const) {
    const value = form[field]?.trim();
    if (value && (value.length > 20 || !/^[0-9]+$/.test(value) || !/[1-9]/.test(value))) {
      errors[field] = `El ${field.toUpperCase()} debe contener de 1 a 20 dígitos y no puede ser todo ceros.`;
    }
  }
  return { ...errors, ...knownUserDuplicates(form, users, excludeId) };
}

export function validateUserRegistration(form: AdminForm, confirm: string, catalog: AdminCatalog, users: AdminUser[]): UserErrors {
  const errors = validateUserDetails(form, catalog, users);
  if (form.password.trim().length < 10 || form.password.length > 128) {
    errors.password = "La contraseña debe tener entre 10 y 128 caracteres.";
  }
  if (!confirm) errors.confirm = "Confirme la contraseña.";
  else if (form.password !== confirm) errors.confirm = "Las contraseñas no coinciden.";
  const active = catalog.roles.filter((role) => role.estado === "ACTIVO").map((role) => role.id);
  if (!form.role_ids.length || new Set(form.role_ids).size !== form.role_ids.length ||
      form.role_ids.some((id) => !active.includes(id))) {
    errors.role_ids = "Seleccione al menos un rol activo.";
  }
  return errors;
}
