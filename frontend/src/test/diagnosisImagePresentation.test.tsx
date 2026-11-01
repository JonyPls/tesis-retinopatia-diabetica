// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropZone } from "../features/diagnosis/components/DropZone";
import { ImageUploader } from "../features/diagnosis/components/ImageUploader";
import { AutoSelectionModal } from "../features/diagnosis/components/AutoSelectionModal";
import { DiagnosisStepper } from "../features/diagnosis/components/DiagnosisStepper";
import type { EyeKey, EyeState } from "../features/diagnosis/types";
import type { RetinographAutoImage } from "../features/diagnosis/api/diagnosisService";

afterEach(cleanup);

const empty = (): EyeState => ({ file: null, preview: null });
const loaded = (eye: EyeKey): EyeState => ({
  file: new File(["synthetic"], `${eye}.jpg`, { type: "image/jpeg" }), preview: `blob:${eye}`,
});
const candidate = (eye: EyeKey): RetinographAutoImage => ({
  filename: `${eye}-synthetic.png`, ojo: eye, ojo_original: eye === "OD" ? "R" : "L",
  tipo_imagen: "Color", secuencia: 1, extension: "png", fecha_exportacion: "2026-01-01T10:00:00", mime_type: "image/png",
});

describe("fotografías registradas en solo lectura", () => {
  it.each(["OD", "OI"] as const)("oculta modificaciones de %s y mantiene los controles del otro ojo", (eye) => {
    const other = eye === "OD" ? "OI" : "OD";
    const onFile = vi.fn();
    const onClear = vi.fn();
    const { container } = render(<ImageUploader embedded eyes={{ OD: loaded("OD"), OI: loaded("OI") }}
      lockedEyes={{ [eye]: true }} handleFile={onFile} clearEye={onClear} />);
    expect(screen.getByText("Análisis registrado")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reemplazar", hidden: true })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Quitar", hidden: true })).toHaveLength(1);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(screen.getByAltText(`Retina Ojo ${eye === "OD" ? "Derecho" : "Izquierdo"}`)).toHaveAttribute("src", `blob:${eye}`);
    const registered = screen.getByText("Análisis registrado");
    expect(registered.closest("button")).toBeNull();
    expect(registered.tabIndex).toBe(-1);
    fireEvent.keyDown(registered, { key: "Enter" });
    expect(onFile).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(onClear).toHaveBeenCalledExactlyOnceWith(other);
  });

  it("mantiene accesible la consulta ampliada, sin ofrecer edición de la imagen registrada", () => {
    render(<DropZone eye="OD" hasFile preview="blob:OD" readOnly onFile={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Reemplazar", hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar", hidden: true })).not.toBeInTheDocument();
    const view = screen.getByRole("button", { name: "Ver imagen de Ojo Derecho en grande" });
    expect(view).toBeEnabled();
    view.focus();
    expect(view).toHaveFocus();
    fireEvent.click(view);
    expect(screen.getByRole("button", { name: "Cerrar vista previa" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Retina Ojo Derecho")).toHaveLength(2);
  });

  it.each([true, false])("sin vista previa y con archivo %s muestra un estado estático, no una carga editable", (hasFile) => {
    const { container } = render(<DropZone eye="OD" hasFile={hasFile} preview={null} readOnly
      onFile={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText("Análisis registrado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { hidden: true })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("el bloqueo temporal de un ojo pendiente no lo presenta como análisis registrado", () => {
    render(<DropZone eye="OI" hasFile preview="blob:OI" disabled onFile={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reemplazar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar" })).toBeDisabled();
    expect(screen.queryByText("Análisis registrado")).not.toBeInTheDocument();
  });
});

describe("candidatas del retinógrafo", () => {
  it.each(["OD", "OI"] as const)("no lista candidatas del %s procesado y permite seleccionar y confirmar el otro ojo", (eye) => {
    const other = eye === "OD" ? "OI" : "OD";
    const candidates = [candidate("OD"), candidate("OI")];
    const selected = candidates.find((image) => image.ojo === other)!;
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    render(<AutoSelectionModal open patientName="Paciente sintético" candidates={candidates}
      chosen={{ image: selected, file: loaded(other).file!, preview: `blob:${other}` }}
      eyes={{ OD: loaded("OD"), OI: loaded("OI") }} lockedEyes={{ [eye]: true }}
      loading={false} confirming={false} notice={null} onSelect={onSelect} onConfirm={onConfirm}
      onRevoke={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: `Ver fotografía 1 de ${eye}`, hidden: true })).not.toBeInTheDocument();
    const note = screen.getByText(`${eye}: análisis registrado.`);
    expect(note.closest("button")).toBeNull();
    expect(note.tabIndex).toBe(-1);
    fireEvent.keyDown(note, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    const selectable = screen.getByRole("button", { name: `Ver fotografía 1 de ${other}` });
    selectable.focus();
    expect(selectable).toHaveFocus();
    fireEvent.click(selectable);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(selected);
    expect(screen.getByRole("img")).toHaveAttribute("src", `blob:${other}`);
    fireEvent.click(screen.getByRole("button", { name: `Confirmo paciente, imagen y ojo ${other}` }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(other);
  });

  it("no conserva acciones ni vista previa seleccionable de un ojo que acaba de quedar registrado", () => {
    const image = candidate("OD");
    const props = { open: true, patientName: "Paciente sintético", candidates: [image],
      chosen: { image, file: loaded("OD").file!, preview: "blob:OD" }, eyes: { OD: loaded("OD"), OI: empty() },
      loading: false, confirming: false, notice: null, onSelect: vi.fn(), onConfirm: vi.fn(),
      onRevoke: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<AutoSelectionModal {...props} />);
    expect(screen.getByRole("button", { name: "Confirmo paciente, imagen y ojo OD" })).toBeEnabled();
    rerender(<AutoSelectionModal {...props} lockedEyes={{ OD: true }} />);
    expect(screen.queryByRole("button", { name: /Ver fotografía|Confirmo|Quitar|Cambiar/, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No hay fotografías pendientes disponibles.")).toBeInTheDocument();
  });
});

describe("mensajes del contexto real", () => {
  it("distingue OD analizado de OI sin imagen y no anuncia una imagen nueva por procesar", () => {
    render(<ImageUploader embedded eyes={{ OD: { ...loaded("OD"), isExistingImage: true, confirmation: "CONSUMIDA" }, OI: empty() }}
      lockedEyes={{ OD: true }} handleFile={vi.fn()} clearEye={vi.fn()} />);
    expect(screen.getByText("OD:").parentElement).toHaveTextContent("OD: Analizado");
    expect(screen.getByText("OI:").parentElement).toHaveTextContent("OI: Pendiente de imagen");
    expect(screen.queryByText(/de 2|Puede continuar con 1|lista para analizar|confirmación no vigente|Revise la vigencia/)).not.toBeInTheDocument();
    expect(screen.getByText("Puede evaluar un solo ojo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar imagen para Ojo Izquierdo" })).toBeEnabled();
  });

  it("cuenta como lista solo la fotografía pendiente, no la del ojo registrado", () => {
    render(<ImageUploader embedded eyes={{ OD: loaded("OD"), OI: loaded("OI") }} lockedEyes={{ OD: true }}
      handleFile={vi.fn()} clearEye={vi.fn()} />);
    expect(screen.getByText("OD:").parentElement).toHaveTextContent("OD: Analizado");
    expect(screen.getByText("OI:").parentElement).toHaveTextContent("OI: Imagen lista para analizar");
  });

  it("antes del primer análisis permite una sola imagen sin exigir ambos ojos", () => {
    render(<ImageUploader embedded eyes={{ OD: loaded("OD"), OI: empty() }} handleFile={vi.fn()} clearEye={vi.fn()} />);
    expect(screen.getByText("OD:").parentElement).toHaveTextContent("OD: Imagen lista para analizar");
    expect(screen.getByText("OI:").parentElement).toHaveTextContent("OI: Pendiente de imagen");
    expect(screen.getByText("Puede evaluar un solo ojo.")).toBeInTheDocument();
  });

  it("no anuncia como lista una confirmación expirada ni un resultado incierto", () => {
    render(<ImageUploader embedded eyes={{ OD: { ...loaded("OD"), isExistingImage: true, confirmation: "EXPIRADA",
      expiresAt: "2020-01-01T00:00:00Z" }, OI: loaded("OI") }} eyeProcessing={{ OI: "incierto" }}
      handleFile={vi.fn()} clearEye={vi.fn()} />);
    expect(screen.getByText("OD:").parentElement).toHaveTextContent("OD: Pendiente de confirmación vigente");
    expect(screen.getByText("OI:").parentElement).toHaveTextContent("OI: Registro de IA sin confirmar");
    expect(screen.queryByText(/lista para analizar/)).not.toBeInTheDocument();
  });

  it.each([
    [false, 0, "La visita clínica se creará automáticamente al procesar las imágenes."],
    [true, 0, "Se utilizará la visita clínica seleccionada."],
    [true, 1, "La evaluación conserva su visita clínica."],
  ] as const)("presenta la visita existente=%s con %i ojos registrados sin identificadores", (hasExistingVisit, processedEyes, message) => {
    render(<DiagnosisStepper step={2} hasExistingVisit={hasExistingVisit} processedEyes={processedEyes} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    if (hasExistingVisit) expect(screen.queryByText(/se creará automáticamente/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ID de visita|Visita:\s*\d/)).not.toBeInTheDocument();
  });
});
