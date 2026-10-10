import { useEffect, useMemo, useState } from "react";
import { Calendar, FileText, Loader2, Stethoscope } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  AppModalBody,
  AppModalContent,
  AppModalFooter,
  AppModalHeader,
} from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { obtenerInformeClinico } from "../api/patientService";
import type { PatientReportDetail } from "../types";

interface PatientReportDetailModalProps {
  reportId: number | null;
  open: boolean;
  patientName?: string;
  patientDocument?: string | null;
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
  const date = new Date(dateStr);
  const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  const time = date.toLocaleTimeString("es-PE", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
  });

  return `${weekdays[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} · ${time}`;
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

function getPatientDocument(report: PatientReportDetail | null) {
  const paciente = report?.paciente;
  if (!paciente?.nro_documento) return null;
  return `${paciente.tipo_doc_abrev ?? paciente.tipo_doc ?? "Doc."} ${paciente.nro_documento}`;
}

function SectionCard({
  title,
  tone = "primary",
  children,
}: {
  title: string;
  tone?: "primary" | "secondary" | "success" | "warning";
  children: React.ReactNode;
}) {
  const toneClass = {
    primary: "bg-primary",
    secondary: "bg-secondary",
    success: "bg-success",
    warning: "bg-warning",
  }[tone];

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <span className={cn("h-6 w-1.5 rounded-full", toneClass)} aria-hidden="true" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
      </div>
      {children}
    </section>
  );
}

function DetailRows({
  data,
}: {
  data: Record<string, string | number | boolean | null | undefined>;
}) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return <p className="text-sm leading-relaxed text-muted-foreground">Sin datos registrados.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:items-start">
          <p className="text-sm text-muted-foreground">
            {FIELD_LABELS[key] ?? key.replace(/_/g, " ")}
          </p>
          <p className="text-sm font-semibold leading-relaxed text-foreground sm:text-right">{String(value)}</p>
        </div>
      ))}
    </div>
  );
}

function ConclusionBlock({ text }: { text: string | null }) {
  if (!text) return null;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <SectionCard title="Conclusión" tone="warning">
      <div className="mt-2 space-y-1 text-sm leading-relaxed text-foreground">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </SectionCard>
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
          <SectionCard key={eye} title={normalizeEyeLabel(eye)} tone="secondary">
            <DetailRows data={values} />
          </SectionCard>
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
          <SectionCard key={eye} title={normalizeEyeLabel(eye)} tone="secondary">
            <DetailRows data={values} />
          </SectionCard>
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
          <SectionCard key={eye} title={normalizeEyeLabel(eye)} tone="secondary">
            <DetailRows data={{ "Espesor corneal": value ? `${value} µm` : null }} />
          </SectionCard>
        );
      })}
    </div>
  );
}

function GenericReportDetail({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data).filter(([key]) => key !== "conclusion");
  if (entries.length === 0) {
    return <p className="text-sm leading-relaxed text-muted-foreground">Sin datos estructurados registrados.</p>;
  }
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <SectionCard key={key} title={key.replace(/_/g, " ")} tone="primary">
          <div className="text-sm text-foreground">
            {typeof value === "object" ? (
              <DetailRows data={value as Record<string, any>} />
            ) : (
              String(value)
            )}
          </div>
        </SectionCard>
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
  patientDocument: patientDocumentProp,
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

  const patientDocument = getPatientDocument(report) ?? patientDocumentProp ?? null;
  const professionalName = formatName(report?.profesional);
  const conclusion = getConclusion(report);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppModalContent className="max-w-3xl">
        <AppModalHeader
          icon={<FileText className="h-6 w-6" />}
          title={report?.tipo_informe_nombre ?? "Informe clínico"}
          subtitle={patientDocument ? `${resolvedPatientName} · ${patientDocument}` : resolvedPatientName}
        />
        <AppModalBody className="space-y-5 bg-muted/40">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              Cargando informe...
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">
              {error}
            </div>
          )}

          {!isLoading && report && (
            <>
              <SectionCard title="Responsable y fecha del informe" tone="primary">
                <div className="grid gap-4 text-sm text-foreground sm:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.1fr)] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Fecha del informe</p>
                      <p className="truncate font-semibold text-foreground">{formatDate(report.fecha_creado)}</p>
                    </div>
                  </div>
                  <span className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary/10 text-secondary">
                      <Stethoscope className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Profesional que atendió</p>
                      <p className="truncate font-semibold text-foreground">
                        {professionalName ?? "No registrado"}
                      </p>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Datos del examen</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Información estructurada registrada en el informe.
                  </p>
                </div>
                <StructuredReportDetail report={report} />
              </section>

              <ConclusionBlock text={conclusion} />

              {(report.visita?.motivo_consulta || report.visita?.observaciones) && (
                <SectionCard title="Contexto de la visita" tone="secondary">
                  <DetailRows
                    data={{
                      Motivo: report.visita.motivo_consulta,
                      Observaciones: report.visita.observaciones,
                    }}
                  />
                </SectionCard>
              )}
            </>
          )}
        </AppModalBody>
        <AppModalFooter>
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </AppModalFooter>
      </AppModalContent>
    </Dialog>
  );
}
