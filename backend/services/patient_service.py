from src.repositories.patient_repository import PatientRepository
from src.repositories.document_repository import DocumentRepository
from src.models.patient_entities import Paciente
from datetime import date, datetime
import re

DOCUMENT_PATTERNS = {
    'DNI': (re.compile(r'^\d{8}$'), 'El DNI debe tener exactamente 8 digitos.'),
    'CE': (re.compile(r'^[A-Z0-9]{8,12}$'), 'El CE debe tener entre 8 y 12 caracteres alfanumericos.'),
    'PAS': (re.compile(r'^[A-Z0-9]{3,9}$'), 'El Pasaporte debe tener entre 3 y 9 caracteres alfanumericos.'),
}
NAME_PATTERN = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$")
EMAIL_PATTERN = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
MAX_PATIENT_AGE = 120


def _clean_text(value):
    if value is None:
        return None
    normalized = ' '.join(str(value).strip().split())
    return normalized or None


def _clean_multiline_text(value):
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_document(value, tipo_doc):
    raw = str(value or '').strip()
    if tipo_doc == 'DNI':
        return re.sub(r'\D', '', raw)
    return re.sub(r'[^A-Za-z0-9]', '', raw).upper()


def _parse_birth_date(value):
    try:
        parsed = datetime.strptime(str(value), '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None, 'La fecha de nacimiento no es valida.'

    today = date.today()
    if parsed > today:
        return None, 'La fecha de nacimiento no puede ser futura.'

    age = today.year - parsed.year - (
        (today.month, today.day) < (parsed.month, parsed.day)
    )
    if age > MAX_PATIENT_AGE:
        return None, f'La edad del paciente no puede superar {MAX_PATIENT_AGE} años.'

    return parsed, None


def _validate_patient_data(
    tipo_doc_codigo,
    nro_documento,
    nombres,
    apellidos,
    sexo,
    fecha_nacimiento,
    telefono,
    correo,
    consentimiento_informado,
):
    if not all([tipo_doc_codigo, nro_documento, nombres, apellidos, sexo, fecha_nacimiento]):
        return 'Documento, nombres, apellidos, sexo y fecha de nacimiento son obligatorios'

    pattern_config = DOCUMENT_PATTERNS.get(tipo_doc_codigo)
    if not pattern_config:
        return 'Tipo de documento invalido'

    pattern, message = pattern_config
    if not pattern.match(nro_documento):
        return message

    if len(nombres) < 2 or len(nombres) > 80:
        return 'Los nombres deben tener entre 2 y 80 caracteres.'
    if len(apellidos) < 2 or len(apellidos) > 100:
        return 'Los apellidos deben tener entre 2 y 100 caracteres.'
    if not NAME_PATTERN.match(nombres):
        return 'Los nombres solo deben contener letras, espacios, guiones o apostrofes.'
    if not NAME_PATTERN.match(apellidos):
        return 'Los apellidos solo deben contener letras, espacios, guiones o apostrofes.'

    if sexo not in ('Masculino', 'Femenino'):
        return 'Debe seleccionar un sexo valido.'

    if telefono and not re.match(r'^9\d{8}$', telefono):
        return 'El telefono debe tener 9 digitos y empezar con 9.'

    if correo and (len(correo) > 150 or not EMAIL_PATTERN.match(correo)):
        return 'Ingrese un correo electronico valido de maximo 150 caracteres.'

    if not consentimiento_informado:
        return 'Debe registrar el consentimiento informado del paciente'

    return None

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
    tipo_doc_codigo = _clean_text(datos_paciente_dict.get('tipo_doc'))
    tipo_doc_codigo = tipo_doc_codigo.upper() if tipo_doc_codigo else None
    nro_documento = _normalize_document(datos_paciente_dict.get('nro_documento'), tipo_doc_codigo)
    nombres = _clean_text(datos_paciente_dict.get('nombres'))
    apellidos = _clean_text(datos_paciente_dict.get('apellidos'))
    sexo = _clean_text(datos_paciente_dict.get('sexo'))
    fecha_nacimiento = datos_paciente_dict.get('fecha_nacimiento')
    telefono = re.sub(r'\D', '', str(datos_paciente_dict.get('telefono') or '')) or None
    correo = _clean_text(datos_paciente_dict.get('correo'))
    correo = correo.lower() if correo else None
    direccion = _clean_text(datos_paciente_dict.get('direccion'))
    antecedentes_clinicos = _clean_multiline_text(datos_paciente_dict.get('antecedentes_clinicos'))
    alergias = _clean_multiline_text(datos_paciente_dict.get('alergias'))
    consentimiento_raw = datos_paciente_dict.get('consentimiento_informado')
    consentimiento_informado = consentimiento_raw is True or str(consentimiento_raw).lower() in ('1', 'true', 'si', 'sí')

    validation_error = _validate_patient_data(
        tipo_doc_codigo,
        nro_documento,
        nombres,
        apellidos,
        sexo,
        fecha_nacimiento,
        telefono,
        correo,
        consentimiento_informado,
    )
    if validation_error:
        return {"success": False, "message": validation_error}, 400

    parsed_birth_date, birth_date_error = _parse_birth_date(fecha_nacimiento)
    if birth_date_error:
        return {"success": False, "message": birth_date_error}, 400

    if direccion and len(direccion) > 255:
        return {"success": False, "message": "La direccion no puede superar 255 caracteres."}, 400
    if antecedentes_clinicos and len(antecedentes_clinicos) > 2000:
        return {"success": False, "message": "Los antecedentes clinicos no pueden superar 2000 caracteres."}, 400
    if alergias and len(alergias) > 1000:
        return {"success": False, "message": "Las alergias no pueden superar 1000 caracteres."}, 400

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
            fecha_nacimiento=parsed_birth_date, 
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
