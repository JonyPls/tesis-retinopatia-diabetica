// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../features/auth/store/authStore";

const { requestUse, responseUse } = vi.hoisted(() => ({
  requestUse: vi.fn(),
  responseUse: vi.fn(),
}));

// Nunca se crea un cliente Axios real ni se envía tráfico HTTP.
vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: {
        request: { use: requestUse },
        response: { use: responseUse },
      },
    }),
  },
}));

import { ACCESS_DENIED_EVENT } from "../lib/api";

const requestConfig = (url: string) => requestUse.mock.calls[0][0]({ url, headers: {}, method: "get" });

const fakeUser = {
  id: 42,
  username: "medico_ficticio",
  nombres: "NombreFicticio",
  apellidos: "ApellidoFicticio",
  roles: ["Médico"],
};

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  useAuthStore.getState().logout();
  window.localStorage.clear();
});

afterEach(() => {
  useAuthStore.getState().logout();
  window.localStorage.clear();
});

describe("Interceptores Axios aislados", () => {
  it("A1-BEARER añade el token local en Authorization", () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    const onRequest = requestUse.mock.calls[0][0];
    const config = onRequest({ headers: {} });
    expect(config.headers.Authorization).toBe("Bearer synthetic-token-placeholder");
  });

  it("A1-401 limpia la sesión tras 401 de una ruta clínica", async () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    const onError = responseUse.mock.calls[0][1];
    const error = { response: { status: 401 }, config: requestConfig("/pacientes") };
    await expect(onError(error)).rejects.toBe(error);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("A1-401-LOGIN conserva el estado ante 401 del propio login", async () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    const onError = responseUse.mock.calls[0][1];
    const error = { response: { status: 401 }, config: requestConfig("/login") };
    await expect(onError(error)).rejects.toBe(error);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("A1-403 no cierra sesión al denegar permisos", async () => {
    useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
    const onError = responseUse.mock.calls[0][1];
    const error = { response: { status: 403 }, config: requestConfig("/informes") };
    await expect(onError(error)).rejects.toBe(error);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each(["/pacientes/buscar", "/pacientes/recientes"])(
    "B1-401 cierra la sesión ante JWT inválido en %s", async (url) => {
      useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
      const onError = responseUse.mock.calls[0][1];
      await expect(onError({ response: { status: 401 }, config: requestConfig(url) })).rejects.toMatchObject({ response: { status: 401 } });
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    },
  );

  it.each(["/pacientes/buscar", "/pacientes/recientes"])(
    "B1-403 conserva la sesión ante acceso insuficiente en %s", async (url) => {
      useAuthStore.getState().login("synthetic-token-placeholder", fakeUser);
      const onError = responseUse.mock.calls[0][1];
      await expect(onError({ response: { status: 403 }, config: requestConfig(url) })).rejects.toMatchObject({ response: { status: 403 } });
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    },
  );

  it.each([401, 403])("una respuesta %s de otra sesión no cierra ni deniega la sesión nueva", async (status) => {
    useAuthStore.getState().login("synthetic-old", fakeUser);
    const config = requestConfig("/pacientes");
    useAuthStore.getState().login("synthetic-new", { ...fakeUser, id: 43 });
    const denied = vi.fn();
    window.addEventListener(ACCESS_DENIED_EVENT, denied);
    try {
      const error = { response: { status }, config };
      await expect(responseUse.mock.calls[0][1](error)).rejects.toBe(error);
      expect(useAuthStore.getState().token).toBe("synthetic-new");
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(denied).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ACCESS_DENIED_EVENT, denied);
    }
  });

  it("el 403 de la sesión vigente sigue notificando la revocación", async () => {
    useAuthStore.getState().login("synthetic-current", fakeUser);
    const denied = vi.fn();
    window.addEventListener(ACCESS_DENIED_EVENT, denied);
    try {
      const error = { response: { status: 403 }, config: requestConfig("/pacientes") };
      await expect(responseUse.mock.calls[0][1](error)).rejects.toBe(error);
      expect(denied).toHaveBeenCalledOnce();
      expect(denied.mock.calls[0][0].detail).toEqual({ url: "/pacientes", method: "GET" });
    } finally {
      window.removeEventListener(ACCESS_DENIED_EVENT, denied);
    }
  });

  it.each([401, 403])("una sonda cancelada %s no cambia acceso ni sesión", async (status) => {
    useAuthStore.getState().login("synthetic-current", fakeUser);
    const controller = new AbortController();
    const config = requestUse.mock.calls[0][0]({ url: "/pacientes/buscar?q=", headers: {}, signal: controller.signal });
    controller.abort();
    const denied = vi.fn();
    window.addEventListener(ACCESS_DENIED_EVENT, denied);
    try {
      const error = { response: { status }, config };
      await expect(responseUse.mock.calls[0][1](error)).rejects.toBe(error);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(denied).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ACCESS_DENIED_EVENT, denied);
    }
  });
});
