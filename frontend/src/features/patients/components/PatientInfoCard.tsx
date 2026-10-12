import { Mail, Phone, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Patient, PatientReadScope } from "../types";

interface PatientInfoCardProps {
  patient: Patient;
  scope: PatientReadScope;
  calculateAge: (date: string) => number;
  getInitials: (nombres?: string, apellidos?: string) => string;
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

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground">
        {Icon && (
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="break-words">{value || "No registrado"}</span>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function PatientInfoCard({
  patient,
  scope,
  calculateAge,
  getInitials,
}: PatientInfoCardProps) {
  const fullName = getFullName(patient);
  const age = calculateAge(patient.fecha_nacimiento);
  const docType = patient.tipo_doc_abrev || patient.tipo_doc || "Doc.";

  const consent = patient.consentimiento_informado
    ? patient.fecha_consentimiento
      ? `Archivado · ${formatDate(patient.fecha_consentimiento)}`
      : "Archivado"
    : "No registrado";

  return (
    <Card className="h-fit overflow-hidden shadow-card">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
            {getInitials(patient.nombres, patient.apellidos)}
          </div>
          <div className="min-w-0">
            <CardTitle className="break-words text-sm font-medium leading-tight">
              {fullName}
            </CardTitle>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {docType} {patient.nro_documento}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-4 pb-4 pt-2">
        <Section title="Personal">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            <Field label={docType} value={patient.nro_documento} />
            <Field label="Sexo" value={patient.sexo} />
            <Field
              label="Nacimiento"
              value={formatDate(patient.fecha_nacimiento)}
            />
            <Field label="Edad" value={`${age} años`} />
            <Field
              icon={Phone}
              label="Teléfono"
              value={formatPhone(patient.telefono)}
            />
            <Field icon={Mail} label="Correo" value={patient.correo} />
          </div>
        </Section>

        {scope !== "administrative" && <Section title="Consentimiento">
          <Field label="Consentimiento" value={consent} />
        </Section>}
        {scope !== "administrative" && <Section title="Clínico">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            {scope === "clinical" && <Field
              label="Antecedentes"
              value={patient.antecedentes_clinicos}
            />}
            <Field label="Alergias" value={patient.alergias} />
          </div>
        </Section>}
      </CardContent>
    </Card>
  );
}
