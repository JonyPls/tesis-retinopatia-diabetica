import { Dialog } from "@/components/ui/dialog";
import {
  AppModalBody,
  AppModalContent,
  AppModalFooter,
  AppModalHeader,
} from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface ConfirmDeleteProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
}

export function ConfirmDelete({
  open,
  onConfirm,
  onCancel,
  title = "Confirmar eliminación",
  description = "¿Estás seguro de que deseas eliminar este elemento? Esta acción no se puede deshacer.",
  confirmText = "Eliminar",
  cancelText = "Cancelar",
}: ConfirmDeleteProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <AppModalContent>
        <AppModalHeader
          icon={<Trash2 className="h-6 w-6" />}
          iconClassName="bg-red-100 text-red-700"
          title={title}
          subtitle="Esta acción requiere confirmación."
        />
        <AppModalBody>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </AppModalBody>
        <AppModalFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmText}
          </Button>
        </AppModalFooter>
      </AppModalContent>
    </Dialog>
  );
}
