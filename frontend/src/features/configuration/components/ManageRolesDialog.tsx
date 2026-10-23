import { ShieldCheck } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { AdminCatalog } from "../api/configurationService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: AdminCatalog;
  roles: number[];
  error: string;
  saving: boolean;
  dirty: boolean;
  onToggle: (id: number) => void;
  onSave: () => void;
}

export function ManageRolesDialog({ open, onOpenChange, catalog, roles, error, saving, dirty, onToggle, onSave }: Props) {
  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
    <AppModalContent className="sm:max-w-[520px]" onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}>
      <AppModalHeader icon={<ShieldCheck className="h-6 w-6" />} title="Gestionar roles"
        subtitle="Seleccione los roles vigentes del usuario" />
      <AppModalBody className="bg-muted/65 py-4 dark:bg-muted/40">
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="manage-roles-title">
          <div className="mb-3 flex items-center gap-2.5"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
            <h3 id="manage-roles-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary dark:text-foreground">Roles asignados</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {catalog.roles.filter((role) => role.estado === "ACTIVO").map((role) =>
              <label key={role.id} htmlFor={`manage-role-${role.id}`} className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring",
                roles.includes(role.id) ? "border-primary/40 bg-primary/[0.09]" : "border-border hover:bg-muted/40",
                saving && "cursor-not-allowed opacity-60",
              )}>
                <Checkbox id={`manage-role-${role.id}`} checked={roles.includes(role.id)} disabled={saving}
                  onCheckedChange={() => onToggle(role.id)} />
                <span>{role.nombre}</span>
              </label>)}
          </div>
        </section>
      </AppModalBody>
      <AppModalFooter>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button disabled={saving || !dirty || !roles.length} onClick={onSave} className="bg-primary hover:bg-primary/90">
          {saving ? "Guardando..." : "Guardar roles"}
        </Button>
      </AppModalFooter>
    </AppModalContent>
  </Dialog>;
}
