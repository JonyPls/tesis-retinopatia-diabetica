import os
import uuid
from PIL import Image
import io
from werkzeug.datastructures import FileStorage
from dl_model.inference import predecir_imagen_bytes
from models.diagnosis_model import crear_diagnostico

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads', 'retinas')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def procesar_diagnostico(archivo_imagen: FileStorage, paciente_id: int, usuario_id: int, ojo_evaluado: str) -> dict:
    try:
        image_bytes = archivo_imagen.read()
        
        resultado_ia = predecir_imagen_bytes(image_bytes)

        # Siempre guardar como .jpg sin importar el formato original
        nombre_unico = f"P{paciente_id}_{ojo_evaluado}_{uuid.uuid4().hex[:6]}.jpg"
        ruta_guardado = os.path.join(UPLOAD_FOLDER, nombre_unico)

        datos_bd = {
            "paciente_id": paciente_id,
            "usuario_id": usuario_id,
            "ojo_evaluado": ojo_evaluado,
            "imagen_url": nombre_unico,
            "probabilidad_ia": float(resultado_ia["confianza_general"]) / 100.0,
            "resultado_ia": int(resultado_ia["diagnostico_codigo"])
        }

        nuevo_id = crear_diagnostico(datos_bd)

        # Convertir y guardar como JPG solo si el INSERT fue exitoso
        imagen = Image.open(io.BytesIO(image_bytes))
        if imagen.mode != 'RGB':
            imagen = imagen.convert('RGB')  # .tif puede venir en modo RGBA o L
        imagen.save(ruta_guardado, 'JPEG', quality=90)

        resultado_ia["diagnostico_id"] = nuevo_id
        resultado_ia["mensaje"] = "Diagnóstico procesado y guardado en la Base de Datos con éxito."
        return resultado_ia

    except Exception as e:
        return {"success": False, "error": str(e)}