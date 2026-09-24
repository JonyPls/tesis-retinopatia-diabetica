import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpDown,
  Brain,
  Calendar,
  CircleDot,
  CornerDownRight,
  FileText,
  SlidersHorizontal,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import type { Diagnosis } from "../types";

interface PatientTimelineProps {
  diagnoses: Diagnosis[];
  sortedDx: Diagnosis[];
  patientName?: string;
  patientId?: string | number;
  className?: string;
}

type ContentFilter = "todos" | "diagnostico_ia" | "informes";

const VISIT_STATUS_TEXT: Record<string, string> = {
  ACTIVA: "Activa",
  CERRADA: "Cerrada",
  ANULADA: "Anulada",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateKey(iso: string) {
  return iso.split("T")[0].split(" ")[0];
}

function toneForVisitStatus(status?: string) {
  if (status === "ACTIVA") return "active";
  if (status === "CERRADA") return "muted";
  return "danger";
}

function PillBadge({
  icon: Icon,
  children,
  tone = "muted",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: "muted" | "ia" | "report" | "active" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        tone === "ia" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "report" && "border-primary/20 bg-primary/10 text-primary",
        tone === "active" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border bg-muted/35 text-muted-foreground",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function VisitCard({
  patientId,
  visit,
}: {
  patientId?: string | number;
  visit: Diagnosis;
}) {
  const reports = visit.informes ?? [];
  const hasIa = Number(visit.tiene_diagnostico_ia) === 1;
  const hasReports = Number(visit.tiene_informes) === 1;
  const reportsCount = reports.length || Number(visit.tiene_informes) || 0;
  const target = patientId ? `/pacientes/${patientId}/visitas/${visit.visita_id}` : null;

  const content = (
    <div className="relative flex w-full flex-col gap-4 border-l-4 border-l-muted p-4 pr-14 transition-colors duration-200 group-hover:border-l-primary/80 group-hover:bg-primary/5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-base font-semibold text-foreground">
            {formatDate(visit.fecha_visita)}
          </p>
          <PillBadge tone={toneForVisitStatus(visit.estado)}>
            {VISIT_STATUS_TEXT[visit.estado ?? ""] ?? visit.estado ?? "Sin estado"}
          </PillBadge>
        </div>

        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {visit.medico_tratante || "Profesional no registrado"}
          </span>
        </div>

        {visit.motivo_consulta && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {visit.motivo_consulta}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:max-w-[45%] lg:justify-end">
        {visit.maxima_gravedad !== null && visit.maxima_gravedad !== undefined && (
          <RDLevelBadge level={visit.maxima_gravedad as RDLevel} size="sm" />
        )}
        {hasIa && (
          <PillBadge icon={Brain} tone="ia">
            Diagnóstico IA
          </PillBadge>
        )}
        {hasReports && (
          <PillBadge icon={FileText} tone="report">
            {reportsCount} informe{reportsCount === 1 ? "" : "s"}
          </PillBadge>
        )}
        {!hasIa && !hasReports && (
          <PillBadge icon={CircleDot}>Sin adjuntos</PillBadge>
        )}
      </div>

      {target && (
        <span
          className="absolute bottom-3 right-4 text-primary/75 transition-transform duration-200 group-hover:translate-x-1.5"
          aria-hidden="true"
        >
          <CornerDownRight className="h-5 w-5" />
        </span>
      )}
    </div>
  );

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-xl border border-border bg-card transition-all duration-200",
        target
          ? "hover:border-primary/35 hover:bg-primary/[0.025] hover:shadow-card"
          : "opacity-90",
      )}
    >
      {target ? (
        <Link
          to={target}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-label={`Ver detalle de visita del ${formatDate(visit.fecha_visita)}`}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </article>
  );
}

export function PatientTimeline({
  diagnoses,
  sortedDx,
  patientId,
  className,
}: PatientTimelineProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("todos");

  const filtered = useMemo(() => {
    let list = [...sortedDx];

    if (dateFrom) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) <= dateTo);
    }
    if (contentFilter === "diagnostico_ia") {
      list = list.filter((dx) => Number(dx.tiene_diagnostico_ia) === 1);
    }
    if (contentFilter === "informes") {
      list = list.filter((dx) => Number(dx.tiene_informes) === 1);
    }
    if (sortAsc) {
      list.sort(
        (a, b) =>
          new Date(a.fecha_visita).getTime() -
          new Date(b.fecha_visita).getTime(),
      );
    }

    return list;
  }, [sortedDx, dateFrom, dateTo, contentFilter, sortAsc]);

  const totals = useMemo(
    () => ({
      visitas: diagnoses.length,
      diagnosticos: diagnoses.filter((dx) => Number(dx.tiene_diagnostico_ia) === 1)
        .length,
      informes: diagnoses.reduce(
        (sum, dx) => sum + (dx.informes?.length ?? Number(dx.tiene_informes)),
        0,
      ),
    }),
    [diagnoses],
  );

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSortAsc(false);
    setContentFilter("todos");
  };

  const hasActiveFilters =
    dateFrom || dateTo || sortAsc || contentFilter !== "todos";

  if (diagnoses.length === 0) {
    return (
      <Card className={cn("shadow-card", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Historia clínica
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Aún no hay visitas registradas para este paciente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("shadow-card", className)}>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Historia clínica
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Visitas del paciente organizadas por fecha.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PillBadge icon={Calendar}>{totals.visitas} visitas</PillBadge>
            <PillBadge icon={Brain} tone="ia">
              {totals.diagnosticos} IA
            </PillBadge>
            <PillBadge icon={FileText} tone="report">
              {totals.informes} informes
            </PillBadge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFilters((value) => !value)}
              className={cn(
                "h-8 w-8",
                showFilters ? "text-primary" : "text-muted-foreground",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-8 w-[140px] text-xs"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-8 w-[140px] text-xs"
              />
              {(["todos", "diagnostico_ia", "informes"] as ContentFilter[]).map(
                (filter) => (
                  <Button
                    key={filter}
                    type="button"
                    size="sm"
                    variant={contentFilter === filter ? "default" : "outline"}
                    onClick={() => setContentFilter(filter)}
                    className="h-8 text-xs"
                  >
                    {filter === "todos"
                      ? "Todo"
                      : filter === "diagnostico_ia"
                        ? "Diagnóstico IA"
                        : "Informes"}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSortAsc((value) => !value)}
                className={cn(
                  "h-8 text-xs",
                  sortAsc ? "text-primary" : "text-muted-foreground",
                )}
              >
                <ArrowUpDown className="mr-1 h-4 w-4" />
                {sortAsc ? "Asc" : "Desc"}
              </Button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <X className="h-3 w-3" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No se encontraron visitas con los filtros aplicados.
          </p>
        ) : (
          <div className="space-y-4">
            {filtered.map((visit) => (
              <VisitCard
                key={visit.visita_id}
                patientId={patientId}
                visit={visit}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
