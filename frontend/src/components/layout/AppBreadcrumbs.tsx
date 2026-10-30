import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { breadcrumbsFor } from "./breadcrumbTrail";

export function AppBreadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = breadcrumbsFor(pathname);
  if (crumbs.length === 0) return null;

  return <nav aria-label="Ruta de navegación" className="flex min-w-0 items-center text-sm">
    {crumbs.map((crumb, index) => {
      const current = index === crumbs.length - 1;
      return <Fragment key={`${crumb.label}-${index}`}>
        {index > 0 && (
          <ChevronRight aria-hidden="true"
            className="mx-1 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/70 sm:block" />
        )}
        {/* En móvil se conserva solo la ubicación actual para no desplazar controles. */}
        <span className={current ? "min-w-0" : "hidden min-w-0 sm:block"}>
          {crumb.to && !current
            ? <Link to={crumb.to}
              className="block truncate rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {crumb.label}
            </Link>
            : <span aria-current={current ? "page" : undefined}
              className="block max-w-[11rem] truncate font-medium text-foreground sm:max-w-none">
              {crumb.label}
            </span>}
        </span>
      </Fragment>;
    })}
  </nav>;
}
