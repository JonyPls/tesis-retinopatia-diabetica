from flask import Blueprint, request, jsonify
from services.patient_service import (
    obtener_todos_pacientes, 
    registrar_nuevo_paciente, 
    obtener_detalle_paciente, 
    obtener_historial_diagnosticos,
    buscar_pacientes_dinamico,
    obtener_recientes
)
from utils.security import clinical_access_required, token_required

patient_bp = Blueprint('patient_bp', __name__)

@patient_bp.route('/api/pacientes', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver')
def get_pacientes():
    response_dict, status_code = obtener_todos_pacientes()
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes', methods=['POST'])
@token_required
@clinical_access_required('pacientes.crear', 'pacientes.gestionar')
def register_paciente():
    data = request.get_json() or {}
    response_dict, status_code = registrar_nuevo_paciente(data)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/<int:id>', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver')
def get_detalle_paciente(id):
    response_dict, status_code = obtener_detalle_paciente(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/diagnosticos/paciente/<int:id>', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver', 'diagnosticos.ver')
def get_historial_diagnosticos(id):
    response_dict, status_code = obtener_historial_diagnosticos(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/<int:id>/visitas', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver', 'visitas.ver')
def get_visitas_paciente(id):
    response_dict, status_code = obtener_historial_diagnosticos(id)
    return jsonify(response_dict), status_code

@patient_bp.route('/api/pacientes/buscar', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver')
def buscar_pacientes():
    query = request.args.get('q', '')
    try:
        page = max(int(request.args.get('page', 1)), 1)
        per_page = min(max(int(request.args.get('per_page', 5)), 1), 30)
    except ValueError:
        page = 1
        per_page = 5

    if len(query) < 2:
        return jsonify({
            "success": True,
            "data": [],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": 0,
                "has_more": False
            }
        }), 200
        
    resultado, status_code = buscar_pacientes_dinamico(query, page, per_page)
    return jsonify(resultado), status_code

@patient_bp.route('/api/pacientes/recientes', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver')
def get_pacientes_recientes():
    try:
        limit = min(max(int(request.args.get('limit', 6)), 1), 30)
    except ValueError:
        limit = 6

    response_dict, status_code = obtener_recientes(limit)
    return jsonify(response_dict), status_code
