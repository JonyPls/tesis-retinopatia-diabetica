import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, EyeOff, UserPlus, XCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonNameInput } from "@/components/ui/person-name-input";
import { normalizePersonName } from "@/lib/fieldValidation";
import { DOC_RULES, normalizeDocument } from "@/lib/documentValidation";
import { cn } from "@/lib/utils";
import type { AdminCatalog, AdminForm } from "../api/configurationService";
import type { UserErrors, UserField } from "../userRegistration";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: AdminCatalog;
  form: AdminForm;
  confirm: string;
  errors: UserErrors;
  validationFocus: { field: UserField; attempt: number } | null;
  formError: string;
  saving: boolean;
  onFieldChange: (field: keyof AdminForm, value: AdminForm[keyof AdminForm]) => void;
  onDocumentBlur: () => void;
  onConfirmChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 sm:h-[38px]";
const inputClass = "h-10 sm:h-[38px]";

function FieldLabel({ htmlFor, children, required = false }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return <Label htmlFor={htmlFor} className="text-[13px] font-medium leading-snug text-foreground">
    {children}{required && <span aria-label="obligatorio" className="ml-1 text-destructive">*</span>}
  </Label>;
}

function FieldError({ field, message }: { field: UserField; message?: string }) {
  return message ? <p id={`user-${field}-error`} role="alert" className="text-sm text-destructive">{message}</p> : null;
}

function SectionTitle({ id, children, required = false }: { id: string; children: React.ReactNode; required?: boolean }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
      <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">{children}</h3>
    </div>
    {required && <span className="text-xs text-muted-foreground"><span className="text-destructive">*</span> Obligatorio</span>}
  </div>;
}

export function CreateUserDialog({ open, onOpenChange, catalog, form, confirm, errors, validationFocus,
  formError, saving, onFieldChange, onDocumentBlur, onConfirmChange, onSubmit }: CreateUserDialogProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ field: "password" | "confirm"; start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const pending = selection.current;
    selection.current = null;
    if (!pending) return;
    const input = pending.field === "password" ? passwordRef.current : confirmRef.current;
    if (input === document.activeElement) input.setSelectionRange(pending.start, pending.end);
  });
  const toggleVisibility = (field: "password" | "confirm") => {
    const input = field === "password" ? passwordRef.current : confirmRef.current;
    if (input === document.activeElement) {
      selection.current = { field, start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
    }
    if (field === "password") setShowPassword((value) => !value);
    else setShowConfirm((value) => !value);
  };
  const hasDni = catalog.document_types.some((item) => item.codigo === "DNI");
  const documentCode = catalog.document_types.find((item) => item.id === form.tipo_doc_id)?.codigo ?? "";
  const passwordMatch = form.password && confirm ? form.password === confirm : null;
  useEffect(() => {
    if (!open) { setShowPassword(false); setShowConfirm(false); }
  }, [open]);
  const errorFor = (field: UserField) => errors[field];
  const inputState = (field: UserField) => ({
    "aria-invalid": !!errorFor(field) as boolean,
    "aria-describedby": errorFor(field) ? `user-${field}-error` : undefined,
  });

  useEffect(() => {
    const body = document.getElementById("create-user-body");
    if (!open || !validationFocus || !body) return;
    const field = document.getElementById(`user-${validationFocus.field}`);
    if (!field || !body.contains(field)) return;
    field.focus({ preventScroll: true });
    const target = field.closest<HTMLElement>("[data-user-field]") ?? field;
    const viewport = body.getBoundingClientRect();
    const area = target.getBoundingClientRect();
    const margin = 12;
    if (body.scrollHeight <= body.clientHeight ||
        (area.top >= viewport.top + margin && area.bottom <= viewport.bottom - margin)) return;
    const delta = area.height <= viewport.height - 2 * margin
      ? area.top + area.height / 2 - (viewport.top + viewport.height / 2)
      : area.top - (viewport.top + margin);
    const next = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + delta));
    if (Math.abs(next - body.scrollTop) > 1) body.scrollTo({ top: next,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [open, validationFocus]);

  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
    <AppModalContent className="sm:max-w-[680px]" onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}>
      <AppModalHeader icon={<UserPlus className="h-6 w-6" />} title="Registrar Nuevo Usuario"
        subtitle="Complete los datos de la cuenta" />
      <AppModalBody id="create-user-body" className="bg-muted/65 py-4 dark:bg-muted/40">
        {formError && <p role="alert" className="mb-3 text-sm text-destructive">{formError}</p>}
        <form id="create-user-form" onSubmit={onSubmit} noValidate className="space-y-3">
          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="user-identification-title">
            <SectionTitle id="user-identification-title" required>Identificación</SectionTitle>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {(["nombres", "apellidos"] as const).map((field) => <div data-user-field key={field} className="space-y-1">
                <FieldLabel htmlFor={`user-${field}`} required>{field === "nombres" ? "Nombres" : "Apellidos"}</FieldLabel>
                <PersonNameInput id={`user-${field}`} value={form[field]} disabled={saving}
                  autoComplete={field === "nombres" ? "given-name" : "family-name"}
                  maxLength={field === "nombres" ? 80 : 100} className={inputClass}
                  onValueChange={(value) => onFieldChange(field, value)}
                  onBlur={() => onFieldChange(field, normalizePersonName(form[field]))} {...inputState(field)} />
                <FieldError field={field} message={errorFor(field)} />
              </div>)}
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-tipo_doc_id" required>Tipo de documento</FieldLabel>
                <select id="user-tipo_doc_id" value={form.tipo_doc_id || ""} required disabled={saving || !hasDni}
                  onChange={(event) => onFieldChange("tipo_doc_id", Number(event.target.value))}
                  className={selectClass} {...inputState("tipo_doc_id")}>
                  {!hasDni ? <option value="">DNI no disponible</option> :
                    catalog.document_types.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                </select>
                <FieldError field="tipo_doc_id" message={errorFor("tipo_doc_id")} />
              </div>
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-nro_documento" required>Número de documento</FieldLabel>
                 <Input id="user-nro_documento" type="text" required maxLength={DOC_RULES[documentCode]?.maxLength}
                   inputMode={documentCode === "DNI" ? "numeric" : "text"} disabled={saving || !DOC_RULES[documentCode]}
                    placeholder={documentCode === "DNI" ? "8 dígitos" : documentCode === "CE" ? "8 a 12 caracteres" :
                      documentCode === "PAS" ? "3 a 9 caracteres" : "DNI no disponible"}
                   value={form.nro_documento} onChange={(event) => {
                     const rule = DOC_RULES[documentCode];
                     if (rule) onFieldChange("nro_documento", normalizeDocument(event.target.value, documentCode).slice(0, rule.maxLength));
                   }}
                   onPaste={(event) => {
                     event.preventDefault();
                     const rule = DOC_RULES[documentCode];
                     if (!rule) return;
                     const input = event.currentTarget;
                    const start = input.selectionStart ?? form.nro_documento.length;
                    const end = input.selectionEnd ?? start;
                    const combined = form.nro_documento.slice(0, start) + event.clipboardData.getData("text") + form.nro_documento.slice(end);
                     onFieldChange("nro_documento", normalizeDocument(combined, documentCode).slice(0, rule.maxLength));
                  }}
                  onBlur={onDocumentBlur}
                  autoComplete="off" className={inputClass} {...inputState("nro_documento")} />
                <FieldError field="nro_documento" message={errorFor("nro_documento")} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="user-account-title">
            <SectionTitle id="user-account-title" required>Datos de la cuenta</SectionTitle>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-username" required>Nombre de usuario</FieldLabel>
                <Input id="user-username" required maxLength={50} disabled={saving} autoComplete="username"
                  value={form.username} onChange={(event) => onFieldChange("username", event.target.value)}
                  className={inputClass} {...inputState("username")} />
                <FieldError field="username" message={errorFor("username")} />
              </div>
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-correo" required>Correo electrónico</FieldLabel>
                <Input id="user-correo" type="email" required maxLength={150} disabled={saving} autoComplete="email"
                  value={form.correo} onChange={(event) => onFieldChange("correo", event.target.value)}
                  className={inputClass} {...inputState("correo")} />
                <FieldError field="correo" message={errorFor("correo")} />
              </div>
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-password" required>Contraseña</FieldLabel>
                <div className="relative">
                  <Input ref={passwordRef} id="user-password" type={showPassword ? "text" : "password"} required minLength={10} maxLength={128} disabled={saving}
                    autoComplete="new-password" value={form.password}
                    onChange={(event) => onFieldChange("password", event.target.value)}
                    className={cn(inputClass, "pr-11")} {...inputState("password")} />
                  <button type="button" disabled={saving} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-controls="user-password" aria-pressed={showPassword} onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleVisibility("password")}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
                <FieldError field="password" message={errorFor("password")} />
              </div>
              <div data-user-field className="space-y-1">
                <FieldLabel htmlFor="user-confirm" required>Confirmar contraseña</FieldLabel>
                <div className="relative">
                  <Input ref={confirmRef} id="user-confirm" type={showConfirm ? "text" : "password"} required disabled={saving} autoComplete="new-password"
                    value={confirm} onChange={(event) => onConfirmChange(event.target.value)}
                    className={cn(inputClass, "pr-11")} {...inputState("confirm")} />
                  <button type="button" disabled={saving} aria-label={showConfirm ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-controls="user-confirm" aria-pressed={showConfirm} onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleVisibility("confirm")}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    {showConfirm ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
                {passwordMatch !== false && <FieldError field="confirm" message={errorFor("confirm")} />}
              </div>
              <div className="flex min-h-4 justify-end sm:col-span-2">
                {passwordMatch !== null && <p id="user-confirm-error" role="status"
                  className={cn("flex items-center gap-1.5 text-right text-xs", passwordMatch ? "text-green-700 dark:text-green-400" : "text-destructive")}>
                  {passwordMatch ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <XCircle aria-hidden="true" className="h-4 w-4" />}
                  {passwordMatch ? "Las contraseñas coinciden" : "Las contraseñas no coinciden"}
                </p>}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="user-professional-title">
            <SectionTitle id="user-professional-title" required>Información profesional</SectionTitle>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div data-user-field className="space-y-1 sm:col-span-2">
                <FieldLabel htmlFor="user-cargo_id" required>Cargo</FieldLabel>
                <select id="user-cargo_id" value={form.cargo_id || ""} required disabled={saving}
                  onChange={(event) => onFieldChange("cargo_id", Number(event.target.value))}
                  className={selectClass} {...inputState("cargo_id")}>
                  <option value="">Seleccione</option>
                  {catalog.positions.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                </select>
                <FieldError field="cargo_id" message={errorFor("cargo_id")} />
              </div>
              {(["cmp", "rne"] as const).map((field) => <div data-user-field key={field} className="space-y-1">
                <FieldLabel htmlFor={`user-${field}`}>{field.toUpperCase()} (opcional)</FieldLabel>
                <Input id={`user-${field}`} value={form[field] ?? ""} maxLength={20} disabled={saving} inputMode="numeric"
                  onChange={(event) => onFieldChange(field, event.target.value.replace(/\D/g, "") || null)}
                  className={inputClass} {...inputState(field)} />
                <FieldError field={field} message={errorFor(field)} />
              </div>)}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="user-roles-title">
            <SectionTitle id="user-roles-title" required>Roles iniciales</SectionTitle>
            <div id="user-role_ids" role="group" aria-labelledby="user-roles-title" data-user-field tabIndex={-1}
              aria-invalid={!!errorFor("role_ids")}
              aria-describedby={errorFor("role_ids") ? "user-role_ids-error" : undefined}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {catalog.roles.filter((role) => role.estado === "ACTIVO").map((role) =>
                  <label key={role.id} htmlFor={`user-role-${role.id}`} className={cn(
                    "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                    "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring",
                    form.role_ids.includes(role.id) ? "border-primary/40 bg-primary/[0.09]" : "border-border hover:bg-muted/40",
                    saving && "cursor-not-allowed opacity-60",
                  )}>
                    <Checkbox id={`user-role-${role.id}`} checked={form.role_ids.includes(role.id)} disabled={saving}
                      onCheckedChange={() => onFieldChange("role_ids", form.role_ids.includes(role.id)
                        ? form.role_ids.filter((id) => id !== role.id) : [...form.role_ids, role.id])} />
                    <span>{role.nombre}</span>
                  </label>)}
              </div>
              <FieldError field="role_ids" message={errorFor("role_ids")} />
            </div>
          </section>
        </form>
      </AppModalBody>
      <AppModalFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button type="submit" form="create-user-form" disabled={saving || !hasDni} className="bg-primary hover:bg-primary/90">
          {saving ? "Registrando..." : "Registrar Usuario"}
        </Button>
      </AppModalFooter>
    </AppModalContent>
  </Dialog>;
}
