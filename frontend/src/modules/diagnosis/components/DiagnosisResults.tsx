import {
  Eye,
  Sparkles,
  AlertTriangle,
  Activity,
  ListChecks,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RD_LEVELS, RDLevel } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { DiagnosisResult } from "@/services/diagnosisService";
import { EyeKey, EyeState } from "../types";
import { ImagePanel } from "./ImagePanel";

interface DiagnosisResultsProps {
  results: Partial<Record<EyeKey, DiagnosisResult>>;
  eyes: Record<EyeKey, EyeState>;
  activeEye: EyeKey;
  setActiveEye: (eye: EyeKey) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Devuelve las claves de los ojos que tienen resultado */
function eyesWithResults(
  results: Partial<Record<EyeKey, DiagnosisResult>>,
): EyeKey[] {
  return (["OD", "OI"] as EyeKey[]).filter((eye) => !!results[eye]);
}

const EYE_FULL: Record<EyeKey, string> = {
  OD: "Ojo Derecho (OD)",
  OI: "Ojo Izquierdo (OI)",
};

// ── Subcomponente: Tabs de selección de ojo ────────────────────────────────────

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
    <div className="flex items-center gap-2">
      {available.map((eye) => (
        <button
          key={eye}
          onClick={() => onSelect(eye)}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium border transition-colors flex items-center gap-2",
            active === eye
              ? "bg-card border-primary text-primary shadow-card"
              : "bg-muted/40 border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Eye className="h-4 w-4" />
          {EYE_FULL[eye]}
          {results[eye] && (
            <RDLevelBadge
              level={results[eye]!.diagnostico_codigo as RDLevel}
              size="sm"
              showLabel={false}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Subcomponente: Panel de probabilidades ─────────────────────────────────────

function ProbabilityBars({ detail }: { detail: Record<string, number> }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
        Distribución de probabilidades
      </div>
      <div className="space-y-2.5">
        {Object.entries(detail).map(([key, val]) => (
          <div key={key} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground capitalize">
                {key.replace(/_/g, " ")}
              </span>
              <span className="font-mono font-medium tabular-nums">
                {val.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-primary rounded-full transition-all duration-500"
                style={{ width: `${val}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subcomponente: Tarjeta de resultado predictivo ─────────────────────────────

function PredictiveCard({ result }: { result: DiagnosisResult }) {
  const codigo = result.diagnostico_codigo as RDLevel;
  const rdInfo = RD_LEVELS[codigo];
  const confianza = result.confianza_general;
  const isCritical = Number(codigo) >= 3;
  const isHighConfidence = confianza >= 70;

  return (
    <Card className="shadow-card overflow-hidden">
      {/* Franja de color del nivel RD */}
      <div
        className="h-2 w-full"
        style={{ backgroundColor: `hsl(var(--rd-${codigo}))` }}
      />

      <CardHeader className="pb-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Resultado Predictivo
        </div>
        <CardTitle className="text-base">Clasificación de Severidad</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Nivel detectado */}
        <div
          className="rounded-lg p-5 text-center"
          style={{
            backgroundColor: `hsl(var(--rd-${codigo}) / 0.08)`,
            border: `1px solid hsl(var(--rd-${codigo}) / 0.3)`,
          }}
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Nivel detectado
          </div>
          <div
            className="text-6xl font-bold tabular-nums leading-none mt-2"
            style={{ color: `hsl(var(--rd-${codigo}))` }}
          >
            {codigo}
          </div>
          <div
            className="text-sm font-semibold mt-2"
            style={{ color: `hsl(var(--rd-${codigo}))` }}
          >
            {rdInfo?.label}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {rdInfo?.description}
          </div>
        </div>

        {/* Barra de confianza */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Confianza del modelo
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
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isHighConfidence ? "bg-gradient-primary" : "bg-amber-400",
              )}
              style={{ width: `${confianza}%` }}
            />
          </div>
          {!isHighConfidence && (
            <p className="text-[11px] text-amber-600 leading-relaxed">
              Confianza menor al 70% — se recomienda revisión detallada.
            </p>
          )}
          {isHighConfidence && (
            <p className="text-[11px] text-success/80 leading-relaxed">
              Alta confianza — precisión estimada del modelo: 92.1%
            </p>
          )}
        </div>

        {/* Alerta caso crítico */}
        {isCritical && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex gap-2.5">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-destructive">CASO CRÍTICO</div>
              <div className="text-muted-foreground mt-0.5 leading-relaxed">
                Se recomienda derivación urgente a especialista en vitreorretina.
              </div>
            </div>
          </div>
        )}

        <Separator className="my-2" />

        <ProbabilityBars detail={result.probabilidades_detalle} />

        {/* Modelo sutil */}
        <div className="text-right text-[10px] text-muted-foreground/60 pt-2 border-t border-border mt-2">
          Análisis generado por IA (Modelo: ResNet50)
        </div>
      </CardContent>
    </Card>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function DiagnosisResults({
  results,
  eyes,
  activeEye,
  setActiveEye,
  // validation props (optional fallback)
  finalSelection,
  setFinalSelection,
  comments,
  setComment,
  validateDiagnosis,
  isValidating,
}: DiagnosisResultsProps & {
  finalSelection?: Record<EyeKey, number>;
  setFinalSelection?: (eye: EyeKey, value: number) => void;
  comments?: Record<EyeKey, string>;
  setComment?: (eye: EyeKey, text: string) => void;
  validateDiagnosis?: (eye: EyeKey) => Promise<void>;
  isValidating?: boolean;
}) {
  const available = eyesWithResults(results);
  const current = results[activeEye];

  if (available.length === 0 || !current) return null;

  return (
    <div className="space-y-6">
      {/* Tabs de selección de ojo */}
      <EyeTabs
        available={available}
        active={activeEye}
        results={results}
        onSelect={setActiveEye}
      />

      {/* Grid principal: imágenes (2/3) + resultado (1/3) */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* ── Panel izquierdo: imágenes + probabilidades ── */}
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Análisis Visual —{" "}
              {activeEye === "OD" ? "Ojo Derecho" : "Ojo Izquierdo"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Imagen original capturada y mapa de calor Grad-CAM generado por la
              red neuronal.
            </p>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Imágenes: original | Grad-CAM */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ImagePanel
                title="Imagen Original"
                subtitle="Fondo de ojo · sin procesar"
                src={eyes[activeEye].preview!}
              />
              <ImagePanel
                title="Mapa de Calor (Grad-CAM)"
                subtitle="Regiones de mayor atención de la IA"
                src={current.gradcam_url}
                overlay
              />
            </div>

            <Separator />

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
                <ListChecks className="h-4 w-4 text-primary" />
                Características asociadas al nivel detectado
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {RD_LEVELS[current.diagnostico_codigo as RDLevel]?.features.map(
                  (feat, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      <span className="text-muted-foreground tracking-wide">
                        {feat}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        {/* ── Panel derecho: clasificación ── */}
        <PredictiveCard result={current} />
      </div>

      {/* Panel de Validación: ocupa todo el ancho */}
      <div>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" /> Panel de
              Validación de Diagnóstico
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              El sistema es una herramienta de apoyo al diagnóstico de retinopatía diabética.
              <b> Confirme o corrija </b>el resultado predictivo según su criterio.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Cards para cada clase */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-6">
              {([0, 1, 2, 3, 4] as number[]).map((level) => {
                const checked = finalSelection
                  ? finalSelection[activeEye] === level
                  : false;
                return (
                  <label
                    key={level}
                    className={`block cursor-pointer rounded-md border p-3 transition-shadow shadow-sm hover:shadow-md ${
                      checked
                        ? "ring-2 ring-offset-1 ring-primary bg-muted/10 border-primary shadow-lg"
                        : "bg-card"
                    }`}
                    style={{ borderLeft: `4px solid hsl(var(--rd-${level}))` }}
                  >
                    <input
                      type="radio"
                      name={`final-${activeEye}`}
                      checked={checked}
                      onChange={() =>
                        setFinalSelection && setFinalSelection(activeEye, level)
                      }
                      className="hidden"
                    />
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">
                          {level}: {RD_LEVELS[level as RDLevel].label}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {RD_LEVELS[level as RDLevel].description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="text-xs text-muted-foreground opacity-60 mt-1">
              Valor por defecto: Predicción IA
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium mt-2">
                  Comentario Médico{" "}
                  <span className="text-xs opacity-60 ml-2">(opcional)</span>
                </div>
              </div>
              <textarea
                value={comments ? comments[activeEye] : ""}
                onChange={(e) =>
                  setComment && setComment(activeEye, e.target.value)
                }
                className="w-full mt-2 rounded-md border border-input bg-background p-3 min-h-[140px] text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition"
                placeholder="Observaciones del especialista..."
              />
            </div>

            {/* Nota: el guardado lo realiza el botón principal 'Guardar Diagnóstico' */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
