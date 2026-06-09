import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Loader2, Save, Brain, XCircle, AlertTriangle } from "lucide-react";
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
    modalPhase,
    modalProgress,
    validationError,
    dismissError,
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

      {/* Modal de procesamiento — contenedor único barra persistente */}
      {modalPhase !== "idle" && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-5 max-w-sm w-full mx-4">
            {modalPhase === "error" ? (
              <>
                <div className="h-14 w-14 rounded-xl bg-red-100 flex items-center justify-center">
                  <XCircle className="h-7 w-7 text-red-600" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-red-700">Validación fallida</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {validationError || "La imagen no cumple con los requisitos."}
                  </p>
                </div>
                <div className="flex items-start gap-3 w-full bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 leading-relaxed">
                    <p className="font-medium mb-0.5">Formatos aceptados:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>JPG, PNG o TIFF</li>
                      <li>Mín. 300×300 píxeles</li>
                      <li>Región ocular visible</li>
                      <li>Máx. 30 MB por imagen</li>
                    </ul>
                  </div>
                </div>
                <Button variant="outline" onClick={dismissError} className="w-full mt-2">
                  Entendido
                </Button>
              </>
            ) : (
              <>
                <div
                  className={`h-14 w-14 rounded-xl flex items-center justify-center ${
                    modalPhase === "validating" ? "bg-amber-100" : "bg-primary/10"
                  }`}
                >
                  {modalPhase === "validating" ? (
                    <Loader2 className="h-7 w-7 text-amber-600 animate-spin" />
                  ) : (
                    <Brain className="h-7 w-7 text-primary animate-pulse" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-foreground">
                    {modalPhase === "validating" ? "Validando imagen" : "Analizando con IA"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {processingEye
                      ? `${modalPhase === "validating" ? "Verificando" : "Procesando"} ${processingEye === "OD" ? "ojo derecho (OD)" : "ojo izquierdo (OI)"}...`
                      : modalPhase === "validating"
                        ? "Preparando validación..."
                        : "Preparando análisis..."}
                  </p>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: modalProgress + "%",
                      background:
                        modalPhase === "validating"
                          ? "linear-gradient(to right, #f59e0b, #d97706)"
                          : "linear-gradient(to right, #14b8a6, #059669)",
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {modalPhase === "validating"
                    ? "Formato · Región ocular · CLIP semántico"
                    : "Ejecutando modelo ResNet50 · Deep Learning"}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
