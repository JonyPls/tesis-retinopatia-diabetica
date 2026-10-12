from flask import Blueprint, send_from_directory, jsonify
import os
from sqlalchemy import text
from database import db
from utils.security import (
    GENERIC_NOT_FOUND_MESSAGE,
)
from utils.strict_authorization import strict_authorization_required

files_bp = Blueprint('files_bp', __name__)

RETINAS_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'uploads', 'retinas'))


def _retina_file_is_registered(filename):
    safe_name = os.path.basename(filename)
    if safe_name != filename:
        return False

    query = text("""
        SELECT drd.id
        FROM diagnosticos_retinopatia_detalle drd
        JOIN diagnosticos_retinopatia dr
          ON dr.id = drd.diagnostico_retinopatia_id
        JOIN visitas_clinicas v
          ON v.id = dr.visita_id
        WHERE (drd.imagen_original_url = :filename OR drd.imagen_gradcam_url = :filename)
          AND dr.estado <> 'ANULADO'
          AND v.estado <> 'ANULADA'
        LIMIT 1
    """)
    return db.session.execute(query, {"filename": safe_name}).first() is not None

@files_bp.route('/uploads/retinas/<path:filename>', methods=['GET'])
@strict_authorization_required('images.read')
def serve_retina_image(filename):
    safe_name = os.path.basename(filename)
    if (safe_name != filename or
            not safe_name.lower().endswith(('.jpg', '.jpeg', '.png'))):
        return jsonify({"success": False, "message": GENERIC_NOT_FOUND_MESSAGE}), 404

    root = os.path.realpath(RETINAS_FOLDER)
    full_path = os.path.realpath(os.path.join(root, safe_name))
    if os.path.commonpath([root, full_path]) != root:
        return jsonify({"success": False, "message": GENERIC_NOT_FOUND_MESSAGE}), 404

    if not os.path.isfile(full_path) or not _retina_file_is_registered(safe_name):
        return jsonify({"success": False, "message": GENERIC_NOT_FOUND_MESSAGE}), 404

    response = send_from_directory(root, safe_name)
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response
