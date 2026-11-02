// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Diagnosis from "../features/diagnosis/pages/Diagnosis";
import { DiagnosisStepper } from "../features/diagnosis/components/DiagnosisStepper";
import { useDiagnosis } from "../features/diagnosis/hooks/useDiagnosis";
import type { DiagnosisResult } from "../features/diagnosis/api/diagnosisService";

vi.mock("../features/diagnosis/hooks/useDiagnosis", () => ({ useDiagnosis: vi.fn() }));
vi.mock("../features/patients/hooks/usePatients", () => ({ usePatients: () => ({}) }));
vi.mock("../features/patients/components/CreatePatientDialog", () => ({ CreatePatientDialog: () => null }));
vi.mock("../hooks/useRetinaImage", () => ({
  useRetinaImage: () => ({ src: null, error: null, isLoading: false }),
}));

let state: ReturnType<typeof useDiagnosis>;
const result: DiagnosisResult = {
  visita_id: 30, detalle_id: 11, diagnostico_codigo: 2,
  diagnostico_texto: "Moderada", confianza_general: 80,
  probabilidades_detalle: {}, mensaje: "Registrado",
};

beforeEach(() => {
  state = {
    step: 3, confirmedVisitId: 30, selectedPatient: {
      id: 7, tipo_doc_abrev: "DNI", nro_documento: "12345678",
      nombres: "Paciente", apellidos: "Sintético de Prueba",
    },
    results: { OD: result, OI: { ...result, detalle_id: 12 } },
    eyes: { OD: { file: null, preview: null }, OI: { file: null, preview: null } },
    activeEye: "OD", setActiveEye: vi.fn(),
    finalSelection: { OD: 2, OI: 2 }, setFinalSelection: vi.fn(),
    comments: { OD: "", OI: "" }, setComment: vi.fn(),
    correctionReasons: { OD: "", OI: "" }, setCorrectionReason: vi.fn(),
    validatedEyes: { OD: "APROBADO" },
    eyeProcessing: { OD: "validado", OI: "pendiente_validacion" },
    processingNotice: null, reconcileResults: vi.fn(),
    isSaving: false, isValidating: false, validationConflict: false,
    modalPhase: "idle", modalProgress: 0,
    goBack: vi.fn(), goNext: vi.fn(), returnToResults: vi.fn(),
    busyEyes: { OD: false, OI: false }, eyeActionError: {}, autoCandidates: [],
    validateAll: vi.fn(), validateDiagnosis: vi.fn(),
  } as unknown as ReturnType<typeof useDiagnosis>;
  vi.mocked(useDiagnosis).mockImplementation(() => ({
    ...state,
    isNavigationBusy: state.isSaving || state.isValidating || state.busyEyes.OD || state.busyEyes.OI,
  }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("presentación y acciones del Paso 3", () => {
  const configureCorrection = (canOpen: boolean) => {
    state.correction = { canOpen, context: null, review: null, loading: false, pending: false, notice: null,
      otherPending: 0, recoveries: [], blocked: vi.fn(() => false), open: vi.fn(), refresh: vi.fn(), close: vi.fn(),
      confirm: vi.fn(), reconcile: vi.fn() };
  };
  it("sin disponibilidad de backend no ofrece la acción destructiva", () => {
    configureCorrection(false);
    render(<Diagnosis />);
    expect(screen.queryByRole("button", { name: "Corregir fotografías" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar diagnóstico" })).toBeInTheDocument();
    expect(state.correction.open).not.toHaveBeenCalled();
  });
  it("ofrece una consulta real para un marcador de otra evaluación sin navegar ni guardar", () => {
    configureCorrection(false);
    const consult = vi.fn(async () => {});
    state.correction.recoveries = [{ operationId: "technical-only", loading: false,
      notice: "Existe una corrección pendiente de verificar en esta pestaña.", consult }];
    render(<Diagnosis />);
    fireEvent.click(screen.getByRole("button", { name: "Consultar corrección pendiente" }));
    expect(consult).toHaveBeenCalledTimes(1);
    expect(state.goBack).not.toHaveBeenCalled(); expect(state.validateAll).not.toHaveBeenCalled();
  });
  it("deshabilita la consulta de recuperación mientras está en curso", () => {
    configureCorrection(false);
    state.correction.recoveries = [{ operationId: "technical-only", loading: true,
      notice: "Verificando corrección.", consult: vi.fn(async () => {}) }];
    render(<Diagnosis />);
    expect(screen.getByRole("button", { name: "Consultar corrección pendiente" })).toBeDisabled();
  });
  it("ofrece corrección contextual sin recuperar Anterior ni ejecutar la inferencia", () => {
    configureCorrection(true);
    render(<Diagnosis />);
    fireEvent.click(screen.getByRole("button", { name: "Corregir fotografías" }));
    expect(state.correction.open).toHaveBeenCalledTimes(1);
    expect(state.goBack).not.toHaveBeenCalled();
    expect(state.goNext).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Anterior" })).not.toBeInTheDocument();
  });
  it("conecta selección y aceptación al contrato de corrección sin guardar diagnóstico", () => {
    configureCorrection(true);
    state.correction.review = { visita_id: 30, paciente_id: 7, diagnostico_retinopatia_id: 9,
      estado_visita: "ACTIVA", estado_diagnostico: "PROCESADO", revision: 0, detalles: [
        { detalle_id: 11, ojo: "OD", estado_validacion: "APROBADO", elegible: false, bloqueo: "RESULTADO_VALIDADO" },
        { detalle_id: 12, ojo: "OI", estado_validacion: "PENDIENTE", elegible: true, bloqueo: null },
      ] };
    render(<Diagnosis />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Paciente Sintético de Prueba · DNI 12345678");
    fireEvent.click(screen.getByRole("checkbox", { name: "Descartar OI" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que deseo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar resultados" }));
    expect(state.correction.confirm).toHaveBeenCalledExactlyOnceWith(state.correction.review, [12], true);
    expect(state.validateAll).not.toHaveBeenCalled();
  });
  it("conserva la identificación del paciente sin progreso ni identificador de visita", () => {
    render(<Diagnosis />);
    expect(screen.getByRole("heading", { name: "Resultados de la evaluación" })).toBeInTheDocument();
    expect(screen.getByText("Paciente Sintético de Prueba")).toBeInTheDocument();
    expect(screen.getByText("DNI 12345678")).toBeInTheDocument();
    expect(screen.queryByText(/ID de visita:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Visita:\s*\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Paso 3 de 3/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Flujo de Diagnóstico")).not.toBeInTheDocument();
    expect(screen.queryByText(/diagnóstico padre|IA registrada · validación pendiente/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ojo derecho/ })).toHaveTextContent("Validado");
    expect(screen.getByRole("button", { name: /Ojo izquierdo/ })).toHaveTextContent("Pendiente");
    expect(screen.getByText("Validado · aprobado")).toBeInTheDocument();
    expect(screen.queryByText("Pendiente de validación")).not.toBeInTheDocument();
  });

  it("no inventa la identidad del paciente cuando el estado no la tiene", () => {
    state.selectedPatient = null;
    render(<Diagnosis />);
    expect(screen.getByText("Paciente no identificado")).toBeInTheDocument();
    expect(screen.queryByText(/ID de visita:/)).not.toBeInTheDocument();
  });

  it("mantiene el indicador de progreso en los pasos anteriores", () => {
    const { container } = render(<DiagnosisStepper step={1} processedEyes={0} />);
    expect(screen.getByText("Flujo de Diagnóstico")).toBeInTheDocument();
    expect(container.textContent).toContain("Paso 1");
    expect(container.textContent).toContain("Paso 3");
    expect(screen.getByText("Resultado IA")).toBeInTheDocument();
  });

  it("con ambos ojos registrados retira Anterior y conserva el guardado con confirmación previa", () => {
    render(<Diagnosis />);
    expect(screen.queryByRole("button", { name: "Anterior" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir ojo pendiente" })).not.toBeInTheDocument();
    expect(state.goBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar diagnóstico" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(state.validateAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y regresar" }));
    expect(state.validateAll).toHaveBeenCalledTimes(1);
  });

  it.each(["OD", "OI"] as const)("con solo %s ofrece añadir el ojo pendiente sin analizar ni validar", (eye) => {
    state.results = { [eye]: result };
    state.activeEye = eye;
    render(<Diagnosis />);
    expect(screen.queryByRole("button", { name: "Anterior" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Añadir ojo pendiente" }));
    expect(state.goBack).toHaveBeenCalledTimes(1);
    expect(state.goNext).not.toHaveBeenCalled();
    expect(state.validateAll).not.toHaveBeenCalled();
  });

  it.each(["error", "incierto"] as const)("conserva el aviso de procesamiento parcial y el estado %s de OI", (status) => {
    state.results = { OD: result };
    state.eyeProcessing.OI = status;
    state.processingNotice = "No se pudo confirmar el resultado del ojo izquierdo.";
    render(<Diagnosis />);
    expect(screen.getByRole("alert")).toHaveTextContent(state.processingNotice);
    expect(screen.getByText(status === "error" ? "OI: No procesado · error" : "OI: Registro de IA sin confirmar")).toBeInTheDocument();
    expect(screen.queryByText(/OD: Validado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de la visita" }));
    expect(state.reconcileResults).toHaveBeenCalledTimes(1);
  });

  it.each(["todos guardados", "conflicto", "guardando"])("mantiene la protección del guardado: %s", (condition) => {
    if (condition === "todos guardados") state.validatedEyes = { OD: "APROBADO", OI: "CORREGIDO" };
    if (condition === "conflicto") state.validationConflict = true;
    if (condition === "guardando") state.isValidating = true;
    render(<Diagnosis />);
    expect(screen.getByRole("button", { name: condition === "guardando" ? "Guardando..." : "Guardar diagnóstico" })).toBeDisabled();
    expect(state.validateAll).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Anterior" })).not.toBeInTheDocument();
  });

  it("bloquea temporalmente los campos médicos durante el guardado", () => {
    state.isValidating = true;
    state.activeEye = "OI";
    state.finalSelection.OI = 3;
    render(<Diagnosis />);
    expect(screen.queryByRole("button", { name: "Anterior" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 — Severa" })).toBeDisabled();
    expect(screen.getByLabelText("Motivo de corrección")).toBeDisabled();
    expect(screen.getByLabelText("Comentario médico (opcional)")).toBeDisabled();
    expect(state.goBack).not.toHaveBeenCalled();
  });

  it.each(["inferencia", "validación"])("no habilita añadir un ojo durante %s", (operation) => {
    state.results = { OD: result };
    state.isSaving = operation === "inferencia";
    state.isValidating = operation === "validación";
    render(<Diagnosis />);
    const add = screen.getByRole("button", { name: "Añadir ojo pendiente" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(state.goBack).not.toHaveBeenCalled();
  });
});

describe("acciones independientes del Paso 2", () => {
  it("conecta la revisión manual al hook sin ejecutar goNext otra vez", () => {
    state.step = 2;
    state.manualReview = { patient: state.selectedPatient!, images: [{ eye: "OI",
      file: new File(["synthetic"], "oi.jpg"), preview: "blob:OI" }] };
    state.cancelManualReview = vi.fn();
    state.confirmManualReview = vi.fn();
    render(<Diagnosis />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Confirmar fotografías seleccionadas");
    expect(screen.getByRole("button", { name: "Confirmar y analizar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y analizar" }));
    expect(state.confirmManualReview).toHaveBeenCalledExactlyOnceWith(state.manualReview, true);
    expect(state.goNext).not.toHaveBeenCalled();
    expect(state.validateAll).not.toHaveBeenCalled();
  });

  it.each([1, 2])("con %i ojos registrados ofrece volver a resultados sin usar Guardar y analizar", (count) => {
    state.step = 2;
    if (count === 1) state.results = { OD: result };
    state.canNext = true;
    render(<Diagnosis />);
    expect(screen.getByText("La evaluación conserva su visita clínica.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver a resultados" }));
    expect(state.returnToResults).toHaveBeenCalledTimes(1);
    expect(state.goNext).not.toHaveBeenCalled();
    expect(state.validateAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y analizar" }));
    expect(state.goNext).toHaveBeenCalledTimes(1);
  });

  it.each(["sin_procesar", "incierto"] as const)("sin resultados y con OD %s no ofrece un retorno ficticio", (status) => {
    state.step = 2;
    state.results = {};
    state.eyeProcessing.OD = status;
    state.canNext = status !== "incierto";
    render(<Diagnosis />);
    expect(screen.queryByRole("button", { name: "Volver a resultados" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeEnabled();
    const analyze = screen.getByRole("button", { name: "Guardar y analizar" });
    if (status === "incierto") expect(analyze).toBeDisabled();
    else {
      fireEvent.click(analyze);
      expect(state.goNext).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["inferencia", "validación", "confirmación"])("bloquea el retorno durante %s", (operation) => {
    state.step = 2;
    state.isSaving = operation === "inferencia";
    state.isValidating = operation === "validación";
    state.busyEyes.OI = operation === "confirmación";
    render(<Diagnosis />);
    const back = screen.getByRole("button", { name: "Volver a resultados" });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(state.returnToResults).not.toHaveBeenCalled();
  });
});
