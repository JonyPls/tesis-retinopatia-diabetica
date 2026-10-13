import { Calendar, Plus, Check, User, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clinicalDayKey, formatClinicalDay, unknownClinicalDate } from "@/lib/clinicalDates";
import { DiagnosticoVisita } from "@/features/patients/api/patientService";

interface VisitaSelectorProps {
  visitas: DiagnosticoVisita[];
  selectedVisitaId: number | null | undefined;
  onSelect: (visita: DiagnosticoVisita | null) => void;
  hasMore: boolean;
  expandida: boolean;
  onVerMas: () => void;
  onVerMenos: () => void;
  pacienteSeleccionado: boolean;
  cargandoVisitas: boolean;
}

function daysAgo(dateStr: string): string {
  const today = clinicalDayKey(new Date().toISOString());
  const visitDay = clinicalDayKey(dateStr);
  if (!visitDay || !today) return unknownClinicalDate;
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${visitDay}T00:00:00Z`)) / 86400000;
  if (diff === 0) return "HOY";
  if (diff === 1) return "AYER";
  return `HACE ${diff} DÍAS`;
}

function formatDate(dateStr: string): string {
  return formatClinicalDay(dateStr);
}

export function VisitaSelector({ visitas, selectedVisitaId, onSelect, hasMore, expandida, onVerMas, onVerMenos, pacienteSeleccionado, cargandoVisitas }: VisitaSelectorProps) {
  const isNew = selectedVisitaId === -1;

  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden flex flex-col ${!pacienteSeleccionado ? "min-h-[320px]" : ""}`}>
      <div className="bg-muted/50 px-5 py-3.5 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Calendar className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Seleccionar Visita Clínica</h3>
          <p className="text-xs text-muted-foreground">
            Elige una visita existente o crea una nueva
          </p>
        </div>
      </div>

      <div className="p-4 space-y-2 flex-1">
        {!pacienteSeleccionado ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <User className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Seleccione primero un paciente
              </p>
              <p className="text-xs text-muted-foreground/70">
                para visualizar sus visitas previas
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Nueva Visita — siempre visible */}
            <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
            isNew
              ? "border-primary bg-primary/[0.03]"
              : "border-border bg-card hover:border-primary/40",
          )}
        >
          <div className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center",
            isNew ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}>
            <Plus className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Nueva Visita</p>
            <p className="text-xs text-muted-foreground">Crear una nueva atención clínica</p>
          </div>
          {isNew && (
            <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
        </button>

        {/* Visitas existentes */}
        {visitas.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-2 pb-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
                Visitas recientes
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
              {visitas.map((v) => {
                const active = selectedVisitaId === v.visita_id;
                return (
                  <button
                    key={v.visita_id}
                    type="button"
                    onClick={() => onSelect(v)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                      active
                        ? "border-primary bg-primary/[0.03]"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <div className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center",
                      active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}>
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{formatDate(v.fecha_visita)}</p>
                      <p className="text-xs text-muted-foreground truncate">{v.medico_tratante}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                        {daysAgo(v.fecha_visita)}
                      </span>
                    </div>
                    {active && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {hasMore && !expandida && (
              <button
                type="button"
                onClick={onVerMas}
                className="w-full text-center py-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Ver más visitas →
              </button>
            )}
            {expandida && (
              <button
                type="button"
                onClick={onVerMenos}
                className="w-full text-center py-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                ← Ver menos visitas
              </button>
            )}
          </>
        )}

          {cargandoVisitas && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando visitas...
            </div>
          )}

          {pacienteSeleccionado && !cargandoVisitas && visitas.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-5">
            No hay visitas previas registradas
          </p>
        )}
          </>
        )}
      </div>
    </div>
  );
}
