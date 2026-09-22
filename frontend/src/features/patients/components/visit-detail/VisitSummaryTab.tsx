import { Activity, Brain, Calendar, Eye, FileText, Stethoscope } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";
import type { Diagnosis } from "../../types";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(status?: string) {
  if (status === "ACTIVA") return "Activa";
  if (status === "CERRADA") return "Cerrada";
  if (status === "ANULADA") return "Anulada";
  return status ?? "Sin estado";
}

function SummaryItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function VisitSummaryTab({ visit }: { visit: Diagnosis }) {
  const diagnosis = visit.diagnostico_ia;
  const details = diagnosis?.detalles ?? [];
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
  const validationCounts = details.reduce(
    (acc, detail) => {
      if (detail.estado_validacion === "APROBADO") acc.approved += 1;
      if (detail.estado_validacion === "CORREGIDO") acc.corrected += 1;
      if (detail.estado_validacion === "PENDIENTE") acc.pending += 1;
      return acc;
    },
    { approved: 0, corrected: 0, pending: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryItem icon={Calendar} label="Fecha" value={formatDate(visit.fecha_visita)} />
        <SummaryItem
          icon={Stethoscope}
          label="Profesional"
          value={visit.medico_tratante || "Profesional no registrado"}
        />
        <SummaryItem icon={Activity} label="Estado" value={normalizeStatus(visit.estado)} />
        <SummaryItem
          icon={Brain}
          label="Diagnóstico IA"
          value={diagnosis ? "Registrado" : "Sin evaluación IA"}
        />
      </div>

      {(visit.maxima_gravedad !== null ||
        details.length > 0 ||
        reportsCount > 0 ||
        visit.motivo_consulta) && (
        <Card className="border-border shadow-card">
          <CardContent className="p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Resumen clínico</p>
                {visit.motivo_consulta && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {visit.motivo_consulta}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                {visit.maxima_gravedad !== null && visit.maxima_gravedad !== undefined && (
                  <RDLevelBadge level={visit.maxima_gravedad as RDLevel} size="sm" />
                )}
                {details.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/35 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" />
                    {details.length} ojo{details.length === 1 ? "" : "s"} evaluado
                    {details.length === 1 ? "" : "s"}
                  </span>
                )}
                {reportsCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    <FileText className="h-3.5 w-3.5" />
                    {reportsCount} informe{reportsCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>

            {details.length > 0 && (
              <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
                <SummaryItem icon={Activity} label="Validados" value={validationCounts.approved} />
                <SummaryItem icon={Activity} label="Corregidos" value={validationCounts.corrected} />
                <SummaryItem icon={Activity} label="Pendientes" value={validationCounts.pending} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {visit.observaciones && (
        <Card className="border-border shadow-card">
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-foreground">Observaciones</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {visit.observaciones}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
