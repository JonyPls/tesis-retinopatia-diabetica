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

export interface Patient {
  id: string;
  dni: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  age: number;
  phone: string;
  lastVisit: string;
  status: "Activo" | "Seguimiento" | "Crítico" | "Alta";
  diagnoses: Diagnosis[];
}

export interface Diagnosis {
  id: string;
  date: string;
  eye: "OD" | "OI" | "AO";
  level: RDLevel;
  confidence: number;
  notes: string;
  physician: string;
}

export const mockPatients: Patient[] = [
  {
    id: "p1",
    dni: "45782931",
    firstName: "María Elena",
    lastName: "Quispe Mamani",
    birthDate: "1962-03-14",
    age: 63,
    phone: "+51 987 654 321",
    lastVisit: "2025-04-22",
    status: "Crítico",
    diagnoses: [
      {
        id: "d1",
        date: "2025-04-22",
        eye: "OD",
        level: 4,
        confidence: 0.94,
        notes: "Neovascularización severa, derivación urgente a vitreorretina.",
        physician: "Dr. R. Castillo",
      },
      {
        id: "d2",
        date: "2025-04-22",
        eye: "OI",
        level: 3,
        confidence: 0.89,
        notes: "Hemorragias en los 4 cuadrantes.",
        physician: "Dr. R. Castillo",
      },
      {
        id: "d3",
        date: "2024-10-08",
        eye: "AO",
        level: 2,
        confidence: 0.82,
        notes: "Inicio de tratamiento con láser.",
        physician: "Dra. L. Mendoza",
      },
    ],
  },
  {
    id: "p2",
    dni: "08234561",
    firstName: "Carlos Alberto",
    lastName: "Vargas Huamán",
    birthDate: "1955-09-02",
    age: 70,
    phone: "+51 956 112 778",
    lastVisit: "2025-04-21",
    status: "Seguimiento",
    diagnoses: [
      {
        id: "d4",
        date: "2025-04-21",
        eye: "OD",
        level: 2,
        confidence: 0.87,
        notes: "Exudados duros en arcada temporal superior.",
        physician: "Dra. L. Mendoza",
      },
      {
        id: "d5",
        date: "2024-12-15",
        eye: "OD",
        level: 1,
        confidence: 0.78,
        notes: "Microaneurismas dispersos.",
        physician: "Dra. L. Mendoza",
      },
    ],
  },
  {
    id: "p3",
    dni: "72918345",
    firstName: "Rosa Isabel",
    lastName: "Flores Cárdenas",
    birthDate: "1978-11-30",
    age: 46,
    phone: "+51 944 332 109",
    lastVisit: "2025-04-20",
    status: "Activo",
    diagnoses: [
      {
        id: "d6",
        date: "2025-04-20",
        eye: "AO",
        level: 0,
        confidence: 0.96,
        notes: "Sin signos de retinopatía. Control anual.",
        physician: "Dr. R. Castillo",
      },
    ],
  },
  {
    id: "p4",
    dni: "10293847",
    firstName: "Juan Manuel",
    lastName: "Ramírez Soto",
    birthDate: "1948-05-19",
    age: 76,
    phone: "+51 999 887 665",
    lastVisit: "2025-04-19",
    status: "Crítico",
    diagnoses: [
      {
        id: "d7",
        date: "2025-04-19",
        eye: "OI",
        level: 4,
        confidence: 0.92,
        notes: "PDR con hemorragia vítrea.",
        physician: "Dr. R. Castillo",
      },
    ],
  },
  {
    id: "p5",
    dni: "63451209",
    firstName: "Lucía Margarita",
    lastName: "Ticona Apaza",
    birthDate: "1970-07-25",
    age: 54,
    phone: "+51 933 221 144",
    lastVisit: "2025-04-18",
    status: "Seguimiento",
    diagnoses: [
      {
        id: "d8",
        date: "2025-04-18",
        eye: "OD",
        level: 3,
        confidence: 0.88,
        notes: "RD severa, programar panfotocoagulación.",
        physician: "Dra. L. Mendoza",
      },
      {
        id: "d9",
        date: "2024-09-12",
        eye: "OD",
        level: 2,
        confidence: 0.81,
        notes: "Progresión moderada.",
        physician: "Dra. L. Mendoza",
      },
    ],
  },
  {
    id: "p6",
    dni: "29384756",
    firstName: "Pedro Antonio",
    lastName: "Salazar Núñez",
    birthDate: "1965-01-08",
    age: 60,
    phone: "+51 977 665 554",
    lastVisit: "2025-04-17",
    status: "Activo",
    diagnoses: [
      {
        id: "d10",
        date: "2025-04-17",
        eye: "AO",
        level: 1,
        confidence: 0.85,
        notes: "RD leve, controles cada 6 meses.",
        physician: "Dr. R. Castillo",
      },
    ],
  },
  {
    id: "p7",
    dni: "55129038",
    firstName: "Ana Cecilia",
    lastName: "Pacheco Rojas",
    birthDate: "1982-12-04",
    age: 42,
    phone: "+51 922 110 998",
    lastVisit: "2025-04-15",
    status: "Alta",
    diagnoses: [
      {
        id: "d11",
        date: "2025-04-15",
        eye: "AO",
        level: 0,
        confidence: 0.97,
        notes: "Sin retinopatía. Alta de control oftalmológico anual.",
        physician: "Dra. L. Mendoza",
      },
    ],
  },
  {
    id: "p8",
    dni: "84736251",
    firstName: "Hugo César",
    lastName: "Bermúdez Inca",
    birthDate: "1959-08-21",
    age: 65,
    phone: "+51 988 776 543",
    lastVisit: "2025-04-14",
    status: "Seguimiento",
    diagnoses: [
      {
        id: "d12",
        date: "2025-04-14",
        eye: "OI",
        level: 2,
        confidence: 0.83,
        notes: "Edema macular leve.",
        physician: "Dr. R. Castillo",
      },
    ],
  },
];

export const dashboardKPIs = {
  totalPatients: 183,
  diagnosesToday: 6,
  criticalCases: 1,
  pendingReview: 0,
};
