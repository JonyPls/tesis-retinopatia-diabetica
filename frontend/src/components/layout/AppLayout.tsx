import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

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
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="relative flex-1 flex flex-col min-w-0">
          <SidebarTrigger className="fixed left-4 top-4 z-20 h-8 w-8 rounded-md border border-border bg-card text-muted-foreground shadow-card hover:text-foreground md:hidden" />

          <main className="flex-1 p-6 pt-16 md:pt-6 lg:p-8 overflow-auto">
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
