import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RD_LEVELS, RDLevel } from "@/data/rdLevels";
import { cn } from "@/lib/utils";
import { EyeKey, EyeState } from "../types";
import { DiagnosisResult } from "@/features/diagnosis/api/diagnosisService";
import { ImagePanel } from "./ImagePanel";

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

const EYE_SHORT: Record<EyeKey, string> = {
  OD: "OD",
  OI: "OI",
};

const COMPACT_RD_LABELS: Record<RDLevel, string> = {
  0: "Sin RD",
  1: "Leve",
  2: "Moderada",
  3: "Severa",
  4: "Prolif.",
};

function eyesWithResults(
  results: Partial<Record<EyeKey, DiagnosisResult>>,
): EyeKey[] {
  return (["OD", "OI"] as EyeKey[]).filter((eye) => !!results[eye]);
}

function EyeTabs({
  available,
  active,
  results,
  onSelect,
}: {
  available: EyeKey[];
  active: EyeKey;
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  onSelect: (eye: EyeKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {available.map((eye) => {
        const result = results[eye]!;
        const isActive = active === eye;

        return (
          <button
            key={eye}
            type="button"
            onClick={() => onSelect(eye)}
            className={cn(
              "flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary bg-primary/10 text-primary shadow-card"
                : "border-border bg-muted/35 text-muted-foreground hover:bg-muted",
            )}
          >
            <Eye className="h-4 w-4" />
            <span>{EYE_FULL[eye]}</span>
            <RDLevelBadge
              level={result.diagnostico_codigo as RDLevel}
              size="sm"
              showLabel={false}
            />
          </button>
        );
      })}
    </div>
  );
}

function ProbabilityBars({ detail }: { detail: Record<string, number> }) {
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
            <span className="truncate text-muted-foreground capitalize">
              {key.replace(/_/g, " ")}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {val.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-primary transition-all duration-500"
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
    <div className="space-y-3">
      <div
        className="rounded-md border bg-background p-3"
        style={{ borderLeft: `4px solid hsl(var(--rd-${codigo}))` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Resultado IA
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className="text-2xl font-semibold tabular-nums"
                style={{ color: `hsl(var(--rd-${codigo}))` }}
              >
                {codigo}
              </span>
              <RDLevelBadge level={codigo} size="sm" />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {rdInfo?.description}
            </p>
          </div>
          {isHighConfidence ? (
            <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-500" />
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Confianza
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                isHighConfidence ? "text-success" : "text-amber-500",
              )}
            >
              {confianza.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isHighConfidence ? "bg-gradient-primary" : "bg-amber-400",
              )}
              style={{ width: `${confianza}%` }}
            />
          </div>
          {!isHighConfidence && (
            <p className="text-[11px] leading-relaxed text-amber-600">
              Confianza menor al 70%. Revisión médica recomendada.
            </p>
          )}
        </div>
      </div>

      {isCritical && (
        <div className="flex gap-2.5 rounded-md border border-destructive/25 bg-destructive/5 p-3">
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
    </div>
  );
}

function GradeSelector({
  activeEye,
  selected,
  iaLevel,
  onChange,
}: {
  activeEye: EyeKey;
  selected: number;
  iaLevel: number;
  onChange?: (eye: EyeKey, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {([0, 1, 2, 3, 4] as RDLevel[]).map((level) => {
        const checked = selected === level;
        const matchesIa = iaLevel === level;

        return (
          <Button
            key={level}
            type="button"
            variant="outline"
            title={RD_LEVELS[level].label}
            onClick={() => onChange?.(activeEye, level)}
            className={cn(
              "h-16 min-w-0 flex-col gap-1 rounded-md px-1 text-center transition-all",
              checked
                ? "border-primary bg-primary/10 text-primary shadow-card"
                : "bg-background hover:bg-muted/60",
            )}
            style={{
              borderBottom: `3px solid hsl(var(--rd-${level}))`,
            }}
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {level}
            </span>
            <span className="max-w-full truncate text-[10px] leading-none">
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
  } = props;

  const available = eyesWithResults(results);
  const current = results[activeEye];

  if (available.length === 0 || !current) return null;

  const iaLevel = current.diagnostico_codigo;
  const finalLevel = finalSelection?.[activeEye] ?? iaLevel;
  const isCorrected = Number(finalLevel) !== Number(iaLevel);
  const originalFileName = eyes[activeEye].file?.name ?? "Imagen seleccionada";
  const finalInfo = RD_LEVELS[finalLevel as RDLevel];

  return (
    <div className="space-y-4">
      <EyeTabs
        available={available}
        active={activeEye}
        results={results}
        onSelect={setActiveEye}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="shadow-card">
          <CardHeader className="border-b border-border bg-muted/25 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" />
              Evidencia visual · {EYE_FULL[activeEye]} ({EYE_SHORT[activeEye]})
            </CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {originalFileName}
            </p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ImagePanel
                title="Imagen original"
                subtitle="Fondo de ojo sin procesar"
                src={eyes[activeEye].preview!}
              />
              <ImagePanel
                title="Grad-CAM"
                subtitle="Regiones de mayor atención de la IA"
                src={current.gradcam_url}
                overlay
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="border-b border-border bg-muted/25 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4 text-primary" />
              Validación médica
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Confirme o corrija el resultado antes de guardar el diagnóstico.
            </p>
          </CardHeader>

          <CardContent className="space-y-4 p-4">
            <ResultSummary result={current} />

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Diagnóstico final</p>
                  <p className="text-xs text-muted-foreground">
                    Por defecto coincide con la predicción IA.
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium",
                    isCorrected
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-success/30 bg-success/10 text-success",
                  )}
                >
                  {isCorrected ? "Corregido" : "Aprobado"}
                </span>
              </div>

              <GradeSelector
                activeEye={activeEye}
                selected={finalLevel}
                iaLevel={iaLevel}
                onChange={setFinalSelection}
              />

              <p className="text-xs leading-relaxed text-muted-foreground">
                Seleccionado:{" "}
                <span className="font-medium text-foreground">
                  {finalLevel}: {finalInfo?.label}
                </span>
              </p>
            </section>

            {isCorrected && (
              <section className="space-y-2 rounded-md border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-amber-900">
                    Motivo de corrección
                  </p>
                  <span className="text-[11px] font-medium uppercase text-amber-700">
                    Requerido
                  </span>
                </div>
                <Textarea
                  value={correctionReasons?.[activeEye] ?? ""}
                  onChange={(event) =>
                    setCorrectionReason?.(activeEye, event.target.value)
                  }
                  className="min-h-[88px] resize-none bg-background"
                  placeholder="Explique por qué el diagnóstico final difiere del resultado IA..."
                />
              </section>
            )}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Comentario médico</p>
                <span className="text-[11px] text-muted-foreground">
                  Opcional
                </span>
              </div>
              <Textarea
                value={comments?.[activeEye] ?? ""}
                onChange={(event) => setComment?.(activeEye, event.target.value)}
                className="min-h-[92px] resize-none"
                placeholder="Observaciones clínicas, conducta sugerida o notas para seguimiento..."
              />
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Probabilidades</p>
              </div>
              <ProbabilityBars detail={current.probabilidades_detalle} />
            </section>

            <div className="border-t border-border pt-2 text-right text-[10px] text-muted-foreground/70">
              Modelo: ResNet50
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
