import type { ReactNode } from "react";
import { StatusBadge, type Status } from "@/components/medical/StatusBadge";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";

interface PatientSummaryBandProps {
  status: Status;
  maxRdLevel: number;
  hasRdData: boolean;
  lastVisit: string;
  visitCount: number;
}

function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

export function PatientSummaryBand({
  status,
  maxRdLevel,
  hasRdData,
  lastVisit,
  visitCount,
}: PatientSummaryBandProps) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      <SummaryItem label="Estado">
        <StatusBadge status={status} />
      </SummaryItem>
      <SummaryItem label="Máximo grado RD">
        {hasRdData ? (
          <RDLevelBadge level={maxRdLevel as RDLevel} size="sm" />
        ) : (
          <span className="font-normal text-muted-foreground">
            Sin registro IA
          </span>
        )}
      </SummaryItem>
      <SummaryItem label="Última visita">{lastVisit}</SummaryItem>
      <SummaryItem label="Visitas">
        <span className="tabular-nums">{visitCount}</span>
      </SummaryItem>
    </div>
  );
}
