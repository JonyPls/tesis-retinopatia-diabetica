from functools import wraps
from flask import current_app, request, jsonify
import jwt
import os
from src.repositories.auth_repository import AuthRepository

ADMIN_ROLES = {
    "Admin",
    "Administrador",
    "Administrador del sistema",
    "Gerente General",
}

CLINICAL_ROLES = {
    "Medico",
    "Médico",
    "Medico especialista",
    "Médico especialista",
    "Medico Especialista",
    "Médico Especialista",
    "Oftalmologo",
    "Oftalmólogo",
    "Especialista",
}

CLINICAL_BASE_PERMISSIONS = {
    "clinico.ver",
    "clinico.leer",
    "clinico.acceder",
    "clinico.gestionar",
    "clinico.*",
}

GENERIC_UNAUTHORIZED_MESSAGE = "No autorizado."
GENERIC_NOT_FOUND_MESSAGE = "Recurso no encontrado."


def token_required(f, *, eager_permissions=False):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # 1. Buscamos el token en los encabezados (Headers) de la petición HTTP
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(" ")[1]
        
        # 2. Fallback: token como query parameter (para <img> tags)
        if not token:
            token = request.args.get('token')

        # 3. Si no hay token, bloqueamos el acceso inmediatamente
        if not token:
            return jsonify({
                "success": False, 
                "message": "Falta el token de autorización. Acceso denegado."
            }), 401

        # 4. Validamos que el token sea auténtico y no haya expirado
        try:
            data = jwt.decode(
                token,
                os.getenv('SECRET_KEY'),
                algorithms=["HS256"],
                options={"require": ["exp", "user_id"]},
            )
            
        except jwt.ExpiredSignatureError:
            return jsonify({
                "success": False, 
                "message": "Token expirado."
            }), 401
        except jwt.InvalidTokenError:
            return jsonify({
                "success": False, 
                "message": "Token inválido."
            }), 401

        try:
            if eager_permissions:
                user = AuthRepository.get_active_user_with_permissions_by_id(data['user_id'])
            else:
                user = AuthRepository.get_active_user_by_id(data['user_id'])
            if not user:
                return jsonify({"success": False, "message": GENERIC_UNAUTHORIZED_MESSAGE}), 401

            # Los roles y permisos del token pueden haber cambiado desde su emisión.
            data.pop('permissions', None)
            request.current_user = {**data, 'roles': user.roles, 'permisos': user.permisos}
            if eager_permissions:
                request.authenticated_user = user  # Solo durante esta petición.
        except Exception:
            current_app.logger.exception("Error al verificar la cuenta autenticada")
            return safe_json_error(status=500)

        # 5. Si todo está perfecto, dejamos que la petición continúe hacia la ruta original
        return f(*args, **kwargs)
        
    return decorated


def _current_user():
    return getattr(request, "current_user", {}) or {}


def _as_set(values):
    if not values:
        return set()
    if isinstance(values, str):
        return {values}
    return {str(value) for value in values if value}


def current_user_roles():
    return _as_set(_current_user().get("roles"))


def _load_permissions_from_db():
    user_id = _current_user().get("user_id")
    if not user_id:
        return set()

    try:
        from src.models.auth_entities import Usuario

        user = Usuario.query.filter_by(id=user_id, estado='ACTIVO').first()
        return _as_set(user.permisos if user else [])
    except Exception:
        current_app.logger.exception("Error al cargar permisos del usuario autenticado")
        return set()


def current_user_permissions():
    token_permissions = _as_set(
        _current_user().get("permisos")
        or _current_user().get("permissions")
        or []
    )
    return token_permissions or _load_permissions_from_db()


def _permission_matches(user_permission, required_permission):
    if user_permission == required_permission:
        return True
    if user_permission.endswith(".*"):
        return required_permission.startswith(user_permission[:-1])
    if required_permission.endswith(".*"):
        return user_permission.startswith(required_permission[:-1])
    return False


def user_has_role(*roles):
    expected_roles = _as_set(roles)
    user_roles = current_user_roles()
    return bool(user_roles & expected_roles)


def user_has_permission(*permissions):
    expected_permissions = _as_set(permissions)
    user_permissions = current_user_permissions()
    return any(
        _permission_matches(user_permission, expected_permission)
        for user_permission in user_permissions
        for expected_permission in expected_permissions
    )


def user_is_authorized(roles=None, permissions=None):
    expected_roles = _as_set(roles)
    expected_permissions = _as_set(permissions)

    if current_user_roles() & ADMIN_ROLES:
        return True
    if expected_roles and user_has_role(*expected_roles):
        return True
    if expected_permissions and user_has_permission(*expected_permissions):
        return True
    return False


def authorization_required(roles=None, permissions=None):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if not user_is_authorized(roles=roles, permissions=permissions):
                return jsonify({
                    "success": False,
                    "message": GENERIC_UNAUTHORIZED_MESSAGE,
                }), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator


def role_required(*roles):
    return authorization_required(roles=roles)


def permission_required(*permissions):
    return authorization_required(permissions=permissions)


def clinical_access_required(*permissions):
    allowed_permissions = set(permissions) | CLINICAL_BASE_PERMISSIONS
    return authorization_required(
        roles=CLINICAL_ROLES,
        permissions=allowed_permissions,
    )


def safe_json_error(message="No se pudo procesar la solicitud.", status=500):
    return jsonify({"success": False, "message": message}), status


def log_exception(message):
    current_app.logger.exception(message)
