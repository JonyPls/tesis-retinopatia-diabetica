import { cn } from "@/lib/utils";

// 1. Actualizamos el tipo a términos clínicos oftalmológicos
export type Status = "Normal" | "Seguimiento" | "Crítico" | "Sin Evaluar";

// 2. Mapeamos los colores (Verde, Amarillo/Naranja, Rojo)
const map: Record<Status, string> = {
  Normal: "bg-emerald-100 text-emerald-700 border-emerald-200", 
  Seguimiento: "bg-amber-100 text-amber-700 border-amber-200",
  Crítico: "bg-red-100 text-red-700 border-red-200",
  "Sin Evaluar": "bg-gray-100 text-slate-700 border-slate-200",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        map[status]
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
