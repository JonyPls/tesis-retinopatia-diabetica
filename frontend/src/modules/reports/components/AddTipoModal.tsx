import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TipoInforme } from "../types";

interface AddTipoModalProps {
  open: boolean;
  onClose: () => void;
  availableTipos: TipoInforme[];
  onAdd: (tipo: TipoInforme) => void;
}

export function AddTipoModal({ open, onClose, availableTipos, onAdd }: AddTipoModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar tipo de informe</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {availableTipos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay más tipos de informe disponibles.
            </p>
          ) : (
            availableTipos.map((tipo) => (
              <button
                key={tipo.id}
                type="button"
                onClick={() => onAdd(tipo)}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <p className="text-sm font-medium">{tipo.nombre}</p>
                <p className="text-xs text-muted-foreground">{tipo.descripcion}</p>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
