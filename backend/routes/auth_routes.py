from flask import Blueprint, request, jsonify
from services.auth_service import autenticar_usuario

auth_bp = Blueprint('auth_bp', __name__)

@auth_bp.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username')
    password = data.get('password')

    response_dict, status_code = autenticar_usuario(username, password)
    return jsonify(response_dict), status_code
