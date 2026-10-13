import re
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
    actualizar_informe_existente,
    anular_informe_existente,
    bloquear_informe_para_edicion,
    cancelar_edicion,
    obtener_versiones_informe,
    obtener_historial_paciente,
)
informe_bp = Blueprint("informe_bp", __name__)


@informe_bp.after_request
def _no_store_historial(response):
    if request.endpoint in ('informe_bp.versiones', 'informe_bp.historial_paciente'):
        response.headers['Cache-Control'] = 'private, no-store'
    return response


def _history_page():
    if set(request.args) - {'page', 'per_page'}:
        return None
    values = []
    for key, default, maximum in (('page', 1, 1000000), ('per_page', 10, 50)):
        raw = request.args.getlist(key)
        if len(raw) > 1:
            return None
        text = raw[0] if raw else str(default)
        if not re.fullmatch(r'[1-9][0-9]*', text) or len(text) > 7:
            return None
        number = int(text)
        if number > maximum:
            return None
        values.append(number)
    return values


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


def _owned_report_for_edit(user, informe_id):
    # El SELECT FOR UPDATE abre la misma transacción que completa el handler.
    try:
        informe = bloquear_informe_para_edicion(informe_id)
    except Exception:
        cancelar_edicion()
        raise
    if informe is None:
        cancelar_edicion()
        raise AuthorizationInputError(404, "Informe no encontrado.")
    if informe.usuario_id != user.id:
        cancelar_edicion()
        return False
    request.locked_report_for_edit = informe
    return True


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


@informe_bp.route('/api/informes/<int:informe_id>/versiones', methods=['GET'])
@strict_authorization_required('reports.full_read', enabled_config='REPORTS_HISTORY_ENABLED')
def versiones(informe_id):
    page = _history_page()
    if page is None:
        return jsonify({'success': False, 'message': 'Paginación inválida.'}), 400
    resp, status = obtener_versiones_informe(informe_id, *page)
    return jsonify(resp), status


@informe_bp.route('/api/informes/historial/paciente/<int:paciente_id>', methods=['GET'])
@strict_authorization_required('reports.full_read', enabled_config='REPORTS_HISTORY_ENABLED')
def historial_paciente(paciente_id):
    page = _history_page()
    if page is None:
        return jsonify({'success': False, 'message': 'Paginación inválida.'}), 400
    resp, status = obtener_historial_paciente(paciente_id, *page)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["PUT"])
@strict_authorization_required("reports.edit_own", resource_check=_owned_report_for_edit,
                               enabled_config="REPORTS_EDIT_ENABLED")
def actualizar(informe_id):
    request.max_content_length = 65536
    if request.content_length is not None and request.content_length > 65536:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud demasiado grande."}), 413
    if not request.is_json:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    try:
        data = request.get_json()
    except RequestEntityTooLarge:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud demasiado grande."}), 413
    except BadRequest:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    if type(data) is not dict:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    resp, status = actualizar_informe_existente(informe_id, data, request.current_user["user_id"],
                                                request.locked_report_for_edit)
    return jsonify(resp), status


@informe_bp.route("/api/informes/<int:informe_id>/anulacion", methods=["POST"])
@strict_authorization_required("reports.annul_own", resource_check=_owned_report_for_edit,
                               enabled_config="REPORTS_ANNUL_ENABLED")
def anular(informe_id):
    request.max_content_length = 65536
    if request.content_length is not None and request.content_length > 65536:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud demasiado grande."}), 413
    if not request.is_json:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    try:
        data = request.get_json()
    except RequestEntityTooLarge:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud demasiado grande."}), 413
    except BadRequest:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    if type(data) is not dict:
        cancelar_edicion()
        return jsonify({"success": False, "message": "Solicitud de informe inválida."}), 400
    resp, status = anular_informe_existente(informe_id, data, request.current_user["user_id"],
                                            request.locked_report_for_edit)
    return jsonify(resp), status

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
