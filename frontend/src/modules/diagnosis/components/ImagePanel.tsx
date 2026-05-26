import { Sparkles, ImageIcon } from "lucide-react";

interface ImagePanelProps {
  title: string;
  subtitle: string;
  src: string;
  /** Si es true, muestra el badge "Grad-CAM activo" */
  overlay?: boolean;
}

export function ImagePanel({ title, subtitle, src, overlay }: ImagePanelProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
      {/* Imagen cuadrada */}
      <div className="aspect-square relative bg-black">
        <img
          src={src}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />

        {/* Badge Grad-CAM — esquina superior izquierda */}
        {overlay && (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-medium text-white">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Grad-CAM activo
          </div>
        )}

        {/* Badge de resolución — esquina superior derecha */}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-[10px] font-medium text-white">
          <ImageIcon className="h-3 w-3" />
          224 × 224
        </div>
      </div>

      {/* Pie de imagen */}
      <div className="px-3 py-2.5">
        <div className="text-sm font-medium leading-none">{title}</div>
        <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
      </div>
    </div>
  );
}
