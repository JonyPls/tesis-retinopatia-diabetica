import { Link } from "react-router-dom";
import type { PatientRequestError } from "../patientAccess";

export function PatientLookupError({ error }: { error: PatientRequestError }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm">
      <p className="font-medium text-foreground">{error.message}</p>
      <Link
        to={error.status === 401 ? "/" : "/dashboard"}
        className="mt-2 inline-flex rounded text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {error.status === 401 ? "Ir a inicio de sesión" : "Volver al inicio"}
      </Link>
    </div>
  );
}
