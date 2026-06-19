import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { FileText, Search, Check } from "lucide-react";
import { TipoInforme } from "../types";

interface AddTipoModalProps {
  open: boolean;
  onClose: () => void;
  availableTipos: TipoInforme[];
  onAdd: (tipos: TipoInforme[]) => void;
}

export function AddTipoModal({ open, onClose, availableTipos, onAdd }: AddTipoModalProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return availableTipos;
    const q = search.toLowerCase().trim();
    return availableTipos.filter(
      (t) =>
        t.nombre.toLowerCase().includes(q) ||
        t.descripcion.toLowerCase().includes(q),
    );
  }, [availableTipos, search]);

  const selectedTipos = useMemo(
    () => availableTipos.filter((t) => selectedIds.has(t.id)),
    [availableTipos, selectedIds],
  );

  const handleAdd = () => {
    if (selectedTipos.length === 0) return;
    onAdd(selectedTipos);
    setSelectedIds(new Set());
    setSearch("");
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    setSearch("");
    onClose();
  };

  const allSelected = availableTipos.length > 0 && selectedIds.size === availableTipos.length;

  const isEmpty = availableTipos.length === 0;
  const noResults = !isEmpty && filtered.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[480px] [&>button.absolute]:opacity-100 [&>button.absolute]:hover:bg-muted-foreground/15 [&>button.absolute]:hover:text-foreground [&>button.absolute]:transition-colors">
        <DialogHeader className="flex-row items-start gap-4 space-y-0">
          <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <DialogTitle className="text-xl text-emerald-800">Agregar Informe</DialogTitle>
            <DialogDescription className="mt-1">
              Seleccione uno o más informes para agregar al diagnóstico.
            </DialogDescription>
          </div>
        </DialogHeader>

        <Separator />

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar informe..."
              className="pl-9"
            />
          </div>

          {isEmpty && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No hay más informes disponibles.
            </p>
          )}

          {noResults && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin resultados para "{search}"
            </p>
          )}

          {!isEmpty && !noResults && (
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {filtered.map((tipo) => {
                const selected = selectedIds.has(tipo.id);
                return (
                  <button
                    key={tipo.id}
                    type="button"
                    onClick={() => toggle(tipo.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-center gap-3 ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tipo.nombre}</p>
                      <p className="text-xs text-muted-foreground truncate">{tipo.descripcion}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedIds.size > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <Separator />

        <DialogFooter className="gap-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-gradient-primary hover:opacity-90"
            disabled={selectedIds.size === 0}
            onClick={handleAdd}
          >
            Agregar ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
