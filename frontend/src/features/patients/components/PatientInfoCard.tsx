import {
  AlertCircle,
  Activity,
  Cake,
  Calendar,
  CalendarClock,
  FileText,
  IdCard,
  Mail,
  Phone,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, type Status } from "@/components/medical/StatusBadge";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import type { RDLevel } from "@/data/rdLevels";
import { Patient } from "../types";

interface PatientInfoCardProps {
  patient: Patient;
  calculateAge: (date: string) => number;
  getInitials: (nombres?: string, apellidos?: string) => string;
  status: Status;
  lastVisit: string;
  visitCount: number;
  maxRdLevel: number;
  hasRdData: boolean;
}

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

function formatPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 9) return phone;
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-sm font-medium text-foreground">
          {value || "No registrado"}
        </div>
      </div>
    </div>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
      {children}
    </div>
  );
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <div className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-foreground">
        {children}
      </div>
    </div>
  );
}

export function PatientInfoCard({
  patient,
  calculateAge,
  getInitials,
  status,
  lastVisit,
  visitCount,
  maxRdLevel,
  hasRdData,
}: PatientInfoCardProps) {
  const fullName = getFullName(patient);
  const age = calculateAge(patient.fecha_nacimiento);
  const docType = patient.tipo_doc_abrev || patient.tipo_doc || "Doc.";

  return (
    <Card className="h-fit overflow-hidden shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-base font-semibold text-white shadow-elevated">
            {getInitials(patient.nombres, patient.apellidos)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <CardTitle className="min-w-0 max-w-full break-words text-base leading-tight">
                    {fullName}
                  </CardTitle>
                  <StatusBadge status={status} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="space-y-5 p-4 pt-3">
        <InfoSection title="Datos personales">
          <InfoGrid>
            <InfoRow icon={IdCard} label={docType} value={patient.nro_documento} />
            <InfoRow icon={Users} label="Sexo" value={patient.sexo} />
            <InfoRow
              icon={Cake}
              label="Nacimiento"
              value={formatDate(patient.fecha_nacimiento)}
            />
            <InfoRow icon={CalendarClock} label="Edad" value={`${age} años`} />
            <InfoRow icon={Phone} label="Teléfono" value={formatPhone(patient.telefono)} />
            <InfoRow icon={Mail} label="Correo" value={patient.correo} />
          </InfoGrid>
        </InfoSection>

        <InfoSection title="Información clínica">
          <InfoGrid>
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
            <InfoRow icon={Calendar} label="Última visita" value={lastVisit} />
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
          </InfoGrid>
        </InfoSection>

        <InfoSection title="Resumen clínico">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            <KpiCard icon={Calendar} label="Visitas clínicas">
              <span className="text-lg tabular-nums">{visitCount}</span>
            </KpiCard>
            <KpiCard icon={Activity} label="Máximo grado RD">
              {hasRdData ? (
                <RDLevelBadge level={maxRdLevel as RDLevel} size="sm" />
              ) : (
                <span className="text-muted-foreground">Sin registro IA</span>
              )}
            </KpiCard>
          </div>
        </InfoSection>
      </CardContent>
    </Card>
  );
}
