import os
import json
import uuid
from PIL import Image
import io
from werkzeug.datastructures import FileStorage
from dl_model.validator import validar_formato_y_dimensiones, validar_region_circular, validar_contenido_semantico
from dl_model.inference import predecir_imagen_bytes
from models.diagnosis_model import crear_diagnostico, validar_detalle_diagnostico, obtener_detalles_por_diagnostico

RD_LABELS = {
    0: "Normal",
    1: "RD Leve",
    2: "RD Moderado",
    3: "RD Severo",
    4: "RD Proliferativa",
}

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads', 'retinas')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def procesar_diagnostico(archivo_imagen: FileStorage, paciente_id: int, usuario_id: int, ojo_evaluado: str, diagnostico_id: int = None) -> dict:
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
            "resultado_ia": int(resultado_ia["diagnostico_codigo"]),
            "resultado_completo": json.dumps({
                "diagnostico_codigo": resultado_ia["diagnostico_codigo"],
                "diagnostico_texto": resultado_ia["diagnostico_texto"],
                "confianza_general": resultado_ia["confianza_general"],
                "probabilidades_detalle": resultado_ia["probabilidades_detalle"]
            })
        }

        nuevo_id, detalle_id = crear_diagnostico(datos_bd, diagnostico_id)

        # Convertir y guardar como JPG solo si el INSERT fue exitoso
        imagen = Image.open(io.BytesIO(image_bytes))
        if imagen.mode != 'RGB':
            imagen = imagen.convert('RGB')  # .tif puede venir en modo RGBA o L
        imagen.save(ruta_guardado, 'JPEG', quality=90)

        # Guardar físicamente la imagen del Grad-CAM
        Image.fromarray(cam_image_array).save(ruta_gradcam, 'JPEG', quality=90)

        resultado_ia["diagnostico_id"] = nuevo_id
        resultado_ia["detalle_id"] = detalle_id
        resultado_ia["gradcam_url"] = nombre_gradcam
        resultado_ia["mensaje"] = "Diagnóstico procesado y guardado en la Base de Datos con éxito."
        return {"success": True, "data": resultado_ia}

    except Exception as e:
        return {"success": False, "message": str(e)}


def consultar_detalles_existentes(diagnostico_id: int) -> dict:
    try:
        detalles = obtener_detalles_por_diagnostico(diagnostico_id)

        ojos = []
        for d in detalles:
            ojo = "OD" if d['ojo_evaluado'] == 'Derecho' else "OI"
            resultado_completo = json.loads(d['resultado_completo']) if d.get('resultado_completo') else None

            diagnostico_texto = None
            probabilidades_detalle = None
            if resultado_completo:
                diagnostico_texto = resultado_completo.get('diagnostico_texto')
                probabilidades_detalle = resultado_completo.get('probabilidades_detalle')
            if not diagnostico_texto:
                diagnostico_texto = RD_LABELS.get(d['resultado_ia'], "Desconocido")

            gradcam_url = d['imagen_url'].replace('.jpg', '_gradcam.jpg') if d['imagen_url'] else None

            ojo_data = {
                "detalle_id": d['id'],
                "ojo": ojo,
                "resultado_ia": d['resultado_ia'],
                "diagnostico_texto": diagnostico_texto,
                "confianza_general": float(d['probabilidad_ia']) * 100.0,
                "probabilidades_detalle": probabilidades_detalle,
                "diagnostico_final": d['diagnostico_final'],
                "estado_validacion": d['estado_validacion'],
                "comentario_medico": d['comentario_medico'],
                "imagen_url": d['imagen_url'],
                "gradcam_url": gradcam_url,
            }
            ojos.append(ojo_data)

        return {
            "success": True,
            "data": {
                "diagnostico_id": diagnostico_id,
                "ojos": ojos
            }
        }
    except Exception as e:
        return {"success": False, "message": str(e)}
    

def confirmar_validacion_detalle(detalle_id: int, diagnostico_final: int, comentario_medico: str = None) -> dict:
    try:
        nuevo_estado = validar_detalle_diagnostico(detalle_id, diagnostico_final, comentario_medico)
        
        return {
            "success": True,
            "data": {"estado_validacion": nuevo_estado},
            "message": "Diagnóstico validado y guardado exitosamente."
        }
    except Exception as e:
        return {"success": False, "message": str(e)}