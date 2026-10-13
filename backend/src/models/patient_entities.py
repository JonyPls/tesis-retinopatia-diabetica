from database import db
from utils.utc_clock import utc_now_naive
from utils.temporal_provenance import install_provenance, provenance_checks, UNVERIFIED


def _origin():
    return db.Column(db.String(16), nullable=False, default=UNVERIFIED,
                     server_default=db.text("'NO_VERIFICADO'"))

class Paciente(db.Model):
    __tablename__ = 'pacientes'
    id = db.Column(db.Integer, primary_key=True)
    tipo_doc_id = db.Column(db.Integer, db.ForeignKey('tipos_documento.id'), nullable=False)
    nro_documento = db.Column(db.String(25), nullable=False)
    nombres = db.Column(db.String(80), nullable=False)
    apellidos = db.Column(db.String(100), nullable=False)
    sexo = db.Column(db.Enum('Masculino', 'Femenino'), nullable=False)
    fecha_nacimiento = db.Column(db.Date, nullable=False)
    telefono = db.Column(db.String(20))
    correo = db.Column(db.String(150))
    direccion = db.Column(db.String(255))
    antecedentes_clinicos = db.Column(db.Text)
    alergias = db.Column(db.Text)
    consentimiento_informado = db.Column(db.Boolean, default=False, nullable=False)
    fecha_consentimiento = db.Column(db.DateTime)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=utc_now_naive)
    fecha_actualizado = db.Column(db.DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    tipo_documento = db.relationship('TipoDocumento')

class VisitaClinica(db.Model):
    __tablename__ = 'visitas_clinicas'
    __table_args__ = provenance_checks('visitas', ('fecha_visita', 'fecha_creado', 'fecha_actualizado'))
    id = db.Column(db.BigInteger, primary_key=True)
    paciente_id = db.Column(db.Integer, db.ForeignKey('pacientes.id'), nullable=False)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    fecha_visita = db.Column(db.DateTime, default=utc_now_naive, nullable=False)
    fecha_visita_origen = _origin()
    motivo_consulta = db.Column(db.String(255))
    observaciones = db.Column(db.Text)
    estado = db.Column(db.Enum('ACTIVA', 'CERRADA', 'ANULADA'), default='ACTIVA')
    fecha_creado = db.Column(db.DateTime, default=utc_now_naive)
    fecha_creado_origen = _origin()
    fecha_actualizado = db.Column(db.DateTime, default=utc_now_naive, onupdate=utc_now_naive)
    fecha_actualizado_origen = _origin()

    paciente = db.relationship('Paciente', backref='visitas')


install_provenance(VisitaClinica, fields=('fecha_visita', 'fecha_creado', 'fecha_actualizado'), updated=True)
