import { useState } from "react";
import {
  AlertCircle,
  Cake,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileText,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, type Status } from "@/components/medical/StatusBadge";
import { cn } from "@/lib/utils";
import { Patient } from "../types";

interface PatientInfoCardProps {
  patient: Patient;
  calculateAge: (date: string) => number;
  getInitials: (nombres?: string, apellidos?: string) => string;
  status: Status;
  lastVisit: string;
  collapsed: boolean;
  onToggle: () => void;
}

type SectionKey = "identificacion" | "contacto" | "seguimiento" | "clinica";

const SECTION_DEFAULTS: Record<SectionKey, boolean> = {
  identificacion: true,
  contacto: false,
  seguimiento: true,
  clinica: false,
};

function formatDate(date?: string | null) {
  if (!date) return "No registrado";
  return new Date(date).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function getFullName(patient: Patient) {
  return (
    patient.nombres_apellidos ||
    `${patient.nombres ?? ""} ${patient.apellidos ?? ""}`.trim()
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-0.5 break-words text-sm font-medium text-foreground",
            mono && "font-mono",
          )}
        >
          {value || "No registrado"}
        </div>
      </div>
    </div>
  );
}

function PatientInfoSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="border-t border-border first:border-t-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:text-primary"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180 text-primary",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pb-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function PatientInfoCard({
  patient,
  calculateAge,
  getInitials,
  status,
  lastVisit,
  collapsed,
  onToggle,
}: PatientInfoCardProps) {
  const [sectionsOpen, setSectionsOpen] =
    useState<Record<SectionKey, boolean>>(SECTION_DEFAULTS);

  const fullName = getFullName(patient);
  const age = calculateAge(patient.fecha_nacimiento);
  const docType = patient.tipo_doc_abrev || patient.tipo_doc || "Doc.";
  const docLabel = `${docType} ${patient.nro_documento}`;
  const hasClinicalSummary =
    Boolean(patient.antecedentes_clinicos) || Boolean(patient.alergias);

  const setSectionOpen = (section: SectionKey, open: boolean) => {
    setSectionsOpen((current) => ({ ...current, [section]: open }));
  };

  if (collapsed) {
    return (
      <div className="rounded-md border border-border bg-card shadow-card">
        <div className="flex flex-col gap-3 border-l-4 border-l-primary p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-sm font-semibold text-white shadow-elevated">
              {getInitials(patient.nombres, patient.apellidos)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold leading-tight">
                  {fullName}
                </p>
                <StatusBadge status={status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <IdCard className="h-3.5 w-3.5" />
                  {docLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Cake className="h-3.5 w-3.5" />
                  {age} años
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {lastVisit}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Expandir datos del paciente"
            >
              <ChevronDown className="h-4 w-4" />
              Ver ficha
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="h-fit overflow-hidden shadow-card">
      <CardHeader className="pb-4">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-lg font-semibold text-white shadow-elevated">
            {getInitials(patient.nombres, patient.apellidos)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base leading-tight">
                  {fullName}
                </CardTitle>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Mostrar resumen horizontal"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1">
              <StatusBadge status={status} />
            </div>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="p-4">
        <PatientInfoSection
          title="Identificación"
          open={sectionsOpen.identificacion}
          onOpenChange={(open) => setSectionOpen("identificacion", open)}
        >
          <InfoRow icon={IdCard} label={docType} value={patient.nro_documento} mono />
          <InfoRow icon={User} label="Sexo" value={patient.sexo} />
          <InfoRow
            icon={Cake}
            label="Nacimiento"
            value={formatDate(patient.fecha_nacimiento)}
          />
          <InfoRow icon={User} label="Edad" value={`${age} años`} />
        </PatientInfoSection>

        <PatientInfoSection
          title="Contacto"
          open={sectionsOpen.contacto}
          onOpenChange={(open) => setSectionOpen("contacto", open)}
        >
          <InfoRow icon={Phone} label="Teléfono" value={patient.telefono} />
          <InfoRow icon={Mail} label="Correo" value={patient.correo} />
          <InfoRow icon={MapPin} label="Dirección" value={patient.direccion} />
        </PatientInfoSection>

        <PatientInfoSection
          title="Seguimiento"
          open={sectionsOpen.seguimiento}
          onOpenChange={(open) => setSectionOpen("seguimiento", open)}
        >
          <InfoRow icon={Calendar} label="Última visita" value={lastVisit} />
          <InfoRow
            icon={ShieldCheck}
            label="Consentimiento"
            value={
              patient.consentimiento_informado
                ? patient.fecha_consentimiento
                  ? `Archivado · ${formatDate(patient.fecha_consentimiento)}`
                  : "Archivado"
                : "No registrado"
            }
          />
        </PatientInfoSection>

        <PatientInfoSection
          title="Información clínica"
          open={sectionsOpen.clinica}
          onOpenChange={(open) => setSectionOpen("clinica", open)}
        >
          {hasClinicalSummary ? (
            <>
              <InfoRow
                icon={FileText}
                label="Antecedentes"
                value={patient.antecedentes_clinicos}
              />
              <InfoRow
                icon={AlertCircle}
                label="Alergias"
                value={patient.alergias}
              />
            </>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              Sin antecedentes o alergias registrados.
            </p>
          )}
        </PatientInfoSection>
      </CardContent>
    </Card>
  );
}
