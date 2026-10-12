import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, Status } from "@/components/medical/StatusBadge";
import { ArrowRight } from "lucide-react";
import { Patient } from "../types";

interface RecentPatientsTableProps {
  patients: Patient[];
  isLoading: boolean;
  error: string | null;
  calculateAge: (date: string) => string | number;
}

const getPatientStatus = (maxLevel?: number | null): Status => {
  if (maxLevel === undefined || maxLevel === null) return "Sin Evaluar";
  if (maxLevel >= 3) return "Crítico";
  if (maxLevel >= 1) return "Seguimiento";
  return "Normal";
};

export function RecentPatientsTable({
  patients,
  isLoading,
  error,
  calculateAge,
}: RecentPatientsTableProps) {
  return (
    <Card className="lg:col-span-2 shadow-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Últimos Pacientes Atendidos</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Ordenado por última visita
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-primary">
          <Link to="/pacientes">
            Ver todos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Documento
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Nombre
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Última Visita
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Estado
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-8 text-muted-foreground text-sm"
                >
                  <span role="status">Cargando últimos pacientes...</span>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-destructive">
                  <p role="alert">{error}</p>
                </TableCell>
              </TableRow>
            ) : patients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-8 text-muted-foreground text-sm"
                >
                  No hay pacientes con visitas registradas.
                </TableCell>
              </TableRow>
            ) : (
              patients.map((p) => (
                <TableRow
                  key={p.id}
                  className="hover:bg-muted/40 cursor-pointer"
                >
                  <TableCell>
                    <div className="font-mono text-sm">{p.nro_documento}</div>
                    <div className="text-[10px] text-muted-foreground uppercase mt-0.5">
                      {p.tipo_doc_abrev || p.tipo_doc}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/pacientes/${p.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {p.nombres_apellidos ||
                        `${p.nombres || ""} ${p.apellidos || ""}`.trim()}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {calculateAge(p.fecha_nacimiento)} años
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.ultima_visita &&
                      new Date(p.ultima_visita).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                  </TableCell>
                  <TableCell>
                    {"maxima_gravedad" in p
                      ? <StatusBadge status={getPatientStatus(p.maxima_gravedad)} />
                      : <span className="text-xs text-muted-foreground">No disponible</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
