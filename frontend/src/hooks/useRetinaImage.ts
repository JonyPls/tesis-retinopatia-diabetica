import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuthStore } from "@/features/auth/store/authStore";

type ImageState = {
  filename: string | null;
  session: string | null;
  src: string | null;
  error: string | null;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export function useRetinaImage(filename?: string | null) {
  const token = useAuthStore((state) => state.token);
  const name = filename ?? null;
  const [image, setImage] = useState<ImageState>({
    filename: null, session: null, src: null, error: null,
  });

  useEffect(() => {
    if (!name) return;
    if (!token) {
      setImage({ filename: name, session: token, src: null,
        error: "Su sesión ya no es válida. Inicie sesión nuevamente." });
      return;
    }
    if (!/^[^/\\?#]+\.(?:jpe?g|png)$/i.test(name)) {
      setImage({ filename: name, session: token, src: null,
        error: "Referencia de imagen no válida." });
      return;
    }

    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setImage({ filename: name, session: token, src: null, error: null });

    const url = new URL(`/uploads/retinas/${encodeURIComponent(name)}`,
      api.defaults.baseURL || window.location.origin).href;
    api.get<Blob>(url, { responseType: "blob", signal: controller.signal })
      .then((response) => {
        if (!active) return;
        const type = String(response.headers?.["content-type"] || response.data.type)
          .split(";")[0].trim().toLowerCase();
        if (!IMAGE_TYPES.has(type) ||
            (response.data.type && response.data.type !== type)) {
          setImage({ filename: name, session: token, src: null,
            error: "Formato de imagen no permitido." });
          return;
        }
        objectUrl = URL.createObjectURL(response.data);
        setImage({ filename: name, session: token, src: objectUrl, error: null });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        const status = error?.response?.status;
        const message = status === 401 ? "Su sesión ya no es válida. Inicie sesión nuevamente."
          : status === 403 ? "No tiene autorización para ver esta imagen clínica."
            : status === 404 ? "Imagen no encontrada."
              : "No se pudo cargar la imagen clínica.";
        setImage({ filename: name, session: token, src: null, error: message });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [name, token]);

  if (!name) return { src: null, error: null, isLoading: false };
  if (image.filename !== name || image.session !== token) {
    return { src: null, error: null, isLoading: Boolean(token) };
  }
  return { src: image.src, error: image.error,
    isLoading: !image.src && !image.error && Boolean(token) };
}
