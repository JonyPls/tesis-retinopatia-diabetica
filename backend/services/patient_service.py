from models.patient_model import (
    obtener_pacientes,
    obtener_paciente_por_nrodocumento,
    insertar_paciente,
    obtener_paciente_por_id,
    obtener_diagnosticos_paciente,
    buscar_paciente
)

def obtener_todos_pacientes():
    try:
        pacientes = obtener_pacientes()
        return {
            "status": "success",
            "data": pacientes
        }, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500

def registrar_nuevo_paciente(datos_paciente_dict):
    tipo_doc = datos_paciente_dict.get('tipo_doc')
    nro_documento = datos_paciente_dict.get('nro_documento')
    nombres = datos_paciente_dict.get('nombres')
    apellidos = datos_paciente_dict.get('apellidos')
    sexo = datos_paciente_dict.get('sexo')
    fecha_nacimiento = datos_paciente_dict.get('fecha_nacimiento')
    telefono = datos_paciente_dict.get('telefono')

    if not all([tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono]):
        return {"status": "error", "message": "Todos los campos son obligatorios"}, 400

    try:
        # Verificar si existe ya el número de documento
        if obtener_paciente_por_nrodocumento(nro_documento):
            return {"status": "error", "message": "El documento ya se encuentra registrado en el sistema"}, 409

        insertar_paciente(tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono)
        return {"status": "success", "message": "Paciente registrado correctamente"}, 201     
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500

def obtener_detalle_paciente(paciente_id):
    try:
        paciente = obtener_paciente_por_id(paciente_id)
        if paciente:
            return {
                "status": "success",
                "data": paciente
            }, 200
        else:
            return {"status": "error", "message": "Paciente no encontrado"}, 404
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


def obtener_historial_diagnosticos(paciente_id):
    try:
        historial = obtener_diagnosticos_paciente(paciente_id)
        return {
            "status": "success",
            "data": historial
        }, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


def buscar_pacientes_dinamico(query_text):
    try:
        resultados = buscar_paciente(query_text)
        return {
            "status": "success",
            "data": resultados
        }, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500