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
import { Eye, Phone } from "lucide-react";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import { Patient } from "../types";

interface PatientTableProps {
  patients: Patient[];
  isLoading: boolean;
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

export function PatientTable({
  patients,
  isLoading,
  calculateAge,
}: PatientTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs uppercase tracking-wider">Documento</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Paciente</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Edad</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Teléfono</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Última Visita</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Estado</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                Cargando pacientes...
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs uppercase tracking-wider">Documento</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Paciente</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Edad</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Teléfono</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Última Visita</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Estado</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                No se encontraron pacientes con ese criterio.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="text-xs uppercase tracking-wider">Documento</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Paciente</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Edad</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Teléfono</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Última Visita</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Estado</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {patients.map((p) => (
            <TableRow
              key={p.id || p.nro_documento}
              className="hover:bg-muted/30"
            >
              <TableCell>
                <div className="font-mono text-sm">{p.nro_documento}</div>
                <div className="text-[10px] text-muted-foreground uppercase mt-0.5">
                  {p.tipo_doc_abrev || p.tipo_doc}
                </div>
              </TableCell>
              <TableCell>
                <div className="font-medium">
                  {p.nombres_apellidos ||
                    `${p.nombres || ""} ${p.apellidos || ""}`.trim()}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.sexo}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {calculateAge(p.fecha_nacimiento)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3 w-3" /> {formatPhone(p.telefono) || "Sin teléfono"}
                </span>
              </TableCell>
              <TableCell className="text-sm">
                {p.ultima_visita ? (
                  new Date(p.ultima_visita).toLocaleDateString("es-PE", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                ) : (
                  <span className="text-muted-foreground text-xs italic opacity-70">
                    Sin registros
                  </span>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={getPatientStatus(p.maxima_gravedad)} />
              </TableCell>
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
    </div>
  );
}
