import { Eye } from "lucide-react";

interface EyeToggleProps {
  ojos: string[];
  onChange: (ojos: string[]) => void;
}

const OPCIONES = [
  { key: "OD", label: "Ojo Derecho" },
  { key: "OI", label: "Ojo Izquierdo" },
];

export function EyeToggle({ ojos, onChange }: EyeToggleProps) {
  const toggle = (key: string) => {
    if (ojos.includes(key)) {
      const next = ojos.filter((o) => o !== key);
      onChange(next.length === 0 ? [key] : next);
    } else {
      onChange([...ojos, key]);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Eye className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium text-muted-foreground mr-1">
        Ojos evaluados:
      </span>
      {OPCIONES.map((opt) => {
        const active = ojos.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggle(opt.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
