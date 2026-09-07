import { Info, Sparkles, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeKey, EyeState } from "../types";
import { DropZone } from "./DropZone";

interface ImageUploaderProps {
  eyes: Record<EyeKey, EyeState>;
  handleFile: (eye: EyeKey, file?: File) => void;
  clearEye: (eye: EyeKey) => void;
  onAutoSelect?: () => void;
  isAutoSelecting?: boolean;
  embedded?: boolean;
}

export function ImageUploader({
  eyes,
  handleFile,
  clearEye,
  onAutoSelect,
  isAutoSelecting = false,
  embedded = false,
}: ImageUploaderProps) {
  const loadedCount = (["OD", "OI"] as EyeKey[]).filter(
    (e) => eyes[e].file !== null,
  ).length;

  const content = (
    <>
      {!embedded && (
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-primary" />
            Imágenes de Fondo de Ojo
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Suba las imágenes de fondo de ojo. Puede cargar ambos ojos en el mismo diagnóstico.
          </p>
        </CardHeader>
      )}

      <CardContent className={embedded ? "space-y-5 p-0" : "space-y-5"}>
        {embedded && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Imágenes a evaluar</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Puede cargar OD, OI o ambos ojos dentro de la misma visita clínica.
              </p>
            </div>
            <Button
              type="button"
              onClick={onAutoSelect}
              disabled={isAutoSelecting || !onAutoSelect}
              className="shrink-0 bg-gradient-primary hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              {isAutoSelecting ? "Buscando..." : "Selección Auto"}
            </Button>
          </div>
        )}

        {/* Dropzones: OD | OI en cuadrícula */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <DropZone
            eye="OD"
            preview={eyes.OD.preview}
            fileName={eyes.OD.file?.name}
            hasFile={eyes.OD.file !== null}
            onFile={handleFile}
            onClear={clearEye}
          />
          <DropZone
            eye="OI"
            preview={eyes.OI.preview}
            fileName={eyes.OI.file?.name}
            hasFile={eyes.OI.file !== null}
            onFile={handleFile}
            onClear={clearEye}
          />
        </div>

        {/* Barra de progreso de carga (0 / 1 / 2 imágenes) */}
        {loadedCount > 0 && (
          <div className="rounded-md border border-primary/20 bg-accent/30 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {[0, 1].map((i) => (
                  <span
                    key={i}
                    className={
                      i < loadedCount
                        ? "h-2 w-6 rounded-full bg-primary"
                        : "h-2 w-6 rounded-full bg-border"
                    }
                  />
                ))}
              </div>
              <span className="text-xs font-medium text-foreground">
                {loadedCount} de 2{" "}
                {loadedCount === 1 ? "imagen cargada" : "imágenes cargadas"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {loadedCount === 2
                ? "Listo para analizar"
                : "Puede continuar con 1"}
            </span>
          </div>
        )}

        {/* Nota informativa sobre el preprocesamiento */}
        <div className="flex items-start gap-2.5 rounded-md bg-muted/50 border border-border px-4 py-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Las imágenes serán preprocesadas automáticamente antes del análisis
            (filtro de mejora de contraste, recorte y normalización). <b>No es recomendable subir una imagen procesada.</b> 
          </p>
        </div>
      </CardContent>
    </>
  );

  if (embedded) {
    return <div>{content}</div>;
  }

  return <Card className="shadow-card">{content}</Card>;
}
