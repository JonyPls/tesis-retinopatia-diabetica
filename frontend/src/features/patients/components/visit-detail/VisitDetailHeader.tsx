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
  if (status === "ACTIVA") return "border-emerald-200/60 bg-emerald-50/50 text-emerald-700";
  if (status === "CERRADA") return "border-slate-200 bg-slate-50 text-slate-500";
  if (status === "ANULADA") {
    return "border-red-200/60 bg-red-50/50 text-red-600";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

interface VisitDetailHeaderProps {
  patientId: number;
  visit: Diagnosis;
}

export function VisitDetailHeader({ patientId, visit }: VisitDetailHeaderProps) {
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
  const hasDiagnosis = Number(visit.tiene_diagnostico_ia) === 1 || Boolean(visit.diagnostico_ia);

  return (
    <div className="space-y-6">
      <Button variant="outline" className="border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900" asChild>
        <Link to={`/pacientes/${patientId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver al historial clínico
        </Link>
      </Button>

      <Card className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-primary">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span>Visita clínica</span>
              </div>
              <h1 className="mt-3 text-2xl font-medium tracking-tight text-slate-900">
                Visita del {formatVisitDate(visit.fecha_visita)}
              </h1>
              {visit.motivo_consulta && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {visit.motivo_consulta}
                </p>
              )}
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <Stethoscope className="h-4 w-4 shrink-0 text-secondary" />
                <span className="truncate">
                  {visit.medico_tratante || "Profesional no registrado"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Badge
                variant="outline"
                className={cn("rounded-full border px-3 py-1 text-xs font-medium shadow-none", statusClass(visit.estado))}
              >
                {VISIT_STATUS_TEXT[visit.estado ?? ""] ?? visit.estado ?? "Sin estado"}
              </Badge>
              {hasDiagnosis && (
                <Badge
                  variant="outline"
                  className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 shadow-none"
                >
                  <Brain className="mr-1.5 h-3.5 w-3.5 text-amber-600" />
                  Diagnóstico IA
                </Badge>
              )}
              <Badge
                variant="outline"
                className="rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-none"
              >
                <FileText className="mr-1.5 h-3.5 w-3.5 text-primary" />
                {reportsCount} informe{reportsCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
