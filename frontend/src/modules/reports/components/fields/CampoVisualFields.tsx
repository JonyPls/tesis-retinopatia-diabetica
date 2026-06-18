import { forwardRef, useImperativeHandle, useRef } from "react";
import { EyeToggle } from "../EyeToggle";
import { BulletedListEditor, BulletedListEditorHandle } from "../BulletedListEditor";

interface CampoVisualFieldsProps {
  ojos: string[];
  onOjosChange: (ojos: string[]) => void;
  campos: Record<string, Record<string, string>>;
  onCampoChange: (ojo: string, campo: string, valor: string) => void;
  conclusion: string[];
  onConclusionChange: (items: string[]) => void;
}

export interface CampoVisualFieldsHandle {
  flushConclusion: () => string[];
}

export const CampoVisualFields = forwardRef<CampoVisualFieldsHandle, CampoVisualFieldsProps>(
  ({ ojos, onOjosChange, campos, onCampoChange, conclusion, onConclusionChange }, ref) => {
    const conclusionRef = useRef<BulletedListEditorHandle>(null);

    useImperativeHandle(ref, () => ({
      flushConclusion: () => {
        if (conclusionRef.current) return conclusionRef.current.flush();
        return conclusion;
      },
    }));

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
            <div className="p-4 space-y-3">
              <CampoRow label="PROGRAMA">
                <input
                  type="text"
                  value={campos[ojo]?.["programa"] || ""}
                  onChange={(e) => onCampoChange(ojo, "programa", e.target.value)}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </CampoRow>

              <CampoRow label="FIJACIÓN">
                <input
                  type="text"
                  value={campos[ojo]?.["fijación"] || ""}
                  onChange={(e) => onCampoChange(ojo, "fijación", e.target.value)}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </CampoRow>

              <CampoRow label="COMPROBAR FIJACIÓN">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={campos[ojo]?.["comprobar_fijación"] || ""}
                    onChange={(e) => onCampoChange(ojo, "comprobar_fijación", e.target.value)}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-xs text-muted-foreground font-medium shrink-0 w-16 text-right">PÉRDIDAS</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={campos[ojo]?.["pérdidas"] || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) {
                        onCampoChange(ojo, "pérdidas", v);
                      }
                    }}
                    className="w-16 h-9 rounded-md border border-input bg-background px-2 py-1 text-sm text-center ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground w-4">%</span>
                </div>
              </CampoRow>

              <CampoRow label="FALSO POSITIVO">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={campos[ojo]?.["falso_positivo"] || ""}
                    onChange={(e) => onCampoChange(ojo, "falso_positivo", e.target.value)}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-xs text-muted-foreground font-medium shrink-0 w-16 text-right">ERROR</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={campos[ojo]?.["error"] || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) {
                        onCampoChange(ojo, "error", v);
                      }
                    }}
                    className="w-16 h-9 rounded-md border border-input bg-background px-2 py-1 text-sm text-center ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground w-4">%</span>
                </div>
              </CampoRow>

              <CampoRow label="FONDO">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={campos[ojo]?.["fondo"]?.replace(" cd/m2", "") || ""}
                    onChange={(e) => {
                      const num = e.target.value;
                      onCampoChange(ojo, "fondo", num ? `${num} cd/m2` : "");
                    }}
                    className="w-28 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-center ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground font-mono">cd/m²</span>
                </div>
              </CampoRow>

              <CampoRow label="PUNTOS PRESENTADOS">
                <input
                  type="number"
                  value={campos[ojo]?.["puntos_presentados"] || ""}
                  onChange={(e) => onCampoChange(ojo, "puntos_presentados", e.target.value)}
                  className="w-28 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-center ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </CampoRow>
            </div>
          </div>
        );
      })}

      <div className="border-t border-border pt-6">
        <label className="text-sm font-medium text-foreground mb-2 block">
          Conclusión
        </label>
        <BulletedListEditor
          ref={conclusionRef}
          items={conclusion}
          onChange={onConclusionChange}
          placeholder="Escriba un hallazgo y presione Enter para agregar otro..."
        />
      </div>
    </div>
  );
});

CampoVisualFields.displayName = "CampoVisualFields";

function CampoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-muted-foreground w-44 shrink-0">
        {label}
      </label>
      {children}
    </div>
  );
}
