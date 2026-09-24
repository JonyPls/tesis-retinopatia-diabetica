import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TipoInforme } from "../types";
import { getReportTypePresentation } from "../reportTypePresentation";

interface TypeSelectorProps {
  tipos: TipoInforme[];
  selectedIds: number[];
  onToggle: (tipo: TipoInforme) => void;
}

export function TypeSelector({ tipos, selectedIds, onToggle }: TypeSelectorProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tipos.map((tipo) => {
        const selected = selectedIds.includes(tipo.id);
        const cfg = getReportTypePresentation(tipo.id);
        return (
          <button
            key={tipo.id}
            type="button"
            onClick={() => onToggle(tipo)}
            className={cn(
              "relative rounded-xl border-2 p-5 text-left shadow-sm transition-all duration-200 flex flex-col items-start h-full",
              selected
                ? "border-primary bg-primary/[0.03] shadow-md"
                : "border-border bg-card hover:border-primary/40 hover:shadow-md",
            )}
          >
            {/* Checkmark badge */}
            <div
              className={cn(
                "absolute top-3 right-3 h-6 w-6 rounded-full flex items-center justify-center transition-all duration-200",
                selected ? "bg-primary text-primary-foreground scale-100" : "scale-0",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </div>

            {/* Icon */}
            <div
              className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center mb-3",
                cfg?.bg || "bg-muted",
                cfg?.color || "text-muted-foreground",
              )}
            >
              {cfg.icon}
            </div>

            {/* Title */}
            <h3
              className={cn(
                "font-semibold text-sm transition-colors",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {tipo.nombre}
            </h3>

            {/* Description */}
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed flex-1">
              {tipo.descripcion}
            </p>
          </button>
        );
      })}
    </div>
  );
}
