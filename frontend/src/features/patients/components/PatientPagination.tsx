import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { patientPageItems } from "../patientListing";

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PatientPagination({ currentPage, totalPages, onPageChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useEffect(() => { setEditing(false); setError(""); }, [currentPage, totalPages]);

  const cancel = (restoreFocus = false) => {
    setEditing(false);
    setDraft(String(currentPage));
    setError("");
    if (restoreFocus) requestAnimationFrame(() => active.current?.focus());
  };
  const confirm = () => {
    if (totalPages < 1 || error === "Solo números enteros." || !/^\d+$/.test(draft)) {
      cancel(true);
      return;
    }
    const page = Number(draft);
    onPageChange(Math.min(totalPages, Math.max(1, page)));
    cancel(true);
  };

  if (totalPages < 1) return null;

  return <nav aria-label="Páginas de pacientes" className="flex max-w-full items-center gap-1 overflow-x-auto">
    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Página anterior"
      disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
    {patientPageItems(currentPage, totalPages).map((page, index) => page === "ellipsis"
      ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-sm text-muted-foreground">…</span>
      : page === currentPage && editing
        ? <div key={page} className="relative shrink-0">
            <input ref={input} aria-label="Ir a página" aria-invalid={!!error} aria-describedby={error ? "patient-page-error" : undefined}
              title={`Ir a página (1–${totalPages})`} inputMode="numeric" pattern="[0-9]*" value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(event.target.value && !/^\d+$/.test(event.target.value) ? "Solo números enteros." : "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); confirm(); }
                if (event.key === "Escape") { event.preventDefault(); cancel(true); }
              }}
              onBlur={() => cancel()}
              className="h-8 w-12 rounded-md border border-primary bg-background text-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {error && <span id="patient-page-error" role="alert" className="absolute bottom-full right-0 mb-1 whitespace-nowrap rounded border bg-background px-2 py-1 text-xs text-destructive shadow-sm">{error}</span>}
          </div>
        : <Button key={page} ref={page === currentPage ? active : undefined} variant={page === currentPage ? "default" : "ghost"}
            size="icon" className={`h-8 min-w-8 shrink-0 px-1 text-sm tabular-nums ${page === currentPage ? "hover:ring-2 hover:ring-primary/30 focus-visible:ring-2" : ""}`}
            aria-label={page === currentPage ? `Página actual ${page}, editar número` : `Ir a página ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
            title={page === currentPage ? "Editar número de página" : undefined}
            onClick={() => {
              if (page === currentPage) { setDraft(String(page)); setEditing(true); setError(""); }
              else onPageChange(page);
            }}>{page}</Button>)}
    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Página siguiente"
      disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
  </nav>;
}
