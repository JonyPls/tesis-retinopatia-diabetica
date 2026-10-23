import { useEffect } from "react";
import { UserRoundPen } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonNameInput } from "@/components/ui/person-name-input";
import { normalizePersonName } from "@/lib/fieldValidation";
import { DOC_RULES, normalizeDocument } from "@/lib/documentValidation";
import type { AdminCatalog, AdminForm } from "../api/configurationService";
import type { UserErrors, UserField } from "../userRegistration";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: AdminCatalog;
  form: AdminForm;
  errors: UserErrors;
  validationFocus: { field: UserField; attempt: number } | null;
  formError: string;
  saving: boolean;
  onFieldChange: (field: keyof AdminForm, value: AdminForm[keyof AdminForm]) => void;
  onDocumentBlur: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

const inputClass = "h-10 sm:h-[38px]";
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 sm:h-[38px]";

export function EditUserDialog({ open, onOpenChange, catalog, form, errors, validationFocus,
  formError, saving, onFieldChange, onDocumentBlur, onSubmit }: Props) {
  const code = catalog.document_types.find((item) => item.id === form.tipo_doc_id)?.codigo ?? "";
  const state = (field: UserField) => ({ "aria-invalid": !!errors[field],
    "aria-describedby": errors[field] ? `edit-${field}-error` : undefined });
  const fieldError = (field: UserField) => errors[field] ?
    <p id={`edit-${field}-error`} role="alert" className="text-sm text-destructive">{errors[field]}</p> : null;
  const title = (id: string, text: string) => <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
    <div className="flex items-center gap-2.5"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
      <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">{text}</h3></div>
    <span className="text-xs text-muted-foreground"><span className="text-destructive">*</span> Obligatorio</span>
  </div>;
  const label = (field: UserField, text: string, required = true) =>
    <Label htmlFor={`edit-${field}`} className="text-[13px] font-medium leading-snug text-foreground">
      {text}{required && <span aria-label="obligatorio" className="ml-1 text-destructive">*</span>}
    </Label>;

  useEffect(() => {
    const body = document.getElementById("edit-user-body");
    if (!open || !validationFocus || !body) return;
    const field = document.getElementById(`edit-${validationFocus.field}`);
    if (!field || !body.contains(field)) return;
    field.focus({ preventScroll: true });
    const target = field.closest<HTMLElement>("[data-edit-field]") ?? field;
    const viewport = body.getBoundingClientRect();
    const area = target.getBoundingClientRect();
    const margin = 12;
    if (body.scrollHeight <= body.clientHeight ||
        (area.top >= viewport.top + margin && area.bottom <= viewport.bottom - margin)) return;
    const delta = area.height <= viewport.height - 2 * margin
      ? area.top + area.height / 2 - (viewport.top + viewport.height / 2)
      : area.top - (viewport.top + margin);
    body.scrollTo({ top: Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + delta)),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [open, validationFocus]);

  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
    <AppModalContent className="sm:max-w-[680px]" onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}>
      <AppModalHeader icon={<UserRoundPen className="h-6 w-6" />} title="Editar usuario"
        subtitle="Actualice los datos de la cuenta" />
      <AppModalBody id="edit-user-body" className="bg-muted/65 py-4 dark:bg-muted/40">
        {formError && <p role="alert" className="mb-3 text-sm text-destructive">{formError}</p>}
        <form id="edit-user-form" onSubmit={onSubmit} noValidate className="space-y-3">
          <section aria-labelledby="edit-identification-title" className="rounded-xl border border-border bg-card p-4">
            {title("edit-identification-title", "Identificación")}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {(["nombres", "apellidos"] as const).map((field) => <div key={field} data-edit-field className="space-y-1">
                {label(field, field === "nombres" ? "Nombres" : "Apellidos")}
                <PersonNameInput id={`edit-${field}`} value={form[field]} disabled={saving} className={inputClass}
                  maxLength={field === "nombres" ? 80 : 100} autoComplete={field === "nombres" ? "given-name" : "family-name"}
                  onValueChange={(value) => onFieldChange(field, value)}
                  onBlur={() => onFieldChange(field, normalizePersonName(form[field]))} {...state(field)} />
                {fieldError(field)}
              </div>)}
              <div data-edit-field className="space-y-1">
                {label("tipo_doc_id", "Tipo de documento")}
                <select id="edit-tipo_doc_id" value={form.tipo_doc_id || ""} disabled={saving}
                  onChange={(event) => onFieldChange("tipo_doc_id", Number(event.target.value))}
                  className={selectClass} {...state("tipo_doc_id")}>
                  {!catalog.document_types.some((item) => item.id === form.tipo_doc_id) && <option value="">Seleccione</option>}
                  {catalog.document_types.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                </select>
                {fieldError("tipo_doc_id")}
              </div>
              <div data-edit-field className="space-y-1">
                {label("nro_documento", "Número de documento")}
                <Input id="edit-nro_documento" type="text" value={form.nro_documento} disabled={saving || !DOC_RULES[code]}
                  maxLength={Math.max(DOC_RULES[code]?.maxLength ?? 0, form.nro_documento.length)}
                  inputMode={code === "DNI" ? "numeric" : "text"} autoComplete="off" className={inputClass}
                  placeholder={code === "DNI" ? "8 dígitos" : code === "CE" ? "8 a 12 caracteres" : "3 a 9 caracteres"}
                  onChange={(event) => {
                    const limit = DOC_RULES[code]?.maxLength ?? 0;
                    const value = event.target.value;
                    // Al borrar un documento heredado más largo, no recortar el resto sin avisar.
                    onFieldChange("nro_documento", form.nro_documento.length > limit &&
                      value.length <= form.nro_documento.length && value.length > limit
                      ? value : normalizeDocument(value, code).slice(0, limit));
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    const input = event.currentTarget;
                    const start = input.selectionStart ?? form.nro_documento.length;
                    const end = input.selectionEnd ?? start;
                    const combined = form.nro_documento.slice(0, start) + event.clipboardData.getData("text") + form.nro_documento.slice(end);
                    onFieldChange("nro_documento", normalizeDocument(combined, code).slice(0, DOC_RULES[code]?.maxLength));
                  }} onBlur={onDocumentBlur} {...state("nro_documento")} />
                {fieldError("nro_documento")}
              </div>
            </div>
          </section>
          <section aria-labelledby="edit-account-title" className="rounded-xl border border-border bg-card p-4">
            {title("edit-account-title", "Datos de la cuenta")}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {(["username", "correo"] as const).map((field) => <div key={field} data-edit-field className="space-y-1">
                {label(field, field === "username" ? "Nombre de usuario" : "Correo electrónico")}
                <Input id={`edit-${field}`} value={form[field]} type={field === "correo" ? "email" : "text"}
                  maxLength={field === "correo" ? 150 : 50} disabled={saving} autoComplete={field === "correo" ? "email" : "username"}
                  onChange={(event) => onFieldChange(field, event.target.value)} className={inputClass} {...state(field)} />
                {fieldError(field)}
              </div>)}
            </div>
          </section>
          <section aria-labelledby="edit-professional-title" className="rounded-xl border border-border bg-card p-4">
            {title("edit-professional-title", "Información profesional")}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div data-edit-field className="space-y-1 sm:col-span-2">
                {label("cargo_id", "Cargo")}
                <select id="edit-cargo_id" value={form.cargo_id || ""} disabled={saving} className={selectClass}
                  onChange={(event) => onFieldChange("cargo_id", Number(event.target.value))} {...state("cargo_id")}>
                  <option value="">Seleccione</option>
                  {catalog.positions.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                </select>
                {fieldError("cargo_id")}
              </div>
              {(["cmp", "rne"] as const).map((field) => <div key={field} data-edit-field className="space-y-1">
                {label(field, `${field.toUpperCase()} (opcional)`, false)}
                <Input id={`edit-${field}`} value={form[field] ?? ""} maxLength={20} inputMode="numeric"
                  disabled={saving} className={inputClass}
                  onChange={(event) => onFieldChange(field, event.target.value.replace(/\D/g, "") || null)} {...state(field)} />
                {fieldError(field)}
              </div>)}
            </div>
          </section>
        </form>
      </AppModalBody>
      <AppModalFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button type="submit" form="edit-user-form" disabled={saving} className="bg-primary hover:bg-primary/90">
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>
      </AppModalFooter>
    </AppModalContent>
  </Dialog>;
}
