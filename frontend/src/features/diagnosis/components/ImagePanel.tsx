interface ImagePanelProps {
  title: string;
  subtitle?: string;
  src: string;
  /** Presentación compacta del resultado, sin recortar la imagen clínica. */
  compact?: boolean;
  /** Si es true, muestra el badge discreto "Grad-CAM" */
  overlay?: boolean;
}

export function ImagePanel({ title, subtitle, src, overlay, compact }: ImagePanelProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className={compact ? "relative aspect-square bg-black sm:aspect-[4/3] lg:aspect-[3/2]" : "relative aspect-square bg-black"}>
        <img
          src={src}
          alt={title}
          className={`absolute inset-0 h-full w-full ${compact ? "object-contain" : "object-cover"}`}
          loading="lazy"
        />

        {/* Identificación discreta de Grad-CAM */}
        {overlay && (
          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            Grad-CAM
          </div>
        )}
      </div>

      {/* Pie de imagen */}
      <div className="px-3 py-2.5">
        <div className="text-sm font-medium leading-none">{title}</div>
        {subtitle && <div className={`mt-1 text-xs text-muted-foreground${compact ? " break-all" : ""}`}>{subtitle}</div>}
      </div>
    </div>
  );
}
