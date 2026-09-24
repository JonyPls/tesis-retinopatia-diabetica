import { useMemo, useState } from "react";
import {
  Activity,
  Brain,
  CalendarCheck,
  ChevronDown,
  Eye,
  Image as ImageIcon,
  Info,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RDLevel, RD_LEVELS } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/features/auth/store/authStore";
import { ImagePreviewLightbox } from "@/features/diagnosis/components/ImagePreviewLightbox";
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

const PROBABILITY_CLASSES = [
  { key: "G0_Sin_DR", label: "Sin RD", level: 0 },
  { key: "G1_Leve", label: "Leve", level: 1 },
  { key: "G2_Moderada", label: "Moderada", level: 2 },
  { key: "G3_Severa", label: "Severa", level: 3 },
  { key: "G4_Proliferativa", label: "Proliferativa", level: 4 },
] as const;

function percent(value?: number | null) {
  if (value === null || value === undefined) return "No disponible";
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function numericPercent(value?: number | null) {
  if (value === null || value === undefined) return null;
  return value <= 1 ? value * 100 : value;
}

function eyeLabel(eye: string) {
  return eye === "Derecho" || eye === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)";
}

function eyeKey(eye: string) {
  return eye === "Derecho" || eye === "OD" ? "OD" : "OI";
}

function levelLabel(level?: number | null, fallback?: string | null) {
  if (level === null || level === undefined) return fallback || "No disponible";
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
    return "border-l-slate-300 hover:border-slate-300 hover:bg-slate-50/80";
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

function buildRetinaImageUrl(filename?: string | null, token?: string | null) {
  if (!filename) return null;
  const backendUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${backendUrl}/uploads/retinas/${encodeURIComponent(filename)}${query}`;
}

function validationTone(status: PatientDiagnosisEyeDetail["estado_validacion"]) {
  if (status === "APROBADO") return "border-emerald-200/60 bg-emerald-50/50 text-emerald-700";
  if (status === "CORREGIDO") return "border-amber-200/60 bg-amber-50/50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function ProbabilityBars({
  probabilities,
}: {
  probabilities?: Record<string, number> | null;
}) {
  const rows = PROBABILITY_CLASSES.map((item) => ({
    ...item,
    value: probabilities?.[item.key],
  }));
  const availableValues = rows
    .map((row) => numericPercent(row.value))
    .filter((value): value is number => value !== null);
  const maxValue = availableValues.length ? Math.max(...availableValues) : null;

  if (!probabilities || availableValues.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-slate-500">
        La distribución de probabilidades no está disponible para este ojo.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const value = numericPercent(row.value) ?? 0;
        const isMax = maxValue !== null && value === maxValue;

        return (
          <div
            key={row.key}
            className={cn(
              "grid grid-cols-[92px_52px_minmax(0,1fr)] items-center gap-3 text-xs",
              isMax ? "text-primary" : "text-slate-500",
            )}
          >
            <span className={cn(isMax ? "font-medium" : "font-normal")}>{row.label}</span>
            <span className="text-right tabular-nums">{value.toFixed(1)}%</span>
            <Progress
              value={value}
              className="h-1.5 bg-slate-100"
            />
          </div>
        );
      })}
    </div>
  );
}

function ImageReviewCard({
  alt,
  label,
  onPreview,
  src,
}: {
  alt: string;
  label: string;
  onPreview: () => void;
  src: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4">
      <p className="text-[13px] font-medium text-slate-900">{label}</p>
      {src ? (
        <>
          <button
            type="button"
            onClick={onPreview}
            className="mt-3 block aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-200/80 bg-slate-50"
          >
            <img src={src} alt={alt} className="h-full w-full object-contain" />
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full border-slate-200 bg-white text-xs text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900"
            onClick={onPreview}
          >
            <ImageIcon className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
            {label === "Grad-CAM" ? "Ver Grad-CAM" : "Ver imagen"}
          </Button>
        </>
      ) : (
        <div className="mt-3 flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-400">
          No disponible
        </div>
      )}
    </div>
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
    <section className={cn("mt-8", withDivider ? "border-t border-slate-100 pt-6" : "pt-2")}>
      <h4 className="text-sm font-medium text-slate-900">{title}</h4>
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
  token,
}: {
  detail: PatientDiagnosisEyeDetail;
  extra: DetalleDiagnosticoExistente | null;
  onPreview: (image: {
    alt: string;
    src: string;
    subtitle?: string;
    title: string;
  }) => void;
  token?: string | null;
}) {
  const iaLevel = detail.resultado_ia_id ?? extra?.resultado_ia ?? null;
  const finalLevel = detail.resultado_final_id ?? extra?.diagnostico_final ?? iaLevel;
  const iaLabel = levelLabel(iaLevel, detail.resultado_ia_nombre ?? extra?.diagnostico_texto);
  const finalLabel = levelLabel(finalLevel, detail.resultado_final_nombre ?? detail.resultado_ia_nombre);
  const confidence = numericPercent(detail.probabilidad_ia ?? extra?.confianza_general);
  const isCorrected =
    iaLevel !== null &&
    finalLevel !== null &&
    Number(iaLevel) !== Number(finalLevel);
  const originalUrl = buildRetinaImageUrl(
    detail.imagen_original_url ?? extra?.imagen_url,
    token,
  );
  const gradcamUrl = buildRetinaImageUrl(
    detail.imagen_gradcam_url ?? extra?.gradcam_url,
    token,
  );
  const validatedAt = formatDate(detail.fecha_validacion);
  const originalName =
    detail.nombre_archivo_original ?? detail.imagen_original_url ?? extra?.imagen_url ?? undefined;

  return (
    <Collapsible
      defaultOpen
      className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full flex-col gap-4 border-l-4 px-5 py-5 text-left transition-all hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 [&[data-state=open]_.chevron]:rotate-180",
            rdHeaderTone(finalLevel),
          )}
        >
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-medium tracking-tight text-slate-900">
                {eyeLabel(detail.ojo_evaluado)}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full border px-3 py-0.5 text-xs font-medium shadow-none",
                    validationTone(detail.estado_validacion),
                  )}
                >
                  {VALIDATION_STATUS_TEXT[detail.estado_validacion] ?? detail.estado_validacion}
                </span>
                {confidence !== null && (
                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-medium text-slate-600 shadow-none">
                    Confianza {confidence.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {finalLevel !== null && <RDLevelBadge level={finalLevel as RDLevel} size="sm" />}
            <ChevronDown className="chevron h-4 w-4 shrink-0 text-slate-400 transition-transform" />
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <CardContent className="border-t border-slate-100 px-5 pb-6 pt-0 sm:px-6 lg:px-8">
          <Section title="Resultado" withDivider={false}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-amber-600">
                <Brain className="h-3.5 w-3.5 text-amber-600" />
                Predicción IA
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">{iaLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                Grado: {iaLevel ?? "No disponible"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Confianza: {confidence === null ? "No disponible" : `${confidence.toFixed(1)}%`}
              </p>
            </div>

              <div
                className={cn(
                  "rounded-lg border p-4",
                  isCorrected
                    ? "border-amber-200/60 bg-amber-50/40"
                    : "border-success/30 bg-success/5",
                )}
              >
              <div className={cn(
                "flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest",
                isCorrected ? "text-amber-600" : "text-success",
              )}>
                <Stethoscope className="h-3.5 w-3.5" />
                Resultado final
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">{finalLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                Grado: {finalLevel ?? "No disponible"}
              </p>
              <p className="mt-2 text-xs font-medium text-slate-600">
                {isCorrected
                  ? "Predicción corregida por el especialista"
                  : "IA y resultado final coinciden"}
              </p>
              </div>
            </div>
          </Section>

          <Section title="Probabilidades">
            <ProbabilityBars probabilities={extra?.probabilidades_detalle} />
          </Section>

          <Section title="Imágenes">
            <div className="grid gap-4 lg:grid-cols-2">
            <ImageReviewCard
              alt={`Imagen original ${eyeLabel(detail.ojo_evaluado)}`}
              label="Imagen evaluada"
              src={originalUrl}
              onPreview={() => {
                if (!originalUrl) return;
                onPreview({
                  alt: `Imagen original ${eyeLabel(detail.ojo_evaluado)}`,
                  src: originalUrl,
                  subtitle: originalName,
                  title: `Imagen evaluada - ${eyeLabel(detail.ojo_evaluado)}`,
                });
              }}
            />
            <ImageReviewCard
              alt={`Grad-CAM ${eyeLabel(detail.ojo_evaluado)}`}
              label="Grad-CAM"
              src={gradcamUrl}
              onPreview={() => {
                if (!gradcamUrl) return;
                onPreview({
                  alt: `Grad-CAM ${eyeLabel(detail.ojo_evaluado)}`,
                  src: gradcamUrl,
                  subtitle: originalName,
                  title: `Grad-CAM - ${eyeLabel(detail.ojo_evaluado)}`,
                });
              }}
            />
            </div>
            <div className="mt-4 flex gap-2.5 rounded-lg border border-info/30 bg-info/5 p-4 text-xs leading-relaxed text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
            <p>
              El mapa Grad-CAM resalta regiones que influyeron en la clasificación del
              modelo. Es una herramienta de interpretabilidad y no constituye por sí
              sola un diagnóstico médico.
            </p>
            </div>
          </Section>

          <Section title="Validación médica">
            <div className="space-y-4 rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex rounded-full border px-3 py-0.5 text-xs font-medium shadow-none",
                  validationTone(detail.estado_validacion),
                )}
              >
                {VALIDATION_STATUS_TEXT[detail.estado_validacion] ?? detail.estado_validacion}
              </span>
              {validatedAt && (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <CalendarCheck className="h-3.5 w-3.5 text-slate-400" />
                  {validatedAt}
                </span>
              )}
            </div>

            {detail.estado_validacion === "CORREGIDO" && (
              <div className="rounded-lg border border-warning/30 border-l-4 border-l-warning bg-warning/5 p-4">
                <p className="text-xs font-medium uppercase tracking-widest text-amber-600">Corrección registrada</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                  IA: {iaLabel} · Resultado final: {finalLabel}
                </p>
                {detail.motivo_correccion && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {detail.motivo_correccion}
                  </p>
                )}
              </div>
            )}

            {detail.estado_validacion === "PENDIENTE" && (
              <p className="text-sm leading-relaxed text-slate-500">
                La evaluación médica de este ojo todavía está pendiente.
              </p>
            )}

            {detail.estado_validacion === "APROBADO" && (
              <p className="text-sm leading-relaxed text-slate-500">
                El especialista aprobó el resultado para este ojo.
              </p>
            )}

            {detail.comentario_medico && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="text-xs font-medium uppercase tracking-widest text-primary">Comentario médico</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                  {detail.comentario_medico}
                </p>
              </div>
            )}
            </div>
          </Section>
        </CardContent>
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
  } | null>(null);
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
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-900">Sin diagnóstico IA</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
          Esta visita no cuenta con una evaluación de retinopatía diabética.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium tracking-tight text-slate-900">
                <Brain className="h-4 w-4 text-amber-600" />
                Diagnóstico de retinopatía diabética
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                {DIAGNOSIS_STATUS_TEXT[diagnosis.estado] ?? diagnosis.estado}
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Modelo</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {diagnosis.modelo_nombre || "Modelo IA"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Versión</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {diagnosis.modelo_version || "No registrada"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Ojos evaluados</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {details.length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {details.map((detail) => (
          <EyeDiagnosisBlock
            key={detail.detalle_id}
            detail={detail}
            extra={mergeDetail(detail, diagnosisDetails)}
            onPreview={setPreviewImage}
            token={token}
          />
        ))}
      </div>

      {previewImage && (
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
