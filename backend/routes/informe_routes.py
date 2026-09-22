from flask import Blueprint, request, jsonify
from utils.security import clinical_access_required, token_required
from services.informe_service import (
    obtener_tipos,
    crear_nuevo_informe,
    obtener_informe,
    actualizar_informe_existente,
    eliminar_informe_existente,
    obtener_informes_por_paciente,
    consultar_informes_por_diagnostico,
    consultar_informes_por_visita,
)
informe_bp = Blueprint("informe_bp", __name__)

@informe_bp.route("/api/tipos-informe", methods=["GET"])
@token_required
@clinical_access_required("informes.ver")
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
@token_required
@clinical_access_required("informes.ver")
def obtener(informe_id):
    resp, status = obtener_informe(informe_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["PUT"])
@token_required
@clinical_access_required("informes.editar", "informes.gestionar")
def actualizar(informe_id):
    data = request.get_json() or {}
    resp, status = actualizar_informe_existente(informe_id, data)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["DELETE"])
@token_required
@clinical_access_required("informes.eliminar", "informes.gestionar")
def eliminar(informe_id):
    resp, status = eliminar_informe_existente(informe_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/paciente/<int:paciente_id>", methods=["GET"])
@token_required
@clinical_access_required("informes.ver", "pacientes.ver")
def listar_por_paciente(paciente_id):
    resp, status = obtener_informes_por_paciente(paciente_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/visita/<int:visita_id>", methods=["GET"])
@token_required
@clinical_access_required("informes.ver", "visitas.ver")
def listar_por_visita(visita_id):
    resp, status = consultar_informes_por_visita(visita_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/diagnostico/<int:diagnostico_id>", methods=["GET"])
@token_required
@clinical_access_required("informes.ver", "diagnosticos.ver")
def listar_por_diagnostico(diagnostico_id):
    resp, status = consultar_informes_por_diagnostico(diagnostico_id)
    return jsonify(resp), status
