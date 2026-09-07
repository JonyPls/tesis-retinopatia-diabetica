import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, Loader2, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PatientSearchResult } from "@/features/patients/api/patientService";
import { cn } from "@/lib/utils";

interface DiagnosisPatientStepProps {
  query: string;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  selectedPatient: PatientSearchResult | null;
  isSearching: boolean;
  isLoadingMore: boolean;
  hasMoreSearchResults: boolean;
  registrationDialog: ReactNode;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (p: PatientSearchResult) => void;
  onClear: () => void;
}

export function DiagnosisPatientStep({
  query,
  searchResults,
  recentPatients,
  selectedPatient,
  isSearching,
  isLoadingMore,
  hasMoreSearchResults,
  registrationDialog,
  onQueryChange,
  onLoadMore,
  onSelect,
  onClear,
}: DiagnosisPatientStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedPatient) inputRef.current?.focus();
  }, [selectedPatient]);

  const clearQuery = () => {
    onQueryChange("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (selectedPatient) {
    return <SelectedPatient patient={selectedPatient} onClear={onClear} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold">Paciente a evaluar</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Busque un paciente existente o registre uno nuevo sin salir del flujo.
          </p>
        </div>
        <div className="shrink-0">{registrationDialog}</div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar por documento, nombres o apellidos..."
          className="h-11 pl-9 pr-10"
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Limpiar búsqueda"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <PatientList
        query={query}
        isSearching={isSearching}
        searchResults={searchResults}
        recentPatients={recentPatients}
        isLoadingMore={isLoadingMore}
        hasMoreSearchResults={hasMoreSearchResults}
        onLoadMore={onLoadMore}
        onSelect={onSelect}
      />
    </div>
  );
}

function SelectedPatient({
  patient,
  onClear,
}: {
  patient: PatientSearchResult;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.03] px-4 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PatientAvatar patient={patient} selected />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-primary">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wider">
                Paciente seleccionado
              </p>
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">
              {patient.nombres} {patient.apellidos}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">
                {patient.tipo_doc_abrev} {patient.nro_documento}
              </span>
              {patient.ultima_visita && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Última visita: {formatDate(patient.ultima_visita)}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onClear}
          className="shrink-0"
        >
          <X className="h-4 w-4" />
          Cambiar paciente
        </Button>
      </div>
    </div>
  );
}

function PatientList({
  query,
  isSearching,
  searchResults,
  recentPatients,
  isLoadingMore,
  hasMoreSearchResults,
  onLoadMore,
  onSelect,
}: {
  query: string;
  isSearching: boolean;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  isLoadingMore: boolean;
  hasMoreSearchResults: boolean;
  onLoadMore: () => void;
  onSelect: (p: PatientSearchResult) => void;
}) {
  const showingSearch = query.trim().length >= 2;
  const patients = showingSearch ? searchResults : recentPatients;

  if (isSearching) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Buscando pacientes...
      </div>
    );
  }

  if (showingSearch && searchResults.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
        <User className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          No se encontraron pacientes
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          Verifique la búsqueda del paciente ingresado<br/>
          o puede registrarlo con el botón superior derecho.
        </p>
      </div>
    );
  }

  if (!showingSearch && patients.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
        <User className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          Empiece buscando un paciente
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {showingSearch ? "Resultados" : "Pacientes recientes"}
        </p>
        {showingSearch && (
          <p className="text-xs text-muted-foreground">
            {patients.length} mostrado{patients.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="max-h-[360px] overflow-y-auto pr-1">
        <div className="grid gap-2 lg:grid-cols-2">
          {patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              onClick={() => onSelect(patient)}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-md border border-l-2 border-border border-l-transparent bg-background p-3 text-left transition-colors",
                "hover:border-primary/50 hover:border-l-primary hover:bg-primary/[0.05]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "focus-visible:border-primary/60 focus-visible:border-l-primary focus-visible:bg-primary/[0.05]",
              )}
            >
              <PatientAvatar patient={patient} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {patient.nombres} {patient.apellidos}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {patient.tipo_doc_abrev} {patient.nro_documento}
                </p>
              </div>
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>

        {showingSearch && hasMoreSearchResults && (
          <div className="sticky bottom-0 mt-2 bg-card/95 pt-2 backdrop-blur">
            <Button
              type="button"
              variant="outline"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="w-full"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando...
                </>
              ) : (
                "Cargar más pacientes"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function PatientAvatar({
  patient,
  selected,
}: {
  patient: PatientSearchResult;
  selected?: boolean;
}) {
  const initials = `${patient.nombres?.[0] || ""}${patient.apellidos?.[0] || ""}`.toUpperCase();

  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        selected
          ? "bg-gradient-primary text-white"
          : "bg-muted text-muted-foreground",
      )}
    >
      {initials || <User className="h-4 w-4" />}
    </div>
  );
}
