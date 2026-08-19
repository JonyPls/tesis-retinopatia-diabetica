import { EyeToggle } from "../EyeToggle";

interface PaquimetriaFieldsProps {
  ojos: string[];
  onOjosChange: (ojos: string[]) => void;
  valores: Record<string, string>;
  onValorChange: (ojo: string, valor: string) => void;
}

export function PaquimetriaFields({ ojos, onOjosChange, valores, onValorChange }: PaquimetriaFieldsProps) {
  return (
    <div className="space-y-6">
      <EyeToggle ojos={ojos} onChange={onOjosChange} />

      {(["OD", "OI"] as const).map((ojo) => {
        if (!ojos.includes(ojo)) return null;
        return (
          <div key={ojo} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 border-b border-border">
              <span className="text-sm font-semibold">
                {ojo === "OD" ? "Ojo Derecho (OD)" : "Ojo Izquierdo (OI)"}
              </span>
            </div>
            <div className="p-4">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Grosor corneal central
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={valores[ojo] || ""}
                  onChange={(e) => onValorChange(ojo, e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-28 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-center font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-sm text-muted-foreground font-medium">µm</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
