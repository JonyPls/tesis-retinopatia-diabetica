from database import db
from utils.utc_clock import utc_now_naive
from sqlalchemy.dialects.mysql import BIGINT, INTEGER, SMALLINT, DATETIME

class TipoInforme(db.Model):
    __tablename__ = 'tipos_informe'
    id = db.Column(SMALLINT(unsigned=True), primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    descripcion = db.Column(db.String(255))
    codigo_formulario = db.Column(db.String(50), nullable=False)
    schema_version_actual = db.Column(SMALLINT(unsigned=True), default=1, nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=utc_now_naive)
    fecha_actualizado = db.Column(db.DateTime, default=utc_now_naive, onupdate=utc_now_naive)

class Informe(db.Model):
    __tablename__ = 'informes'
    __table_args__ = (
        db.UniqueConstraint('visita_id', 'tipo_informe_id', name='uq_informes_visita_tipo'),
        db.CheckConstraint('revision_actual >= 1', name='ck_informes_revision'),
    )
    id = db.Column(BIGINT(unsigned=True), primary_key=True)
    visita_id = db.Column(BIGINT(unsigned=True), db.ForeignKey('visitas_clinicas.id', onupdate='CASCADE', ondelete='CASCADE'), nullable=False)
    tipo_informe_id = db.Column(SMALLINT(unsigned=True), db.ForeignKey('tipos_informe.id', onupdate='CASCADE', ondelete='RESTRICT'), nullable=False)
    usuario_id = db.Column(INTEGER(unsigned=True), db.ForeignKey('usuarios.id', onupdate='CASCADE', ondelete='RESTRICT'), nullable=False)
    schema_version = db.Column(SMALLINT(unsigned=True), default=1, nullable=False)
    revision_actual = db.Column(BIGINT(unsigned=True), default=1, server_default=db.text('1'), nullable=False)
    datos_estructurados = db.Column(db.JSON)
    conclusion = db.Column(db.Text)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO', 'ANULADO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=utc_now_naive)
    fecha_actualizado = db.Column(db.DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    visita = db.relationship('VisitaClinica', backref='informes')
    tipo_informe = db.relationship('TipoInforme')
    versiones = db.relationship('InformeVersion', back_populates='informe',
                                order_by='InformeVersion.numero_version', passive_deletes='all')


class InformeVersion(db.Model):
    __tablename__ = 'informes_versiones'
    __table_args__ = (
        db.UniqueConstraint('informe_id', 'numero_version', name='uq_informes_versiones_informe_numero'),
        db.Index('idx_informes_versiones_autor_fecha', 'autor_operacion_id', 'fecha_operacion'),
        db.CheckConstraint('numero_version >= 1', name='ck_informes_versiones_numero'),
        db.CheckConstraint("operacion IN ('CREACION','MIGRACION_INICIAL','CORRECCION','ANULACION','INACTIVACION')",
                           name='ck_informes_versiones_operacion'),
        db.CheckConstraint("estado IN ('ACTIVO','INACTIVO','ANULADO')", name='ck_informes_versiones_estado'),
        db.CheckConstraint("operacion NOT IN ('CREACION','MIGRACION_INICIAL') OR numero_version = 1",
                           name='ck_informes_versiones_inicial'),
        db.CheckConstraint("operacion = 'MIGRACION_INICIAL' OR autor_operacion_id IS NOT NULL",
                           name='ck_informes_versiones_autor'),
        db.CheckConstraint("operacion IN ('CREACION','MIGRACION_INICIAL') OR "
                           "(motivo IS NOT NULL AND REGEXP_LIKE(motivo, '[^[:space:]]'))",
                           name='ck_informes_versiones_motivo'),
    )

    id = db.Column(BIGINT(unsigned=True), primary_key=True)
    informe_id = db.Column(BIGINT(unsigned=True), db.ForeignKey('informes.id', ondelete='RESTRICT', onupdate='RESTRICT'), nullable=False)
    numero_version = db.Column(BIGINT(unsigned=True), nullable=False)
    operacion = db.Column(db.Enum('CREACION', 'MIGRACION_INICIAL', 'CORRECCION', 'ANULACION', 'INACTIVACION'), nullable=False)
    schema_version = db.Column(SMALLINT(unsigned=True), nullable=False)
    datos_estructurados = db.Column(db.JSON)
    conclusion = db.Column(db.Text)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO', 'ANULADO'), nullable=False)
    autor_operacion_id = db.Column(INTEGER(unsigned=True), db.ForeignKey('usuarios.id', ondelete='RESTRICT', onupdate='RESTRICT'))
    fecha_operacion = db.Column(DATETIME(fsp=6), nullable=False, server_default=db.text('CURRENT_TIMESTAMP(6)'))
    motivo = db.Column(db.String(1000))

    informe = db.relationship('Informe', back_populates='versiones')
    autor_operacion = db.relationship('Usuario')
