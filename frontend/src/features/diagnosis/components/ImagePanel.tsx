interface ImagePanelProps {
  title: string;
  subtitle: string;
  src: string;
  /** Si es true, muestra el badge discreto "Grad-CAM" */
  overlay?: boolean;
}

export function ImagePanel({ title, subtitle, src, overlay }: ImagePanelProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      {/* Imagen cuadrada */}
      <div className="relative aspect-square bg-black">
        <img
          src={src}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
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
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}
