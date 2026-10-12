import { RecentPatientsTable } from "../components/RecentPatientsTable";
import { useDashboard } from "../hooks/useDashboard";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth/store/authStore";
import { canViewClinicalDashboard } from "@/features/patients/patientAccess";
import { Brain } from "lucide-react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const clinical = canViewClinicalDashboard(user);
  const { recentPatients, isLoading, error, calculateAge } = useDashboard(clinical);
  const canEvaluate = clinical && user?.roles.some((role) =>
    ["Oftalmologo", "Oftalmólogo"].includes(role));

  return (
    <AppLayout
      title="Dashboard"
      subtitle={clinical ? "Actividad clínica reciente" : "Inicio del sistema"}
      actions={canEvaluate ? (
        <Button asChild className="bg-gradient-primary hover:opacity-90">
          <Link to="/diagnostico">
            <Brain className="h-4 w-4" />
            Nueva Evaluación IA
          </Link>
        </Button>
      ) : undefined}
    >
      {clinical ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <RecentPatientsTable
            patients={recentPatients}
            isLoading={isLoading}
            error={error}
            calculateAge={calculateAge}
          />
        </div>
      ) : (
        <section className="max-w-2xl rounded-md border border-border bg-card p-5 sm:p-6">
          <h3 className="text-base font-semibold">Bienvenido al sistema</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            La vista administrativa aún no cuenta con indicadores disponibles.
            Utilice el menú para acceder a las funciones habilitadas para su cuenta.
          </p>
        </section>
      )}
    </AppLayout>
  );
}
