import json
from models.informe_model import (
    listar_tipos_informe_activos,
    obtener_tipo_informe_por_id,
    crear_diagnostico_simple,
    crear_informe,
    obtener_informe_por_id,
    actualizar_informe,
    eliminar_informe,
    listar_informes_por_paciente,
    obtener_informes_por_diagnostico,
)
from flask import jsonify

def obtener_tipos():
    tipos = listar_tipos_informe_activos()
    return {"success": True, "data": tipos}, 200

def crear_nuevo_informe(datos, usuario_id):
    paciente_id = datos.get("paciente_id")
    tipo_informe_id = datos.get("tipo_informe_id")
    datos_estructurados = datos.get("datos_estructurados", {})
    diagnostico_id = datos.get("diagnostico_id")

    if not paciente_id or not tipo_informe_id:
        return {"success": False, "message": "paciente_id y tipo_informe_id son obligatorios."}, 400

    tipo = obtener_tipo_informe_por_id(tipo_informe_id)
    if not tipo:
        return {"success": False, "message": "El tipo de informe no existe o está inactivo."}, 404

    if not diagnostico_id:
        diagnostico_id = crear_diagnostico_simple(paciente_id, usuario_id)

    datos_json = json.dumps(datos_estructurados, ensure_ascii=False)
    informe_id = crear_informe(diagnostico_id, tipo_informe_id, datos_json)

    return {"success": True, "data": {"id": informe_id, "diagnostico_id": diagnostico_id}}, 201

def obtener_informe(informe_id):
    informe = obtener_informe_por_id(informe_id)
    if not informe:
        return {"success": False, "message": "Informe no encontrado."}, 404
    return {"success": True, "data": informe}, 200

def actualizar_informe_existente(informe_id, datos):
    datos_estructurados = datos.get("datos_estructurados")

    if not datos_estructurados:
        return {"success": False, "message": "No hay datos para actualizar."}, 400

    datos_json = json.dumps(datos_estructurados, ensure_ascii=False) if datos_estructurados else None
    filas = actualizar_informe(informe_id, datos_json)
    if filas == 0:
        return {"success": False, "message": "Informe no encontrado o inactivo."}, 404

    return {"success": True, "message": "Informe actualizado correctamente."}, 200

def eliminar_informe_existente(informe_id):
    filas = eliminar_informe(informe_id)
    if filas == 0:
        return {"success": False, "message": "Informe no encontrado o inactivo."}, 404
    return {"success": True, "message": "Informe eliminado correctamente."}, 200

def obtener_informes_paciente(paciente_id):
    informes = listar_informes_por_paciente(paciente_id)
    return {"success": True, "data": informes}, 200

def obtener_informes_por_paciente(paciente_id):
    return obtener_informes_paciente(paciente_id)

def consultar_informes_por_diagnostico(diagnostico_id):
    informes = obtener_informes_por_diagnostico(diagnostico_id)
    return {"success": True, "data": informes}, 200
