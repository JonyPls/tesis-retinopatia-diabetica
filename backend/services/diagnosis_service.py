import os
import json
import uuid
import hashlib
from flask import current_app
from PIL import Image
import io
from werkzeug.datastructures import FileStorage
from dl_model.validator import validar_formato_y_dimensiones, validar_region_circular, validar_contenido_semantico
from dl_model.validator import MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS
from dl_model.inference import predecir_imagen_bytes
from src.repositories.diagnosis_repository import DiagnosisRepository, DiagnosisValidationError
from database import db
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from utils.diagnosis_storage import DiagnosisFiles
from services import retinograph_confirmation_service as confirmations
from src.repositories.diagnosis_discard_repository import DiagnosisDiscardRepository
from utils.diagnosis_discard_gate import DiscardError

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

def procesar_diagnostico(archivo_imagen: FileStorage, paciente_id: int, usuario_id: int,
                         ojo_evaluado: str, visita_id: int = None,
                         *, require_existing_diagnosis=False,
                         confirmacion_token=None) -> tuple[dict, int]:
    files = None
    commit_attempted = False
    detalle_id = None
    nombre_unico = nombre_gradcam = None
    confirmed = None
    try:
        # Las lecturas baratas preceden a CLIP/ResNet50; el repositorio las
        # repite con bloqueo al escribir para cerrar la carrera entre peticiones.
        DiagnosisRepository.comprobar_creacion(
            paciente_id, ojo_evaluado, visita_id,
            require_existing_diagnosis=require_existing_diagnosis,
        )
        inference_revision = DiagnosisDiscardRepository.capture_inference(visita_id)
        if confirmacion_token is not None:
            confirmed = confirmations.load_for_inference(
                confirmacion_token, paciente_id, ojo_evaluado, usuario_id)
        # Auth/preflight inician una transacción de lectura. Soltar su snapshot
        # antes de ejecutar modelos o crear provisionales; revalidar bajo lock.
        db.session.rollback()
        if confirmed is not None:
            # El navegador nunca reenvía la exportación. La validación y la IA
            # leen exclusivamente los bytes de la copia privada verificada.
            archivo_imagen = FileStorage(stream=io.BytesIO(confirmed.data),
                                         filename=confirmed.filename,
                                         content_type=confirmed.mimetype)
        max_bytes = current_app.config.get('DIAGNOSIS_MAX_IMAGE_BYTES', MAX_IMAGE_BYTES)
        image_bytes = archivo_imagen.stream.read(max_bytes + 1)
        if len(image_bytes) > max_bytes:
            return {"success": False, "message": "Archivo demasiado grande."}, 413

        # Capa 1 de Validación
        check = validar_formato_y_dimensiones(
            image_bytes, filename=archivo_imagen.filename,
            mimetype=archivo_imagen.mimetype,
            max_side=current_app.config.get('DIAGNOSIS_MAX_IMAGE_SIDE', MAX_IMAGE_SIDE),
            max_pixels=current_app.config.get('DIAGNOSIS_MAX_IMAGE_PIXELS', MAX_IMAGE_PIXELS),
        )
        if not check["valido"]:
            return {"success": False, "message": check["error"]}, 400
        
        # Capa 2 de Validación
        check = validar_region_circular(image_bytes)
        if not check["valido"]:
            return {"success": False, "message": check["error"]}, 400
        
        # Capa 3 de Validación
        check = validar_contenido_semantico(image_bytes)
        if not check["valido"]:
            if check.get("status") == 503:
                return {"success": False, "code": "VALIDADOR_IMAGEN_NO_DISPONIBLE",
                        "message": "Validación de imagen no disponible."}, 503
            if check.get("status") == 500:
                return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
            return {"success": False, "message": check["error"]}, 422
        
        
        # Proceso normal al ser una retinografía
        resultado_ia = predecir_imagen_bytes(image_bytes)

        cam_image_array = resultado_ia.pop("cam_image_array")

        # Siempre guardar como .jpg sin importar el formato original
        nombre_unico = f"P{paciente_id}_{ojo_evaluado}_{uuid.uuid4().hex}.jpg"
        nombre_gradcam = nombre_unico.replace('.jpg', '_gradcam.jpg')

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

        # Preparar ambos JPEG fuera de la transacción de escritura.
        files = DiagnosisFiles(UPLOAD_FOLDER)
        if imagen.mode != 'RGB':
            imagen = imagen.convert('RGB')
        original_temp = files.prepare(imagen)
        gradcam_temp = files.prepare(Image.fromarray(cam_image_array))

        if confirmed is not None:
            # Orden único: confirmación -> visita -> diagnóstico -> detalle.
            # La validación clínica y la inferencia ya finalizaron sin locks SQL.
            confirmations.lock_for_consumption(
                confirmacion_token, paciente_id, ojo_evaluado, usuario_id, confirmed)
        visita_id, diagnostico_retinopatia_id, detalle_id = DiagnosisRepository.crear_diagnostico_y_detalle(
            datos_bd, visita_id, require_existing_diagnosis=require_existing_diagnosis,
            inference_revision=inference_revision,
        )
        if confirmed is not None:
            confirmations.consume_with_detail(
                confirmacion_token, paciente_id, ojo_evaluado, usuario_id,
                confirmed, detalle_id,
            )
        files.publish(original_temp, nombre_unico)
        files.publish(gradcam_temp, nombre_gradcam)
        commit_attempted = True
        db.session.commit()
        try:
            files.cleanup()
        except OSError:
            current_app.logger.warning('Provisionales de diagnóstico pendientes de conciliación')
        finally:
            files.release()

        resultado_ia["visita_id"] = visita_id
        resultado_ia["diagnostico_id"] = visita_id
        resultado_ia["diagnostico_retinopatia_id"] = diagnostico_retinopatia_id
        resultado_ia["detalle_id"] = detalle_id
        resultado_ia["gradcam_url"] = nombre_gradcam
        resultado_ia["mensaje"] = "Diagnóstico procesado y guardado en la Base de Datos con éxito."
        return {"success": True, "data": resultado_ia}, 200

    except DiscardError as error:
        _undo_creation(files, commit_attempted, detalle_id)
        return {"success": False, "code": error.code,
                "message": "Contexto de inferencia no disponible o modificado."}, error.status
    except (DiagnosisValidationError, confirmations.ConfirmationUseError) as error:
        _undo_creation(files, commit_attempted, detalle_id)
        return {"success": False, "message": str(error)}, error.status_code
    except IntegrityError as error:
        _undo_creation(files, commit_attempted, detalle_id)
        if getattr(error.orig, 'args', (None,))[0] == 1062:
            return {"success": False, "message": "Ya existe un resultado para este ojo."}, 409
        current_app.logger.error("Error de persistencia al procesar diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except Exception:
        _undo_creation(files, commit_attempted, detalle_id)
        current_app.logger.error("Error al procesar diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def _undo_creation(files, commit_attempted, detalle_id):
    """No borrar archivos si un COMMIT ambiguo pudo haber confirmado su fila."""
    try:
        db.session.rollback()
        rollback_ok = True
    except Exception:
        rollback_ok = False
        current_app.logger.error('Rollback de diagnóstico no confirmado; requiere conciliación')

    safe_to_remove = rollback_ok and not commit_attempted
    if commit_attempted and detalle_id is not None:
        try:
            # Conexión independiente: nunca decidir usando la sesión rota.
            with db.engine.connect() as connection:
                row = connection.execute(text(
                    'SELECT imagen_original_url, imagen_gradcam_url '
                    'FROM diagnosticos_retinopatia_detalle WHERE id = :id'
                ), {'id': detalle_id}).first()
            safe_to_remove = rollback_ok and row is None
            if row is not None:
                current_app.logger.warning('Commit de diagnóstico confirmado o ambiguo; conservar archivos')
        except Exception:
            safe_to_remove = False
            current_app.logger.error('Estado del commit no verificable; conservar archivos')
    if files is not None:
        try:
            files.cleanup(published=safe_to_remove)
        except OSError:
            current_app.logger.error('Limpieza incompleta; requiere conciliación')
        finally:
            files.release()


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
) -> tuple[dict, int]:
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
        }, 200
    except DiagnosisValidationError as error:
        db.session.rollback()
        return {"success": False, "message": str(error)}, error.status_code
    except Exception:
        db.session.rollback()
        current_app.logger.error("Error al confirmar validacion de diagnostico")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
