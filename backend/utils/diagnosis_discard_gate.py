"""Sin consultas a la extensión mientras el descarte está deshabilitado."""

from flask import current_app
from sqlalchemy import inspect, text
from database import db


class DiscardError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def enabled():
    return current_app.config.get('DIAGNOSIS_DISCARD_ENABLED') is True


def rollback_safely():
    try:
        db.session.rollback()
    except Exception:
        current_app.logger.error('Rollback de extensión IA no confirmado')


def require_ready():
    if not enabled():
        raise DiscardError(403, 'DESCARTE_DESHABILITADO')
    if (current_app.config.get('DIAGNOSIS_DISCARD_SCHEMA_VERIFIED') is not True or
            current_app.config.get('DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY') is not True):
        raise DiscardError(503, 'DESCARTE_NO_INSTALADO')
    try:
        # Comprobar columnas incluso si las tablas aún están vacías. Sin fallback.
        from src.models.diagnosis_discard_entities import RevisionInferenciaVisita, OperacionDescarteIA
        db.session.query(RevisionInferenciaVisita).limit(0).all()
        db.session.query(OperacionDescarteIA).limit(0).all()
    except Exception:
        rollback_safely()
        raise DiscardError(503, 'DESCARTE_NO_INSTALADO') from None


def verify_delete_dependencies():
    """Rechazar cascadas/FK desconocidas antes de borrar, no después del daño."""
    inspector = inspect(db.session.connection())
    allowed = {
        ('diagnosticos_retinopatia_detalle', 'diagnosticos_retinopatia',
         ('diagnostico_retinopatia_id',), ('id',)),
        ('confirmaciones_exportacion_retinografo', 'diagnosticos_retinopatia_detalle',
         ('detalle_id',), ('id',)),
    }
    targets = {'diagnosticos_retinopatia', 'diagnosticos_retinopatia_detalle'}
    for table in inspector.get_table_names():
        for fk in inspector.get_foreign_keys(table):
            if fk['referred_table'] not in targets:
                continue
            key = (table, fk['referred_table'], tuple(fk['constrained_columns']), tuple(fk['referred_columns']))
            action = (fk.get('options', {}).get('ondelete') or 'RESTRICT').upper()
            if key not in allowed or action not in ('RESTRICT', 'NO ACTION'):
                raise DiscardError(409, 'DEPENDENCIA_NO_COMPATIBLE')
    if db.session.get_bind().dialect.name == 'mysql':
        external = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE "
            "WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND TABLE_SCHEMA <> DATABASE() "
            "AND REFERENCED_TABLE_NAME IN ('diagnosticos_retinopatia','diagnosticos_retinopatia_detalle')"
        )).scalar()
        if external:
            raise DiscardError(409, 'DEPENDENCIA_NO_COMPATIBLE')
        triggers = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() "
            "AND EVENT_OBJECT_TABLE IN ('diagnosticos_retinopatia','diagnosticos_retinopatia_detalle')"
        )).scalar()
        if triggers:
            raise DiscardError(409, 'DEPENDENCIA_NO_COMPATIBLE')
