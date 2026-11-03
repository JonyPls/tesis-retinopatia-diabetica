"""Local CODN server: preserve the existing report flags and private storage."""

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
DISCARD_FLAGS = ('DIAGNOSIS_DISCARD_ENABLED', 'DIAGNOSIS_DISCARD_SCHEMA_VERIFIED',
                 'DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY')


def configure_local_discard(app):
    """Solo lecturas: una reconstrucción de MySQL no acredita la extensión de 79."""
    from sqlalchemy import text
    from database import db
    from utils.diagnosis_discard_gate import require_ready, verify_delete_dependencies

    # La aplicación todavía no sirve peticiones. Las compuertas se conservan
    # únicamente si todas las comprobaciones terminan correctamente.
    app.config.update({flag: True for flag in DISCARD_FLAGS})
    try:
        with app.app_context():
            try:
                require_ready()
                verify_delete_dependencies()
                granted = db.session.execute(text(
                    "SELECT 1 FROM permisos p "
                    "JOIN rol_permiso rp ON rp.permiso_id = p.id "
                    "JOIN roles r ON r.id = rp.rol_id "
                    "JOIN usuario_rol ur ON ur.rol_id = r.id "
                    "JOIN usuarios u ON u.id = ur.usuario_id "
                    "WHERE p.codigo = :permission AND p.estado = 'ACTIVO' "
                    "AND r.codigo = 'OFTALMOLOGO' AND r.estado = 'ACTIVO' "
                    "AND u.estado = 'ACTIVO' LIMIT 1"
                ), {'permission': 'diagnostico_retinopatia.descartar_pendiente'}).scalar()
                if not granted:
                    raise RuntimeError('Permiso de descarte no instalado o sin grant efectivo')
            finally:
                db.session.rollback()
    except Exception:
        app.config.update({flag: False for flag in DISCARD_FLAGS})
        app.logger.warning(
            'Descarte IA desactivado: esquema, FK o permiso efectivo no verificados. '
            'Diagnóstico IA tradicional conserva su validación; no se modificó MySQL.')
        return False
    return True


if __name__ == '__main__':
    # El escritor de imágenes usa cwd; normalizarlo antes de importar servicios.
    os.chdir(BACKEND_DIR)
    from app import app

    if not app.config.get('RETINOGRAPH_PRIVATE_DIR'):
        raise SystemExit('Configure RETINOGRAPH_PRIVATE_DIR antes de iniciar Flask local.')

    app.config.update(
        REPORTS_HISTORY_ENABLED=True,
        REPORTS_EDIT_ENABLED=False,
        REPORTS_ANNUL_ENABLED=False,
        DIAGNOSIS_DISCARD_STORAGE_ROOT=str(BACKEND_DIR / 'uploads' / 'retinas'),
    )
    configure_local_discard(app)
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
