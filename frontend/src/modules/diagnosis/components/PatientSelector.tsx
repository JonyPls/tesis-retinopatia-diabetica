import { Search, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PatientSearchResult } from "@/services/patientService";

interface PatientSelectorProps {
  query: string;
  searchResults: PatientSearchResult[];
  recentPatients: PatientSearchResult[];
  selectedPatient: PatientSearchResult | null;
  isSearching: boolean;
  handleQueryChange: (value: string) => void;
  selectPatient: (p: PatientSearchResult) => void;
}

function PatientCard({
  patient,
  isSelected,
  onClick,
}: {
  patient: PatientSearchResult;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-md border p-3 hover:border-primary hover:bg-accent/40 transition-colors w-full",
        isSelected ? "border-primary bg-accent/40" : "border-border",
      )}
    >
      <div className="font-medium text-sm">
        {patient.nombres} {patient.apellidos}
      </div>
      <div className="text-xs text-muted-foreground font-mono mt-0.5">
        {patient.tipo_doc_abrev} {patient.nro_documento}
      </div>
    </button>
  );
}

export function PatientSelector({
  query,
  searchResults,
  recentPatients,
  selectedPatient,
  isSearching,
  handleQueryChange,
  selectPatient,
}: PatientSelectorProps) {
  const showRecents =
    searchResults.length === 0 && !selectedPatient && recentPatients.length > 0;
  const showResults = searchResults.length > 0;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" /> Seleccionar Paciente
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Busque por nombre, apellido o número de documento.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Buscador */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Input
            placeholder="Ej: 45782931 / María Quispe"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="pl-9 pr-9 font-mono"
          />
        </div>

        {/* Resultados de búsqueda */}
        {showResults && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Resultados
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {searchResults.map((p) => (
                <PatientCard
                  key={p.id}
                  patient={p}
                  isSelected={selectedPatient?.id === p.id}
                  onClick={() => selectPatient(p)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pacientes atendidos recientemente */}
        {showRecents && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Atendidos recientemente
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recentPatients.map((p) => (
                <PatientCard
                  key={p.id}
                  patient={p}
                  isSelected={false}
                  onClick={() => selectPatient(p)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Paciente seleccionado */}
        {selectedPatient && (
          <div className="rounded-md border border-primary/30 bg-accent/40 p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground font-semibold">
              {selectedPatient.nombres.charAt(0)}
              {selectedPatient.apellidos.charAt(0)}
            </div>
            <div className="flex-1">
              <div className="font-medium">
                {selectedPatient.nombres} {selectedPatient.apellidos}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedPatient.tipo_doc_abrev} {selectedPatient.nro_documento}
              </div>
            </div>
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
