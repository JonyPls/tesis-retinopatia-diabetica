import os
import json
import uuid
import hashlib
from flask import current_app
from PIL import Image
import io
from werkzeug.datastructures import FileStorage
from dl_model.validator import validar_formato_y_dimensiones, validar_region_circular, validar_contenido_semantico
from dl_model.inference import predecir_imagen_bytes
from src.repositories.diagnosis_repository import DiagnosisRepository

RD_LABELS = {
    0: "Normal",
    1: "RD Leve",
    2: "RD Moderado",
    3: "RD Severo",
    4: "RD Proliferativa",
}
DIAGNOSIS_NOT_FOUND_MESSAGE = "Diagnóstico no encontrado."

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads', 'retinas')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def procesar_diagnostico(archivo_imagen: FileStorage, paciente_id: int, usuario_id: int, ojo_evaluado: str, visita_id: int = None) -> dict:
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

        imagen = Image.open(io.BytesIO(image_bytes))

        datos_bd = {
            "paciente_id": paciente_id,
            "usuario_id": usuario_id,
            "ojo_evaluado": ojo_evaluado,
            "imagen_original_url": nombre_unico,
            "imagen_gradcam_url": nombre_gradcam,
            "nombre_archivo_original": archivo_imagen.filename,
            "formato_archivo": imagen.format,
            "ancho_px": imagen.width,
            "alto_px": imagen.height,
            "tamano_bytes": len(image_bytes),
            "hash_archivo": hashlib.sha256(image_bytes).hexdigest(),
            "probabilidad_ia": float(resultado_ia["confianza_general"]) / 100.0,
            "resultado_ia": int(resultado_ia["diagnostico_codigo"]),
            "resultado_completo": {
                "diagnostico_codigo": resultado_ia["diagnostico_codigo"],
                "diagnostico_texto": resultado_ia["diagnostico_texto"],
                "confianza_general": resultado_ia["confianza_general"],
                "probabilidades_detalle": resultado_ia["probabilidades_detalle"]
            },
            "modelo_nombre": "ResNet50",
        }

        visita_id, diagnostico_retinopatia_id, detalle_id = DiagnosisRepository.crear_diagnostico_y_detalle(datos_bd, visita_id)

        # Convertir y guardar como JPG solo si el INSERT fue exitoso
        if imagen.mode != 'RGB':
            imagen = imagen.convert('RGB')  # .tif puede venir en modo RGBA o L
        imagen.save(ruta_guardado, 'JPEG', quality=90)

        # Guardar físicamente la imagen del Grad-CAM
        Image.fromarray(cam_image_array).save(ruta_gradcam, 'JPEG', quality=90)

        resultado_ia["visita_id"] = visita_id
        resultado_ia["diagnostico_id"] = visita_id
        resultado_ia["diagnostico_retinopatia_id"] = diagnostico_retinopatia_id
        resultado_ia["detalle_id"] = detalle_id
        resultado_ia["gradcam_url"] = nombre_gradcam
        resultado_ia["mensaje"] = "Diagnóstico procesado y guardado en la Base de Datos con éxito."
        return {"success": True, "data": resultado_ia}

    except Exception:
        current_app.logger.exception("Error al procesar diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}


def consultar_detalles_por_visita(visita_id: int) -> dict:
    return _consultar_detalles(visita_id=visita_id)


def consultar_detalles_existentes(diagnostico_id: int) -> dict:
    return _consultar_detalles(diagnostico_id=diagnostico_id)


def _consultar_detalles(visita_id: int = None, diagnostico_id: int = None) -> dict:
    try:
        if visita_id is not None:
            detalles = DiagnosisRepository.obtener_detalles_por_visita(visita_id)
            response_id = visita_id
        else:
            detalles = DiagnosisRepository.obtener_detalles_por_diagnostico(diagnostico_id)
            response_id = diagnostico_id

        if detalles is None:
            return {"success": False, "message": DIAGNOSIS_NOT_FOUND_MESSAGE}

        ojos = []
        for d in detalles:
            ojo = "OD" if d['ojo_evaluado'] == 'Derecho' else "OI"
            resultado_completo = d.get('resultado_completo')
            if isinstance(resultado_completo, str):
                resultado_completo = json.loads(resultado_completo)

            diagnostico_texto = None
            probabilidades_detalle = None
            if resultado_completo:
                diagnostico_texto = resultado_completo.get('diagnostico_texto')
                probabilidades_detalle = resultado_completo.get('probabilidades_detalle')
            if not diagnostico_texto:
                diagnostico_texto = RD_LABELS.get(d['resultado_ia'], "Desconocido")

            gradcam_url = d.get('gradcam_url')
            if not gradcam_url and d['imagen_url']:
                gradcam_url = d['imagen_url'].replace('.jpg', '_gradcam.jpg')

            ojo_data = {
                "detalle_id": d['id'],
                "ojo": ojo,
                "resultado_ia": d['resultado_ia'],
                "diagnostico_texto": diagnostico_texto,
                "confianza_general": float(d['probabilidad_ia']) * 100.0 if d['probabilidad_ia'] is not None else 0.0,
                "probabilidades_detalle": probabilidades_detalle,
                "diagnostico_final": d['diagnostico_final'],
                "estado_validacion": d['estado_validacion'],
                "comentario_medico": d['comentario_medico'],
                "motivo_correccion": d['motivo_correccion'],
                "imagen_url": d['imagen_url'],
                "gradcam_url": gradcam_url,
            }
            ojos.append(ojo_data)

        return {
            "success": True,
            "data": {
                "visita_id": response_id if visita_id is not None else None,
                "diagnostico_id": response_id,
                "ojos": ojos
            }
        }
    except Exception:
        current_app.logger.error("Error al consultar detalles de diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}
    

def confirmar_validacion_detalle(
    detalle_id: int,
    diagnostico_final: int,
    comentario_medico: str = None,
    motivo_correccion: str = None,
    usuario_id: int = None,
) -> dict:
    try:
        nuevo_estado = DiagnosisRepository.validar_detalle_diagnostico(
            detalle_id,
            diagnostico_final,
            comentario_medico,
            motivo_correccion,
            usuario_id,
        )
        
        return {
            "success": True,
            "data": {"estado_validacion": nuevo_estado},
            "message": "Diagnóstico validado y guardado exitosamente."
        }
    except Exception:
        current_app.logger.exception("Error al confirmar validacion de diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}
