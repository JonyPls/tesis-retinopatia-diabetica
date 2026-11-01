import { Info, Sparkles, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeKey, EyeState, EyeProcessingStatus } from "../types";
import { DropZone } from "./DropZone";

interface ImageUploaderProps {
  eyes: Record<EyeKey, EyeState>;
  busyEyes?: Record<EyeKey, boolean>;
  lockedEyes?: Partial<Record<EyeKey, boolean>>;
  eyeProcessing?: Partial<Record<EyeKey, EyeProcessingStatus>>;
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
  lockedEyes = {},
  eyeProcessing = {},
  eyeActionError = {},
  handleFile,
  clearEye,
  onAutoSelect,
  isAutoSelecting = false,
  isSaving = false,
  embedded = false,
}: ImageUploaderProps) {
  const eyeStatus = (eye: EyeKey) => {
    if (lockedEyes[eye]) return "Analizado";
    if (eyeProcessing[eye] === "incierto") return "Registro de IA sin confirmar";
    if (eyeProcessing[eye] === "procesando") return "Análisis en curso";
    if (!eyes[eye].file) return "Pendiente de imagen";
    if (eyes[eye].isExistingImage && (eyes[eye].confirmation !== "CONFIRMADA" ||
        !eyes[eye].expiresAt || !(Date.parse(eyes[eye].expiresAt) > Date.now()))) {
      return "Pendiente de confirmación vigente";
    }
    if (eyeProcessing[eye] === "error") return "Imagen pendiente de revisión";
    return "Imagen lista para analizar";
  };

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
              disabled={isAutoSelecting || isSaving || busyEyes.OD || busyEyes.OI || !onAutoSelect || !!(lockedEyes.OD && lockedEyes.OI)}
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
            disabled={busyEyes.OD || lockedEyes.OD}
            readOnly={lockedEyes.OD}
            preview={eyes.OD.preview}
            fileName={eyes.OD.file?.name}
            hasFile={eyes.OD.file !== null}
            onFile={handleFile}
            onClear={clearEye}
            />
            {!lockedEyes.OD && eyeActionError.OD && <p role="alert" className="text-xs text-destructive">{eyeActionError.OD}</p>}
          </div>
          <div className="space-y-2">
            <DropZone
            eye="OI"
            disabled={busyEyes.OI || lockedEyes.OI}
            readOnly={lockedEyes.OI}
            preview={eyes.OI.preview}
            fileName={eyes.OI.file?.name}
            hasFile={eyes.OI.file !== null}
            onFile={handleFile}
            onClear={clearEye}
            />
            {!lockedEyes.OI && eyeActionError.OI && <p role="alert" className="text-xs text-destructive">{eyeActionError.OI}</p>}
          </div>
        </div>
        {(["OD", "OI"] as EyeKey[]).some((eye) => eyes[eye].isExistingImage && !lockedEyes[eye]) && (
          <p className="text-xs text-muted-foreground">
            {(["OD", "OI"] as EyeKey[]).filter((eye) => eyes[eye].isExistingImage && !lockedEyes[eye]).map((eye) =>
              `${eye}: ${eyes[eye].confirmation === "CONFIRMADA" ? "asociación confirmada" :
                eyes[eye].confirmation === "CONSUMIDA" ? "confirmación consumida" :
                "confirmación no vigente"}`).join(" · ")}
          </p>
        )}

        <div className="rounded-md border border-primary/20 bg-accent/30 px-4 py-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(["OD", "OI"] as EyeKey[]).map((eye) => (
              <p key={eye}><span className="font-medium">{eye}:</span> {eyeStatus(eye)}</p>
            ))}
          </div>
          <p className="mt-1 text-muted-foreground">Puede evaluar un solo ojo.</p>
        </div>

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
