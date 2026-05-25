import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { mockPatients, RD_LEVELS, RDLevel } from "@/data/mockData";
import { RDLevelBadge } from "@/components/medical/RDLevelBadge";
import { cn } from "@/lib/utils";
import {
  Search,
  UploadCloud,
  Eye,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  FileText,
  Save,
  Brain,
  Activity,
  Sparkles,
  AlertTriangle,
  X,
  ImageIcon,
  FolderSync,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import fundusOd from "@/assets/fundus-od.jpg";
import fundusGradcam from "@/assets/fundus-gradcam.jpg";

const STEPS = [
  { n: 1, label: "Paciente", icon: Search },
  { n: 2, label: "Imágenes Fondo de Ojo", icon: UploadCloud },
  { n: 3, label: "Resultado IA", icon: Brain },
];

type EyeKey = "OD" | "OI";

export default function Diagnosis() {
  const [step, setStep] = useState(1);
  const [dni, setDni] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<
    (typeof mockPatients)[0] | null
  >(null);
  const [images, setImages] = useState<Record<EyeKey, string | null>>({
    OD: null,
    OI: null,
  });
  const [activeEye, setActiveEye] = useState<EyeKey>("OD");
  const [notes, setNotes] = useState("");

  // Simulación de resultado IA
  const aiResult: Record<
    EyeKey,
    { level: RDLevel; confidence: number; findings: string[] }
  > = {
    OD: {
      level: 3,
      confidence: 0.91,
      findings: [
        "Hemorragias intrarretinianas en 4 cuadrantes",
        "Exudados duros perimaculares",
        "Microaneurismas múltiples",
      ],
    },
    OI: {
      level: 2,
      confidence: 0.86,
      findings: [
        "Microaneurismas dispersos",
        "Exudados duros leves en arcada temporal",
      ],
    },
  };

  const search = () => {
    const found = mockPatients.find((p) => p.dni === dni.trim());
    if (found) setSelectedPatient(found);
    else
      toast({
        title: "Paciente no encontrado",
        description: `No existe paciente con DNI ${dni}.`,
        variant: "destructive",
      });
  };

  const handleFile = (eye: EyeKey, file?: File) => {
    if (!file) return;
    setImages((prev) => ({ ...prev, [eye]: URL.createObjectURL(file) }));
  };

  const canNext =
    (step === 1 && selectedPatient) || (step === 2 && (images.OD || images.OI));

  const goNext = () => setStep((s) => Math.min(3, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleSave = () => {
    toast({
      title: "Diagnóstico guardado",
      description:
        "El informe PDF se ha generado y archivado en historia clínica.",
    });
    setStep(1);
    setSelectedPatient(null);
    setImages({ OD: null, OI: null });
    setNotes("");
    setDni("");
  };

  return (
    <AppLayout
      title="Módulo de Diagnóstico IA"
      subtitle="Evaluación asistida por Deep Learning · Retinopatía Diabética"
    >
      {/* Stepper */}
      <Card className="shadow-card mb-6">
        <CardContent className="p-5">
          <div className="flex items-center">
            {STEPS.map((s, idx) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <div
                  key={s.n}
                  className="flex items-center flex-1 last:flex-none"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all border-2",
                        done &&
                          "bg-primary text-primary-foreground border-primary",
                        active &&
                          "bg-primary text-primary-foreground border-primary shadow-elevated animate-pulse-ring",
                        !done &&
                          !active &&
                          "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <s.icon className="h-4 w-4" />
                      )}
                    </div>
                    <div className="hidden sm:block">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Paso {s.n}
                      </div>
                      <div
                        className={cn(
                          "text-sm font-medium",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </div>
                    </div>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={cn(
                        "flex-1 h-px mx-4 transition-colors",
                        step > s.n ? "bg-primary" : "bg-border",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* PASO 1 */}
      {step === 1 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Seleccionar Paciente
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ingrese el DNI del paciente registrado.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ej: 45782931 / ABC1234"
                  value={dni}
                  onChange={(e) =>
                    setDni(
                      e.target.value
                        .replace(/[^a-zA-Z0-9]/g, "")
                        .toUpperCase()
                        .slice(0, 15),
                    )
                  }
                  className="pl-9 font-mono"
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
              </div>
              <Button
                onClick={search}
                className="bg-gradient-primary hover:opacity-90"
              >
                Buscar
              </Button>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Pacientes recientes (sugerencias)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mockPatients.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPatient(p);
                      setDni(p.dni);
                    }}
                    className={cn(
                      "text-left rounded-md border p-3 hover:border-primary hover:bg-accent/40 transition-colors",
                      selectedPatient?.id === p.id
                        ? "border-primary bg-accent/40"
                        : "border-border",
                    )}
                  >
                    <div className="font-medium text-sm">
                      {p.firstName} {p.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      DNI {p.dni} · {p.age} años
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedPatient && (
              <div className="rounded-md border border-primary/30 bg-accent/40 p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground font-semibold">
                  {selectedPatient.firstName[0]}
                  {selectedPatient.lastName[0]}
                </div>
                <div className="flex-1">
                  <div className="font-medium">
                    {selectedPatient.firstName} {selectedPatient.lastName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    DNI {selectedPatient.dni} · {selectedPatient.age} años ·{" "}
                    {selectedPatient.phone}
                  </div>
                </div>
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PASO 2 */}
      {step === 2 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-primary" />
              Carga de Imágenes — Fondo de Ojo
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Asegúrese de que el nombre del archivo incluya el DNI y la
              orientación del ojo para la búsqueda automática. También puede
              cargar las imágenes manualmente.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center mb-6 mt-2">
              <Button
                variant="outline"
                className="border-teal-600 text-teal-700 hover:bg-teal-50"
                onClick={() =>
                  toast({
                    title: "Búsqueda Local",
                    description:
                      "Funcionalidad en desarrollo: Aquí se escaneará la carpeta local buscando el DNI del paciente.",
                  })
                }
              >
                <FolderSync className="mr-2 h-4 w-4" />
                Búsqueda automática local
              </Button>
            </div>

            <div className="relative flex items-center pb-5 mb-2">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground text-xs uppercase">
                o
              </span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["OD", "OI"] as EyeKey[]).map((eye) => (
                <DropZone
                  key={eye}
                  eye={eye}
                  image={images[eye]}
                  onFile={(f) => handleFile(eye, f)}
                  onClear={() => setImages((p) => ({ ...p, [eye]: null }))}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* PASO 3 */}
      {step === 3 && selectedPatient && (
        <div className="space-y-6">
          {/* Tabs por ojo */}
          <div className="flex items-center gap-2">
            {(["OD", "OI"] as EyeKey[]).map((eye) => (
              <button
                key={eye}
                onClick={() => setActiveEye(eye)}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium border transition-colors flex items-center gap-2",
                  activeEye === eye
                    ? "bg-card border-primary text-primary shadow-card"
                    : "bg-muted/40 border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Eye className="h-4 w-4" />
                {eye === "OD" ? "Ojo Derecho (OD)" : "Ojo Izquierdo (OI)"}
                <RDLevelBadge
                  level={aiResult[eye].level}
                  size="sm"
                  showLabel={false}
                />
              </button>
            ))}
          </div>

          <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            {/* Imágenes */}
            <Card className="lg:col-span-2 shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Análisis Visual —{" "}
                  {activeEye === "OD" ? "Ojo Derecho" : "Ojo Izquierdo"}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Comparativa entre la imagen original y el mapa de calor
                  (Grad-CAM) generado por la red neuronal.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ImagePanel
                    title="Imagen Original"
                    subtitle="Fondo de ojo · Topcon Triton"
                    src={images[activeEye] ?? fundusOd}
                  />
                  <ImagePanel
                    title="Mapa de Calor (Grad-CAM)"
                    subtitle="Regiones de mayor atención de la IA"
                    src={fundusGradcam}
                    overlay
                  />
                </div>

                <Separator className="my-4" />

                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Hallazgos detectados
                  </div>
                  <ul className="space-y-1.5">
                    {aiResult[activeEye].findings.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Activity className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Resultado predictivo */}
            <Card className="shadow-card overflow-hidden">
              <div
                className="h-2 w-full"
                style={{
                  backgroundColor: `hsl(var(--rd-${aiResult[activeEye].level}))`,
                }}
              />
              <CardHeader className="pb-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Resultado Predictivo
                </div>
                <CardTitle className="text-base">
                  Clasificación de Severidad
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="rounded-lg p-5 text-center"
                  style={{
                    backgroundColor: `hsl(var(--rd-${aiResult[activeEye].level}) / 0.08)`,
                    border: `1px solid hsl(var(--rd-${aiResult[activeEye].level}) / 0.3)`,
                  }}
                >
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Nivel detectado
                  </div>
                  <div
                    className="text-6xl font-bold tabular-nums leading-none mt-2"
                    style={{
                      color: `hsl(var(--rd-${aiResult[activeEye].level}))`,
                    }}
                  >
                    {aiResult[activeEye].level}
                  </div>
                  <div
                    className="text-sm font-semibold mt-2"
                    style={{
                      color: `hsl(var(--rd-${aiResult[activeEye].level}))`,
                    }}
                  >
                    {RD_LEVELS[aiResult[activeEye].level].label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {RD_LEVELS[aiResult[activeEye].level].description}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Confianza del modelo
                    </span>
                    <span className="font-semibold tabular-nums">
                      {(aiResult[activeEye].confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-primary rounded-full"
                      style={{
                        width: `${aiResult[activeEye].confidence * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {aiResult[activeEye].level >= 3 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex gap-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-destructive">
                        Caso crítico
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        Se recomienda derivación urgente a especialista en
                        vitreorretina.
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
                  <div className="text-muted-foreground">Modelo</div>
                  <div className="font-mono font-medium mt-0.5">
                    EyeNet-RD v3.2 · ResNet50
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Observaciones */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Observaciones Médicas</CardTitle>
              <p className="text-xs text-muted-foreground">
                Validación profesional del especialista. Quedarán registradas en
                el informe final.
              </p>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Se confirma diagnóstico de la IA. Paciente refiere visión borrosa progresiva en OD desde hace 2 meses. Se programa angiografía fluoresceínica..."
                rows={5}
                className="resize-none"
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>
                  Firmado digitalmente por Dr. R. Castillo · CMP 45123
                </span>
                <span>{notes.length} caracteres</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navegación */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
        <Button variant="outline" onClick={goBack} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4" /> Anterior
        </Button>
        {step < 3 ? (
          <Button
            onClick={goNext}
            disabled={!canNext}
            className="bg-gradient-primary hover:opacity-90"
          >
            Continuar <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            className="bg-gradient-primary hover:opacity-90 shadow-elevated"
          >
            <Save className="h-4 w-4" />
            Guardar Diagnóstico y Generar Informe PDF
            <FileText className="h-4 w-4" />
          </Button>
        )}
      </div>
    </AppLayout>
  );
}

function DropZone({
  eye,
  image,
  onFile,
  onClear,
}: {
  eye: EyeKey;
  image: string | null;
  onFile: (file?: File) => void;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <Label className="text-sm mb-2 flex items-center gap-2">
        <Eye className="h-4 w-4 text-primary" />
        {eye === "OD" ? "Ojo Derecho (OD)" : "Ojo Izquierdo (OI)"}
      </Label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "relative rounded-lg border-2 border-dashed transition-all aspect-square overflow-hidden",
          drag
            ? "border-primary bg-accent/50"
            : "border-border bg-muted/30 hover:border-primary/50",
        )}
      >
        {image ? (
          <>
            <img
              src={image}
              alt={`Fondo de ojo ${eye}`}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <button
              onClick={onClear}
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-card/90 backdrop-blur flex items-center justify-center hover:bg-card shadow-elevated"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
              <div className="text-xs font-medium text-white flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Imagen cargada
              </div>
            </div>
          </>
        ) : (
          <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer p-6 text-center">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <UploadCloud className="h-6 w-6 text-primary" />
            </div>
            <div className="text-sm font-medium">Arrastre la imagen aquí</div>
            <div className="text-xs text-muted-foreground mt-1">
              o haga clic para seleccionar
            </div>
            <div className="text-[10px] text-muted-foreground mt-3">
              JPG, PNG · Máx. 10 MB
            </div>
          </label>
        )}
      </div>
    </div>
  );
}

function ImagePanel({
  title,
  subtitle,
  src,
  overlay,
}: {
  title: string;
  subtitle: string;
  src: string;
  overlay?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
      <div className="aspect-square relative bg-black">
        <img
          src={src}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        {overlay && (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur px-2 py-1 text-[10px] font-medium text-white">
            <Sparkles className="h-3 w-3" /> Grad-CAM activo
          </div>
        )}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur px-2 py-1 text-[10px] font-medium text-white">
          <ImageIcon className="h-3 w-3" /> 768 × 768
        </div>
      </div>
      <div className="p-3">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}
