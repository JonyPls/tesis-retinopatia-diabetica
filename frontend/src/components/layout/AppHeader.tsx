import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GlobalPatientSearch } from "./GlobalPatientSearch";

export function AppHeader() {
  return <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:px-6">
    <SidebarTrigger className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" />
    <div className="flex-1" />
    <GlobalPatientSearch />
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Notificaciones"
          className="ml-auto h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground sm:ml-0">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-sm text-muted-foreground">
        Notificaciones no disponibles por ahora.
      </PopoverContent>
    </Popover>
  </header>;
}
