import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, GitCompareArrows } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePatientVisitDetail } from "../hooks/usePatientVisitDetail";
import { VisitDetailHeader } from "../components/visit-detail/VisitDetailHeader";
import { VisitDiagnosisTab } from "../components/visit-detail/VisitDiagnosisTab";
import { VisitComparisonSelector } from "../components/visit-detail/VisitComparisonSelector";
import { VisitComparisonTab } from "../components/visit-detail/VisitComparisonTab";
import { VisitReportsTab } from "../components/visit-detail/VisitReportsTab";
import { VisitSummaryTab } from "../components/visit-detail/VisitSummaryTab";

function LoadingState() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Brain className="h-8 w-8 animate-pulse text-teal-600" />
        <p className="text-sm text-muted-foreground">
          Obteniendo detalle de la visita...
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  description,
  patientId,
}: {
  description: string;
  patientId?: number;
}) {
  const target = patientId && Number.isFinite(patientId) ? `/pacientes/${patientId}` : "/pacientes";

  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <Card className="w-full max-w-xl border-border shadow-card">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-muted">
            <Brain className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            No se encontró la visita
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <div className="mt-6 flex justify-center">
            <Button variant="outline" asChild>
              <Link to={target}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {target === "/pacientes" ? "Volver a Pacientes" : "Volver al historial clínico"}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PatientVisitDetail() {
  const { pacienteId, visitaId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [comparisonSelectorOpen, setComparisonSelectorOpen] = useState(false);
  const compareVisitId = searchParams.get("comparar");
  const [activeTab, setActiveTab] = useState(compareVisitId ? "comparacion" : "resumen");
  const hook = usePatientVisitDetail(pacienteId, visitaId, compareVisitId);

  useEffect(() => {
    if (compareVisitId) setActiveTab("comparacion");
  }, [compareVisitId]);

  if (hook.isLoading) {
    return (
      <AppLayout title="Detalle de visita">
        <LoadingState />
      </AppLayout>
    );
  }

  if (hook.error === "patient_not_found") {
    return (
      <AppLayout title="Paciente no encontrado">
        <EmptyState
          description="No se pudieron encontrar los datos de este paciente."
          patientId={hook.pacienteId}
        />
      </AppLayout>
    );
  }

  if (hook.error || !hook.visit) {
    return (
      <AppLayout title="Visita no encontrada">
        <EmptyState
          description="No se encontró la visita solicitada para este paciente."
          patientId={hook.patient ? hook.pacienteId : undefined}
        />
      </AppLayout>
    );
  }

  const openComparisonSelector = () => setComparisonSelectorOpen(true);

  const selectComparisonVisit = (selectedVisitId: number) => {
    setSearchParams({ comparar: String(selectedVisitId) });
    setActiveTab("comparacion");
    setComparisonSelectorOpen(false);
  };

  const exitComparison = () => {
    setSearchParams({});
    setActiveTab("comparacion");
  };

  const hasComparisonCandidates = hook.visits.some(
    (visit) => Number(visit.visita_id) !== Number(hook.visitaId),
  );

  return (
    <AppLayout title="Detalle de visita">
      <div className="mx-auto max-w-6xl space-y-5">
        <VisitDetailHeader patientId={hook.pacienteId} visit={hook.visit} />

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="overflow-hidden rounded-md border border-border bg-card shadow-card"
        >
          <div className="flex flex-col gap-3 border-b border-border bg-muted/30 p-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto w-full justify-start rounded-md border border-primary/20 bg-primary/10 p-1 sm:w-auto">
              <TabsTrigger
                value="resumen"
                className="px-3 py-2 text-xs text-primary/80 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Resumen
              </TabsTrigger>
              <TabsTrigger
                value="diagnostico"
                className="px-3 py-2 text-xs text-primary/80 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Diagnóstico IA
              </TabsTrigger>
              <TabsTrigger
                value="informes"
                className="px-3 py-2 text-xs text-primary/80 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Informes
              </TabsTrigger>
              <TabsTrigger
                value="comparacion"
                className="px-3 py-2 text-xs text-primary/80 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Comparación
              </TabsTrigger>
            </TabsList>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={openComparisonSelector}
            >
              <GitCompareArrows className="mr-2 h-4 w-4" />
              {hook.comparisonVisit ? "Cambiar comparación" : "Comparar con otra visita"}
            </Button>
          </div>

          <TabsContent value="resumen" className="mt-0 p-4 sm:p-5">
            <VisitSummaryTab visit={hook.visit} />
          </TabsContent>

          <TabsContent value="diagnostico" className="mt-0 p-4 sm:p-5">
            <VisitDiagnosisTab
              diagnosisDetails={hook.diagnosisDetails}
              visit={hook.visit}
            />
          </TabsContent>

          <TabsContent value="informes" className="mt-0 p-4 sm:p-5">
            <VisitReportsTab patientName={hook.patientName} visit={hook.visit} />
          </TabsContent>

          <TabsContent value="comparacion" className="mt-0 p-4 sm:p-5">
            <VisitComparisonTab
              comparisonDetails={hook.comparisonDiagnosisDetails}
              comparisonError={hook.comparisonError}
              comparisonVisit={hook.comparisonVisit}
              currentDetails={hook.diagnosisDetails}
              currentVisit={hook.visit}
              hasCandidates={hasComparisonCandidates}
              isLoading={hook.isComparisonLoading}
              onChangeVisit={openComparisonSelector}
              onExit={exitComparison}
              onSelectVisit={openComparisonSelector}
            />
          </TabsContent>
        </Tabs>

        <VisitComparisonSelector
          currentVisitId={hook.visitaId}
          open={comparisonSelectorOpen}
          visits={hook.visits}
          onOpenChange={setComparisonSelectorOpen}
          onSelect={selectComparisonVisit}
        />
      </div>
    </AppLayout>
  );
}
