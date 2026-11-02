// Opt-in de compilación. No habilita permisos, esquema ni compuertas backend.
// Ausente, "false" y otros valores mantienen exactamente el flujo anterior.
export const diagnosisDiscardEnabled = () => import.meta.env.VITE_DIAGNOSIS_DISCARD_ENABLED === "true";
