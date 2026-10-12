from io import BytesIO

from flask import Blueprint, request, jsonify, send_file, send_from_directory, current_app
from werkzeug.exceptions import RequestEntityTooLarge
from dl_model.validator import MAX_IMAGE_BYTES
from services.diagnosis_service import (
    procesar_diagnostico,
    confirmar_validacion_detalle,
    consultar_detalles_existentes,
    consultar_detalles_por_visita,
    DIAGNOSIS_NOT_FOUND_MESSAGE,
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
from utils.strict_authorization import strict_authorization_required

diagnosis_bp = Blueprint('diagnosis', __name__)

@diagnosis_bp.route('/api/diagnosticar', methods=['POST'])
@token_required
@clinical_access_required('diagnosticos.crear', 'diagnosticos.gestionar')
def diagnosticar_retina():
    # Límite por petición, sin afectar a otras rutas ni leer el archivo entero.
    max_bytes = current_app.config.get('DIAGNOSIS_MAX_IMAGE_BYTES', MAX_IMAGE_BYTES)
    request.max_content_length = max_bytes + 64 * 1024  # envoltura multipart
    try:
        if request.content_length is not None and request.content_length > request.max_content_length:
            raise RequestEntityTooLarge()
        archivo = request.files.get('imagen')
        form = request.form
    except RequestEntityTooLarge:
        return jsonify({"success": False, "message": "Archivo demasiado grande."}), 413

    if archivo is None:
        message = "Falta la imagen"
        return jsonify({"success": False, "message": message, "error": message}), 400
    if not archivo.filename:
        message = "Archivo vacío"
        return jsonify({"success": False, "message": message, "error": message}), 400

    paciente_id = form.get('paciente_id')
    ojo_evaluado = form.get('ojo_evaluado')
    visita_id = form.get('visita_id')
    diagnostico_id = form.get('diagnostico_id')  # Alias legacy del ID de visita.

    if not all([paciente_id, ojo_evaluado]):
        message = "Faltan datos (paciente_id u ojo_evaluado)"
        return jsonify({"success": False, "message": message, "error": message}), 400
    if (ojo_evaluado not in ('Derecho', 'Izquierdo') or
            not paciente_id.isascii() or not paciente_id.isdecimal() or
            any(value is not None and (not value or not value.isascii() or not value.isdecimal())
                for value in (visita_id, diagnostico_id))):
        return jsonify({"success": False, "message": "Datos de diagnóstico inválidos."}), 400
    try:
        paciente_id = int(paciente_id)
        visita_id = int(visita_id) if visita_id is not None else None
        diagnostico_id = int(diagnostico_id) if diagnostico_id is not None else None
    except ValueError:
        return jsonify({"success": False, "message": "Datos de diagnóstico inválidos."}), 400
    if (paciente_id < 1 or (visita_id is not None and visita_id < 1) or
            (diagnostico_id is not None and diagnostico_id < 1) or
            (visita_id is not None and diagnostico_id is not None and visita_id != diagnostico_id)):
        return jsonify({"success": False, "message": "Datos de diagnóstico inválidos."}), 400

    usuario_id = request.current_user.get('user_id')

    resultado, status_code = procesar_diagnostico(
        archivo_imagen=archivo,
        paciente_id=paciente_id,
        usuario_id=int(usuario_id),
        ojo_evaluado=ojo_evaluado,
        visita_id=visita_id if visita_id is not None else diagnostico_id,
        require_existing_diagnosis=diagnostico_id is not None,
    )
    return jsonify(resultado), status_code


@diagnosis_bp.route('/api/diagnosticar/visita/<int:visita_id>/detalles', methods=['GET'])
@strict_authorization_required('diagnosis.details_read')
def obtener_detalles_por_visita(visita_id):
    resultado = consultar_detalles_por_visita(visita_id)
    if resultado.get("success"):
        return jsonify(resultado), 200
    return jsonify(resultado), 404 if resultado.get("message") == DIAGNOSIS_NOT_FOUND_MESSAGE else 500


@diagnosis_bp.route('/api/diagnosticar/diagnostico/<int:diagnostico_id>/detalles', methods=['GET'])
@strict_authorization_required('diagnosis.details_read')
def obtener_detalles(diagnostico_id):
    resultado = consultar_detalles_existentes(diagnostico_id)
    if resultado.get("success"):
        return jsonify(resultado), 200
    return jsonify(resultado), 404 if resultado.get("message") == DIAGNOSIS_NOT_FOUND_MESSAGE else 500


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
@strict_authorization_required('diagnosis.validate')
def confirmar_validacion(detalle_id):
    datos = request.get_json(silent=True)
    
    if not isinstance(datos, dict) or 'diagnostico_final' not in datos:
        message = "Falta el diagnostico_final"
        return jsonify({"success": False, "message": message, "error": message}), 400
    if (set(datos) - {'diagnostico_final', 'comentario_medico', 'motivo_correccion'}
            or type(datos['diagnostico_final']) is not int
            or not 0 <= datos['diagnostico_final'] <= 4
            or any(datos.get(key) is not None and not isinstance(datos[key], str)
                   for key in ('comentario_medico', 'motivo_correccion'))):
        return jsonify({"success": False, "message": "Datos de validación inválidos."}), 400

    resultado, status_code = confirmar_validacion_detalle(
        detalle_id=detalle_id,
        diagnostico_final=datos['diagnostico_final'],
        comentario_medico=datos.get('comentario_medico'),
        motivo_correccion=datos.get('motivo_correccion'),
        usuario_id=request.current_user.get('user_id'),
    )
    
    return jsonify(resultado), status_code
