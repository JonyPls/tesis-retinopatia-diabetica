import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  Calendar,
  User,
  Brain,
  FileText,
  ArrowRight,
  SlidersHorizontal,
  ArrowUpDown,
  X,
} from "lucide-react";
import { Diagnosis } from "../types";

interface PatientTimelineProps {
  diagnoses: Diagnosis[];
  sortedDx: Diagnosis[];
  className?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PatientTimeline({
  diagnoses,
  sortedDx,
  className,
}: PatientTimelineProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortAsc, setSortAsc] = useState(false);

  const toDateKey = (iso: string) => iso.split("T")[0].split(" ")[0];

  const filtered = useMemo(() => {
    let list = [...sortedDx];

    if (dateFrom) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) <= dateTo);
    }

    if (sortAsc) {
      list.sort(
        (a, b) =>
          new Date(a.fecha_visita).getTime() -
          new Date(b.fecha_visita).getTime(),
      );
    }

    return list;
  }, [sortedDx, dateFrom, dateTo, sortAsc]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSortAsc(false);
  };

  const hasActiveFilters = dateFrom || dateTo || sortAsc;

  if (diagnoses.length === 0) {
    return (
      <Card className={`shadow-card ${className || ""}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Historial de Visitas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10">
            <p className="text-muted-foreground text-sm">
              Aún no hay visitas registradas para este paciente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`shadow-card ${className || ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Historial de Visitas
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {sortedDx.length} visita(s) · Últimos diagnósticos registrados
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className={showFilters ? "text-primary" : "text-muted-foreground"}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {showFilters && (
          <>
            <div className="h-px bg-border my-3" />
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="Desde"
                className="h-8 w-[140px] text-xs"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="Hasta"
                className="h-8 w-[140px] text-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSortAsc((v) => !v)}
                className={sortAsc ? "text-primary" : "text-muted-foreground"}
              >
                <ArrowUpDown className="h-4 w-4 mr-1" />
                <span className="text-xs">{sortAsc ? "Asc" : "Desc"}</span>
              </Button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Limpiar
                </button>
              )}
            </div>
            <div className="h-px bg-border mt-3" />
          </>
        )}
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No se encontraron visitas en este rango de fechas.
            </p>
          ) : (
            filtered.map((dx) => (
              <div
                key={dx.diagnostico_id}
                className="rounded-lg border border-border bg-card p-4 hover:shadow-elevated transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                      {formatDate(dx.fecha_visita)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      {dx.medico_tratante || "Desconocido"}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {dx.tiene_informes === 1 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium">
                        <FileText className="h-3 w-3" />
                        Informes
                      </span>
                    )}
                    {dx.tiene_diagnostico_ia === 1 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">
                        <Brain className="h-3 w-3" />
                        Diagnóstico IA
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-end mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                  >
                    Ver detalles
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
