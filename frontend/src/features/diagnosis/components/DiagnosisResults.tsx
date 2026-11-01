import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Eye,
  Info,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RD_LEVELS, RDLevel } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { EyeKey, EyeState } from "../types";
import { DiagnosisResult } from "@/features/diagnosis/api/diagnosisService";
import { ImagePanel } from "./ImagePanel";
import { useRetinaImage } from "@/hooks/useRetinaImage";

function GradcamImage({ filename }: { filename: string }) {
  const { src, error, isLoading } = useRetinaImage(filename);
  if (!src) return <div role={error ? "alert" : undefined}
    className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground sm:aspect-[4/3] lg:aspect-[3/2]">
    {error ?? (isLoading ? "Cargando Grad-CAM…" : "No disponible")}
  </div>;
  return <ImagePanel title="Grad-CAM" src={src} compact />;
}

function OriginalImage({ filename }: { filename: string }) {
  const { src, error, isLoading } = useRetinaImage(filename);
  if (!src) return <div role={error ? "alert" : undefined}
    className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground sm:aspect-[4/3] lg:aspect-[3/2]">
    {error ?? (isLoading ? "Cargando imagen clínica…" : "Imagen no disponible")}
  </div>;
  return <ImagePanel title="Imagen original" subtitle={filename} src={src} compact />;
}

interface DiagnosisResultsProps {
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  eyes: Record<EyeKey, EyeState>;
  activeEye: EyeKey;
  setActiveEye: (eye: EyeKey) => void;
}

const EYE_FULL: Record<EyeKey, string> = {
  OD: "Ojo derecho",
  OI: "Ojo izquierdo",
};

const COMPACT_RD_LABELS: Record<RDLevel, string> = {
  0: "Sin RD",
  1: "Leve",
  2: "Moderada",
  3: "Severa",
  4: "Proliferativa",
};

function eyesWithResults(
  results: Partial<Record<EyeKey, DiagnosisResult>>,
): EyeKey[] {
  return (["OD", "OI"] as EyeKey[]).filter((eye) => !!results[eye]);
}

/** Validación persistida leída del resultado; no implica una selección local guardada. */
function persistedValidation(result?: DiagnosisResult): "APROBADO" | "CORREGIDO" | undefined {
  const state = result?.estado_validacion;
  return state === "APROBADO" || state === "CORREGIDO" ? state : undefined;
}

function EyeTabs({
  available,
  active,
  results,
  validatedEyes,
  onSelect,
}: {
  available: EyeKey[];
  active: EyeKey;
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  validatedEyes?: Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">>;
  onSelect: (eye: EyeKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ojo evaluado">
      {available.map((eye) => {
        const result = results[eye]!;
        const isActive = active === eye;
        const isValidated = !!(validatedEyes?.[eye] ?? persistedValidation(result));

        return (
          <button
            key={eye}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(eye)}
            className={cn(
              "flex min-h-10 flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/35 text-muted-foreground hover:bg-muted",
            )}
          >
            <Eye className="h-4 w-4" />
            <span>{EYE_FULL[eye]} ({eye})</span>
            <RDLevelBadge
              level={result.diagnostico_codigo as RDLevel}
              size="sm"
              showLabel={false}
            />
            <span className="text-[11px] font-normal text-muted-foreground">
              {isValidated ? "Validado" : "Pendiente"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ProbabilityBars({ detail }: { detail: Record<string, number> }) {
  const entries = Object.entries(detail ?? {});

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay distribución de probabilidades disponible.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <div key={key} className="space-y-1">
          <div className="flex justify-between gap-3 text-xs">
            <span className="truncate capitalize text-muted-foreground">
              {key.replace(/_/g, " ")}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {val.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${val}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultSummary({ result }: { result: DiagnosisResult }) {
  const codigo = result.diagnostico_codigo as RDLevel;
  const rdInfo = RD_LEVELS[codigo];
  const confianza = result.confianza_general;
  const isCritical = Number(codigo) >= 3;
  const isHighConfidence = confianza >= 70;

  return (
    <section
      className="rounded-lg border border-border bg-background p-4"
      style={{ borderLeft: `4px solid hsl(var(--rd-${codigo}))` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Predicción de IA</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              aria-label={`Nivel predicho: ${codigo}`}
              className="text-4xl font-semibold leading-none tabular-nums"
              style={{ color: `hsl(var(--rd-${codigo}))` }}
            >
              {codigo}
            </span>
            <span className="text-base font-semibold" style={{ color: `hsl(var(--rd-${codigo}))` }}>
              {rdInfo?.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {rdInfo?.description}
          </p>
        </div>
        {!isHighConfidence && (
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-warning" />
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            Confianza del modelo
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              isHighConfidence ? "text-success" : "text-warning",
            )}
          >
            {confianza.toFixed(1)}%
          </span>
        </div>
        <div
          role="meter"
          aria-label="Confianza del modelo"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={confianza}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isHighConfidence ? "bg-success" : "bg-warning",
            )}
            style={{ width: `${confianza}%` }}
          />
        </div>
        {!isHighConfidence && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Confianza baja. Se recomienda revisar la predicción.
          </p>
        )}
      </div>

      {isCritical && (
        <div className="mt-3 flex gap-2.5 rounded-md border border-destructive/25 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-xs">
            <p className="font-semibold text-destructive">
              Caso de atención prioritaria
            </p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">
              Revise hallazgos y conducta clínica antes de guardar.
            </p>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/70">
        ResNet50
      </p>
    </section>
  );
}

function ProbabilitySection({ detail }: { detail: Record<string, number> }) {
  return (
    <Collapsible className="rounded-lg border border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 [&[data-state=open]_.chevron]:rotate-180"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Probabilidades del modelo
          </span>
          <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-4 py-3">
          <ProbabilityBars detail={detail} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GradeSelector({
  activeEye,
  selected,
  iaLevel,
  onChange,
  disabled,
}: {
  activeEye: EyeKey;
  selected: number;
  iaLevel: number;
  onChange?: (eye: EyeKey, value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Grado final del ojo seleccionado">
      {([0, 1, 2, 3, 4] as RDLevel[]).map((level) => {
        const checked = selected === level;
        const matchesIa = iaLevel === level;

        return (
          <Button
            key={level}
            type="button"
            variant="outline"
            title={RD_LEVELS[level].label}
            aria-label={`${level} — ${COMPACT_RD_LABELS[level]}${matchesIa ? " (sugerido por IA)" : ""}`}
            aria-pressed={checked}
            onClick={() => onChange?.(activeEye, level)}
            disabled={disabled}
            className={cn(
              "h-auto min-h-16 min-w-0 flex-col gap-1 rounded-md px-0.5 py-2 text-center",
              checked
                ? "border-primary bg-primary/10 text-primary"
                : "bg-background hover:bg-muted/60",
            )}
            style={{
              borderBottom: `3px solid hsl(var(--rd-${level}))`,
            }}
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {level}
            </span>
            <span className="max-w-full whitespace-normal break-words text-[10px] leading-tight">
              {COMPACT_RD_LABELS[level]}
            </span>
            {matchesIa && (
              <span className="text-[9px] font-medium uppercase leading-none text-muted-foreground">
                IA
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}

export function DiagnosisResults(
  props: DiagnosisResultsProps & {
    finalSelection?: Record<EyeKey, number>;
    setFinalSelection?: (eye: EyeKey, value: number) => void;
    comments?: Record<EyeKey, string>;
    setComment?: (eye: EyeKey, text: string) => void;
    correctionReasons?: Record<EyeKey, string>;
    setCorrectionReason?: (eye: EyeKey, text: string) => void;
    validateDiagnosis?: (eye: EyeKey) => Promise<void>;
    isValidating?: boolean;
    validatedEyes?: Partial<Record<EyeKey, "APROBADO" | "CORREGIDO">>;
  },
) {
  const {
    results,
    eyes,
    activeEye,
    setActiveEye,
    finalSelection,
    setFinalSelection,
    comments,
    setComment,
    correctionReasons,
    setCorrectionReason,
    validatedEyes,
    isValidating,
  } = props;

  const available = eyesWithResults(results);
  const current = results[activeEye];

  if (available.length === 0 || !current) return null;

  const iaLevel = current.diagnostico_codigo;
  const confirmed = validatedEyes?.[activeEye] ?? persistedValidation(current);
  const finalLevel = confirmed
    ? current.diagnostico_final ?? finalSelection?.[activeEye] ?? iaLevel
    : finalSelection?.[activeEye] ?? iaLevel;
  const isCorrected = Number(finalLevel) !== Number(iaLevel);
  const originalFileName = eyes[activeEye].file?.name ?? "Imagen seleccionada";
  // Estado de presentación derivado de datos existentes: una selección local no es
  // una validación persistida. El guardado clínico ocurre al validar el diagnóstico.
  const hasLocalChanges = !confirmed && current.diagnostico_final == null && (
    isCorrected ||
    !!comments?.[activeEye]?.trim() ||
    !!correctionReasons?.[activeEye]?.trim()
  );
  const validationHint =
    "Aún no hay una decisión médica guardada para este ojo. El grado sugerido por la IA está preseleccionado.";

  return (
    <div className="space-y-5">
      <EyeTabs
        available={available}
        active={activeEye}
        results={results}
        validatedEyes={validatedEyes}
        onSelect={setActiveEye}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <ResultSummary result={current} />
          <ProbabilitySection detail={current.probabilidades_detalle} />
        </div>

        <section className="flex flex-col gap-4 rounded-lg border border-primary/20 bg-primary/[0.03] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Validación médica</h3>
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium",
                confirmed
                  ? confirmed === "CORREGIDO"
                    ? "border-warning/40 bg-warning/10 text-foreground"
                    : "border-success/30 bg-success/10 text-success"
                  : hasLocalChanges
                    ? "border-warning/40 bg-warning/10 text-foreground"
                    : "border-border bg-background text-muted-foreground",
              )}
            >
              {confirmed
                ? `Validado · ${confirmed === "CORREGIDO" ? "corregido" : "aprobado"}`
                : hasLocalChanges
                  ? "Cambios sin guardar"
                  : "Pendiente de validación"}
            </span>
          </div>

          {!confirmed && !hasLocalChanges && (
            <p className="text-xs leading-relaxed text-muted-foreground">{validationHint}</p>
          )}

          <GradeSelector
            activeEye={activeEye}
            selected={finalLevel}
            iaLevel={iaLevel}
            onChange={setFinalSelection}
            disabled={!!confirmed || isValidating}
          />

          {isCorrected && (
            <section className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`correction-reason-${activeEye}`} className="text-sm font-medium">Motivo de corrección</label>
                <span className="text-[11px] font-medium uppercase text-muted-foreground">
                  Requerido
                </span>
              </div>
              <Textarea
                id={`correction-reason-${activeEye}`}
                aria-required="true"
                value={correctionReasons?.[activeEye] ?? ""}
                onChange={(event) =>
                  setCorrectionReason?.(activeEye, event.target.value)
                }
                disabled={!!confirmed || isValidating}
                className="min-h-[88px] resize-none bg-background"
                placeholder="Explique por qué el diagnóstico final difiere del resultado IA..."
              />
            </section>
          )}

          <section className="space-y-2">
            <label htmlFor={`medical-comment-${activeEye}`} className="block text-sm font-medium">
              Comentario médico <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Textarea
              id={`medical-comment-${activeEye}`}
              value={comments?.[activeEye] ?? ""}
              disabled={!!confirmed || isValidating}
              onChange={(event) => setComment?.(activeEye, event.target.value)}
              className="min-h-[92px] resize-none"
              placeholder="Observaciones clínicas, conducta sugerida o notas para seguimiento..."
            />
          </section>
        </section>
      </div>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Evidencia visual</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {current.imagen_url
            ? <OriginalImage filename={current.imagen_url} />
            : eyes[activeEye].preview
              ? <ImagePanel title="Imagen original" subtitle={originalFileName} src={eyes[activeEye].preview} compact />
              : <p className="text-sm text-muted-foreground">Imagen original no disponible.</p>}
          {current.gradcam_url
            ? <GradcamImage filename={current.gradcam_url} />
            : <p className="text-sm text-muted-foreground">Grad-CAM no disponible.</p>}
        </div>

        <div className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            El mapa Grad-CAM muestra las regiones de atención del modelo y no constituye un diagnóstico médico independiente.
          </p>
        </div>
      </section>
    </div>
  );
}
