import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatClinicalDay } from "@/lib/clinicalDates";
import { ArrowRight } from "lucide-react";
import type { Patient } from "../types";

export function RecentPatientsTable({ patients, canViewPatients }: {
  patients: Patient[];
  canViewPatients: boolean;
}) {
  return (
    <Card className="flex h-full min-w-0 flex-col shadow-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Actividad reciente</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Pacientes atendidos · última visita con fecha verificada
          </p>
        </div>
        {canViewPatients && <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
          <Link to="/pacientes">Ver todos <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>}
      </CardHeader>
      <CardContent className="min-w-0 flex-1 overflow-x-auto p-0">
        <Table className="min-w-[360px]">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wide">Documento</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Paciente</TableHead>
              <TableHead className="text-xs uppercase tracking-wide">Última visita</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.length === 0 ? <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                No hay visitas con fecha verificada para mostrar.
              </TableCell>
            </TableRow> : patients.map((patient) => <TableRow key={patient.id}>
              <TableCell className="break-all font-mono text-xs sm:text-sm">{patient.nro_documento}</TableCell>
              <TableCell className="font-medium">
                {canViewPatients ? <Link to={`/pacientes/${patient.id}`} className="hover:text-primary">
                  {patient.nombres} {patient.apellidos}
                </Link> : `${patient.nombres} ${patient.apellidos}`}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground sm:text-sm">
                {patient.ultima_visita_origen === "UTC_VERIFICADO"
                  ? formatClinicalDay(patient.ultima_visita) : "Fecha pendiente de conciliación"}
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
