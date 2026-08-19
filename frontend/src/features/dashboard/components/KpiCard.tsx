import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpRight, TrendingUp } from "lucide-react";
import { KpiItem } from "../types";

const toneCls = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
};

interface KpiCardProps {
  kpi: KpiItem;
}

export function KpiCard({ kpi }: KpiCardProps) {
  return (
    <Card className="shadow-card hover:shadow-elevated transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneCls[kpi.tone]}`}
          >
            <kpi.icon className="h-5 w-5" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-4">
          <div className="text-3xl font-semibold tracking-tight text-foreground">
            {kpi.value}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {kpi.label}
          </div>
          <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {kpi.delta}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
