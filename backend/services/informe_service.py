import json
from flask import current_app
from src.repositories.informe_repository import InformeRepository


def _extraer_conclusion(datos_estructurados):
    if not isinstance(datos_estructurados, dict):
        return None

    conclusion = datos_estructurados.get("conclusion")
    if isinstance(conclusion, list):
        items = [str(item).strip() for item in conclusion if str(item).strip()]
        return "\n".join(items) if items else None
    if conclusion is None:
        return None

    texto = str(conclusion).strip()
    return texto or None


def obtener_tipos():
    tipos = InformeRepository.listar_tipos_informe_activos()
    return {"success": True, "data": tipos}, 200

def crear_nuevo_informe(datos, usuario_id):
    paciente_id = datos.get("paciente_id")
    tipo_informe_id = datos.get("tipo_informe_id")
    datos_estructurados = datos.get("datos_estructurados", {})
    conclusion = _extraer_conclusion(datos_estructurados)
    visita_id = datos.get("visita_id") or datos.get("diagnostico_id")

    if not paciente_id or not tipo_informe_id:
        return {"success": False, "message": "paciente_id y tipo_informe_id son obligatorios."}, 400

    tipo = InformeRepository.obtener_tipo_informe_por_id(tipo_informe_id)
    if not tipo:
        return {"success": False, "message": "El tipo de informe no existe o está inactivo."}, 404

    try:
        if visita_id:
            InformeRepository.validar_visita(int(visita_id), int(paciente_id))
            visita_id = int(visita_id)
        else:
            visita_id = InformeRepository.crear_visita(int(paciente_id), int(usuario_id))

        informe_id = InformeRepository.crear_informe(
            visita_id=visita_id,
            tipo_informe_id=int(tipo_informe_id),
            usuario_id=int(usuario_id),
            datos_estructurados=datos_estructurados,
            conclusion=conclusion,
            schema_version=tipo.get("schema_version_actual") or 1,
        )
    except Exception:
        current_app.logger.exception("Error al crear informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 400

    return {"success": True, "data": {"id": informe_id, "visita_id": visita_id, "diagnostico_id": visita_id}}, 201

def _parsear_datos(informe: dict) -> dict:
    if isinstance(informe.get("datos_estructurados"), str):
        try:
            informe["datos_estructurados"] = json.loads(informe["datos_estructurados"])
        except (json.JSONDecodeError, TypeError):
            pass
    if not informe.get("conclusion"):
        informe["conclusion"] = _extraer_conclusion(informe.get("datos_estructurados"))
    return informe

def obtener_informe(informe_id):
    informe = InformeRepository.obtener_informe_por_id(informe_id)
    if not informe:
        return {"success": False, "message": "Informe no encontrado."}, 404
    return {"success": True, "data": _parsear_datos(informe)}, 200

def actualizar_informe_existente(informe_id, datos):
    datos_estructurados = datos.get("datos_estructurados")

    if not datos_estructurados:
        return {"success": False, "message": "No hay datos para actualizar."}, 400

    filas = InformeRepository.actualizar_informe(
        informe_id,
        datos_estructurados,
        _extraer_conclusion(datos_estructurados),
    )
    if filas == 0:
        return {"success": False, "message": "Informe no encontrado o inactivo."}, 404

    return {"success": True, "message": "Informe actualizado correctamente."}, 200

def eliminar_informe_existente(informe_id):
    filas = InformeRepository.eliminar_informe(informe_id)
    if filas == 0:
        return {"success": False, "message": "Informe no encontrado o inactivo."}, 404
    return {"success": True, "message": "Informe eliminado correctamente."}, 200

def obtener_informes_paciente(paciente_id):
    informes = InformeRepository.listar_informes_por_paciente(paciente_id)
    return {"success": True, "data": [_parsear_datos(inf) for inf in informes]}, 200

def obtener_informes_por_paciente(paciente_id):
    return obtener_informes_paciente(paciente_id)

def consultar_informes_por_visita(visita_id):
    informes = InformeRepository.obtener_informes_por_visita(visita_id)
    return {"success": True, "data": [_parsear_datos(inf) for inf in informes]}, 200

def consultar_informes_por_diagnostico(diagnostico_id):
    return consultar_informes_por_visita(diagnostico_id)
