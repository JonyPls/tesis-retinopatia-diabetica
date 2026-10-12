from flask import Blueprint, request, jsonify
from utils.security import clinical_access_required, token_required
from utils.strict_authorization import disabled_authenticated_operation, strict_authorization_required
from services.informe_service import (
    obtener_tipos,
    crear_nuevo_informe,
    obtener_informe,
    obtener_informes_por_paciente,
    consultar_informes_por_diagnostico,
    consultar_informes_por_visita,
)
informe_bp = Blueprint("informe_bp", __name__)

@informe_bp.route("/api/tipos-informe", methods=["GET"])
@strict_authorization_required("reports.catalog_read")
def listar_tipos():
    resp, status = obtener_tipos()
    return jsonify(resp), status

@informe_bp.route("/api/informes", methods=["POST"])
@token_required
@clinical_access_required("informes.crear", "informes.gestionar")
def crear():
    data = request.get_json() or {}
    usuario_id = request.current_user.get("user_id")
    resp, status = crear_nuevo_informe(data, usuario_id)
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
