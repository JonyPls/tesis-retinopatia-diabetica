import { describe, expect, it } from "vitest";
import { daysBetweenVisits, orderVisitsChronologically } from "../features/patients/components/visit-detail/visitComparisonUtils";
import type { Diagnosis } from "../features/patients/types";

const visit = (visita_id: number, fecha_visita: string, verified: boolean): Diagnosis => ({
  visita_id, fecha_visita, fecha_visita_origen: verified ? "UTC_VERIFICADO" : "NO_VERIFICADO",
  tiene_informes: 0, tiene_diagnostico_ia: 0,
});

describe("comparación clínica acreditada", () => {
  it("no atribuye orden ni intervalo a fechas ambiguas, aunque terminen en Z", () => {
    const old = visit(1, "2030-01-01T00:00:00Z", false);
    const recent = visit(2, "2030-01-02T00:00:00Z", true);
    expect(daysBetweenVisits(old, recent)).toBeNull();
    expect(daysBetweenVisits({ ...old, fecha_visita_origen: undefined }, recent)).toBeNull();
    expect(() => orderVisitsChronologically(old, recent, [], [])).toThrow();
    expect(daysBetweenVisits(visit(3, "2030-01-01T00:00:00", false), recent)).toBeNull();
  });

  it("ordena y mide únicamente dos instantes acreditados", () => {
    const first = visit(1, "2030-01-01T00:00:00Z", true);
    const second = visit(2, "2030-01-02T00:00:00Z", true);
    expect(orderVisitsChronologically(second, first, [], []).previous.visita_id).toBe(1);
    expect(daysBetweenVisits(first, second)).toBe(1);
  });
});
