import { VisitStatusBadge } from "@/components/medical/VisitStatusBadge";

interface VisitContextBandProps {
  fecha: string;
  medico?: string | null;
  estado?: string | null;
}

function ContextItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

export function VisitContextBand({
  fecha,
  medico,
  estado,
}: VisitContextBandProps) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
      <ContextItem label="Fecha y hora">{fecha}</ContextItem>
      <ContextItem label="Atendido por">
        {medico || "Profesional no registrado"}
      </ContextItem>
      <ContextItem label="Estado">
        {estado ? (
          <VisitStatusBadge status={estado} />
        ) : (
          <span className="font-normal text-muted-foreground">Sin estado</span>
        )}
      </ContextItem>
    </div>
  );
}
