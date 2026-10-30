import axios from "axios";
import { useAuthStore } from "@/features/auth/store/authStore";

export const ACCESS_DENIED_EVENT = "app:access-denied";
// Contexto de cada petición, sin añadir campos al contrato HTTP ni persistirlo.
const requestSessions = new WeakMap<object, Pick<ReturnType<typeof useAuthStore.getState>, "token" | "user">>();

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor de REQUEST: inyecta el token JWT desde el authStore
api.interceptors.request.use(
  (config) => {
    const { token, user } = useAuthStore.getState();
    requestSessions.set(config, { token, user });
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Interceptor de RESPONSE: si el token expiró, cierra sesión automáticamente
api.interceptors.response.use(
  (response) => {
    requestSessions.delete(response.config);
    return response;
  },
  (error) => {
    const sent = error.config && requestSessions.get(error.config);
    const current = useAuthStore.getState();
    const sameSession = sent && sent.token === current.token && sent.user === current.user && !error.config?.signal?.aborted;
    if (error.config) requestSessions.delete(error.config);
    if (sameSession && error.response?.status === 401 && error.config?.url !== "/login") {
      useAuthStore.getState().logout();
      window.location.href = "/";
    }
    if (sameSession && error.response?.status === 403) {
      window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, {
        detail: { url: error.config?.url, method: error.config?.method?.toUpperCase() },
      }));
    }
    return Promise.reject(error);
  },
);

export default api;
