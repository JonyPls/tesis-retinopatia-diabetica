from database import db
from datetime import datetime

class TipoInforme(db.Model):
    __tablename__ = 'tipos_informe'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    descripcion = db.Column(db.String(255))
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Informe(db.Model):
    __tablename__ = 'informes'
    id = db.Column(db.Integer, primary_key=True)
    diagnostico_id = db.Column(db.Integer, db.ForeignKey('diagnosticos.id'), nullable=False)
    tipo_informe_id = db.Column(db.Integer, db.ForeignKey('tipos_informe.id'), nullable=False)
    datos_estructurados = db.Column(db.JSON)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    diagnostico = db.relationship('Diagnostico', backref='informes')
    tipo_informe = db.relationship('TipoInforme')
