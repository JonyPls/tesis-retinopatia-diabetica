from io import BytesIO

from flask import Blueprint, request, jsonify, send_file, send_from_directory
from services.diagnosis_service import (
    procesar_diagnostico,
    confirmar_validacion_detalle,
    consultar_detalles_existentes,
    consultar_detalles_por_visita,
)
from services.retinograph_import_service import (
    obtener_archivo_retinografo,
    obtener_seleccion_automatica,
)
from services.report_service import (
    ReportNotFoundError,
    ReportTemplateError,
    generar_reporte_diagnostico_pdf,
)
from utils.security import clinical_access_required, token_required

diagnosis_bp = Blueprint('diagnosis', __name__)

@diagnosis_bp.route('/api/diagnosticar', methods=['POST'])
@token_required
@clinical_access_required('diagnosticos.crear', 'diagnosticos.gestionar')
def diagnosticar_retina():
    # 1. Verifica el archivo
    if 'imagen' not in request.files:
        message = "Falta la imagen"
        return jsonify({"success": False, "message": message, "error": message}), 400
    
    archivo = request.files['imagen']
    if archivo.filename == '':
        message = "Archivo vacío"
        return jsonify({"success": False, "message": message, "error": message}), 400

    # 2. Capturar los datos del formulario
    paciente_id  = request.form.get('paciente_id')
    ojo_evaluado = request.form.get('ojo_evaluado')
    visita_id = request.form.get('visita_id') or request.form.get('diagnostico_id')

    if not all([paciente_id, ojo_evaluado]):
        message = "Faltan datos (paciente_id u ojo_evaluado)"
        return jsonify({"success": False, "message": message, "error": message}), 400

    usuario_id = request.current_user.get('user_id')

    resultado = procesar_diagnostico(
        archivo_imagen=archivo,
        paciente_id=int(paciente_id),
        usuario_id=int(usuario_id),
        ojo_evaluado=ojo_evaluado,
        visita_id=int(visita_id) if visita_id else None,
    )

    if resultado.get("success"):
        return jsonify(resultado), 200
    else:
        return jsonify(resultado), 400


@diagnosis_bp.route('/api/diagnosticar/visita/<int:visita_id>/detalles', methods=['GET'])
@token_required
@clinical_access_required('diagnosticos.ver')
def obtener_detalles_por_visita(visita_id):
    resultado = consultar_detalles_por_visita(visita_id)
    if resultado.get("success"):
        return jsonify(resultado), 200
    return jsonify(resultado), 404


@diagnosis_bp.route('/api/diagnosticar/diagnostico/<int:diagnostico_id>/detalles', methods=['GET'])
@token_required
@clinical_access_required('diagnosticos.ver')
def obtener_detalles(diagnostico_id):
    resultado = consultar_detalles_existentes(diagnostico_id)
    if resultado.get("success"):
        return jsonify(resultado), 200
    return jsonify(resultado), 404


@diagnosis_bp.route('/api/visitas/<int:visita_id>/reporte-diagnostico', methods=['GET'])
@token_required
@clinical_access_required('diagnosticos.ver')
def descargar_reporte_diagnostico(visita_id):
    try:
        pdf_bytes, filename = generar_reporte_diagnostico_pdf(visita_id)
    except ReportNotFoundError as exc:
        return jsonify({"success": False, "message": str(exc)}), 404
    except ReportTemplateError as exc:
        return jsonify({"success": False, "message": str(exc)}), 500

    response = send_file(
        BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename,
        max_age=0,
    )
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


@diagnosis_bp.route('/api/diagnosticar/retinografo/auto-seleccion/<int:paciente_id>', methods=['GET'])
@token_required
@clinical_access_required('imagenes.ver', 'diagnosticos.crear')
def auto_seleccion_retinografo(paciente_id):
    resultado, status_code = obtener_seleccion_automatica(paciente_id)
    return jsonify(resultado), status_code


@diagnosis_bp.route('/api/diagnosticar/retinografo/imagen', methods=['GET'])
@token_required
@clinical_access_required('imagenes.ver', 'diagnosticos.crear')
def descargar_imagen_retinografo():
    paciente_id = request.args.get('paciente_id')
    filename = request.args.get('filename', '')

    if not paciente_id or not filename:
        return jsonify({
            "success": False,
            "message": "Faltan paciente_id o filename"
        }), 400

    try:
        paciente_id_int = int(paciente_id)
    except ValueError:
        return jsonify({
            "success": False,
            "message": "paciente_id inválido"
        }), 400

    resultado, status_code = obtener_archivo_retinografo(paciente_id_int, filename)
    if not resultado.get("success"):
        return jsonify(resultado), status_code

    return send_from_directory(
        resultado["directory"],
        resultado["filename"],
        mimetype=resultado["mimetype"],
        as_attachment=False,
    )


@diagnosis_bp.route('/api/diagnosticar/detalle/<int:detalle_id>/validar', methods=['PUT'])
@token_required
@clinical_access_required('diagnosticos.validar', 'diagnosticos.gestionar')
def confirmar_validacion(detalle_id):
    datos = request.get_json()
    
    if not datos or 'diagnostico_final' not in datos:
        message = "Falta el diagnostico_final"
        return jsonify({"success": False, "message": message, "error": message}), 400
        
    resultado = confirmar_validacion_detalle(
        detalle_id=detalle_id,
        diagnostico_final=datos['diagnostico_final'],
        comentario_medico=datos.get('comentario_medico'),
        motivo_correccion=datos.get('motivo_correccion'),
        usuario_id=request.current_user.get('user_id'),
    )
    
    if resultado.get("success"):
        return jsonify(resultado), 200
    else:
        return jsonify(resultado), 400
