from flask import Blueprint, current_app, jsonify, request

from services import configuration_service as service
from src.repositories.configuration_repository import ConfigurationRepository
from utils.strict_authorization import evaluate_operation, strict_authorization_required


configuration_bp = Blueprint('configuration_bp', __name__)


def _response(operation, *args):
    try:
        data, status = operation(*args)
        return jsonify(data), status
    except Exception:
        current_app.logger.error('Error en administración de usuarios')
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


@configuration_bp.get('/api/configuracion/usuarios')
@strict_authorization_required('users.read')
def list_users():
    try:
        return jsonify({'success': True, 'data': [service.user_view(user) for user in ConfigurationRepository.users()]})
    except Exception:
        current_app.logger.error('Error al consultar usuarios')
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


@configuration_bp.get('/api/configuracion/catalogo')
@strict_authorization_required('configuration.read')
def list_catalog():
    try:
        return jsonify({'success': True, 'data': service.catalog(),
                        'permissions_editable': evaluate_operation(request.authenticated_user,
                                                                   'roles.assign_permissions'),
                        'capabilities': {name: evaluate_operation(request.authenticated_user, f'users.{name}')
                                         for name in ('read', 'create', 'edit', 'assign_roles')}})
    except Exception:
        current_app.logger.error('Error al consultar configuración')
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


@configuration_bp.post('/api/configuracion/usuarios')
@strict_authorization_required('users.create')
def register_user():
    # Asignar roles requiere su autorización propia, incluso al crear.
    if not evaluate_operation(request.authenticated_user, 'users.assign_roles'):
        return jsonify({'success': False, 'message': 'No autorizado.'}), 403
    return _response(service.create_user, request.get_json(silent=True))


@configuration_bp.patch('/api/configuracion/usuarios/<int:user_id>')
@strict_authorization_required('users.edit')
def edit_user(user_id):
    return _response(service.edit_user, user_id, request.get_json(silent=True))


@configuration_bp.put('/api/configuracion/usuarios/<int:user_id>/estado')
@strict_authorization_required('users.edit')
def change_user_state(user_id):
    return _response(service.set_user_state, user_id, request.get_json(silent=True),
                     request.current_user['user_id'])


@configuration_bp.put('/api/configuracion/usuarios/<int:user_id>/roles')
@strict_authorization_required('users.assign_roles')
def change_user_roles(user_id):
    return _response(service.set_user_roles, user_id, request.get_json(silent=True),
                     request.current_user['user_id'])


@configuration_bp.get('/api/configuracion/roles/<int:role_id>/permisos')
@strict_authorization_required('configuration.read')
def get_role_permissions(role_id):
    try:
        return jsonify(service.role_permissions(role_id))
    except service.InputError as error:
        return jsonify({'success': False, 'message': str(error)}), error.status
    except Exception:
        current_app.logger.error('Error al consultar permisos del rol')
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500


@configuration_bp.put('/api/configuracion/roles/<int:role_id>/permisos')
@strict_authorization_required('roles.assign_permissions')
def change_role_permissions(role_id):
    return _response(service.set_role_permissions, role_id, request.get_json(silent=True))
