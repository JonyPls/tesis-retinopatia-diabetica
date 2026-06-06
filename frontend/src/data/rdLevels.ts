export type RDLevel = 0 | 1 | 2 | 3 | 4;

export const RD_LEVELS: Record<
  RDLevel,
  { label: string; description: string; tone: string; features: string[] }
> = {
  0: {
    label: "Sin Retinopatía",
    description: "No se detectan signos de retinopatía diabética.",
    tone: "rd-0",
    features: [
      "Sin lesiones aparentes",
      "Vasculatura retinal conservada",
      "No se detectan microaneurismas",
    ],
  },
  1: {
    label: "RD Leve (NPDR)",
    description: "Microaneurismas aislados.",
    tone: "rd-1",
    features: ["Microaneurismas aislados", "Pequeñas hemorragias puntiformes"],
  },
  2: {
    label: "RD Moderada (NPDR)",
    description: "Hemorragias y exudados duros.",
    tone: "rd-2",
    features: [
      "Hemorragias intrarretinianas",
      "Exudados duros",
      "Microaneurismas múltiples",
      "Algodonosos ocasionales",
    ],
  },
  3: {
    label: "RD Severa (NPDR)",
    description: "Hemorragias extensas en 4 cuadrantes.",
    tone: "rd-3",
    features: [
      "Hemorragias intrarretinianas extensas",
      "Exudados perimaculares",
      "Alteraciones venosas",
      "Signos de isquemia retinal",
    ],
  },
  4: {
    label: "RD Proliferativa (PDR)",
    description: "Neovascularización. Riesgo crítico.",
    tone: "rd-4",
    features: [
      "Neovascularización",
      "Hemorragia vítrea",
      "Fibrosis fibrovascular",
      "Riesgo de desprendimiento retinal",
    ],
  },
};
