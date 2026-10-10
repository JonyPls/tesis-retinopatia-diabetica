import { useState } from "react";
import {
  Brain,
  CheckCircle2,
  Image,
  Search,
  UploadCloud,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  variant?: "full" | "compact";
  selectedPatient?: PatientSearchResult | null;
  eyes?: Record<EyeKey, EyeState>;
  processedEyes?: number;
}

export function DiagnosisStepper({
  step,
  variant = "full",
  selectedPatient,
  eyes,
  processedEyes = 0,
}: DiagnosisStepperProps) {
  const [previewImage, setPreviewImage] = useState<{
    eye: EyeKey;
    src: string;
    fileName?: string;
  } | null>(null);

  if (variant === "compact") {
    const current = STEPS.find((s) => s.n === step) ?? STEPS[0];
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Paso {step} de {STEPS.length} ·{" "}
          <span className="font-medium text-foreground">{current.label}</span>
        </p>
        <Progress
          value={(step / STEPS.length) * 100}
          className="h-1.5 w-full max-w-[220px]"
        />
      </div>
    );
  }

  return (
    <>
      <Card className="shadow-card">
        <CardContent className="p-5">
          <div className="mb-4 min-w-0">
            <p className="text-base font-semibold leading-none">
              Flujo de Diagnóstico
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Retinopatía Diabética
            </p>
          </div>

          <hr />
          <br />

          <div className="space-y-0">
            {STEPS.map((s, idx) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <div key={s.n} className="relative flex gap-3 pb-8 last:pb-0">
                  {idx < STEPS.length - 1 && (
                    <div
                      className={cn(
                        "absolute bottom-2 left-5 top-12 w-[2px] rounded-full transition-colors",
                        step > s.n ? "bg-primary/75" : "bg-muted-foreground/25",
                      )}
                    />
                  )}

                  <div
                    className={cn(
                      "z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
                      done && "border-primary bg-primary text-primary-foreground",
                      active &&
                        "animate-pulse-ring border-primary bg-primary text-primary-foreground shadow-elevated",
                      !done &&
                        !active &&
                        "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5" />
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

          <br />
          <hr />
          <div className="mt-5 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              La visita clínica se creará automáticamente al procesar las imágenes.
            </p>
          </div>
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
  selectedPatient,
  eyes,
  processedEyes,
  onPreview,
}: {
  stepNumber: number;
  description: string;
  selectedPatient?: PatientSearchResult | null;
  eyes?: Record<EyeKey, EyeState>;
  processedEyes: number;
  onPreview: (eye: EyeKey, src: string, fileName?: string) => void;
}) {
  const uploadedImages = (["OD", "OI"] as EyeKey[]).filter(
    (eye) => eyes?.[eye]?.file,
  );

  if (stepNumber === 1 && selectedPatient) {
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
      <p className="mt-1.5 text-xs font-medium text-primary">
        {processedEyes} resultado{processedEyes === 1 ? "" : "s"} generado
        {processedEyes === 1 ? "" : "s"}
      </p>
    );
  }

  return (
    <p className="mt-0.5 text-xs text-muted-foreground/80">{description}</p>
  );
}
