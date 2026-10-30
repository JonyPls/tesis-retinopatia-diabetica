// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ClinicalReports from "../features/reports/pages/ClinicalReports";
import { VisitaSelector } from "../features/reports/components/VisitaSelector";
import { useReports } from "../features/reports/hooks/useReports";
import { getPatientReportHistory, getReportVersions } from "../features/reports/api/reportHistoryService";
import type { DiagnosticoVisita } from "../features/patients/api/patientService";

vi.mock("../features/reports/hooks/useReports", () => ({ useReports: vi.fn() }));
vi.mock("../features/reports/api/reportHistoryService", () => ({
  getPatientReportHistory: vi.fn(), getReportVersions: vi.fn(),
}));
vi.mock("../features/reports/components/ReportForm", () => ({
  ReportForm: ({ readOnly, initialData }: { readOnly?: boolean; initialData?: { id: number } }) =>
    <p>{readOnly ? `Solo lectura ${initialData?.id}` : "Formulario pendiente"}</p>,
}));

const patient = { id: 7, nombres: "Paciente", apellidos: "Sintética" };
const visit = (id: number, total: number): DiagnosticoVisita => ({
  visita_id: id, fecha_visita: "2026-10-13T17:51:00Z", fecha_visita_origen: "UTC_VERIFICADO",
  medico_tratante: "Felipe Jose Granados Carranza", total_informes: total,
});

const props = {
  visitas: [visit(3, 2), visit(4, 0), visit(5, 1), visit(6, 3)],
  selectedVisitaId: undefined,
  onSelect: vi.fn(), hasMore: false, expandida: true,
  onVerMas: vi.fn(), onVerMenos: vi.fn(),
  pacienteSeleccionado: true, cargandoVisitas: false,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

it("muestra la hora Lima, el profesional y 0/1/varios informes; permite seleccionar la visita", () => {
  const selected = vi.fn();
  render(<VisitaSelector {...props} onSelect={selected} />);
  const cards = screen.getAllByRole("button", { name: /Felipe Jose Granados Carranza/ });
  expect(cards).toHaveLength(4);
  expect(within(cards[0]).getByText("13/10/2026 · 12:51")).toBeInTheDocument();
  expect(within(cards[0]).getByText("2 informes")).toBeInTheDocument();
  expect(within(cards[1]).getByText("0 informes")).toBeInTheDocument();
  expect(within(cards[2]).getByText("1 informe")).toBeInTheDocument();
  expect(within(cards[3]).getByText("3 informes")).toBeInTheDocument();
  fireEvent.click(cards[0]);
  expect(selected).toHaveBeenCalledWith(props.visitas[0]);
});

it("no atribuye hora Lima ni HOY a una fecha NO_VERIFICADO; cuenta solo informes activos del mismo registro", () => {
  const unverified: DiagnosticoVisita = {
    visita_id: 8, fecha_visita: "2026-10-13T17:51:00Z", fecha_visita_origen: "NO_VERIFICADO",
    medico_tratante: "Histórico", informes: [
      { id: 1, tipo_informe_id: 2, tipo_informe_nombre: "Uno", estado: "ACTIVO", fecha_creado: "", fecha_actualizado: "" },
      { id: 2, tipo_informe_id: 3, tipo_informe_nombre: "Otro", estado: "ANULADO", fecha_creado: "", fecha_actualizado: "" },
    ],
  };
  render(<VisitaSelector {...props} visitas={[unverified]} />);
  const card = screen.getByRole("button", { name: /Histórico/ });
  expect(within(card).getByText("Fecha pendiente de conciliación")).toBeInTheDocument();
  expect(within(card).queryByText(/12:51|HOY/)).not.toBeInTheDocument();
  expect(within(card).getByText("1 informe")).toBeInTheDocument();
});

it("mantiene HOY según el día civil en Lima para una visita acreditada", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-14T00:10:00Z"));
    render(<VisitaSelector {...props} visitas={[visit(3, 2)]} />);
    expect(screen.getByRole("button", { name: /Felipe Jose Granados Carranza/ }))
      .toHaveTextContent("HOY");
  } finally {
    vi.useRealTimers();
  }
});

it("no muestra badges obsoletos mientras se recargan las visitas", () => {
  render(<VisitaSelector {...props} cargandoVisitas />);
  expect(screen.queryByText("2 informes")).not.toBeInTheDocument();
  expect(screen.getByText("Buscando visitas...")).toBeInTheDocument();
});

it("no monta el historial ni solicita sus versiones en el Paso 2", () => {
  vi.mocked(useReports).mockReturnValue({
    step: 2, selectedPatient: patient, selectedVisita: undefined,
    visitas: [visit(3, 2)], hasMoreVisitas: false, visitasExpandidas: false, isLoadingVisitas: false,
    query: "", searchResults: [], recentPatients: [], isSearching: false,
    searchError: null, recentError: null, hasSearched: false, isLoadingRecent: false,
    handleQueryChange: vi.fn(), selectPatient: vi.fn(), clearPatient: vi.fn(),
    selectVisita: vi.fn(), verMasVisitas: vi.fn(), verMenosVisitas: vi.fn(),
    goBack: vi.fn(), goNext: vi.fn(), canNext: false,
    availableTipos: [], selectedTipos: [], showAddTipoModal: false,
    closeAddTipoModal: vi.fn(), addTipos: vi.fn(),
  } as unknown as ReturnType<typeof useReports>);
  render(<MemoryRouter><ClinicalReports /></MemoryRouter>);
  expect(screen.getByText("Seleccionar Visita Clínica")).toBeInTheDocument();
  expect(screen.queryByText("Historial de informes clínicos")).not.toBeInTheDocument();
  expect(getPatientReportHistory).not.toHaveBeenCalled();
  expect(getReportVersions).not.toHaveBeenCalled();
});

it("conserva en el Paso 3 la apertura de un informe registrado en solo lectura", () => {
  vi.mocked(useReports).mockReturnValue({
    step: 3, selectedPatient: patient, selectedVisita: visit(3, 1),
    selectedTipos: [], availableTipos: [], informesExistentes: [{
      id: 42, visita_id: 3, tipo_informe_id: 2, tipo_informe_nombre: "Campo visual",
      datos_estructurados: { nota: "Sintética" }, estado: "ACTIVO",
      fecha_creado: "", fecha_actualizado: "",
    }],
    isLoadingInformesExistentes: false, activeTipoIndex: 0, formValidity: {},
    isSaving: false, showAddTipoModal: false, closeAddTipoModal: vi.fn(), addTipos: vi.fn(),
    goBack: vi.fn(), selectVisita: vi.fn(),
  } as unknown as ReturnType<typeof useReports>);
  render(<MemoryRouter><ClinicalReports /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /Campo visual.*Registrado/ }));
  expect(screen.getByText("Solo lectura 42")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Guardar Todo" })).not.toBeInTheDocument();
});
