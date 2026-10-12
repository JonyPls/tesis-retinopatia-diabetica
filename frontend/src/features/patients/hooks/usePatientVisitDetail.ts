import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import {
  obtenerDetallesVisita,
  type DetalleDiagnosticoExistente,
} from "@/features/diagnosis/api/diagnosisService";
import type { Diagnosis, Patient } from "../types";
import { patientRequestError, type PatientRequestError } from "../patientAccess";

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
  const [requestError, setRequestError] = useState<PatientRequestError | null>(null);
  const [comparisonRequestError, setComparisonRequestError] = useState<PatientRequestError | null>(null);

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
      setRequestError(null);
      setPatient(null);
      setVisits([]);
      setDiagnosisDetails([]);
      setComparisonDiagnosisDetails([]);

      try {
        const patientResponse = await api.get(`/pacientes/${pacienteId}`);

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

        if (patientResponse.data?.scope !== "clinical" ||
            patientResponse.data?.history_available !== true) {
          setError("load_error");
          setRequestError({ status: 403, message: "No tiene autorización para consultar el historial clínico." });
          return;
        }

        let visitsResponse;
        try {
          visitsResponse = await api.get(`/pacientes/${pacienteId}/visitas`);
        } catch (visitError) {
          if (isMounted) {
            const requestError = patientRequestError(visitError);
            if (requestError.status === 404) {
              // 404 aquí corresponde al paciente, no a una visita sin diagnóstico.
              setPatient(null);
              setError("patient_not_found");
            } else {
              setPatient(resolvedPatient);
              setError("load_error");
              setRequestError(requestError.status === 403
                ? { ...requestError, message: "No tiene autorización para consultar el historial clínico." }
                : requestError);
            }
          }
          return;
        }
        if (!isMounted) return;

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
            const failure = patientRequestError(detailsError);
            if (isMounted && failure.status !== 404) {
              setError("load_error");
              setRequestError(failure.status === 403
                ? { ...failure, message: "No tiene autorización para consultar el diagnóstico." }
                : failure);
              return;
            }
          }
        }

        if (!isMounted) return;

        setPatient(resolvedPatient);
        setVisits(resolvedVisits);
        setDiagnosisDetails(resolvedDiagnosisDetails);
        setComparisonDiagnosisDetails([]);
        setError(selectedVisit ? null : "visit_not_found");
      } catch (loadError) {
        if (!isMounted) return;
        setPatient(null);
        setVisits([]);
        setDiagnosisDetails([]);
        setComparisonDiagnosisDetails([]);
        const notFound = (loadError as { response?: { status?: number } })?.response?.status === 404;
        setError(notFound ? "patient_not_found" : "load_error");
        if (!notFound) setRequestError(patientRequestError(loadError));
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
      setComparisonRequestError(null);

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
        if (isMounted) {
          const failure = patientRequestError(detailsError);
          if (failure.status !== 404) {
            setComparisonRequestError(failure.status === 403
              ? { ...failure, message: "No tiene autorización para consultar el diagnóstico." }
              : failure);
          }
          setComparisonDiagnosisDetails([]);
        }
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
    comparisonRequestError,
    comparisonError,
    comparisonVisit,
    error,
    requestError,
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
