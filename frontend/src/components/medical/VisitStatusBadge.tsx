import { cn } from "@/lib/utils";

const VISIT_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVA: { label: "Activa", tone: "text-success" },
  CERRADA: { label: "Cerrada", tone: "text-muted-foreground" },
  ANULADA: { label: "Anulada", tone: "text-destructive" },
};

interface VisitStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export function VisitStatusBadge({ status, className }: VisitStatusBadgeProps) {
  if (!status) return null;
  const entry = VISIT_STATUS[status] ?? {
    label: status,
    tone: "text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        entry.tone,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {entry.label}
    </span>
  );
}
