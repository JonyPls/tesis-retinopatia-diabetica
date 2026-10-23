import logoClinica from "@/assets/logo.png";
import { cn } from "@/lib/utils";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Brain,
  FileText,
  Settings,
  LogOut,
  Activity,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuthStore } from "@/features/auth/store/authStore";
import { canAccessModule, type ModuleName } from "@/features/auth/moduleAccess";

const mainItems: { title: string; url: string; icon: typeof Users; module: ModuleName; end?: boolean }[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, end: true, module: "dashboard" },
  { title: "Pacientes", url: "/pacientes", icon: Users, module: "patients" },
  { title: "Diagnóstico IA", url: "/diagnostico", icon: Brain, module: "diagnosis" },
  { title: "Informes", url: "/informes", icon: FileText, module: "reports" },
];

const adminItems = [
  { title: "Configuración", url: "/configuracion", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  // Leer del store en lugar de localStorage directamente
  const { user, logout, deniedModules } = useAuthStore();
  const showAdminItems = canAccessModule(user, "configuration", deniedModules);

  // Nombre e iniciales
  const firstName = user?.nombres?.split(" ")[0] ?? "";
  const firstLastName = user?.apellidos?.split(" ")[0] ?? "";
  const displayName = `${firstName} ${firstLastName}`.trim() || "Usuario";
  const initials =
    `${firstName.charAt(0)}${firstLastName.charAt(0)}`.toUpperCase() || "US";

  const handleLogout = () => {
    logout(); // limpia el store y localStorage en un solo paso
    navigate("/");
  };

  const isActive = (path: string, end?: boolean) =>
    end ? location.pathname === path : location.pathname.startsWith(path);

  const navCls = (active: boolean) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium border-l-2 border-sidebar-primary"
        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
    }`;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border bg-sidebar">
        <div
          className={cn(
            "flex py-3 transition-all",
            collapsed
              ? "flex-col items-center justify-center gap-2 px-0"
              : "items-center gap-3 px-2",
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md overflow-hidden bg-transparent">
            <img
              src={logoClinica}
              alt="Logo Centro Oftalmológico del Norte"
              className="h-full w-full object-contain"
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-sidebar-accent-foreground whitespace-nowrap">
                Sistema Clínico
              </span>
              <span className="text-xs text-sidebar-foreground/90 whitespace-nowrap">
                Centro Oftalmológico del Norte
              </span>
            </div>
          )}
          <SidebarTrigger
            className={cn(
              "hidden h-8 w-8 shrink-0 rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-accent-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:inline-flex",
              !collapsed && "ml-auto",
            )}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar">
        {/* Items principales — todos los roles */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-[11px] uppercase tracking-wider">
              Principal
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.filter((item) => canAccessModule(user, item.module, deniedModules)).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="hover:bg-transparent">
                    <NavLink
                      to={item.url}
                      end={item.end}
                      className={navCls(isActive(item.url, item.end))}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Administración — solo rol y permiso habilitantes */}
        {showAdminItems && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className="text-sidebar-foreground/50 text-[11px] uppercase tracking-wider">
                Sistema
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild className="hover:bg-transparent">
                      <NavLink
                        to={item.url}
                        className={navCls(isActive(item.url))}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-3">
        {!collapsed ? (
          <div className="flex items-center gap-3 rounded-md bg-sidebar-accent/60 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary-glow text-xs font-semibold">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-accent-foreground truncate">
                {displayName}
              </div>
              <div className="text-[10px] text-sidebar-foreground/60 flex items-center gap-1">
                <Activity className="h-2.5 w-2.5" /> En línea
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              className="rounded p-1 text-sidebar-foreground/60 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary-glow text-xs font-semibold">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
