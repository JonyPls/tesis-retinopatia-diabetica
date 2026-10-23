// Reglas documentales compartidas por Pacientes y el alta de Usuarios.
export const DOC_RULES: Record<string, { pattern: RegExp; message: string; maxLength: number }> = {
  DNI: { pattern: /^\d{8}$/, message: "El DNI debe tener exactamente 8 dígitos.", maxLength: 8 },
  CE: { pattern: /^[A-Z0-9]{8,12}$/, message: "El CE debe tener entre 8 y 12 caracteres alfanuméricos.", maxLength: 12 },
  PAS: { pattern: /^[A-Z0-9]{3,9}$/, message: "El Pasaporte debe tener entre 3 y 9 caracteres alfanuméricos.", maxLength: 9 },
};

export function normalizeDocument(value: string, code: string): string {
  return code === "DNI" ? value.replace(/\D/g, "") : value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function documentError(value: string, code: string): string | undefined {
  const rule = DOC_RULES[code];
  return rule && !rule.pattern.test(value) ? rule.message : undefined;
}
