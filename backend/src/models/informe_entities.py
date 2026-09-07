from database import db
from datetime import datetime

class TipoInforme(db.Model):
    __tablename__ = 'tipos_informe'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    descripcion = db.Column(db.String(255))
    codigo_formulario = db.Column(db.String(50), nullable=False)
    schema_version_actual = db.Column(db.Integer, default=1, nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Informe(db.Model):
    __tablename__ = 'informes'
    id = db.Column(db.BigInteger, primary_key=True)
    visita_id = db.Column(db.BigInteger, db.ForeignKey('visitas_clinicas.id'), nullable=False)
    tipo_informe_id = db.Column(db.Integer, db.ForeignKey('tipos_informe.id'), nullable=False)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    schema_version = db.Column(db.Integer, default=1, nullable=False)
    datos_estructurados = db.Column(db.JSON)
    conclusion = db.Column(db.Text)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO', 'ANULADO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    visita = db.relationship('VisitaClinica', backref='informes')
    tipo_informe = db.relationship('TipoInforme')
