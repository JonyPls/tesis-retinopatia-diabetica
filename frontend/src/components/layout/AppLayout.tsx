import { ReactNode, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buscarPacientes } from "@/services/patientService";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppLayout({
  children,
  title,
  subtitle,
  actions,
}: AppLayoutProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const debounceTimer = setTimeout(async () => {
      setIsSearching(true);
      setIsOpen(true);
      try {
        const data = await buscarPacientes(searchQuery);
        setResults(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error searching patients:", error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  const handleSelectPatient = (id: string | number) => {
    navigate(`/pacientes/${id}`);
    setSearchQuery("");
    setIsOpen(false);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4 shadow-card sticky top-0 z-10">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-6 w-px bg-border" />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-foreground truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-muted-foreground truncate">
                  {subtitle}
                </p>
              )}
            </div>
            <div
              className="hidden md:flex items-center relative w-72"
              ref={searchRef}
            >
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && setIsOpen(true)}
                placeholder="Buscar paciente, documento..."
                className="pl-9 h-9 bg-muted/50 border-border"
              />
              {isOpen && searchQuery.length >= 2 && (
                <div className="absolute top-full left-0 w-full mt-1 bg-white shadow-lg rounded-md border border-border z-50 overflow-hidden">
                  {isSearching ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      Buscando...
                    </div>
                  ) : results.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No se encontraron pacientes.
                    </div>
                  ) : (
                    <ul className="max-h-64 overflow-y-auto w-full">
                      {results.map((paciente) => (
                        <li
                          key={paciente.id}
                          onClick={() => handleSelectPatient(paciente.id)}
                          className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex flex-col w-full"
                        >
                          <span className="font-semibold text-sm">
                            {paciente.nombres_apellidos ||
                              `${paciente.nombres || ""} ${paciente.apellidos || ""}`.trim()}
                          </span>
                          <span className="text-xs text-muted-foreground uppercase">
                            {paciente.tipo_doc_abrev || paciente.tipo_doc}:{" "}
                            {paciente.nro_documento}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <button className="relative h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted transition-colors">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
            </button>
          </header>

          <main className="flex-1 p-6 lg:p-8 overflow-auto">
            <div className="max-w-[1600px] mx-auto animate-fade-in">
              {(actions || subtitle) && (
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-foreground tracking-tight">
                      {title}
                    </h2>
                    {subtitle && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {subtitle}
                      </p>
                    )}
                  </div>
                  {actions && (
                    <div className="flex items-center gap-2">{actions}</div>
                  )}
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
