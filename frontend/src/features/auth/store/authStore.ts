import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModuleName } from "../moduleAccess";

export interface User {
  id: number;
  username: string;
  nombres: string;
  apellidos: string;
  cargo?: string | null;
  roles: string[];
  permisos?: string[];
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  deniedModules: ModuleName[];

  // Acciones
  login: (token: string, user: User) => void;
  logout: () => void;
  denyModule: (module: ModuleName) => void;
  hasRole: (roles: string[]) => boolean;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      deniedModules: [],

      login: (token, user) => {
        set({ token, user, isAuthenticated: true, deniedModules: [] });
      },

      logout: () => {
        set({ token: null, user: null, isAuthenticated: false, deniedModules: [] });
      },

      denyModule: (module) => set((state) => ({
        deniedModules: state.deniedModules.includes(module) ? state.deniedModules : [...state.deniedModules, module],
      })),

      // Verifica si el usuario tiene alguno de los roles indicados
      // Uso: hasRole(["Admin", "Gerente General"])
      hasRole: (roles) => {
        const userRoles = get().user?.roles ?? [];
        return roles.some((r) => userRoles.includes(r));
      },

      hasPermission: (permission) => {
        const permissions = get().user?.permisos ?? [];
        return permissions.includes(permission);
      },
    }),
    {
      name: "auth-storage", // clave en localStorage
      // Solo persistimos token y user, no las funciones
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
