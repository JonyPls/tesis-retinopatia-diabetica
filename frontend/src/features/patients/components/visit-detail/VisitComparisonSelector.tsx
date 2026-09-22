import { Brain, Calendar, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Diagnosis } from "../../types";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hasDiagnosis(visit: Diagnosis) {
  return Number(visit.tiene_diagnostico_ia) === 1 || Boolean(visit.diagnostico_ia);
}

export function VisitComparisonSelector({
  currentVisitId,
  onOpenChange,
  onSelect,
  open,
  visits,
}: {
  currentVisitId: number;
  onOpenChange: (open: boolean) => void;
  onSelect: (visitId: number) => void;
  open: boolean;
  visits: Diagnosis[];
}) {
  const candidates = [...visits]
    .filter((visit) => Number(visit.visita_id) !== Number(currentVisitId))
    .sort(
      (a, b) =>
        new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comparar con otra visita</DialogTitle>
          <DialogDescription>
            Selecciona otra visita del mismo paciente para contrastarla con la visita actual.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <p className="text-sm font-semibold text-foreground">
              No existen otras visitas disponibles para comparar.
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {candidates.map((visit) => {
              const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
              const diagnosisAvailable = hasDiagnosis(visit);

              return (
                <button
                  key={visit.visita_id}
                  type="button"
                  onClick={() => onSelect(Number(visit.visita_id))}
                  className="w-full rounded-md border border-border bg-background p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Calendar className="h-4 w-4 text-primary" />
                        {formatDate(visit.fecha_visita)}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {visit.medico_tratante || "Profesional no registrado"}
                      </p>
                      {visit.motivo_consulta && (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {visit.motivo_consulta}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                      <Badge
                        variant="outline"
                        className={
                          diagnosisAvailable
                            ? "rounded-md border-amber-200 bg-amber-50 text-amber-700"
                            : "rounded-md border-border bg-muted/35 text-muted-foreground"
                        }
                      >
                        <Brain className="mr-1 h-3.5 w-3.5" />
                        {diagnosisAvailable ? "Diagnóstico IA" : "Sin IA"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-md border-primary/20 bg-primary/10 text-primary"
                      >
                        <FileText className="mr-1 h-3.5 w-3.5" />
                        {reportsCount} informe{reportsCount === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
