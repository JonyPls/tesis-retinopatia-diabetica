import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import {
  obtenerDetallesVisita,
  type DetalleDiagnosticoExistente,
} from "@/features/diagnosis/api/diagnosisService";
import type { Diagnosis, Patient } from "../types";

type VisitDetailError = "invalid_params" | "patient_not_found" | "visit_not_found" | "load_error";

export function usePatientVisitDetail(
  pacienteIdParam: string | undefined,
  visitaIdParam: string | undefined,
  compareVisitIdParam?: string | null,
) {
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Diagnosis[]>([]);
  const [diagnosisDetails, setDiagnosisDetails] = useState<DetalleDiagnosticoExistente[]>([]);
  const [comparisonDiagnosisDetails, setComparisonDiagnosisDetails] = useState<
    DetalleDiagnosticoExistente[]
  >([]);
  const [isComparisonLoading, setIsComparisonLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<VisitDetailError | null>(null);

  const pacienteId = Number(pacienteIdParam);
  const visitaId = Number(visitaIdParam);
  const compareVisitId = compareVisitIdParam ? Number(compareVisitIdParam) : null;
  const hasValidParams = Number.isFinite(pacienteId) && Number.isFinite(visitaId);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      if (!hasValidParams) {
        setIsLoading(false);
        setDiagnosisDetails([]);
        setComparisonDiagnosisDetails([]);
        setError("invalid_params");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [patientResponse, visitsResponse] = await Promise.all([
          api.get(`/pacientes/${pacienteId}`),
          api.get(`/pacientes/${pacienteId}/visitas`),
        ]);

        if (!isMounted) return;

        const patientData = patientResponse.data?.data;
        const resolvedPatient = Array.isArray(patientData)
          ? patientData[0]
          : patientData;

        if (!resolvedPatient) {
          setPatient(null);
          setVisits([]);
          setDiagnosisDetails([]);
          setComparisonDiagnosisDetails([]);
          setError("patient_not_found");
          return;
        }

        const visitData = visitsResponse.data?.data;
        const resolvedVisits = Array.isArray(visitData) ? visitData : [];
        const selectedVisit = resolvedVisits.find(
          (visit: Diagnosis) => Number(visit.visita_id) === visitaId,
        );

        let resolvedDiagnosisDetails: DetalleDiagnosticoExistente[] = [];
        const hasDiagnosis =
          selectedVisit &&
          (Number(selectedVisit.tiene_diagnostico_ia) === 1 ||
            Boolean(selectedVisit.diagnostico_ia));

        if (hasDiagnosis) {
          try {
            resolvedDiagnosisDetails = await obtenerDetallesVisita(visitaId);
          } catch (detailsError) {
            console.error("Error obteniendo detalles del diagnóstico", detailsError);
          }
        }

        if (!isMounted) return;

        setPatient(resolvedPatient);
        setVisits(resolvedVisits);
        setDiagnosisDetails(resolvedDiagnosisDetails);
        setComparisonDiagnosisDetails([]);
        setError(selectedVisit ? null : "visit_not_found");
      } catch (loadError) {
        console.error("Error obteniendo detalle de visita", loadError);
        if (!isMounted) return;
        setPatient(null);
        setVisits([]);
        setDiagnosisDetails([]);
        setComparisonDiagnosisDetails([]);
        setError("load_error");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [hasValidParams, pacienteId, visitaId]);

  const visit = useMemo(
    () => visits.find((item) => Number(item.visita_id) === visitaId) ?? null,
    [visits, visitaId],
  );

  const comparisonVisit = useMemo(() => {
    if (
      compareVisitId === null ||
      !Number.isFinite(compareVisitId) ||
      compareVisitId === visitaId
    ) {
      return null;
    }
    return visits.find((item) => Number(item.visita_id) === compareVisitId) ?? null;
  }, [compareVisitId, visitaId, visits]);

  const comparisonError =
    compareVisitId !== null &&
    (!Number.isFinite(compareVisitId) || compareVisitId === visitaId || !comparisonVisit)
      ? "comparison_visit_not_found"
      : null;

  useEffect(() => {
    let isMounted = true;

    const fetchComparisonDetails = async () => {
      setComparisonDiagnosisDetails([]);

      if (!comparisonVisit || comparisonError) return;

      const hasDiagnosis =
        Number(comparisonVisit.tiene_diagnostico_ia) === 1 ||
        Boolean(comparisonVisit.diagnostico_ia);

      if (!hasDiagnosis) return;

      setIsComparisonLoading(true);
      try {
        const details = await obtenerDetallesVisita(Number(comparisonVisit.visita_id));
        if (isMounted) setComparisonDiagnosisDetails(details);
      } catch (detailsError) {
        console.error("Error obteniendo detalles de comparación", detailsError);
        if (isMounted) setComparisonDiagnosisDetails([]);
      } finally {
        if (isMounted) setIsComparisonLoading(false);
      }
    };

    fetchComparisonDetails();

    return () => {
      isMounted = false;
    };
  }, [comparisonError, comparisonVisit]);

  const patientName =
    patient?.nombres_apellidos ||
    `${patient?.nombres ?? ""} ${patient?.apellidos ?? ""}`.trim();

  return {
    compareVisitId,
    comparisonDiagnosisDetails,
    comparisonError,
    comparisonVisit,
    error,
    diagnosisDetails,
    isComparisonLoading,
    isLoading,
    navigate,
    pacienteId,
    patient,
    patientName,
    visit,
    visitaId,
    visits,
  };
}
