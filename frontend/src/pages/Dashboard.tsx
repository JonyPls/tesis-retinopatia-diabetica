import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { dashboardKPIs } from "@/data/mockData";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import {
  Users,
  Brain,
  AlertTriangle,
  ClipboardList,
  ArrowUpRight,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";

interface Patient {
  id: string | number;
  tipo_doc?: string;
  tipo_doc_abrev?: string;
  nro_documento: string;
  nombres_apellidos?: string;
  nombres?: string;
  apellidos?: string;
  fecha_nacimiento: string;
  ultima_visita?: string;
  maxima_gravedad?: number | null;
}

const calculateAge = (birthDate: string) => {
  if (!birthDate) return "-";
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

const getPatientStatus = (maxLevel?: number | null): Status => {
  if (maxLevel === undefined || maxLevel === null) return "Sin Evaluar";
  if (maxLevel >= 3) return "Crítico";
  if (maxLevel >= 1) return "Seguimiento";
  return "Normal";
};

const kpis = [
  {
    label: "Pacientes Registrados",
    value: dashboardKPIs.totalPatients.toLocaleString("es-PE"),
    delta: "+4 esta semana",
    icon: Users,
    tone: "primary" as const,
  },
  {
    label: "Diagnósticos IA Hoy",
    value: dashboardKPIs.diagnosesToday,
    delta: "+3 vs. ayer",
    icon: Brain,
    tone: "info" as const,
  },
  {
    label: "Casos Críticos Detectados",
    value: dashboardKPIs.criticalCases,
    delta: "Requieren derivación",
    icon: AlertTriangle,
    tone: "destructive" as const,
  },
  {
    label: "Pendientes de Revisión",
    value: dashboardKPIs.pendingReview,
    delta: "Cola de validación",
    icon: ClipboardList,
    tone: "warning" as const,
  },
];

const toneCls = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
};

export default function Dashboard() {
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecentPatients = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await fetch("http://localhost:5000/api/pacientes", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          localStorage.removeItem("token");
          window.location.href = "/";
          return;
        }

        const data = await response.json();

        if (data.data) {
          // Filtrar solo los que tienen registro de visita y ordenarlos descendente
          const sorted = (data.data as Patient[])
            .filter((p) => p.ultima_visita)
            .sort(
              (a, b) =>
                new Date(b.ultima_visita!).getTime() -
                new Date(a.ultima_visita!).getTime(),
            );

          setRecentPatients(sorted.slice(0, 6));
        }
      } catch (error) {
        console.error("Error al cargar pacientes recientes", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecentPatients();
  }, []);

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
      {/* KPIs */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className="shadow-card hover:shadow-elevated transition-shadow"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div
                  className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneCls[kpi.tone]}`}
                >
                  <kpi.icon className="h-5 w-5" />
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-4">
                <div className="text-3xl font-semibold tracking-tight text-foreground">
                  {kpi.value}
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {kpi.label}
                </div>
                <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {kpi.delta}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Tabla últimos pacientes */}
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">
                Últimos Pacientes Atendidos
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Ordenado por última visita
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-primary">
              <Link to="/pacientes">
                Ver todos <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Documento
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Nombre
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Última Visita
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Estado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground text-sm"
                    >
                      Cargando últimos pacientes...
                    </TableCell>
                  </TableRow>
                ) : recentPatients.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground text-sm"
                    >
                      No hay pacientes con visitas registradas.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentPatients.map((p) => (
                    <TableRow
                      key={p.id}
                      className="hover:bg-muted/40 cursor-pointer"
                    >
                      <TableCell>
                        <div className="font-mono text-sm">
                          {p.nro_documento}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase mt-0.5">
                          {p.tipo_doc_abrev || p.tipo_doc}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/pacientes/${p.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {p.nombres_apellidos ||
                            `${p.nombres || ""} ${p.apellidos || ""}`.trim()}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {calculateAge(p.fecha_nacimiento)} años
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.ultima_visita &&
                          new Date(p.ultima_visita).toLocaleDateString(
                            "es-PE",
                            { day: "2-digit", month: "short", year: "numeric" },
                          )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={getPatientStatus(p.maxima_gravedad)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Panel lateral derecho */}
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Distribución por Nivel RD
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Diagnósticos del mes en curso
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { level: 0, label: "Sin Retinopatía", count: 17, pct: 29 },
              { level: 1, label: "RD Leve", count: 24, pct: 42 },
              { level: 2, label: "RD Moderada", count: 9, pct: 15 },
              { level: 3, label: "RD Severa", count: 5, pct: 8 },
              { level: 4, label: "RD Proliferativa", count: 2, pct: 3 },
            ].map((row) => (
              <div key={row.level}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium">
                    N{row.level} · {row.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.count}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${row.pct}%`,
                      backgroundColor: `hsl(var(--rd-${row.level}))`,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-3 mt-3 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total mes</span>
                <span className="font-semibold">57 evaluaciones</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
