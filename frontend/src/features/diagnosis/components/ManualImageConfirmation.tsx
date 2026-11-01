import { useId, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ManualImageReview } from "../types";

interface Props {
  review: ManualImageReview;
  onCancel: () => void;
  onConfirm: (review: ManualImageReview, accepted: boolean) => void;
}

export function ManualImageConfirmation({ review, onCancel, onConfirm }: Props) {
  const checkboxId = useId();
  const [acceptedReview, setAcceptedReview] = useState<ManualImageReview | null>(null);
  const accepted = acceptedReview === review;
  const hasPreviews = review.images.every((image) => !!image.preview);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AppModalContent className="w-[min(96vw,900px)] max-w-none">
        <AppModalHeader icon={<ImageIcon className="h-6 w-6" />} title="Confirmar fotografías seleccionadas"
          subtitle={`${review.patient.nombres} ${review.patient.apellidos} | ${review.patient.tipo_doc_abrev} ${review.patient.nro_documento}`} />
        <AppModalBody className="space-y-4">
          <div className={`grid gap-4 ${review.images.length === 2 ? "sm:grid-cols-2" : "mx-auto max-w-md"}`}>
            {review.images.map(({ eye, file, preview }) => (
              <figure key={eye} className="min-w-0 space-y-2">
                <figcaption className="text-sm font-medium">{eye === "OD" ? "Ojo Derecho (OD)" : "Ojo Izquierdo (OI)"}</figcaption>
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
                  {preview ? <img src={preview} alt={`Fotografía manual ${eye}`} className="h-full w-full object-contain" />
                    : <p role="alert" className="px-4 text-center text-sm text-muted-foreground">Vista previa no disponible. Vuelva a seleccionar la fotografía antes de analizar.</p>}
                </div>
                <p className="truncate text-xs text-muted-foreground" title={file.name}>{file.name}</p>
              </figure>
            ))}
          </div>
        </AppModalBody>
        <div className="px-5 pt-4 sm:px-6">
          <label htmlFor={checkboxId} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <Checkbox id={checkboxId} checked={accepted} disabled={!hasPreviews}
              onCheckedChange={(checked) => setAcceptedReview(checked === true ? review : null)} className="mt-1 shrink-0" />
            Confirmo que he revisado las fotografías y que corresponden al paciente y al ojo indicados.
          </label>
        </div>
        <AppModalFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button type="button" disabled={!accepted || !hasPreviews} onClick={() => onConfirm(review, accepted)}>Confirmar y analizar</Button>
        </AppModalFooter>
      </AppModalContent>
    </Dialog>
  );
}
