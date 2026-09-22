import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpDown,
  Brain,
  Calendar,
  ChevronDown,
  CircleDot,
  Eye,
  FileText,
  Image as ImageIcon,
  MoveRight,
  SlidersHorizontal,
  Stethoscope,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RDLevel } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/features/auth/store/authStore";
import { ImagePreviewLightbox } from "@/features/diagnosis/components/ImagePreviewLightbox";
import {
  Diagnosis,
  PatientDiagnosisEyeDetail,
  PatientVisitReport,
} from "../types";
import { PatientReportDetailModal } from "./PatientReportDetailModal";

interface PatientTimelineProps {
  diagnoses: Diagnosis[];
  sortedDx: Diagnosis[];
  patientName?: string;
  patientId?: string | number;
  className?: string;
}

type ContentFilter = "todos" | "diagnostico_ia" | "informes";

const VISIT_STATUS_TEXT: Record<string, string> = {
  ACTIVA: "Activa",
  CERRADA: "Cerrada",
  ANULADA: "Anulada",
};

const DIAGNOSIS_STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "Pendiente",
  PROCESADO: "Procesado",
  VALIDADO: "Validado",
  ANULADO: "Anulado",
};

const VALIDATION_STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "Pendiente",
  APROBADO: "Aprobado",
  CORREGIDO: "Corregido",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toDateKey(iso: string) {
  return iso.split("T")[0].split(" ")[0];
}

function percent(value?: number | null) {
  if (value === null || value === undefined) return null;
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function buildRetinaImageUrl(filename?: string | null, token?: string | null) {
  if (!filename) return null;
  const backendUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${backendUrl}/uploads/retinas/${encodeURIComponent(filename)}${query}`;
}

function toneForVisitStatus(status?: string) {
  if (status === "ACTIVA") return "active";
  if (status === "CERRADA") return "muted";
  return "danger";
}

function toneForDiagnosisStatus(status?: string) {
  if (status === "VALIDADO") return "active";
  if (status === "PROCESADO") return "ia";
  if (status === "PENDIENTE") return "warning";
  return "danger";
}

function toneForValidationStatus(status?: string) {
  if (status === "APROBADO") return "active";
  if (status === "CORREGIDO") return "warning";
  return "muted";
}

function EmptyVisitSection({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function PillBadge({
  icon: Icon,
  children,
  tone = "muted",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: "muted" | "ia" | "report" | "active" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        tone === "ia" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "report" && "border-primary/20 bg-primary/10 text-primary",
        tone === "active" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border bg-muted/35 text-muted-foreground",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function MetricBox({
  label,
  value,
  icon: Icon,
  tone = "muted",
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "muted" | "ia" | "report" | "active" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        tone === "ia" && "border-amber-200 bg-amber-50/70",
        tone === "report" && "border-primary/20 bg-primary/5",
        tone === "active" && "border-success/25 bg-success/5",
        tone === "warning" && "border-warning/30 bg-warning/10",
        tone === "danger" && "border-destructive/30 bg-destructive/10",
        tone === "muted" && "border-border bg-background",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function DiagnosisEyeCard({
  detail,
  token,
  onPreview,
}: {
  detail: PatientDiagnosisEyeDetail;
  token?: string | null;
  onPreview: (image: {
    src: string;
    title: string;
    subtitle?: string;
    alt: string;
  }) => void;
}) {
  const finalLevel = detail.resultado_final_id ?? detail.resultado_ia_id;
  const confidence = percent(detail.probabilidad_ia);
  const originalUrl = buildRetinaImageUrl(detail.imagen_original_url, token);
  const gradcamUrl = buildRetinaImageUrl(detail.imagen_gradcam_url, token);
  const eyeLabel =
    detail.ojo_evaluado === "Derecho"
      ? "Ojo derecho (OD)"
      : "Ojo izquierdo (OI)";
  const isCorrected =
    detail.resultado_ia_id !== null &&
    finalLevel !== null &&
    Number(detail.resultado_ia_id) !== Number(finalLevel);
  const normalizedConfidence =
    detail.probabilidad_ia === null || detail.probabilidad_ia === undefined
      ? null
      : detail.probabilidad_ia <= 1
        ? detail.probabilidad_ia * 100
        : detail.probabilidad_ia;
  const confidenceTone =
    normalizedConfidence !== null && normalizedConfidence >= 70
      ? "active"
      : "warning";

  return (
    <div
      className="rounded-md border border-border bg-background p-4"
      style={{
        borderLeft:
          finalLevel !== null
            ? `4px solid hsl(var(--rd-${finalLevel}))`
            : undefined,
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Eye className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">{eyeLabel}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <PillBadge tone={toneForValidationStatus(detail.estado_validacion)}>
                {VALIDATION_STATUS_TEXT[detail.estado_validacion] ??
                  detail.estado_validacion}
              </PillBadge>
              {finalLevel !== null && (
                <RDLevelBadge level={finalLevel as RDLevel} size="sm" />
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {originalUrl && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 border-cyan-200 bg-cyan-50 px-3 text-[0.8rem] text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800"
              onClick={() =>
                onPreview({
                  src: originalUrl,
                  title: `Imagen original · ${eyeLabel}`,
                  subtitle:
                    detail.nombre_archivo_original ??
                    detail.imagen_original_url ??
                    undefined,
                  alt: `Imagen original ${eyeLabel}`,
                })
              }
            >
              <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
              Ver original
            </Button>
          )}
          {gradcamUrl && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 border-cyan-200 bg-cyan-50 px-3 text-[0.8rem] text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800"
              onClick={() =>
                onPreview({
                  src: gradcamUrl,
                  title: `Grad-CAM · ${eyeLabel}`,
                  subtitle:
                    detail.nombre_archivo_original ??
                    detail.imagen_gradcam_url ??
                    undefined,
                  alt: `Grad-CAM ${eyeLabel}`,
                })
              }
            >
              <Brain className="mr-1.5 h-3.5 w-3.5" />
              Ver Grad-CAM
            </Button>
          )}
          {!originalUrl && !gradcamUrl && (
            <span className="text-xs text-muted-foreground">
              Imágenes no disponibles
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricBox
          icon={Brain}
          label="Resultado IA"
          tone={isCorrected ? "ia" : "active"}
          value={detail.resultado_ia_nombre ?? "Sin clasificación"}
        />
        <MetricBox
          icon={Stethoscope}
          label="Resultado final"
          tone="active"
          value={
            detail.resultado_final_nombre ??
            detail.resultado_ia_nombre ??
            "Pendiente"
          }
        />
        <MetricBox
          icon={Activity}
          label="Confianza IA"
          tone={confidenceTone}
          value={confidence ?? "No disponible"}
        />
      </div>

      {(detail.fecha_validacion ||
        detail.motivo_correccion ||
        detail.comentario_medico) && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {detail.fecha_validacion && (
            <p className="text-xs text-muted-foreground">
              Validado el {shortDate(detail.fecha_validacion)}
            </p>
          )}
          {detail.motivo_correccion && (
            <div className="rounded-md border border-warning/25 bg-warning/10 p-3">
              <p className="text-xs font-semibold text-warning">
                Motivo de corrección
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {detail.motivo_correccion}
              </p>
            </div>
          )}
          {detail.comentario_medico && (
            <div className="rounded-md border border-primary/15 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-primary">
                Comentario médico
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {detail.comentario_medico}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  onView,
}: {
  report: PatientVisitReport;
  onView: (reportId: number) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">
                {report.tipo_informe_nombre}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Registrado el {shortDate(report.fecha_creado)}
              </p>
            </div>
          </div>
        </div>
        <PillBadge tone="active">{report.estado === "ACTIVO" ? "Activo" : report.estado}</PillBadge>
      </div>

      {report.conclusion ? (
        <div className="mt-4 rounded-md border border-primary/15 bg-primary/5 p-3">
          <p className="text-xs font-semibold text-primary">Conclusión</p>
          <p className="mt-1 line-clamp-4 text-sm leading-relaxed text-foreground">
            {report.conclusion}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Este informe no tiene conclusión registrada.
        </p>
      )}

      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onView(report.id)}
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Ver informe
        </Button>
      </div>
    </div>
  );
}

export function PatientTimeline({
  diagnoses,
  sortedDx,
  patientName,
  patientId,
  className,
}: PatientTimelineProps) {
  const token = useAuthStore((state) => state.token);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("todos");
  const [expandedVisitId, setExpandedVisitId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    title: string;
    subtitle?: string;
    alt: string;
  } | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    let list = [...sortedDx];

    if (dateFrom) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((dx) => toDateKey(dx.fecha_visita) <= dateTo);
    }
    if (contentFilter === "diagnostico_ia") {
      list = list.filter((dx) => Number(dx.tiene_diagnostico_ia) === 1);
    }
    if (contentFilter === "informes") {
      list = list.filter((dx) => Number(dx.tiene_informes) === 1);
    }
    if (sortAsc) {
      list.sort(
        (a, b) =>
          new Date(a.fecha_visita).getTime() -
          new Date(b.fecha_visita).getTime(),
      );
    }

    return list;
  }, [sortedDx, dateFrom, dateTo, contentFilter, sortAsc]);

  const totals = useMemo(
    () => ({
      visitas: diagnoses.length,
      diagnosticos: diagnoses.filter((dx) => Number(dx.tiene_diagnostico_ia) === 1)
        .length,
      informes: diagnoses.reduce(
        (sum, dx) => sum + (dx.informes?.length ?? Number(dx.tiene_informes)),
        0,
      ),
    }),
    [diagnoses],
  );

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSortAsc(false);
    setContentFilter("todos");
  };

  const hasActiveFilters =
    dateFrom || dateTo || sortAsc || contentFilter !== "todos";

  if (diagnoses.length === 0) {
    return (
      <Card className={cn("shadow-card", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Historia clínica
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Aún no hay visitas registradas para este paciente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("shadow-card", className)}>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Historia clínica
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Visitas del paciente organizados por fecha.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PillBadge icon={Calendar}>{totals.visitas} visitas</PillBadge>
            <PillBadge icon={Brain} tone="ia">
              {totals.diagnosticos} IA
            </PillBadge>
            <PillBadge icon={FileText} tone="report">
              {totals.informes} informes
            </PillBadge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFilters((value) => !value)}
              className={cn(
                "h-8 w-8",
                showFilters ? "text-primary" : "text-muted-foreground",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-8 w-[140px] text-xs"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-8 w-[140px] text-xs"
              />
              {(["todos", "diagnostico_ia", "informes"] as ContentFilter[]).map(
                (filter) => (
                  <Button
                    key={filter}
                    type="button"
                    size="sm"
                    variant={contentFilter === filter ? "default" : "outline"}
                    onClick={() => setContentFilter(filter)}
                    className="h-8 text-xs"
                  >
                    {filter === "todos"
                      ? "Todo"
                      : filter === "diagnostico_ia"
                        ? "Diagnóstico IA"
                        : "Informes"}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSortAsc((value) => !value)}
                className={cn(
                  "h-8 text-xs",
                  sortAsc ? "text-primary" : "text-muted-foreground",
                )}
              >
                <ArrowUpDown className="mr-1 h-4 w-4" />
                {sortAsc ? "Asc" : "Desc"}
              </Button>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <X className="h-3 w-3" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No se encontraron visitas con los filtros aplicados.
          </p>
        ) : (
          <div className="space-y-4">
            {filtered.map((visit) => {
              const isExpanded = expandedVisitId === visit.visita_id;
              const diagnosis = visit.diagnostico_ia;
              const reports = visit.informes ?? [];
              const hasIa = Number(visit.tiene_diagnostico_ia) === 1;
              const hasReports = Number(visit.tiene_informes) === 1;
              const defaultTab = hasIa ? "diagnostico_ia" : "informes";

              return (
                <article
                  key={visit.visita_id}
                  className={cn(
                    "group overflow-hidden rounded-md border bg-card transition-all duration-200",
                    isExpanded
                      ? "border-primary/45 shadow-elevated"
                      : "border-border hover:border-primary/35 hover:bg-primary/[0.025] hover:shadow-card",
                  )}
                >
                  <div
                    className={cn(
                      "flex w-full flex-col gap-3 border-l-4 p-4 transition-colors duration-200 lg:flex-row lg:items-start lg:justify-between",
                      isExpanded
                        ? "border-l-primary bg-primary/7"
                        : "border-l-muted bg-card group-hover:border-l-primary/80 group-hover:bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedVisitId(isExpanded ? null : visit.visita_id)
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0 text-primary" />
                        <p className="text-base font-semibold">
                          {formatDate(visit.fecha_visita)}
                        </p>
                        <PillBadge tone={toneForVisitStatus(visit.estado)}>
                          {VISIT_STATUS_TEXT[visit.estado ?? ""] ??
                            visit.estado ??
                            "Sin estado"}
                        </PillBadge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {visit.medico_tratante || "Profesional no registrado"}
                        </span>
                      </div>
                      {visit.motivo_consulta && (
                        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                          {visit.motivo_consulta}
                        </p>
                      )}
                    </button>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
                      {hasIa && (
                        <PillBadge icon={Brain} tone="ia">
                          Diagnóstico IA
                        </PillBadge>
                      )}
                      {hasReports && (
                        <PillBadge icon={FileText} tone="report">
                          {reports.length || 1} informe
                          {(reports.length || 1) > 1 ? "s" : ""}
                        </PillBadge>
                      )}
                      {!hasIa && !hasReports && (
                        <PillBadge icon={CircleDot}>Sin adjuntos</PillBadge>
                      )}
                      {patientId && (
                        <Button
                          asChild
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                        >
                          <Link to={`/pacientes/${patientId}/visitas/${visit.visita_id}`}>
                            Ver detalle
                            <MoveRight className="ml-1.5 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVisitId(isExpanded ? null : visit.visita_id)
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                        aria-label={isExpanded ? "Contraer visita" : "Expandir visita"}
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            isExpanded && "rotate-180 text-primary",
                          )}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/15 p-6">
                      <Tabs
                        defaultValue={defaultTab}
                        className="overflow-hidden rounded-md border border-border bg-background"
                      >
                        <div className="flex flex-col gap-3 border-b border-border bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Contenido de la visita
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Cambie de sección para revisar diagnóstico IA o informes clínicos.
                            </p>
                          </div>

                          <TabsList className="h-auto w-full justify-start rounded-md border border-primary/20 bg-primary/10 p-1 sm:w-auto">
                            <TabsTrigger
                              value="diagnostico_ia"
                              disabled={!hasIa}
                              className="gap-2 border border-transparent px-3 py-2 text-xs text-primary/80 hover:bg-background/80 hover:text-primary data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-card disabled:text-muted-foreground"
                            >
                              <Brain className="h-3.5 w-3.5" />
                              Diagnóstico IA
                              {hasIa && (
                                <span className="rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-primary data-[state=active]:bg-primary-foreground/20">
                                  {diagnosis?.detalles.length ?? 0}
                                </span>
                              )}
                            </TabsTrigger>
                            <TabsTrigger
                              value="informes"
                              disabled={!hasReports}
                              className="gap-2 border border-transparent px-3 py-2 text-xs text-primary/80 hover:bg-background/80 hover:text-primary data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-card disabled:text-muted-foreground"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Informes
                              {hasReports && (
                                <span className="rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-primary data-[state=active]:bg-primary-foreground/20">
                                  {reports.length}
                                </span>
                              )}
                            </TabsTrigger>
                          </TabsList>
                        </div>

                        <TabsContent
                          value="diagnostico_ia"
                          className="mt-0 p-5"
                        >
                          {diagnosis ? (
                            <section className="space-y-4">
                              <div className="rounded-md border border-border bg-muted/30 p-5">
                                <div>
                                  <div>
                                    <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                                      <Brain className="h-4 w-4 text-primary" />
                                      Resultado de diagnóstico IA
                                    </h3>
                                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                      Clasificación de retinopatía diabética
                                      registrada para esta visita.
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                  <MetricBox
                                    icon={Brain}
                                    label="Modelo"
                                    tone="muted"
                                    value={diagnosis.modelo_nombre || "Modelo IA"}
                                  />
                                  <MetricBox
                                    icon={Eye}
                                    label="Ojos evaluados"
                                    tone="muted"
                                    value={diagnosis.detalles.length}
                                  />
                                  <MetricBox
                                    icon={Activity}
                                    label="Estado clínico"
                                    tone={toneForDiagnosisStatus(diagnosis.estado)}
                                    value={
                                      DIAGNOSIS_STATUS_TEXT[diagnosis.estado] ??
                                      diagnosis.estado
                                    }
                                  />
                                </div>
                              </div>

                              <div className="space-y-3">
                                {diagnosis.detalles.map((detail) => (
                                  <DiagnosisEyeCard
                                    key={detail.detalle_id}
                                    detail={detail}
                                    token={token}
                                    onPreview={setPreviewImage}
                                  />
                                ))}
                              </div>
                            </section>
                          ) : (
                            <EmptyVisitSection
                              icon={Brain}
                              title="Sin diagnóstico IA"
                              description="Esta visita no tiene imágenes procesadas por el modelo de retinopatía diabética."
                            />
                          )}
                        </TabsContent>

                        <TabsContent value="informes" className="mt-0 p-5">
                          {reports.length > 0 ? (
                            <section className="space-y-4">
                              <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <h3 className="flex items-center gap-2 text-base font-semibold text-primary">
                                      <FileText className="h-4 w-4" />
                                      Informes clínicos
                                    </h3>
                                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                      Documentos estructurados registrados como
                                      parte de esta visita.
                                    </p>
                                  </div>
                                  <PillBadge icon={FileText} tone="report">
                                    {reports.length} informe
                                    {reports.length > 1 ? "s" : ""}
                                  </PillBadge>
                                </div>
                              </div>

                              <div className="grid gap-3 xl:grid-cols-2">
                                {reports.map((report) => (
                                  <ReportCard
                                    key={report.id}
                                    report={report}
                                    onView={setSelectedReportId}
                                  />
                                ))}
                              </div>
                            </section>
                          ) : (
                            <EmptyVisitSection
                              icon={FileText}
                              title="Sin informes clínicos"
                              description="Esta visita todavía no tiene informes asociados."
                            />
                          )}
                        </TabsContent>
                      </Tabs>

                      {visit.observaciones && (
                        <div className="mt-4 rounded-md border border-border bg-background p-4">
                          <p className="text-sm font-semibold text-foreground">
                            Observaciones de la visita
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {visit.observaciones}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </CardContent>

      {previewImage && (
        <ImagePreviewLightbox
          src={previewImage.src}
          title={previewImage.title}
          subtitle={previewImage.subtitle}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
        />
      )}

      <PatientReportDetailModal
        reportId={selectedReportId}
        open={selectedReportId !== null}
        patientName={patientName}
        onOpenChange={(open) => {
          if (!open) setSelectedReportId(null);
        }}
      />
    </Card>
  );
}
