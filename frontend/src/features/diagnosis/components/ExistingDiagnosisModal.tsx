import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DetalleDiagnosticoExistente } from "@/features/diagnosis/api/diagnosisService";
import { Eye, ImageIcon, MessageSquare } from "lucide-react";

const RD_TEXT: Record<number, string> = {
  0: "Normal",
  1: "RD Leve",
  2: "RD Moderado",
  3: "RD Severo",
  4: "RD Proliferativa",
};

interface ExistingDiagnosisModalProps {
  open: boolean;
  detalles: DetalleDiagnosticoExistente[];
  onGoToStep2: () => void;
  onGoToStep3: () => void;
  onCancel: () => void;
}

export function ExistingDiagnosisModal({
  open,
  detalles,
  onGoToStep2,
  onGoToStep3,
  onCancel,
}: ExistingDiagnosisModalProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Eye className="h-5 w-5 text-primary" />
            Diagnóstico IA Existente
          </DialogTitle>
          <DialogDescription>
            Este paciente ya tiene un diagnóstico IA registrado en la visita seleccionada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm font-medium text-muted-foreground">
            Ojos evaluados:
          </p>

          {detalles.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Ningún ojo evaluado previamente.</p>
          ) : (
            <div className="space-y-2">
              {detalles.map((d) => (
                <div
                  key={d.detalle_id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Eye className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">
                      {d.ojo === "OD" ? "Ojo Derecho (OD)" : "Ojo Izquierdo (OI)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Nivel {d.resultado_ia}: {d.diagnostico_texto || RD_TEXT[d.resultado_ia] || "Desconocido"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/80">
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        Confianza: {d.confianza_general?.toFixed(1)}%
                      </span>
                      {d.estado_validacion && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {d.estado_validacion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-sm font-medium">¿Qué deseas hacer?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onGoToStep2} className="whitespace-nowrap">
              <ImageIcon className="h-4 w-4 mr-1.5 shrink-0" />
              <span className="text-xs sm:text-sm">Subir o Cambiar Imágenes</span>
              {/* <span className="text-[10px] ml-1 opacity-70">→ Paso 2</span> */}
            </Button>
            <Button onClick={onGoToStep3} className="whitespace-nowrap">
              <MessageSquare className="h-4 w-4 mr-1.5 shrink-0" />
              <span className="text-xs sm:text-sm">Modificar Resultados</span>
              {/* <span className="text-[10px] ml-1 opacity-70">→ Paso 3</span> */}
            </Button>
          </div>
          <Button variant="ghost" onClick={onCancel} className="w-full text-xs text-foreground">
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}