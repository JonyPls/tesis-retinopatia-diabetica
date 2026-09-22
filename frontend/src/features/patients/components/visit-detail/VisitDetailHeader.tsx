import { Link } from "react-router-dom";
import { ArrowLeft, Brain, Calendar, FileText, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Diagnosis } from "../../types";

const VISIT_STATUS_TEXT: Record<string, string> = {
  ACTIVA: "Activa",
  CERRADA: "Cerrada",
  ANULADA: "Anulada",
};

function formatVisitDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status?: string) {
  if (status === "ACTIVA") return "border-success/30 bg-success/10 text-success";
  if (status === "CERRADA") return "border-muted bg-muted text-muted-foreground";
  if (status === "ANULADA") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted/35 text-muted-foreground";
}

interface VisitDetailHeaderProps {
  patientId: number;
  visit: Diagnosis;
}

export function VisitDetailHeader({ patientId, visit }: VisitDetailHeaderProps) {
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
  const hasDiagnosis = Number(visit.tiene_diagnostico_ia) === 1 || Boolean(visit.diagnostico_ia);

  return (
    <div className="space-y-4">
      <Button variant="outline" asChild>
        <Link to={`/pacientes/${patientId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver al historial clínico
        </Link>
      </Button>

      <Card className="border-border shadow-card">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 text-primary" />
                <span>Visita clínica</span>
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Visita del {formatVisitDate(visit.fecha_visita)}
              </h1>
              {visit.motivo_consulta && (
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {visit.motivo_consulta}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Stethoscope className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">
                  {visit.medico_tratante || "Profesional no registrado"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Badge
                variant="outline"
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium", statusClass(visit.estado))}
              >
                {VISIT_STATUS_TEXT[visit.estado ?? ""] ?? visit.estado ?? "Sin estado"}
              </Badge>
              {hasDiagnosis && (
                <Badge
                  variant="outline"
                  className="rounded-md border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                >
                  <Brain className="mr-1 h-3.5 w-3.5" />
                  Diagnóstico IA
                </Badge>
              )}
              <Badge
                variant="outline"
                className="rounded-md border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                <FileText className="mr-1 h-3.5 w-3.5" />
                {reportsCount} informe{reportsCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
