import { describe, expect, it } from "vitest";
import { filterPersonNameInput, isValidEmailAddress, isValidPersonName, normalizePersonName } from "../lib/fieldValidation";
import { localCivilDate, validateBirthDate } from "../features/patients/birthDate";
import { civilAge } from "../lib/clinicalDates";

describe("Nombres y apellidos en el registro", () => {
  it.each(["Ana", "María José", "José-Luis", "García-López", "O'Connor", "D’Angelo", "Muñoz", "Çelik"])(
    "acepta %s", (value) => expect(isValidPersonName(value)).toBe(true),
  );
  it.each(["Ana3", "García@", "Ana😊", "   ", "--", "'Ana", "Ana-", "Ana--María", "Ana\nMaría", "Ana\u200BMaría", "AnaⅣ"])(
    "rechaza %s", (value) => expect(isValidPersonName(value)).toBe(false),
  );
  it("normaliza solo espacios y composición de tildes, sin cambiar mayúsculas", () => {
    expect(normalizePersonName("  Mari\u0301a   de   la Cruz  ")).toBe("María de la Cruz");
  });
  it("filtra caracteres inválidos en texto mixto sin quitar separadores mientras se escribe", () => {
    expect(filterPersonNameInput("  Ma1ría 😊 O'Co@nnor-Ñuñez  ")).toBe("  María  O'Connor-Ñuñez  ");
    expect(filterPersonNameInput("Ana - ")).toBe("Ana - ");
    expect(filterPersonNameInput("Mari\u0301a")).toBe("María");
  });
});

describe("Fecha civil y edad máxima preexistente de 120 años", () => {
  const today = new Date("2026-10-15T18:00:00Z");
  it("admite hoy, la edad 120 y cumpleaños aún no cumplidos", () => {
    expect(localCivilDate(today)).toBe("2026-10-15");
    expect(validateBirthDate("2026-10-15", today)).toBeNull();
    expect(validateBirthDate("1906-10-15", today)).toBeNull();
    expect(validateBirthDate("1905-10-16", today)).toBeNull();
    expect(validateBirthDate("1905-10-16", new Date("2026-10-16T18:00:00Z"))).toMatch(/120/);
    expect(civilAge("2026-10-15", new Date("2026-10-15T18:00:00Z"))).toBe(0);
    expect(civilAge(null, new Date("2026-10-15T18:00:00Z"))).toBeNull();
  });
  it("separa el límite calendario de 1900 del límite funcional de edad", () => {
    expect(validateBirthDate("1900-01-01", new Date("2020-12-31T18:00:00Z"))).toBeNull();
    expect(validateBirthDate("1899-12-31", today)).toMatch(/1900/);
    expect(validateBirthDate("1900-01-01", today)).toMatch(/120/);
    expect(validateBirthDate("1905-10-15", today)).toMatch(/120/);
  });
  it("rechaza fecha futura, día inexistente y año no bisiesto; acepta año bisiesto", () => {
    expect(validateBirthDate("2026-10-16", today)).toMatch(/futura/);
    expect(validateBirthDate("2026-02-31", today)).toMatch(/Verifica/);
    expect(validateBirthDate("1900-02-29", today)).toMatch(/Verifica/);
    expect(validateBirthDate("2000-02-29", today)).toBeNull();
    expect(validateBirthDate("2024-02-29", today)).toBeNull();
    expect(validateBirthDate("2025-02-29", today)).toMatch(/Verifica/);
  });
  it("usa la fecha del centro aunque el instante UTC esté en el día siguiente", () => {
    const midnightElsewhere = new Date("2026-10-16T02:00:00Z");
    expect(localCivilDate(midnightElsewhere)).toBe("2026-10-15");
    expect(validateBirthDate("2026-10-16", midnightElsewhere)).toMatch(/futura/);
  });
});

describe("Correo opcional", () => {
  it.each(["ana@example.com", " nombre.apellido+tesis@clinica.com.pe ", "a@xn--bcher-kva.de"])(
    "acepta %s", (value) => expect(isValidEmailAddress(value)).toBe(true),
  );
  it.each(["sin-arroba", "a@dominio", "a@b..com", "a@-dominio.com", "a@dominio.c", "a b@dominio.com", "a@dominio .com", "a😃@dominio.com", "a()@dominio.com"])(
    "rechaza %s", (value) => expect(isValidEmailAddress(value)).toBe(false),
  );
});
