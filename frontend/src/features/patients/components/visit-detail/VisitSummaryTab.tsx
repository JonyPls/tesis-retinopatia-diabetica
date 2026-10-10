import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import type { Diagnosis } from "../../types";

function eyeShortLabel(eye: string) {
  if (eye === "Derecho" || eye === "OD") return "Derecho";
  if (eye === "Izquierdo" || eye === "OI") return "Izquierdo";
  return eye;
}

function EyeList({ eyes }: { eyes: string[] }) {
  if (eyes.length === 0) {
    return <span className="text-sm text-muted-foreground">Ninguno</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 sm:justify-end">
      {eyes.map((eye) => (
        <span
          key={eye}
          className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {eye}
        </span>
      ))}
    </div>
  );
}

function ValidationRow({
  label,
  eyes,
  tone,
}: {
  label: string;
  eyes: string[];
  tone: "success" | "warning" | "muted";
}) {
  const dot = {
    success: "bg-success",
    warning: "bg-warning",
    muted: "bg-muted-foreground",
  }[tone];

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </span>
      <EyeList eyes={eyes} />
    </div>
  );
}

export function VisitSummaryTab({ visit }: { visit: Diagnosis }) {
  const diagnosis = visit.diagnostico_ia;
  const details = diagnosis?.detalles ?? [];
  const validationEyes = details.reduce(
    (acc, detail) => {
      const eye = eyeShortLabel(detail.ojo_evaluado);
      if (detail.estado_validacion === "APROBADO") acc.approved.push(eye);
      if (detail.estado_validacion === "CORREGIDO") acc.corrected.push(eye);
      if (detail.estado_validacion === "PENDIENTE") acc.pending.push(eye);
      return acc;
    },
    {
      approved: [] as string[],
      corrected: [] as string[],
      pending: [] as string[],
    },
  );

  const hasValidation =
    validationEyes.approved.length > 0 ||
    validationEyes.corrected.length > 0 ||
    validationEyes.pending.length > 0;
  const hasMaxGrade =
    visit.maxima_gravedad !== null && visit.maxima_gravedad !== undefined;

  const isEmpty =
    !visit.motivo_consulta &&
    !visit.observaciones &&
    !hasValidation &&
    !hasMaxGrade;

  return (
    <div className="space-y-6">
      {visit.motivo_consulta && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            Motivo de consulta
          </h3>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {visit.motivo_consulta}
          </p>
        </section>
      )}

      {hasMaxGrade && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            Grado máximo registrado
          </h3>
          <RDLevelBadge level={visit.maxima_gravedad as RDLevel} size="sm" />
        </section>
      )}

      {hasValidation && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              Estado de validación
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Validación médica por ojo evaluado.
            </p>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <ValidationRow
              label="Validados"
              eyes={validationEyes.approved}
              tone="success"
            />
            <ValidationRow
              label="Corregidos"
              eyes={validationEyes.corrected}
              tone="warning"
            />
            <ValidationRow
              label="Pendientes"
              eyes={validationEyes.pending}
              tone="muted"
            />
          </div>
        </section>
      )}

      {visit.observaciones && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Observaciones</h3>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {visit.observaciones}
          </p>
        </section>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          No hay información clínica adicional registrada en esta visita.
        </p>
      )}
    </div>
  );
}
