import { useEffect, useMemo, useState } from "react";
import { Calendar, FileText, Loader2, Stethoscope, User } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  AppModalBody,
  AppModalContent,
  AppModalHeader,
} from "@/components/ui/app-modal";
import { Badge } from "@/components/ui/badge";
import { obtenerInformeClinico } from "../api/patientService";
import type { PatientReportDetail } from "../types";

interface PatientReportDetailModalProps {
  reportId: number | null;
  open: boolean;
  patientName?: string;
  onOpenChange: (open: boolean) => void;
}

const FIELD_LABELS: Record<string, string> = {
  programa: "Programa",
  fijación: "Fijación",
  "comprobar_fijación": "Comprobar fijación",
  pérdidas: "Pérdidas",
  falso_positivo: "Falso positivo",
  error: "Error",
  fondo: "Fondo",
  puntos_presentados: "Puntos presentados",
  superior: "Superior",
  inferior: "Inferior",
  nasal: "Nasal",
  temporal: "Temporal",
};

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "No registrado";
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatName(person?: { nombres?: string; apellidos?: string } | null) {
  if (!person) return null;
  return `${person.nombres ?? ""} ${person.apellidos ?? ""}`.trim() || null;
}

function getConclusion(report: PatientReportDetail | null) {
  if (!report) return null;
  if (report.conclusion?.trim()) return report.conclusion.trim();
  const conclusion = report.datos_estructurados?.conclusion;
  if (Array.isArray(conclusion)) {
    const items = conclusion.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items.join("\n") : null;
  }
  if (conclusion) return String(conclusion).trim();
  return null;
}

function normalizeEyeLabel(eye: string) {
  const normalized = eye.toUpperCase();
  if (normalized === "OD") return "Ojo derecho (OD)";
  if (normalized === "OI") return "Ojo izquierdo (OI)";
  return eye;
}

function DetailGrid({
  data,
}: {
  data: Record<string, string | number | boolean | null | undefined>;
}) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos registrados.</p>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {FIELD_LABELS[key] ?? key.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{String(value)}</p>
        </div>
      ))}
    </div>
  );
}

function ConclusionBlock({ text }: { text: string | null }) {
  if (!text) return null;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <section className="rounded-md border border-primary/20 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-primary">Conclusión</p>
      <div className="mt-2 space-y-1 text-sm leading-relaxed text-foreground">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}

function CampoVisualDetail({ data }: { data: Record<string, any> }) {
  const campos = data.campos ?? {};
  const eyes = data.ojos ?? Object.keys(campos).map((eye) => eye.toUpperCase());
  return (
    <div className="space-y-4">
      {eyes.map((eye: string) => {
        const values = campos[eye] ?? campos[eye.toLowerCase()] ?? {};
        return (
          <section key={eye} className="rounded-md border border-border bg-muted/20 p-4">
            <h4 className="text-sm font-semibold">{normalizeEyeLabel(eye)}</h4>
            <div className="mt-3">
              <DetailGrid data={values} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GonioscopiaDetail({ data }: { data: Record<string, any> }) {
  const grados = data.grados ?? {};
  const eyes = data.ojos ?? Object.keys(grados).map((eye) => eye.toUpperCase());
  return (
    <div className="space-y-4">
      {eyes.map((eye: string) => {
        const values = grados[eye] ?? grados[eye.toLowerCase()] ?? {};
        return (
          <section key={eye} className="rounded-md border border-border bg-muted/20 p-4">
            <h4 className="text-sm font-semibold">{normalizeEyeLabel(eye)}</h4>
            <div className="mt-3">
              <DetailGrid data={values} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PaquimetriaDetail({ data }: { data: Record<string, any> }) {
  const valores = data.valores ?? {};
  const eyes = data.ojos ?? Object.keys(valores).map((eye) => eye.toUpperCase());
  return (
    <div className="space-y-4">
      {eyes.map((eye: string) => {
        const value = valores[eye] ?? valores[eye.toLowerCase()];
        return (
          <section key={eye} className="rounded-md border border-border bg-muted/20 p-4">
            <h4 className="text-sm font-semibold">{normalizeEyeLabel(eye)}</h4>
            <div className="mt-3">
              <DetailGrid data={{ "Espesor corneal": value ? `${value} µm` : null }} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GenericReportDetail({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data).filter(([key]) => key !== "conclusion");
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos estructurados registrados.</p>;
  }
  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <section key={key} className="rounded-md border border-border bg-muted/20 p-4">
          <h4 className="text-sm font-semibold">{key.replace(/_/g, " ")}</h4>
          <div className="mt-2 text-sm text-foreground">
            {typeof value === "object" ? (
              <DetailGrid data={value as Record<string, any>} />
            ) : (
              String(value)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function StructuredReportDetail({ report }: { report: PatientReportDetail }) {
  const data = report.datos_estructurados ?? {};
  if (report.tipo_informe_id === 2) return <CampoVisualDetail data={data} />;
  if (report.tipo_informe_id === 3) return <GonioscopiaDetail data={data} />;
  if (report.tipo_informe_id === 4) return <PaquimetriaDetail data={data} />;
  return <GenericReportDetail data={data} />;
}

export function PatientReportDetailModal({
  reportId,
  open,
  patientName,
  onOpenChange,
}: PatientReportDetailModalProps) {
  const [report, setReport] = useState<PatientReportDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !reportId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    obtenerInformeClinico(reportId)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReport(null);
          setError(err.response?.data?.message || "No se pudo cargar el informe.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportId]);

  const resolvedPatientName = useMemo(() => {
    return formatName(report?.paciente) ?? patientName ?? "Paciente no registrado";
  }, [patientName, report]);

  const professionalName = formatName(report?.profesional);
  const conclusion = getConclusion(report);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppModalContent className="max-w-4xl">
        <AppModalHeader
          icon={<FileText className="h-6 w-6" />}
          title={report?.tipo_informe_nombre ?? "Informe clínico"}
          subtitle={resolvedPatientName}
        />
        <AppModalBody className="space-y-5">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando informe...
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!isLoading && report && (
            <>
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    Paciente
                  </p>
                  <p className="mt-1 text-sm font-semibold">{resolvedPatientName}</p>
                  {report.paciente?.nro_documento && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Doc. {report.paciente.nro_documento}
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Fecha
                  </p>
                  <p className="mt-1 text-sm font-semibold">{formatDate(report.fecha_creado)}</p>
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Stethoscope className="h-3.5 w-3.5" />
                    Profesional
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {professionalName ?? "No registrado"}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs font-medium text-muted-foreground">Visita asociada</p>
                  <p className="mt-1 text-sm font-semibold">#{report.visita?.id ?? report.visita_id}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(report.visita?.fecha_visita)}
                  </p>
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{report.estado}</Badge>
                <Badge variant="secondary">Tipo #{report.tipo_informe_id}</Badge>
                {report.schema_version && (
                  <Badge variant="outline">Schema v{report.schema_version}</Badge>
                )}
              </div>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Datos del examen</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Información estructurada registrada en el informe.
                  </p>
                </div>
                <StructuredReportDetail report={report} />
              </section>

              <ConclusionBlock text={conclusion} />

              {(report.visita?.motivo_consulta || report.visita?.observaciones) && (
                <section className="rounded-md border border-border bg-background p-4">
                  <p className="text-sm font-semibold">Contexto de la visita</p>
                  {report.visita.motivo_consulta && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Motivo: {report.visita.motivo_consulta}
                    </p>
                  )}
                  {report.visita.observaciones && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Observaciones: {report.visita.observaciones}
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </AppModalBody>
      </AppModalContent>
    </Dialog>
  );
}
