from flask import Blueprint, send_from_directory, jsonify
import os

files_bp = Blueprint('files_bp', __name__)

RETINAS_FOLDER = os.path.join(os.path.dirname(__file__), '..', 'uploads', 'retinas')

@files_bp.route('/uploads/retinas/<path:filename>', methods=['GET'])
def serve_retina_image(filename):
    if not os.path.exists(os.path.join(RETINAS_FOLDER, filename)):
        return jsonify({"status": "error", "message": "Imagen no encontrada."}), 404
    
    return send_from_directory(RETINAS_FOLDER, filename)