import { Link } from "react-router-dom";
import { Eye, Phone, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import { Patient, PatientReadScope } from "../types";
import { formatClinicalDay } from "@/lib/clinicalDates";

interface PatientCardGridProps {
  patients: Patient[];
  isLoading: boolean;
  scope: PatientReadScope;
  calculateAge: (date: string) => string | number;
}

const formatPhone = (phone?: string) => {
  if (!phone) return "";
  const formatted = phone.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  return `+51 ${formatted}`;
};

const getPatientStatus = (maxLevel?: number | null): Status => {
  if (maxLevel === undefined || maxLevel === null) return "Sin Evaluar";
  if (maxLevel >= 3) return "Crítico";
  if (maxLevel >= 1) return "Seguimiento";
  return "Normal";
};

const getInitials = (nombres?: string, apellidos?: string) => {
  if (!nombres || !apellidos) return "?";
  return (nombres.trim()[0] + apellidos.trim()[0]).toUpperCase();
};

export function PatientCardGrid({
  patients,
  isLoading,
  scope,
  calculateAge,
}: PatientCardGridProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="shadow-card animate-pulse">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-lg bg-muted" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 bg-muted rounded" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        No se encontraron pacientes con ese criterio.
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {patients.map((p) => {
        const fullName =
          p.nombres_apellidos ||
          `${p.nombres || ""} ${p.apellidos || ""}`.trim();
        const initials = getInitials(p.nombres, p.apellidos);
        const status = getPatientStatus(p.maxima_gravedad);

        return (
          <Card
            key={p.id || p.nro_documento}
            className="shadow-card transition-colors hover:border-primary/40"
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/pacientes/${p.id || p.nro_documento}`}
                    className="font-semibold text-sm text-foreground hover:text-primary transition-colors line-clamp-1"
                  >
                    {fullName}
                  </Link>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {p.tipo_doc_abrev || p.tipo_doc} {p.nro_documento}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  {scope === "clinical" && (
                    "maxima_gravedad" in p
                      ? <StatusBadge status={status} />
                      : <span>No disponible</span>
                  )}
                  <span className="tabular-nums text-foreground/80">
                    {calculateAge(p.fecha_nacimiento)} años · {p.sexo}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3" />
                  {formatPhone(p.telefono) || "Sin teléfono"}
                </div>
                {scope !== "administrative" && <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {p.ultima_visita ? (
                    formatClinicalDay(p.ultima_visita)
                  ) : (
                    <span className="italic opacity-70">Sin registros</span>
                  )}
                </div>}
              </div>

              <div className="mt-4 pt-3 border-t border-border">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-primary hover:bg-accent"
                >
                  <Link to={`/pacientes/${p.id || p.nro_documento}`}>
                    <Eye className="h-3.5 w-3.5" /> Ver Perfil
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
