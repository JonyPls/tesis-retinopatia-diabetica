import { useState } from "react";
import { Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatClinicalDay } from "@/lib/clinicalDates";
import { getReportTypePresentation } from "@/features/reports/reportTypePresentation";
import type { Diagnosis, PatientVisitReport } from "../../types";
import { PatientReportDetailModal } from "../PatientReportDetailModal";

function shortDate(dateStr: string) {
  return formatClinicalDay(dateStr);
}

function ReportCard({
  report,
  onView,
}: {
  report: PatientVisitReport;
  onView: (reportId: number) => void;
}) {
  const typePresentation = getReportTypePresentation(report.tipo_informe_id);

  return (
    <Card className="rounded-lg border border-border bg-card shadow-card">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                typePresentation.bg,
                typePresentation.color,
              )}
            >
              {typePresentation.icon}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-medium tracking-tight text-foreground">
                {report.tipo_informe_nombre}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Registrado el {shortDate(report.fecha_creado)}
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className="w-fit rounded-md border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
          >
            {report.estado === "ACTIVO" ? "Activo" : report.estado}
          </Badge>
        </div>

        {report.conclusion && (
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conclusión</p>
            <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-foreground">
              {report.conclusion}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end border-t border-border pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onView(report.id)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5 text-primary" />
            Ver informe
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function VisitReportsTab({
  patientDocument,
  patientName,
  visit,
}: {
  patientDocument?: string | null;
  patientName?: string;
  visit: Diagnosis;
}) {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const reports = visit.informes ?? [];

  if (reports.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-info/10">
          <FileText className="h-5 w-5 text-info" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">Sin informes clínicos</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          No se registraron informes clínicos en esta visita.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} onView={setSelectedReportId} />
        ))}
      </div>

      <PatientReportDetailModal
        reportId={selectedReportId}
        open={selectedReportId !== null}
        patientDocument={patientDocument}
        patientName={patientName}
        onOpenChange={(open) => {
          if (!open) setSelectedReportId(null);
        }}
      />
    </>
  );
}
