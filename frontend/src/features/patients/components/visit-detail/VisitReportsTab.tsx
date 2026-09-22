import { useState } from "react";
import { Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  return (
    <Card className="border-border shadow-card">
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">
                {report.tipo_informe_nombre}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Registrado el {shortDate(report.fecha_creado)}
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className="w-fit rounded-md border-success/30 bg-success/10 px-2 py-1 text-xs font-medium text-success"
          >
            {report.estado === "ACTIVO" ? "Activo" : report.estado}
          </Badge>
        </div>

        {report.conclusion && (
          <div className="mt-4 rounded-md border border-primary/15 bg-primary/5 p-3">
            <p className="text-xs font-semibold text-primary">Conclusión</p>
            <p className="mt-1 line-clamp-4 text-sm leading-relaxed text-foreground">
              {report.conclusion}
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button type="button" size="sm" variant="outline" onClick={() => onView(report.id)}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Ver informe
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function VisitReportsTab({
  patientName,
  visit,
}: {
  patientName?: string;
  visit: Diagnosis;
}) {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const reports = visit.informes ?? [];

  if (reports.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">Sin informes clínicos</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          No se registraron informes clínicos en esta visita.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-2">
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} onView={setSelectedReportId} />
        ))}
      </div>

      <PatientReportDetailModal
        reportId={selectedReportId}
        open={selectedReportId !== null}
        patientName={patientName}
        onOpenChange={(open) => {
          if (!open) setSelectedReportId(null);
        }}
      />
    </>
  );
}
