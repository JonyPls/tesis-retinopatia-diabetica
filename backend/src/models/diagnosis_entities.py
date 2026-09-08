from database import db
from datetime import datetime

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
