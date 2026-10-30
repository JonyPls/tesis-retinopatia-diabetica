import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Download } from "lucide-react";
import { PageContent } from "@/components/layout/PageContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatClinicalInstant } from "@/lib/clinicalDates";
import { descargarReporteDiagnostico } from "../api/patientService";
import { usePatientVisitDetail } from "../hooks/usePatientVisitDetail";
import { VisitContextBand } from "../components/visit-detail/VisitContextBand";
import { VisitDiagnosisTab } from "../components/visit-detail/VisitDiagnosisTab";
import { VisitComparisonSelector } from "../components/visit-detail/VisitComparisonSelector";
import { VisitComparisonTab } from "../components/visit-detail/VisitComparisonTab";
import { VisitReportsTab } from "../components/visit-detail/VisitReportsTab";
import { VisitSummaryTab } from "../components/visit-detail/VisitSummaryTab";
import { PatientLookupError } from "../components/PatientLookupError";

const TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "diagnostico", label: "Diagnóstico IA" },
  { value: "informes", label: "Informes" },
  { value: "comparacion", label: "Comparación" },
];

function LoadingState() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Brain className="h-8 w-8 animate-pulse text-primary" />
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
  const target =
    patientId && Number.isFinite(patientId)
      ? `/pacientes/${patientId}`
      : "/pacientes";

  return (
    <div className="flex min-h-[55vh] items-center justify-center px-4">
      <Card className="w-full max-w-xl rounded-lg border border-border bg-card shadow-card">
        <CardContent className="p-10 text-center sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-5 text-lg font-medium tracking-tight text-foreground">
            No se encontró la visita
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <div className="mt-8 flex justify-center">
            <Button variant="outline" asChild>
              <Link to={target}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {target === "/pacientes"
                  ? "Volver a Pacientes"
                  : "Volver al historial clínico"}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatVisitDate(dateStr: string) {
  return formatClinicalInstant(dateStr);
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

export default function PatientVisitDetail() {
  const { pacienteId, visitaId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [comparisonSelectorOpen, setComparisonSelectorOpen] = useState(false);
  const compareVisitId = searchParams.get("comparar");
  const [activeTab, setActiveTab] = useState(
    compareVisitId ? "comparacion" : "resumen",
  );
  const [isDownloadingDiagnosisReport, setIsDownloadingDiagnosisReport] =
    useState(false);
  const hook = usePatientVisitDetail(pacienteId, visitaId, compareVisitId);

  useEffect(() => {
    if (compareVisitId) setActiveTab("comparacion");
  }, [compareVisitId]);

  if (hook.isLoading) {
    return (
      <PageContent title="Detalle de visita">
        <LoadingState />
      </PageContent>
    );
  }

  if (hook.requestError || hook.comparisonRequestError) {
    return <PageContent title="Detalle de visita"><PatientLookupError error={hook.requestError ?? hook.comparisonRequestError!} /></PageContent>;
  }

  if (hook.error === "patient_not_found") {
    return (
      <PageContent title="Paciente no encontrado">
        <EmptyState
          description="No se pudieron encontrar los datos de este paciente."
          patientId={hook.pacienteId}
        />
      </PageContent>
    );
  }

  if (hook.error || !hook.visit) {
    return (
      <PageContent title="Visita no encontrada">
        <EmptyState
          description="No se encontró la visita solicitada para este paciente."
          patientId={hook.patient ? hook.pacienteId : undefined}
        />
      </PageContent>
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
  const hasDiagnosis = Boolean(hook.visit.diagnostico_ia);
  const patientDocument = hook.patient?.nro_documento
    ? `${hook.patient.tipo_doc_abrev ?? hook.patient.tipo_doc ?? "Doc."} ${hook.patient.nro_documento}`
    : null;
  const patientIdentity = hook.patientName
    ? patientDocument
      ? `${hook.patientName} · ${patientDocument}`
      : hook.patientName
    : undefined;
  const showDiagnosisReportButton =
    activeTab === "diagnostico" && hasDiagnosis;

  const handleDownloadDiagnosisReport = async () => {
    if (isDownloadingDiagnosisReport) return;
    setIsDownloadingDiagnosisReport(true);
    try {
      const { blob, filename } = await descargarReporteDiagnostico(
        hook.visit.visita_id,
      );
      triggerBlobDownload(blob, filename);
      toast({
        title: "Reporte generado",
        description: "La descarga del PDF se inició correctamente.",
      });
    } catch (error) {
      console.error("Error descargando reporte de diagnóstico", error);
      toast({
        title: "No se pudo generar el reporte",
        description:
          "Intenta nuevamente o verifica que la visita tenga diagnóstico IA.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingDiagnosisReport(false);
    }
  };

  return (
    <PageContent
      title="Detalle de visita"
      subtitle={patientIdentity}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          asChild
        >
          <Link to={`/pacientes/${hook.pacienteId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al historial
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <VisitContextBand
          fecha={formatVisitDate(hook.visit.fecha_visita)}
          medico={hook.visit.medico_tratante}
          estado={hook.visit.estado}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-3 border-b border-border sm:flex-row sm:items-end sm:justify-between">
            <TabsList className="-mb-px h-auto w-full justify-start gap-4 overflow-x-auto rounded-none bg-transparent p-0 sm:w-auto">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-1 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {showDiagnosisReportButton && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sm:mb-2"
                disabled={isDownloadingDiagnosisReport}
                onClick={handleDownloadDiagnosisReport}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {isDownloadingDiagnosisReport
                  ? "Generando reporte..."
                  : "Descargar reporte PDF"}
              </Button>
            )}
          </div>

          <TabsContent value="resumen" className="mt-6">
            <VisitSummaryTab visit={hook.visit} />
          </TabsContent>

          <TabsContent value="diagnostico" className="mt-6">
            <VisitDiagnosisTab
              diagnosisDetails={hook.diagnosisDetails}
              visit={hook.visit}
            />
          </TabsContent>

          <TabsContent value="informes" className="mt-6">
            <VisitReportsTab
              patientDocument={patientDocument}
              patientName={hook.patientName}
              visit={hook.visit}
            />
          </TabsContent>

          <TabsContent value="comparacion" className="mt-6">
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
    </PageContent>
  );
}
