import { Activity, ArrowRight, Brain, Calendar, FileText, GitCompareArrows, Stethoscope, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DetalleDiagnosticoExistente } from "@/features/diagnosis/api/diagnosisService";
import type { Diagnosis, PatientVisitReport } from "../../types";
import {
  compareRetinopathyGrades,
  daysBetweenVisits,
  eyeDisplayName,
  getEffectiveRetinopathyGrade,
  getExtraDetail,
  getEyeDetail,
  getShortRetinopathyGradeLabel,
  groupReportsByType,
  orderVisitsChronologically,
  percent,
  RETINOPATHY_SCALE,
  type EyeKey,
} from "./visitComparisonUtils";

function formatDate(dateStr: string, compact = false) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: compact ? "short" : "long",
    year: "numeric",
    hour: compact ? undefined : "2-digit",
    minute: compact ? undefined : "2-digit",
  });
}

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function hasDiagnosis(visit: Diagnosis) {
  return Number(visit.tiene_diagnostico_ia) === 1 || Boolean(visit.diagnostico_ia);
}

function sourceLabel(source: string) {
  if (source === "medical") return "Validación médica";
  if (source === "ia_pending") return "IA pendiente de validación médica";
  return "No registrado";
}

function VisitSnapshot({ label, visit, variant = "previous" }: { label: string; visit: Diagnosis; variant?: "previous" | "later" }) {
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);
  const isLater = variant === "later";

  return (
    <div className={isLater
      ? "rounded-lg border border-primary/20 bg-primary/5 p-5"
      : "rounded-lg border border-border bg-muted/40 p-5"}>
      <p className={isLater
        ? "text-xs font-medium uppercase tracking-wide text-primary"
        : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{label}</p>
      <p className="mt-2.5 flex items-center gap-2 text-sm font-medium text-foreground">
        <Calendar className={isLater ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"} />
        {formatDate(visit.fecha_visita)}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {visit.motivo_consulta || "Motivo no registrado"}
      </p>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Stethoscope className={isLater ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5 text-muted-foreground"} />
        {visit.medico_tratante || "Profesional no registrado"}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className={
            hasDiagnosis(visit)
              ? "rounded-md border-warning/40 bg-warning/10 text-foreground"
              : "rounded-md border-border bg-transparent text-muted-foreground"
          }
        >
          <Brain className="mr-1.5 h-3.5 w-3.5 text-warning" />
          {hasDiagnosis(visit) ? "Diagnóstico IA" : "Sin IA"}
        </Badge>
        <Badge
          variant="outline"
          className={isLater
            ? "rounded-md border-primary/20 bg-card text-primary"
            : "rounded-md border-border bg-card text-muted-foreground"}
        >
          <FileText className={isLater ? "mr-1.5 h-3.5 w-3.5 text-primary" : "mr-1.5 h-3.5 w-3.5 text-muted-foreground"} />
          {reportsCount} informe{reportsCount === 1 ? "" : "s"}
        </Badge>
      </div>
    </div>
  );
}

function InitialComparisonState({
  hasCandidates,
  onSelectVisit,
}: {
  hasCandidates: boolean;
  onSelectVisit: () => void;
}) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-10 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GitCompareArrows className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-lg font-medium tracking-tight text-foreground">
          Comparar evolución clínica
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Seleccione otra visita del paciente para comparar los resultados registrados
          entre ambas evaluaciones.
        </p>
        {hasCandidates ? (
          <Button type="button" className="mt-6 rounded-lg" onClick={onSelectVisit}>
            Seleccionar visita
          </Button>
        ) : (
          <p className="mx-auto mt-6 max-w-md rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Aún no existen otras visitas disponibles para comparar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ChronologyHeader({
  later,
  previous,
}: {
  later: Diagnosis;
  previous: Diagnosis;
}) {
  const days = daysBetweenVisits(previous, later);

  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-medium tracking-tight text-foreground">
              Comparación de visitas
            </h2>
          </div>
          {days !== null && (
            <Badge
              variant="outline"
              className="w-fit rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {days} día{days === 1 ? "" : "s"} entre evaluaciones
            </Badge>
          )}
        </div>

        <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <VisitSnapshot label="Visita anterior · A" variant="previous" visit={previous} />
          <div className="hidden items-center justify-center text-primary lg:flex">
            <ArrowRight className="h-6 w-6" />
          </div>
          <VisitSnapshot label="Visita posterior · B" variant="later" visit={later} />
        </div>
      </CardContent>
    </Card>
  );
}

function getEyeComparison(
  previous: Diagnosis,
  previousDetails: DetalleDiagnosticoExistente[],
  later: Diagnosis,
  laterDetails: DetalleDiagnosticoExistente[],
  eye: EyeKey,
) {
  const previousDetail = getEyeDetail(previous, eye);
  const laterDetail = getEyeDetail(later, eye);
  const previousExtra = getExtraDetail(previousDetail, previousDetails, eye);
  const laterExtra = getExtraDetail(laterDetail, laterDetails, eye);
  const previousEffective = getEffectiveRetinopathyGrade(previousDetail, previousExtra);
  const laterEffective = getEffectiveRetinopathyGrade(laterDetail, laterExtra);
  const change = compareRetinopathyGrades(previousEffective.level, laterEffective.level);

  return {
    change,
    laterDetail,
    laterEffective,
    laterExtra,
    previousDetail,
    previousEffective,
    previousExtra,
  };
}

function SummaryChanges({
  later,
  laterDetails,
  previous,
  previousDetails,
}: {
  later: Diagnosis;
  laterDetails: DetalleDiagnosticoExistente[];
  previous: Diagnosis;
  previousDetails: DetalleDiagnosticoExistente[];
}) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-6 sm:p-8">
        <h3 className="text-base font-medium tracking-tight text-foreground">
          Resumen de cambios registrados
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-medium text-muted-foreground">A</span> visita anterior en gris · <span className="font-medium text-primary">B</span> visita posterior en verde
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {(["OD", "OI"] as EyeKey[]).map((eye) => {
            const comparison = getEyeComparison(
              previous,
              previousDetails,
              later,
              laterDetails,
              eye,
            );

            return (
              <div key={eye} className={eye === "OD"
                ? "rounded-lg border border-secondary/20 bg-secondary/5 p-5"
                : "rounded-lg border border-primary/20 bg-primary/5 p-5"}>
                <p className="text-sm font-medium text-foreground">
                  {eyeDisplayName(eye)}
                </p>
                {comparison.previousEffective.level === null ||
                comparison.laterEffective.level === null ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Sin evaluación suficiente para calcular diferencia.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">A · Grado {comparison.previousEffective.level}</span>
                      {" → "}
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">B · Grado {comparison.laterEffective.level}</span>
                    </p>
                    <p className="mt-2 inline-flex rounded-md border border-primary/20 bg-card px-2.5 py-0.5 text-xs font-medium text-primary">
                      Cambio registrado: {comparison.change.shortLabel}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function GradeScale({
  laterLevel,
  previousLevel,
}: {
  laterLevel?: number | null;
  previousLevel?: number | null;
}) {
  return (
    <div className="mt-4 grid grid-cols-5 gap-1">
      {RETINOPATHY_SCALE.map((item) => {
        const isPrevious = previousLevel === item.level;
        const isLater = laterLevel === item.level;

        return (
          <div key={item.level} className="min-w-0 text-center">
            <div
              className={[
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium",
                isPrevious && isLater
                  ? "border-primary bg-primary text-primary-foreground"
                  : isLater
                    ? "border-primary bg-primary text-primary-foreground"
                    : isPrevious
                      ? "border-secondary bg-secondary text-secondary-foreground"
                      : "border-border bg-card text-muted-foreground",
              ].join(" ")}
            >
              {item.level}
            </div>
            <p className="mt-1.5 truncate text-[10px] text-muted-foreground">{item.label}</p>
            {(isPrevious || isLater) && (
              <p className={isLater && !isPrevious
                ? "mt-0.5 text-[10px] font-medium text-primary"
                : isPrevious && !isLater
                  ? "mt-0.5 text-[10px] font-medium text-secondary"
                  : "mt-0.5 text-[10px] font-medium text-primary"}>
                {isPrevious && isLater ? "A/B" : isPrevious ? "A" : "B"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EvolutionByEye({
  later,
  laterDetails,
  previous,
  previousDetails,
}: {
  later: Diagnosis;
  laterDetails: DetalleDiagnosticoExistente[];
  previous: Diagnosis;
  previousDetails: DetalleDiagnosticoExistente[];
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">Evolución por ojo</h3>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["OD", "OI"] as EyeKey[]).map((eye) => {
          const comparison = getEyeComparison(
            previous,
            previousDetails,
            later,
            laterDetails,
            eye,
          );

          return (
            <Card key={eye} className={eye === "OD"
              ? "rounded-lg border border-secondary/20 bg-card shadow-card"
              : "rounded-lg border border-primary/20 bg-card shadow-card"}>
              <CardContent className="p-6">
                <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Activity className={eye === "OD" ? "h-4 w-4 text-secondary" : "h-4 w-4 text-primary"} />
                  {eyeDisplayName(eye)}
                </h4>

                <div className="mt-5 grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
                  <GradePoint
                    label="Visita anterior · A"
                    source={comparison.previousEffective.source}
                    value={comparison.previousEffective.level}
                    tone="slate"
                  />
                  <ArrowRight className="mx-auto hidden h-5 w-5 text-primary sm:block" />
                  <GradePoint
                    label="Visita posterior · B"
                    source={comparison.laterEffective.source}
                    value={comparison.laterEffective.level}
                    tone="primary"
                  />
                </div>

                <GradeScale
                  laterLevel={comparison.laterEffective.level}
                  previousLevel={comparison.previousEffective.level}
                />

                <p className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm font-medium text-foreground">
                  {comparison.change.label}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function GradePoint({
  label,
  source,
  value,
  tone = "slate",
}: {
  label: string;
  source: string;
  value?: number | null;
  tone?: "slate" | "primary";
}) {
  const isPrimary = tone === "primary";
  return (
    <div className={isPrimary
      ? "rounded-lg border border-primary/20 bg-primary/5 p-4"
      : "rounded-lg border border-border bg-muted/40 p-4"}>
      <p className={isPrimary
        ? "text-xs font-medium uppercase tracking-wide text-primary"
        : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{label}</p>
      {value === null || value === undefined ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sin evaluación en esta visita</p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-medium tracking-tight text-foreground">Grado {value}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {getShortRetinopathyGradeLabel(value)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{sourceLabel(source)}</p>
        </>
      )}
    </div>
  );
}

function IaValidationByEye({
  later,
  laterDetails,
  previous,
  previousDetails,
}: {
  later: Diagnosis;
  laterDetails: DetalleDiagnosticoExistente[];
  previous: Diagnosis;
  previousDetails: DetalleDiagnosticoExistente[];
}) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-6 sm:p-8">
        <h3 className="flex items-center gap-2 text-base font-medium tracking-tight text-foreground">
          <Brain className="h-4 w-4 text-warning" />
          IA y validación médica
        </h3>
        <div className="mt-5 space-y-4">
          {(["OD", "OI"] as EyeKey[]).map((eye) => {
            const comparison = getEyeComparison(
              previous,
              previousDetails,
              later,
              laterDetails,
              eye,
            );

            return (
              <div key={eye} className="rounded-lg border border-border bg-muted/40 p-5">
                <p className="text-sm font-medium text-foreground">{eyeDisplayName(eye)}</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <IaValidationColumn
                    label="Visita anterior · A"
                    confidence={comparison.previousEffective.confidence}
                    finalLevel={comparison.previousEffective.finalLevel}
                    iaLevel={comparison.previousEffective.iaLevel}
                    validation={comparison.previousEffective.validation}
                  />
                  <IaValidationColumn
                    highlight
                    label="Visita posterior · B"
                    confidence={comparison.laterEffective.confidence}
                    finalLevel={comparison.laterEffective.finalLevel}
                    iaLevel={comparison.laterEffective.iaLevel}
                    validation={comparison.laterEffective.validation}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function IaValidationColumn({
  confidence,
  finalLevel,
  highlight = false,
  iaLevel,
  label,
  validation,
}: {
  confidence?: number | null;
  finalLevel?: number | null;
  highlight?: boolean;
  iaLevel?: number | null;
  label: string;
  validation?: string | null;
}) {
  if (iaLevel === null || iaLevel === undefined) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        {label}: sin evaluación de RD
      </div>
    );
  }

  return (
    <div className={highlight
      ? "rounded-lg border border-primary/20 bg-primary/5 p-4"
      : "rounded-lg border border-border bg-card p-4"}>
      <p className={highlight
        ? "text-xs font-medium uppercase tracking-wide text-primary"
        : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{label}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Predicción IA</dt>
          <dd className="font-medium text-foreground">{getShortRetinopathyGradeLabel(iaLevel)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Resultado final</dt>
          <dd className="font-medium text-foreground">
            {finalLevel === null || finalLevel === undefined
              ? "Pendiente"
              : getShortRetinopathyGradeLabel(finalLevel)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Estado</dt>
          <dd className="font-medium text-foreground">{validation ?? "Pendiente"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Confianza IA</dt>
          <dd className="font-medium text-foreground">{percent(confidence)}</dd>
        </div>
      </dl>
    </div>
  );
}

function ReportsComparison({
  later,
  previous,
}: {
  later: Diagnosis;
  previous: Diagnosis;
}) {
  const previousReports = groupReportsByType(previous.informes ?? []);
  const laterReports = groupReportsByType(later.informes ?? []);
  const reportTypes = Array.from(
    new Set([...Object.keys(previousReports), ...Object.keys(laterReports)]),
  ).sort((a, b) => a.localeCompare(b));
  const previousCount = previous.informes?.length ?? Number(previous.tiene_informes ?? 0);
  const laterCount = later.informes?.length ?? Number(later.tiene_informes ?? 0);

  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium tracking-tight text-foreground">
              <FileText className="h-4 w-4 text-info" />
              Informes clínicos
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Visita anterior: {previousCount} informe{previousCount === 1 ? "" : "s"} ·
              Visita posterior: {laterCount} informe{laterCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {reportTypes.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No hay informes clínicos registrados en ninguna de las visitas comparadas.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {reportTypes.map((type) => (
              <div key={type} className="rounded-lg border border-info/20 bg-card p-5">
                <p className="text-sm font-medium text-foreground">{type}</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <ReportPresence label="Visita anterior · A" reports={previousReports[type]} />
                  <ReportPresence highlight label="Visita posterior · B" reports={laterReports[type]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportPresence({
  highlight = false,
  label,
  reports,
}: {
  highlight?: boolean;
  label: string;
  reports?: PatientVisitReport[];
}) {
  if (!reports || reports.length === 0) {
    return (
      <div className={highlight ? "rounded-lg bg-primary/5 p-3" : undefined}>
        <p className={highlight
          ? "text-xs font-medium uppercase tracking-wide text-primary"
          : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{label}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">No registrado</p>
      </div>
    );
  }

  const latest = [...reports].sort(
    (a, b) => new Date(b.fecha_creado).getTime() - new Date(a.fecha_creado).getTime(),
  )[0];

  return (
    <div className={highlight ? "rounded-lg border border-primary/20 bg-primary/5 p-3" : undefined}>
      <p className={highlight
        ? "text-xs font-medium uppercase tracking-wide text-primary"
        : "text-xs font-medium uppercase tracking-wide text-muted-foreground"}>{label}</p>
      <p className="mt-1.5 text-sm font-medium text-foreground">
        Disponible · {reports.length} registro{reports.length === 1 ? "" : "s"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Último: {shortDate(latest.fecha_creado)}
      </p>
      {latest.conclusion && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {latest.conclusion}
        </p>
      )}
    </div>
  );
}

export function VisitComparisonTab({
  comparisonDetails,
  comparisonError,
  comparisonVisit,
  currentDetails,
  currentVisit,
  hasCandidates,
  isLoading,
  onChangeVisit,
  onExit,
  onSelectVisit,
}: {
  comparisonDetails: DetalleDiagnosticoExistente[];
  comparisonError?: string | null;
  comparisonVisit: Diagnosis | null;
  currentDetails: DetalleDiagnosticoExistente[];
  currentVisit: Diagnosis;
  hasCandidates: boolean;
  isLoading?: boolean;
  onChangeVisit: () => void;
  onExit: () => void;
  onSelectVisit: () => void;
}) {
  if (!comparisonVisit && !comparisonError) {
    return (
      <InitialComparisonState hasCandidates={hasCandidates} onSelectVisit={onSelectVisit} />
    );
  }

  if (comparisonError || !comparisonVisit) {
    return (
      <Card className="rounded-lg border-border bg-muted/40 shadow-none">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-muted-foreground">
            No se encontró la visita seleccionada para comparar con este paciente.
          </p>
          <Button type="button" variant="outline" size="sm" className="border-border bg-card text-muted-foreground shadow-none hover:bg-card hover:text-foreground" onClick={onExit}>
            Quitar comparación
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { later, laterDetails, previous, previousDetails } = orderVisitsChronologically(
    currentVisit,
    comparisonVisit,
    currentDetails,
    comparisonDetails,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border bg-card text-muted-foreground shadow-none hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          onClick={onChangeVisit}
        >
          Cambiar visita
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onExit}
        >
          <X className="mr-1.5 h-4 w-4" />
          Quitar comparación
        </Button>
      </div>

      {isLoading && (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Cargando detalles de la visita seleccionada...
        </p>
      )}

      <ChronologyHeader later={later} previous={previous} />
      <SummaryChanges
        later={later}
        laterDetails={laterDetails}
        previous={previous}
        previousDetails={previousDetails}
      />
      <EvolutionByEye
        later={later}
        laterDetails={laterDetails}
        previous={previous}
        previousDetails={previousDetails}
      />
      <IaValidationByEye
        later={later}
        laterDetails={laterDetails}
        previous={previous}
        previousDetails={previousDetails}
      />
      <ReportsComparison later={later} previous={previous} />
    </div>
  );
}
