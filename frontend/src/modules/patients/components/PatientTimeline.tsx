import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Calendar,
  Eye,
  Stethoscope,
  FileText,
  Activity,
} from "lucide-react";
import { Link } from "react-router-dom";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { Diagnosis } from "../types";
import { RDLevel } from "@/data/rdLevels";

interface PatientTimelineProps {
  diagnoses: Diagnosis[];
  sortedDx: Diagnosis[];
  mapResultToLevel: (result: string) => RDLevel;
  className?: string;
}

export function PatientTimeline({
  diagnoses,
  sortedDx,
  mapResultToLevel,
  className,
}: PatientTimelineProps) {
  if (diagnoses.length === 0) {
    return (
      <Card className={`shadow-card ${className || ""}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Historial de Diagnósticos Oftalmológicos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10">
            <p className="text-muted-foreground text-sm">
              Aún no hay diagnósticos registrados para este paciente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`shadow-card ${className || ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Historial de Diagnósticos Oftalmológicos
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {sortedDx.length} registro(s) · Cronología descendente
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {sortedDx.map((dx) => (
            <div key={dx.diagnostico_id} className="relative">
              <div className="absolute -left-[18px] top-1 h-3 w-3 rounded-full bg-card border-2 border-primary shadow-card" />
              <div className="rounded-lg border border-border bg-card p-4 hover:shadow-elevated transition-shadow">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(dx.fecha_visita).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <Stethoscope className="h-3 w-3" />{" "}
                      {dx.medico_tratante || "Desconocido"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium">
                      <Eye className="h-3 w-3" />
                      {dx.ojo_evaluado === "Derecho"
                        ? "Ojo Derecho"
                        : dx.ojo_evaluado === "Izquierdo"
                          ? "Ojo Izquierdo"
                          : "Ambos Ojos"}
                    </span>
                    <RDLevelBadge
                      level={mapResultToLevel(dx.resultado_ia)}
                      size="sm"
                    />
                  </div>
                </div>

                <p className="text-sm text-foreground/80 leading-relaxed">
                  {dx.comentario_medico || "Sin observaciones."}
                </p>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <div className="text-xs text-muted-foreground">
                    Confianza IA:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {(dx.probabilidad_ia * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    Ver Informe PDF
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
