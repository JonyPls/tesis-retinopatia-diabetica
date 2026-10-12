import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpDown,
  Brain,
  Calendar,
  FileText,
  SlidersHorizontal,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { VisitStatusBadge } from "@/components/medical/VisitStatusBadge";
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

function VisitCard({
  patientId,
  visit,
}: {
  patientId?: string | number;
  visit: Diagnosis;
}) {
  const reports = visit.informes ?? [];
  const hasIa = Number(visit.tiene_diagnostico_ia) === 1;
  const reportsCount = reports.length || Number(visit.tiene_informes) || 0;
  const target = patientId
    ? `/pacientes/${patientId}/visitas/${visit.visita_id}`
    : null;

  const content = (
    <div className="flex w-full flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-base font-semibold text-foreground">
            {formatDate(visit.fecha_visita)}
          </p>
          {visit.maxima_gravedad !== null &&
            visit.maxima_gravedad !== undefined && (
              <span title="Grado máximo registrado; puede incluir predicciones IA sin validación médica">
                <RDLevelBadge level={visit.maxima_gravedad as RDLevel} size="sm" />
              </span>
            )}
          <VisitStatusBadge status={visit.estado} />
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <User className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {visit.medico_tratante || "Profesional no registrado"}
          </span>
        </div>

        {visit.motivo_consulta && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {visit.motivo_consulta}
          </p>
        )}
      </div>

      {(hasIa || reportsCount > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground lg:justify-end">
          {hasIa && (
            <span className="inline-flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              Diagnóstico IA
            </span>
          )}
          {reportsCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {reportsCount} informe{reportsCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-lg border border-border bg-card transition-colors",
        target
          ? "hover:border-primary/30 hover:bg-primary/[0.02]"
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
      diagnosticos: diagnoses.filter(
        (dx) => Number(dx.tiene_diagnostico_ia) === 1,
      ).length,
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
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Aún no hay visitas registradas para este paciente.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("shadow-card", className)}>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              {totals.diagnosticos} con diagnóstico IA
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {totals.informes} informes
            </span>
          </div>

          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </Button>
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
          <div className="space-y-3">
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
