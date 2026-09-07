import { useState } from "react";
import {
  Brain,
  CheckCircle2,
  Image,
  PanelLeft,
  PanelTop,
  Search,
  UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PatientSearchResult } from "@/features/patients/api/patientService";
import { cn } from "@/lib/utils";
import type { EyeKey, EyeState } from "../types";
import { ImagePreviewLightbox } from "./ImagePreviewLightbox";

const STEPS = [
  {
    n: 1,
    label: "Paciente",
    description: "Buscar o registrar",
    icon: Search,
  },
  {
    n: 2,
    label: "Imágenes",
    description: "OD y/o OI",
    icon: UploadCloud,
  },
  {
    n: 3,
    label: "Resultado IA",
    description: "Validación médica",
    icon: Brain,
  },
];

const EYE_LABELS: Record<EyeKey, string> = {
  OD: "Ojo derecho",
  OI: "Ojo izquierdo",
};

interface DiagnosisStepperProps {
  step: number;
  layout?: "side" | "top";
  selectedPatient?: PatientSearchResult | null;
  eyes?: Record<EyeKey, EyeState>;
  processedEyes?: number;
  onToggleLayout?: () => void;
}

export function DiagnosisStepper({
  step,
  layout = "side",
  selectedPatient,
  eyes,
  processedEyes = 0,
  onToggleLayout,
}: DiagnosisStepperProps) {
  const [previewImage, setPreviewImage] = useState<{
    eye: EyeKey;
    src: string;
    fileName?: string;
  } | null>(null);
  const isHorizontal = layout === "top";

  return (
    <>
      <Card className="shadow-card">
        <CardContent className={cn(isHorizontal ? "p-5" : "p-5")}>
          <div
            className={cn(
              "flex items-start justify-between gap-3",
              isHorizontal ? "mb-3" : "mb-4",
            )}
          >
            <div className="min-w-0">
              <p className="text-base font-semibold leading-none">
                Flujo de Diagnóstico
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Retinopatía Diabética
              </p>
            </div>
            {onToggleLayout && (
              <Button
                type="button"
                variant="outline"
                onClick={onToggleLayout}
                className="h-8 shrink-0 px-2.5 text-xs"
              >
                {isHorizontal ? (
                  <PanelLeft className="h-3.5 w-3.5" />
                ) : (
                  <PanelTop className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
          {!isHorizontal && (
            <>
              <hr />
              <br />
            </>
          )}
          <div
            className={cn(
              isHorizontal
                ? "grid gap-4 lg:grid-cols-3"
                : "space-y-0",
            )}
          >
            {STEPS.map((s, idx) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <div
                  key={s.n}
                  className={cn(
                    "relative flex gap-3",
                    isHorizontal
                      ? "rounded-md border border-border bg-background p-3"
                      : "pb-8 last:pb-0",
                  )}
                >
                  {!isHorizontal && idx < STEPS.length - 1 && (
                    <div
                      className={cn(
                        "absolute bottom-2 left-5 top-12 w-[2px] rounded-full transition-colors",
                        step > s.n
                          ? "bg-primary/75"
                          : "bg-muted-foreground/25",
                      )}
                    />
                  )}

                  <div
                    className={cn(
                      "z-10 flex shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
                      isHorizontal ? "h-8 w-8" : "h-10 w-10",
                      done && "border-primary bg-primary text-primary-foreground",
                      active &&
                        "animate-pulse-ring border-primary bg-primary text-primary-foreground shadow-elevated",
                      !done &&
                        !active &&
                        "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <CheckCircle2
                        className={isHorizontal ? "h-4 w-4" : "h-5 w-5"}
                      />
                    ) : (
                      <s.icon className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0 pt-0.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Paso {s.n}
                    </p>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {s.label}
                    </p>
                    <StepProgress
                      stepNumber={s.n}
                      description={s.description}
                      compact={isHorizontal}
                      selectedPatient={selectedPatient}
                      eyes={eyes}
                      processedEyes={processedEyes}
                      onPreview={(eye, src, fileName) =>
                        setPreviewImage({ eye, src, fileName })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {!isHorizontal && (
            <>
              <br />
              <hr />
              <div className="mt-5 rounded-md border border-border bg-muted/40 p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  La visita clínica se creará automáticamente al procesar las imágenes.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {previewImage && (
        <ImagePreviewLightbox
          src={previewImage.src}
          title={`${previewImage.eye} · ${EYE_LABELS[previewImage.eye]}`}
          subtitle={previewImage.fileName}
          alt={`Vista previa ${EYE_LABELS[previewImage.eye]}`}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
}

function StepProgress({
  stepNumber,
  description,
  compact,
  selectedPatient,
  eyes,
  processedEyes,
  onPreview,
}: {
  stepNumber: number;
  description: string;
  compact: boolean;
  selectedPatient?: PatientSearchResult | null;
  eyes?: Record<EyeKey, EyeState>;
  processedEyes: number;
  onPreview: (eye: EyeKey, src: string, fileName?: string) => void;
}) {
  const uploadedImages = (["OD", "OI"] as EyeKey[]).filter(
    (eye) => eyes?.[eye]?.file,
  );

  if (stepNumber === 1 && selectedPatient) {
    if (compact) {
      return (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {selectedPatient.nombres} {selectedPatient.apellidos} ·{" "}
          {selectedPatient.tipo_doc_abrev} {selectedPatient.nro_documento}
        </p>
      );
    }

    return (
      <div className="mt-1.5 rounded-md border border-primary/20 bg-primary/[0.04] px-2.5 py-2">
        <p className="truncate text-xs font-medium text-foreground">
          {selectedPatient.nombres} {selectedPatient.apellidos}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {selectedPatient.tipo_doc_abrev} {selectedPatient.nro_documento}
        </p>
      </div>
    );
  }

  if (stepNumber === 2 && uploadedImages.length > 0) {
    if (compact) {
      return (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {uploadedImages.map((eye) => {
            const preview = eyes?.[eye]?.preview;
            const fileName = eyes?.[eye]?.file?.name;
            return (
              <button
                key={eye}
                type="button"
                onClick={() => preview && onPreview(eye, preview, fileName)}
                disabled={!preview}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.05] px-2 text-[11px] font-medium text-primary transition-colors",
                  preview
                    ? "hover:border-primary/60 hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    : "cursor-not-allowed opacity-70",
                )}
              >
                <Image className="h-3 w-3" />
                {eye}
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="mt-1.5 space-y-1.5">
        {uploadedImages.map((eye) => {
          const preview = eyes?.[eye]?.preview;
          const fileName = eyes?.[eye]?.file?.name;
          return (
            <button
              key={eye}
              type="button"
              onClick={() => preview && onPreview(eye, preview, fileName)}
              disabled={!preview}
              className={cn(
                "w-full rounded-md border border-primary/20 bg-primary/[0.04] px-2.5 py-2 text-left transition-colors",
                preview
                  ? "hover:border-primary/50 hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  : "cursor-not-allowed opacity-70",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-primary">
                  {eye}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {EYE_LABELS[eye]}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Image className="h-3.5 w-3.5 text-primary" />
                {preview ? "Clic para ver" : "Vista previa no disponible"}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  if (stepNumber === 3 && processedEyes > 0) {
    return (
      <p
        className={cn(
          "text-xs font-medium text-primary",
          compact ? "mt-0.5" : "mt-1.5",
        )}
      >
        {processedEyes} resultado{processedEyes === 1 ? "" : "s"} generado
        {processedEyes === 1 ? "" : "s"}
      </p>
    );
  }

  return <p className="mt-0.5 text-xs text-muted-foreground/80">{description}</p>;
}
