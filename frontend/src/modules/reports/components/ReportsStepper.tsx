import { ClipboardList, Search, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, label: "Tipo de Informe", icon: ClipboardList },
  { n: 2, label: "Paciente", icon: Search },
  { n: 3, label: "Informe", icon: FileText },
];

interface ReportsStepperProps {
  step: number;
}

export function ReportsStepper({ step }: ReportsStepperProps) {
  return (
    <Card className="shadow-card mb-6">
      <CardContent className="p-5">
        <div className="flex items-center">
          {STEPS.map((s, idx) => {
            const done = step > s.n;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all border-2",
                      done && "bg-primary text-primary-foreground border-primary",
                      active && "bg-primary text-primary-foreground border-primary shadow-elevated animate-pulse-ring",
                      !done && !active && "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    <s.icon className="h-4 w-4" />
                  </div>
                  <div className="hidden sm:block">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Paso {s.n}
                    </div>
                    <div
                      className={cn(
                        "text-sm font-medium",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </div>
                  </div>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-px mx-4 transition-colors",
                      step > s.n ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
