import { useState, useEffect } from "react";
import api from "@/lib/api";
import { civilAge, compareClinicalDesc } from "@/lib/clinicalDates";
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
            .filter((p) => p.ultima_visita)
            .sort(
              (a, b) => compareClinicalDesc(a.ultima_visita, b.ultima_visita),
            );

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
