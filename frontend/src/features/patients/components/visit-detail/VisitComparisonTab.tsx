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

function VisitSnapshot({ label, visit }: { label: string; visit: Diagnosis }) {
  const reportsCount = visit.informes?.length ?? Number(visit.tiene_informes ?? 0);

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</p>
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Calendar className="h-4 w-4 text-primary" />
        {formatDate(visit.fecha_visita)}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {visit.motivo_consulta || "Motivo no registrado"}
      </p>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Stethoscope className="h-3.5 w-3.5" />
        {visit.medico_tratante || "Profesional no registrado"}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge
          variant="outline"
          className={
            hasDiagnosis(visit)
              ? "rounded-md border-amber-200 bg-amber-50 text-amber-700"
              : "rounded-md border-border bg-muted/35 text-muted-foreground"
          }
        >
          <Brain className="mr-1 h-3.5 w-3.5" />
          {hasDiagnosis(visit) ? "Diagnóstico IA" : "Sin IA"}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-md border-primary/20 bg-primary/10 text-primary"
        >
          <FileText className="mr-1 h-3.5 w-3.5" />
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
    <Card className="border-border shadow-card">
      <CardContent className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
          <GitCompareArrows className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Comparar evolución clínica
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Seleccione otra visita del paciente para comparar los resultados registrados
          entre ambas evaluaciones.
        </p>
        {hasCandidates ? (
          <Button type="button" className="mt-5" onClick={onSelectVisit}>
            Seleccionar visita
          </Button>
        ) : (
          <p className="mt-5 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
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
    <Card className="border-border shadow-card">
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Comparación de visitas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Lectura cronológica descriptiva entre dos evaluaciones del mismo paciente.
            </p>
          </div>
          {days !== null && (
            <Badge
              variant="outline"
              className="w-fit rounded-md border-primary/20 bg-primary/10 text-primary"
            >
              {days} día{days === 1 ? "" : "s"} entre evaluaciones
            </Badge>
          )}
        </div>

        <div className="mt-5 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <VisitSnapshot label="Visita anterior" visit={previous} />
          <div className="hidden items-center justify-center text-primary lg:flex">
            <ArrowRight className="h-6 w-6" />
          </div>
          <VisitSnapshot label="Visita posterior" visit={later} />
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
    <Card className="border-border shadow-card">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground">
          Resumen de cambios registrados
        </h3>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {(["OD", "OI"] as EyeKey[]).map((eye) => {
            const comparison = getEyeComparison(
              previous,
              previousDetails,
              later,
              laterDetails,
              eye,
            );

            return (
              <div key={eye} className="rounded-md border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">
                  {eyeDisplayName(eye)}
                </p>
                {comparison.previousEffective.level === null ||
                comparison.laterEffective.level === null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sin evaluación suficiente para calcular diferencia.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Grado {comparison.previousEffective.level} → Grado{" "}
                      {comparison.laterEffective.level}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
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
    <div className="mt-3 grid grid-cols-5 gap-1">
      {RETINOPATHY_SCALE.map((item) => {
        const isPrevious = previousLevel === item.level;
        const isLater = laterLevel === item.level;

        return (
          <div key={item.level} className="min-w-0 text-center">
            <div
              className={[
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
                isPrevious || isLater
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {item.level}
            </div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{item.label}</p>
            {(isPrevious || isLater) && (
              <p className="text-[10px] font-medium text-primary">
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
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Evolución por ojo</h3>
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
            <Card key={eye} className="border-border shadow-card">
              <CardContent className="p-5">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Activity className="h-4 w-4 text-primary" />
                  {eyeDisplayName(eye)}
                </h4>

                <div className="mt-4 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <GradePoint
                    label="Visita anterior"
                    source={comparison.previousEffective.source}
                    value={comparison.previousEffective.level}
                  />
                  <ArrowRight className="mx-auto hidden h-5 w-5 text-primary sm:block" />
                  <GradePoint
                    label="Visita posterior"
                    source={comparison.laterEffective.source}
                    value={comparison.laterEffective.level}
                  />
                </div>

                <GradeScale
                  laterLevel={comparison.laterEffective.level}
                  previousLevel={comparison.previousEffective.level}
                />

                <p className="mt-4 rounded-md border border-primary/15 bg-primary/5 p-3 text-sm font-medium text-foreground">
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
}: {
  label: string;
  source: string;
  value?: number | null;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</p>
      {value === null || value === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">Sin evaluación en esta visita</p>
      ) : (
        <>
          <p className="mt-2 text-xl font-semibold text-foreground">Grado {value}</p>
          <p className="text-sm text-muted-foreground">
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
    <Card className="border-border shadow-card">
      <CardContent className="p-5">
        <h3 className="text-base font-semibold text-foreground">
          IA y validación médica
        </h3>
        <div className="mt-4 space-y-4">
          {(["OD", "OI"] as EyeKey[]).map((eye) => {
            const comparison = getEyeComparison(
              previous,
              previousDetails,
              later,
              laterDetails,
              eye,
            );

            return (
              <div key={eye} className="rounded-md border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">{eyeDisplayName(eye)}</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <IaValidationColumn
                    label="Visita anterior"
                    confidence={comparison.previousEffective.confidence}
                    finalLevel={comparison.previousEffective.finalLevel}
                    iaLevel={comparison.previousEffective.iaLevel}
                    validation={comparison.previousEffective.validation}
                  />
                  <IaValidationColumn
                    label="Visita posterior"
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
  iaLevel,
  label,
  validation,
}: {
  confidence?: number | null;
  finalLevel?: number | null;
  iaLevel?: number | null;
  label: string;
  validation?: string | null;
}) {
  if (iaLevel === null || iaLevel === undefined) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        {label}: sin evaluación de RD
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs font-semibold uppercase text-primary">{label}</p>
      <dl className="mt-2 space-y-1 text-sm">
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
    <Card className="border-border shadow-card">
      <CardContent className="p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              Informes clínicos
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Visita anterior: {previousCount} informe{previousCount === 1 ? "" : "s"} ·
              Visita posterior: {laterCount} informe{laterCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {reportTypes.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            No hay informes clínicos registrados en ninguna de las visitas comparadas.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {reportTypes.map((type) => (
              <div key={type} className="rounded-md border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">{type}</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <ReportPresence label="Visita anterior" reports={previousReports[type]} />
                  <ReportPresence label="Visita posterior" reports={laterReports[type]} />
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
  label,
  reports,
}: {
  label: string;
  reports?: PatientVisitReport[];
}) {
  if (!reports || reports.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase text-primary">{label}</p>
        <p className="mt-1 text-sm text-muted-foreground">No registrado</p>
      </div>
    );
  }

  const latest = [...reports].sort(
    (a, b) => new Date(b.fecha_creado).getTime() - new Date(a.fecha_creado).getTime(),
  )[0];

  return (
    <div>
      <p className="text-xs font-semibold uppercase text-primary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">
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
      <Card className="border-warning/30 bg-warning/10 shadow-card">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            No se encontró la visita seleccionada para comparar con este paciente.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onExit}>
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
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onChangeVisit}>
          Cambiar visita
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <X className="mr-1.5 h-4 w-4" />
          Quitar comparación
        </Button>
      </div>

      {isLoading && (
        <p className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
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
