import { useState } from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  AppAlertModalBody,
  AppAlertModalContent,
  AppAlertModalFooter,
  AppAlertModalHeader,
} from "@/components/ui/app-alert-modal";
import {
  AppModalBody,
  AppModalContent,
  AppModalFooter,
  AppModalHeader,
} from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ClipboardPlus,
  AlertTriangle,
  Phone,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PatientFormData } from "../types";

interface CreatePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: PatientFormData;
  isSubmitting: boolean;
  consent: boolean;
  onConsentChange: (checked: boolean) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onFieldChange: (field: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onTipoDocChange: (value: string) => void;
  hasUnsavedChanges: boolean;
  onDiscard: () => void;
  triggerLabel?: string;
}

export function CreatePatientDialog({
  open,
  onOpenChange,
  formData,
  isSubmitting,
  consent,
  onConsentChange,
  onDocumentChange,
  onPhoneChange,
  onFieldChange,
  onSubmit,
  onTipoDocChange,
  hasUnsavedChanges,
  onDiscard,
  triggerLabel = "Nuevo Paciente",
}: CreatePatientDialogProps) {
  const [identificationOpen, setIdentificationOpen] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);
  const [clinicalOpen, setClinicalOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const requestClose = () => {
    if (isSubmitting) return;
    if (hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const confirmDiscard = () => {
    onDiscard();
    setDiscardOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            onOpenChange(true);
            return;
          }
          requestClose();
        }}
      >
        <DialogTrigger asChild>
          <Button className="bg-primary hover:bg-primary/90">
            <UserPlus className="h-4 w-4" />
            {triggerLabel}
          </Button>
        </DialogTrigger>

      <AppModalContent
        className="sm:max-w-[680px]"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <AppModalHeader
          icon={<UserPlus className="h-6 w-6" />}
          title="Registrar Nuevo Paciente"
          subtitle="Complete los datos de identificación y la información clínica inicial."
        />

        <AppModalBody>
          <form id="patient-form" onSubmit={onSubmit} noValidate className="space-y-3">
            <FormSection
              title="Identificación"
              open={identificationOpen}
              onOpenChange={setIdentificationOpen}
              summary={
                formData.nro_documento
                  ? `${formData.tipo_doc} ${formData.nro_documento}`
                  : "Documento y datos personales"
              }
              required
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="tipo_doc">Doc</Label>
                  <Select value={formData.tipo_doc} onValueChange={onTipoDocChange}>
                    <SelectTrigger id="tipo_doc">
                      <SelectValue placeholder="DNI" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DNI">DNI</SelectItem>
                      <SelectItem value="CE">CE</SelectItem>
                      <SelectItem value="PAS">PAS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

              <div className="space-y-2 sm:col-span-6">
                <Label htmlFor="nro_documento">Número de Documento</Label>
                <Input
                  id="nro_documento"
                  value={formData.nro_documento}
                  onChange={(e) => onDocumentChange(e.target.value)}
                  required
                  inputMode={formData.tipo_doc === "DNI" ? "numeric" : "text"}
                  autoComplete="off"
                  placeholder={
                    formData.tipo_doc === "DNI"
                      ? "8 dígitos"
                      : formData.tipo_doc === "CE"
                        ? "8-12 caracteres"
                        : "3-9 caracteres"
                  }
                  maxLength={
                    formData.tipo_doc === "DNI"
                      ? 8
                      : formData.tipo_doc === "CE"
                        ? 12
                        : 9
                  }
                  className="border-input"
                />
              </div>

              <div className="space-y-2 sm:col-span-4">
                <Label htmlFor="sexo">Sexo</Label>
                <Select
                  value={formData.sexo}
                  onValueChange={(val) => onFieldChange("sexo", val)}
                >
                  <SelectTrigger id="sexo">
                    <SelectValue placeholder="Seleccione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Masculino">Masculino</SelectItem>
                    <SelectItem value="Femenino">Femenino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nombres">Nombres</Label>
                <Input
                  id="nombres"
                  value={formData.nombres}
                  onChange={(e) => onFieldChange("nombres", e.target.value)}
                  required
                  maxLength={80}
                  autoComplete="given-name"
                  className="border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apellidos">Apellidos</Label>
                <Input
                  id="apellidos"
                  value={formData.apellidos}
                  onChange={(e) => onFieldChange("apellidos", e.target.value)}
                  required
                  maxLength={100}
                  autoComplete="family-name"
                  className="border-input"
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Contacto"
            open={contactOpen}
            onOpenChange={setContactOpen}
            summary={
              formData.telefono || formData.correo
                ? [formData.telefono, formData.correo].filter(Boolean).join(" · ")
                : "Nacimiento, teléfono y correo"
            }
            icon={<Phone className="h-4 w-4" />}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fecha_nacimiento">Fecha de Nacimiento</Label>
                <Input
                  id="fecha_nacimiento"
                  type="date"
                  value={formData.fecha_nacimiento}
                  onChange={(e) => onFieldChange("fecha_nacimiento", e.target.value)}
                  required
                  max={today}
                  className="border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input
                  id="telefono"
                  type="tel"
                  value={formData.telefono}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  inputMode="numeric"
                  maxLength={11}
                  autoComplete="tel-national"
                  placeholder="999 999 999"
                  className="border-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="correo">Correo</Label>
                <Input
                  id="correo"
                  type="email"
                  value={formData.correo}
                  onChange={(e) => onFieldChange("correo", e.target.value)}
                  maxLength={150}
                  autoComplete="email"
                  placeholder="correo@ejemplo.com"
                  className="border-input"
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Información clínica básica"
            open={clinicalOpen}
            onOpenChange={setClinicalOpen}
            summary="Antecedentes y alergias"
            icon={<ClipboardPlus className="h-4 w-4" />}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="antecedentes_clinicos">Antecedentes clínicos</Label>
                <Textarea
                  id="antecedentes_clinicos"
                  value={formData.antecedentes_clinicos}
                  onChange={(e) =>
                    onFieldChange("antecedentes_clinicos", e.target.value)
                  }
                  maxLength={2000}
                  placeholder="Diabetes, hipertensión, cirugías previas..."
                  className="min-h-[92px] resize-none border-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="alergias">Alergias</Label>
                <Textarea
                  id="alergias"
                  value={formData.alergias}
                  onChange={(e) => onFieldChange("alergias", e.target.value)}
                  maxLength={1000}
                  placeholder="Medicamentos, anestésicos u otras alergias..."
                  className="min-h-[92px] resize-none border-input"
                />
              </div>
            </div>
          </FormSection>

          <Collapsible open={consentOpen} onOpenChange={setConsentOpen}>
            <div
              className={cn(
                "rounded-md border bg-accent/40 transition-colors",
                consent
                  ? "border-emerald-500 ring-1 ring-emerald-500/30"
                  : "border-border",
              )}
            >
              <div className="flex items-center gap-3 p-3">
                <Checkbox
                  id="consent"
                  checked={consent}
                  onCheckedChange={(v) => onConsentChange(!!v)}
                />
                <Label
                  htmlFor="consent"
                  className="flex flex-1 items-center gap-1.5 text-sm font-medium cursor-pointer"
                >
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Consentimiento Informado Físico Archivado
                </Label>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
                    title={consentOpen ? "Ocultar descripción" : "Ver descripción"}
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        consentOpen && "rotate-180",
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                  Confirmo que el paciente ha firmado el formulario de
                  consentimiento y se encuentra archivado en su historia clínica.
                </div>
              </CollapsibleContent>
            </div>
            </Collapsible>
          </form>
        </AppModalBody>

        <AppModalFooter>
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="bg-primary hover:bg-primary/90"
            disabled={isSubmitting}
            form="patient-form"
          >
            {isSubmitting ? "Registrando..." : "Registrar Paciente"}
          </Button>
        </AppModalFooter>
      </AppModalContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AppAlertModalContent>
          <AppAlertModalHeader
            icon={<AlertTriangle className="h-6 w-6" />}
            title="Descartar registro"
            subtitle="Hay datos ingresados que aún no se han guardado."
            iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          />
          <AppAlertModalBody>
            Si descartas el registro, se limpiará toda la información escrita en
            este formulario. ¿Deseas continuar?
          </AppAlertModalBody>
          <AppAlertModalFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDiscard}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Descartar
            </AlertDialogAction>
          </AppAlertModalFooter>
        </AppAlertModalContent>
      </AlertDialog>
    </>
  );
}

function FormSection({
  title,
  summary,
  open,
  onOpenChange,
  children,
  required,
  icon,
}: {
  title: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  required?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 transition-colors"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/5 text-primary/70">
              {icon || <UserPlus className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{title}</span>
                {required && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    Requerido
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{summary}</p>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 border-t border-border p-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
