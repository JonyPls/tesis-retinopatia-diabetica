import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Brain,
  ClipboardCheck,
  Image as ImageIcon,
  Loader2,
  Save,
  UserRound,
  XCircle,
} from "lucide-react";
import { PageContent } from "@/components/layout/PageContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AppAlertModalBody,
  AppAlertModalContent,
  AppAlertModalFooter,
  AppAlertModalHeader,
} from "@/components/ui/app-alert-modal";
import { CreatePatientDialog } from "@/features/patients/components/CreatePatientDialog";
import { usePatients } from "@/features/patients/hooks/usePatients";
import { DiagnosisPatientStep } from "../components/DiagnosisPatientStep";
import { DiagnosisResults } from "../components/DiagnosisResults";
import { DiagnosisStepper } from "../components/DiagnosisStepper";
import { ImageUploader } from "../components/ImageUploader";
import { AutoSelectionModal } from "../components/AutoSelectionModal";
import { ManualImageConfirmation } from "../components/ManualImageConfirmation";
import { useDiagnosis } from "../hooks/useDiagnosis";

const STEP_COPY = {
  1: {
    title: "Seleccionar paciente",
    subtitle:
      "Busque por documento, nombres o apellidos. Si aún no existe, puede registrarlo desde este flujo.",
    icon: UserRound,
  },
  2: {
    title: "Cargar imágenes",
    subtitle:
      "Adjunte las imágenes de fondo de ojo para OD, OI o ambos ojos antes de iniciar el análisis.",
    icon: ImageIcon,
  },
  3: {
    title: "Validar resultado",
    subtitle:
      "Revise la predicción de la IA y confirme el diagnóstico final con criterio médico.",
    icon: ClipboardCheck,
  },
};

export default function Diagnosis() {
  const diagnosisHook = useDiagnosis();
  const {
    step,
    goBack,
    returnToResults,
    isNavigationBusy,
    goNext,
    canNext,
    isSaving,
    processingEye,
    modalPhase,
    modalProgress,
    validationError,
    dismissError,
    validateAll,
    isValidating,
  } = diagnosisHook;

  const patientRegistration = usePatients({
    autoFetch: false,
    onCreated: (patient) => {
      diagnosisHook.selectPatient({
        id: Number(patient.id),
        tipo_doc_abrev: patient.tipo_doc_abrev || patient.tipo_doc || "DNI",
        tipo_doc: patient.tipo_doc,
        tipo_doc_id: patient.tipo_doc_id,
        nro_documento: patient.nro_documento,
        nombres: patient.nombres || "",
        apellidos: patient.apellidos || "",
      });
    },
  });

  const [modalClosing, setModalClosing] = useState(false);
  const currentStep = STEP_COPY[step as keyof typeof STEP_COPY] ?? STEP_COPY[1];
  const StepIcon = currentStep.icon;
  const selectedPatient = diagnosisHook.selectedPatient;
  const processedEyes = Object.values(diagnosisHook.results).filter(Boolean).length;
  const hasPendingEye = processedEyes === 1;
  const lockedEyes = { OD: !!diagnosisHook.results.OD, OI: !!diagnosisHook.results.OI };

  const handleDismissError = () => {
    setModalClosing(true);
    setTimeout(() => {
      dismissError();
      setModalClosing(false);
    }, 300);
  };

  const handleTipoDocChange = (val: string) => {
    patientRegistration.handleDocumentTypeChange(val);
  };

  const registrationDialog = (
    <CreatePatientDialog
      open={patientRegistration.open}
      onOpenChange={patientRegistration.setOpen}
      formData={patientRegistration.formData}
      registrationScope={patientRegistration.registrationScope}
      isSubmitting={patientRegistration.isSubmitting}
      consent={patientRegistration.consent}
      onConsentChange={patientRegistration.handleConsentChange}
      validationErrors={patientRegistration.validationErrors}
      validationFocus={patientRegistration.validationFocus}
      onNameBlur={patientRegistration.handleNameBlur}
      onDocumentChange={(value) =>
        patientRegistration.handleDocumentChange(
          value,
          patientRegistration.formData.tipo_doc,
        )
      }
      onPhoneChange={patientRegistration.handlePhoneChange}
      onFieldChange={patientRegistration.handleChange}
      onSubmit={patientRegistration.handleSubmit}
      onTipoDocChange={handleTipoDocChange}
      hasUnsavedChanges={patientRegistration.hasPatientFormChanges}
      onDiscard={patientRegistration.resetPatientForm}
      triggerLabel="Nuevo paciente"
    />
  );

  return (
    <PageContent
      title="Módulo de Diagnóstico IA"
      subtitle="Evaluación asistida por Deep Learning · Retinopatía Diabética"
    >
      <div
        className={
          step === 3
            ? "grid gap-6"
            : "grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]"
        }
      >
        {step !== 3 && (
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <DiagnosisStepper
              step={step}
              selectedPatient={selectedPatient}
              eyes={diagnosisHook.eyes}
              processedEyes={processedEyes}
              hasExistingVisit={!!diagnosisHook.confirmedVisitId || !!diagnosisHook.selectedVisita}
            />
          </aside>
        )}

        <Card className="overflow-hidden shadow-card">
          {step !== 3 && (
          <CardHeader className="border-b border-border bg-muted/35 px-5 py-3.5 lg:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <StepIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base leading-tight">
                    {currentStep.title}
                  </CardTitle>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    {currentStep.subtitle}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          )}

          <CardContent className="p-5 lg:p-6">
            {step === 1 && (
              <DiagnosisPatientStep
                query={diagnosisHook.query}
                searchResults={diagnosisHook.searchResults}
                recentPatients={diagnosisHook.recentPatients}
                selectedPatient={diagnosisHook.selectedPatient}
                isSearching={diagnosisHook.isSearching}
                isLoadingMore={diagnosisHook.isLoadingMorePatients}
                hasMoreSearchResults={diagnosisHook.hasMoreSearchResults}
                searchError={diagnosisHook.searchError}
                recentError={diagnosisHook.recentError}
                hasSearched={diagnosisHook.hasSearched}
                isLoadingRecent={diagnosisHook.isLoadingRecent}
                visitasRecientes={diagnosisHook.visitasRecientes}
                selectedVisita={diagnosisHook.selectedVisita}
                isLoadingVisitas={diagnosisHook.isLoadingVisitas}
                registrationDialog={registrationDialog}
                onQueryChange={diagnosisHook.handleQueryChange}
                onLoadMore={diagnosisHook.loadMorePatients}
                onSelect={diagnosisHook.selectPatient}
                onSelectVisita={diagnosisHook.selectVisita}
                onClear={diagnosisHook.clearPatient}
              />
            )}

            {step === 2 && (
              <><ImageUploader
               embedded
               eyes={diagnosisHook.eyes}
                lockedEyes={lockedEyes}
                eyeProcessing={diagnosisHook.eyeProcessing}
                busyEyes={diagnosisHook.busyEyes}
                eyeActionError={diagnosisHook.eyeActionError}
                handleFile={diagnosisHook.handleFile}
                clearEye={diagnosisHook.clearEye}
                onAutoSelect={diagnosisHook.autoSelectRetinographImages}
                isAutoSelecting={diagnosisHook.isAutoSelectingImages}
                isSaving={isSaving}
                />
               {diagnosisHook.manualReview && <ManualImageConfirmation
                 review={diagnosisHook.manualReview}
                 onCancel={diagnosisHook.cancelManualReview}
                 onConfirm={diagnosisHook.confirmManualReview}
               />}
               <AutoSelectionModal
                 open={diagnosisHook.autoModalOpen}
                 patientName={selectedPatient ? `${selectedPatient.nombres} ${selectedPatient.apellidos}` : ""}
                 candidates={diagnosisHook.autoCandidates}
                 chosen={diagnosisHook.autoPreview}
                 loading={diagnosisHook.autoPreviewLoading}
                  confirming={diagnosisHook.isAutoSelectingImages || diagnosisHook.busyEyes.OD || diagnosisHook.busyEyes.OI}
                   eyes={diagnosisHook.eyes}
                   lockedEyes={lockedEyes}
                  notice={diagnosisHook.autoFocusEye ? diagnosisHook.eyeActionError[diagnosisHook.autoFocusEye] ?? null : null}
                 onSelect={diagnosisHook.selectAutoCandidate}
                 onConfirm={diagnosisHook.confirmEye}
                 onRevoke={diagnosisHook.revokeConfirmation}
                 onClose={diagnosisHook.closeAutoSelection}
               />
              {diagnosisHook.processingNotice && (
                <p role="alert" className="mt-4 text-sm text-muted-foreground">{diagnosisHook.processingNotice}</p>
              )}</>
            )}

            {step === 3 && (
              <div className="space-y-4">
              <section className="rounded-lg border border-border bg-muted/25 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold leading-tight">Resultados de la evaluación</h2>
                    {selectedPatient ? (
                      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span
                          className="max-w-full truncate font-medium text-foreground"
                          title={`${selectedPatient.nombres} ${selectedPatient.apellidos}`}
                        >
                          {selectedPatient.nombres} {selectedPatient.apellidos}
                        </span>
                        <span className="whitespace-nowrap">
                          {selectedPatient.tipo_doc_abrev} {selectedPatient.nro_documento}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Paciente no identificado</p>
                    )}
                  </div>
                </div>
              </section>
              {diagnosisHook.processingNotice && <div role="alert" className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
                <p>{diagnosisHook.processingNotice}</p>
                {diagnosisHook.confirmedVisitId && <Button type="button" variant="outline" className="mt-2" onClick={diagnosisHook.reconcileResults}>Consultar estado de la visita</Button>}
              </div>}
              {(["OD", "OI"] as const).some((eye) => !diagnosisHook.results[eye]) && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {(["OD", "OI"] as const).filter((eye) => !diagnosisHook.results[eye]).map((eye) => <span key={eye}>{eye}: {diagnosisHook.eyeProcessing[eye] === "incierto" ? "Registro de IA sin confirmar" : diagnosisHook.eyeProcessing[eye] === "error" ? "No procesado · error" : diagnosisHook.eyeProcessing[eye] === "procesando" ? "Procesando" : "No procesado"}</span>)}
              </div>}
              <DiagnosisResults
                results={diagnosisHook.results}
                eyes={diagnosisHook.eyes}
                activeEye={diagnosisHook.activeEye}
                setActiveEye={diagnosisHook.setActiveEye}
                finalSelection={diagnosisHook.finalSelection}
                setFinalSelection={diagnosisHook.setFinalSelection}
                comments={diagnosisHook.comments}
                setComment={diagnosisHook.setComment}
                correctionReasons={diagnosisHook.correctionReasons}
                setCorrectionReason={diagnosisHook.setCorrectionReason}
                validateDiagnosis={diagnosisHook.validateDiagnosis}
                isValidating={diagnosisHook.isValidating}
                validatedEyes={diagnosisHook.validatedEyes}
              />
              </div>
            )}
          </CardContent>

          <div
            className={`flex flex-col-reverse gap-3 border-t border-border bg-muted/25 px-5 py-4 sm:flex-row sm:items-center lg:px-6 ${
              step === 1 || (step === 3 && !hasPendingEye) ? "sm:justify-end" : "sm:justify-between"
            }`}
          >
            {(step === 2 || (step === 3 && hasPendingEye)) && (
              <Button
                variant="outline"
                onClick={goBack}
                disabled={isNavigationBusy}
                className="sm:w-auto"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {step === 3 ? "Añadir ojo pendiente" : "Anterior"}
              </Button>
            )}

            {step === 1 && (
              <Button
                onClick={goNext}
                disabled={!canNext}
                className="bg-gradient-primary shadow-elevated hover:opacity-90"
              >
                Continuar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {processedEyes > 0 && (
                  <Button
                    variant="outline"
                    onClick={returnToResults}
                    disabled={isNavigationBusy}
                  >
                    Volver a resultados
                  </Button>
                )}
                <Button
                  onClick={goNext}
                  disabled={!canNext || isNavigationBusy}
                  className="bg-gradient-primary shadow-elevated hover:opacity-90"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Guardar y analizar
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            )}

            {step === 3 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={isValidating || diagnosisHook.validationConflict || Object.keys(diagnosisHook.results).every((eye) => !!diagnosisHook.validatedEyes[eye as keyof typeof diagnosisHook.validatedEyes])}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        Guardar diagnóstico
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>

                <AppAlertModalContent>
                  <AppAlertModalHeader
                    icon={<Save className="h-6 w-6" />}
                    title="Confirmar guardado"
                    subtitle="Revise esta acción antes de continuar."
                  />
                  <AppAlertModalBody>
                    Se guardarán los ojos pendientes de validación y
                    volverás al dashboard. ¿Deseas continuar?
                  </AppAlertModalBody>
                  <AppAlertModalFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => validateAll()}
                      disabled={isValidating}
                    >
                      {isValidating ? "Guardando..." : "Guardar y regresar"}
                    </AlertDialogAction>
                  </AppAlertModalFooter>
                </AppAlertModalContent>
              </AlertDialog>
            )}
          </div>
        </Card>
      </div>

      {/* Modal de procesamiento — contenedor único barra persistente */}
      {(() => {
        const modalVisible = modalPhase !== "idle" && !modalClosing;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ease-in-out"
            style={{
              backgroundColor: modalVisible
                ? "rgba(0,0,0,0.5)"
                : "rgba(0,0,0,0)",
              pointerEvents: modalVisible ? "auto" : "none",
            }}
          >
            <div
              className="mx-4 flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl bg-white p-8 shadow-2xl transition-all duration-300 ease-in-out dark:bg-slate-900"
              style={{
                transform: modalVisible ? "scale(1)" : "scale(0.9)",
                opacity: modalVisible ? 1 : 0,
              }}
            >
              {modalPhase === "error" ? (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-100">
                    <XCircle className="h-7 w-7 text-red-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-red-700">
                      Validación fallida —{" "}
                      {processingEye === "OD"
                        ? "ojo derecho (OD)"
                        : "ojo izquierdo (OI)"}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {validationError ||
                        "La imagen no cumple con los requisitos."}
                    </p>
                  </div>
                  <div className="flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div className="text-xs leading-relaxed text-amber-800">
                      <p className="mb-0.5 font-medium">Formatos aceptados:</p>
                      <ul className="list-inside list-disc space-y-0.5">
                        <li>JPG, PNG o TIFF</li>
                        <li>Mín. 300×300 píxeles</li>
                        <li>Región ocular visible</li>
                        <li>Máx. 30 MB por imagen</li>
                      </ul>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleDismissError}
                    className="mt-2 w-full"
                  >
                    Entendido
                  </Button>
                </>
              ) : (
                <>
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-xl ${
                      modalPhase === "validating"
                        ? "bg-amber-100"
                        : "bg-primary/10"
                    }`}
                  >
                    {modalPhase === "validating" ? (
                      <Loader2 className="h-7 w-7 animate-spin text-amber-600" />
                    ) : (
                      <Brain className="h-7 w-7 animate-pulse text-primary" />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-foreground">
                      {modalPhase === "validating"
                        ? "Validando imagen"
                        : "Analizando con IA"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {processingEye
                        ? `${
                            modalPhase === "validating"
                              ? "Verificando"
                              : "Procesando"
                          } ${
                            processingEye === "OD"
                              ? "ojo derecho (OD)"
                              : "ojo izquierdo (OI)"
                          }...`
                        : modalPhase === "validating"
                          ? "Preparando validación..."
                          : "Preparando análisis..."}
                    </p>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
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
        );
      })()}
    </PageContent>
  );
}
