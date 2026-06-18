from flask import Blueprint, request, jsonify
from utils.security import token_required
from services.informe_service import (
    obtener_tipos,
    crear_nuevo_informe,
    obtener_informe,
    actualizar_informe_existente,
    eliminar_informe_existente,
    obtener_informes_por_paciente,
    consultar_informes_por_diagnostico,
)
informe_bp = Blueprint("informe_bp", __name__)

@informe_bp.route("/api/tipos-informe", methods=["GET"])
@token_required
def listar_tipos():
    resp, status = obtener_tipos()
    return jsonify(resp), status

@informe_bp.route("/api/informes", methods=["POST"])
@token_required
def crear():
    data = request.get_json() or {}
    usuario_id = request.current_user.get("user_id")
    resp, status = crear_nuevo_informe(data, usuario_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["GET"])
@token_required
def obtener(informe_id):
    resp, status = obtener_informe(informe_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["PUT"])
@token_required
def actualizar(informe_id):
    data = request.get_json() or {}
    resp, status = actualizar_informe_existente(informe_id, data)
    return jsonify(resp), status

@informe_bp.route("/api/informes/<int:informe_id>", methods=["DELETE"])
@token_required
def eliminar(informe_id):
    resp, status = eliminar_informe_existente(informe_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/paciente/<int:paciente_id>", methods=["GET"])
@token_required
def listar_por_paciente(paciente_id):
    resp, status = obtener_informes_por_paciente(paciente_id)
    return jsonify(resp), status

@informe_bp.route("/api/informes/diagnostico/<int:diagnostico_id>", methods=["GET"])
@token_required
def listar_por_diagnostico(diagnostico_id):
    resp, status = consultar_informes_por_diagnostico(diagnostico_id)
    return jsonify(resp), status
