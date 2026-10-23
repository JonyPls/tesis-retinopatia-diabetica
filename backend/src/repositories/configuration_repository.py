from sqlalchemy.orm import selectinload, joinedload

from database import db
from src.models.auth_entities import (Cargo, Permiso, Rol, RolPermiso, TipoDocumento,
                                      Usuario, UsuarioRol)


class ConfigurationRepository:
    @staticmethod
    def users():
        return (Usuario.query.options(
            joinedload(Usuario.cargo), joinedload(Usuario.tipo_documento),
            selectinload(Usuario.roles_rel).joinedload(UsuarioRol.rol))
            .order_by(Usuario.id).all())

    @staticmethod
    def user_for_update(user_id):
        return db.session.query(Usuario).filter_by(id=user_id).with_for_update().first()

    @staticmethod
    def roles():
        return Rol.query.options(selectinload(Rol.permisos_rel).joinedload(RolPermiso.permiso)).order_by(Rol.id).all()

    @staticmethod
    def role(role_id):
        return Rol.query.options(selectinload(Rol.permisos_rel).joinedload(RolPermiso.permiso)).filter_by(id=role_id).first()

    @staticmethod
    def role_for_update(role_id):
        return db.session.query(Rol).filter_by(id=role_id).with_for_update().first()

    @staticmethod
    def role_for_update_by_code(code):
        return db.session.query(Rol).filter_by(codigo=code).with_for_update().first()

    @staticmethod
    def permissions_by_ids(permission_ids):
        return Permiso.query.filter(Permiso.id.in_(permission_ids)).all()

    @staticmethod
    def active_roles(role_ids):
        return Rol.query.filter(Rol.id.in_(role_ids), Rol.estado == 'ACTIVO').all()

    @staticmethod
    def permissions():
        return Permiso.query.order_by(Permiso.modulo, Permiso.nombre).all()

    @staticmethod
    def document_types():
        return TipoDocumento.query.filter_by(estado='ACTIVO').order_by(TipoDocumento.id).all()

    @staticmethod
    def document_type(document_type_id):
        return db.session.get(TipoDocumento, document_type_id)

    @staticmethod
    def positions():
        return Cargo.query.filter_by(estado='ACTIVO').order_by(Cargo.id).all()

    @staticmethod
    def valid_document_and_position(document_type, position):
        document = db.session.get(TipoDocumento, document_type)
        cargo = db.session.get(Cargo, position)
        return bool(document and document.estado == 'ACTIVO' and cargo and cargo.estado == 'ACTIVO')

    @staticmethod
    def active_administrators_for_update():
        return (db.session.query(Usuario).join(UsuarioRol, UsuarioRol.usuario_id == Usuario.id)
                .join(Rol, Rol.id == UsuarioRol.rol_id)
                .filter(Usuario.estado == 'ACTIVO', Rol.estado == 'ACTIVO',
                        Rol.codigo == 'ADMINISTRADOR_SISTEMA')
                .order_by(Usuario.id).with_for_update().all())
