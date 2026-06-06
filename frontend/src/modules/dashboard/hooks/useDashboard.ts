import { useState, useEffect } from "react";
import api from "@/services/api";
import { Patient } from "../types";

export function useDashboard() {
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecentPatients = async () => {
      try {
        const { data } = await api.get("/pacientes");
        if (data.data) {
          const sorted = (data.data as Patient[])
            .filter((p) => p.ultima_visita)
            .sort(
              (a, b) =>
                new Date(b.ultima_visita!).getTime() -
                new Date(a.ultima_visita!).getTime(),
            );

          setRecentPatients(sorted.slice(0, 6));
        }
      } catch (error) {
        console.error("Error al cargar pacientes recientes", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecentPatients();
  }, []);

  const calculateAge = (birthDate: string) => {
    if (!birthDate) return "-";
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  return {
    recentPatients,
    isLoading,
    calculateAge,
  };
}
