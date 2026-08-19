import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, ShieldCheck } from "lucide-react";
import { PatientFormData } from "../types";

interface CreatePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: PatientFormData;
  formError: string;
  isSubmitting: boolean;
  consent: boolean;
  onConsentChange: (checked: boolean) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onFieldChange: (field: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onTipoDocChange: (value: string) => void;
}

export function CreatePatientDialog({
  open,
  onOpenChange,
  formData,
  formError,
  isSubmitting,
  consent,
  onConsentChange,
  onDocumentChange,
  onPhoneChange,
  onFieldChange,
  onSubmit,
  onTipoDocChange,
}: CreatePatientDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-primary hover:opacity-90">
          <UserPlus className="h-4 w-4" />
          Nuevo Paciente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px] [&>button.absolute]:opacity-100 [&>button.absolute]:hover:bg-muted-foreground/15 [&>button.absolute]:hover:text-foreground [&>button.absolute]:transition-colors">
        <DialogHeader className="flex-row items-start gap-4 space-y-0">
          <div className="rounded-xl bg-primary/10 p-3 text-primary shrink-0">
            <UserPlus className="h-6 w-6" />
          </div>
          <div>
            <DialogTitle className="text-xl text-emerald-800">Registrar Nuevo Paciente</DialogTitle>
            <DialogDescription className="mt-1">
              Complete los datos del paciente. Todos los campos son obligatorios.
            </DialogDescription>
          </div>
        </DialogHeader>

        <Separator />

        <form id="patient-form" onSubmit={onSubmit} className="space-y-5">
          {formError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="tipo_doc">Doc</Label>
              <Select
                value={formData.tipo_doc}
                onValueChange={onTipoDocChange}
                required
              >
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
            <div className="col-span-6 space-y-2">
              <Label htmlFor="nro_documento">Número de Documento</Label>
              <Input
                id="nro_documento"
                value={formData.nro_documento}
                onChange={(e) => onDocumentChange(e.target.value)}
                placeholder={formData.tipo_doc === "DNI" ? "8 dígitos" : formData.tipo_doc === "CE" ? "8-12 caracteres" : "3-9 caracteres"}
                maxLength={formData.tipo_doc === "DNI" ? 8 : formData.tipo_doc === "CE" ? 12 : 9}
                className="border-slate-300 dark:border-slate-600"
                required
              />
            </div>
            <div className="col-span-4 space-y-2">
              <Label htmlFor="sexo">Sexo</Label>
              <Select
                value={formData.sexo}
                onValueChange={(val) => onFieldChange("sexo", val)}
                required
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombres">Nombres</Label>
              <Input
                id="nombres"
                value={formData.nombres}
                onChange={(e) => onFieldChange("nombres", e.target.value)}
                className="border-slate-300 dark:border-slate-600"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apellidos">Apellidos</Label>
              <Input
                id="apellidos"
                value={formData.apellidos}
                onChange={(e) => onFieldChange("apellidos", e.target.value)}
                className="border-slate-300 dark:border-slate-600"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fecha_nacimiento">Fecha de Nacimiento</Label>
              <Input
                id="fecha_nacimiento"
                type="date"
                value={formData.fecha_nacimiento}
                onChange={(e) => onFieldChange("fecha_nacimiento", e.target.value)}
                className="border-slate-300 dark:border-slate-600"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                type="tel"
                value={formData.telefono}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="999 999 999"
                className="border-slate-300 dark:border-slate-600"
                required
              />
            </div>
          </div>
          <div className={`rounded-md border bg-accent/40 p-4 transition-colors ${consent ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-border"}`}>
            <div className="flex items-start gap-3">
              <Checkbox
                id="consent"
                checked={consent}
                onCheckedChange={(v) => onConsentChange(!!v)}
                className="mt-0.5"
              />
              <Label
                htmlFor="consent"
                className="text-sm leading-snug cursor-pointer"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Consentimiento Informado Físico Archivado
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  Confirmo que el paciente ha firmado el formulario de
                  consentimiento y se encuentra archivado en su historia clínica.
                </span>
              </Label>
            </div>
          </div>
        </form>

        <Separator />

        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="bg-gradient-primary hover:opacity-90"
            disabled={isSubmitting}
            form="patient-form"
          >
            {isSubmitting ? "Registrando..." : "Registrar Paciente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
