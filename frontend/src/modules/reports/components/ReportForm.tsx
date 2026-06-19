import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { FileText, Info, EyeOff } from "lucide-react";
import { TipoInforme, ReportFormHandle, Informe } from "../types";
import { GonioscopiaFields } from "./fields/GonioscopiaFields";
import { PaquimetriaFields } from "./fields/PaquimetriaFields";
import { CampoVisualFields } from "./fields/CampoVisualFields";

interface ReportFormProps {
  tipo: TipoInforme;
  isSaving: boolean;
  onValidityChange?: (valid: boolean) => void;
  readOnly?: boolean;
  initialData?: Informe;
}

export const ReportForm = forwardRef<ReportFormHandle, ReportFormProps>(
  ({ tipo, isSaving, onValidityChange, readOnly, initialData }, ref) => {
    const datos = readOnly && initialData ? (initialData.datos_estructurados || {}) : {};

    // getData() guarda las claves de ojo en minúscula (od/oi); el estado las espera en mayúscula (OD/OI)
    const normalizeEyeKeys = (obj: Record<string, any>) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k.toUpperCase()] = v;
      }
      return out;
    };

    const [ojos, setOjos] = useState<string[]>(
      readOnly && datos.ojos ? datos.ojos : ["OD", "OI"],
    );

    // Gonioscopia state
    const [conclusiones, setConclusiones] = useState<string[]>(
      readOnly && datos.conclusion ? datos.conclusion : [],
    );
    const [grados, setGrados] = useState<
      Record<string, Record<string, string>>
    >(
      readOnly && datos.grados
        ? normalizeEyeKeys(datos.grados)
        : {
            OD: { superior: "", inferior: "", nasal: "", temporal: "" },
            OI: { superior: "", inferior: "", nasal: "", temporal: "" },
          },
    );

    // Paquimetria state
    const [paqValores, setPaqValores] = useState<Record<string, string>>(
      readOnly && datos.valores
        ? Object.fromEntries(
            Object.entries(datos.valores).map(([k, v]) => [k.toUpperCase(), String(v)]),
          )
        : {},
    );

    // Campo visual state
    const [cvCampos, setCvCampos] = useState<
      Record<string, Record<string, string>>
    >(readOnly && datos.campos ? normalizeEyeKeys(datos.campos) : {});
    const [cvConclusion, setCvConclusion] = useState<string[]>(
      readOnly && datos.conclusion ? datos.conclusion : [],
    );
    const cvFieldsRef = useRef<{ flushConclusion: () => string[] }>(null);

    useImperativeHandle(
      ref,
      () => ({
        getData: () => {
          if (tipo.id === 4) {
            const valores: Record<string, number> = {};
            for (const ojo of ojos) {
              const v = parseInt(paqValores[ojo], 10);
              if (!isNaN(v)) valores[ojo.toLowerCase()] = v;
            }
            return { ojos, valores };
          }

          if (tipo.id === 2) {
            const finalConclusion =
              cvFieldsRef.current?.flushConclusion() || cvConclusion;
            const campos: Record<string, Record<string, string>> = {};
            for (const ojo of ojos) {
              const vals: Record<string, string> = {};
              for (const key of [
                "programa",
                "fijación",
                "comprobar_fijación",
                "pérdidas",
                "falso_positivo",
                "error",
                "fondo",
                "puntos_presentados",
              ]) {
                if (cvCampos[ojo]?.[key]) vals[key] = cvCampos[ojo][key];
              }
              campos[ojo.toLowerCase()] = vals;
            }
            return { ojos, campos, conclusion: finalConclusion };
          }

          if (tipo.id === 3) {
            const gradosFiltrados: Record<string, Record<string, string>> = {};
            for (const ojo of ojos) {
              const cuadrantes: Record<string, string> = {};
              for (const c of ["superior", "inferior", "nasal", "temporal"]) {
                if (grados[ojo]?.[c]) cuadrantes[c] = grados[ojo][c];
              }
              gradosFiltrados[ojo.toLowerCase()] = cuadrantes;
            }
            return { ojos, grados: gradosFiltrados, conclusion: conclusiones };
          }

          return {};
        },
        isValid: () => {
          if (tipo.id === 4) {
            return (
              ojos.length > 0 &&
              ojos.every((ojo) => {
                const v = parseInt(paqValores[ojo], 10);
                return !isNaN(v) && v > 0;
              })
            );
          }

          if (tipo.id === 2) {
            return (
              ojos.length > 0 &&
              ojos.every((ojo) =>
                [
                  "programa",
                  "fijación",
                  "comprobar_fijación",
                  "pérdidas",
                  "falso_positivo",
                  "error",
                  "fondo",
                  "puntos_presentados",
                ].every((k) => cvCampos[ojo]?.[k]?.trim()),
              ) &&
              cvConclusion.length > 0
            );
          }

          return (
            ojos.every((ojo) =>
              ["superior", "inferior", "nasal", "temporal"].every(
                (c) => grados[ojo]?.[c],
              ),
            ) && conclusiones.length > 0
          );
        },
      }),
      [tipo.id, ojos, grados, paqValores, cvCampos, cvConclusion, conclusiones],
    );

    const handleGradoChange = (
      ojo: string,
      cuadrante: string,
      grado: string,
    ) => {
      setGrados((prev) => ({
        ...prev,
        [ojo]: { ...prev[ojo], [cuadrante]: grado },
      }));
    };

    const handlePaqValorChange = (ojo: string, valor: string) => {
      setPaqValores((prev) => ({ ...prev, [ojo]: valor }));
    };

    const handleCvCampoChange = (ojo: string, campo: string, valor: string) => {
      setCvCampos((prev) => ({
        ...prev,
        [ojo]: { ...prev[ojo], [campo]: valor },
      }));
    };

    const canSave = readOnly
      ? true
      : tipo.id === 4
        ? ojos.length > 0 &&
          ojos.every((ojo) => {
            const v = parseInt(paqValores[ojo], 10);
            return !isNaN(v) && v > 0;
          })
        : tipo.id === 2
          ? ojos.length > 0 &&
            ojos.every((ojo) =>
              [
                "programa",
                "fijación",
                "comprobar_fijación",
                "pérdidas",
                "falso_positivo",
                "error",
                "fondo",
                "puntos_presentados",
              ].every((k) => cvCampos[ojo]?.[k]?.trim()),
            ) && cvConclusion.length > 0
          : ojos.every((ojo) =>
              ["superior", "inferior", "nasal", "temporal"].every(
                (c) => grados[ojo]?.[c],
              ),
            ) && conclusiones.length > 0;

    const disabledReason = readOnly
      ? null
      : !canSave
        ? tipo.id === 4
          ? ojos.some(
              (ojo) => !paqValores[ojo] || parseInt(paqValores[ojo], 10) <= 0,
            )
            ? "Ingresa el valor de paquimetría para cada ojo activo"
            : "Selecciona al menos un ojo"
          : tipo.id === 2
            ? ojos.some((ojo) =>
                [
                  "programa",
                  "fijación",
                  "comprobar_fijación",
                  "pérdidas",
                  "falso_positivo",
                  "error",
                  "fondo",
                  "puntos_presentados",
                ].some((k) => !cvCampos[ojo]?.[k]?.trim()),
              )
              ? "Completa todos los campos para cada ojo activo"
              : "Agrega al menos una conclusión"
            : ojos.some((ojo) =>
                  ["superior", "inferior", "nasal", "temporal"].some(
                    (c) => !grados[ojo]?.[c],
                  ),
                )
              ? "Faltan cuadrantes por seleccionar en uno o ambos ojos"
              : "Selecciona al menos una conclusión"
        : null;

    useEffect(() => {
      if (!readOnly) onValidityChange?.(canSave);
    }, [canSave, onValidityChange, readOnly]);

    // Sync state when readOnly/initialData change (defensive, key=inf.id handles fresh mount)
    useEffect(() => {
      if (!readOnly || !initialData) return;
      const d = initialData.datos_estructurados || {};
      if (d.ojos) setOjos(d.ojos);
      if (d.conclusion) { setConclusiones(d.conclusion); setCvConclusion(d.conclusion); }
      if (d.grados) setGrados(normalizeEyeKeys(d.grados));
      if (d.valores) {
        setPaqValores(
          Object.fromEntries(
            Object.entries(d.valores).map(([k, v]) => [k.toUpperCase(), String(v)]),
          ),
        );
      }
      if (d.campos) setCvCampos(normalizeEyeKeys(d.campos));
    }, [readOnly, initialData]);

    return (
      <div className={`rounded-xl border border-border bg-card ${readOnly ? "opacity-70" : ""}`}>
        <fieldset disabled={readOnly} className="contents">
          <div className="bg-muted/50 px-5 py-3.5 border-b border-border rounded-t-xl overflow-hidden flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              {readOnly ? (
                <EyeOff className="h-4.5 w-4.5 text-muted-foreground" />
              ) : (
                <FileText className="h-4.5 w-4.5 text-primary" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold">{tipo.nombre}</h3>
              <p className="text-xs text-muted-foreground">
                {readOnly ? "Vista previa del informe registrado" : "Complete los campos del informe clínico"}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-6">
            {tipo.id === 3 && (
              <GonioscopiaFields
                ojos={ojos}
                onOjosChange={setOjos}
                grados={grados}
                onGradoChange={handleGradoChange}
                conclusiones={conclusiones}
                onConclusionesChange={setConclusiones}
              />
            )}

            {tipo.id === 4 && (
              <PaquimetriaFields
                ojos={ojos}
                onOjosChange={setOjos}
                valores={paqValores}
                onValorChange={handlePaqValorChange}
              />
            )}

            {tipo.id === 2 && (
              <CampoVisualFields
                ref={cvFieldsRef}
                ojos={ojos}
                onOjosChange={setOjos}
                campos={cvCampos}
                onCampoChange={handleCvCampoChange}
                conclusion={cvConclusion}
                onConclusionChange={setCvConclusion}
              />
            )}
          </div>

          {!readOnly && (disabledReason || isSaving) && (
            <div className="border-t border-border px-4 py-3 rounded-b-xl overflow-hidden flex items-center justify-end gap-3">
              {disabledReason && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                  <Info className="h-4 w-4 shrink-0 text-gray-500" />
                  <span>{disabledReason}</span>
                </div>
              )}
              {isSaving && (
                <span className="text-xs text-muted-foreground">Guardando...</span>
              )}
            </div>
          )}
        </fieldset>
      </div>
    );
  },
);

ReportForm.displayName = "ReportForm";
