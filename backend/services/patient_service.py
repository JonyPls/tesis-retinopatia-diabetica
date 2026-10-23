from src.repositories.patient_repository import PatientRepository
from src.repositories.document_repository import DocumentRepository
from src.models.patient_entities import Paciente
from flask import current_app
from database import db
from datetime import date, datetime
import re
import unicodedata
from sqlalchemy.exc import IntegrityError
from zoneinfo import ZoneInfo
from utils.identity_validation import DOCUMENT_PATTERNS, valid_email as _valid_email

MAX_PATIENT_AGE = 120
MIN_BIRTH_DATE = date(1900, 1, 1)
CLINIC_ZONE = ZoneInfo('America/Lima')
CONFLICT_MESSAGES = {
    'nro_documento': 'El documento ya se encuentra registrado en el sistema.',
    'correo': 'El correo ya se encuentra registrado en el sistema.',
}
PATIENT_REGISTRATION_FIELDS = frozenset({
    'tipo_doc', 'nro_documento', 'nombres', 'apellidos', 'sexo',
    'fecha_nacimiento', 'telefono', 'correo', 'direccion',
    'consentimiento_informado',
})
PATIENT_ASSISTANCE_FIELDS = PATIENT_REGISTRATION_FIELDS | {'alergias'}
PATIENT_CLINICAL_FIELDS = PATIENT_ASSISTANCE_FIELDS | {'antecedentes_clinicos'}
PATIENT_CREATE_FIELDS = {
    'administrative': PATIENT_REGISTRATION_FIELDS,
    'assistance': PATIENT_ASSISTANCE_FIELDS,
    'clinical': PATIENT_CLINICAL_FIELDS,
}


def _clean_text(value):
    if value is None:
        return None
    normalized = ' '.join(str(value).strip().split())
    return normalized or None


def _valid_person_name(value):
    if not value or any(unicodedata.category(char) in ('Cc', 'Cf') for char in value):
        return False
    name = unicodedata.normalize('NFC', value)
    tokens = re.split(r" ?[-'’] ?| ", name)
    return bool(tokens) and all(token and all(
        char.isalpha() and unicodedata.name(char, '').startswith('LATIN ')
        for char in token) for token in tokens)


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


def _parse_birth_date(value, *, today=None):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('invalid civil date')
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError):
        return None, 'Verifica la fecha de nacimiento ingresada.'

    today = today or datetime.now(CLINIC_ZONE).date()
    if parsed < MIN_BIRTH_DATE:
        return None, 'La fecha de nacimiento debe ser igual o posterior al 01/01/1900.'
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
    errors = {}

    pattern_config = DOCUMENT_PATTERNS.get(tipo_doc_codigo)
    if not pattern_config:
        errors['tipo_doc'] = 'Tipo de documento inválido.'
    elif not pattern_config[0].fullmatch(nro_documento):
        errors['nro_documento'] = pattern_config[1]

    if not nombres:
        errors['nombres'] = 'Debe ingresar nombres.'
    elif len(nombres) < 2 or len(nombres) > 80:
        errors['nombres'] = 'Los nombres deben tener entre 2 y 80 caracteres.'
    elif not _valid_person_name(nombres):
        errors['nombres'] = 'Ingresa un nombre válido, sin números ni símbolos.'
    if not apellidos:
        errors['apellidos'] = 'Debe ingresar apellidos.'
    elif len(apellidos) < 2 or len(apellidos) > 100:
        errors['apellidos'] = 'Los apellidos deben tener entre 2 y 100 caracteres.'
    elif not _valid_person_name(apellidos):
        errors['apellidos'] = 'Ingresa un apellido válido, sin números ni símbolos.'

    if sexo not in ('Masculino', 'Femenino'):
        errors['sexo'] = 'Debe seleccionar un sexo válido.'

    if telefono and not re.match(r'^9\d{8}$', telefono):
        errors['telefono'] = 'El teléfono debe tener 9 dígitos y empezar con 9.'

    if correo and (len(correo) > 150 or not _valid_email(correo)):
        errors['correo'] = 'Ingresa un correo electrónico válido.'

    if not consentimiento_informado:
        errors['consent'] = 'Debe registrar el consentimiento informado del paciente.'

    return errors

def obtener_todos_pacientes(*, scope='clinical', include_severity=True):
    try:
        pacientes = PatientRepository.obtener_pacientes(
            scope=scope, include_severity=include_severity)
        return {
            "success": True,
            "data": pacientes
        }, 200
    except Exception:
        current_app.logger.exception("Error al obtener pacientes")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500

def registrar_nuevo_paciente(datos_paciente_dict, *, create_scope, read_scope):
    allowed = PATIENT_CREATE_FIELDS.get(create_scope)
    if not isinstance(datos_paciente_dict, dict) or allowed is None:
        return {"success": False, "message": "Solicitud inválida."}, 400
    if any(not isinstance(key, str) or key not in allowed for key in datos_paciente_dict):
        return {"success": False, "message": "La solicitud contiene campos no permitidos."}, 400
    if any(not isinstance(value, (str, type(None))) for key, value in
           datos_paciente_dict.items() if key != 'consentimiento_informado'):
        return {"success": False, "message": "La solicitud contiene valores no válidos."}, 400
    if ('consentimiento_informado' in datos_paciente_dict and
            not isinstance(datos_paciente_dict['consentimiento_informado'], bool)):
        return {"success": False, "message": "La solicitud contiene valores no válidos."}, 400
    if read_scope not in (None, 'administrative', 'assistance', 'clinical'):
        return {"success": False, "message": "Solicitud inválida."}, 400

    tipo_doc_codigo = _clean_text(datos_paciente_dict.get('tipo_doc'))
    tipo_doc_codigo = tipo_doc_codigo.upper() if tipo_doc_codigo else None
    nro_documento = _normalize_document(datos_paciente_dict.get('nro_documento'), tipo_doc_codigo)
    raw_names = (datos_paciente_dict.get('nombres'), datos_paciente_dict.get('apellidos'))
    if any(value and any(unicodedata.category(char) in ('Cc', 'Cf') for char in value)
           for value in raw_names):
        return {"success": False, "message": "Ingresa nombres y apellidos válidos, sin caracteres de control."}, 400
    nombres = _clean_text(raw_names[0])
    apellidos = _clean_text(raw_names[1])
    nombres = unicodedata.normalize('NFC', nombres) if nombres else None
    apellidos = unicodedata.normalize('NFC', apellidos) if apellidos else None
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

    validation_errors = _validate_patient_data(
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
    parsed_birth_date, birth_date_error = _parse_birth_date(fecha_nacimiento)
    if birth_date_error:
        validation_errors['fecha_nacimiento'] = birth_date_error

    if direccion and len(direccion) > 255:
        validation_errors['direccion'] = 'La dirección no puede superar 255 caracteres.'
    if antecedentes_clinicos and len(antecedentes_clinicos) > 2000:
        validation_errors['antecedentes_clinicos'] = 'Los antecedentes clínicos no pueden superar 2000 caracteres.'
    if alergias and len(alergias) > 1000:
        validation_errors['alergias'] = 'Las alergias no pueden superar 1000 caracteres.'
    if validation_errors:
        return {"success": False, "message": "Revisa los campos señalados.",
                "errors": validation_errors}, 400

    # Convertir código de documento (ej. "DNI") a ID numérico de la BD
    td = DocumentRepository.obtener_tipo_documento_por_codigo(tipo_doc_codigo)
    if not td:
        return {"success": False, "message": "Tipo de documento inválido"}, 400
    tipo_doc_id = td["id"]

    try:
        errors = {}
        if PatientRepository.obtener_paciente_por_documento(tipo_doc_id, nro_documento):
            errors['nro_documento'] = CONFLICT_MESSAGES['nro_documento']
        if correo and PatientRepository.obtener_paciente_por_correo(correo):
            errors['correo'] = CONFLICT_MESSAGES['correo']
        if errors:
            return {"success": False, "message": "Revisa los campos señalados.", "errors": errors}, 409

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
        patient_id = PatientRepository.insertar_paciente(nuevo_paciente)
        paciente_creado = ({'id': patient_id} if read_scope is None else
                           PatientRepository.obtener_paciente_por_id(
                               patient_id, scope=read_scope))
        if not paciente_creado:
            raise RuntimeError('Created patient lookup failed')
        db.session.commit()
        return {
            "success": True,
            "message": "Paciente registrado correctamente",
            "data": paciente_creado,
        }, 201
    except IntegrityError as error:
        db.session.rollback()
        # Solo clasificar índices conocidos: otros fallos no son errores de usuario.
        code = getattr(error.orig, 'args', (None,))[0]
        detail = str(error.orig).lower()
        field = ('nro_documento' if 'uq_pacientes_documento' in detail else
                 'correo' if 'uq_pacientes_correo_normalizado' in detail else None)
        if code == 1062 and field:
            return {"success": False, "message": "Revisa los campos señalados.",
                    "errors": {field: CONFLICT_MESSAGES[field]}}, 409
        current_app.logger.error("Error de integridad al registrar paciente")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except Exception:
        db.session.rollback()
        # No registrar SQL ni parámetros con identidad o contenido clínico.
        current_app.logger.error("Error al registrar paciente")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500

def obtener_detalle_paciente(paciente_id, *, scope='clinical'):
    try:
        paciente = PatientRepository.obtener_paciente_por_id(paciente_id, scope=scope)
        if paciente:
            return {
                "success": True,
                "data": paciente
            }, 200
        else:
            return {"success": False, "message": "Paciente no encontrado"}, 404
    except Exception:
        current_app.logger.exception("Error al obtener detalle de paciente")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def obtener_historial_diagnosticos(paciente_id):
    try:
        if not PatientRepository.existe_paciente_activo(paciente_id):
            return {"success": False, "message": "Paciente no encontrado"}, 404
        historial = PatientRepository.obtener_diagnosticos_paciente(paciente_id)
        return {
            "success": True,
            "data": historial
        }, 200
    except Exception:
        # No registrar consultas ni parámetros clínicos en trazas de errores.
        current_app.logger.error("Error al obtener historial de diagnosticos")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def buscar_pacientes_dinamico(query_text, page=1, per_page=5, *, include_last_visit=True):
    try:
        resultados, total = PatientRepository.buscar_paciente(
            query_text,
            page=page,
            per_page=per_page,
            include_last_visit=include_last_visit,
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
    except Exception:
        current_app.logger.exception("Error al buscar pacientes")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def obtener_recientes(limit=6, *, include_last_visit=True):
    try:
        pacientes = PatientRepository.obtener_pacientes_recientes(
            limit, include_last_visit=include_last_visit)
        return {"success": True, "data": pacientes}, 200
    except Exception:
        current_app.logger.exception("Error al obtener pacientes recientes")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
