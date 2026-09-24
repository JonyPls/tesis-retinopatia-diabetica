import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Download } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { descargarReporteDiagnostico } from "../api/patientService";
import { usePatientVisitDetail } from "../hooks/usePatientVisitDetail";
import { VisitDiagnosisTab } from "../components/visit-detail/VisitDiagnosisTab";
import { VisitComparisonSelector } from "../components/visit-detail/VisitComparisonSelector";
import { VisitComparisonTab } from "../components/visit-detail/VisitComparisonTab";
import { VisitReportsTab } from "../components/visit-detail/VisitReportsTab";
import { VisitSummaryTab } from "../components/visit-detail/VisitSummaryTab";

function LoadingState() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Brain className="h-8 w-8 animate-pulse text-primary" />
        <p className="text-sm text-slate-500">
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
    <div className="flex min-h-[55vh] items-center justify-center px-4">
      <Card className="w-full max-w-xl rounded-xl border-slate-200/80 bg-white shadow-sm">
        <CardContent className="p-10 text-center sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-5 text-lg font-medium tracking-tight text-slate-900">
            No se encontró la visita
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            {description}
          </p>
          <div className="mt-8 flex justify-center">
            <Button variant="outline" className="border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900" asChild>
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

function formatVisitDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [activeTab, setActiveTab] = useState(compareVisitId ? "comparacion" : "resumen");
  const [isDownloadingDiagnosisReport, setIsDownloadingDiagnosisReport] = useState(false);
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
  const hasDiagnosis = Boolean(hook.visit.diagnostico_ia);
  const pageSubtitle = [
    `Visita del ${formatVisitDate(hook.visit.fecha_visita)}`,
    hook.visit.motivo_consulta,
    hook.visit.medico_tratante || "Profesional no registrado",
  ]
    .filter(Boolean)
    .join(" · ");
  const patientDocument = hook.patient?.nro_documento
    ? `${hook.patient.tipo_doc_abrev ?? hook.patient.tipo_doc ?? "Doc."} ${hook.patient.nro_documento}`
    : null;
  const showDiagnosisReportButton = activeTab === "diagnostico" && hasDiagnosis;

  const handleDownloadDiagnosisReport = async () => {
    if (isDownloadingDiagnosisReport) return;
    setIsDownloadingDiagnosisReport(true);
    try {
      const { blob, filename } = await descargarReporteDiagnostico(hook.visit.visita_id);
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
      setIsDownloadingDiagnosisReport(false);
    }
  };

  return (
    <AppLayout
      title="Visita clínica"
      subtitle={pageSubtitle}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-50 hover:text-slate-900"
          asChild
        >
          <Link to={`/pacientes/${hook.pacienteId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al historial
          </Link>
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm"
        >
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto w-full justify-start rounded-lg border border-slate-200/60 bg-slate-100 p-1 sm:w-auto">
              <TabsTrigger
                value="resumen"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                Resumen
              </TabsTrigger>
              <TabsTrigger
                value="diagnostico"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                Diagnóstico IA
              </TabsTrigger>
              <TabsTrigger
                value="informes"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                Informes
              </TabsTrigger>
              <TabsTrigger
                value="comparacion"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                Comparación
              </TabsTrigger>
            </TabsList>

            {showDiagnosisReportButton && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-slate-200 bg-white text-slate-600 shadow-none hover:border-primary/40 hover:bg-primary/5 hover:text-primary sm:w-auto"
                disabled={isDownloadingDiagnosisReport}
                onClick={handleDownloadDiagnosisReport}
              >
                <Download className="mr-1.5 h-3.5 w-3.5 text-primary" />
                {isDownloadingDiagnosisReport ? "Generando reporte..." : "Descargar reporte PDF"}
              </Button>
            )}
          </div>

          <TabsContent value="resumen" className="mt-0 px-5 py-6 sm:px-6 lg:px-8">
            <VisitSummaryTab visit={hook.visit} />
          </TabsContent>

          <TabsContent value="diagnostico" className="mt-0 px-5 py-6 sm:px-6 lg:px-8">
            <VisitDiagnosisTab
              diagnosisDetails={hook.diagnosisDetails}
              visit={hook.visit}
            />
          </TabsContent>

          <TabsContent value="informes" className="mt-0 px-5 py-6 sm:px-6 lg:px-8">
            <VisitReportsTab
              patientDocument={patientDocument}
              patientName={hook.patientName}
              visit={hook.visit}
            />
          </TabsContent>

          <TabsContent value="comparacion" className="mt-0 px-5 py-6 sm:px-6 lg:px-8">
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
