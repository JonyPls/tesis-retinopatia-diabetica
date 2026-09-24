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
      <DialogContent className="max-w-2xl rounded-xl border-slate-200/80 bg-white p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium tracking-tight text-slate-900">Comparar con otra visita</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed text-slate-500">
            Selecciona otra visita del mismo paciente para contrastarla con la visita actual.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm font-medium text-slate-900">
              No existen otras visitas disponibles para comparar.
            </p>
          </div>
        ) : (
          <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {candidates.map((visit) => {
              const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
              const diagnosisAvailable = hasDiagnosis(visit);

              return (
                <button
                  key={visit.visita_id}
                  type="button"
                  onClick={() => onSelect(Number(visit.visita_id))}
                  className="w-full rounded-xl border border-slate-200/80 bg-white p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <Calendar className="h-4 w-4 text-primary" />
                        {formatDate(visit.fecha_visita)}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {visit.medico_tratante || "Profesional no registrado"}
                      </p>
                      {visit.motivo_consulta && (
                        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                          {visit.motivo_consulta}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <Badge
                        variant="outline"
                        className={
                          diagnosisAvailable
                            ? "rounded-full border-amber-200 bg-amber-50 text-amber-700 shadow-none"
                            : "rounded-full border-slate-200 bg-transparent text-slate-500 shadow-none"
                        }
                      >
                        <Brain className="mr-1.5 h-3.5 w-3.5 text-amber-600" />
                        {diagnosisAvailable ? "Diagnóstico IA" : "Sin IA"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-primary/20 bg-primary/10 text-primary shadow-none"
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5 text-primary" />
                        {reportsCount} informe{reportsCount === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="outline" className="border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
