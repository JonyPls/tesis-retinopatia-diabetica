import { useMemo, useState } from "react";
import {
  Activity,
  Brain,
  CalendarCheck,
  Download,
  Eye,
  Image as ImageIcon,
  Info,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RDLevel, RD_LEVELS } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/features/auth/store/authStore";
import { ImagePreviewLightbox } from "@/features/diagnosis/components/ImagePreviewLightbox";
import { toast } from "@/hooks/use-toast";
import { descargarReporteDiagnostico } from "../../api/patientService";
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
  if (status === "APROBADO") return "border-success/30 bg-success/10 text-success";
  if (status === "CORREGIDO") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-muted/35 text-muted-foreground";
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
      <p className="text-sm text-muted-foreground">
        La distribución de probabilidades no está disponible para este ojo.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const value = numericPercent(row.value) ?? 0;
        const isMax = maxValue !== null && value === maxValue;

        return (
          <div
            key={row.key}
            className={cn(
              "grid grid-cols-[92px_52px_minmax(0,1fr)] items-center gap-2 text-xs",
              isMax ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="font-medium">{row.label}</span>
            <span className="text-right tabular-nums">{value.toFixed(1)}%</span>
            <Progress
              value={value}
              className={cn("h-2 bg-muted", isMax && "ring-1 ring-primary/25")}
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
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs font-semibold text-foreground">{label}</p>
      {src ? (
        <>
          <button
            type="button"
            onClick={onPreview}
            className="mt-2 block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-background"
          >
            <img src={src} alt={alt} className="h-full w-full object-contain" />
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full border-cyan-200 bg-cyan-50 text-xs text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800"
            onClick={onPreview}
          >
            <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
            {label === "Grad-CAM" ? "Ver Grad-CAM" : "Ver imagen"}
          </Button>
        </>
      ) : (
        <div className="mt-2 flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border bg-background text-center text-xs text-muted-foreground">
          No disponible
        </div>
      )}
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="border-t border-border pt-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-3">{children}</div>
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
    <Card className="border-border shadow-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                {eyeLabel(detail.ojo_evaluado)}
              </h3>
              <span
                className={cn(
                  "mt-1 inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  validationTone(detail.estado_validacion),
                )}
              >
                {VALIDATION_STATUS_TEXT[detail.estado_validacion] ?? detail.estado_validacion}
              </span>
            </div>
          </div>

          {finalLevel !== null && <RDLevelBadge level={finalLevel as RDLevel} size="sm" />}
        </div>

        <Section title="Resultado">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Brain className="h-3.5 w-3.5 text-primary" />
                Predicción IA
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{iaLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Grado: {iaLevel ?? "No disponible"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Confianza: {confidence === null ? "No disponible" : `${confidence.toFixed(1)}%`}
              </p>
            </div>

            <div
              className={cn(
                "rounded-md border p-3",
                isCorrected
                  ? "border-warning/30 bg-warning/10"
                  : "border-success/25 bg-success/5",
              )}
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Stethoscope className="h-3.5 w-3.5 text-primary" />
                Resultado final
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{finalLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Grado: {finalLevel ?? "No disponible"}
              </p>
              <p className="mt-2 text-xs font-medium text-foreground">
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
          <div className="grid gap-3 md:grid-cols-2">
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
          <div className="mt-3 flex gap-2 rounded-md border border-primary/15 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              El mapa Grad-CAM resalta regiones que influyeron en la clasificación del
              modelo. Es una herramienta de interpretabilidad y no constituye por sí
              sola un diagnóstico médico.
            </p>
          </div>
        </Section>

        <Section title="Validación médica">
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
                  validationTone(detail.estado_validacion),
                )}
              >
                {VALIDATION_STATUS_TEXT[detail.estado_validacion] ?? detail.estado_validacion}
              </span>
              {validatedAt && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {validatedAt}
                </span>
              )}
            </div>

            {detail.estado_validacion === "CORREGIDO" && (
              <div className="rounded-md border border-warning/25 bg-warning/10 p-3">
                <p className="text-xs font-semibold text-warning">Corrección registrada</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground">
                  IA: {iaLabel} · Resultado final: {finalLabel}
                </p>
                {detail.motivo_correccion && (
                  <p className="mt-2 text-sm leading-relaxed text-foreground">
                    {detail.motivo_correccion}
                  </p>
                )}
              </div>
            )}

            {detail.estado_validacion === "PENDIENTE" && (
              <p className="text-sm text-muted-foreground">
                La evaluación médica de este ojo todavía está pendiente.
              </p>
            )}

            {detail.estado_validacion === "APROBADO" && (
              <p className="text-sm text-muted-foreground">
                El especialista aprobó el resultado para este ojo.
              </p>
            )}

            {detail.comentario_medico && (
              <div className="rounded-md border border-primary/15 bg-primary/5 p-3">
                <p className="text-xs font-semibold text-primary">Comentario médico</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground">
                  {detail.comentario_medico}
                </p>
              </div>
            )}
          </div>
        </Section>
      </CardContent>
    </Card>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function VisitDiagnosisTab({
  diagnosisDetails = [],
  visit,
}: {
  diagnosisDetails?: DetalleDiagnosticoExistente[];
  visit: Diagnosis;
}) {
  const token = useAuthStore((state) => state.token);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    alt: string;
    src: string;
    subtitle?: string;
    title: string;
  } | null>(null);
  const diagnosis = visit.diagnostico_ia;

  const handleDownloadReport = async () => {
    if (isDownloadingReport) return;
    setIsDownloadingReport(true);
    try {
      const { blob, filename } = await descargarReporteDiagnostico(visit.visita_id);
      triggerBlobDownload(blob, filename);
      toast({
        title: "Reporte generado",
        description: "La descarga del PDF se inició correctamente.",
      });
    } catch (error) {
      console.error("Error descargando reporte de diagnóstico", error);
      toast({
        title: "No se pudo generar el reporte",
        description: "Intenta nuevamente o verifica que la visita tenga diagnóstico IA.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const details = useMemo(
    () =>
      [...(diagnosis?.detalles ?? [])].sort((a, b) =>
        eyeKey(a.ojo_evaluado).localeCompare(eyeKey(b.ojo_evaluado)),
      ),
    [diagnosis?.detalles],
  );

  if (!diagnosis) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <Brain className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">Sin diagnóstico IA</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          Esta visita no cuenta con una evaluación de retinopatía diabética.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-muted/25 shadow-card">
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Brain className="h-4 w-4 text-primary" />
                Diagnóstico de retinopatía diabética
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Resumen de la evaluación IA asociada a esta visita.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDownloadingReport}
                onClick={handleDownloadReport}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {isDownloadingReport ? "Generando reporte..." : "Descargar reporte PDF"}
              </Button>
              <span className="inline-flex w-fit items-center rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                {DIAGNOSIS_STATUS_TEXT[diagnosis.estado] ?? diagnosis.estado}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Modelo</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {diagnosis.modelo_nombre || "Modelo IA"}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Versión</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {diagnosis.modelo_version || "No registrada"}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Ojos evaluados</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {details.length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
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
