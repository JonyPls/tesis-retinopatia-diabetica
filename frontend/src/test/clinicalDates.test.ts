import { afterEach, describe, expect, it } from "vitest";
import {
  civilAge, clinicalDayKey, clinicalTimestamp, compareClinicalDesc, compareVisitGroups, formatCivilDay,
  formatClinicalDay, formatClinicalInstant, unknownClinicalDate,
} from "../lib/clinicalDates";

const originalZone = process.env.TZ;
afterEach(() => { process.env.TZ = originalZone; });

describe("instantes verificados y fechas civiles", () => {
  it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles"])(
    "presenta siempre America/Lima con navegador en %s", (zone) => {
      process.env.TZ = zone;
      expect(formatClinicalInstant("2030-01-02T00:30:00Z")).toContain("01/01/2030");
      expect(formatClinicalInstant("2030-01-01T19:30:00-05:00"))
        .toBe(formatClinicalInstant("2030-01-02T00:30:00Z"));
      expect(clinicalDayKey("2030-01-02T00:30:00Z")).toBe("2030-01-01");
      expect(formatClinicalDay("2030-01-02T00:30:00Z")).toBe("01/01/2030");
      expect(formatCivilDay("2000-01-01")).toBe("01/01/2000");
      expect(civilAge("2000-01-01", new Date("2030-01-01T04:30:00Z"))).toBe(29);
    },
  );

  it("no inventa zona de fechas naive ni confía en GMT HTTP legado", () => {
    for (const value of ["2030-01-02T00:30:00", "Wed, 02 Jan 2030 00:30:00 GMT", "2000-01-01"])
      expect(formatClinicalInstant(value)).toBe(unknownClinicalDate);
    expect(clinicalTimestamp("2030-01-02T00:30:00")).toBeNull();
    expect(formatClinicalInstant("2030-01-02T00:30:00Z", "NO_VERIFICADO"))
      .toBe(unknownClinicalDate);
    expect(compareClinicalDesc("2030-01-02T00:30:00", "2030-01-01T00:30:00Z")).toBe(0);
    expect(formatCivilDay("2000-02-30")).toBe("Fecha no registrada");
  });

  it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles"])(
    "agrupa fechas acreditadas antes que ambiguas con orden operativo estable en %s", (zone) => {
      process.env.TZ = zone;
      const mixed = [
        { visita_id: 90, fecha_visita: "2099-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO" as const },
        { visita_id: 8, fecha_visita: "2030-01-01T00:00:00Z", fecha_visita_origen: "UTC_VERIFICADO" as const },
        { visita_id: 91, fecha_visita: "1900-01-01T00:00:00", fecha_visita_origen: "NO_VERIFICADO" as const },
        { visita_id: 7, fecha_visita: "2030-01-02T00:00:00Z", fecha_visita_origen: "UTC_VERIFICADO" as const },
      ];
      expect(mixed.sort(compareVisitGroups).map((v) => v.visita_id)).toEqual([7, 8, 91, 90]);
      expect(mixed.sort((a, b) => compareVisitGroups(a, b, true)).map((v) => v.visita_id))
        .toEqual([8, 7, 91, 90]);
      expect(compareVisitGroups(
        { visita_id: 100, fecha_visita: "2030-01-03T00:00:00Z" },
        { visita_id: 8, fecha_visita: "2030-01-01T00:00:00Z", fecha_visita_origen: "UTC_VERIFICADO" },
      )).toBeGreaterThan(0);
      expect(formatClinicalInstant("2030-01-02T00:00:00Z", "NO_VERIFICADO"))
        .toBe(unknownClinicalDate);
    },
  );
});
