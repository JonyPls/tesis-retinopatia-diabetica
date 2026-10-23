import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { civilAge, compareVisitGroups, formatClinicalDay, unknownClinicalDate, verifiedVisitInstant } from "@/lib/clinicalDates";
import { Patient, Diagnosis, PatientReadScope } from "../types";
import { patientRequestError, type PatientRequestError } from "../patientAccess";

export function usePatientProfile(id: string | undefined) {
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<PatientReadScope>("administrative");
  const [patientError, setPatientError] = useState<PatientRequestError | null>(null);
  const [historyError, setHistoryError] = useState<PatientRequestError | null>(null);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setIsLoading(true);
      setPatient(null);
      setDiagnoses([]);
      setScope("administrative");
      setPatientError(null);
      setHistoryError(null);
      try {
        const resPac = await api.get(`/pacientes/${id}`);
        if (!active) return;
        const dataPac = resPac.data;

        if (
          dataPac.data &&
          (!Array.isArray(dataPac.data) || dataPac.data.length > 0)
        ) {
          const resolved = Array.isArray(dataPac.data) ? dataPac.data[0] : dataPac.data;
          setPatient(resolved);
          const resolvedScope: PatientReadScope = dataPac.scope === "clinical" ||
            dataPac.scope === "assistance" ? dataPac.scope : "administrative";
          setScope(resolvedScope);
          if (resolvedScope === "clinical" && dataPac.history_available === true) {
            try {
              const resDiag = await api.get(`/pacientes/${id}/visitas`);
              if (active) setDiagnoses(resDiag.data.data || []);
            } catch (error) {
              if (active) {
                const requestError = patientRequestError(error);
                if (requestError.status === 404) {
                  // El endpoint de historial solo devuelve 404 si ya no existe el paciente.
                  setPatient(null);
                } else {
                  setHistoryError(requestError.status === 403
                    ? { ...requestError, message: "No tiene autorización para consultar el historial clínico." }
                    : requestError);
                }
              }
            }
          } else if (resolvedScope === "clinical") {
            setHistoryError({ status: 403, message: "No tiene autorización para consultar el historial clínico." });
          }
        } else {
          setPatient(null);
        }
      } catch (error) {
        if (active) {
          setPatient(null);
          if ((error as { response?: { status?: number } })?.response?.status !== 404) {
            setPatientError(patientRequestError(error));
          }
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    if (id) fetchData();
    return () => { active = false; };
  }, [id]);

  const calculateAge = (birthDateStr: string) => {
    return civilAge(birthDateStr);
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

  const sortedDx = [...diagnoses].sort((a, b) => compareVisitGroups(a, b));

  const maxLevel =
    diagnoses.length > 0
      ? Math.max(
          ...diagnoses.map((d) =>
            d.maxima_gravedad ?? mapResultToLevel(d.resultado_ia || ""),
          ),
        )
      : 0;

  const status = (() => {
    if (diagnoses.length === 0) return "Sin Evaluar" as const;
    if (maxLevel >= 3) return "Crítico" as const;
    if (maxLevel >= 1) return "Seguimiento" as const;
    return "Normal" as const;
  })();

  const lastVisit =
    sortedDx.length > 0
      ? !verifiedVisitInstant(sortedDx[0])
        ? unknownClinicalDate : formatClinicalDay(sortedDx[0].fecha_visita)
      : "Sin registros";

  return {
    patient,
    scope,
    patientError,
    historyError,
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
