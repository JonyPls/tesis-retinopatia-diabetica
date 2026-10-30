import type { ReactNode } from "react";

interface PageContentProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

// La cabecera de página pertenece al contenido protegido, no al shell persistente.
export function PageContent({ children, title, subtitle, actions }: PageContentProps) {
  return (
    <>
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
      {children}
    </>
  );
}
