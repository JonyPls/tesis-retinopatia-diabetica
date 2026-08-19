import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Patient, Diagnosis } from "../types";

export function usePatientProfile(id: string | undefined) {
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [resPac, resDiag] = await Promise.all([
          api.get(`/pacientes/${id}`),
          api.get(`/diagnosticos/paciente/${id}`),
        ]);

        const dataPac = resPac.data;
        const dataDiag = resDiag.data;

        if (
          dataPac.data &&
          (!Array.isArray(dataPac.data) || dataPac.data.length > 0)
        ) {
          setPatient(
            Array.isArray(dataPac.data) ? dataPac.data[0] : dataPac.data,
          );
        } else {
          setPatient(null);
        }

        if (dataDiag.data) {
          setDiagnoses(dataDiag.data);
        }
      } catch (error) {
        console.error("Error obteniendo datos", error);
        setPatient(null);
      } finally {
        setIsLoading(false);
      }
    };
    if (id) fetchData();
  }, [id]);

  const calculateAge = (birthDateStr: string) => {
    if (!birthDateStr) return 0;
    const today = new Date();
    const birth = new Date(birthDateStr);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  const getInitials = (nombres?: string, apellidos?: string) => {
    if (!nombres || !apellidos) return "";
    return (nombres.trim()[0] + apellidos.trim()[0]).toUpperCase();
  };

  const mapResultToLevel = (result: string) => {
    switch (result) {
      case "Proliferativa":
        return 4;
      case "Severa":
        return 3;
      case "Moderada":
        return 2;
      case "Leve":
        return 1;
      case "Sin retinopatía":
      default:
        return 0;
    }
  };

  const sortedDx = [...diagnoses].sort(
    (a, b) =>
      new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
  );

  const maxLevel =
    diagnoses.length > 0
      ? Math.max(...diagnoses.map((d) => mapResultToLevel(d.resultado_ia)))
      : 0;

  const status = (() => {
    if (diagnoses.length === 0) return "Sin Evaluar" as const;
    if (maxLevel >= 3) return "Crítico" as const;
    if (maxLevel >= 1) return "Seguimiento" as const;
    return "Normal" as const;
  })();

  const lastVisit =
    sortedDx.length > 0
      ? new Date(sortedDx[0].fecha_visita).toLocaleDateString("es-PE")
      : "Sin registros";

  return {
    patient,
    diagnoses,
    isLoading,
    calculateAge,
    getInitials,
    mapResultToLevel,
    sortedDx,
    maxLevel,
    status,
    lastVisit,
    navigate,
  };
}
