"""Motor B1 opt-in: no reemplaza los decoradores clínicos existentes.

Usa roles.codigo y permisos.codigo de relaciones activas. El decorador incluye
token_required: nunca se debe invocar una regla sin autenticar la solicitud.
"""

from dataclasses import dataclass, replace
from functools import wraps
from types import MappingProxyType

from flask import current_app, jsonify, request

from utils.security import token_required


OFTALMOLOGO = "OFTALMOLOGO"
ENFERMERO = "ENFERMERO"
ASISTENTE = "ASISTENTE_ADMINISTRATIVO"
ADMINISTRADOR = "ADMINISTRADOR_SISTEMA"


@dataclass(frozen=True)
class OperationRule:
    domain: str
    role_codes: frozenset[str]
    all_of: frozenset[str]
    any_of: frozenset[str] = frozenset()
    needs_resource_check: bool = False


def _rule(domain, roles, *permissions, any_of=(), needs_resource_check=False):
    return OperationRule(
        domain=domain,
        role_codes=frozenset(roles),
        all_of=frozenset(permissions),
        any_of=frozenset(any_of),
        needs_resource_check=needs_resource_check,
    )


# Solo operaciones acordadas. No se incluyen informes.editar_ajenos, Gerente,
# permisos genéricos ni la alternativa del catálogo de tipos aún no aprobada.
OPERATION_RULES = MappingProxyType({
    "configuration.read": _rule("administration", (ADMINISTRADOR,), "configuracion.ver"),
    "patients.read": _rule("assistance", (OFTALMOLOGO, ENFERMERO, ASISTENTE), "pacientes.ver"),
    "patients.create": _rule("assistance", (OFTALMOLOGO, ENFERMERO, ASISTENTE), "pacientes.crear"),
    "visits.read": _rule("assistance", (OFTALMOLOGO, ENFERMERO, ASISTENTE), "visitas.ver"),
    "visits.create": _rule("assistance", (OFTALMOLOGO, ENFERMERO), "visitas.crear"),
    "history.full_read": _rule(
        "specialist", (OFTALMOLOGO,), "pacientes.ver", "visitas.ver",
        "diagnostico_retinopatia.ver", "informes.ver", "imagenes.ver",
    ),
    "diagnosis.read": _rule("specialist", (OFTALMOLOGO,), "diagnostico_retinopatia.ver"),
    "diagnosis.details_read": _rule(
        "specialist", (OFTALMOLOGO,), "diagnostico_retinopatia.ver", "imagenes.ver",
    ),
    "diagnosis.create": _rule(
        "specialist", (OFTALMOLOGO,), "diagnostico_retinopatia.crear", "imagenes.ver",
    ),
    "diagnosis.create_with_visit": _rule(
        "specialist", (OFTALMOLOGO,), "diagnostico_retinopatia.crear", "imagenes.ver", "visitas.crear",
    ),
    "diagnosis.validate": _rule("specialist", (OFTALMOLOGO,), "diagnostico_retinopatia.validar"),
    "images.read": _rule("assistance", (OFTALMOLOGO, ENFERMERO), "imagenes.ver"),
    "retinograph.select": _rule("specialist", (OFTALMOLOGO,), "pacientes.ver", "imagenes.ver"),
    "retinograph.download": _rule("specialist", (OFTALMOLOGO,), "pacientes.ver", "imagenes.ver"),
    "retinograph.confirm": _rule("specialist", (OFTALMOLOGO,), "pacientes.ver", "imagenes.ver"),
    "retinograph.confirm_status": _rule("specialist", (OFTALMOLOGO,), "pacientes.ver", "imagenes.ver"),
    "retinograph.revoke": _rule("specialist", (OFTALMOLOGO,), "pacientes.ver", "imagenes.ver"),
    "diagnosis.pdf_read": _rule(
        "specialist", (OFTALMOLOGO,), "pacientes.ver",
        "diagnostico_retinopatia.ver", "imagenes.ver",
    ),
    "reports.read": _rule("assistance", (OFTALMOLOGO, ENFERMERO, ASISTENTE), "informes.ver"),
    "reports.create": _rule("specialist", (OFTALMOLOGO,), "informes.crear"),
    "reports.create_with_visit": _rule(
        "specialist", (OFTALMOLOGO,), "informes.crear", "visitas.crear",
    ),
    "reports.edit_own": _rule(
        "specialist", (OFTALMOLOGO,), "informes.editar", needs_resource_check=True,
    ),
    "reports.inactivate": _rule(
        "specialist", (OFTALMOLOGO,), "informes.inactivar", needs_resource_check=True,
    ),
    "reports.annul": _rule(
        "specialist", (OFTALMOLOGO,), "informes.anular", needs_resource_check=True,
    ),
})


def evaluate_rule(user, rule: OperationRule, *, resource_allowed=None):
    """Evaluación exacta y con procedencia: solo grants de roles habilitantes."""
    if user is None or getattr(user, "estado", None) != "ACTIVO":
        return False
    if not rule.role_codes or not (rule.all_of or rule.any_of):
        return False
    if any("*" in code for code in rule.all_of | rule.any_of):
        return False
    if resource_allowed is False or (rule.needs_resource_check and resource_allowed is not True):
        return False

    permissions = set()
    has_eligible_role = False
    for assignment in getattr(user, "roles_rel", ()) or ():
        role = getattr(assignment, "rol", None)
        if role is None or getattr(role, "estado", None) != "ACTIVO" or getattr(role, "codigo", None) not in rule.role_codes:
            continue
        has_eligible_role = True
        for grant in getattr(role, "permisos_rel", ()) or ():
            permission = getattr(grant, "permiso", None)
            if permission is not None and getattr(permission, "estado", None) == "ACTIVO":
                permissions.add(permission.codigo)

    return (has_eligible_role and rule.all_of <= permissions
            and (not rule.any_of or bool(rule.any_of & permissions)))


def evaluate_operation(user, operation, *, resource_allowed=None):
    rule = OPERATION_RULES.get(operation)
    return bool(rule and evaluate_rule(user, rule, resource_allowed=resource_allowed))


def patient_read_scope(user):
    """Alcance por grant activo del rol habilitante, nunca por claims del JWT.

    Un rol clínico sin su propio pacientes.ver no amplía el alcance concedido
    por otro rol; ADMINISTRADOR_SISTEMA no participa en estas proyecciones.
    """
    rule = OPERATION_RULES["patients.read"]
    for role_code, scope in ((OFTALMOLOGO, "clinical"),
                             (ENFERMERO, "assistance"),
                             (ASISTENTE, "administrative")):
        if evaluate_rule(user, replace(rule, role_codes=frozenset({role_code}))):
            return scope
    return None


def patient_create_scope(user):
    """Procedencia de pacientes.crear independiente del alcance de lectura."""
    rule = OPERATION_RULES["patients.create"]
    for role_code, scope in ((OFTALMOLOGO, "clinical"),
                             (ENFERMERO, "assistance"),
                             (ASISTENTE, "administrative")):
        if evaluate_rule(user, replace(rule, role_codes=frozenset({role_code}))):
            return scope
    return None


class AuthorizationInputError(Exception):
    """Error público de estructura de petición antes de autorizar su modalidad."""

    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def strict_authorization_required(operation, *, resource_check=None,
                                  conditional_operation=None, requires_conditional_operation=None):
    """Decorador opt-in; envuelve el handler en token_required y deniega por defecto.

    Para reglas con needs_resource_check se exige un verificador real del
    recurso. Solo las rutas activadas explícitamente usan este decorador.
    """
    def decorator(handler):
        @wraps(handler)
        def protected(*args, **kwargs):
            claims = getattr(request, "current_user", None) or {}
            if not claims.get("user_id"):
                return jsonify({"success": False, "message": "No autorizado."}), 401
            rule = OPERATION_RULES.get(operation)
            if rule is None:
                return jsonify({"success": False, "message": "No autorizado."}), 403
            try:
                user = getattr(request, "authenticated_user", None)
                if user is None:
                    return jsonify({"success": False, "message": "No autorizado."}), 401
                if resource_check is None:
                    allowed = evaluate_rule(user, rule)
                else:
                    # No consultar recursos si el rol/permiso ya deniega acceso.
                    if not evaluate_rule(user, rule, resource_allowed=True):
                        return jsonify({"success": False, "message": "No autorizado."}), 403
                    allowed = evaluate_rule(
                        user, rule, resource_allowed=resource_check(user, *args, **kwargs)
                    )
                if allowed and conditional_operation is not None:
                    # El selector solo examina la estructura, nunca recursos.
                    # Ambas políticas completas se evalúan en el mismo usuario
                    # y con grants del rol habilitante, sin unión con otros roles.
                    if requires_conditional_operation is None:
                        allowed = False
                    else:
                        required = requires_conditional_operation()
                        if type(required) is not bool:
                            allowed = False
                        elif required:
                            conditional_rule = OPERATION_RULES.get(conditional_operation)
                            allowed = bool(conditional_rule and evaluate_rule(user, conditional_rule))
            except AuthorizationInputError as error:
                return jsonify({"success": False, "message": str(error)}), error.status_code
            except Exception:
                current_app.logger.exception("Error al evaluar autorización estricta")
                return jsonify({"success": False, "message": "No se pudo procesar la solicitud."}), 500
            if not allowed:
                return jsonify({"success": False, "message": "No autorizado."}), 403
            return handler(*args, **kwargs)

        return token_required(protected, eager_permissions=True)

    return decorator
