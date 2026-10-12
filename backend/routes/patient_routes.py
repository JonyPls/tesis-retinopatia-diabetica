from datetime import date, datetime
from flask import Blueprint, request, jsonify
from services.patient_service import (
    obtener_todos_pacientes, 
    registrar_nuevo_paciente, 
    obtener_detalle_paciente, 
    obtener_historial_diagnosticos,
    buscar_pacientes_dinamico,
    obtener_recientes
)
from utils.security import clinical_access_required, token_required
from utils.strict_authorization import (
    evaluate_operation, patient_create_scope, patient_read_scope,
    strict_authorization_required,
)

SEARCH_FIELDS = (
    'id', 'tipo_doc_abrev', 'tipo_doc_id', 'tipo_doc',
    'nro_documento', 'nombres', 'apellidos',
)
RECENT_FIELDS = ('id', 'tipo_doc_abrev', 'nro_documento', 'nombres', 'apellidos')
LIST_FIELDS = (
    'id', 'tipo_doc_abrev', 'tipo_doc_id', 'nro_documento', 'nombres',
    'apellidos', 'sexo', 'fecha_nacimiento', 'telefono', 'correo', 'direccion',
)
CONSENT_FIELDS = ('consentimiento_informado', 'fecha_consentimiento')
DETAIL_FIELDS = LIST_FIELDS + ('tipo_doc',)


def _project_patient_row(row, fields):
    projected = {}
    for key in fields:
        if key in row:
            value = row[key]
            if not isinstance(value, (str, int, date, datetime, type(None))):
                raise TypeError('Invalid patient lookup field')
            projected[key] = value
    return projected


def _project_lookup(response, status, fields, scope, *, paginated=False):
    if status != 200:
        return jsonify(response), status
    try:
        if not isinstance(response, dict) or not isinstance(response.get('data'), list):
            raise TypeError('Invalid patient lookup response')
        if not all(isinstance(row, dict) for row in response['data']):
            raise TypeError('Invalid patient lookup row')
        if response['success'] is not True:
            raise TypeError('Invalid patient lookup success')
        allowed = fields + (('ultima_visita',) if scope != 'administrative' else ())
        projected = {'success': True, 'data': [
            _project_patient_row(row, allowed) for row in response['data']
        ]}
        if paginated:
            projected['pagination'] = {
                key: response['pagination'][key]
                for key in ('page', 'per_page', 'total', 'has_more')
            }
            if any(isinstance(value, (dict, list)) for value in
                   projected['pagination'].values()):
                raise TypeError('Invalid patient lookup pagination')
        return jsonify(projected), status
    except (KeyError, TypeError, AttributeError):
        # Una respuesta inesperada nunca debe serializar datos adicionales.
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


def _patient_scope():
    try:
        return patient_read_scope(getattr(request, 'authenticated_user', None))
    except Exception:
        return None


def _project_patient_response(response, status, scope, *, listing=False,
                              include_severity=False, history_available=False):
    if status != 200:
        return jsonify(response), status
    try:
        if not isinstance(response, dict) or response['success'] is not True:
            raise TypeError('Invalid patient response')
        if listing:
            if not isinstance(response['data'], list) or not all(
                    isinstance(row, dict) for row in response['data']):
                raise TypeError('Invalid patient list')
            fields = LIST_FIELDS
            if scope != 'administrative':
                fields += CONSENT_FIELDS + ('ultima_visita',)
            if include_severity:
                fields += ('maxima_gravedad',)
            data = [_project_patient_row(row, fields) for row in response['data']]
        else:
            if not isinstance(response['data'], dict):
                raise TypeError('Invalid patient detail')
            fields = DETAIL_FIELDS
            if scope != 'administrative':
                fields += CONSENT_FIELDS
            if scope == 'clinical':
                fields += ('antecedentes_clinicos', 'alergias')
            elif scope == 'assistance':
                fields += ('alergias',)
            data = _project_patient_row(response['data'], fields)
        projected = {'success': True, 'data': data, 'scope': scope}
        if not listing:
            projected['history_available'] = history_available
        return jsonify(projected), status
    except (KeyError, TypeError, AttributeError):
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


def _project_created_patient(response, status, read_scope):
    if status != 201:
        return jsonify(response), status
    try:
        if response['success'] is not True or not isinstance(response['data'], dict):
            raise TypeError('Invalid patient creation response')
        fields = ('id',) if read_scope is None else DETAIL_FIELDS
        if read_scope in ('assistance', 'clinical'):
            fields += CONSENT_FIELDS
        if read_scope == 'assistance':
            fields += ('alergias',)
        elif read_scope == 'clinical':
            fields += ('antecedentes_clinicos', 'alergias')
        data = _project_patient_row(response['data'], fields)
        if not isinstance(data.get('id'), int):
            raise TypeError('Missing created patient ID')
        return jsonify({'success': True, 'message': 'Paciente registrado correctamente',
                        'data': data}), 201
    except (KeyError, TypeError, AttributeError):
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500

patient_bp = Blueprint('patient_bp', __name__)

@patient_bp.route('/api/pacientes', methods=['GET'])
@strict_authorization_required('patients.read')
def get_pacientes():
    scope = _patient_scope()
    if scope is None:
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    include_severity = scope == 'clinical' and evaluate_operation(
        request.authenticated_user, 'diagnosis.read')
    response_dict, status_code = obtener_todos_pacientes(
        scope=scope, include_severity=include_severity)
    return _project_patient_response(response_dict, status_code, scope,
                                     listing=True, include_severity=include_severity)

@patient_bp.route('/api/pacientes', methods=['POST'])
@strict_authorization_required('patients.create')
def register_paciente():
    create_scope = patient_create_scope(request.authenticated_user)
    if create_scope is None:
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    data = request.get_json(silent=True)
    read_scope = _patient_scope()
    response_dict, status_code = registrar_nuevo_paciente(
        data, create_scope=create_scope, read_scope=read_scope)
    return _project_created_patient(response_dict, status_code, read_scope)

@patient_bp.route('/api/pacientes/<int:id>', methods=['GET'])
@strict_authorization_required('patients.read')
def get_detalle_paciente(id):
    scope = _patient_scope()
    if scope is None:
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    response_dict, status_code = obtener_detalle_paciente(id, scope=scope)
    history_available = scope == 'clinical' and evaluate_operation(
        request.authenticated_user, 'history.full_read')
    return _project_patient_response(response_dict, status_code, scope,
                                     history_available=history_available)

@patient_bp.route('/api/diagnosticos/paciente/<int:id>', methods=['GET'])
@strict_authorization_required('history.full_read')
def get_historial_diagnosticos(id):
    response_dict, status_code = obtener_historial_diagnosticos(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/<int:id>/visitas', methods=['GET'])
@strict_authorization_required('history.full_read')
def get_visitas_paciente(id):
    response_dict, status_code = obtener_historial_diagnosticos(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/buscar', methods=['GET'])
@strict_authorization_required('patients.read')
def buscar_pacientes():
    try:
        scope = patient_read_scope(getattr(request, 'authenticated_user', None))
    except Exception:
        scope = None
    if scope is None:
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    query = request.args.get('q', '')
    try:
        page = max(int(request.args.get('page', 1)), 1)
        per_page = min(max(int(request.args.get('per_page', 5)), 1), 30)
    except ValueError:
        page = 1
        per_page = 5

    if len(query) < 2:
        return jsonify({
            "success": True,
            "data": [],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": 0,
                "has_more": False
            }
        }), 200
        
    resultado, status_code = buscar_pacientes_dinamico(
        query, page, per_page, include_last_visit=scope != 'administrative')
    return _project_lookup(resultado, status_code, SEARCH_FIELDS, scope, paginated=True)

@patient_bp.route('/api/pacientes/recientes', methods=['GET'])
@strict_authorization_required('patients.read')
def get_pacientes_recientes():
    try:
        scope = patient_read_scope(getattr(request, 'authenticated_user', None))
    except Exception:
        scope = None
    if scope is None:
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    try:
        limit = min(max(int(request.args.get('limit', 6)), 1), 30)
    except ValueError:
        limit = 6

    response_dict, status_code = obtener_recientes(
        limit, include_last_visit=scope != 'administrative')
    return _project_lookup(response_dict, status_code, RECENT_FIELDS, scope)
