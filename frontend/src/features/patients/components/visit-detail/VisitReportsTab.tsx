import { useState } from "react";
import { Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getReportTypePresentation } from "@/features/reports/reportTypePresentation";
import type { Diagnosis, PatientVisitReport } from "../../types";
import { PatientReportDetailModal } from "../PatientReportDetailModal";

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
    <Card className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
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
              <h3 className="truncate text-base font-medium tracking-tight text-slate-900">
                {report.tipo_informe_nombre}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Registrado el {shortDate(report.fecha_creado)}
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className="w-fit rounded-full border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success shadow-none"
          >
            {report.estado === "ACTIVO" ? "Activo" : report.estado}
          </Badge>
        </div>

        {report.conclusion && (
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-[11px] font-medium uppercase tracking-widest text-amber-600">Conclusión</p>
            <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-slate-700">
              {report.conclusion}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-slate-200 bg-white text-slate-600 shadow-none hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
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
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-info/10">
          <FileText className="h-5 w-5 text-info" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-900">Sin informes clínicos</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
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
