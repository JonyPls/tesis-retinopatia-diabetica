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
  const hasRdData = hook.diagnoses.some(
    (diagnosis) =>
      Number(diagnosis.tiene_diagnostico_ia) === 1 ||
      diagnosis.maxima_gravedad !== null ||
      Boolean(diagnosis.resultado_ia),
  );

  return (
    <AppLayout title={fullName}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <Button variant="outline" asChild>
            <Link to="/pacientes">
              <ArrowLeft className="h-4 w-4 mr-2" /> Volver
            </Link>
          </Button>

          <PatientInfoCard
            patient={hook.patient}
            calculateAge={hook.calculateAge}
            getInitials={hook.getInitials}
            status={hook.status}
            lastVisit={hook.lastVisit}
            visitCount={hook.diagnoses.length}
            maxRdLevel={hook.maxLevel}
            hasRdData={hasRdData}
          />
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex justify-end">
            <Button
              asChild
              className="bg-gradient-primary hover:opacity-90 text-white"
            >
              <Link to="/diagnostico">
                <Brain className="h-4 w-4 mr-2" /> Nueva Evaluación
              </Link>
            </Button>
          </div>

          <PatientTimeline
            diagnoses={hook.diagnoses}
            sortedDx={hook.sortedDx}
            patientName={fullName}
            patientId={hook.patient.id}
          />
        </section>
      </div>
    </AppLayout>
  );
}
