"""Extensión opt-in. Nunca se une ni carga desde las entidades clínicas existentes."""

from database import db
from sqlalchemy.dialects.mysql import BIGINT, DATETIME, INTEGER, VARCHAR
from utils.utc_clock import utc_now_naive


ID = db.BigInteger().with_variant(db.Integer(), 'sqlite').with_variant(BIGINT(unsigned=True), 'mysql')
INSTANT = db.DateTime().with_variant(DATETIME(fsp=6), 'mysql')
ACTOR_ID = db.Integer().with_variant(INTEGER(unsigned=True), 'mysql')
OPERATION_ID = db.String(36).with_variant(VARCHAR(36, charset='ascii', collation='ascii_bin'), 'mysql')


class RevisionInferenciaVisita(db.Model):
    __tablename__ = 'diagnostico_ia_revision_visita'
    visita_id = db.Column(ID, db.ForeignKey('visitas_clinicas.id', ondelete='RESTRICT'), primary_key=True)
    revision = db.Column(ID, nullable=False, default=0, server_default=db.text('0'))
    __table_args__ = (db.CheckConstraint('revision >= 0', name='ck_ia_revision_no_negativa'),
                      {'mysql_engine': 'InnoDB'})


class OperacionDescarteIA(db.Model):
    __tablename__ = 'diagnostico_ia_descarte_operaciones'
    operacion_id = db.Column(OPERATION_ID, primary_key=True)
    visita_id = db.Column(ID, db.ForeignKey('visitas_clinicas.id', ondelete='RESTRICT'), nullable=False, index=True)
    autor_id = db.Column(ACTOR_ID, db.ForeignKey('usuarios.id', ondelete='RESTRICT'), nullable=False)
    solicitud = db.Column(db.JSON, nullable=False)
    resultado = db.Column(db.JSON, nullable=False)
    archivos = db.Column(db.JSON, nullable=False)
    estado_limpieza = db.Column(db.String(20), nullable=False, default='PENDIENTE',
                                server_default=db.text("'PENDIENTE'"), index=True)
    fecha_utc = db.Column(INSTANT, nullable=False, default=utc_now_naive)
    __table_args__ = (db.CheckConstraint(
        "estado_limpieza IN ('PENDIENTE','COMPLETADA','CONFLICTO')", name='ck_ia_descarte_limpieza'),
        {'mysql_engine': 'InnoDB'})
