import io
import logging
import warnings
import cv2
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import torch
import logging

# Capa 1: Validación de formato y dimensiones ------------------------

FORMATOS_PERMITIDOS = {"JPEG", "PNG", "TIFF"}
DIMENSION_MINIMA    = 350  # px en el lado menor, basado en análisis del dataset EyePACS
MAX_IMAGE_SIDE = 8192
MAX_IMAGE_PIXELS = 30_000_000
MAX_IMAGE_BYTES = 20 * 1024 * 1024
IMAGE_TYPES = {
    "JPEG": ({".jpg", ".jpeg"}, "image/jpeg"),
    "PNG": ({".png"}, "image/png"),
    "TIFF": ({".tif", ".tiff"}, "image/tiff"),
}

def validar_formato_y_dimensiones(image_bytes: bytes, *, filename=None, mimetype=None,
                                  max_side=MAX_IMAGE_SIDE, max_pixels=MAX_IMAGE_PIXELS) -> dict:
    """
    Verifica que el archivo sea una imagen válida, tenga un formato
    permitido y dimensiones mínimas compatibles con una retinografía.

    Retorna:
        {"valido": True} si pasa todas las verificaciones.
        {"valido": False, "error": "<motivo>"} si falla alguna.
    """
    # 1. Verificar que los bytes correspondan a una imagen legible
    if not image_bytes:
        return {"valido": False, "error": "El archivo está vacío."}
    if filename is not None:
        if (not filename or '/' in filename or '\\' in filename or
                filename in ('.', '..') or len(filename) > 255 or
                any(ord(char) < 32 for char in filename)):
            return {"valido": False, "error": "Nombre de imagen inválido."}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as imagen:
                formato = imagen.format
                ancho, alto = imagen.size
                if formato not in FORMATOS_PERMITIDOS:
                    return {"valido": False, "error": "Formato de imagen no permitido."}
                if min(ancho, alto) < DIMENSION_MINIMA:
                    return {"valido": False, "error": "Resolución insuficiente."}
                if max(ancho, alto) > max_side or ancho * alto > max_pixels:
                    return {"valido": False, "error": "Dimensiones de imagen excedidas."}
                if filename is not None:
                    extension = '.' + filename.rsplit('.', 1)[-1].lower()
                    if extension not in IMAGE_TYPES[formato][0] or mimetype != IMAGE_TYPES[formato][1]:
                        return {"valido": False, "error": "Extensión o tipo MIME incompatible con la imagen."}
                imagen.verify()
            # verify comprueba estructura; load comprueba también los píxeles.
            with Image.open(io.BytesIO(image_bytes)) as imagen:
                imagen.load()
    except Exception:
        return {
            "valido": False,
            "error": "El archivo no es una imagen válida o está corrupto."
        }

    return {"valido": True}


# Capa 2: Validación de región circular dominante ------------------------

UMBRAL_AREA_CIRCULAR = 0.40  # La región circular debe ocupar al menos ese porcentaje del área total

def validar_region_circular(image_bytes: bytes) -> dict:
    """
    Verifica que la imagen contenga una región circular dominante
    sobre fondo oscuro, característica principal de una retinografía.

    Retorna:
        {"valido": True} si se detecta una región circular suficiente.
        {"valido": False, "error": "<motivo>"} si no se detecta.
    """
    # 1. Decodificar bytes a matriz OpenCV
    nparr   = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_bgr is None:
        return {
            "valido": False,
            "error": "No se pudo decodificar la imagen para análisis."
        }

    area_total = img_bgr.shape[0] * img_bgr.shape[1]

    # 2. Mismo pipeline de detección de contornos que inference.py
    gray     = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    umbral   = max(10, int(gray.max() * 0.05))
    blur     = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask  = cv2.threshold(blur, umbral, 255, cv2.THRESH_BINARY)
    mask     = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))

    contornos, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # 3. Si no hay contornos, la imagen no tiene ninguna región diferenciable
    if not contornos:
        return {
            "valido": False,
            "error": "No se detectó ninguna región de interés en la imagen. "
                     "Verifique que sea una retinografía de fondo de ojo."
        }

    # 4. Evaluar el contorno principal (el de mayor área)
    contorno_principal = max(contornos, key=cv2.contourArea)
    area_contorno      = cv2.contourArea(contorno_principal)
    proporcion         = area_contorno / area_total

    if proporcion < UMBRAL_AREA_CIRCULAR:
        return {
            "valido": False,
            "error": "La imagen no presenta una región retiniana dominante. "
                     "Verifique que sea una retinografía de fondo de ojo."
        }

    return {"valido": True}


# Capa 3: Validación semántica con CLIP ------------------------

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"

CLIP_PROMPTS = [
    "a retinal fundus photograph of an eye",            # [0] → aceptar
    "a photograph of a planet or astronomical object",  # [1] → rechazar
    "a photograph of an animal or pet",                 # [2] → rechazar
    "a photograph of a person or face",                 # [3] → rechazar
    "a document, screenshot or text image",             # [4] → rechazar
    "a landscape, nature or outdoor photograph",        # [5] → rechazar
    "a generic or unrecognized image",                  # [6] → rechazar
]

PROMPT_VALIDO_IDX = 0

MENSAJES_RECHAZO = {
    1: "Se detectó una imagen astronómica. Por favor suba una retinografía de fondo de ojo.",
    2: "Se detectó la fotografía de un animal. Por favor suba una retinografía de fondo de ojo.",
    3: "Se detectó la fotografía de una persona. Por favor suba una retinografía de fondo de ojo.",
    4: "Se detectó un documento o captura de pantalla. Por favor suba una retinografía de fondo de ojo.",
    5: "Se detectó una fotografía de paisaje. Por favor suba una retinografía de fondo de ojo.",
    6: "La imagen no fue reconocida como una retinografía. Por favor suba una retinografía de fondo de ojo.",
}

_clip_model     = None
_clip_processor = None

def _get_clip():
    global _clip_model, _clip_processor
    if _clip_model is None:
        _clip_model     = CLIPModel.from_pretrained(CLIP_MODEL_ID)
        _clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        _clip_model.eval()
    return _clip_model, _clip_processor


def validar_contenido_semantico(image_bytes: bytes) -> dict:
    try:
        modelo, processor = _get_clip()
    except Exception:
        logging.warning("CLIP no disponible para validar la imagen")
        return {"valido": False, "error": "Validación de imagen no disponible.", "status": 503}

    try:
        imagen = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        logging.error("Error interno al preparar imagen para CLIP")
        return {"valido": False, "error": "No se pudo procesar la solicitud.", "status": 500}

    try:
        inputs = processor(
            text=CLIP_PROMPTS,
            images=imagen,
            return_tensors="pt",
            padding=True
        )

        with torch.no_grad():
            outputs = modelo(**inputs)
            logits  = outputs.logits_per_image
            probs   = logits.softmax(dim=1).squeeze()
    except Exception:
        logging.warning("CLIP no disponible para validar la imagen")
        return {"valido": False, "error": "Validación de imagen no disponible.", "status": 503}
    try:
        idx_ganador = int(probs.argmax())
    except Exception:
        logging.error("CLIP devolvió un resultado inválido")
        return {"valido": False, "error": "No se pudo procesar la solicitud.", "status": 500}
    if idx_ganador != PROMPT_VALIDO_IDX:
        mensaje = MENSAJES_RECHAZO.get(
            idx_ganador,
            "La imagen no corresponde a una retinografía de fondo de ojo."
        )
        return {"valido": False, "error": mensaje}
    return {"valido": True}
