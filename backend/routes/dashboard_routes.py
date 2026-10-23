from flask import Blueprint, current_app, jsonify, request

from services.dashboard_service import clinical_summary
from utils.strict_authorization import strict_authorization_required


dashboard_bp = Blueprint('dashboard_bp', __name__)


@dashboard_bp.get('/api/dashboard/clinico')
@strict_authorization_required('dashboard.clinical_read')
def get_clinical_dashboard():
    try:
        response = jsonify({'success': True, 'data': clinical_summary(request.authenticated_user)})
        response.headers['Cache-Control'] = 'private, no-store'
        return response
    except Exception:
        current_app.logger.exception('Error al consultar el resumen clínico')
        return jsonify({'success': False, 'message': 'No se pudo procesar la solicitud.'}), 500
