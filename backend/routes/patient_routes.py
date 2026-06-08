from flask import Blueprint, request, jsonify
from services.patient_service import (
    obtener_todos_pacientes, 
    registrar_nuevo_paciente, 
    obtener_detalle_paciente, 
    obtener_historial_diagnosticos,
    buscar_pacientes_dinamico,
    obtener_recientes
)
from utils.security import token_required

patient_bp = Blueprint('patient_bp', __name__)

@patient_bp.route('/api/pacientes', methods=['GET'])
@token_required
def get_pacientes():
    response_dict, status_code = obtener_todos_pacientes()
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes', methods=['POST'])
@token_required
def register_paciente():
    data = request.get_json() or {}
    response_dict, status_code = registrar_nuevo_paciente(data)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/<int:id>', methods=['GET'])
@token_required
def get_detalle_paciente(id):
    response_dict, status_code = obtener_detalle_paciente(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/diagnosticos/paciente/<int:id>', methods=['GET'])
@token_required
def get_historial_diagnosticos(id):
    response_dict, status_code = obtener_historial_diagnosticos(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/buscar', methods=['GET'])
@token_required
def buscar_pacientes():
    query = request.args.get('q', '')
    if len(query) < 2:
        return jsonify({"success": True, "data": []}), 200
        
    resultado, status_code = buscar_pacientes_dinamico(query)
    return jsonify(resultado), status_code

@patient_bp.route('/api/pacientes/recientes', methods=['GET'])
@token_required
def get_pacientes_recientes():
    response_dict, status_code = obtener_recientes()
    return jsonify(response_dict), status_code