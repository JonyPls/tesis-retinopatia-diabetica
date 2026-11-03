import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { GlobalPatientSearch } from "./GlobalPatientSearch";

export function AppHeader() {
  return <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:gap-3 sm:px-6">
    <SidebarTrigger className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
    <AppBreadcrumbs />
    {/* La búsqueda se centra en el espacio libre: no queda pegada al extremo derecho. */}
    <div className="flex min-w-0 flex-1 items-center justify-center">
      <GlobalPatientSearch />
    </div>
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Notificaciones"
          hidden className="hidden h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-sm text-muted-foreground">
        Notificaciones no disponibles por ahora.
      </PopoverContent>
    </Popover>
  </header>;
}
