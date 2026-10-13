import { Info, Sparkles, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeKey, EyeState } from "../types";
import { DropZone } from "./DropZone";

interface ImageUploaderProps {
  eyes: Record<EyeKey, EyeState>;
  busyEyes?: Record<EyeKey, boolean>;
  eyeActionError?: Partial<Record<EyeKey, string>>;
  handleFile: (eye: EyeKey, file?: File) => void;
  clearEye: (eye: EyeKey) => void;
  onAutoSelect?: () => void;
  isAutoSelecting?: boolean;
  isSaving?: boolean;
  embedded?: boolean;
}

export function ImageUploader({
  eyes,
  busyEyes = { OD: false, OI: false },
  eyeActionError = {},
  handleFile,
  clearEye,
  onAutoSelect,
  isAutoSelecting = false,
  isSaving = false,
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
              disabled={isAutoSelecting || isSaving || busyEyes.OD || busyEyes.OI || !onAutoSelect}
              className="shrink-0 bg-gradient-primary hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              {isAutoSelecting ? "Buscando..." : "Selección Auto"}
            </Button>
          </div>
        )}

        {/* Dropzones: OD | OI en cuadrícula */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <DropZone
            eye="OD"
            disabled={busyEyes.OD}
            preview={eyes.OD.preview}
            fileName={eyes.OD.file?.name}
            hasFile={eyes.OD.file !== null}
            onFile={handleFile}
            onClear={clearEye}
            />
            {eyeActionError.OD && <p role="alert" className="text-xs text-destructive">{eyeActionError.OD}</p>}
          </div>
          <div className="space-y-2">
            <DropZone
            eye="OI"
            disabled={busyEyes.OI}
            preview={eyes.OI.preview}
            fileName={eyes.OI.file?.name}
            hasFile={eyes.OI.file !== null}
            onFile={handleFile}
            onClear={clearEye}
            />
            {eyeActionError.OI && <p role="alert" className="text-xs text-destructive">{eyeActionError.OI}</p>}
          </div>
        </div>
        {(eyes.OD.isExistingImage || eyes.OI.isExistingImage) && (
          <p className="text-xs text-muted-foreground">
            {(["OD", "OI"] as EyeKey[]).filter((eye) => eyes[eye].isExistingImage).map((eye) =>
              `${eye}: ${eyes[eye].confirmation === "CONFIRMADA" ? "asociación confirmada" :
                eyes[eye].confirmation === "CONSUMIDA" ? "confirmación consumida" :
                "confirmación no vigente"}`).join(" · ")}
          </p>
        )}

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
              {(["OD", "OI"] as EyeKey[]).some((eye) => eyes[eye].candidate &&
                (eyes[eye].confirmation !== "CONFIRMADA" || !eyes[eye].expiresAt ||
                 Date.parse(eyes[eye].expiresAt) <= Date.now()))
                ? "Revise la vigencia de la asociación"
                : loadedCount === 2 ? "Listo para analizar" : "Puede continuar con 1"}
            </span>
          </div>
        )}

        {/* Nota informativa sobre el preprocesamiento */}
        <div className="flex items-start gap-2.5 rounded-md bg-muted/50 border border-border px-4 py-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Las imágenes serán preprocesadas automáticamente antes del análisis
            (filtro de mejora de contraste, recorte y normalización). <b>No subir una imagen ya procesada.</b> 
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
