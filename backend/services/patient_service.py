from models.patient_model import (
    obtener_pacientes,
    obtener_paciente_por_nrodocumento,
    insertar_paciente,
    obtener_paciente_por_id,
    obtener_diagnosticos_paciente,
    buscar_paciente,
    obtener_pacientes_recientes
)
from models.document_model import obtener_tipo_documento_por_codigo

def obtener_todos_pacientes():
    try:
        pacientes = obtener_pacientes()
        return {
            "success": True,
            "data": pacientes
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500

def registrar_nuevo_paciente(datos_paciente_dict):
    tipo_doc_codigo = datos_paciente_dict.get('tipo_doc')
    nro_documento = datos_paciente_dict.get('nro_documento')
    nombres = datos_paciente_dict.get('nombres')
    apellidos = datos_paciente_dict.get('apellidos')
    sexo = datos_paciente_dict.get('sexo')
    fecha_nacimiento = datos_paciente_dict.get('fecha_nacimiento')
    telefono = datos_paciente_dict.get('telefono')

    if not all([tipo_doc_codigo, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono]):
        return {"success": False, "message": "Todos los campos son obligatorios"}, 400

    # Convertir código de documento (ej. "DNI") a ID numérico de la BD
    td = obtener_tipo_documento_por_codigo(tipo_doc_codigo)
    if not td:
        return {"success": False, "message": "Tipo de documento inválido"}, 400
    tipo_doc_id = td["id"]

    try:
        # Verificar si existe ya el número de documento
        if obtener_paciente_por_nrodocumento(nro_documento):
            return {"success": False, "message": "El documento ya se encuentra registrado en el sistema"}, 409

        insertar_paciente(tipo_doc_id, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono)
        return {"success": True, "message": "Paciente registrado correctamente"}, 201     
    except Exception as e:
        return {"success": False, "message": str(e)}, 500

def obtener_detalle_paciente(paciente_id):
    try:
        paciente = obtener_paciente_por_id(paciente_id)
        if paciente:
            return {
                "success": True,
                "data": paciente
            }, 200
        else:
            return {"success": False, "message": "Paciente no encontrado"}, 404
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def obtener_historial_diagnosticos(paciente_id):
    try:
        historial = obtener_diagnosticos_paciente(paciente_id)
        return {
            "success": True,
            "data": historial
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def buscar_pacientes_dinamico(query_text):
    try:
        resultados = buscar_paciente(query_text)
        return {
            "success": True,
            "data": resultados
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def obtener_recientes():
    try:
        pacientes = obtener_pacientes_recientes()
        return {"success": True, "data": pacientes}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500
