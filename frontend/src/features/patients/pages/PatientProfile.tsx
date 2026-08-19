import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain } from "lucide-react";
import { usePatientProfile } from "../hooks/usePatientProfile";
import { PatientInfoCard } from "../components/PatientInfoCard";
import { PatientTimeline } from "../components/PatientTimeline";

export default function PatientProfile() {
  const { id } = useParams();
  const hook = usePatientProfile(id);
  const [infoCollapsed, setInfoCollapsed] = useState(false);

  if (hook.isLoading) {
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

  if (!hook.patient) {
    return (
      <AppLayout title="Paciente no encontrado">
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground mb-4">
            No se pudieron encontrar los datos de este paciente en la base de
            datos.
          </p>
          <Button variant="outline" onClick={() => hook.navigate("/pacientes")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Volver a Gestión de Pacientes
          </Button>
        </div>
      </AppLayout>
    );
  }

  const fullName =
    hook.patient.nombres_apellidos ||
    `${hook.patient.nombres} ${hook.patient.apellidos}`.trim();

  return (
    <AppLayout
      title={fullName}
      subtitle={`Historia clínica · ${hook.patient.tipo_doc_abrev || hook.patient.tipo_doc} ${hook.patient.nro_documento}`}
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
      <div className={`grid gap-6 grid-cols-1 ${infoCollapsed ? "" : "lg:grid-cols-3"}`}>
        <PatientInfoCard
          patient={hook.patient}
          diagnoses={hook.diagnoses}
          calculateAge={hook.calculateAge}
          getInitials={hook.getInitials}
          status={hook.status}
          lastVisit={hook.lastVisit}
          maxLevel={hook.maxLevel}
          collapsed={infoCollapsed}
          onToggle={() => setInfoCollapsed((v) => !v)}
        />
        <PatientTimeline
          className={infoCollapsed ? "lg:col-span-3" : "lg:col-span-2"}
          diagnoses={hook.diagnoses}
          sortedDx={hook.sortedDx}
        />
      </div>
    </AppLayout>
  );
}
