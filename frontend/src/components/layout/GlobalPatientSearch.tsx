import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth/store/authStore";
import { canAccessModule } from "@/features/auth/moduleAccess";
import { buscarPacientesPaginado, type PatientSearchResult } from "@/features/patients/api/patientService";
import { patientRequestMessage } from "@/features/patients/patientAccess";

export function GlobalPatientSearch() {
  const { user, deniedModules, denyModule } = useAuthStore();
  const allowed = canAccessModule(user, "patients", deniedModules);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestId = useRef(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();

  useEffect(() => {
    if (mobileOpen) inputRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    if (!allowed || term.length < 2) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setResults([]);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await buscarPacientesPaginado(term, { page: 1, perPage: 5 });
        if (id === requestId.current) setResults(response.data);
      } catch (error) {
        if (id !== requestId.current) return;
        setResults([]);
        setError(patientRequestMessage(error));
        if ((error as { response?: { status?: number } })?.response?.status === 403) denyModule("patients");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); requestId.current++; };
  }, [allowed, term, denyModule]);

  if (!allowed) return null;

  const select = (patient: PatientSearchResult) => {
    requestId.current++;
    setOpen(false);
    setMobileOpen(false);
    setQuery("");
    setResults([]);
    navigate(`/pacientes/${patient.id}`);
  };

  return <div ref={searchRef} className={`relative flex min-w-0 w-full max-w-md items-center justify-end gap-1 ${mobileOpen ? "flex-1" : ""} sm:block`}>
    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 sm:hidden"
      aria-label={mobileOpen ? "Cerrar búsqueda de pacientes" : "Abrir búsqueda de pacientes"}
      aria-expanded={mobileOpen} onClick={() => {
        if (mobileOpen) { requestId.current++; setOpen(false); setQuery(""); }
        setMobileOpen(!mobileOpen);
      }}>
      {mobileOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
    </Button>
    <div className={`${mobileOpen ? "min-w-0 flex-1" : "hidden"} relative sm:block`}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input ref={inputRef} role="combobox" aria-label="Buscar paciente o documento"
        aria-autocomplete="list" aria-expanded={open && term.length >= 2}
        aria-controls={open && term.length >= 2 ? "global-patient-results" : undefined}
        aria-activedescendant={open && activeIndex >= 0 && results[activeIndex] ? `global-patient-${results[activeIndex].id}` : undefined}
        placeholder="Buscar paciente o documento..." autoComplete="off"
        className="h-9 w-full bg-muted/40 pl-9 text-sm"
        value={query} onChange={(event) => {
          requestId.current++;
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }} onFocus={() => { if (term.length >= 2) setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); return; }
          if (event.key === "ArrowDown" && results.length && open) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % results.length);
          } else if (event.key === "ArrowUp" && results.length && open) {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + results.length) % results.length);
          } else if (event.key === "Enter" && open && results[activeIndex]) {
            event.preventDefault();
            select(results[activeIndex]);
          }
        }} />
    </div>
    {open && term.length >= 2 && <div id="global-patient-results" role="listbox" aria-label="Resultados de pacientes"
      className="absolute right-0 top-full z-50 mt-2 w-[min(88vw,22rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg sm:w-full">
      {loading ? <p role="status" className="px-3 py-3 text-sm text-muted-foreground">Buscando pacientes...</p>
        : error ? <p role="alert" className="px-3 py-3 text-sm text-destructive">{error}</p>
          : results.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">No se encontraron pacientes.</p>
            : <div className="max-h-64 overflow-y-auto py-1">
              {results.map((patient, index) => <button key={patient.id} id={`global-patient-${patient.id}`}
                type="button" role="option" aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)} onClick={() => select(patient)}
                className="flex w-full flex-col px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none aria-selected:bg-muted">
                <span className="font-medium">{patient.nombres} {patient.apellidos}</span>
                <span className="text-xs text-muted-foreground">{patient.tipo_doc_abrev || patient.tipo_doc} {patient.nro_documento}</span>
              </button>)}
            </div>}
    </div>}
  </div>;
}
