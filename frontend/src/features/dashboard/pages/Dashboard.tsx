import { RecentPatientsTable } from "../components/RecentPatientsTable";
import { KpiGrid } from "../components/KpiGrid";
import { RDLevelDistribution } from "../components/RDLevelDistribution";
import { useDashboard } from "../hooks/useDashboard";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    { label: "Pacientes registrados", value: summary.kpis.patients, icon: Users },
    { label: "Evaluaciones IA", value: summary.kpis.evaluations, icon: Activity },
    { label: "Diagnósticos validados", value: summary.kpis.validated, icon: ClipboardCheck },
    { label: "Pendientes de validación", value: summary.kpis.pending, icon: Clock3 },
  ] : [];
  const actions = [
    ...(canEvaluate && summary?.actions.diagnosis ? [{ label: "Nueva Evaluación IA", to: "/diagnostico", icon: Brain }] : []),
    ...(canViewPatients && (!clinical || summary?.actions.patients) ? [{ label: "Pacientes", to: "/pacientes", icon: Users }] : []),
    ...(canViewReports && summary?.actions.reports ? [{ label: "Informes Clínicos", to: "/informes", icon: FileText }] : []),
    ...(!clinical && canConfigure ? [{ label: "Configuración y usuarios", to: "/configuracion", icon: Settings }] : []),
  ];

  return (
    <AppLayout
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
              <RDLevelDistribution rows={summary.severity} />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
                <RecentPatientsTable patients={summary.recent_patients}
                  canViewPatients={canViewPatients && summary.actions.patients} />
                <QuickAccess actions={actions} />
              </div>
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
    </AppLayout>
  );
}

function QuickAccess({ actions }: { actions: { label: string; to: string; icon: typeof Users }[] }) {
  if (!actions.length) return null;
  return <Card className="shadow-card">
    <CardHeader><CardTitle className="text-base">Accesos rápidos</CardTitle></CardHeader>
    <CardContent className="space-y-1">
      {actions.map(({ label, to, icon: Icon }) => <Link key={to} to={to}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Icon className="h-4 w-4 text-primary" />{label}
      </Link>)}
    </CardContent>
  </Card>;
}
