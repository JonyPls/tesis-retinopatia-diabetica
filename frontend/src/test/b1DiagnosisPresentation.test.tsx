// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisitDiagnosisTab } from "../features/patients/components/visit-detail/VisitDiagnosisTab";
import { VisitSummaryTab } from "../features/patients/components/visit-detail/VisitSummaryTab";
import type { Diagnosis, PatientDiagnosisEyeDetail } from "../features/patients/types";

vi.mock("../hooks/useRetinaImage", () => ({
  useRetinaImage: () => ({ src: null, error: null, isLoading: false }),
}));
afterEach(cleanup);

const eye = (id: number, ojo: "Derecho" | "Izquierdo", validation: PatientDiagnosisEyeDetail["estado_validacion"], final: number | null): PatientDiagnosisEyeDetail => ({
  detalle_id: id, ojo_evaluado: ojo, resultado_ia_id: 2, resultado_ia_nombre: "Moderada",
  resultado_final_id: final, resultado_final_nombre: final === 3 ? "Severa" : final === 2 ? "Moderada" : null,
  probabilidad_ia: 0.8, estado_validacion: validation,
});
const visit = (details: PatientDiagnosisEyeDetail[], parent: "PROCESADO" | "VALIDADO" = "PROCESADO"): Diagnosis => ({
  visita_id: 30, fecha_visita: "2026-01-01", tiene_diagnostico_ia: 1, tiene_informes: 0,
  maxima_gravedad: 3, diagnostico_ia: { id: 20, estado: parent, detalles: details },
});

describe("presentación clínica por ojo", () => {
  it("el ojo pendiente nunca convierte la IA en decisión médica", () => {
    render(<VisitDiagnosisTab visit={visit([eye(11, "Derecho", "PENDIENTE", null)])} />);
    expect(screen.getAllByText(/Predicción del modelo IA/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Validación médica pendiente")).toBeTruthy();
    expect(screen.getByText(/La predicción IA no es una decisión clínica/i)).toBeTruthy();
    expect(screen.queryByText("Decisión médica")).toBeNull();
    expect(screen.queryByText("IA y resultado final coinciden")).toBeNull();
  });

  it("distingue predicción coincidente de confirmación clínica", () => {
    render(<VisitDiagnosisTab visit={visit([eye(11, "Derecho", "APROBADO", 2)])} />);
    expect(screen.getByText("Decisión médica")).toBeTruthy();
    expect(screen.getByText("IA y resultado final coinciden")).toBeTruthy();
    expect(screen.getByText("Grado médico")).toBeTruthy();
  });

  it("muestra el grado corregido sin sustituir la predicción, aun con padre PROCESADO y otro ojo pendiente", () => {
    render(<VisitDiagnosisTab visit={visit([
      eye(11, "Derecho", "CORREGIDO", 3), eye(12, "Izquierdo", "PENDIENTE", null),
    ])} />);
    expect(screen.getByText("Predicción corregida por el especialista")).toBeTruthy();
    expect(screen.getByText(/IA: .* · Resultado final: /)).toBeTruthy();
    expect(screen.getAllByText("Pendiente de validación médica").length).toBeGreaterThan(0);
    expect(screen.getByText("Procesado")).toBeTruthy();
  });

  it("no llama confirmado al agregado maxima_gravedad de IA y médico", () => {
    render(<VisitSummaryTab visit={visit([eye(11, "Derecho", "PENDIENTE", null)])} />);
    expect(screen.getByText(/puede incluir predicciones IA pendientes/i)).toBeTruthy();
  });
});
