import os
import uuid
from PIL import Image
import io
from werkzeug.datastructures import FileStorage
from dl_model.validator import validar_formato_y_dimensiones, validar_region_circular, validar_contenido_semantico
from dl_model.inference import predecir_imagen_bytes
from models.diagnosis_model import crear_diagnostico, validar_diagnostico

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads', 'retinas')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def procesar_diagnostico(archivo_imagen: FileStorage, paciente_id: int, usuario_id: int, ojo_evaluado: str) -> dict:
    try:
        image_bytes = archivo_imagen.read()

        # Capa 1 de Validación
        check = validar_formato_y_dimensiones(image_bytes)
        if not check["valido"]:
            return {"success": False, "message": check["error"]}
        
        # Capa 2 de Validación
        check = validar_region_circular(image_bytes)
        if not check["valido"]:
            return {"success": False, "message": check["error"]}
        
        # Capa 3 de Validación
        check = validar_contenido_semantico(image_bytes)
        if not check["valido"]:
            return {"success": False, "message": check["error"]}
        
        
        # Proceso normal al ser una retinografía
        resultado_ia = predecir_imagen_bytes(image_bytes)

        cam_image_array = resultado_ia.pop("cam_image_array")

        # Siempre guardar como .jpg sin importar el formato original
        nombre_unico = f"P{paciente_id}_{ojo_evaluado}_{uuid.uuid4().hex[:6]}.jpg"
        nombre_gradcam = nombre_unico.replace('.jpg', '_gradcam.jpg')

        ruta_guardado = os.path.join(UPLOAD_FOLDER, nombre_unico)
        ruta_gradcam = os.path.join(UPLOAD_FOLDER, nombre_gradcam)

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

        # Guardar físicamente la imagen del Grad-CAM
        Image.fromarray(cam_image_array).save(ruta_gradcam, 'JPEG', quality=90)

        resultado_ia["diagnostico_id"] = nuevo_id
        resultado_ia["gradcam_url"] = nombre_gradcam
        resultado_ia["mensaje"] = "Diagnóstico procesado y guardado en la Base de Datos con éxito."
        return {"success": True, "data": resultado_ia}

    except Exception as e:
        return {"success": False, "message": str(e)}
    

def confirmar_validacion_diagnostico(diagnostico_id: int, diagnostico_final: int, comentario_medico: str = None) -> dict:
    try:
        # Llamamos al modelo para hacer el UPDATE en la BD
        nuevo_estado = validar_diagnostico(diagnostico_id, diagnostico_final, comentario_medico)
        
        return {
            "success": True,
            "data": {"estado_validacion": nuevo_estado},
            "message": "Diagnóstico validado y guardado exitosamente."
        }
    except Exception as e:
        return {"success": False, "message": str(e)}