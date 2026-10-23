import { Card, CardContent } from "@/components/ui/card";
import { KpiItem } from "../types";

interface KpiCardProps {
  kpi: KpiItem;
}

export function KpiCard({ kpi }: KpiCardProps) {
  return (
    <Card className="shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <kpi.icon className="h-5 w-5" />
          </div>
          <span className="text-sm text-muted-foreground">{kpi.label}</span>
        </div>
        <p className="mt-4 text-3xl font-semibold tabular-nums text-foreground">
          {kpi.value.toLocaleString("es-PE")}
        </p>
      </CardContent>
    </Card>
  );
}
