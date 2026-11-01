import { useEffect, useRef } from "react";
import { ImageIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalHeader } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { formatCivilDay } from "@/lib/clinicalDates";
import type { RetinographAutoImage } from "../api/diagnosisService";
import type { AutoPreview, EyeKey, EyeState } from "../types";

interface Props {
  open: boolean;
  patientName: string;
  candidates: RetinographAutoImage[];
  chosen: AutoPreview | null;
  loading: boolean;
  confirming: boolean;
  eyes: Record<EyeKey, EyeState>;
  lockedEyes?: Partial<Record<EyeKey, boolean>>;
  notice: string | null;
  onSelect: (candidate: RetinographAutoImage) => void;
  onConfirm: (eye: EyeKey) => void;
  onRevoke: (eye: EyeKey) => void;
  onClose: () => void;
}

// La fecha procede del nombre exportado: se presenta como hora de pared, sin atribuir UTC.
function exportDate(value: string) {
  return `${formatCivilDay(value.slice(0, 10))} ${value.slice(11, 16)}`;
}

export function AutoSelectionModal({ open, patientName, candidates, chosen, loading, confirming,
  eyes, lockedEyes = {}, notice, onSelect, onConfirm, onRevoke, onClose }: Props) {
  const selected = chosen && !lockedEyes[chosen.image.ojo] ? chosen.image : undefined;
  const eye = selected?.ojo;
  const eligibleCandidates = candidates.filter((candidate) => !lockedEyes[candidate.ojo]);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = (["OD", "OI"] as EyeKey[])
    .filter((key) => eligibleCandidates.some((candidate) => candidate.ojo === key))
    .sort((first, second) => Number(eyes[first].confirmation === "CONFIRMADA") -
      Number(eyes[second].confirmation === "CONFIRMADA"));
  const isConfirmed = !!selected && eyes[selected.ojo].candidate?.filename === selected.filename &&
    eyes[selected.ojo].confirmation === "CONFIRMADA";
  const eyeHasConfirmation = !!selected && eyes[selected.ojo].confirmation === "CONFIRMADA";
  const canRemove = !!selected && eyes[selected.ojo].isExistingImage &&
    eyes[selected.ojo].confirmation !== "CONSUMIDA";
  const needsReselection = !!selected && eyes[selected.ojo].file === chosen?.file &&
    eyes[selected.ojo].candidate?.filename === selected.filename && !isConfirmed;
  const alternative = selected && eligibleCandidates.find((candidate) => candidate.ojo === selected.ojo &&
    candidate.filename !== selected.filename);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = 0;
  }, [open, eyes.OD.confirmation, eyes.OI.confirmation]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <AppModalContent className="w-[min(96vw,960px)] max-w-none">
        <AppModalHeader icon={<ImageIcon className="h-6 w-6" />} title="Selección de fotografías"
          subtitle="Confirme que la fotografía corresponde al paciente y al ojo indicado. La sugerencia no sustituye la revisión profesional." />
        <AppModalBody className="grid gap-4 bg-background md:grid-cols-[minmax(220px,1fr)_minmax(0,1.5fr)]">
          <div ref={listRef} className="min-h-0 space-y-3 md:max-h-[58vh] md:overflow-y-auto" aria-label="Fotografías candidatas">
            <p className="text-sm font-semibold">Fotografías disponibles</p>
            {(["OD", "OI"] as EyeKey[]).filter((key) => lockedEyes[key]).map((key) => (
              <p key={key} className="text-xs text-muted-foreground">{key}: análisis registrado.</p>
            ))}
            {!eligibleCandidates.length && <p className="text-xs text-muted-foreground">No hay fotografías pendientes disponibles.</p>}
            {groups.map((key) => <section key={key} aria-label={`Ojo ${key === "OD" ? "derecho" : "izquierdo"} (${key})`}
              className="space-y-2">
              <h3 className="border-b border-border pb-1 text-xs font-semibold text-muted-foreground">
                {key === "OD" ? "Ojo derecho (OD)" : "Ojo izquierdo (OI)"}
                 {eyes[key].confirmation === "CONFIRMADA" ? " · Confirmado" : " · Pendiente"}
              </h3>
              {eligibleCandidates.filter((candidate) => candidate.ojo === key).map((candidate, index) => {
              const confirmed = eyes[candidate.ojo].candidate?.filename === candidate.filename &&
                eyes[candidate.ojo].confirmation === "CONFIRMADA";
              return <button key={candidate.filename} type="button"
                aria-label={`Ver fotografía ${index + 1} de ${candidate.ojo}`}
                aria-pressed={selected?.filename === candidate.filename}
                 disabled={confirming || loading || lockedEyes[candidate.ojo]}
                onClick={() => onSelect(candidate)}
                className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.filename === candidate.filename ? "border-primary bg-primary/5" : "border-border"}`}>
                <span className="block font-medium">{patientName}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{exportDate(candidate.fecha_exportacion)} · Color · {candidate.ojo} sugerido</span>
                {confirmed && <span className="mt-1 block text-xs font-medium text-primary">Confirmada</span>}
              </button>;
              })}
            </section>)}
          </div>
          <div className="flex min-h-[300px] flex-col gap-3">
            <p className="text-sm font-semibold">Vista previa ampliada</p>
            <div className="flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
              {loading ? <p className="text-sm text-muted-foreground">Cargando fotografía...</p>
                : selected && chosen?.preview ? <img src={chosen.preview} alt={`Fotografía Color, ${eye} sugerido de ${patientName}`}
                  className="max-h-[50vh] w-full object-contain" />
                : <p className="px-4 text-center text-sm text-muted-foreground">Elija una fotografía para revisarla antes de confirmar.</p>}
            </div>
            {selected && <div className="space-y-2">
              {eyeHasConfirmation && <p className="text-xs font-medium text-primary">Imagen confirmada</p>}
              {isConfirmed ? <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!alternative || confirming || loading}
                  onClick={() => alternative && onSelect(alternative)}>Cambiar imagen</Button>
                <Button type="button" size="sm" variant="outline" disabled={confirming || loading}
                  onClick={() => eye && onRevoke(eye)}>Quitar imagen</Button>
              </div> : <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={!chosen?.preview || confirming || loading || needsReselection}
                  onClick={() => eye && onConfirm(eye)}>
                  {needsReselection ? "Seleccione de nuevo para confirmar" : confirming ? "Registrando asociación..." : `Confirmo paciente, imagen y ojo ${eye}`}
                </Button>
                {canRemove && <Button type="button" size="sm" variant="outline" disabled={confirming || loading}
                  onClick={() => eye && onRevoke(eye)}>Quitar imagen</Button>}
              </div>}
            </div>}
            {notice && <p role="alert" className="text-xs text-destructive">{notice}</p>}
          </div>
        </AppModalBody>
      </AppModalContent>
    </Dialog>
  );
}
