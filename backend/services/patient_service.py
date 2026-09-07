from src.repositories.patient_repository import PatientRepository
from src.repositories.document_repository import DocumentRepository
from src.models.patient_entities import Paciente
from datetime import datetime

def obtener_todos_pacientes():
    try:
        pacientes = PatientRepository.obtener_pacientes()
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
    telefono = datos_paciente_dict.get('telefono') or None
    correo = datos_paciente_dict.get('correo') or None
    direccion = datos_paciente_dict.get('direccion') or None
    antecedentes_clinicos = datos_paciente_dict.get('antecedentes_clinicos') or None
    alergias = datos_paciente_dict.get('alergias') or None
    consentimiento_raw = datos_paciente_dict.get('consentimiento_informado')
    consentimiento_informado = consentimiento_raw is True or str(consentimiento_raw).lower() in ('1', 'true', 'si', 'sí')

    if not all([tipo_doc_codigo, nro_documento, nombres, apellidos, sexo, fecha_nacimiento]):
        return {"success": False, "message": "Documento, nombres, apellidos, sexo y fecha de nacimiento son obligatorios"}, 400

    if not consentimiento_informado:
        return {"success": False, "message": "Debe registrar el consentimiento informado del paciente"}, 400

    # Convertir código de documento (ej. "DNI") a ID numérico de la BD
    td = DocumentRepository.obtener_tipo_documento_por_codigo(tipo_doc_codigo)
    if not td:
        return {"success": False, "message": "Tipo de documento inválido"}, 400
    tipo_doc_id = td["id"]

    try:
        # Verificar si existe ya el número de documento
        if PatientRepository.obtener_paciente_por_documento(tipo_doc_id, nro_documento):
            return {"success": False, "message": "El documento ya se encuentra registrado en el sistema"}, 409

        nuevo_paciente = Paciente(
            tipo_doc_id=tipo_doc_id,
            nro_documento=nro_documento, 
            nombres=nombres, 
            apellidos=apellidos, 
            sexo=sexo, 
            fecha_nacimiento=fecha_nacimiento, 
            telefono=telefono,
            correo=correo,
            direccion=direccion,
            antecedentes_clinicos=antecedentes_clinicos,
            alergias=alergias,
            consentimiento_informado=consentimiento_informado,
            fecha_consentimiento=datetime.now() if consentimiento_informado else None
        )
        PatientRepository.insertar_paciente(nuevo_paciente)
        paciente_creado = PatientRepository.obtener_paciente_por_id(nuevo_paciente.id)
        return {
            "success": True,
            "message": "Paciente registrado correctamente",
            "data": paciente_creado,
        }, 201
    except Exception as e:
        return {"success": False, "message": str(e)}, 500

def obtener_detalle_paciente(paciente_id):
    try:
        paciente = PatientRepository.obtener_paciente_por_id(paciente_id)
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
        historial = PatientRepository.obtener_diagnosticos_paciente(paciente_id)
        return {
            "success": True,
            "data": historial
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def buscar_pacientes_dinamico(query_text, page=1, per_page=5):
    try:
        resultados, total = PatientRepository.buscar_paciente(
            query_text,
            page=page,
            per_page=per_page,
        )
        return {
            "success": True,
            "data": resultados,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "has_more": page * per_page < total
            }
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def obtener_recientes(limit=6):
    try:
        pacientes = PatientRepository.obtener_pacientes_recientes(limit)
        return {"success": True, "data": pacientes}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500
