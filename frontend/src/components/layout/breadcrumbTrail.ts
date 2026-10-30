import { matchPath } from "react-router-dom";

export type Crumb = { label: string; to?: string };

// Solo rutas internas con jerarquía real; las páginas principales no muestran rastro.
// Los enlaces usan únicamente rutas declaradas en App.tsx, nunca identificadores visibles.
export function breadcrumbsFor(pathname: string): Crumb[] {
  const visit = matchPath("/pacientes/:pacienteId/visitas/:visitaId", pathname);
  if (visit?.params.pacienteId) {
    return [
      { label: "Pacientes", to: "/pacientes" },
      { label: "Perfil del paciente", to: `/pacientes/${visit.params.pacienteId}` },
      { label: "Visita" },
    ];
  }
  const profile = matchPath("/pacientes/:id", pathname);
  if (profile?.params.id) {
    return [
      { label: "Pacientes", to: "/pacientes" },
      { label: "Perfil del paciente" },
    ];
  }
  return [];
}
