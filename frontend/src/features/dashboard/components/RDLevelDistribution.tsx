import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RDLevelRow } from "../types";

const staticData: RDLevelRow[] = [
  { level: 0, label: "Sin Retinopatía", count: 17, pct: 29 },
  { level: 1, label: "RD Leve", count: 24, pct: 42 },
  { level: 2, label: "RD Moderada", count: 9, pct: 15 },
  { level: 3, label: "RD Severa", count: 5, pct: 8 },
  { level: 4, label: "RD Proliferativa", count: 2, pct: 3 },
];

export function RDLevelDistribution() {
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Distribución por Nivel RD</CardTitle>
        <p className="text-xs text-muted-foreground">
          Diagnósticos del mes en curso
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {staticData.map((row) => (
          <div key={row.level}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium">
                N{row.level} · {row.label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {row.count}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${row.pct}%`,
                  backgroundColor: `hsl(var(--rd-${row.level}))`,
                }}
              />
            </div>
          </div>
        ))}
        <div className="pt-3 mt-3 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total mes</span>
            <span className="font-semibold">57 evaluaciones</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
