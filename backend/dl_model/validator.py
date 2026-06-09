import io
import cv2
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import torch

# Capa 1: Validación de formato y dimensiones ------------------------

FORMATOS_PERMITIDOS = {"JPEG", "PNG", "TIFF"}
DIMENSION_MINIMA    = 350  # px en el lado menor, basado en análisis del dataset EyePACS

def validar_formato_y_dimensiones(image_bytes: bytes) -> dict:
    """
    Verifica que el archivo sea una imagen válida, tenga un formato
    permitido y dimensiones mínimas compatibles con una retinografía.

    Retorna:
        {"valido": True} si pasa todas las verificaciones.
        {"valido": False, "error": "<motivo>"} si falla alguna.
    """
    # 1. Verificar que los bytes correspondan a una imagen legible
    try:
        imagen = Image.open(io.BytesIO(image_bytes))
        imagen.verify()  # Detecta archivos corruptos o trucados
    except Exception:
        return {
            "valido": False,
            "error": "El archivo no es una imagen válida o está corrupto."
        }

    # 2. Re-abrir luego de verify() ya que este cierra el stream interno
    imagen = Image.open(io.BytesIO(image_bytes))

    # 3. Verificar formato permitido
    if imagen.format not in FORMATOS_PERMITIDOS:
        return {
            "valido": False,
            "error": f"Formato '{imagen.format}' no permitido. "
                     f"Se aceptan: JPG, PNG y TIFF."
        }

    # 4. Verificar dimensiones mínimas
    ancho, alto = imagen.size
    if min(ancho, alto) < DIMENSION_MINIMA:
        return {
            "valido": False,
            "error": f"Resolución insuficiente ({ancho}×{alto} px). "
                     f"La imagen debe tener al menos {DIMENSION_MINIMA} px en su lado menor."
        }

    return {"valido": True}


# Capa 2: Validación de región circular dominante ------------------------

UMBRAL_AREA_CIRCULAR = 0.40  # La región circular debe ocupar al menos el 40% del área total

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

# Descripciones candidatas para la comparación semántica
CLIP_PROMPTS = [
    "a retinal fundus photograph of an eye",       # [0] → aceptar
    "a photograph of a planet or astronomical object",  # [1] → rechazar
    "a generic photograph, document, or non-medical image",  # [2] → rechazar
]

# Índice del prompt que corresponde a una retinografía válida
PROMPT_VALIDO_IDX = 0

# Singleton para no recargar CLIP en cada petición
_clip_model     = None
_clip_processor = None

def _get_clip():
    """Carga CLIP solo la primera vez que se necesita."""
    global _clip_model, _clip_processor
    if _clip_model is None:
        _clip_model     = CLIPModel.from_pretrained(CLIP_MODEL_ID)
        _clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        _clip_model.eval()
    return _clip_model, _clip_processor


def validar_contenido_semantico(image_bytes: bytes) -> dict:
    """
    Usa CLIP para verificar semánticamente que el contenido
    de la imagen corresponde a una retinografía de fondo de ojo
    y no a otro tipo de imagen que haya superado las capas anteriores
    (ej. fotografía de un planeta sobre fondo negro).

    Retorna:
        {"valido": True} si CLIP identifica la imagen como retinografía.
        {"valido": False, "error": "<motivo>"} en caso contrario.
    """
    try:
        modelo, processor = _get_clip()

        # 1. Convertir bytes a imagen PIL en RGB
        imagen = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 2. Preparar inputs: imagen + todos los prompts de texto
        inputs = processor(
            text=CLIP_PROMPTS,
            images=imagen,
            return_tensors="pt",
            padding=True
        )

        # 3. Calcular similitudes imagen-texto
        with torch.no_grad():
            outputs    = modelo(**inputs)
            logits     = outputs.logits_per_image  # shape: [1, n_prompts]
            probs      = logits.softmax(dim=1).squeeze()  # shape: [n_prompts]

        # 4. El prompt ganador es el de mayor probabilidad
        idx_ganador = int(probs.argmax())

        if idx_ganador != PROMPT_VALIDO_IDX:
            return {
                "valido": False,
                "error": "El contenido de la imagen no corresponde a una "
                         "retinografía de fondo de ojo."
            }

        return {"valido": True}

    except Exception as e:
        # Si CLIP falla por cualquier razón, dejamos pasar la imagen
        # para no bloquear el flujo clínico por un error del validador
        return {"valido": True}