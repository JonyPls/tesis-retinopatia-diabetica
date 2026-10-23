// Reglas de formato reutilizables; cada formulario decide obligatoriedad y longitud.
const LATIN_LETTER = "(?:(?=\\p{L})\\p{Script=Latin})";
const LATIN_NAME = new RegExp(`^${LATIN_LETTER}+(?: ${LATIN_LETTER}+| ?[-'’] ?${LATIN_LETTER}+)*$`, "u");
const LATIN_NAME_CHARACTER = new RegExp(`^${LATIN_LETTER}$`, "u");
const EMAIL_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const EMAIL_LOCAL = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u;

export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFC");
}

// Admite separadores mientras se escribe; la estructura completa se comprueba al salir/enviar.
export function filterPersonNameInput(value: string): string {
  return [...value.normalize("NFC")].filter((char) => LATIN_NAME_CHARACTER.test(char) ||
    char === " " || char === "-" || char === "'" || char === "’").join("");
}

export function isValidPersonName(value: string): boolean {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return false;
  return LATIN_NAME.test(normalizePersonName(value));
}

export function isValidEmailAddress(value: string): boolean {
  const email = value.trim();
  if (/[\s\p{Cc}\p{Cf}]/u.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!EMAIL_LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => EMAIL_LABEL.test(label)) &&
    /^\p{L}{2,}$/u.test(labels[labels.length - 1]);
}
