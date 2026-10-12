// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { useAuthStore } from "../features/auth/store/authStore";
import { useRetinaImage } from "../hooks/useRetinaImage";
import { VisitDiagnosisTab } from "../features/patients/components/visit-detail/VisitDiagnosisTab";
import { DiagnosisResults } from "../features/diagnosis/components/DiagnosisResults";
import type { Diagnosis } from "../features/patients/types";
import type { DiagnosisResult } from "../features/diagnosis/api/diagnosisService";

vi.mock("../lib/api", () => ({ default: {
  get: vi.fn(), defaults: { baseURL: "http://localhost:5000/api" },
} }));
const get = vi.mocked(api.get);
const NativeURL = URL;
let created: ReturnType<typeof vi.fn>;
let revoked: ReturnType<typeof vi.fn>;

function login(token = "synthetic-only-token") {
  useAuthStore.getState().login(token, {
    id: 1, username: "sintetico", nombres: "Persona", apellidos: "Sintetica",
    roles: ["Oftalmologo"],
  });
}

function imageResponse(type = "image/jpeg") {
  return { data: new Blob(["synthetic-image"], { type }),
    headers: { "content-type": type } };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  created = vi.fn().mockImplementation(() => `blob:synthetic-${created.mock.calls.length}`);
  revoked = vi.fn();
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = created;
    static revokeObjectURL = revoked;
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {} unobserve() {} disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  vi.unstubAllGlobals();
});

describe("B1 imágenes clínicas con Bearer", () => {
  it("carga el Blob sin JWT en URL y libera la URL local al desmontar", async () => {
    login();
    get.mockResolvedValueOnce(imageResponse());
    const { result, unmount } = renderHook(() => useRetinaImage("synthetic-only.jpg"));
    await waitFor(() => expect(result.current.src).toMatch(/^blob:synthetic-/));
    const url = get.mock.calls[0][0];
    expect(url).toBe("http://localhost:5000/uploads/retinas/synthetic-only.jpg");
    expect(url).not.toContain("token");
    expect(get.mock.calls[0][1]).toMatchObject({ responseType: "blob", signal: expect.anything() });
    unmount();
    expect(revoked).toHaveBeenCalledWith(result.current.src);
  });

  it("no exhibe respuesta anterior tras cambio de paciente ni de sesión", async () => {
    login();
    let finishOld!: (result: ReturnType<typeof imageResponse>) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(imageResponse());
    const { result, rerender, unmount } = renderHook(
      ({ name }: { name: string }) => useRetinaImage(name),
      { initialProps: { name: "old.jpg" } },
    );
    rerender({ name: "new.jpg" });
    expect(result.current.src).toBeNull();
    await waitFor(() => expect(result.current.src).toMatch(/^blob:synthetic-/));
    const newUrl = result.current.src;
    await act(async () => { finishOld(imageResponse()); });
    expect(result.current.src).toBe(newUrl);
    expect(created).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.getState().logout());
    expect(result.current.src).toBeNull();
    expect(revoked).toHaveBeenCalledWith(newUrl);
    unmount();
  });

  it("distingue 401, 403, 404, error de red y MIME inválido", async () => {
    login();
    for (const [status, message] of [[401, "sesión"], [403, "autorización"],
      [404, "no encontrada"]] as const) {
      get.mockRejectedValueOnce({ response: { status } });
      const { result, unmount } = renderHook(() => useRetinaImage("synthetic.jpg"));
      await waitFor(() => expect(result.current.error).toContain(message));
      expect(result.current.src).toBeNull();
      unmount();
    }
    get.mockRejectedValueOnce(new Error("synthetic network error"));
    const network = renderHook(() => useRetinaImage("synthetic.jpg"));
    await waitFor(() => expect(network.result.current.error).toContain("No se pudo cargar"));
    network.unmount();
    get.mockResolvedValueOnce(imageResponse("text/html"));
    const invalid = renderHook(() => useRetinaImage("synthetic.jpg"));
    await waitFor(() => expect(invalid.result.current.error).toContain("Formato"));
    invalid.unmount();
    expect(created).not.toHaveBeenCalled();
  });

  it("el historial y Grad-CAM del diagnóstico usan Blob sin incluir el token", async () => {
    login();
    get.mockResolvedValue(imageResponse());
    const visit = { visita_id: 7, fecha_visita: "2030-01-01",
      tiene_informes: 0, tiene_diagnostico_ia: 1, informes: [],
      diagnostico_ia: { id: 9, estado: "PROCESADO", detalles: [{
        detalle_id: 11, ojo_evaluado: "Derecho", resultado_ia_id: 2,
        estado_validacion: "PENDIENTE", resultado_final_id: null,
        imagen_original_url: "original.jpg", imagen_gradcam_url: "map.jpg",
      }] } } as Diagnosis;
    const history = render(<VisitDiagnosisTab visit={visit} />);
    await waitFor(() => expect(screen.getByAltText("Imagen original")).toHaveAttribute("src",
      expect.stringMatching(/^blob:synthetic-/)));
    expect(screen.getByAltText("Grad-CAM")).toHaveAttribute("src",
      expect.stringMatching(/^blob:synthetic-/));
    fireEvent.click(screen.getByAltText("Imagen original"));
    expect(screen.getByRole("button", { name: "Cerrar vista previa" })).toBeInTheDocument();
    history.rerender(<VisitDiagnosisTab visit={{ ...visit, visita_id: 8 }} />);
    expect(screen.queryByRole("button", { name: "Cerrar vista previa" })).not.toBeInTheDocument();
    history.unmount();
    expect(revoked).toHaveBeenCalledTimes(2);

    const result = { diagnostico_codigo: 2, confianza_general: 83,
      gradcam_url: "result-map.jpg",
      probabilidades_detalle: {} } as DiagnosisResult;
    const diagnosis = render(<DiagnosisResults
      results={{ OD: result }} activeEye="OD" setActiveEye={vi.fn()}
      eyes={{ OD: { file: null, preview: "blob:local-original", isExistingImage: false },
        OI: { file: null, preview: null, isExistingImage: false } }} />);
    await waitFor(() => expect(screen.getByAltText("Grad-CAM")).toHaveAttribute("src",
      expect.stringMatching(/^blob:synthetic-/)));
    expect(get.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      "http://localhost:5000/uploads/retinas/original.jpg",
      "http://localhost:5000/uploads/retinas/map.jpg",
      "http://localhost:5000/uploads/retinas/result-map.jpg",
    ]));
    expect(get.mock.calls.every(([url]) => !String(url).includes("token"))).toBe(true);
    diagnosis.unmount();
    expect(revoked).toHaveBeenCalledTimes(3);
  });
});
