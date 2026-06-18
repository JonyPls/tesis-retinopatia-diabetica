import { useMemo } from "react";
import { EyeToggle } from "../EyeToggle";
import { MultiSelectField } from "../MultiSelectField";
import { CUADRANTES, CUADRANTE_LABELS, GRADOS, GONIOSCOPIA_CONCLUSIONES } from "../../types";

interface GonioscopiaFieldsProps {
  ojos: string[];
  onOjosChange: (ojos: string[]) => void;
  grados: Record<string, Record<string, string>>;
  onGradoChange: (ojo: string, cuadrante: string, grado: string) => void;
  conclusiones: string[];
  onConclusionesChange: (values: string[]) => void;
}

export function GonioscopiaFields({
  ojos,
  onOjosChange,
  grados,
  onGradoChange,
  conclusiones,
  onConclusionesChange,
}: GonioscopiaFieldsProps) {
  const filteredConclusiones = useMemo(() => {
    const grupos: string[] = [];
    const hasOD = ojos.includes("OD");
    const hasOI = ojos.includes("OI");
    if (hasOD && hasOI) grupos.push("AO");
    if (hasOD) grupos.push("OD");
    if (hasOI) grupos.push("OI");
    return GONIOSCOPIA_CONCLUSIONES.filter((o) => grupos.includes(o.group || ""));
  }, [ojos]);

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
            <div className="grid grid-cols-[80px_repeat(4,1fr)] gap-1">
              <div className="text-xs font-medium text-muted-foreground self-center" />
              {GRADOS.map((g) => (
                <div
                  key={g}
                  className="text-center text-xs font-semibold text-muted-foreground py-1"
                >
                  Grado {g}
                </div>
              ))}

              {CUADRANTES.map((cuadrante) => (
                <div key={cuadrante} className="contents">
                  <div className="text-xs font-medium text-muted-foreground self-center">
                    {CUADRANTE_LABELS[cuadrante]}
                  </div>
                  {GRADOS.map((grado) => {
                    const active = grados[ojo]?.[cuadrante] === grado;
                    return (
                      <button
                        key={grado}
                        type="button"
                        onClick={() => onGradoChange(ojo, cuadrante, grado)}
                        className={`h-10 rounded-lg text-sm font-medium transition-all ${
                          active
                            ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        }`}
                      >
                        {grado}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })}

      <div className="border-t border-border pt-6">
        <MultiSelectField
          label="Conclusión"
          options={filteredConclusiones}
          selected={conclusiones}
          onSelectionChange={onConclusionesChange}
          placeholder="Buscar opción de conclusión..."
        />
      </div>
    </div>
  );
}
