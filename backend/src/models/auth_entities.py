from database import db
from datetime import datetime

class TipoDocumento(db.Model):
    __tablename__ = 'tipos_documento'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50), nullable=False)
    codigo = db.Column(db.String(5), nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Rol(db.Model):
    __tablename__ = 'roles'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50), nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class UsuarioRol(db.Model):
    __tablename__ = 'usuario_rol'
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), primary_key=True)
    rol_id = db.Column(db.Integer, db.ForeignKey('roles.id'), primary_key=True)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    
    rol = db.relationship('Rol')

class Usuario(db.Model):
    __tablename__ = 'usuarios'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    nombres = db.Column(db.String(50), nullable=False)
    apellidos = db.Column(db.String(50), nullable=False)
    correo = db.Column(db.String(150), nullable=False, unique=True)
    tipo_doc = db.Column(db.Integer, db.ForeignKey('tipos_documento.id'), nullable=False)
    nro_documento = db.Column(db.String(20), nullable=False, unique=True)
    cmp = db.Column(db.String(10), unique=True)
    rne = db.Column(db.String(10), unique=True)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    roles_rel = db.relationship('UsuarioRol', backref='usuario', cascade='all, delete-orphan')
    
    @property
    def roles(self):
        return [ur.rol.nombre for ur in self.roles_rel if ur.rol.estado == 'ACTIVO']
