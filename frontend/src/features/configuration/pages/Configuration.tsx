import { useCallback, useEffect, useMemo, useState } from "react";
import { AxiosError } from "axios";
import { PageContent } from "@/components/layout/PageContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { useAuthStore } from "@/features/auth/store/authStore";
import { normalizePersonName } from "@/lib/fieldValidation";
import { DOC_RULES, normalizeDocument } from "@/lib/documentValidation";
import { CreateUserDialog } from "../components/CreateUserDialog";
import { EditUserDialog } from "../components/EditUserDialog";
import { ManageRolesDialog } from "../components/ManageRolesDialog";
import { knownUserDuplicates, USER_FIELD_ORDER, validateUserDetails, validateUserRegistration, type UserErrors, type UserField } from "../userRegistration";
import {
  AdminCatalog, AdminCapabilities, AdminForm, AdminUser, createUser, editUser, getCatalog,
  getRolePermissions, getUsers, updatePermissions, updateRoles, updateState, CatalogFormatError,
} from "../api/configurationService";

const emptyForm: AdminForm = {
  nombres: "", apellidos: "", username: "", correo: "", tipo_doc_id: 0,
  nro_documento: "", cargo_id: 0, cmp: null, rne: null, password: "", role_ids: [],
};

function errorMessage(error: unknown) {
  if (error instanceof CatalogFormatError) return error.message;
  const response = (error as AxiosError<{ message?: string }>).response;
  if (response?.status === 403) return "Acceso restringido. No tiene autorización para esta acción.";
  return response?.data?.message || "No se pudo completar la operación. Intente nuevamente.";
}

export default function Configuration() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | "roles" | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<AdminForm>(emptyForm);
  const [confirm, setConfirm] = useState("");
  const [draftRoles, setDraftRoles] = useState<number[]>([]);
  const [selectedRole, setSelectedRole] = useState<number | null>(null);
  const [permissionsEditable, setPermissionsEditable] = useState(false);
  const [draftPermissions, setDraftPermissions] = useState<number[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [roleRefresh, setRoleRefresh] = useState(0);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formErrors, setFormErrors] = useState<UserErrors>({});
  const [validationFocus, setValidationFocus] = useState<{ field: UserField; attempt: number } | null>(null);

  const refreshUsers = useCallback(async () => {
    try {
      const rows = await getUsers();
      setUsers(rows);
      setUsersError("");
    } catch (err) {
      setUsersError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await getCatalog();
        if (!active) return;
        setCatalog(result.data);
        setCapabilities(result.capabilities);
        setPermissionsEditable(result.permissions_editable);
        setSelectedRole(result.data.roles[0]?.id ?? null);
        if (result.capabilities.read) {
          try {
            const rows = await getUsers();
            if (active) setUsers(rows);
          } catch (err) {
            if (active) setUsersError(errorMessage(err));
          }
        }
      } catch (err) {
        if (active) {
          setCatalog(null);
          setRestricted((err as AxiosError).response?.status === 403);
          setError(errorMessage(err));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [catalogRetry]);

  useEffect(() => {
    if (selectedRole === null) return;
    let active = true;
    setRoleLoading(true);
    setRoleError("");
    getRolePermissions(selectedRole).then((role) => {
      if (!active) return;
      setCatalog((previous) => previous && ({ ...previous, roles: previous.roles.map((entry) =>
        entry.id === role.id ? { ...entry, permission_ids: role.permission_ids } : entry) }));
      setDraftPermissions(role.permission_ids);
    }).catch((err) => {
      if (active) setRoleError(errorMessage(err));
    }).finally(() => { if (active) setRoleLoading(false); });
    return () => { active = false; };
  }, [selectedRole, roleRefresh]);

  const filtered = useMemo(() => users.filter((user) =>
    `${user.nombres} ${user.apellidos} ${user.username}`.toLowerCase().includes(query.toLowerCase().trim()),
  ), [users, query]);
  const currentRole = catalog?.roles.find((role) => role.id === selectedRole);
  const permissionsDirty = !!currentRole &&
    (draftPermissions.length !== currentRole.permission_ids.length ||
      draftPermissions.some((id) => !currentRole.permission_ids.includes(id)));
  const groups = useMemo(() => {
    const permissions = catalog?.permissions ?? [];
    return Object.entries(permissions.reduce<Record<string, typeof permissions>>((all, p) => {
        (all[p.modulo] ??= []).push(p);
        return all;
      }, {}));
  }, [catalog]);

  function openCreate() {
    const dni = catalog?.document_types.find((item) => item.codigo === "DNI");
    setSelected(null);
    setForm({ ...emptyForm, tipo_doc_id: dni?.id ?? 0 });
    setConfirm("");
    setFormError(dni ? "" : "El tipo de documento DNI no está disponible. No se puede registrar un usuario.");
    setFormErrors({});
    setValidationFocus(null);
    setDialog("create");
  }

  function openEdit(user: AdminUser) {
    setSelected(user);
    setForm({ ...user, cmp: user.cmp, rne: user.rne, password: "" });
    setFormError("");
    setFormErrors({});
    setValidationFocus(null);
    setDialog("edit");
  }

  function openRoles(user: AdminUser) {
    setSelected(user);
    setDraftRoles([...user.role_ids]);
    setFormError("");
    setDialog("roles");
  }

  function toggleRole(id: number, roles: number[], setRoles: (next: number[]) => void) {
    setRoles(roles.includes(id) ? roles.filter((item) => item !== id) : [...roles, id]);
  }

  function selectRole(id: number) {
    if (id === selectedRole || rolesSaving) return;
    if (permissionsDirty && !window.confirm("Hay cambios sin guardar. ¿Descartarlos y cambiar de rol?")) return;
    setNotice("");
    setSelectedRole(id);
  }

  async function savePermissions() {
    if (!selectedRole || !permissionsEditable || !permissionsDirty || rolesSaving || roleLoading || roleError) return;
    setRolesSaving(true);
    setRoleError("");
    setNotice("");
    let persisted = false;
    try {
      await updatePermissions(selectedRole, draftPermissions);
      persisted = true;
      const saved = await getRolePermissions(selectedRole);
      setCatalog((previous) => previous && ({ ...previous, roles: previous.roles.map((entry) =>
        entry.id === saved.id ? { ...entry, permission_ids: saved.permission_ids } : entry) }));
      setDraftPermissions(saved.permission_ids);
      setNotice("Permisos actualizados.");
    } catch (err) {
      setRoleError(persisted ? "Los cambios se guardaron, pero no se pudo verificar la matriz. Vuelva a cargarla." : errorMessage(err));
      if ((err as AxiosError).response?.status === 403) setPermissionsEditable(false);
    } finally {
      setRolesSaving(false);
    }
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if ((dialog === "create" || dialog === "edit") && catalog) {
      const errors = dialog === "create" ? validateUserRegistration(form, confirm, catalog, users)
        : validateUserDetails(form, catalog, users, selected?.id);
      if (Object.keys(errors).length) {
        setFormErrors(errors);
        setFormError("");
        setValidationFocus((previous) => ({ field: USER_FIELD_ORDER.find((field) => !!errors[field]) ?? "nombres",
          attempt: (previous?.attempt ?? 0) + 1 }));
        return;
      }
    }
    setSaving(true);
    setFormError("");
    setFormErrors({});
    try {
      if (dialog === "create") {
        await createUser({ ...form, nombres: normalizePersonName(form.nombres), apellidos: normalizePersonName(form.apellidos),
          username: form.username.trim(), correo: form.correo.trim(), nro_documento: form.nro_documento.trim(),
          cmp: form.cmp?.trim() || null, rne: form.rne?.trim() || null });
      } else if (selected) {
        const { nombres, apellidos, username, correo, tipo_doc_id, nro_documento, cargo_id, cmp, rne } = form;
        await editUser(selected.id, { nombres: normalizePersonName(nombres), apellidos: normalizePersonName(apellidos),
          username: username.trim(), correo: correo.trim(), tipo_doc_id,
          nro_documento: nro_documento.trim(), cargo_id, cmp: cmp?.trim() || null, rne: rne?.trim() || null });
      }
      await refreshUsers();
      setDialog(null);
      setNotice(dialog === "create" ? "Usuario registrado." : "Usuario actualizado.");
    } catch (err) {
      const response = (err as AxiosError<{ message?: string }>).response;
      if ((dialog === "create" || dialog === "edit") && (response?.status === 400 || response?.status === 409)) {
        const fieldErrors = response.status === 409 ? knownUserDuplicates(form, users, dialog === "edit" ? selected?.id : undefined) : {} as UserErrors;
        const message = response.data?.message ?? "";
        const explicitField = /^(nombres|apellidos|username|correo|nro_documento|cmp|rne):/i.exec(message)?.[1]?.toLowerCase() as UserField | undefined;
        if (explicitField) fieldErrors[explicitField] = message;
        else if (/identificador de acceso|username|nombre de usuario/i.test(message)) fieldErrors.username =
          response.status === 409 ? "El nombre de usuario ya está registrado." : message;
        else if (/correo/i.test(message)) fieldErrors.correo = response.status === 409 ? "El correo ya está registrado." : message;
        else if (/\bCMP\b/i.test(message)) fieldErrors.cmp = response.status === 409 ? "El CMP ya está registrado." : message;
        else if (/\bRNE\b/i.test(message)) fieldErrors.rne = response.status === 409 ? "El RNE ya está registrado." : message;
        else if (dialog === "create" && /contraseña/i.test(message)) fieldErrors.password = message;
        if (Object.keys(fieldErrors).length) {
          setFormErrors(fieldErrors);
          setValidationFocus((previous) => ({ field: USER_FIELD_ORDER.find((field) => !!fieldErrors[field]) ?? "username",
            attempt: (previous?.attempt ?? 0) + 1 }));
          setFormError("");
        } else setFormError(errorMessage(err));
      } else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function changeCreateField(field: keyof AdminForm, value: AdminForm[keyof AdminForm]) {
    const code = field === "tipo_doc_id" ? catalog?.document_types.find((item) => item.id === value)?.codigo : undefined;
    const normalized = code && DOC_RULES[code] ? normalizeDocument(form.nro_documento, code) : form.nro_documento;
    // No perder caracteres de un documento anterior: si no se puede adaptar sin pérdida, mostrar el error.
    const next = { ...form, [field]: value,
      ...(field === "tipo_doc_id" && normalized.length === form.nro_documento.length ? { nro_documento: normalized } : {}),
    } as AdminForm;
    setForm(next);
    setFormError("");
    if (catalog) {
      const validated = validateUserRegistration(next, confirm, catalog, users);
      setFormErrors((previous) => ({ ...previous,
        ...(previous[field] ? { [field]: validated[field] } : {}),
        ...(field === "tipo_doc_id" ? { nro_documento: next.nro_documento ? validated.nro_documento : undefined } : {}),
        ...(field === "password" && previous.confirm ? { confirm: validated.confirm } : {}),
      }));
    }
  }

  function changeEditField(field: keyof AdminForm, value: AdminForm[keyof AdminForm]) {
    const code = field === "tipo_doc_id" ? catalog?.document_types.find((item) => item.id === value)?.codigo : undefined;
    const normalized = code && DOC_RULES[code] ? normalizeDocument(form.nro_documento, code) : form.nro_documento;
    const next = { ...form, [field]: value,
      ...(field === "tipo_doc_id" && normalized.length === form.nro_documento.length ? { nro_documento: normalized } : {}),
    } as AdminForm;
    setForm(next);
    setFormError("");
    if (catalog) {
      const validated = validateUserDetails(next, catalog, users, selected?.id);
      setFormErrors((previous) => ({ ...previous,
        ...(previous[field] ? { [field]: validated[field] } : {}),
        ...(field === "tipo_doc_id" ? { nro_documento: validated.nro_documento } : {}),
      }));
    }
  }

  function changeCreateConfirm(value: string) {
    setConfirm(value);
    setFormError("");
    if (formErrors.confirm && catalog) {
      setFormErrors((previous) => ({ ...previous,
        confirm: validateUserRegistration(form, value, catalog, users).confirm }));
    }
  }

  function validateDocumentOnBlur() {
    if (!catalog || !form.nro_documento) return;
    setFormErrors((previous) => ({ ...previous,
      nro_documento: validateUserRegistration(form, confirm, catalog, users).nro_documento }));
  }

  async function saveRoles() {
    if (!selected || !capabilities?.assign_roles || currentUserId === selected.id || saving) return;
    const activeIds = catalog?.roles.filter((role) => role.estado === "ACTIVO").map((role) => role.id) ?? [];
    if (!draftRoles.length || new Set(draftRoles).size !== draftRoles.length ||
        draftRoles.some((id) => !activeIds.includes(id))) {
      setFormError("Seleccione al menos un rol activo.");
      return;
    }
    if (!window.confirm("¿Confirmar los cambios de roles de este usuario?")) return;
    setSaving(true);
    setFormError("");
    try {
      await updateRoles(selected.id, draftRoles);
      await refreshUsers();
      setDialog(null);
      setNotice("Roles actualizados.");
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeState(user: AdminUser) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await updateState(user.id, user.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO");
      await refreshUsers();
      setNotice("Estado actualizado.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContent title="Configuración" subtitle="Administración de usuarios, roles y permisos">
      {loading ? <p role="status" className="text-sm text-muted-foreground">Cargando configuración...</p> :
        restricted ? <p role="alert" className="text-sm text-muted-foreground">Acceso restringido.</p> :
          !catalog ? <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            <p role="alert">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setError("");
              setLoading(true);
              setCatalogRetry((previous) => previous + 1);
            }}>Reintentar</Button>
          </div> : (
            <Tabs defaultValue="users" className="space-y-5">
              <TabsList><TabsTrigger value="users">Usuarios</TabsTrigger><TabsTrigger value="roles">Roles y permisos</TabsTrigger></TabsList>
              {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <TabsContent value="users" className="space-y-4">
                {!capabilities?.read ? <p className="text-sm text-muted-foreground">No tiene acceso al listado de usuarios.</p> : <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="relative w-full max-w-sm">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input aria-label="Buscar usuarios" placeholder="Buscar por nombre o usuario" value={query}
                        onChange={(event) => setQuery(event.target.value)} className="pl-9" />
                    </div>
                    {capabilities.create && capabilities.assign_roles && <Button onClick={openCreate}>Nuevo usuario</Button>}
                  </div>
                  {usersError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
                    <span>{usersError}</span><Button variant="outline" size="sm" onClick={() => void refreshUsers()}>Reintentar</Button>
                  </div> : <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full min-w-[650px] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-muted-foreground"><tr>
                        <th className="p-3 font-medium">Nombre completo</th><th className="p-3 font-medium">Usuario</th>
                        <th className="p-3 font-medium">Roles</th><th className="p-3 font-medium">Estado</th>
                        <th className="p-3 font-medium">Acciones</th>
                      </tr></thead>
                      <tbody>{filtered.map((user) => <tr key={user.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{user.nombres} {user.apellidos}</td>
                        <td className="p-3">{user.username}</td>
                        <td className="p-3">{catalog.roles.filter((role) => user.role_ids.includes(role.id)).map((role) => role.nombre).join(", ") || "Sin rol"}</td>
                        <td className="p-3">{user.estado === "ACTIVO" ? "Activo" : "Inactivo"}</td>
                        <td className="p-3"><div className="flex flex-wrap gap-1">
                          {capabilities.edit && <><Button size="sm" variant="ghost" onClick={() => openEdit(user)}>Editar</Button>
                            {currentUserId !== user.id && <Button size="sm" variant="ghost" disabled={saving} onClick={() => changeState(user)}>
                              {user.estado === "ACTIVO" ? "Desactivar" : "Activar"}</Button>}</>}
                          {capabilities.assign_roles && currentUserId !== user.id && <Button size="sm" variant="ghost" onClick={() => openRoles(user)}>Gestionar roles</Button>}
                        </div></td>
                      </tr>)}</tbody>
                    </table>
                    {!filtered.length && <p className="p-5 text-sm text-muted-foreground">No se encontraron usuarios.</p>}
                  </div>
                  }
                </>}
              </TabsContent>
              <TabsContent value="roles" className="space-y-4">
                {!permissionsEditable && <p className="text-sm text-muted-foreground">Permisos en modo de consulta. No tiene autorización para modificarlos.</p>}
                <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                  <nav aria-label="Roles" className="flex gap-2 overflow-x-auto md:flex-col">
                    {catalog.roles.map((role) => <Button key={role.id} variant={selectedRole === role.id ? "secondary" : "ghost"}
                      className="shrink-0 justify-start" onClick={() => selectRole(role.id)}>{role.nombre}</Button>)}
                  </nav>
                  <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="font-semibold">{currentRole?.nombre ?? "Seleccione un rol"}</h3>
                    {currentRole?.descripcion && <p className="mt-1 text-sm text-muted-foreground">{currentRole.descripcion}</p>}
                    {roleLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">Cargando permisos...</p>}
                    {roleError && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
                      {roleError}<Button variant="outline" size="sm" onClick={() => setRoleRefresh((value) => value + 1)}>Reintentar</Button>
                    </div>}
                    {permissionsEditable && permissionsDirty && !roleError && <p className="mt-3 text-sm text-muted-foreground">Cambios sin guardar.</p>}
                    {groups.map(([module, permissions]) => <section key={module} className="mt-5">
                      <h4 className="mb-2 text-sm font-medium capitalize">{module.replace(/_/g, " ")}</h4>
                      <div className="grid gap-2 sm:grid-cols-2">{permissions.map((permission) => <label key={permission.id}
                        className="flex items-start gap-2 text-sm text-muted-foreground">
                        <input type="checkbox" checked={(roleLoading || !!roleError ? currentRole?.permission_ids : draftPermissions)?.includes(permission.id) ?? false}
                          disabled={!permissionsEditable || roleLoading || rolesSaving || !!roleError || currentRole?.estado !== "ACTIVO" || permission.estado !== "ACTIVO" ||
                            (permission.codigo === "roles.asignar_permisos") ||
                            (currentRole?.codigo === "ADMINISTRADOR_SISTEMA" && permission.codigo === "configuracion.ver")}
                          onChange={() => setDraftPermissions((ids) => ids.includes(permission.id)
                            ? ids.filter((id) => id !== permission.id) : [...ids, permission.id])}
                          className="mt-1 accent-primary" />{permission.nombre}{permission.estado !== "ACTIVO" && " (inactivo)"}
                      </label>)}</div>
                    </section>)}
                    {permissionsEditable && <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
                      <Button variant="outline" disabled={!permissionsDirty || rolesSaving || roleLoading || !!roleError}
                        onClick={() => setDraftPermissions(currentRole?.permission_ids ?? [])}>Cancelar</Button>
                      <Button disabled={!permissionsDirty || rolesSaving || roleLoading || !!roleError}
                        onClick={savePermissions}>{rolesSaving ? "Guardando..." : "Guardar cambios"}</Button>
                    </div>}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}

      {catalog && <CreateUserDialog open={dialog === "create"} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}
        catalog={catalog} form={form} confirm={confirm} errors={formErrors} validationFocus={validationFocus}
        formError={formError} saving={saving} onFieldChange={changeCreateField} onDocumentBlur={validateDocumentOnBlur}
        onConfirmChange={changeCreateConfirm}
        onSubmit={submitForm} />}
      {catalog && <EditUserDialog open={dialog === "edit"} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}
        catalog={catalog} form={form} errors={formErrors} validationFocus={validationFocus} formError={formError}
        saving={saving} onFieldChange={changeEditField} onDocumentBlur={() => {
          if (catalog && form.nro_documento) setFormErrors((previous) => ({ ...previous,
            nro_documento: validateUserDetails(form, catalog, users, selected?.id).nro_documento }));
        }} onSubmit={submitForm} />}
      {catalog && <ManageRolesDialog open={dialog === "roles"} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}
        catalog={catalog} roles={draftRoles} error={formError} saving={saving}
        dirty={!!selected && (selected.role_ids.length !== draftRoles.length ||
          selected.role_ids.some((id) => !draftRoles.includes(id)))}
        onToggle={(id) => { toggleRole(id, draftRoles, setDraftRoles); setFormError(""); }} onSave={saveRoles} />}
    </PageContent>
  );
}
