import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/medical/StatusBadge";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import {
  ArrowLeft,
  Calendar,
  Phone,
  IdCard,
  User,
  Cake,
  FileText,
  Brain,
  Eye,
  Activity,
  Stethoscope,
} from "lucide-react";

interface Patient {
  id: number;
  tipo_doc: string;
  tipo_doc_abrev?: string;
  nro_documento: string;
  nombres: string;
  apellidos: string;
  nombres_apellidos?: string;
  sexo: string;
  fecha_nacimiento: string;
  telefono: string;
}

interface Diagnosis {
  diagnostico_id: number;
  fecha_visita: string;
  medico_tratante?: string;
  ojo_evaluado: string;
  resultado_ia: string;
  probabilidad_ia: number;
  comentario_medico?: string;
}

const calculateAge = (birthDateStr: string) => {
  if (!birthDateStr) return 0;
  const today = new Date();
  const birth = new Date(birthDateStr);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

const getInitials = (name: string) => {
  if (!name) return "";
  const words = name.trim().split(" ");
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const mapResultToLevel = (result: string) => {
  switch (result) {
    case "Proliferativa":
      return 4;
    case "Severa":
      return 3;
    case "Moderada":
      return 2;
    case "Leve":
      return 1;
    case "Sin retinopatía":
    default:
      return 0;
  }
};

export default function PatientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const token = localStorage.getItem("token");
        const [resPac, resDiag] = await Promise.all([
          fetch(`http://localhost:5000/api/pacientes/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`http://localhost:5000/api/diagnosticos/paciente/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (resPac.status === 401 || resDiag.status === 401) {
          localStorage.removeItem("token");
          window.location.href = "/";
          return;
        }

        if (!resPac.ok) {
          setPatient(null);
          setIsLoading(false);
          return;
        }

        const dataPac = await resPac.json();
        const dataDiag = await resDiag.json();

        // Validar que el paciente exista
        if (
          dataPac.data &&
          (!Array.isArray(dataPac.data) || dataPac.data.length > 0)
        ) {
          setPatient(
            Array.isArray(dataPac.data) ? dataPac.data[0] : dataPac.data,
          );
        } else {
          setPatient(null);
        }

        if (dataDiag.data) {
          setDiagnoses(dataDiag.data);
        }
      } catch (error) {
        console.error("Error obteniendo datos", error);
        setPatient(null);
      } finally {
        setIsLoading(false);
      }
    };
    if (id) fetchData();
  }, [id]);

  if (isLoading) {
    return (
      <AppLayout title="Cargando perfil del paciente...">
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Brain className="h-8 w-8 text-teal-600 animate-pulse" />
            <p className="text-muted-foreground text-sm">
              Obteniendo datos médicos...
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!patient) {
    return (
      <AppLayout title="Paciente no encontrado">
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground mb-4">
            No se pudieron encontrar los datos de este paciente en la base de
            datos.
          </p>
          <Button variant="outline" onClick={() => navigate("/pacientes")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver a Gestión de Pacientes
          </Button>
        </div>
      </AppLayout>
    );
  }

  const sortedDx = [...diagnoses].sort(
    (a, b) =>
      new Date(b.fecha_visita).getTime() - new Date(a.fecha_visita).getTime(),
  );

  const maxLevel =
    diagnoses.length > 0
      ? Math.max(...diagnoses.map((d) => mapResultToLevel(d.resultado_ia)))
      : 0;

  // Lógica clínica para derivar el estado general del paciente
  let status: "Normal" | "Seguimiento" | "Crítico" | "Sin Evaluar" =
    "Sin Evaluar";

  if (diagnoses.length > 0) {
    // Asumimos "Normal" por defecto (Nivel 0) cuando sí tiene evaluaciones.
    status = "Normal";
    // Pero si el nivel máximo es mayor, lo actualizamos:
    if (maxLevel === 1 || maxLevel === 2) {
      status = "Seguimiento";
    } else if (maxLevel >= 3) {
      status = "Crítico";
    }
  }

  const lastVisit =
    sortedDx.length > 0
      ? new Date(sortedDx[0].fecha_visita).toLocaleDateString("es-PE")
      : "Sin registros";

  const fullName =
    patient.nombres_apellidos ||
    `${patient.nombres} ${patient.apellidos}`.trim();

  return (
    <AppLayout
      title={fullName}
      subtitle={`Historia clínica · ${patient.tipo_doc_abrev || patient.tipo_doc} ${patient.nro_documento}`}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to="/pacientes">
              <ArrowLeft className="h-4 w-4 mr-2" /> Volver
            </Link>
          </Button>
          <Button
            asChild
            className="bg-gradient-primary hover:opacity-90 text-white"
          >
            <Link to="/diagnostico">
              <Brain className="h-4 w-4 mr-2" /> Nueva Evaluación
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Datos demográficos */}
        <Card className="lg:col-span-1 shadow-card h-fit">
          <CardHeader className="pb-4">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-lg shadow-elevated">
                {getInitials(fullName)}
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base leading-tight">
                  {fullName}
                </CardTitle>
                <div className="mt-1.5">
                  <StatusBadge status={status} />
                </div>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3 text-sm">
            <InfoRow
              icon={IdCard}
              label={patient.tipo_doc_abrev || patient.tipo_doc}
              value={patient.nro_documento}
              mono
            />
            <InfoRow
              icon={Cake}
              label="Fecha de Nacimiento"
              value={new Date(patient.fecha_nacimiento).toLocaleDateString(
                "es-PE",
                { day: "2-digit", month: "long", year: "numeric" },
              )}
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

        {/* Timeline */}
        <Card className="lg:col-span-2 shadow-card">
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
            {sortedDx.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted-foreground text-sm">
                  Aún no hay diagnósticos registrados para este paciente.
                </p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-border">
                {sortedDx.map((dx) => (
                  <div key={dx.diagnostico_id} className="relative">
                    <div className="absolute -left-[18px] top-1 h-3 w-3 rounded-full bg-card border-2 border-primary shadow-card" />
                    <div className="rounded-lg border border-border bg-card p-4 hover:shadow-elevated transition-shadow">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {new Date(dx.fecha_visita).toLocaleDateString(
                              "es-PE",
                              {
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
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
