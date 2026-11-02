import { useId, useState } from "react";
import { ImageMinus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader } from "@/components/ui/app-modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { DiscardContext } from "../api/diagnosisDiscardService";

const reasons: Record<string, string> = {
  RESULTADO_VALIDADO: "Validación médica registrada",
  COMPROBANTE_VINCULADO: "Fotografía del retinógrafo: no descartable",
  INFORMES_EXISTENTES: "La visita tiene informes registrados",
  VISITA_NO_ACTIVA: "La visita no está activa",
  DIAGNOSTICO_NO_COMPATIBLE: "Estado de evaluación no compatible",
  ARCHIVO_COMPARTIDO: "Evidencia compartida: requiere revisión",
  DEPENDENCIA_NO_COMPATIBLE: "Dependencia incompatible",
};
interface Props {
  context: DiscardContext;
  patientLabel: string;
  visitLabel: string;
  onCancel: () => void;
  onConfirm: (context: DiscardContext, ids: number[], accepted: boolean) => void;
}
export function CorrectPhotographsModal({ context, patientLabel, visitLabel, onCancel, onConfirm }: Props) {
  const id = useId();
  const [selection, setSelection] = useState<{ context: DiscardContext; ids: number[]; accepted: boolean }>(
    { context, ids: [], accepted: false });
  const current = selection.context === context ? selection : { context, ids: [], accepted: false };
  const choose = (detailId: number, checked: boolean) => setSelection({ context, accepted: false,
    ids: checked ? [...current.ids, detailId] : current.ids.filter((value) => value !== detailId) });
  return <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <AppModalContent className="w-[min(96vw,640px)] max-w-none">
      <AppModalHeader icon={<ImageMinus className="h-6 w-6" />} title="Corregir fotografías" subtitle={patientLabel} />
      <AppModalBody className="space-y-4">
        <p className="text-sm">Seleccione los resultados IA que desea descartar para cargar y analizar fotografías correctas.</p>
        <p className="text-xs text-muted-foreground">{visitLabel}</p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Resultados registrados</legend>
          {context.detalles.map((detail) => <label key={detail.detalle_id}
            className="flex items-start gap-3 rounded-md border border-border bg-background p-3 text-sm">
            <Checkbox aria-label={`Descartar ${detail.ojo}`} checked={current.ids.includes(detail.detalle_id)}
              disabled={!detail.elegible || detail.estado_validacion !== "PENDIENTE"}
              onCheckedChange={(checked) => choose(detail.detalle_id, checked === true)} className="mt-1" />
            <span><span className="block font-medium">{detail.ojo === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)"}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{detail.elegible
                ? "Fotografía manual · IA pendiente · Sin validación médica ni dependencias incompatibles"
                : reasons[detail.bloqueo ?? ""] ?? "No disponible para descarte; requiere revisión del contexto"}</span></span>
          </label>)}
        </fieldset>
        <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm leading-relaxed">
          Se descartarán los resultados IA y los archivos asociados de los ojos seleccionados. Se conservarán el paciente, la visita y los resultados de los ojos no seleccionados.
        </p>
        <label htmlFor={id} className="flex items-start gap-3 text-sm leading-relaxed">
          <Checkbox id={id} checked={current.accepted} className="mt-1" onCheckedChange={(checked) =>
            setSelection({ ...current, accepted: checked === true })} />
          Confirmo que deseo descartar los resultados seleccionados para realizar nuevamente el análisis.
        </label>
      </AppModalBody>
      <AppModalFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="button" variant="destructive" disabled={!current.ids.length || !current.accepted}
          onClick={() => onConfirm(context, current.ids, current.accepted)}>Descartar resultados</Button>
      </AppModalFooter>
    </AppModalContent>
  </Dialog>;
}
