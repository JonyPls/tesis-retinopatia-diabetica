import { KpiItem } from "../types";
import { KpiCard } from "./KpiCard";

interface KpiGridProps {
  kpis: KpiItem[];
}

export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 mb-6">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} kpi={kpi} />
      ))}
    </div>
  );
}
