import UTIF from "utif2";

function isTiffFile(file: File) {
  const type = file.type.toLowerCase();
  return (
    type === "image/tiff" ||
    type === "image/x-tiff" ||
    /\.(tif|tiff)$/i.test(file.name)
  );
}

export function revokePreviewUrl(preview?: string | null) {
  if (preview?.startsWith("blob:")) {
    URL.revokeObjectURL(preview);
  }
}

export const convertToPreviewUrl = (file: File): Promise<string> => {
  if (!isTiffFile(file)) {
    return Promise.resolve(URL.createObjectURL(file));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;

        // Decodificar el TIFF
        const ifds = UTIF.decode(buffer);
        if (!ifds.length) {
          reject(new Error("No se pudo decodificar el archivo TIFF"));
          return;
        }
        UTIF.decodeImage(buffer, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);

        const width  = ifds[0].width;
        const height = ifds[0].height;

        // Pintar en canvas y exportar como JPEG
        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d")!;
        const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imageData, 0, 0);

        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
};
