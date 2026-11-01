// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosisResults } from "../features/diagnosis/components/DiagnosisResults";
import type { DiagnosisResult } from "../features/diagnosis/api/diagnosisService";
import type { EyeKey, EyeState } from "../features/diagnosis/types";
import { useRetinaImage } from "../hooks/useRetinaImage";

vi.mock("../hooks/useRetinaImage", () => ({ useRetinaImage: vi.fn() }));

const results: Record<EyeKey, DiagnosisResult> = {
  OD: {
    visita_id: 30, detalle_id: 11, diagnostico_codigo: 2,
    diagnostico_texto: "RD Moderada (NPDR)", confianza_general: 83.4,
    probabilidades_detalle: { sin_rd: 5, leve: 4, moderada: 83.4, severa: 6, proliferativa: 1.6 },
    imagen_url: "od-original.jpg", gradcam_url: "od-gradcam.jpg", mensaje: "Registrado",
  },
  OI: {
    visita_id: 30, detalle_id: 12, diagnostico_codigo: 1,
    diagnostico_texto: "RD Leve (NPDR)", confianza_general: 69.9,
    probabilidades_detalle: { sin_rd: 10, leve: 69.9, moderada: 15, severa: 4, proliferativa: 1.1 },
    imagen_url: "oi-original.jpg", gradcam_url: "oi-gradcam.jpg", mensaje: "Registrado",
  },
};
const eyes: Record<EyeKey, EyeState> = {
  OD: { file: null, preview: "blob:od-preview" },
  OI: { file: null, preview: "blob:oi-preview" },
};

function ResultScreen({
  data = results,
  validatedEyes,
}: {
  data?: Partial<Record<EyeKey, DiagnosisResult>>;
  validatedEyes?: Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">>;
}) {
  const [activeEye, setActiveEye] = useState<EyeKey>(data.OD ? "OD" : "OI");
  const [finalSelection, setFinalSelection] = useState({ OD: 2, OI: 1 });
  const [comments, setComments] = useState({ OD: "", OI: "" });
  const [reasons, setReasons] = useState({ OD: "", OI: "" });

  return <DiagnosisResults
    results={data} eyes={eyes} activeEye={activeEye} setActiveEye={setActiveEye}
    finalSelection={finalSelection}
    setFinalSelection={(eye, value) => setFinalSelection((prev) => ({ ...prev, [eye]: value }))}
    comments={comments} setComment={(eye, value) => setComments((prev) => ({ ...prev, [eye]: value }))}
    correctionReasons={reasons}
    setCorrectionReason={(eye, value) => setReasons((prev) => ({ ...prev, [eye]: value }))}
    validatedEyes={validatedEyes}
  />;
}

function section(name: string) {
  return within(screen.getByRole("heading", { name }).closest("section")!);
}

beforeEach(() => {
  vi.mocked(useRetinaImage).mockImplementation((filename) => ({
    src: `blob:${filename}`, error: null, isLoading: false,
  }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Paso 3: resultado IA y validación médica", () => {
  it("separa predicción, selección sugerida y guardado sin duplicar el nivel", () => {
    render(<ResultScreen />);
    const prediction = section("Predicción de IA");
    expect(prediction.getByText("RD Moderada (NPDR)")).toBeInTheDocument();
    expect(prediction.getByLabelText("Nivel predicho: 2")).toHaveTextContent("2");
    expect(prediction.queryByText("Nivel 2")).not.toBeInTheDocument();
    expect(prediction.getByText("Hemorragias y exudados duros.")).toBeInTheDocument();
    expect(prediction.getByRole("meter", { name: "Confianza del modelo" })).toHaveAttribute("aria-valuenow", "83.4");
    expect(prediction.getByText("83.4%")).toBeInTheDocument();
    expect(prediction.getByText("ResNet50")).toBeInTheDocument();
    const medical = section("Validación médica");
    expect(medical.getByText("Pendiente de validación")).toBeInTheDocument();
    expect(medical.getByRole("button", { name: /2 — Moderada \(sugerido por IA\)/ })).toHaveAttribute("aria-pressed", "true");
    expect(medical.getByText(/no hay una decisión médica guardada/)).toBeInTheDocument();
    expect(screen.queryByText(/aprobado|corregido|Grado propuesto, sin confirmar/i)).not.toBeInTheDocument();
    expect(medical.getAllByRole("button")).toHaveLength(5);
    expect(medical.getByRole("button", { name: "4 — Proliferativa" })).toBeInTheDocument();
  });

  it("conserva grados, motivos y comentarios independientes al alternar OD/OI", () => {
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole("button", { name: "3 — Severa" }));
    fireEvent.change(screen.getByLabelText("Motivo de corrección"), { target: { value: "Motivo sintético OD" } });
    fireEvent.change(screen.getByLabelText("Comentario médico (opcional)"), { target: { value: "Nota sintética OD" } });
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    expect(screen.queryByText(/Validado ·/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ojo izquierdo/ }));
    expect(screen.getByRole("button", { name: /Ojo izquierdo/ })).toHaveAttribute("aria-pressed", "true");
    expect(section("Predicción de IA").getByText("RD Leve (NPDR)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 — Leve/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Motivo de corrección")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Comentario médico (opcional)")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Comentario médico (opcional)"), { target: { value: "Nota sintética OI" } });

    fireEvent.click(screen.getByRole("button", { name: /Ojo derecho/ }));
    expect(screen.getByRole("button", { name: "3 — Severa" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Motivo de corrección")).toHaveValue("Motivo sintético OD");
    expect(screen.getByLabelText("Comentario médico (opcional)")).toHaveValue("Nota sintética OD");
    fireEvent.click(screen.getByRole("button", { name: /Ojo izquierdo/ }));
    expect(screen.getByLabelText("Comentario médico (opcional)")).toHaveValue("Nota sintética OI");
  });

  it.each(["APROBADO", "CORREGIDO"] as const)("solo presenta %s como guardado para el ojo confirmado", (state) => {
    render(<ResultScreen
      data={{ ...results, OD: { ...results.OD, diagnostico_final: state === "CORREGIDO" ? 3 : 2 } }}
      validatedEyes={{ OD: state }}
    />);
    expect(screen.getByRole("button", { name: /Ojo derecho/ })).toHaveTextContent("Validado");
    expect(screen.getByRole("button", { name: /Ojo izquierdo/ })).toHaveTextContent("Pendiente");
    expect(section("Validación médica").getByText(`Validado · ${state === "CORREGIDO" ? "corregido" : "aprobado"}`)).toBeInTheDocument();
    expect(screen.getByLabelText("Comentario médico (opcional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: state === "CORREGIDO" ? "3 — Severa" : /2 — Moderada/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3 — Severa" })).toBeDisabled();
    expect(section("Predicción de IA").getByLabelText("Nivel predicho: 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ojo izquierdo/ }));
    expect(screen.getByText("Pendiente de validación")).toBeInTheDocument();
    expect(screen.queryByText(/Validado ·/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Comentario médico (opcional)")).toBeEnabled();
  });

  it("solo informa cambios pendientes cuando existen modificaciones locales reales", () => {
    render(<ResultScreen />);
    const badge = () => section("Validación médica").queryByText(/Pendiente de validación|Cambios sin guardar|Validado ·/);
    expect(badge()).toHaveTextContent("Pendiente de validación");
    expect(screen.getByText(/no hay una decisión médica guardada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 — Severa" }));
    expect(badge()).toHaveTextContent("Cambios sin guardar");
    expect(screen.queryByText(/Se registrará al guardar el diagnóstico/)).not.toBeInTheDocument();
    expect(section("Validación médica").queryByText(/no hay una decisión médica guardada/)).not.toBeInTheDocument();
    expect(screen.getByText("Motivo de corrección")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 — Moderada \(sugerido por IA\)/ }));
    expect(badge()).toHaveTextContent("Pendiente de validación");
    fireEvent.change(screen.getByLabelText("Comentario médico (opcional)"), { target: { value: "Nota local" } });
    expect(badge()).toHaveTextContent("Cambios sin guardar");
    expect(screen.queryByText(/Se registrará al guardar el diagnóstico/)).not.toBeInTheDocument();
  });

  it("reconoce una validación persistida aunque no se propague validatedEyes", () => {
    render(<ResultScreen data={{ OD: { ...results.OD, estado_validacion: "APROBADO", diagnostico_final: 2 } }} />);
    expect(section("Validación médica").getByText("Validado · aprobado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ojo derecho/ })).toHaveTextContent("Validado");
    expect(screen.queryByText("Pendiente de validación")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Comentario médico (opcional)")).toBeDisabled();
  });

  it("ubica probabilidades bajo la predicción sin estirar las columnas", () => {
    render(<ResultScreen />);
    const prediction = screen.getByRole("heading", { name: "Predicción de IA" }).closest("section")!;
    const leftColumn = prediction.parentElement!;
    expect(leftColumn).toHaveClass("space-y-4");
    expect(within(leftColumn).getByRole("button", { name: "Probabilidades del modelo" })).toBeInTheDocument();
    const grid = leftColumn.parentElement!;
    expect(grid).toHaveClass("items-start");
    expect(within(grid).getByRole("heading", { name: "Validación médica" })).toBeInTheDocument();
    expect(leftColumn).not.toContainElement(screen.getByRole("heading", { name: "Validación médica" }));
  });

  it.each([69.9, 70])("conserva el umbral de confianza con %s%%", (confidence) => {
    render(<ResultScreen data={{ OD: { ...results.OD, confianza_general: confidence } }} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", String(confidence));
    const warning = screen.queryByText("Confianza baja. Se recomienda revisar la predicción.");
    if (confidence < 70) expect(warning).toBeInTheDocument();
    else expect(warning).not.toBeInTheDocument();
  });

  it("mantiene el aviso de atención prioritaria para grados 3 y 4", () => {
    const { rerender } = render(<ResultScreen data={{ OD: { ...results.OD, diagnostico_codigo: 3 } }} />);
    expect(screen.getByText("Caso de atención prioritaria")).toBeInTheDocument();
    rerender(<ResultScreen data={{ OD: { ...results.OD, diagnostico_codigo: 4 } }} />);
    expect(screen.getByText("Revise hallazgos y conducta clínica antes de guardar.")).toBeInTheDocument();
  });

  it("conserva todas las probabilidades y cambia los valores con el ojo activo", () => {
    render(<ResultScreen />);
    const toggle = screen.getByRole("button", { name: "Probabilidades del modelo" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    for (const [name, value] of Object.entries(results.OD.probabilidades_detalle)) {
      const row = screen.getByText(name.replace(/_/g, " ")).parentElement!;
      expect(within(row).getByText(`${value.toFixed(1)}%`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Ojo izquierdo/ }));
    const row = screen.getByText("leve").parentElement!;
    expect(within(row).getByText("69.9%")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("muestra original y Grad-CAM del ojo activo sin recortes y una sola aclaración", () => {
    render(<ResultScreen />);
    expect(screen.getByAltText("Imagen original")).toHaveAttribute("src", "blob:od-original.jpg");
    expect(screen.getByAltText("Grad-CAM")).toHaveAttribute("src", "blob:od-gradcam.jpg");
    expect(screen.getByAltText("Imagen original")).toHaveClass("object-contain");
    expect(screen.getByAltText("Grad-CAM")).toHaveClass("object-contain");
    expect(screen.getByText("od-original.jpg")).toBeInTheDocument();
    expect(screen.getAllByText(/no constituye un diagnóstico médico independiente/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Ojo izquierdo/ }));
    expect(screen.getByAltText("Imagen original")).toHaveAttribute("src", "blob:oi-original.jpg");
    expect(screen.getByAltText("Grad-CAM")).toHaveAttribute("src", "blob:oi-gradcam.jpg");
  });

  it("conserva errores de acceso a imágenes y la alternativa de previsualización local", () => {
    vi.mocked(useRetinaImage).mockReturnValue({ src: null, error: "No tiene autorización para ver esta imagen.", isLoading: false });
    const { rerender } = render(<ResultScreen />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByAltText("Imagen original")).not.toBeInTheDocument();
    rerender(<ResultScreen data={{ OD: { ...results.OD, imagen_url: undefined, gradcam_url: undefined } }} />);
    expect(screen.getByAltText("Imagen original")).toHaveAttribute("src", "blob:od-preview");
    expect(screen.getByText("Grad-CAM no disponible.")).toBeInTheDocument();
  });
});
