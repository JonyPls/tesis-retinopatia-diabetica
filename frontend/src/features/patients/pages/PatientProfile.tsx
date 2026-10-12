import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain } from "lucide-react";
import { usePatientProfile } from "../hooks/usePatientProfile";
import { PatientInfoCard } from "../components/PatientInfoCard";
import { PatientSummaryBand } from "../components/PatientSummaryBand";
import { PatientTimeline } from "../components/PatientTimeline";
import { PatientLookupError } from "../components/PatientLookupError";

export default function PatientProfile() {
  const { id } = useParams();
  const hook = usePatientProfile(id);

  if (hook.isLoading) {
    return (
      <AppLayout title="Cargando perfil del paciente...">
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Brain className="h-8 w-8 animate-pulse text-primary" />
            <p className="text-sm text-muted-foreground">
              Obteniendo datos médicos...
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (hook.patientError) {
    return <AppLayout title="Datos del paciente"><PatientLookupError error={hook.patientError} /></AppLayout>;
  }

  if (!hook.patient) {
    return (
      <AppLayout title="Paciente no encontrado">
        <div className="flex flex-col items-center justify-center py-16">
          <p className="mb-4 text-muted-foreground">
            No se pudieron encontrar los datos de este paciente en la base de
            datos.
          </p>
          <Button variant="outline" onClick={() => hook.navigate("/pacientes")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Gestión de Pacientes
          </Button>
        </div>
      </AppLayout>
    );
  }

  const fullName =
    hook.patient.nombres_apellidos ||
    `${hook.patient.nombres} ${hook.patient.apellidos}`.trim();
  const docType =
    hook.patient.tipo_doc_abrev || hook.patient.tipo_doc || "Doc.";
  const hasRdData = hook.diagnoses.some(
    (diagnosis) =>
      Number(diagnosis.tiene_diagnostico_ia) === 1 ||
      diagnosis.maxima_gravedad !== null ||
      Boolean(diagnosis.resultado_ia),
  );
  const showHistory = hook.scope === "clinical" && !hook.historyError;

  return (
    <AppLayout
      title={hook.scope === "clinical" ? "Historia clínica" : "Datos del paciente"}
      subtitle={`${fullName} · ${docType} ${hook.patient.nro_documento}`}
    >
      <div className="space-y-6">
        {showHistory && <PatientSummaryBand
          status={hook.status}
          maxRdLevel={hook.maxLevel}
          hasRdData={hasRdData}
          lastVisit={hook.lastVisit}
          visitCount={hook.diagnoses.length}
        />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="-ml-2 w-fit text-muted-foreground"
            >
              <Link to="/pacientes">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver
              </Link>
            </Button>

            <PatientInfoCard
              patient={hook.patient}
              scope={hook.scope}
              calculateAge={hook.calculateAge}
              getInitials={hook.getInitials}
            />
          </aside>

          {hook.historyError && <PatientLookupError error={hook.historyError} />}
          {showHistory && <section className="min-w-0 space-y-3">
            <div className="flex justify-end">
              <Button asChild className="bg-primary hover:bg-primary/90">
                <Link to="/diagnostico">
                  <Brain className="mr-2 h-4 w-4" /> Nueva Evaluación
                </Link>
              </Button>
            </div>

            <PatientTimeline
              diagnoses={hook.diagnoses}
              sortedDx={hook.sortedDx}
              patientName={fullName}
              patientId={hook.patient.id}
            />
          </section>}
        </div>
      </div>
    </AppLayout>
  );
}
