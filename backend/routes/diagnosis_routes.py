import os
from flask import Blueprint, request, jsonify
from services.diagnosis_service import procesar_diagnostico, confirmar_validacion_diagnostico
from utils.security import token_required

diagnosis_bp = Blueprint('diagnosis', __name__)

@diagnosis_bp.route('/api/diagnosticar', methods=['POST'])
@token_required
def diagnosticar_retina():
    # 1. Verifica el archivo
    if 'imagen' not in request.files:
        return jsonify({"success": False, "error": "Falta la imagen"}), 400
    
    archivo = request.files['imagen']
    if archivo.filename == '':
        return jsonify({"success": False, "error": "Archivo vacío"}), 400

    # 2. Capturar los datos del formulario
    paciente_id  = request.form.get('paciente_id')
    ojo_evaluado = request.form.get('ojo_evaluado')

    if not all([paciente_id, ojo_evaluado]):
        return jsonify({"success": False, "error": "Faltan datos (paciente_id u ojo_evaluado)"}), 400

    usuario_id = request.current_user.get('user_id')

    resultado = procesar_diagnostico(
        archivo_imagen=archivo,
        paciente_id=int(paciente_id),
        usuario_id=int(usuario_id),
        ojo_evaluado=ojo_evaluado
    )

    if resultado.get("success"):
        return jsonify(resultado), 200
    else:
        return jsonify(resultado), 400


@diagnosis_bp.route('/api/diagnosticar/<int:diagnostico_id>/validar', methods=['PUT'])
@token_required
def confirmar_validacion(diagnostico_id):
    datos = request.get_json()
    
    if not datos or 'diagnostico_final' not in datos:
        return jsonify({"success": False, "error": "Falta el diagnostico_final"}), 400
        
    # Llamada al servicio
    resultado = confirmar_validacion_diagnostico(
        diagnostico_id=diagnostico_id,
        diagnostico_final=datos['diagnostico_final'],
        comentario_medico=datos.get('comentario_medico')
    )
    
    if resultado.get("success"):
        return jsonify(resultado), 200
    else:
        return jsonify(resultado), 500