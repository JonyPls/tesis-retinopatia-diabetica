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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Registrar Nuevo Paciente</DialogTitle>
          <DialogDescription>
            Complete los datos del paciente. Todos los campos son obligatorios.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {formError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 flex gap-2">
              <div className="w-1/3 space-y-1.5">
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
                    <SelectItem value="PASAPORTE">PAS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="nro_documento">Número</Label>
                <Input
                  id="nro_documento"
                  value={formData.nro_documento}
                  onChange={(e) => onDocumentChange(e.target.value)}
                  placeholder={formData.tipo_doc === "DNI" ? "8 dígitos" : "Nro Documento"}
                  maxLength={formData.tipo_doc === "DNI" ? 8 : 12}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nombres">Nombres</Label>
              <Input
                id="nombres"
                value={formData.nombres}
                onChange={(e) => onFieldChange("nombres", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apellidos">Apellidos</Label>
              <Input
                id="apellidos"
                value={formData.apellidos}
                onChange={(e) => onFieldChange("apellidos", e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fecha_nacimiento">Fecha de Nacimiento</Label>
              <Input
                id="fecha_nacimiento"
                type="date"
                value={formData.fecha_nacimiento}
                onChange={(e) => onFieldChange("fecha_nacimiento", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                type="tel"
                value={formData.telefono}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="999 999 999"
                required
              />
            </div>
          </div>
          <div className="rounded-md border border-border bg-accent/40 p-3">
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
          <DialogFooter>
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
            >
              {isSubmitting ? "Registrando..." : "Registrar Paciente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
