// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../lib/api";
import { useDiagnosisCorrection } from "../features/diagnosis/hooks/useDiagnosisCorrection";
import { hydrateDiscardMarkers, recordDiscard, retainDiscardMarker, useDiagnosisDiscardStore } from "../features/diagnosis/store/diagnosisDiscardStore";
import { useAuthStore } from "../features/auth/store/authStore";
import fixture from "./fixtures/diagnosisDiscardContract74.json";
import type { DiscardOperation } from "../features/diagnosis/api/diagnosisDiscardService";

vi.mock("../lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../lib/clinicalFeatures", () => ({ diagnosisDiscardEnabled: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useDiagnosisDiscardStore.setState({ entries: [], markers: [], recoveryActorId: null, storageError: false });
  useAuthStore.getState().login("synthetic", { id: 1, username: "synthetic", nombres: "Profesional", apellidos: "Sintético",
    roles: ["Oftalmologo"], permisos: ["diagnostico_retinopatia.descartar_pendiente"] });
});
afterEach(() => { cleanup(); useDiagnosisDiscardStore.setState({ entries: [] }); useAuthStore.getState().logout(); });

describe("regresión 74 resuelta por 75: identidad técnica tras perder el realm", () => {
  it.each(["sending", "uncertain", "confirmed"] as const)("perder el realm con operación %s conserva UUID y exclusión", (status) => {
    const entry = { actorId: 1, visitId: 30, status,
      request: { ...fixture.request, confirmo_descarte: true }, targets: [{ eye: "OI", detailId: 12 }],
      ...(status === "confirmed" ? { operation: fixture.discard.body.data as DiscardOperation } : {}) } as const;
    hydrateDiscardMarkers(1);
    expect(retainDiscardMarker({ ...entry, targets: [{ eye: "OI", detailId: 12 }] })).toBe(true);
    recordDiscard({ ...entry, targets: [{ eye: "OI", detailId: 12 }] });
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    const options = { step: 2, patientId: 7, visitId: 30, results: {}, version: () => 1,
      busy: () => false, apply: vi.fn(() => false) };
    const previous = renderHook(() => useDiagnosisCorrection(options));
    expect(previous.result.current.blocked()).toBe(true);
    previous.unmount();
    // Una recarga completa pierde todos los módulos/estado JS; no solo desmonta React.
    useDiagnosisDiscardStore.setState({ entries: [], markers: [], recoveryActorId: null, storageError: false });
    const reloaded = renderHook(() => useDiagnosisCorrection(options));
    expect(reloaded.result.current.blocked()).toBe(true);
    expect(useDiagnosisDiscardStore.getState().entries).toEqual([]);
    expect(useDiagnosisDiscardStore.getState().markers[0].operationId).toBe(fixture.request.operacion_id);
    expect(api.get).toHaveBeenCalledWith(`/diagnosticar/visita/30/operaciones-descarte/${fixture.request.operacion_id}`);
    expect(api.post).not.toHaveBeenCalled(); // Esta prueba nunca inicia otra escritura.
  });
});
