import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ImagePreviewLightboxProps {
  src: string;
  title: string;
  subtitle?: string;
  alt: string;
  onClose: () => void;
}

export function ImagePreviewLightbox({
  src,
  title,
  subtitle,
  alt,
  onClose,
}: ImagePreviewLightboxProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] max-w-[94vw] cursor-default flex-col shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 rounded-t-md bg-background/95 px-3 py-2.5 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{title}</p>
            {subtitle && (
              <p className="mt-0.5 break-all text-[11px] leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cerrar vista previa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <img
          src={src}
          alt={alt}
          className="max-h-[84vh] max-w-[94vw] rounded-b-md object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}
