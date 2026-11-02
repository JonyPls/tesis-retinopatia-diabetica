from uuid import UUID
import click
from flask import Blueprint, request, jsonify
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from utils.strict_authorization import strict_authorization_required
from services import diagnosis_discard_service as service


diagnosis_discard_bp = Blueprint('diagnosis_discard', __name__)


@diagnosis_discard_bp.after_request
def no_store(response):
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@diagnosis_discard_bp.get('/api/diagnosticar/visita/<int:visita_id>/contexto-descarte')
@strict_authorization_required('diagnosis.discard_pending', enabled_config='DIAGNOSIS_DISCARD_ENABLED')
def context(visita_id):
    if set(request.args) - {'operacion_id'} or len(request.args.getlist('operacion_id')) > 1:
        return jsonify({'success': False, 'code': 'SOLICITUD_INVALIDA'}), 400
    operation = request.args.get('operacion_id')
    if operation is not None:
        try:
            if str(UUID(operation)) != operation:
                raise ValueError()
        except ValueError:
            return jsonify({'success': False, 'code': 'OPERACION_INVALIDA'}), 400
    result, status = service.context(visita_id, request.current_user['user_id'], operation)
    return jsonify(result), status


@diagnosis_discard_bp.get('/api/visitas/<int:visita_id>/revision-inferencia')
@strict_authorization_required('reports.inference_context', enabled_config='DIAGNOSIS_DISCARD_ENABLED')
def report_context(visita_id):
    if request.args:
        return jsonify({'success': False, 'code': 'SOLICITUD_INVALIDA'}), 400
    result, status = service.report_context(visita_id)
    return jsonify(result), status


@diagnosis_discard_bp.get('/api/diagnosticar/visita/<int:visita_id>/operaciones-descarte/<uuid:operacion_id>')
@strict_authorization_required('diagnosis.discard_pending', enabled_config='DIAGNOSIS_DISCARD_ENABLED')
def operation_status(visita_id, operacion_id):
    if request.args:
        return jsonify({'success': False, 'code': 'SOLICITUD_INVALIDA'}), 400
    result, status = service.operation_status(visita_id, request.current_user['user_id'], str(operacion_id))
    return jsonify(result), status


@diagnosis_discard_bp.post('/api/diagnosticar/visita/<int:visita_id>/descartar-resultados')
@strict_authorization_required('diagnosis.discard_pending', enabled_config='DIAGNOSIS_DISCARD_ENABLED')
def discard(visita_id):
    request.max_content_length = 4096
    if request.args or not request.is_json:
        return jsonify({'success': False, 'code': 'SOLICITUD_INVALIDA'}), 400
    try:
        if request.content_length is not None and request.content_length > 4096:
            raise RequestEntityTooLarge()
        data = request.get_json()
    except RequestEntityTooLarge:
        return jsonify({'success': False, 'code': 'SOLICITUD_DEMASIADO_GRANDE'}), 413
    except BadRequest:
        return jsonify({'success': False, 'code': 'SOLICITUD_INVALIDA'}), 400
    result, status = service.discard(visita_id, request.current_user['user_id'], data)
    return jsonify(result), status


@diagnosis_discard_bp.cli.command('limpiar')
@click.option('--operacion-id', required=True, type=click.UUID)
@click.option('--confirmar', is_flag=True, required=True, help='Ejecuta borrados solo del manifiesto confirmado.')
def clean(operacion_id, confirmar):
    """Reintento explícito de UNA tarea. Nunca escanea ni borra por patrones."""
    if not confirmar:
        raise click.ClickException('Se requiere --confirmar.')
    result, status = service.clean_operation(str(operacion_id))
    if status != 200:
        raise click.ClickException(result['code'])
    click.echo(f"Limpieza: {result['data']['limpieza']}")
