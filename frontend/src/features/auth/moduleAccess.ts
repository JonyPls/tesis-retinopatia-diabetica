import api from "@/lib/api";
import type { User } from "./store/authStore";
import { canReadPatients, hasOphthalmologistRole } from "@/features/patients/patientAccess";

export type ModuleName = "dashboard" | "patients" | "patientVisit" | "diagnosis" | "reports" | "configuration";

function isPatientReadDenial(url: string, method?: string): boolean {
  return method === "GET" &&
    (/^\/pacientes\/\d+$/.test(url) || /^\/pacientes(?:\?|$|\/buscar\b|\/recientes\b)/.test(url));
}

// Las operaciones adicionales pueden tener permisos propios: su 403 no debe
// bloquear a quien solo tiene acceso de lectura al módulo (p. ej. enfermería).
export function isModuleAccessDenial(module: ModuleName, url?: string, method?: string): boolean {
  if (!url) return false;
  if (module === "configuration") return method === "GET" && url === "/configuracion/catalogo";
  if (module === "patients") return isPatientReadDenial(url, method);
  if (module === "patientVisit") return isPatientReadDenial(url, method) ||
    (method === "GET" && (/^\/pacientes\/\d+\/visitas$/.test(url) || /^\/diagnosticar\/visita\/\d+\/detalles$/.test(url)));
  if (module === "diagnosis") return url.startsWith("/diagnosticar/") ||
    (method === "POST" && url === "/diagnosticar") ||
    isPatientReadDenial(url, method);
  if (module === "reports") return isPatientReadDenial(url, method) ||
    (method === "GET" && (url === "/tipos-informe" || /^\/informes(?:\/\d+|\/paciente\/\d+|\/visita\/\d+|\/diagnostico\/\d+)$/.test(url))) ||
    (method === "POST" && url === "/informes");
  return false;
}

// Filtro local para el menú y antes de consultar: no sustituye la autorización B1.
export function canAccessModule(user: User | null, module: ModuleName, deniedModules: ModuleName[] = []): boolean {
  if (module === "dashboard") return true;
  if (deniedModules.includes(module)) return false;
  if (!user) return false;
  if (module === "configuration") return user.roles.includes("Administrador del sistema") &&
    !!user.permisos?.includes("configuracion.ver");
  if (!canReadPatients(user)) return false;
  if (module === "patients") return true;
  if (!hasOphthalmologistRole(user)) return false;
  if (module === "patientVisit") return ["visitas.ver", "diagnostico_retinopatia.ver", "informes.ver", "imagenes.ver"]
    .every((permission) => user.permisos?.includes(permission));
  if (module === "diagnosis") return ["diagnostico_retinopatia.ver", "diagnostico_retinopatia.crear", "imagenes.ver"]
    .every((permission) => user.permisos?.includes(permission));
  return ["informes.ver", "informes.crear"].every((permission) => user.permisos?.includes(permission));
}

export function tokenIsCurrent(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// 403 aquí significa JWT y cuenta válidos, aunque no tenga el permiso administrativo.
// La guardia B1 ejecuta token_required antes de decidir sobre el módulo.
export async function verifyDashboardSession(): Promise<"allowed" | "unauthenticated"> {
  try {
    const response = await api.get("/configuracion/catalogo");
    if (response.data?.success !== true) throw new Error("Respuesta de sesión inesperada");
    return "allowed";
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401) return "unauthenticated";
    if (status === 403) return "allowed";
    throw error;
  }
}

type Probe = { url: string; missing?: string };
const PROBES: Record<Exclude<ModuleName, "dashboard">, Probe[]> = {
  patients: [{ url: "/pacientes/buscar?q=" }],
  patientVisit: [
    { url: "/pacientes/buscar?q=" },
    { url: "/pacientes/0/visitas", missing: "Paciente no encontrado" },
    { url: "/diagnosticar/visita/0/detalles", missing: "Diagnóstico no encontrado." },
  ],
  diagnosis: [
    { url: "/pacientes/buscar?q=" },
    { url: "/diagnosticar/visita/0/detalles", missing: "Diagnóstico no encontrado." },
  ],
  reports: [
    { url: "/pacientes/buscar?q=" },
    { url: "/informes/0", missing: "Informe no encontrado." },
  ],
  configuration: [{ url: "/configuracion/catalogo", missing: "" }],
};

// Un 404 con el mensaje del handler confirma que B1 permitió llegar a un recurso
// deliberadamente inexistente. Un 404 del router u otro error nunca concede acceso.
export async function verifyModuleAccess(module: Exclude<ModuleName, "dashboard">): Promise<"allowed" | "denied" | "unauthenticated"> {
  for (const probe of PROBES[module]) {
    try {
      const response = await api.get(probe.url);
      if (probe.missing || response.data?.success !== true) throw new Error("Respuesta de autorización inesperada");
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: { success?: boolean; message?: string } } }).response;
      if (response?.status === 401) return "unauthenticated";
      if (response?.status === 403) return "denied";
      if (probe.missing && response?.status === 404 && response.data?.success === false && response.data.message === probe.missing) continue;
      throw error;
    }
  }
  return "allowed";
}
