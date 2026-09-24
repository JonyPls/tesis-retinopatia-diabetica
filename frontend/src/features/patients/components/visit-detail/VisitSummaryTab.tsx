import { Activity, Brain, Calendar, Eye, FileText, Stethoscope } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";
import type { Diagnosis } from "../../types";

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  const time = date.toLocaleTimeString("es-PE", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
  });

  return `${weekdays[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} · ${time}`;
}

function normalizeStatus(status?: string) {
  if (status === "ACTIVA") return "Activa";
  if (status === "CERRADA") return "Cerrada";
  if (status === "ANULADA") return "Anulada";
  return status ?? "Sin estado";
}

const SUMMARY_TONES = {
  primary: { card: "bg-primary/[0.035]", icon: "text-primary", label: "text-primary" },
  secondary: { card: "bg-secondary/[0.035]", icon: "text-secondary", label: "text-secondary" },
  success: { card: "bg-success/[0.04]", icon: "text-success", label: "text-success" },
  warning: { card: "bg-warning/[0.05]", icon: "text-warning", label: "text-amber-600" },
  slate: { card: "bg-slate-50/80", icon: "text-slate-400", label: "text-slate-400" },
} as const;

function SummaryItem({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: typeof Calendar;
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof SUMMARY_TONES;
}) {
  const t = SUMMARY_TONES[tone];
  return (
    <div className={`rounded-xl border border-slate-200/80 p-5 shadow-none ${t.card}`}>
      <div className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest ${t.label}`}>
        <Icon className={`h-3.5 w-3.5 ${t.icon}`} />
        {label}
      </div>
      <div className="mt-1.5 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function eyeShortLabel(eye: string) {
  if (eye === "Derecho" || eye === "OD") return "Derecho";
  if (eye === "Izquierdo" || eye === "OI") return "Izquierdo";
  return eye;
}

function EyeListValue({ eyes }: { eyes: string[] }) {
  if (eyes.length === 0) return <span className="text-slate-400">Ninguno</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {eyes.map((eye) => (
        <span
          key={eye}
          className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"
        >
          {eye}
        </span>
      ))}
    </div>
  );
}

export function VisitSummaryTab({ visit }: { visit: Diagnosis }) {
  const diagnosis = visit.diagnostico_ia;
  const details = diagnosis?.detalles ?? [];
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
  const validationEyes = details.reduce(
    (acc, detail) => {
      const eye = eyeShortLabel(detail.ojo_evaluado);
      if (detail.estado_validacion === "APROBADO") acc.approved.push(eye);
      if (detail.estado_validacion === "CORREGIDO") acc.corrected.push(eye);
      if (detail.estado_validacion === "PENDIENTE") acc.pending.push(eye);
      return acc;
    },
    { approved: [] as string[], corrected: [] as string[], pending: [] as string[] },
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryItem icon={Calendar} label="Fecha" tone="primary" value={formatDate(visit.fecha_visita)} />
        <SummaryItem
          icon={Stethoscope}
          label="Atendido por"
          tone="secondary"
          value={visit.medico_tratante || "Profesional no registrado"}
        />
        <SummaryItem icon={Activity} label="Estado" tone="success" value={normalizeStatus(visit.estado)} />
        <SummaryItem
          icon={Brain}
          label="Diagnóstico IA"
          tone="warning"
          value={diagnosis ? "Registrado" : "Sin evaluación IA"}
        />
      </div>

      {(visit.maxima_gravedad !== null ||
        details.length > 0 ||
        reportsCount > 0 ||
        visit.motivo_consulta) && (
        <Card className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <CardContent className="p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <p className="text-[12px] font-medium uppercase tracking-widest text-primary">Resumen clínico</p>
                {visit.motivo_consulta && (
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                    {visit.motivo_consulta}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                {visit.maxima_gravedad !== null && visit.maxima_gravedad !== undefined && (
                  <RDLevelBadge level={visit.maxima_gravedad as RDLevel} size="sm" />
                )}
                {details.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    {details.length} ojo{details.length === 1 ? "" : "s"} evaluado
                    {details.length === 1 ? "" : "s"}
                  </span>
                )}
                {reportsCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary">
                    <FileText className="h-3.5 w-3.5 text-secondary" />
                    {reportsCount} informe{reportsCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>

            {details.length > 0 && (
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <SummaryItem icon={Activity} label="Validados" tone="success" value={<EyeListValue eyes={validationEyes.approved} />} />
                <SummaryItem icon={Activity} label="Corregidos" tone="warning" value={<EyeListValue eyes={validationEyes.corrected} />} />
                <SummaryItem icon={Activity} label="Pendientes" tone="slate" value={<EyeListValue eyes={validationEyes.pending} />} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {visit.observaciones && (
        <Card className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <CardContent className="p-6 sm:p-8">
            <p className="text-[11px] font-medium uppercase tracking-widest text-secondary">Observaciones</p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              {visit.observaciones}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
