import { Info, Sparkles, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatClinicalInstant } from "@/lib/clinicalDates";
import { EyeKey, EyeState } from "../types";
import { DropZone } from "./DropZone";

interface ImageUploaderProps {
  eyes: Record<EyeKey, EyeState>;
  handleFile: (eye: EyeKey, file?: File) => void;
  clearEye: (eye: EyeKey) => void;
  onAutoSelect?: () => void;
  isAutoSelecting?: boolean;
  patientName?: string;
  isSaving?: boolean;
  onConfirm?: (eye: EyeKey) => void;
  onCheckConfirmation?: (eye: EyeKey) => void;
  onRevokeConfirmation?: (eye: EyeKey) => void;
  embedded?: boolean;
}

export function ImageUploader({
  eyes,
  handleFile,
  clearEye,
  onAutoSelect,
  isAutoSelecting = false,
  patientName,
  isSaving = false,
  onConfirm,
  onCheckConfirmation,
  onRevokeConfirmation,
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
              disabled={isAutoSelecting || isSaving || !onAutoSelect}
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
        {(["OD", "OI"] as EyeKey[]).map((eye) => {
          const state = eyes[eye];
          if (!state.candidate) return null;
          const confirmation = state.confirmation;
          const status = confirmation === "CONFIRMADA" ? "Asociación registrada (sin diagnóstico IA)"
            : confirmation === "CONSUMIDA" ? "Confirmación consumida; decisión médica independiente"
            : confirmation === "EXPIRADA" ? "Confirmación expirada"
            : confirmation === "REVOCADA" ? "Confirmación revocada"
            : confirmation === "incierta" ? "Registro incierto; seleccione y revise nuevamente"
            : confirmation === "registrando" ? "Registrando confirmación..."
            : "Candidata por nombre; pendiente de revisión profesional";
          return <section key={eye} className="space-y-2 rounded-md border border-border p-3 text-sm" aria-label={`Confirmación de ${eye}`}>
            <p className="font-medium">{eye === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)"} · {status}</p>
            <p className="text-xs text-muted-foreground">Paciente: {patientName || "Paciente seleccionado"}. Ojo R/L inferido del nombre, no verificado clínicamente.</p>
            <p className="break-all text-xs">Archivo: {state.candidate.filename}</p>
            <p className="text-xs text-muted-foreground">{state.candidate.tipo_imagen} · {state.candidate.fecha_exportacion} · {state.candidate.extension.toUpperCase()} · secuencia {state.candidate.secuencia}</p>
            {confirmation === "CONFIRMADA" && state.expiresAt && <p className="text-xs">Vigente hasta {formatClinicalInstant(state.expiresAt)}</p>}
            {confirmation === "pendiente" && <>
              <p className="text-xs text-muted-foreground">Revise la imagen ampliada arriba antes de confirmar. Declara expresamente que corresponde al paciente y al ojo indicado. Esto no valida el resultado IA.</p>
              <Button type="button" variant="outline" disabled={!state.preview || isSaving || isAutoSelecting}
                onClick={() => onConfirm?.(eye)}>Confirmo paciente, imagen y ojo {eye}</Button>
              {!state.preview && <p role="alert" className="text-xs text-destructive">No hay previsualización verificable; no puede confirmar esta candidata.</p>}
            </>}
            {state.hasConfirmation && (confirmation === "CONFIRMADA" || confirmation === "EXPIRADA" ||
              confirmation === "CONSUMIDA" || confirmation === "incierta") &&
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => onCheckConfirmation?.(eye)}>Consultar estado</Button>}
            {confirmation === "CONFIRMADA" && <Button type="button" variant="outline" disabled={isSaving}
              onClick={() => onRevokeConfirmation?.(eye)}>Revocar asociación pendiente</Button>}
          </section>;
        })}
        {(eyes.OD.isExistingImage || eyes.OI.isExistingImage) && (
          <p role="alert" className="text-sm text-muted-foreground">
            La selección automática no inicia inferencia. Solo una asociación expresa, vigente y comprobada puede enviarse mediante su comprobante; la validación médica del resultado es posterior.
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
              {(["OD", "OI"] as EyeKey[]).some((eye) => eyes[eye].candidate && eyes[eye].confirmation !== "CONFIRMADA")
                ? "Revise y confirme cada candidata"
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
