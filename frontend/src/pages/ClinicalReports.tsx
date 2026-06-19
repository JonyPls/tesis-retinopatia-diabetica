import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Save,
  Loader2,
  Plus,
  X,
  User,
  FileText,
} from "lucide-react";
import { useReports } from "@/modules/reports/hooks/useReports";
import { ReportsStepper } from "@/modules/reports/components/ReportsStepper";
import { TypeSelector } from "@/modules/reports/components/TypeSelector";
import { PatientSelectorStep } from "@/modules/reports/components/PatientSelectorStep";
import { VisitaSelector } from "@/modules/reports/components/VisitaSelector";
import { ReportForm } from "@/modules/reports/components/ReportForm";
import { AddTipoModal } from "@/modules/reports/components/AddTipoModal";
import { cn } from "@/lib/utils";

export default function ClinicalReports() {
  const hook = useReports();

  const stepSubtitle =
    hook.step === 1
      ? "Selecciona uno o más tipos de examen clínico"
      : hook.step === 2
        ? "Busque y seleccione el paciente evaluado"
        : `${hook.selectedTipos[hook.activeTipoIndex]?.nombre} · ${hook.selectedPatient?.nombres} ${hook.selectedPatient?.apellidos}`;

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
                  : hook.selectedVisita.diagnostico_id
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
            {hook.selectedTipos.length > 0 && (
              <>
                {/* All forms — hidden if not active, keeps refs alive */}
                {hook.selectedTipos.map((t, idx) => (
                  <div key={t.id} className={idx !== hook.activeTipoIndex ? 'hidden' : ''}>
                    <ReportForm
                      ref={(el) => {
                        hook.formRefs.current[t.id] = el;
                      }}
                      tipo={t}
                      isSaving={hook.isSaving}
                      onValidityChange={(valid) => hook.handleValidityChange(t.id, valid)}
                    />
                  </div>
                ))}

                {/* Navigation */}
                <div className="flex justify-between">
                  <Button variant="outline" size="sm" onClick={hook.goBack}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
                  </Button>
                  <Button
                    onClick={hook.saveAll}
                    disabled={hook.isSaving || !hook.allValid}
                    className="bg-gradient-primary hover:opacity-90"
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
                </div>
              </>
            )}

            {hook.selectedTipos.length === 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Todos los tipos seleccionados ya tienen informes registrados
                    para esta visita.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={hook.goBack}
                    className="mt-3"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Right: patient info + interactive list */}
          <div className="space-y-4">
            {/* Patient info */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="bg-muted/50 px-4 py-2.5 border-b border-border flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold">PACIENTE</h4>
              </div>
              <div className="p-4 space-y-1">
                <p className="text-sm font-medium">
                  {hook.selectedPatient?.nombres}{" "}
                  {hook.selectedPatient?.apellidos}
                </p>
                <p className="text-xs text-muted-foreground">
                  Doc: {hook.selectedPatient?.nro_documento}
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
              <div className="bg-muted/50 px-4 py-2.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <h4 className="text-xs font-semibold">INFORMES</h4>
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
                  const isActive = idx === hook.activeTipoIndex;
                  const isValid = hook.formValidity[t.id] === true;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => hook.setActiveTipoIndex(idx)}
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
                          onClick={(e) => { e.stopPropagation(); hook.removeTipo(t.id); }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Quitar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </button>
                  );
                })}

                {/* Existing informes */}
                {hook.informesExistentes.map((inf) => (
                  <div
                    key={inf.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-md bg-muted/10 border border-dashed border-border"
                  >
                    <span className="text-sm text-muted-foreground">
                      {inf.tipo_informe_nombre}
                    </span>
                    <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded font-medium">
                      Registrado
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <AddTipoModal
        open={hook.showAddTipoModal}
        onClose={hook.closeAddTipoModal}
        availableTipos={hook.availableTipos}
        onAdd={hook.addTipo}
      />
    </AppLayout>
  );
}
