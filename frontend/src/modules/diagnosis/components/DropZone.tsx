import { useRef, useState, useCallback } from "react";
import { UploadCloud, X, Eye, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EyeKey } from "../types";

interface DropZoneProps {
  eye: EyeKey;
  preview: string | null;
  hasFile: boolean;
  onFile: (eye: EyeKey, file?: File) => void;
  onClear: (eye: EyeKey) => void;
}

const EYE_LABEL: Record<EyeKey, { short: string; full: string }> = {
  OD: { short: "OD", full: "Ojo Derecho" },
  OI: { short: "OI", full: "Ojo Izquierdo" },
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/tiff"];
const MAX_SIZE_MB = 30;

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Formato no admitido. Use JPG, PNG o TIFF.";
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `El archivo supera los ${MAX_SIZE_MB} MB permitidos.`;
  }
  return null;
}

export function DropZone({
  eye,
  preview,
  hasFile,
  onFile,
  onClear,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = EYE_LABEL[eye];

  const processFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      onFile(eye, file);
    },
    [eye, onFile],
  );

  // ── Drag handlers ──────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Sólo resetear si el cursor sale del contenedor completo
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input para permitir re-seleccionar el mismo archivo
    e.target.value = "";
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
    onClear(eye);
  };

  // ── Render: con imagen cargada ─────────────────────────────────
  if (hasFile && preview) {
    return (
      <div className="flex flex-col gap-2">
        {/* Badge de etiqueta */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {label.full}
          </span>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Quitar
          </button>
        </div>

        {/* Imagen con overlay de edición */}
        <div
          className="group relative rounded-lg border-2 border-primary/30 bg-black overflow-hidden cursor-pointer"
          style={{ aspectRatio: "1 / 1" }}
          onClick={() => inputRef.current?.click()}
        >
          <img
            src={preview}
            alt={`Retina ${label.full}`}
            className="w-full h-full object-contain transition-opacity duration-200 group-hover:opacity-60"
          />
          {/* Hover overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40">
            <UploadCloud className="h-7 w-7 text-white mb-1" />
            <span className="text-xs text-white font-medium">Reemplazar</span>
          </div>
          {/* Badge de ojo en esquina */}
          <div className="absolute top-2 left-2 rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-bold text-primary-foreground backdrop-blur-sm">
            {label.short}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.tif,.tiff"
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    );
  }

  // ── Render: con archivo pero sin preview ───────────────────────
  if (hasFile && !preview) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {label.full}
          </span>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Quitar
          </button>
        </div>
        <div
          className="rounded-lg border-2 border-primary/30 bg-muted/50 flex flex-col items-center justify-center gap-2 p-6"
          style={{ aspectRatio: "1 / 1" }}
        >
          <Eye className="h-10 w-10 text-primary/60" />
          <span className="text-xs text-muted-foreground text-center">
            Archivo cargado.
            <br />
            Vista previa no disponible.
          </span>
        </div>
      </div>
    );
  }

  // ── Render: zona vacía (drop target) ──────────────────────────
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label.full}
      </span>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-3 p-6 w-full transition-all duration-200 cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-accent/30",
          error && "border-destructive/60 bg-destructive/5",
        )}
        style={{ aspectRatio: "1 / 1" }}
        aria-label={`Cargar imagen para ${label.full}`}
      >
        <div
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
            isDragging ? "bg-primary/15" : "bg-muted",
          )}
        >
          <UploadCloud
            className={cn(
              "h-6 w-6 transition-colors",
              isDragging ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-foreground">
            {isDragging ? "Suelta la imagen aquí" : `Cargar ${label.short}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Arrastra o haz clic para seleccionar
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            JPG, PNG, TIF · Máx. {MAX_SIZE_MB} MB
          </p>
        </div>
      </button>

      {/* Error inline */}
      {error && (
        <div className="flex items-start gap-1.5 text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="text-xs">{error}</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.tif,.tiff"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
