// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import api from "../lib/api";
import { usePatients } from "../features/patients/hooks/usePatients";
import { PatientPagination } from "../features/patients/components/PatientPagination";
import { PatientTable } from "../features/patients/components/PatientTable";
import { formatPatientListPhone, patientPageItems, sortPatients } from "../features/patients/patientListing";
import type { Patient } from "../features/patients/types";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(api.get);
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const make = (id: number, names: string, last = "Apellido", birth = "2000-01-01"): Patient => ({
  id, nro_documento: String(id).padStart(8, "0"), nombres: names, apellidos: last,
  fecha_nacimiento: birth, sexo: "F",
});
const today = new Date("2026-10-16T15:00:00Z");
const records = Array.from({ length: 240 }, (_, index) => make(index + 1, `Nombre ${String(240 - index).padStart(3, "0")}`));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("listado global de pacientes", () => {
  it("ordena nombres españoles, apellidos y desempata por ID en ambos sentidos", () => {
    const rows = [make(4, "Zoe"), make(3, "Álvaro", "Zeta"), make(2, "alvaro", "Alba"),
      make(5, "Ñora"), make(1, "Alvaro", "Alba"), make(6, "Nora")];
    expect(sortPatients(rows, { field: "patient", direction: "asc" }, today).map((p) => p.id))
      .toEqual([1, 2, 3, 6, 5, 4]);
    expect(sortPatients(rows, { field: "patient", direction: "desc" }, today).map((p) => p.id))
      .toEqual([4, 5, 6, 3, 1, 2]);
    expect(rows[0].id).toBe(4); // no modifica los datos originales
  });

  it("ordena por edad civil en Lima, cero es numérico y fechas inválidas quedan al final", () => {
    const rows = [make(8, "Sin fecha", "", "2026-02-30"), make(2, "Zoe", "", "2026-10-16"),
      make(4, "Ana", "", "2000-10-16"), make(1, "Beto", "", "2026-01-01"),
      make(3, "Celia", "", "2000-11-01"), make(7, "Futuro", "", "2027-01-01")];
    expect(sortPatients(rows, { field: "age", direction: "asc" }, today).map((p) => p.id))
      .toEqual([1, 2, 3, 4, 7, 8]);
    expect(sortPatients(rows, { field: "age", direction: "desc" }, today).map((p) => p.id))
      .toEqual([4, 3, 1, 2, 7, 8]);
    // 01:00 UTC sigue siendo el día anterior en el centro.
    expect(sortPatients([make(2, "Mañana", "", "2026-10-16"), make(1, "Hoy", "", "2026-10-15")],
      { field: "age", direction: "desc" }, new Date("2026-10-16T01:00:00Z")).map((p) => p.id))
      .toEqual([1, 2]);
  });

  it("filtra y ordena el conjunto completo antes de paginar, conserva el orden y ajusta la página", async () => {
    get.mockResolvedValue({ data: { data: records, scope: "administrative" } });
    const { result } = renderHook(() => usePatients(), { wrapper });
    await waitFor(() => expect(result.current.totalItems).toBe(240));
    act(() => result.current.toggleSort("patient"));
    expect(result.current.currentData[0].id).toBe(240);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(10);
    act(() => result.current.setCurrentPage(21));
    expect(result.current.currentData[0].id).toBe(40);
    act(() => result.current.toggleSort("patient"));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.currentData[0].id).toBe(1);
    act(() => { result.current.setQuery("Nombre 001"); result.current.setCurrentPage(1); });
    expect(result.current.totalItems).toBe(1);
    expect(result.current.currentData[0].id).toBe(240);
    act(() => { result.current.setQuery(""); result.current.setItemsPerPage(50); result.current.setCurrentPage(1); });
    expect(result.current.totalPages).toBe(5);
    act(() => result.current.setCurrentPage(5));
    expect(result.current.currentData).toHaveLength(40);
    expect(result.current.startIndex).toBe(200);
    expect(Math.min(result.current.endIndex, result.current.totalItems)).toBe(240);
    act(() => result.current.setQuery("inexistente"));
    expect(result.current.totalItems).toBe(0);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.currentData).toEqual([]);
  });

  it("descarta las respuestas tardías de una recarga anterior", async () => {
    let resolve!: (value: any) => void;
    get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => usePatients(), { wrapper });
    get.mockResolvedValueOnce({ data: { data: [make(9, "Reciente")], scope: "assistance" } });
    await act(async () => { await result.current.fetchPatients(); });
    await act(async () => { resolve({ data: { data: [make(1, "Viejo")], scope: "administrative" } }); });
    expect(result.current.patients[0].id).toBe(9);
    expect(result.current.scope).toBe("assistance");
  });

  it("solo oculta +51 peruano en la tabla y conserva prefijos extranjeros", () => {
    expect(formatPatientListPhone("+51 975 730 565")).toBe("975 730 565");
    expect(formatPatientListPhone("+51975730565")).toBe("975 730 565");
    expect(formatPatientListPhone("975 730 565")).toBe("975 730 565");
    expect(formatPatientListPhone("+1 555 123 4567")).toBe("+1 555 123 4567");
    expect(formatPatientListPhone()).toBe("Sin teléfono");
    const onSort = vi.fn();
    render(<PatientTable patients={[{ ...make(1, "Ana"), telefono: "+51 975 730 565" }]}
      isLoading={false} scope="administrative" calculateAge={() => "Menor de 1 año"}
      sort={{ field: "patient", direction: "asc" }} onSort={onSort} />, { wrapper });
    expect(screen.getByText("975 730 565")).toBeInTheDocument();
    expect(screen.getByText("Menor de 1 año")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "PACIENTE" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "EDAD" })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("button", { name: /Ordenar por Paciente/ })).toHaveTextContent("PACIENTE");
    expect(screen.getByRole("button", { name: /Ordenar por Edad/ })).toHaveTextContent("EDAD");
    fireEvent.click(screen.getByRole("button", { name: /Ordenar por Paciente/ }));
    expect(onSort).toHaveBeenCalledWith("patient");
    fireEvent.click(screen.getByRole("button", { name: /Ordenar por Edad/ }));
    expect(onSort).toHaveBeenCalledWith("age");
    expect(screen.queryByRole("button", { name: /Ordenar por Documento/ })).not.toBeInTheDocument();
  });
});

describe("paginación numérica", () => {
  it("presenta primera, última, vecinas y puntos solo donde hacen falta", () => {
    expect(patientPageItems(2, 3)).toEqual([1, 2, 3]);
    expect(patientPageItems(1, 20)).toEqual([1, 2, 3, "ellipsis", 20]);
    expect(patientPageItems(10, 20)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12, "ellipsis", 20]);
    expect(patientPageItems(19, 20)).toEqual([1, "ellipsis", 17, 18, 19, 20]);
    expect(patientPageItems(1, 50)).toEqual([1, 2, 3, "ellipsis", 50]);
    expect(patientPageItems(25, 50)).toEqual([1, "ellipsis", 23, 24, 25, 26, 27, "ellipsis", 50]);
    expect(patientPageItems(49, 50)).toEqual([1, "ellipsis", 47, 48, 49, 50]);
    expect(patientPageItems(1, 100)).toEqual([1, 2, 3, "ellipsis", 100]);
    expect(patientPageItems(50, 100)).toEqual([1, "ellipsis", 48, 49, 50, 51, 52, "ellipsis", 100]);
    expect(patientPageItems(100, 100)).toEqual([1, "ellipsis", 98, 99, 100]);
    for (const [current, total] of [[2, 3], [1, 20], [10, 20], [19, 20],
      [1, 50], [25, 50], [49, 50], [1, 100], [50, 100], [100, 100]]) {
      const numbers = patientPageItems(current, total).filter((page): page is number => typeof page === "number");
      expect(new Set(numbers).size).toBe(numbers.length);
    }
    expect(patientPageItems(20, 48)).toEqual([1, "ellipsis", 18, 19, 20, 21, 22, "ellipsis", 48]);
    expect(patientPageItems(1, 4)).toEqual([1, 2, 3, 4]);
    expect(patientPageItems(1, 0)).toEqual([]);
    expect(patientPageItems(2, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("navega con flechas y número activo editable por Enter; Escape cancela", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<PatientPagination currentPage={1} totalPages={48} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    rerender(<PatientPagination currentPage={3} totalPages={48} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Página actual 3, editar número" }));
    const input = screen.getByRole("textbox", { name: "Ir a página" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).toHaveBeenCalledWith(20);
    rerender(<PatientPagination currentPage={20} totalPages={48} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Página actual 20, editar número" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ir a página" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Ir a página" })).not.toBeInTheDocument();
    rerender(<PatientPagination currentPage={48} totalPages={48} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });

  it("lleva las páginas fuera de rango al límite válido sin alertas", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<PatientPagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    const go = (activePage: number, requested: string) => {
      const previousCalls = onPageChange.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: `Página actual ${activePage}, editar número` }));
      const input = screen.getByRole("textbox", { name: "Ir a página" });
      fireEvent.change(input, { target: { value: requested } });
      expect(onPageChange).toHaveBeenCalledTimes(previousCalls); // no navegar mientras se escribe
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    };
    go(1, "41");
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    rerender(<PatientPagination currentPage={3} totalPages={3} onPageChange={onPageChange} />);
    go(3, "0");
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    rerender(<PatientPagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    go(1, "2");
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    rerender(<PatientPagination currentPage={2} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Página actual 2, editar número" })).toHaveAttribute("aria-current", "page");
    go(2, "99999999999999999999");
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it("cancela vacío, letras y decimales, Escape y pérdida de foco sin navegar", () => {
    const onPageChange = vi.fn();
    render(<><PatientPagination currentPage={2} totalPages={3} onPageChange={onPageChange} />
      <button type="button">Fuera del editor</button></>);
    const edit = () => {
      fireEvent.click(screen.getByRole("button", { name: "Página actual 2, editar número" }));
      return screen.getByRole("textbox", { name: "Ir a página" });
    };
    let input = edit();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Página actual 2, editar número" })).toBeInTheDocument();
    input = edit();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input).toHaveValue("abc");
    fireEvent.keyDown(input, { key: "Enter" });
    input = edit();
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(input).toHaveValue("2.5"); // no convierte 2.5 en 25 ni redondea
    fireEvent.keyDown(input, { key: "Enter" });
    input = edit();
    fireEvent.change(input, { target: { value: "2." } });
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    input = edit();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Escape" });
    input = edit();
    expect(input).toHaveValue("2");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Fuera del editor" }) });
    expect(screen.queryByRole("textbox", { name: "Ir a página" })).not.toBeInTheDocument();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("renderiza los saltos de 50 páginas sin consultar la API ni alterar pacientes", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<PatientPagination currentPage={1} totalPages={50} onPageChange={onPageChange} />);
    expect(screen.getByRole("navigation", { name: "Páginas de pacientes" })).toHaveTextContent("123…50");
    expect(screen.getAllByText("…")).toHaveLength(1);
    rerender(<PatientPagination currentPage={25} totalPages={50} onPageChange={onPageChange} />);
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Página actual 25, editar número" })).toHaveAttribute("aria-current", "page");
    rerender(<PatientPagination currentPage={50} totalPages={50} onPageChange={onPageChange} />);
    expect(screen.getAllByText("…")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(get).not.toHaveBeenCalled();
  });

  it("renderiza también 100 páginas sintéticas con salto central y límites", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<PatientPagination currentPage={50} totalPages={100} onPageChange={onPageChange} />);
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Página actual 50, editar número" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Ir a página 100" }));
    expect(onPageChange).toHaveBeenCalledWith(100);
    rerender(<PatientPagination currentPage={100} totalPages={100} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(get).not.toHaveBeenCalled();
  });

  it("no muestra navegación cuando no existen resultados", () => {
    const onPageChange = vi.fn();
    render(<PatientPagination currentPage={1} totalPages={0} onPageChange={onPageChange} />);
    expect(screen.queryByRole("navigation", { name: "Páginas de pacientes" })).not.toBeInTheDocument();
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
