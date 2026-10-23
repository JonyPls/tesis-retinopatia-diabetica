import axios from "axios";
import { useAuthStore } from "@/features/auth/store/authStore";

export const ACCESS_DENIED_EVENT = "app:access-denied";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Interceptor de REQUEST: inyecta el token JWT desde el authStore
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Interceptor de RESPONSE: si el token expiró, cierra sesión automáticamente
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config?.url !== "/login") {
      useAuthStore.getState().logout();
      window.location.href = "/";
    }
    if (error.response?.status === 403) {
      window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, {
        detail: { url: error.config?.url, method: error.config?.method?.toUpperCase() },
      }));
    }
    return Promise.reject(error);
  },
);

export default api;
