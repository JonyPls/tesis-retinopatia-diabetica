import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  CalendarCheck,
  ChevronDown,
  Eye,
  Info,
  Stethoscope,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RDLevel, RD_LEVELS } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { useRetinaImage } from "@/hooks/useRetinaImage";
import { useAuthStore } from "@/features/auth/store/authStore";
import { ImagePreviewLightbox } from "@/features/diagnosis/components/ImagePreviewLightbox";
import { ImagePanel } from "@/features/diagnosis/components/ImagePanel";
import { ProbabilityBars } from "@/features/diagnosis/components/DiagnosisResults";
import type { DetalleDiagnosticoExistente } from "@/features/diagnosis/api/diagnosisService";
import type { Diagnosis, PatientDiagnosisEyeDetail } from "../../types";

const VALIDATION_STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "Pendiente",
  APROBADO: "Aprobado",
  CORREGIDO: "Corregido",
};

const DIAGNOSIS_STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "Pendiente",
  PROCESADO: "Procesado",
  VALIDADO: "Validado",
  ANULADO: "Anulado",
};

function numericPercent(value?: number | null) {
  if (value === null || value === undefined) return null;
  return value <= 1 ? value * 100 : value;
}

function eyeLabel(eye: string) {
  return eye === "Derecho" || eye === "OD"
    ? "Ojo derecho (OD)"
    : "Ojo izquierdo (OI)";
}

function eyeKey(eye: string) {
  return eye === "Derecho" || eye === "OD" ? "OD" : "OI";
}

function levelLabel(level?: number | null, fallback?: string | null) {
  if (level === null || level === undefined)
    return fallback || "No disponible";
  return RD_LEVELS[level as RDLevel]?.label ?? fallback ?? `Nivel ${level}`;
}

function rdHeaderTone(level?: number | null) {
  const tones: Record<RDLevel, string> = {
    0: "border-l-[hsl(var(--rd-0))] hover:border-[hsl(var(--rd-0)/0.45)] hover:bg-[hsl(var(--rd-0)/0.06)]",
    1: "border-l-[hsl(var(--rd-1))] hover:border-[hsl(var(--rd-1)/0.45)] hover:bg-[hsl(var(--rd-1)/0.06)]",
    2: "border-l-[hsl(var(--rd-2))] hover:border-[hsl(var(--rd-2)/0.45)] hover:bg-[hsl(var(--rd-2)/0.06)]",
    3: "border-l-[hsl(var(--rd-3))] hover:border-[hsl(var(--rd-3)/0.45)] hover:bg-[hsl(var(--rd-3)/0.06)]",
    4: "border-l-[hsl(var(--rd-4))] hover:border-[hsl(var(--rd-4)/0.45)] hover:bg-[hsl(var(--rd-4)/0.06)]",
  };
  if (level === null || level === undefined || !(level in tones)) {
    return "border-l-border hover:border-border hover:bg-muted/40";
  }
  return tones[level as RDLevel];
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function validationTone(status: PatientDiagnosisEyeDetail["estado_validacion"]) {
  if (status === "APROBADO")
    return "border-success/30 bg-success/10 text-success";
  if (status === "CORREGIDO")
    return "border-warning/40 bg-warning/10 text-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function EvidenceImage({
  filename,
  onPreview,
  overlay,
  subtitle,
  title,
}: {
  filename: string | null;
  onPreview: (src: string) => void;
  overlay?: boolean;
  subtitle?: string;
  title: string;
}) {
  const { src, error, isLoading } = useRetinaImage(filename);
  if (!src) {
    return (
      <div role={error ? "alert" : undefined}
        className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
        {error ?? (isLoading ? "Cargando imagen clínica…" : "No disponible")}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onPreview(src)}
      className="block w-full rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <ImagePanel
        title={title}
        subtitle={subtitle ?? ""}
        src={src}
        overlay={overlay}
      />
    </button>
  );
}

function Section({
  children,
  title,
  withDivider = true,
}: {
  children: React.ReactNode;
  title: string;
  withDivider?: boolean;
}) {
  return (
    <section
      className={cn(
        "mt-8",
        withDivider ? "border-t border-border pt-6" : "pt-2",
      )}
    >
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function mergeDetail(
  detail: PatientDiagnosisEyeDetail,
  extraDetails: DetalleDiagnosticoExistente[],
) {
  return (
    extraDetails.find((item) => item.detalle_id === detail.detalle_id) ??
    extraDetails.find((item) => item.ojo === eyeKey(detail.ojo_evaluado)) ??
    null
  );
}

function EyeDiagnosisBlock({
  detail,
  extra,
  onPreview,
}: {
  detail: PatientDiagnosisEyeDetail;
  extra: DetalleDiagnosticoExistente | null;
  onPreview: (image: {
    alt: string;
    src: string;
    subtitle?: string;
    title: string;
  }) => void;
}) {
  const iaLevel = detail.resultado_ia_id ?? extra?.resultado_ia ?? null;
  const isValidated = detail.estado_validacion === "APROBADO" || detail.estado_validacion === "CORREGIDO";
  const finalLevel = isValidated
    ? detail.resultado_final_id ?? extra?.diagnostico_final ?? null : null;
  const iaLabel = levelLabel(
    iaLevel,
    detail.resultado_ia_nombre ?? extra?.diagnostico_texto,
  );
  const finalLabel = levelLabel(
    finalLevel,
    isValidated ? detail.resultado_final_nombre : null,
  );
  const confidence = numericPercent(
    detail.probabilidad_ia ?? extra?.confianza_general,
  );
  const isCorrected =
    iaLevel !== null &&
    finalLevel !== null &&
    Number(iaLevel) !== Number(finalLevel);
  const originalFilename = detail.imagen_original_url ?? extra?.imagen_url ?? null;
  const gradcamFilename = detail.imagen_gradcam_url ?? extra?.gradcam_url ?? null;
  const validatedAt = formatDate(detail.fecha_validacion);
  const originalName =
    detail.nombre_archivo_original ??
    detail.imagen_original_url ??
    extra?.imagen_url ??
    undefined;

  return (
    <Collapsible
      defaultOpen
      className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full flex-col gap-4 border-l-4 px-5 py-5 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-6 [&[data-state=open]_.chevron]:rotate-180",
            rdHeaderTone(isValidated ? finalLevel : iaLevel),
          )}
        >
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-medium tracking-tight text-foreground">
                {eyeLabel(detail.ojo_evaluado)}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-md border px-3 py-0.5 text-xs font-medium",
                    validationTone(detail.estado_validacion),
                  )}
                >
                   {detail.estado_validacion === "PENDIENTE" ? "Pendiente de validación médica" :
                     VALIDATION_STATUS_TEXT[detail.estado_validacion] ?? detail.estado_validacion}
                </span>
                {confidence !== null && (
                  <span className="inline-flex rounded-md border border-border bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">
                    Confianza {confidence.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {(isValidated ? finalLevel : iaLevel) !== null && (
              <span className="text-xs text-muted-foreground">{isValidated ? "Grado médico" : "Estimación IA"}</span>
            )}
            {(isValidated ? finalLevel : iaLevel) !== null && (
              <RDLevelBadge level={(isValidated ? finalLevel : iaLevel) as RDLevel} size="sm" />
            )}
            <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border px-5 pb-6 pt-5 sm:px-6 lg:px-8">
          <Section title="Resultado" withDivider={false}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Brain className="h-3.5 w-3.5" />
                   Predicción del modelo IA
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {iaLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Grado: {iaLevel ?? "No disponible"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Confianza:{" "}
                  {confidence === null
                    ? "No disponible"
                    : `${confidence.toFixed(1)}%`}
                </p>
              </div>

              <div
                className={cn(
                  "rounded-lg border p-4",
                  isCorrected
                    ? "border-warning/40 bg-warning/10"
                    : "border-primary/20 bg-primary/[0.03]",
                )}
              >
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs font-medium uppercase tracking-wide",
                    isCorrected ? "text-warning" : "text-primary",
                  )}
                >
                  <Stethoscope className="h-3.5 w-3.5" />
                   {isValidated ? "Decisión médica" : "Validación médica pendiente"}
                </div>
                 {isValidated && <>
                   <p className="mt-2 text-sm font-medium text-foreground">{finalLabel}</p>
                   <p className="mt-1 text-xs text-muted-foreground">Grado: {finalLevel ?? "No disponible"}</p>
                 </>}
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                   {!isValidated ? "Pendiente de validación médica. La predicción IA no es una decisión clínica." :
                     isCorrected ? "Predicción corregida por el especialista" :
                     finalLevel !== null ? "IA y resultado final coinciden" : "Grado final no disponible"}
                </p>
              </div>
            </div>
          </Section>

          <Section title="Probabilidades">
            <ProbabilityBars detail={extra?.probabilidades_detalle ?? {}} />
          </Section>

          <Section title="Evidencia visual (apoyo)">
            <div className="grid gap-4 lg:grid-cols-2">
              <EvidenceImage
                title="Imagen original"
                subtitle={originalName}
                filename={originalFilename}
                onPreview={(src) => {
                  onPreview({
                    alt: `Imagen original ${eyeLabel(detail.ojo_evaluado)}`,
                    src,
                    subtitle: originalName,
                    title: `Imagen evaluada - ${eyeLabel(detail.ojo_evaluado)}`,
                  });
                }}
              />
              <EvidenceImage
                title="Grad-CAM"
                subtitle="Regiones de mayor atención del modelo"
                filename={gradcamFilename}
                overlay
                onPreview={(src) => {
                  onPreview({
                    alt: `Grad-CAM ${eyeLabel(detail.ojo_evaluado)}`,
                    src,
                    subtitle: originalName,
                    title: `Grad-CAM - ${eyeLabel(detail.ojo_evaluado)}`,
                  });
                }}
              />
            </div>
            <div className="mt-4 flex gap-2.5 rounded-lg border border-info/30 bg-info/5 p-4 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <p>
                El mapa Grad-CAM resalta regiones que influyeron en la
                clasificación del modelo. Es una herramienta de
                interpretabilidad y no constituye por sí sola un diagnóstico
                médico.
              </p>
            </div>
          </Section>

          <Section title="Validación médica">
            <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-md border px-3 py-0.5 text-xs font-medium",
                    validationTone(detail.estado_validacion),
                  )}
                >
                  {VALIDATION_STATUS_TEXT[detail.estado_validacion] ??
                    detail.estado_validacion}
                </span>
                {isValidated && validatedAt && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarCheck className="h-3.5 w-3.5" />
                    {validatedAt}
                  </span>
                )}
              </div>

              {detail.estado_validacion === "CORREGIDO" && (
                <div className="rounded-lg border border-warning/30 border-l-4 border-l-warning bg-warning/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Corrección registrada
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                    IA: {iaLabel} · Resultado final: {finalLabel}
                  </p>
                  {detail.motivo_correccion && (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {detail.motivo_correccion}
                    </p>
                  )}
                </div>
              )}

              {detail.estado_validacion === "PENDIENTE" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  La evaluación médica de este ojo todavía está pendiente.
                </p>
              )}

              {detail.estado_validacion === "APROBADO" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  El especialista aprobó el resultado para este ojo.
                </p>
              )}

              {isValidated && detail.comentario_medico && (
                <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Comentario médico
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                    {detail.comentario_medico}
                  </p>
                </div>
              )}
            </div>
          </Section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function VisitDiagnosisTab({
  diagnosisDetails = [],
  visit,
}: {
  diagnosisDetails?: DetalleDiagnosticoExistente[];
  visit: Diagnosis;
}) {
  const token = useAuthStore((state) => state.token);
  const [previewImage, setPreviewImage] = useState<{
    alt: string;
    src: string;
    subtitle?: string;
    title: string;
    visitId: number;
    session: string | null;
  } | null>(null);
  useEffect(() => setPreviewImage(null), [token, visit.visita_id, visit.diagnostico_ia]);
  const diagnosis = visit.diagnostico_ia;

  const details = useMemo(
    () =>
      [...(diagnosis?.detalles ?? [])].sort((a, b) =>
        eyeKey(a.ojo_evaluado).localeCompare(eyeKey(b.ojo_evaluado)),
      ),
    [diagnosis?.detalles],
  );

  if (!diagnosis) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          Sin diagnóstico IA
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          Esta visita no cuenta con una evaluación de retinopatía diabética.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="flex items-center gap-2 text-base font-medium tracking-tight text-foreground">
            <Brain className="h-4 w-4 text-primary" />
            Diagnóstico de retinopatía diabética
          </h2>
          <span className="inline-flex w-fit items-center rounded-md border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {DIAGNOSIS_STATUS_TEXT[diagnosis.estado] ?? diagnosis.estado}
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Modelo
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {diagnosis.modelo_nombre || "Modelo IA"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Versión
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {diagnosis.modelo_version || "No registrada"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ojos evaluados
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {details.length}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {details.map((detail) => (
          <EyeDiagnosisBlock
            key={`${visit.visita_id}-${detail.detalle_id}`}
            detail={detail}
            extra={mergeDetail(detail, diagnosisDetails)}
            onPreview={(image) => setPreviewImage({
              ...image, visitId: visit.visita_id, session: token,
            })}
          />
        ))}
      </div>

      {previewImage && previewImage.visitId === visit.visita_id &&
        previewImage.session === token && (
        <ImagePreviewLightbox
          alt={previewImage.alt}
          src={previewImage.src}
          subtitle={previewImage.subtitle}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}
