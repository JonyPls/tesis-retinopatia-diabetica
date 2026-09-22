from flask import Blueprint, jsonify
from services.document_service import (
    obtener_lista_documentos
)
from utils.security import clinical_access_required, token_required

document_bp = Blueprint('document_bp', __name__)

@document_bp.route('/api/documentos', methods=['GET'])
@token_required
@clinical_access_required('pacientes.ver')
def get_documentos():
    response_dict, status_code = obtener_lista_documentos()
    return jsonify(response_dict), status_code
