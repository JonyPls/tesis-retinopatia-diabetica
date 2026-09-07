from database import db
from datetime import datetime

class TipoDocumento(db.Model):
    __tablename__ = 'tipos_documento'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50), nullable=False)
    codigo = db.Column(db.String(10), nullable=False, unique=True)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Rol(db.Model):
    __tablename__ = 'roles'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50), nullable=False)
    codigo = db.Column(db.String(50), nullable=False, unique=True)
    descripcion = db.Column(db.String(255))
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Cargo(db.Model):
    __tablename__ = 'cargos'
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(80), nullable=False, unique=True)
    descripcion = db.Column(db.String(255))
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Permiso(db.Model):
    __tablename__ = 'permisos'
    id = db.Column(db.Integer, primary_key=True)
    codigo = db.Column(db.String(80), nullable=False, unique=True)
    nombre = db.Column(db.String(100), nullable=False)
    descripcion = db.Column(db.String(255))
    modulo = db.Column(db.String(50), nullable=False)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class UsuarioRol(db.Model):
    __tablename__ = 'usuario_rol'
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), primary_key=True)
    rol_id = db.Column(db.Integer, db.ForeignKey('roles.id'), primary_key=True)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    
    rol = db.relationship('Rol')

class RolPermiso(db.Model):
    __tablename__ = 'rol_permiso'
    rol_id = db.Column(db.Integer, db.ForeignKey('roles.id'), primary_key=True)
    permiso_id = db.Column(db.Integer, db.ForeignKey('permisos.id'), primary_key=True)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)

    permiso = db.relationship('Permiso')
    rol = db.relationship('Rol', backref='permisos_rel')

class Usuario(db.Model):
    __tablename__ = 'usuarios'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    nombres = db.Column(db.String(80), nullable=False)
    apellidos = db.Column(db.String(100), nullable=False)
    correo = db.Column(db.String(150), nullable=False, unique=True)
    tipo_doc_id = db.Column(db.Integer, db.ForeignKey('tipos_documento.id'), nullable=False)
    cargo_id = db.Column(db.Integer, db.ForeignKey('cargos.id'), nullable=False)
    nro_documento = db.Column(db.String(25), nullable=False)
    cmp = db.Column(db.String(20), unique=True)
    rne = db.Column(db.String(20), unique=True)
    estado = db.Column(db.Enum('ACTIVO', 'INACTIVO'), default='ACTIVO')
    ultimo_acceso = db.Column(db.DateTime)
    fecha_creado = db.Column(db.DateTime, default=datetime.utcnow)
    fecha_actualizado = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    cargo = db.relationship('Cargo')
    tipo_documento = db.relationship('TipoDocumento')
    roles_rel = db.relationship('UsuarioRol', backref='usuario', cascade='all, delete-orphan')
    
    @property
    def roles(self):
        return [ur.rol.nombre for ur in self.roles_rel if ur.rol.estado == 'ACTIVO']

    @property
    def permisos(self):
        permisos = set()
        for ur in self.roles_rel:
            if ur.rol.estado != 'ACTIVO':
                continue
            for rp in ur.rol.permisos_rel:
                if rp.permiso.estado == 'ACTIVO':
                    permisos.add(rp.permiso.codigo)
        return sorted(permisos)
