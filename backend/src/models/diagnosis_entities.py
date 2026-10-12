from database import db
from datetime import datetime
from sqlalchemy.dialects.mysql import BIGINT, BINARY, CHAR, DATETIME, INTEGER

class GradoRetinopatia(db.Model):
    __tablename__ = 'grados_retinopatia'
    id = db.Column(db.SmallInteger, primary_key=True)
    codigo = db.Column(db.String(20), nullable=False, unique=True)
    nombre = db.Column(db.String(80), nullable=False)
    descripcion = db.Column(db.String(255))
    requiere_alerta = db.Column(db.Boolean, default=False, nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO', nullable=False)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Diagnostico(db.Model):
    __tablename__ = 'diagnosticos_retinopatia'
    id = db.Column(db.BigInteger, primary_key=True)
    visita_id = db.Column(db.BigInteger, db.ForeignKey('visitas_clinicas.id'), nullable=False, unique=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    modelo_nombre = db.Column(db.String(100), nullable=False, default='ResNet50')
    modelo_version = db.Column(db.String(50))
    estado = db.Column(db.Enum('PENDIENTE', 'PROCESADO', 'VALIDADO', 'ANULADO'), default='PENDIENTE')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    detalles = db.relationship('DiagnosticoDetalle', backref='diagnostico', cascade='all, delete-orphan')

class DiagnosticoDetalle(db.Model):
    __tablename__ = 'diagnosticos_retinopatia_detalle'
    id = db.Column(db.BigInteger, primary_key=True)
    diagnostico_retinopatia_id = db.Column(db.BigInteger, db.ForeignKey('diagnosticos_retinopatia.id'), nullable=False)
    ojo_evaluado = db.Column(db.Enum('Derecho', 'Izquierdo'), nullable=False)
    imagen_original_url = db.Column(db.String(255), nullable=False)
    imagen_gradcam_url = db.Column(db.String(255))
    nombre_archivo_original = db.Column(db.String(255))
    formato_archivo = db.Column(db.String(20))
    ancho_px = db.Column(db.Integer)
    alto_px = db.Column(db.Integer)
    tamano_bytes = db.Column(db.Integer)
    hash_archivo = db.Column(db.String(64))
    probabilidad_ia = db.Column(db.Numeric(6, 5))
    resultado_ia_id = db.Column(db.SmallInteger, db.ForeignKey('grados_retinopatia.id'))
    resultado_final_id = db.Column(db.SmallInteger, db.ForeignKey('grados_retinopatia.id'))
    resultado_completo = db.Column(db.JSON)
    estado_validacion = db.Column(db.Enum('PENDIENTE', 'APROBADO', 'CORREGIDO'), default='PENDIENTE', nullable=False)
    comentario_medico = db.Column(db.Text)
    motivo_correccion = db.Column(db.Text)
    validado_por = db.Column(db.Integer, db.ForeignKey('usuarios.id'))
    fecha_validacion = db.Column(db.DateTime)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resultado_ia = db.relationship('GradoRetinopatia', foreign_keys=[resultado_ia_id])
    resultado_final = db.relationship('GradoRetinopatia', foreign_keys=[resultado_final_id])


class ConfirmacionExportacionRetinografo(db.Model):
    """Asociacion humana de una exportacion; no es validacion de un resultado IA."""
    __tablename__ = 'confirmaciones_exportacion_retinografo'
    __table_args__ = (
        db.UniqueConstraint('token_verificador', name='uq_confirmacion_token'),
        db.UniqueConstraint('clave_copia', name='uq_confirmacion_copia'),
        db.UniqueConstraint('detalle_id', name='uq_confirmacion_detalle'),
        db.Index('idx_confirmacion_paciente_estado', 'paciente_id', 'estado'),
        db.Index('idx_confirmacion_profesional_fecha', 'confirmado_por', 'fecha_confirmacion'),
        db.Index('idx_confirmacion_revocador', 'revocada_por'),
        db.CheckConstraint("REGEXP_LIKE(sha256_fuente, '^[0-9a-f]{64}$', 'c')",
                           name='ck_confirmacion_sha256'),
        db.CheckConstraint("REGEXP_LIKE(clave_copia, '^[0-9a-f]{32}$', 'c')",
                           name='ck_confirmacion_copia'),
        db.CheckConstraint('fecha_expiracion = fecha_confirmacion + INTERVAL 60 MINUTE',
                           name='ck_confirmacion_vigencia'),
        db.CheckConstraint("""(estado = 'CONFIRMADA' AND detalle_id IS NULL AND fecha_consumo IS NULL
                           AND revocada_por IS NULL AND fecha_revocacion IS NULL)
                        OR (estado = 'CONSUMIDA' AND detalle_id IS NOT NULL AND fecha_consumo IS NOT NULL
                           AND revocada_por IS NULL AND fecha_revocacion IS NULL)
                        OR (estado = 'REVOCADA' AND detalle_id IS NULL AND fecha_consumo IS NULL
                           AND revocada_por IS NOT NULL AND fecha_revocacion IS NOT NULL)""",
                           name='ck_confirmacion_estado'),
        db.CheckConstraint('(fecha_consumo IS NULL OR fecha_consumo >= fecha_confirmacion) '
                           'AND (fecha_revocacion IS NULL OR fecha_revocacion >= fecha_confirmacion)',
                           name='ck_confirmacion_fechas'),
    )

    id = db.Column(BIGINT(unsigned=True), primary_key=True)
    # Verificador de un secreto futuro de 32 bytes; nunca almacenar el token en claro.
    token_verificador = db.Column(BINARY(32), nullable=False)
    paciente_id = db.Column(INTEGER(unsigned=True), db.ForeignKey('pacientes.id', name='fk_confirmacion_paciente', ondelete='RESTRICT', onupdate='CASCADE'), nullable=False)
    confirmado_por = db.Column(INTEGER(unsigned=True), db.ForeignKey('usuarios.id', name='fk_confirmacion_profesional', ondelete='RESTRICT', onupdate='CASCADE'), nullable=False)
    ojo_confirmado = db.Column(db.Enum('Derecho', 'Izquierdo'), nullable=False)
    nombre_exportacion = db.Column(db.String(255, collation='utf8mb4_bin'), nullable=False)
    sha256_fuente = db.Column(CHAR(64, charset='ascii', collation='ascii_bin'), nullable=False)
    clave_copia = db.Column(CHAR(32, charset='ascii', collation='ascii_bin'), nullable=False)
    fecha_confirmacion = db.Column(DATETIME(fsp=6), nullable=False)
    fecha_expiracion = db.Column(DATETIME(fsp=6), nullable=False)
    estado = db.Column(db.Enum('CONFIRMADA', 'CONSUMIDA', 'REVOCADA'), nullable=False)
    detalle_id = db.Column(BIGINT(unsigned=True), db.ForeignKey('diagnosticos_retinopatia_detalle.id', name='fk_confirmacion_detalle', ondelete='RESTRICT', onupdate='RESTRICT'))
    fecha_consumo = db.Column(DATETIME(fsp=6))
    revocada_por = db.Column(INTEGER(unsigned=True), db.ForeignKey('usuarios.id', name='fk_confirmacion_revocador', ondelete='RESTRICT', onupdate='RESTRICT'))
    fecha_revocacion = db.Column(DATETIME(fsp=6))

    paciente = db.relationship('Paciente', foreign_keys=[paciente_id])
    confirmador = db.relationship('Usuario', foreign_keys=[confirmado_por])
    revocador = db.relationship('Usuario', foreign_keys=[revocada_por])
    detalle = db.relationship('DiagnosticoDetalle', foreign_keys=[detalle_id], uselist=False)
