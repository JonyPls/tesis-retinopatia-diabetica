import { Search, Loader2, User, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { PatientSearchResult } from "@/features/patients/api/patientService";
import { useRef, useEffect } from "react";
import type { PatientRequestError } from "@/features/patients/patientAccess";
import { PatientLookupError } from "@/features/patients/components/PatientLookupError";

interface PatientSelectorStepProps {
  query: string;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  selectedPatient: PatientSearchResult | null;
  isSearching: boolean;
  searchError: PatientRequestError | null;
  recentError: PatientRequestError | null;
  hasSearched: boolean;
  isLoadingRecent: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (p: PatientSearchResult) => void;
  onClear: () => void;
}

export function PatientSelectorStep({
  query,
  searchResults,
  recentPatients,
  selectedPatient,
  isSearching,
  searchError,
  recentError,
  hasSearched,
  isLoadingRecent,
  onQueryChange,
  onSelect,
  onClear,
}: PatientSelectorStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedPatient) {
      inputRef.current?.focus();
    }
  }, [selectedPatient]);

  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden flex flex-col ${selectedPatient ? "" : "min-h-[320px]"}`}>
      <div className="bg-muted/50 px-5 py-3.5 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <User className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Seleccionar Paciente</h3>
          <p className="text-xs text-muted-foreground">
            Busque por número de documento o nombres del paciente
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar por nombre o documento..."
            aria-label="Buscar paciente"
            aria-invalid={!!searchError}
            className="pl-9"
          />
        </div>

        {selectedPatient ? (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {(selectedPatient.nombres[0] + selectedPatient.apellidos[0]).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{selectedPatient.nombres} {selectedPatient.apellidos}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {selectedPatient.tipo_doc_abrev} {selectedPatient.nro_documento}
                </p>
              </div>
              <button
                type="button"
                onClick={onClear}
                aria-label="Cambiar paciente"
                className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            {isSearching && (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando...
              </div>
            )}

            {(query.trim().length >= 2 ? searchError : recentError) && (
              <PatientLookupError error={(query.trim().length >= 2 ? searchError : recentError)!} />
            )}

            {!query && isLoadingRecent && (
              <p role="status" className="text-sm text-muted-foreground">Cargando pacientes recientes...</p>
            )}

            {!searchError && query.trim().length >= 2 && searchResults.length > 0 && (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider sticky top-0 bg-card pb-1 z-10">
                  Resultados de búsqueda
                </p>
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelect(p)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="h-9 w-9 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-xs">
                      {(p.nombres[0] + p.apellidos[0]).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{p.nombres} {p.apellidos}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {p.tipo_doc_abrev} {p.nro_documento}
                      </p>
                    </div>
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {!isSearching && hasSearched && !searchError && query.trim().length >= 2 && searchResults.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No se encontraron pacientes</p>
                  <p className="text-xs text-muted-foreground/70">
                    No hay resultados para "{query.trim()}"
                  </p>
                </div>
              </div>
            )}

            {!query && !recentError && recentPatients.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Pacientes recientes
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recentPatients.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="h-9 w-9 rounded-full bg-gradient-primary flex items-center justify-center text-white font-semibold text-xs">
                        {(p.nombres[0] + p.apellidos[0]).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.nombres} {p.apellidos}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.tipo_doc_abrev} {p.nro_documento}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
