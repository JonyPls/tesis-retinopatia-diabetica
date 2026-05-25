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
  Eye,
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
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, end: true },
  { title: "Pacientes", url: "/pacientes", icon: Users },
  { title: "Diagnóstico IA", url: "/diagnostico", icon: Brain },
  { title: "Informes", url: "/informes", icon: FileText },
];

const secondaryItems = [
  { title: "Configuración", url: "/configuracion", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    // 1. Eliminar el token JWT
    localStorage.removeItem("token");

    // Si guardaste el usuario en el Login, también es buena práctica eliminarlo
    localStorage.removeItem("user");

    // 2. Redirigir a la ruta pública (Login)
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
        {/* Usamos 'cn' para quitar el padding y centrar cuando está colapsado */}
        <div className={cn("flex items-center py-3 transition-all", collapsed ? "justify-center px-0" : "gap-3 px-2")}>
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
                Centro Oftalmológico
              </span>
              <span className="text-xs text-sidebar-foreground/90 whitespace-nowrap">
                del Norte · RD-AI
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-[11px] uppercase tracking-wider">
              Principal
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
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

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-[11px] uppercase tracking-wider">
              Sistema
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryItems.map((item) => (
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
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-3">
        {!collapsed ? (
          <div className="flex items-center gap-3 rounded-md bg-sidebar-accent/60 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary-glow text-xs font-semibold">
              FG
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-accent-foreground truncate">
                Dr. Felipe Granados
              </div>
              <div className="text-[10px] text-sidebar-foreground/60 flex items-center gap-1">
                <Activity className="h-2.5 w-2.5" /> En línea
              </div>
            </div>
            <LogOut
              className="h-4 w-4 text-sidebar-foreground/60 hover:text-sidebar-accent-foreground cursor-pointer"
              onClick={handleLogout}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            {/* Avatar Centrado */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary-glow text-xs font-semibold">
              FG
            </div>
            {/* Botón de Cerrar Sesión Colapsado */}
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
