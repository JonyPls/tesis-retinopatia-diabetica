import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Save,
  Loader2,
  Plus,
  X,
  User,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { useReports } from "../hooks/useReports";
import { ReportsStepper } from "../components/ReportsStepper";
import { TypeSelector } from "../components/TypeSelector";
import { PatientSelectorStep } from "../components/PatientSelectorStep";
import { VisitaSelector } from "../components/VisitaSelector";
import { ReportForm } from "../components/ReportForm";
import { AddTipoModal } from "../components/AddTipoModal";
import { ConfirmDelete } from "@/components/ui/ConfirmDelete";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  AppAlertModalBody,
  AppAlertModalContent,
  AppAlertModalFooter,
  AppAlertModalHeader,
} from "@/components/ui/app-alert-modal";
import { cn } from "@/lib/utils";

export default function ClinicalReports() {
  const hook = useReports();
  const [viewingExistingId, setViewingExistingId] = useState<number | null>(null);
  const [removingTipoId, setRemovingTipoId] = useState<number | null>(null);

  const stepSubtitle =
    hook.step === 1
      ? "Selecciona uno o más tipos de examen clínico"
      : hook.step === 2
        ? "Busque y seleccione el paciente evaluado"
        : viewingExistingId !== null
          ? `${hook.selectedPatient?.nombres} ${hook.selectedPatient?.apellidos} · Informe registrado`
          : hook.selectedTipos.length > 0 && hook.activeTipoIndex >= 0
            ? `${hook.selectedTipos[hook.activeTipoIndex]?.nombre} · ${hook.selectedPatient?.nombres} ${hook.selectedPatient?.apellidos}`
            : `${hook.selectedPatient?.nombres} ${hook.selectedPatient?.apellidos}`;

  return (
    <AppLayout title="Informes Clínicos" subtitle={stepSubtitle}>
      <ReportsStepper step={hook.step} />

      {hook.step === 1 && (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="bg-muted/50 px-5 py-3.5 border-b border-border flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ClipboardList className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">
                  Seleccionar tipo de informe
                </h3>
                <p className="text-xs text-muted-foreground">
                  {stepSubtitle}
                </p>
              </div>
            </div>

            <div className="p-4">
              <TypeSelector
                tipos={hook.tipos}
                selectedIds={hook.selectedTipos.map((t) => t.id)}
                onToggle={hook.toggleTipo}
              />
            </div>
          </div>

          <div className="border-t border-border my-6" />

          <div className="flex justify-end">
            <Button
              onClick={hook.goNext}
              disabled={!hook.canNext}
              className="bg-gradient-primary hover:opacity-90"
            >
              Continuar <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </>
      )}

      {hook.step === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <PatientSelectorStep
            query={hook.query}
            searchResults={hook.searchResults}
            recentPatients={hook.recentPatients}
            selectedPatient={hook.selectedPatient}
            isSearching={hook.isSearching}
            onQueryChange={hook.handleQueryChange}
            onSelect={hook.selectPatient}
            onClear={hook.clearPatient}
          />

          <VisitaSelector
            visitas={hook.visitas}
            selectedVisitaId={
              hook.selectedVisita === undefined
                ? undefined
                : hook.selectedVisita === null
                  ? -1
                  : hook.selectedVisita.visita_id
            }
            onSelect={hook.selectVisita}
            hasMore={hook.hasMoreVisitas}
            expandida={hook.visitasExpandidas}
            onVerMas={hook.verMasVisitas}
            onVerMenos={hook.verMenosVisitas}
            pacienteSeleccionado={!!hook.selectedPatient}
            cargandoVisitas={hook.isLoadingVisitas}
          />

          <div className="flex justify-between lg:col-span-2 mt-2">
            <Button variant="outline" size="sm" onClick={hook.goBack}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
            </Button>
            <Button
              onClick={hook.goNext}
              disabled={!hook.canNext}
              className="bg-gradient-primary hover:opacity-90"
            >
              Continuar <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {hook.step === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: form */}
          <div className="lg:col-span-2 space-y-4">
            {/* Editing forms — only rendered when not viewing existing (avoids space-y margin) */}
            {viewingExistingId === null && hook.selectedTipos.length > 0 && (
              <div>
                {hook.selectedTipos.map((t, idx) => (
                  <div key={t.id} className={idx !== hook.activeTipoIndex ? 'hidden' : ''}>
                    <ReportForm
                      ref={(el) => { hook.formRefs.current[t.id] = el; }}
                      tipo={t}
                      isSaving={hook.isSaving}
                      onValidityChange={(valid) => hook.handleValidityChange(t.id, valid)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Read‑only existing report (mounted separately, coexists with editing forms) */}
            {viewingExistingId !== null && (
              (() => {
                const inf = hook.informesExistentes.find(i => i.id === viewingExistingId);
                if (!inf) {
                  console.warn('[ClinicalReports] informe no encontrado para viewingExistingId=', viewingExistingId);
                  return null;
                }
                console.log('[ClinicalReports] mostrando informe registrado:', inf.datos_estructurados);
                return (
                  <ReportForm
                    key={inf.id}
                    tipo={{ id: inf.tipo_informe_id, nombre: inf.tipo_informe_nombre || "", descripcion: "" }}
                    isSaving={false}
                    readOnly={true}
                    initialData={inf}
                  />
                );
              })()
            )}

            {/* Empty state */}
            {viewingExistingId === null && hook.selectedTipos.length === 0 && (
              hook.informesExistentes.length === 0 ? (
                /* Sin informes existentes — mensaje original */
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-8 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">
                      No has seleccionado ningún informe.
                    </p>
                    {hook.availableTipos.length > 0 && (
                      <Button variant="outline" size="sm" onClick={hook.openAddTipoModal}>
                        <Plus className="h-4 w-4 mr-2" /> Agregar informe
                      </Button>
                    )}
                  </div>
                </div>
              ) : hook.availableTipos.length > 0 ? (
                /* Hay existentes + hay más tipos disponibles */
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-8 text-center space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Los informes seleccionados ya se encuentran registrados para esta visita.
                      ¿Deseas crear una nueva visita o agregar otro informe?
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <Button variant="outline" size="sm"
                        onClick={() => { setViewingExistingId(null); hook.selectVisita(null); }}>
                        <RefreshCw className="h-4 w-4 mr-2" /> Crear nueva visita
                      </Button>
                      <Button variant="outline" size="sm" onClick={hook.openAddTipoModal}>
                        <Plus className="h-4 w-4 mr-2" /> Agregar otro informe
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Todos los tipos ya están registrados */
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-8 text-center space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Todos los tipos de informe disponibles ya han sido registrados para esta visita.
                    </p>
                    <Button variant="outline" size="sm"
                      onClick={() => { setViewingExistingId(null); hook.selectVisita(null); }}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Crear nueva visita
                    </Button>
                  </div>
                </div>
              )
            )}

            {/* Navigation — always visible */}
            <div className="flex justify-between items-center">
              <Button variant="outline" size="sm" onClick={() => { setViewingExistingId(null); hook.goBack(); }}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
              </Button>
              {viewingExistingId === null && hook.selectedTipos.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => hook.setActiveTipoIndex(hook.activeTipoIndex - 1)}
                    disabled={hook.activeTipoIndex === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => hook.setActiveTipoIndex(hook.activeTipoIndex + 1)}
                    disabled={hook.activeTipoIndex === hook.selectedTipos.length - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right: patient info + interactive list */}
          <div className="space-y-4">
            {/* Patient info */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="bg-muted/50 px-5 py-3.5 border-b border-border flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <User className="h-4.5 w-4.5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Paciente</h3>
                  <p className="text-xs text-muted-foreground">Datos del paciente seleccionado</p>
                </div>
              </div>
              <div className="p-4 space-y-1">
                <p className="text-sm font-medium">
                  {hook.selectedPatient?.nombres}{" "}
                  {hook.selectedPatient?.apellidos}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hook.selectedPatient?.tipo_doc_abrev} {hook.selectedPatient?.nro_documento}
                </p>
                {hook.selectedVisita && (
                  <p className="text-xs text-muted-foreground">
                    Visita:{" "}
                    {new Date(
                      hook.selectedVisita.fecha_visita,
                    ).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            {/* Interactive report list */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="bg-muted/50 px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Informes</h3>
                    <p className="text-xs text-muted-foreground">Lista de informes a registrar</p>
                  </div>
                </div>
                {hook.availableTipos.length > 0 && (
                  <button
                    type="button"
                    onClick={hook.openAddTipoModal}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Agregar
                  </button>
                )}
              </div>

              <div className="p-3 space-y-1.5">
                {hook.isLoadingInformesExistentes && (
                  <p className="text-xs text-muted-foreground p-2">
                    Cargando informes existentes...
                  </p>
                )}

                {!hook.isLoadingInformesExistentes &&
                  hook.selectedTipos.length === 0 &&
                  hook.informesExistentes.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2">
                      No hay informes seleccionados.
                    </p>
                  )}

                {/* New tipos — clickable cards */}
                {hook.selectedTipos.map((t, idx) => {
                  const isActive = viewingExistingId === null && idx === hook.activeTipoIndex;
                  const isValid = hook.formValidity[t.id] === true;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { hook.setActiveTipoIndex(idx); setViewingExistingId(null); }}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors text-left",
                        isActive
                          ? "bg-primary/5 border-l-2 border-primary"
                          : "bg-muted/30 hover:bg-muted/50",
                      )}
                    >
                      <span className={cn(
                        "text-sm font-medium",
                        isActive && "text-primary",
                      )}>
                        {t.nombre}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded",
                          isValid
                            ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30"
                            : "text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30",
                        )}>
                          {isValid ? "Completo" : "Pendiente"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setRemovingTipoId(t.id); }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Quitar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </button>
                  );
                })}

                {/* Existing informes — clickable with active state */}
                {hook.informesExistentes.map((inf) => {
                  const isActive = viewingExistingId === inf.id;
                  return (
                    <button
                      key={inf.id}
                      type="button"
                      onClick={() => setViewingExistingId(isActive ? null : inf.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors text-left",
                        isActive
                          ? "bg-primary/5 border-l-2 border-primary"
                          : "bg-muted/10 border border-dashed border-border hover:bg-muted/30",
                      )}
                    >
                      <span className={cn(
                        "text-sm font-medium",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}>
                        {inf.tipo_informe_nombre}
                      </span>
                      <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded font-medium">
                        Registrado
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Save button below the list */}
            {hook.selectedTipos.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={hook.isSaving || !hook.allValid}
                    className="w-full bg-gradient-primary hover:opacity-90"
                  >
                    {hook.isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Guardar Todo
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
                      Se guardarán {hook.selectedTipos.length} informe(s) para{" "}
                      {hook.selectedPatient?.nombres}{" "}
                      {hook.selectedPatient?.apellidos}.
                      ¿Deseas continuar?
                  </AppAlertModalBody>
                  <AppAlertModalFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={hook.saveAll} disabled={hook.isSaving}>
                      {hook.isSaving ? "Guardando..." : "Guardar"}
                    </AlertDialogAction>
                  </AppAlertModalFooter>
                </AppAlertModalContent>
              </AlertDialog>
            )}
          </div>
        </div>
      )}

      <AddTipoModal
        open={hook.showAddTipoModal}
        onClose={hook.closeAddTipoModal}
        availableTipos={hook.availableTipos}
        onAdd={hook.addTipos}
      />

      <ConfirmDelete
        open={removingTipoId !== null}
        onConfirm={() => {
          if (removingTipoId !== null) hook.removeTipo(removingTipoId);
          setRemovingTipoId(null);
        }}
        onCancel={() => setRemovingTipoId(null)}
        title="Quitar informe"
        description={
          removingTipoId !== null
            ? `¿Estás seguro de que deseas quitar "${hook.selectedTipos.find((t) => t.id === removingTipoId)?.nombre || ""}" de la lista?`
            : ""
        }
        confirmText="Sí, quitar"
        cancelText="Cancelar"
      />
    </AppLayout>
  );
}
