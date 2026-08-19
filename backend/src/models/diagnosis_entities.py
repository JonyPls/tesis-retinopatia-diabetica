from database import db
from datetime import datetime

class Diagnostico(db.Model):
    __tablename__ = 'diagnosticos'
    id = db.Column(db.Integer, primary_key=True)
    paciente_id = db.Column(db.Integer, db.ForeignKey('pacientes.id'), nullable=False)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    fecha_registro = db.Column(db.DateTime, default=datetime.utcnow)

    detalles = db.relationship('DiagnosticoDetalle', backref='diagnostico', cascade='all, delete-orphan')

class DiagnosticoDetalle(db.Model):
    __tablename__ = 'diagnosticos_detalle'
    id = db.Column(db.Integer, primary_key=True)
    diagnostico_id = db.Column(db.Integer, db.ForeignKey('diagnosticos.id'), nullable=False)
    ojo_evaluado = db.Column(db.Enum('Derecho', 'Izquierdo'), nullable=False)
    imagen_url = db.Column(db.String(255))
    probabilidad_ia = db.Column(db.Numeric(5, 4))
    resultado_completo = db.Column(db.JSON)
    resultado_ia = db.Column(db.SmallInteger)
    diagnostico_final = db.Column(db.SmallInteger)
    estado_validacion = db.Column(db.Enum('Pendiente', 'Aprobado', 'Corregido'), default='Pendiente')
    comentario_medico = db.Column(db.Text)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
