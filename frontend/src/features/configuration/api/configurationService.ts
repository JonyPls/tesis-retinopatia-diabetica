import api from "@/lib/api";

export interface AdminUser {
  id: number;
  nombres: string;
  apellidos: string;
  username: string;
  correo: string;
  tipo_doc_id: number;
  nro_documento: string;
  cargo_id: number;
  cargo: string | null;
  cmp: string | null;
  rne: string | null;
  estado: "ACTIVO" | "INACTIVO";
  role_ids: number[];
}

export interface AdminCatalog {
  roles: { id: number; nombre: string; codigo: string; descripcion: string | null;
    estado: string; permission_ids: number[] }[];
  permissions: { id: number; codigo: string; nombre: string; descripcion: string | null;
    modulo: string; estado: string }[];
  document_types: { id: number; nombre: string; codigo: string }[];
  positions: { id: number; nombre: string }[];
}

export interface AdminCapabilities {
  read: boolean;
  create: boolean;
  edit: boolean;
  assign_roles: boolean;
}

export interface AdminForm {
  nombres: string;
  apellidos: string;
  username: string;
  correo: string;
  tipo_doc_id: number;
  nro_documento: string;
  cargo_id: number;
  cmp: string | null;
  rne: string | null;
  password: string;
  role_ids: number[];
}

export class CatalogFormatError extends Error {}

export const getCatalog = async () => {
  const { data } = await api.get("/configuracion/catalogo");
  const types = data?.data?.document_types;
  if (!Array.isArray(types) || types.length === 0 || types.some((item) =>
    typeof item?.id !== "number" || typeof item?.codigo !== "string" || !item.codigo.trim())) {
    throw new CatalogFormatError("El catálogo de tipos de documento no está disponible o está desactualizado. Reintente cargar la configuración.");
  }
  return data as { data: AdminCatalog; capabilities: AdminCapabilities; permissions_editable: boolean };
};

export const getRolePermissions = async (roleId: number) => {
  const { data } = await api.get(`/configuracion/roles/${roleId}/permisos`);
  return data.data as { id: number; nombre: string; permission_ids: number[] };
};

export const updatePermissions = (roleId: number, permission_ids: number[]) =>
  api.put(`/configuracion/roles/${roleId}/permisos`, { permission_ids });

export const getUsers = async () => {
  const { data } = await api.get("/configuracion/usuarios");
  return data.data as AdminUser[];
};

export const createUser = (form: AdminForm) => api.post("/configuracion/usuarios", form);
export const editUser = (id: number, changes: Partial<AdminUser>) =>
  api.patch(`/configuracion/usuarios/${id}`, changes);
export const updateState = (id: number, estado: AdminUser["estado"]) =>
  api.put(`/configuracion/usuarios/${id}/estado`, { estado });
export const updateRoles = (id: number, role_ids: number[]) =>
  api.put(`/configuracion/usuarios/${id}/roles`, { role_ids });
