import { useState, useEffect } from "react";
import api from "@/lib/api";
import type { DashboardSummary } from "../types";

function dashboardRequestMessage(error: unknown): string {
  if (error instanceof Error && error.message === "Respuesta inesperada") {
    return "No se pudo cargar el resumen clínico. Inténtelo más tarde.";
  }
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return "Su sesión ya no es válida. Inicie sesión nuevamente.";
  if (status === 403) return "No tiene autorización para consultar el resumen clínico.";
  if (!status) return "No se pudo conectar con el servidor. Compruebe su conexión.";
  return "No se pudo cargar el resumen clínico. Inténtelo más tarde.";
}

export function useDashboard(enabled: boolean) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    const fetchSummary = async () => {
      try {
        const { data } = await api.get("/dashboard/clinico");
        if (data.success !== true || !data.data ||
            !data.data.kpis || !Array.isArray(data.data.severity) ||
            !Array.isArray(data.data.recent_patients) ||
            !data.data.actions || ["patients", "diagnosis", "reports"].some(
              (action) => typeof data.data.actions[action] !== "boolean")) throw new Error("Respuesta inesperada");
        if (!active) return;
        setSummary(data.data as DashboardSummary);
        setError(null);
      } catch (error) {
        if (active) {
          setSummary(null);
          setError(dashboardRequestMessage(error));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void fetchSummary();
    return () => { active = false; };
  }, [enabled]);

  return { summary, isLoading, error };
}
