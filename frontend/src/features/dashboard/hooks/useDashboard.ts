import { useState, useEffect } from "react";
import api from "@/lib/api";
import { civilAge, clinicalInstant } from "@/lib/clinicalDates";
import { Patient } from "../types";
import { patientRequestMessage } from "@/features/patients/patientAccess";

export function useDashboard(enabled: boolean) {
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRecentPatients([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    const fetchRecentPatients = async () => {
      try {
        const { data } = await api.get("/pacientes");
        if (active && data.data) {
          const sorted = (data.data as Patient[])
            .filter((p) => p.ultima_visita || p.visitas_sin_fecha_verificada)
            .sort((a, b) => {
              const first = a.ultima_visita_origen === "UTC_VERIFICADO"
                ? clinicalInstant(a.ultima_visita, a.ultima_visita_origen)?.getTime() : undefined;
              const second = b.ultima_visita_origen === "UTC_VERIFICADO"
                ? clinicalInstant(b.ultima_visita, b.ultima_visita_origen)?.getTime() : undefined;
              if (first !== undefined && second === undefined) return -1;
              if (first === undefined && second !== undefined) return 1;
              if (first !== undefined && second !== undefined && first !== second) return second - first;
              return Number(b.id) - Number(a.id);
            });

          setRecentPatients(sorted.slice(0, 6));
          setError(null);
        }
      } catch (error) {
        if (active) {
          setRecentPatients([]);
          setError(patientRequestMessage(error));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchRecentPatients();
    return () => { active = false; };
  }, [enabled]);

  const calculateAge = (birthDate: string) => {
    return civilAge(birthDate) ?? "-";
  };

  return {
    recentPatients,
    isLoading,
    error,
    calculateAge,
  };
}
