// El login entrega roles.nombre, no roles.codigo. Solo orienta la UI;
// la autorización definitiva se evalúa en cada petición del backend.
type SessionUser = { roles: string[]; permisos?: string[] } | null;

const CLINICAL_ROLES = ["Oftalmologo", "Oftalmólogo", "Enfermero"];
const PATIENT_ROLES = [...CLINICAL_ROLES, "Asistente administrativo"];

export function hasOphthalmologistRole(user: SessionUser) {
  return !!user?.roles.some((role) => ["Oftalmologo", "Oftalmólogo"].includes(role));
}

export function canReadPatients(user: SessionUser) {
  return !!user?.permisos?.includes("pacientes.ver") &&
    user.roles.some((role) => PATIENT_ROLES.includes(role));
}

export function canViewClinicalDashboard(user: SessionUser) {
  return canReadPatients(user) &&
    !!user?.roles.some((role) => CLINICAL_ROLES.includes(role));
}

export function patientRequestMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return "Su sesión ya no es válida. Inicie sesión nuevamente.";
  if (status === 403) return "No tiene autorización para consultar pacientes.";
  if (!status) return "No se pudo conectar con el servidor. Compruebe su conexión.";
  return "No se pudo completar la consulta. Inténtelo más tarde.";
}

export interface PatientRequestError {
  message: string;
  status: number;
}

export function patientRequestError(error: unknown): PatientRequestError {
  return {
    message: patientRequestMessage(error),
    status: (error as { response?: { status?: number } })?.response?.status ?? 0,
  };
}
