from flask import Blueprint, request, jsonify
from services.auth_service import autenticar_usuario

auth_bp = Blueprint('auth_bp', __name__)

@auth_bp.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "message": "Solicitud inválida."}), 400

    username = data.get('username')
    password = data.get('password')
    if any(value is not None and not isinstance(value, str) for value in (username, password)):
        return jsonify({"success": False, "message": "Solicitud inválida."}), 400

    response_dict, status_code = autenticar_usuario(username, password)
    return jsonify(response_dict), status_code
