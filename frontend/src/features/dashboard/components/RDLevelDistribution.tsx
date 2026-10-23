import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RDLevelRow } from "../types";

export function RDLevelDistribution({ rows }: { rows: RDLevelRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Distribución de gravedad por ojo validado</CardTitle>
        <p className="text-xs text-muted-foreground">
          Resultados finales validados · conteo acumulado de ojos, no de pacientes
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">
          Todavía no hay resultados validados para mostrar
        </p> : rows.map((row) => (
          <div key={row.level}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium">
                N{row.level} · {row.label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {row.count} {row.count === 1 ? "ojo" : "ojos"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(row.count / total) * 100}%`,
                  backgroundColor: `hsl(var(--rd-${row.level}))`,
                }}
              />
            </div>
          </div>
        ))}
        <div className="pt-3 mt-3 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total de ojos validados</span>
            <span className="font-semibold tabular-nums">{total.toLocaleString("es-PE")} ojos validados</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
