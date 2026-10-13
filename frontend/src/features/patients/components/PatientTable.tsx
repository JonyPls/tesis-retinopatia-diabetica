import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import { Patient, PatientReadScope } from "../types";
import { formatClinicalDay } from "@/lib/clinicalDates";

interface PatientTableProps {
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

function TableHeaderRow({ scope }: { scope: PatientReadScope }) {
  const headClass =
    "text-xs font-medium uppercase tracking-wider text-muted-foreground";
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableHead className={headClass}>Documento</TableHead>
      <TableHead className={headClass}>Paciente</TableHead>
      <TableHead className={headClass}>Edad</TableHead>
      <TableHead className={headClass}>Teléfono</TableHead>
      {scope !== "administrative" && <TableHead className={headClass}>Última Visita</TableHead>}
      {scope === "clinical" && <TableHead className={headClass}>Estado</TableHead>}
      <TableHead className={`${headClass} text-right`}>Acciones</TableHead>
    </TableRow>
  );
}

function EmptyState({ message, scope }: { message: string; scope: PatientReadScope }) {
  return (
    <Table>
      <TableHeader>
        <TableHeaderRow scope={scope} />
      </TableHeader>
      <TableBody>
        <TableRow className="hover:bg-transparent">
          <TableCell
            colSpan={scope === "clinical" ? 7 : scope === "assistance" ? 6 : 5}
            className="py-12 text-center text-sm text-muted-foreground"
          >
            {message}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function PatientTable({
  patients,
  isLoading,
  scope,
  calculateAge,
}: PatientTableProps) {
  if (isLoading) {
    return <EmptyState message="Cargando pacientes..." scope={scope} />;
  }

  if (patients.length === 0) {
    return <EmptyState message="No se encontraron pacientes con ese criterio." scope={scope} />;
  }

  return (
    <Table>
      <TableHeader>
          <TableHeaderRow scope={scope} />
      </TableHeader>
      <TableBody>
        {patients.map((p) => (
          <TableRow
            key={p.id || p.nro_documento}
            className="hover:bg-muted/30"
          >
            <TableCell>
              <div className="font-mono text-sm font-medium">
                {p.nro_documento}
              </div>
              <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                {p.tipo_doc_abrev || p.tipo_doc}
              </div>
            </TableCell>
            <TableCell>
              <div className="font-medium text-foreground">
                {p.nombres_apellidos ||
                  `${p.nombres || ""} ${p.apellidos || ""}`.trim()}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {p.sexo}
              </div>
            </TableCell>
            <TableCell className="text-sm">
              {calculateAge(p.fecha_nacimiento)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatPhone(p.telefono) || "Sin teléfono"}
            </TableCell>
            {scope !== "administrative" && <TableCell className="text-sm">
              {p.ultima_visita ? (
                formatClinicalDay(p.ultima_visita)
              ) : p.visitas_sin_fecha_verificada ? (
                <span className="text-xs text-muted-foreground">Visitas con fecha pendiente de conciliación</span>
              ) : (
                <span className="text-xs italic text-muted-foreground opacity-70">
                  Sin registros
                </span>
              )}
            </TableCell>}
            {scope === "clinical" && <TableCell>
              {"maxima_gravedad" in p
                ? <StatusBadge status={getPatientStatus(p.maxima_gravedad)} />
                : <span className="text-xs text-muted-foreground">No disponible</span>}
            </TableCell>}
            <TableCell className="text-right">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-primary"
              >
                <Link to={`/pacientes/${p.id || p.nro_documento}`}>
                  <Eye className="h-3.5 w-3.5" /> Ver
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
