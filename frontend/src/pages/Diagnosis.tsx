import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Loader2, Save, Brain } from "lucide-react";
import { useDiagnosis } from "@/modules/diagnosis/hooks/useDiagnosis";
import { DiagnosisStepper } from "@/modules/diagnosis/components/DiagnosisStepper";
import { PatientSelector } from "@/modules/diagnosis/components/PatientSelector";
import { ImageUploader } from "@/modules/diagnosis/components/ImageUploader";
import { DiagnosisResults } from "@/modules/diagnosis/components/DiagnosisResults";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function Diagnosis() {
  const diagnosisHook = useDiagnosis();
    const {
    step,
    goBack,
    goNext,
    canNext,
    isSaving,
    processingEye,
    resetAll,
    // validation
    activeEye,
    finalSelection,
    setFinalSelection,
    comments,
    setComment,
    validateDiagnosis,
    validateAll,
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
              <>Procesando...</>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" /> Guardar y Analizar{" "}
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        )}

        {step === 3 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={isValidating}
                className="bg-gradient-primary hover:opacity-90"
              >
                {isValidating ? "Guardando..." : "Guardar Diagnóstico"}{" "}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </AlertDialogTrigger>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar guardado</AlertDialogTitle>
                <AlertDialogDescription>
                  Se guardarán las validaciones para los ojos procesados y
                  volverás al dashboard. ¿Deseas continuar?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => validateAll()}
                  disabled={isValidating}
                >
                  {isValidating ? "Guardando..." : "Guardar y regresar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Modal de carga — analizando imágenes */}
      {isSaving && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-5 max-w-sm w-full mx-4">
            <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <Brain className="h-7 w-7 text-primary animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">Analizando imágenes</p>
              <p className="text-sm text-muted-foreground mt-1">
                {processingEye
                  ? `Procesando ${processingEye === "OD" ? "ojo derecho (OD)" : "ojo izquierdo (OI)"}...`
                  : "Preparando análisis..."}
              </p>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${processingEye === "OD" ? 50 : processingEye === "OI" ? 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Ejecutando modelo ResNet50 · Deep Learning
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
