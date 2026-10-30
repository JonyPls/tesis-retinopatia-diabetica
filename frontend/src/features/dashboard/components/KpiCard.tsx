import { Card, CardContent } from "@/components/ui/card";
import { KpiItem } from "../types";

const toneClass: Record<KpiItem["tone"], string> = {
  teal: "bg-primary/10 text-primary",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

interface KpiCardProps {
  kpi: KpiItem;
}

export function KpiCard({ kpi }: KpiCardProps) {
  return (
    <Card className="h-full shadow-card transition-colors hover:border-primary/25">
      <CardContent className="p-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass[kpi.tone]}`}>
          <kpi.icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
          {kpi.value.toLocaleString("es-PE")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{kpi.label}</p>
      </CardContent>
    </Card>
  );
}
