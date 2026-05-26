import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Loader2, Save } from "lucide-react";
import { useDiagnosis } from "@/modules/diagnosis/hooks/useDiagnosis";
import { DiagnosisStepper } from "@/modules/diagnosis/components/DiagnosisStepper";
import { PatientSelector } from "@/modules/diagnosis/components/PatientSelector";
import { ImageUploader } from "@/modules/diagnosis/components/ImageUploader";
import { DiagnosisResults } from "@/modules/diagnosis/components/DiagnosisResults";

export default function Diagnosis() {
  const diagnosisHook = useDiagnosis();
  const {
    step,
    goBack,
    goNext,
    canNext,
    isSaving,
    resetAll,
    // validation
    activeEye,
    finalSelection,
    setFinalSelection,
    comments,
    setComment,
    validateDiagnosis,
    isValidating,
  } = diagnosisHook;

  return (
    <AppLayout
      title="Módulo de Diagnóstico IA"
      subtitle="Evaluación asistida por Deep Learning · Retinopatía Diabética"
    >
      <DiagnosisStepper step={step} />

      {step === 1 && (
        <PatientSelector
          query={diagnosisHook.query}
          searchResults={diagnosisHook.searchResults}
          recentPatients={diagnosisHook.recentPatients}
          selectedPatient={diagnosisHook.selectedPatient}
          isSearching={diagnosisHook.isSearching}
          handleQueryChange={diagnosisHook.handleQueryChange}
          selectPatient={diagnosisHook.selectPatient}
        />
      )}

      {step === 2 && (
        <ImageUploader
          eyes={diagnosisHook.eyes}
          handleFile={diagnosisHook.handleFile}
          clearEye={diagnosisHook.clearEye}
        />
      )}

      {step === 3 && (
        <DiagnosisResults
          results={diagnosisHook.results}
          eyes={diagnosisHook.eyes}
          activeEye={diagnosisHook.activeEye}
          setActiveEye={diagnosisHook.setActiveEye}
          finalSelection={diagnosisHook.finalSelection}
          setFinalSelection={diagnosisHook.setFinalSelection}
          comments={diagnosisHook.comments}
          setComment={diagnosisHook.setComment}
          validateDiagnosis={diagnosisHook.validateDiagnosis}
          isValidating={diagnosisHook.isValidating}
        />
      )}

      {/* Navegación */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
        <Button
          variant="outline"
          onClick={goBack}
          disabled={step === 1 || isSaving}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
        </Button>

        {step === 1 && (
          <Button
            onClick={goNext}
            disabled={!canNext}
            className="bg-gradient-primary hover:opacity-90"
          >
            Continuar <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}

        {step === 2 && (
          <Button
            onClick={goNext}
            disabled={!canNext || isSaving}
            className="bg-gradient-primary hover:opacity-90 shadow-elevated"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analizando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" /> Guardar y Analizar{" "}
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        )}

        {step === 3 && (
          <Button
            onClick={() => validateDiagnosis(activeEye)}
            disabled={isValidating}
            className="bg-gradient-primary hover:opacity-90"
          >
            {isValidating ? "Guardando..." : "Guardar Diagnóstico"}{" "}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </AppLayout>
  );
}
