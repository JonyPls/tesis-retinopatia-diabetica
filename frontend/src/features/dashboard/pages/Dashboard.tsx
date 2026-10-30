import { RecentPatientsTable } from "../components/RecentPatientsTable";
import { KpiGrid } from "../components/KpiGrid";
import { RDLevelDistribution } from "../components/RDLevelDistribution";
import { useDashboard } from "../hooks/useDashboard";
import { PageContent } from "@/components/layout/PageContent";
import { useAuthStore } from "@/features/auth/store/authStore";
import { hasOphthalmologistRole } from "@/features/patients/patientAccess";
import { canAccessModule } from "@/features/auth/moduleAccess";
import { Activity, Brain, ClipboardCheck, Clock3, FileText, Settings, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { KpiItem } from "../types";

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const deniedModules = useAuthStore((state) => state.deniedModules);
  const clinical = hasOphthalmologistRole(user);
  const canRequestSummary = clinical && ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver"]
    .every((permission) => user?.permisos?.includes(permission));
  const { summary, isLoading, error } = useDashboard(canRequestSummary);
  const canEvaluate = canAccessModule(user, "diagnosis", deniedModules);
  const canViewPatients = canAccessModule(user, "patients", deniedModules);
  const canViewReports = canAccessModule(user, "reports", deniedModules);
  const canConfigure = canAccessModule(user, "configuration", deniedModules);
  const kpis: KpiItem[] = summary ? [
    { label: "Pacientes registrados", value: summary.kpis.patients, icon: Users, tone: "teal" },
    { label: "Evaluaciones IA", value: summary.kpis.evaluations, icon: Activity, tone: "blue" },
    { label: "Diagnósticos validados", value: summary.kpis.validated, icon: ClipboardCheck, tone: "green" },
    { label: "Pendientes de validación", value: summary.kpis.pending, icon: Clock3, tone: "amber" },
  ] : [];
  const actions = [
    ...(canEvaluate && summary?.actions.diagnosis ? [{ label: "Nueva Evaluación IA", to: "/diagnostico", icon: Brain }] : []),
    ...(canViewPatients && (!clinical || summary?.actions.patients) ? [{ label: "Pacientes", to: "/pacientes", icon: Users }] : []),
    ...(canViewReports && summary?.actions.reports ? [{ label: "Informes Clínicos", to: "/informes", icon: FileText }] : []),
    ...(!clinical && canConfigure ? [{ label: "Configuración y usuarios", to: "/configuracion", icon: Settings }] : []),
  ];

  return (
    <PageContent
      title="Dashboard"
      subtitle={clinical ? "Resumen clínico" : "Inicio del sistema"}
    >
      {clinical ? (
        !canRequestSummary ? <p role="alert" className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          No tiene autorización para consultar el resumen clínico.
        </p> : isLoading ? <p role="status" className="py-10 text-sm text-muted-foreground">Cargando resumen clínico...</p>
          : error ? <p role="alert" className="rounded-md border border-border bg-card p-6 text-sm text-destructive">{error}</p>
            : summary ? <div className="space-y-6">
              <KpiGrid kpis={kpis} />
              <div role="group" aria-label="Actividad clínica y gravedad"
                className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <RecentPatientsTable patients={summary.recent_patients}
                  canViewPatients={canViewPatients && summary.actions.patients} />
                <RDLevelDistribution rows={summary.severity} />
              </div>
              <QuickAccess actions={actions} />
            </div> : null
      ) : (
        <div className="max-w-2xl space-y-6">
          <section className="rounded-md border border-border bg-card p-5 sm:p-6">
            <h3 className="text-base font-semibold">Bienvenido al sistema</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              El resumen de diagnósticos está disponible únicamente para especialistas autorizados.
              Utilice el menú para acceder a las funciones habilitadas para su cuenta.
            </p>
          </section>
          <QuickAccess actions={actions} />
        </div>
      )}
    </PageContent>
  );
}

function QuickAccess({ actions }: { actions: { label: string; to: string; icon: typeof Users }[] }) {
  if (!actions.length) return null;
  return <section aria-labelledby="quick-access-title" className="space-y-3">
    <h3 id="quick-access-title" className="text-sm font-semibold text-foreground">Accesos rápidos</h3>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {actions.map(({ label, to, icon: Icon }) => <Link key={to} to={to}
        className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-card transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>{label}
      </Link>)}
    </div>
  </section>;
}
