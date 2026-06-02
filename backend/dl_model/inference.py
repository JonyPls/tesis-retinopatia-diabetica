import os
import cv2
import numpy as np
import torch
from PIL import Image
import torchvision.transforms as transforms

from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.image import show_cam_on_image

from .model_architecture import RetinopatiaModel

# ── 1. Configuración Global ──
# Flask detectará automáticamente si el servidor tiene GPU o usará CPU
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "resnet50_best.ckpt")

GRADOS = {
    0: "Sin DR",
    1: "Leve",
    2: "Moderada",
    3: "Severa",
    4: "Proliferativa"
}

# Variable global para almacenar el modelo en memoria
_modelo_cargado = None

def get_modelo():
    """Carga el modelo solo la primera vez que se necesita."""
    global _modelo_cargado
    if _modelo_cargado is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"No se encontró el archivo de pesos en: {MODEL_PATH}")
        
        # PyTorch Lightning lee el .ckpt
        _modelo_cargado = RetinopatiaModel.load_from_checkpoint(MODEL_PATH)
        _modelo_cargado.eval()
        _modelo_cargado.to(DEVICE)
    return _modelo_cargado

# Funciones de Preprocesamiento
def ben_graham_luminancia(img_rgb, clip=2.0):
    radio = max(img_rgb.shape[0], img_rgb.shape[1])
    sigma_dinamico = min(50.0, max(1.0, radio / 10.0))
    img_lab = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(img_lab)
    blur    = cv2.GaussianBlur(l, (0, 0), sigma_dinamico)
    l_bg    = cv2.addWeighted(l, 4, blur, -4, 128)
    l_bg    = np.clip(l_bg, 0, 255).astype(np.uint8)
    clahe   = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    l_final = clahe.apply(l_bg)
    return cv2.cvtColor(cv2.merge((l_final, a, b)), cv2.COLOR_LAB2RGB)

def aplicar_mascara_circular(img):
    h, w  = img.shape[:2]
    mask  = np.zeros((h, w), dtype=np.uint8)
    cv2.circle(mask, (w//2, h//2), min(w,h)//2, 255, -1)
    resultado = img.copy()
    resultado[mask == 0] = 0
    return resultado

def aplicar_pipeline_core(img_rgb):
    img_bg = ben_graham_luminancia(img_rgb.copy())
    gray       = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    umbral     = max(10, int(gray.max() * 0.05))
    img_blur   = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mascara = cv2.threshold(img_blur, umbral, 255, cv2.THRESH_BINARY)
    mascara    = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if contornos:
        c = max(contornos, key=cv2.contourArea)
        x, y, w_ojo, h_ojo = cv2.boundingRect(c)
        mf = np.zeros_like(img_rgb)
        cv2.drawContours(mf, [c], -1, (255,255,255), thickness=cv2.FILLED)
        img_rec = cv2.bitwise_and(img_bg, mf)[y:y+h_ojo, x:x+w_ojo]
        md = max(w_ojo, h_ojo)
        img_cuadrada = cv2.copyMakeBorder(
            img_rec,
            (md-h_ojo)//2, md-h_ojo-(md-h_ojo)//2,
            (md-w_ojo)//2, md-w_ojo-(md-w_ojo)//2,
            cv2.BORDER_CONSTANT, value=[0,0,0]
        )
    else:
        h, w = img_bg.shape[:2]
        md   = min(h, w)
        img_cuadrada = aplicar_mascara_circular(
            img_bg[(h-md)//2:(h-md)//2+md, (w-md)//2:(w-md)//2+md].copy()
        )

    img_224 = cv2.resize(img_cuadrada, (224, 224), interpolation=cv2.INTER_AREA)
    gray_f  = cv2.cvtColor(img_224, cv2.COLOR_RGB2GRAY)
    img_final = img_224.copy()
    img_final[gray_f < 5] = 0
    return img_final

# Función Principal de Inferencia
def predecir_imagen_bytes(image_bytes: bytes) -> dict:
    # 1. Convertir bytes de HTTP a Matriz
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_raw = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_raw is None:
        raise ValueError("El archivo enviado no es una imagen válida o está corrupto.")
        
    img_rgb = cv2.cvtColor(img_raw, cv2.COLOR_BGR2RGB)

    # 2. Preprocesamiento de la imagen
    img_procesada = aplicar_pipeline_core(img_rgb)

    # 3. Transformación a Tensor
    transform_inferencia = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
    ])
    img_tensor = transform_inferencia(Image.fromarray(img_procesada)).unsqueeze(0).to(DEVICE)

    # 4. Predicción del modelo
    modelo = get_modelo()
    with torch.no_grad():
        logits = modelo(img_tensor)
        probs  = torch.softmax(logits, dim=1).cpu().numpy()[0]
        pred_idx = int(np.argmax(probs))
        confianza = float(probs[pred_idx])

    # 5. Generación del mapa de calor Grad-CAM
    # Apunta a la última capa convolucional de ResNet50
    target_layers = [modelo.model.layer4[-1]]
    cam = GradCAM(model=modelo, target_layers=target_layers)
    grayscale_cam = cam(input_tensor=img_tensor, targets=None)[0, :]
    rgb_img_float = img_procesada.astype(np.float32) / 255.0
    cam_image_array = show_cam_on_image(rgb_img_float, grayscale_cam, use_rgb=True)

    # 6. Diccionario con los resultados para el Frontend
    return {
        "success": True,
        "diagnostico_codigo": pred_idx,
        "diagnostico_texto": GRADOS[pred_idx],
        "confianza_general": round(confianza * 100, 2),
        "probabilidades_detalle": {
            "G0_Sin_DR": round(float(probs[0]) * 100, 2),
            "G1_Leve": round(float(probs[1]) * 100, 2),
            "G2_Moderada": round(float(probs[2]) * 100, 2),
            "G3_Severa": round(float(probs[3]) * 100, 2),
            "G4_Proliferativa": round(float(probs[4]) * 100, 2)
        },
        "cam_image_array": cam_image_array
    }