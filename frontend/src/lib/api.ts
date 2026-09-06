import axios from "axios";
import { useAuthStore } from "@/features/auth/store/authStore";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
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
    return Promise.reject(error);
  },
);

export default api;
