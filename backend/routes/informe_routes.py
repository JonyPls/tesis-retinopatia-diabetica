from flask import Blueprint, request, jsonify
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from utils.strict_authorization import (AuthorizationInputError, disabled_authenticated_operation,
                                        strict_authorization_required)
from services.informe_service import (
    obtener_tipos,
    crear_nuevo_informe,
    obtener_informe,
    obtener_informes_por_paciente,
    consultar_informes_por_diagnostico,
    consultar_informes_por_visita,
)
informe_bp = Blueprint("informe_bp", __name__)


def _report_requires_new_visit():
    # Se ejecuta después de reports.create, antes de cualquier consulta clínica.
    request.max_content_length = 65536
    if request.content_length is not None and request.content_length > 65536:
        raise AuthorizationInputError(413, "Solicitud demasiado grande.")
    if not request.is_json:
        raise AuthorizationInputError(400, "Solicitud de informe inválida.")
    try:
        data = request.get_json()
    except RequestEntityTooLarge:
        raise AuthorizationInputError(413, "Solicitud demasiado grande.") from None
    except BadRequest:
        raise AuthorizationInputError(400, "Solicitud de informe inválida.") from None
    if type(data) is not dict:
        raise AuthorizationInputError(400, "Solicitud de informe inválida.")
    request.report_create_data = data
    return 'visita_id' not in data and 'diagnostico_id' not in data


@informe_bp.route("/api/tipos-informe", methods=["GET"])
@strict_authorization_required("reports.catalog_read")
def listar_tipos():
    resp, status = obtener_tipos()
    return jsonify(resp), status

@informe_bp.route("/api/informes", methods=["POST"])
@strict_authorization_required("reports.create", conditional_operation="reports.create_with_visit",
                               requires_conditional_operation=_report_requires_new_visit)
def crear():
    usuario_id = request.current_user.get("user_id")
    resp, status = crear_nuevo_informe(request.report_create_data, usuario_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["GET"])
@strict_authorization_required("reports.full_read")
def obtener(informe_id):
    resp, status = obtener_informe(informe_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["PUT"])
@disabled_authenticated_operation
def actualizar(informe_id):
    # Defensa adicional si se invoca el handler sin la guardia.
    return jsonify({"success": False, "message": "No autorizado."}), 403

@informe_bp.route("/api/informes/<int:informe_id>", methods=["DELETE"])
@disabled_authenticated_operation
def eliminar(informe_id):
    return jsonify({"success": False, "message": "No autorizado."}), 403

@informe_bp.route("/api/informes/paciente/<int:paciente_id>", methods=["GET"])
@strict_authorization_required("reports.full_read")
def listar_por_paciente(paciente_id):
    resp, status = obtener_informes_por_paciente(paciente_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/visita/<int:visita_id>", methods=["GET"])
@strict_authorization_required("reports.full_read")
def listar_por_visita(visita_id):
    resp, status = consultar_informes_por_visita(visita_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/diagnostico/<int:diagnostico_id>", methods=["GET"])
@strict_authorization_required("reports.full_read")
def listar_por_diagnostico(diagnostico_id):
    resp, status = consultar_informes_por_diagnostico(diagnostico_id)
    return jsonify(resp), status
