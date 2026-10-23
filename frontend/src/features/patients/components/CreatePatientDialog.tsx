import { useEffect, useState } from "react";
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
import { PersonNameInput } from "@/components/ui/person-name-input";
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
  AlertTriangle,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PatientFormData } from "../types";
import type { PatientFormErrors, PatientFormField, PatientRegistrationScope } from "../hooks/usePatients";
import { localCivilDate, MIN_BIRTH_DATE } from "../birthDate";

interface CreatePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: PatientFormData;
  isSubmitting: boolean;
  consent: boolean;
  onConsentChange: (checked: boolean) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onFieldChange: (field: keyof PatientFormData, value: string) => void;
  onNameBlur: (field: "nombres" | "apellidos") => void;
  onSubmit: (e: React.FormEvent) => void;
  onTipoDocChange: (value: string) => void;
  hasUnsavedChanges: boolean;
  onDiscard: () => void;
  triggerLabel?: string;
  registrationScope: PatientRegistrationScope;
  validationErrors?: PatientFormErrors;
  validationFocus?: { field: PatientFormField; attempt: number } | null;
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
  onNameBlur,
  onSubmit,
  onTipoDocChange,
  hasUnsavedChanges,
  onDiscard,
  triggerLabel = "Nuevo Paciente",
  registrationScope,
  validationErrors = {},
  validationFocus,
}: CreatePatientDialogProps) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const today = localCivilDate();

  useEffect(() => {
    if (!open || !validationFocus) return;
    const body = document.getElementById("patient-form")?.parentElement;
    const field = document.getElementById(validationFocus.field);
    if (!body || !field || !body.contains(field)) return;

    // scrollIntoView desplaza también al DialogContent (overflow-hidden),
    // dejando un hueco bajo el footer. Solo el cuerpo debe desplazarse.
    field.focus({ preventScroll: true });
    const target = validationFocus.field === "consent"
      ? body.querySelector<HTMLElement>("[data-consent-card]") ?? field
      : field.parentElement ?? field;
    const viewport = body.getBoundingClientRect();
    const area = target.getBoundingClientRect();
    const margin = 12;
    if (body.scrollHeight <= body.clientHeight ||
        (area.top >= viewport.top + margin && area.bottom <= viewport.bottom - margin)) return;

    const delta = area.height <= viewport.height - 2 * margin
      ? area.top + area.height / 2 - (viewport.top + viewport.height / 2)
      : area.top - (viewport.top + margin);
    const next = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + delta));
    if (Math.abs(next - body.scrollTop) > 1) {
      body.scrollTo({ top: next, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto" : "smooth" });
    }
  }, [open, validationFocus]);

  const errorFor = (field: PatientFormField) => validationErrors[field];

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
          subtitle={registrationScope === "administrative"
            ? "Complete los datos de identificación y contacto."
            : "Complete los datos de identificación y la información clínica inicial."}
        />

        <AppModalBody className="bg-muted/65 py-4 dark:bg-muted/40">
          <form id="patient-form" onSubmit={onSubmit} noValidate className="space-y-3">
            <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="patient-identification-title">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
                  <h3 id="patient-identification-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">Identificación</h3>
                </div>
                <span className="text-xs text-muted-foreground"><span className="text-destructive">*</span> Obligatorio</span>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-12">
              <div className="space-y-1 sm:col-span-4">
                <FieldLabel htmlFor="tipo_doc" required>Tipo de documento</FieldLabel>
                <Select value={formData.tipo_doc} onValueChange={onTipoDocChange}>
                  <SelectTrigger id="tipo_doc" aria-required="true" aria-invalid={!!errorFor("tipo_doc")} aria-describedby={errorFor("tipo_doc") ? "tipo_doc-error" : undefined} className="h-10 sm:h-[38px]">
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DNI">DNI</SelectItem>
                    <SelectItem value="CE">CE</SelectItem>
                    <SelectItem value="PAS">PAS</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="tipo_doc" message={errorFor("tipo_doc")} />
              </div>
              <div className="space-y-1 sm:col-span-8">
                <FieldLabel htmlFor="nro_documento" required>Número de documento</FieldLabel>
                <Input id="nro_documento" value={formData.nro_documento}
                  onChange={(e) => onDocumentChange(e.target.value)} required
                  aria-invalid={!!errorFor("nro_documento")}
                  aria-describedby={errorFor("nro_documento") ? "nro_documento-error" : undefined}
                  inputMode={formData.tipo_doc === "DNI" ? "numeric" : "text"}
                  autoComplete="off"
                  placeholder={formData.tipo_doc === "DNI" ? "8 dígitos" : formData.tipo_doc === "CE" ? "8 a 12 caracteres" : "3 a 9 caracteres"}
                  maxLength={formData.tipo_doc === "DNI" ? 8 : formData.tipo_doc === "CE" ? 12 : 9}
                  className="h-10 sm:h-[38px]" />
                <FieldError field="nro_documento" message={errorFor("nro_documento")} />
              </div>
              <div className="space-y-1 sm:col-span-6">
                <FieldLabel htmlFor="nombres" required>Nombres</FieldLabel>
                 <PersonNameInput id="nombres" value={formData.nombres} onValueChange={(value) => onFieldChange("nombres", value)} onBlur={() => onNameBlur("nombres")}
                  maxLength={80} autoComplete="given-name" className="h-10 sm:h-[38px]"
                  aria-invalid={!!errorFor("nombres")} aria-describedby={errorFor("nombres") ? "nombres-error" : undefined} />
                <FieldError field="nombres" message={errorFor("nombres")} />
              </div>
              <div className="space-y-1 sm:col-span-6">
                <FieldLabel htmlFor="apellidos" required>Apellidos</FieldLabel>
                 <PersonNameInput id="apellidos" value={formData.apellidos} onValueChange={(value) => onFieldChange("apellidos", value)} onBlur={() => onNameBlur("apellidos")}
                  maxLength={100} autoComplete="family-name" className="h-10 sm:h-[38px]"
                  aria-invalid={!!errorFor("apellidos")} aria-describedby={errorFor("apellidos") ? "apellidos-error" : undefined} />
                <FieldError field="apellidos" message={errorFor("apellidos")} />
              </div>
              <div className="space-y-1 sm:col-span-6">
                <FieldLabel htmlFor="sexo" required>Sexo</FieldLabel>
                <Select value={formData.sexo} onValueChange={(val) => onFieldChange("sexo", val)}>
                  <SelectTrigger id="sexo" className="h-10 sm:h-[38px]" aria-required="true" aria-invalid={!!errorFor("sexo")}
                    aria-describedby={errorFor("sexo") ? "sexo-error" : undefined}>
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Masculino">Masculino</SelectItem>
                    <SelectItem value="Femenino">Femenino</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError field="sexo" message={errorFor("sexo")} />
              </div>
              <div className="space-y-1 sm:col-span-6">
                <FieldLabel htmlFor="fecha_nacimiento" required>Fecha de nacimiento</FieldLabel>
                <Input id="fecha_nacimiento" type="date" value={formData.fecha_nacimiento}
                  onChange={(e) => onFieldChange("fecha_nacimiento", e.target.value)} required min={MIN_BIRTH_DATE} max={today} className="h-10 sm:h-[38px]"
                  aria-invalid={!!errorFor("fecha_nacimiento")}
                  aria-describedby={errorFor("fecha_nacimiento") ? "fecha_nacimiento-error" : undefined} />
                <FieldError field="fecha_nacimiento" message={errorFor("fecha_nacimiento")} />
              </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="patient-contact-title">
              <div className="mb-3 flex items-center gap-2.5">
                <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
                <h3 id="patient-contact-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">Contacto</h3>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel htmlFor="telefono">Teléfono</FieldLabel>
                  <Input id="telefono" type="tel" value={formData.telefono} onChange={(e) => onPhoneChange(e.target.value)}
                    inputMode="numeric" maxLength={11} autoComplete="tel-national" placeholder="999 999 999" className="h-10 sm:h-[38px]"
                    aria-invalid={!!errorFor("telefono")} aria-describedby={errorFor("telefono") ? "telefono-error" : undefined} />
                  <FieldError field="telefono" message={errorFor("telefono")} />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="correo">Correo</FieldLabel>
                  <Input id="correo" type="email" value={formData.correo}
                    onChange={(e) => onFieldChange("correo", e.target.value)} maxLength={150} autoComplete="email"
                    placeholder="correo@ejemplo.com" className="h-10 sm:h-[38px]"
                    aria-invalid={!!errorFor("correo")} aria-describedby={errorFor("correo") ? "correo-error" : undefined} />
                  <FieldError field="correo" message={errorFor("correo")} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <FieldLabel htmlFor="direccion">Dirección</FieldLabel>
                  <Input id="direccion" value={formData.direccion}
                    onChange={(e) => onFieldChange("direccion", e.target.value)} maxLength={255}
                    autoComplete="street-address" className="h-10 sm:h-[38px]"
                    aria-invalid={!!errorFor("direccion")} aria-describedby={errorFor("direccion") ? "direccion-error" : undefined} />
                  <FieldError field="direccion" message={errorFor("direccion")} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="patient-clinical-title">
              <div className="mb-3 flex items-center gap-2.5">
                <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
                <h3 id="patient-clinical-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">
                  {registrationScope === "administrative" ? "Consentimiento informado" : "Información clínica y consentimiento"}
                </h3>
              </div>
              {registrationScope !== "administrative" && (
                <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3", registrationScope === "clinical" && "sm:grid-cols-2")}>
                  {registrationScope === "clinical" && <div className="space-y-1">
                    <FieldLabel htmlFor="antecedentes_clinicos">Antecedentes clínicos</FieldLabel>
                    <Textarea id="antecedentes_clinicos" value={formData.antecedentes_clinicos}
                      onChange={(e) => onFieldChange("antecedentes_clinicos", e.target.value)} maxLength={2000}
                      placeholder="Diabetes, hipertensión, cirugías previas…" className="min-h-[88px] resize-y"
                      aria-invalid={!!errorFor("antecedentes_clinicos")}
                      aria-describedby={errorFor("antecedentes_clinicos") ? "antecedentes_clinicos-error" : undefined} />
                    <FieldError field="antecedentes_clinicos" message={errorFor("antecedentes_clinicos")} />
                  </div>}
                  <div className="space-y-1">
                    <FieldLabel htmlFor="alergias">Alergias</FieldLabel>
                    <Textarea id="alergias" value={formData.alergias}
                      onChange={(e) => onFieldChange("alergias", e.target.value)} maxLength={1000}
                      placeholder="Medicamentos, anestésicos u otras alergias…" className="min-h-[88px] resize-y"
                      aria-invalid={!!errorFor("alergias")}
                      aria-describedby={errorFor("alergias") ? "alergias-error" : undefined} />
                    <FieldError field="alergias" message={errorFor("alergias")} />
                  </div>
                </div>
              )}
               <div data-consent-card className={cn("cursor-pointer rounded-lg border px-3 py-2.5 transition-colors focus-within:border-primary/50",
                registrationScope !== "administrative" && "mt-3",
                errorFor("consent") ? "border-destructive bg-primary/[0.04]" : consent
                  ? "border-primary/40 bg-primary/[0.09]" : "border-primary/10 bg-primary/[0.04]")}
                onClick={(event) => {
                  if (event.target instanceof Element &&
                    event.target.closest("label, button, a, input, select, textarea, [role='checkbox']")) return;
                  onConsentChange(!consent);
                }}>
                <div className="flex items-start gap-3">
                  <Checkbox id="consent" checked={consent} onCheckedChange={(v) => onConsentChange(!!v)} aria-required="true"
                    aria-invalid={!!errorFor("consent")}
                    aria-describedby={errorFor("consent") ? "consent-error" : "consent-hint"} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor="consent" required className="cursor-pointer">Consentimiento Informado Físico Archivado</FieldLabel>
                    <p id="consent-hint" className="text-sm leading-snug text-muted-foreground">Confirme que el documento firmado está archivado.</p>
                  </div>
                </div>
                <FieldError field="consent" message={errorFor("consent")} className="ml-7 mt-2" />
              </div>
            </section>
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

function FieldLabel({ htmlFor, required = false, className, children }: {
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className={cn("text-[13px] font-medium leading-snug text-foreground", className)}>
      {children}{required && <span className="ml-1 text-destructive" aria-label="obligatorio">*</span>}
    </Label>
  );
}

function FieldError({ field, message, className }: {
  field: PatientFormField;
  message?: string;
  className?: string;
}) {
  return message ? <p id={`${field}-error`} role="alert" className={cn("text-sm text-destructive", className)}>{message}</p> : null;
}
