import { useDashboard } from "@/modules/dashboard/hooks/useDashboard";
import { KpiGrid } from "@/modules/dashboard/components/KpiGrid";
import { RecentPatientsTable } from "@/modules/dashboard/components/RecentPatientsTable";
import { RDLevelDistribution } from "@/modules/dashboard/components/RDLevelDistribution";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { dashboardKPIs } from "@/data/mockData";
import {
  Users,
  Brain,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { KpiItem } from "@/modules/dashboard/types";

const kpis: KpiItem[] = [
  {
    label: "Pacientes Registrados",
    value: dashboardKPIs.totalPatients.toLocaleString("es-PE"),
    delta: "+4 esta semana",
    icon: Users,
    tone: "primary",
  },
  {
    label: "Diagnósticos IA Hoy",
    value: dashboardKPIs.diagnosesToday,
    delta: "+3 vs. ayer",
    icon: Brain,
    tone: "info",
  },
  {
    label: "Casos Críticos Detectados",
    value: dashboardKPIs.criticalCases,
    delta: "Requieren derivación",
    icon: AlertTriangle,
    tone: "destructive",
  },
  {
    label: "Pendientes de Revisión",
    value: dashboardKPIs.pendingReview,
    delta: "Cola de validación",
    icon: ClipboardList,
    tone: "warning",
  },
];

export default function Dashboard() {
  const { recentPatients, isLoading, calculateAge } = useDashboard();

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Resumen operativo · Lunes 26 de Abril, 2025"
      actions={
        <Button asChild className="bg-gradient-primary hover:opacity-90">
          <Link to="/diagnostico">
            <Brain className="h-4 w-4" />
            Nueva Evaluación IA
          </Link>
        </Button>
      }
    >
      <KpiGrid kpis={kpis} />

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        <RecentPatientsTable
          patients={recentPatients}
          isLoading={isLoading}
          calculateAge={calculateAge}
        />
        <RDLevelDistribution />
      </div>
    </AppLayout>
  );
}
