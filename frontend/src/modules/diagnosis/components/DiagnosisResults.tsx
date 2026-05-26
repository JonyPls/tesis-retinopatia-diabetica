import { Eye, Sparkles, AlertTriangle, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { RD_LEVELS, RDLevel } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { DiagnosisResult } from "@/services/diagnosisService";
import { EyeKey, EyeState } from "../types";
import { ImagePanel } from "./ImagePanel";
import fundusGradcam from "@/assets/fundus-gradcam.jpg";

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
              Confianza menor al 70% — se recomienda revisión manual por el
              especialista.
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
              <div className="font-semibold text-destructive">Caso crítico</div>
              <div className="text-muted-foreground mt-0.5 leading-relaxed">
                Se recomienda derivación urgente a especialista en
                vitreorretina.
              </div>
            </div>
          </div>
        )}

        {/* Modelo utilizado */}
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs">
          <div className="text-muted-foreground">Modelo</div>
          <div className="font-mono font-medium mt-0.5">ResNet50</div>
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
}: DiagnosisResultsProps) {
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
                src={fundusGradcam}
                overlay
              />
            </div>

            <Separator />

            {/* Barras de probabilidades */}
            <ProbabilityBars detail={current.probabilidades_detalle} />
          </CardContent>
        </Card>

        {/* ── Panel derecho: clasificación ── */}
        <PredictiveCard result={current} />
      </div>
    </div>
  );
}
