import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/medical/StatusBadge";
import { IdCard, Cake, User, Phone, Calendar } from "lucide-react";
import { Patient, Diagnosis } from "../types";

interface PatientInfoCardProps {
  patient: Patient;
  diagnoses: Diagnosis[];
  calculateAge: (date: string) => number;
  getInitials: (nombres?: string, apellidos?: string) => string;
  status: string;
  lastVisit: string;
  maxLevel: number;
}

export function PatientInfoCard({
  patient,
  diagnoses,
  calculateAge,
  getInitials,
  status,
  lastVisit,
  maxLevel,
}: PatientInfoCardProps) {
  const fullName =
    patient.nombres_apellidos ||
    `${patient.nombres} ${patient.apellidos}`.trim();

  return (
    <Card className="lg:col-span-1 shadow-card h-fit">
      <CardHeader className="pb-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-lg shadow-elevated">
            {getInitials(patient.nombres, patient.apellidos)}
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base leading-tight">
              {fullName}
            </CardTitle>
            <div className="mt-1.5">
              <StatusBadge status={status as any} />
            </div>
          </div>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 space-y-3 text-sm">
        <InfoRow
          icon={IdCard}
          label={patient.tipo_doc_abrev || patient.tipo_doc || ""}
          value={patient.nro_documento}
          mono
        />
        <InfoRow
          icon={Cake}
          label="Fecha de Nacimiento"
          value={new Date(patient.fecha_nacimiento).toLocaleDateString("es-PE", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        />
        <InfoRow
          icon={User}
          label="Edad"
          value={`${calculateAge(patient.fecha_nacimiento)} años`}
        />
        <InfoRow icon={Phone} label="Teléfono" value={patient.telefono} />
        <InfoRow icon={Calendar} label="Última visita" value={lastVisit} />

        <Separator className="my-4" />

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Resumen clínico
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                Total Eval.
              </div>
              <div className="text-xl font-semibold mt-0.5">
                {diagnoses.length}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                Nivel Máx.
              </div>
              <div className="text-xl font-semibold mt-0.5">{maxLevel}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
