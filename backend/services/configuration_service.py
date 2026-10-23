"""Operaciones administrativas B1 sobre usuarios, roles y permisos."""
import re

from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from database import db
from src.models.auth_entities import RolPermiso, Usuario, UsuarioRol
from src.repositories.configuration_repository import ConfigurationRepository as repo
from utils.identity_validation import DOCUMENT_PATTERNS, valid_email


class InputError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _fields(payload, allowed):
    if not isinstance(payload, dict) or set(payload) - set(allowed):
        raise InputError('Datos inválidos.')


def _text(payload, field, length, *, required=True):
    value = payload.get(field)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > length:
        raise InputError(f'{field}: valor inválido.')
    return value.strip()


def _id(value):
    if type(value) is not int or value < 1:
        raise InputError('Identificador inválido.')
    return value


def _role_ids(value):
    if not isinstance(value, list) or not value or len(value) != len(set(map(str, value))):
        raise InputError('Seleccione roles válidos sin repetir.')
    ids = {_id(role_id) for role_id in value}
    if len(repo.active_roles(ids)) != len(ids):
        raise InputError('Rol no disponible.', 404)
    return ids


def _validate_new_document(values):
    document = repo.document_type(values['tipo_doc_id'])
    rule = DOCUMENT_PATTERNS.get(document.codigo) if document else None
    if not rule:
        raise InputError('Tipo de documento inválido.')
    if document.codigo != 'DNI':
        values['nro_documento'] = values['nro_documento'].upper()
    if not rule[0].fullmatch(values['nro_documento']):
        raise InputError(f'nro_documento: {rule[1]}')


def _user_data(payload, *, creating=False):
    allowed = ('nombres', 'apellidos', 'username', 'correo', 'tipo_doc_id',
               'nro_documento', 'cargo_id', 'cmp', 'rne')
    if creating:
        _fields(payload, (*allowed, 'password', 'role_ids'))
    else:
        _fields(payload, allowed)
        if not payload:
            raise InputError('Indique campos para actualizar.')
    values = {}
    for field, length in (('nombres', 80), ('apellidos', 100), ('username', 50),
                          ('correo', 150), ('nro_documento', 25)):
        if creating or field in payload:
            values[field] = _text(payload, field, length)
    if 'username' in values and not re.fullmatch(r'[A-Za-z0-9_.-]{3,50}', values['username']):
        raise InputError('Identificador de acceso inválido.')
    if 'correo' in values and not valid_email(values['correo']):
        raise InputError('correo: ingrese un correo electrónico válido.')
    for field in ('tipo_doc_id', 'cargo_id'):
        if creating or field in payload:
            values[field] = _id(payload.get(field))
    for field in ('cmp', 'rne'):
        if field in payload:
            value = payload[field]
            values[field] = None if value is None or value == '' else _text(payload, field, 20)
            if values[field] and (not re.fullmatch(r'[0-9]{1,20}', values[field])
                                  or not re.search(r'[1-9]', values[field])):
                raise InputError(f'{field}: debe contener de 1 a 20 dígitos y no ser todo ceros.')
    return values


def user_view(user):
    return dict(id=user.id, username=user.username, nombres=user.nombres,
                apellidos=user.apellidos, correo=user.correo, tipo_doc_id=user.tipo_doc_id,
                nro_documento=user.nro_documento, cargo_id=user.cargo_id,
                cargo=user.cargo.nombre if user.cargo else None, cmp=user.cmp, rne=user.rne,
                estado=user.estado, role_ids=sorted(link.rol_id for link in user.roles_rel))


def catalog():
    return dict(roles=[dict(id=r.id, codigo=r.codigo, nombre=r.nombre,
                            descripcion=r.descripcion, estado=r.estado,
                            permission_ids=sorted(link.permiso_id for link in r.permisos_rel))
                       for r in repo.roles()],
                permissions=[dict(id=p.id, codigo=p.codigo, nombre=p.nombre, descripcion=p.descripcion,
                                  modulo=p.modulo, estado=p.estado) for p in repo.permissions()],
                 document_types=[dict(id=d.id, nombre=d.nombre, codigo=d.codigo) for d in repo.document_types()],
                positions=[dict(id=c.id, nombre=c.nombre) for c in repo.positions()])


ADMIN_ROLE = 'ADMINISTRADOR_SISTEMA'
ESSENTIAL_ADMIN_PERMISSIONS = {'roles.asignar_permisos', 'configuracion.ver'}


def role_permissions(role_id):
    role = repo.role(role_id)
    if role is None:
        raise InputError('Rol no encontrado.', 404)
    return {'success': True, 'data': {'id': role.id, 'nombre': role.nombre,
                                    'permission_ids': sorted(link.permiso_id for link in role.permisos_rel)}}


def set_role_permissions(role_id, payload):
    def action():
        _fields(payload, ('permission_ids',))
        requested = payload.get('permission_ids')
        if not isinstance(requested, list) or len(requested) != len(set(map(str, requested))):
            raise InputError('Seleccione permisos válidos sin repetir.')
        ids = {_id(value) for value in requested}

        # Todas las escrituras bloquean primero el mismo rol administrativo.
        # Impide que dos cambios concurrentes desactiven su propia autorización.
        admin = repo.role_for_update_by_code(ADMIN_ROLE)
        if admin is None or admin.estado != 'ACTIVO':
            raise InputError('No existe un rol administrador activo.', 409)
        role = admin if role_id == admin.id else repo.role_for_update(role_id)
        if role is None:
            raise InputError('Rol no encontrado.', 404)
        if role.estado != 'ACTIVO':
            raise InputError('Rol inactivo.', 409)

        current = {link.permiso_id for link in role.permisos_rel}
        permissions = {permission.id: permission for permission in repo.permissions_by_ids(ids)}
        if len(permissions) != len(ids):
            raise InputError('Permiso no encontrado.', 404)
        if any(permission.estado != 'ACTIVO' and identifier not in current
               for identifier, permission in permissions.items()):
            raise InputError('Permiso inactivo.', 409)

        essential = {link.permiso.codigo: link.permiso_id for link in admin.permisos_rel
                     if link.permiso.estado == 'ACTIVO' and link.permiso.codigo in ESSENTIAL_ADMIN_PERMISSIONS}
        if set(essential) != ESSENTIAL_ADMIN_PERMISSIONS:
            raise InputError('Falta una autorización administrativa esencial.', 409)
        if role.id == admin.id and not set(essential.values()) <= ids:
            raise InputError('Debe conservar los permisos administrativos esenciales.', 409)
        if role.id != admin.id and any(permission.codigo == 'roles.asignar_permisos'
                                      for permission in permissions.values()):
            raise InputError('Permiso reservado al rol administrador.', 409)

        for link in list(role.permisos_rel):
            if link.permiso_id not in ids:
                role.permisos_rel.remove(link)
                db.session.delete(link)
        for identifier in sorted(ids - current):
            db.session.add(RolPermiso(rol_id=role.id, permiso_id=identifier))
        db.session.flush()
        db.session.expire(role, ['permisos_rel'])
        return role_permissions(role.id)
    return _persist(action, conflict='Conflicto al actualizar los permisos del rol.')


def _persist(operation, *, conflict='Ya existe un usuario con estos datos.'):
    try:
        result = operation()
        db.session.commit()
        return result, 200
    except InputError as exc:
        db.session.rollback()
        return {'success': False, 'message': str(exc)}, exc.status
    except IntegrityError:
        db.session.rollback()
        return {'success': False, 'message': conflict}, 409
    except Exception:
        db.session.rollback()
        raise


def create_user(payload):
    def action():
        values = _user_data(payload, creating=True)
        if not repo.valid_document_and_position(values['tipo_doc_id'], values['cargo_id']):
            raise InputError('Documento o cargo no disponible.', 404)
        _validate_new_document(values)
        roles = _role_ids(payload.get('role_ids'))
        password = payload.get('password')
        if not isinstance(password, str) or not 10 <= len(password.strip()) or len(password) > 128:
            raise InputError('La contraseña debe tener al menos 10 caracteres.')
        user = Usuario(**values, password_hash=generate_password_hash(password), estado='ACTIVO')
        user.roles_rel = [UsuarioRol(rol_id=role_id) for role_id in sorted(roles)]
        db.session.add(user)
        db.session.flush()
        return {'success': True, 'data': user_view(user)}
    result, status = _persist(action)
    return result, 201 if status == 200 else status


def edit_user(user_id, payload):
    def action():
        user = repo.user_for_update(user_id)
        if user is None:
            raise InputError('Usuario no encontrado.', 404)
        values = _user_data(payload)
        document_type = values.get('tipo_doc_id', user.tipo_doc_id)
        position = values.get('cargo_id', user.cargo_id)
        if not repo.valid_document_and_position(document_type, position):
            raise InputError('Documento o cargo no disponible.', 404)
        if (('tipo_doc_id' in values and document_type != user.tipo_doc_id)
                or ('nro_documento' in values and values['nro_documento'] != user.nro_documento)):
            document_values = {'tipo_doc_id': document_type,
                               'nro_documento': values.get('nro_documento', user.nro_documento)}
            _validate_new_document(document_values)
            if 'nro_documento' in values or document_values['nro_documento'] != user.nro_documento:
                values['nro_documento'] = document_values['nro_documento']
        for key, value in values.items():
            setattr(user, key, value)
        db.session.flush()
        return {'success': True, 'data': user_view(user)}
    return _persist(action)


def set_user_state(user_id, payload, actor_id):
    def action():
        _fields(payload, ('estado',))
        if payload.get('estado') not in ('ACTIVO', 'INACTIVO'):
            raise InputError('Estado inválido.')
        user = repo.user_for_update(user_id)
        if user is None:
            raise InputError('Usuario no encontrado.', 404)
        if user.id == actor_id and payload['estado'] != user.estado:
            raise InputError('No puede cambiar su propio acceso.', 409)
        if payload['estado'] == 'ACTIVO' and not any(link.rol.estado == 'ACTIVO' for link in user.roles_rel):
            raise InputError('La cuenta requiere un rol activo.', 409)
        if user.estado == 'ACTIVO' and payload['estado'] == 'INACTIVO':
            admins = repo.active_administrators_for_update()
            if any(admin.id == user.id for admin in admins) and len(admins) <= 1:
                raise InputError('Debe permanecer una cuenta administradora activa.', 409)
        user.estado = payload['estado']
        return {'success': True, 'data': user_view(user)}
    return _persist(action)


def set_user_roles(user_id, payload, actor_id):
    def action():
        _fields(payload, ('role_ids',))
        role_ids = _role_ids(payload.get('role_ids'))
        user = repo.user_for_update(user_id)
        if user is None:
            raise InputError('Usuario no encontrado.', 404)
        current = {link.rol_id for link in user.roles_rel}
        if user.id == actor_id and role_ids != current:
            raise InputError('No puede modificar sus propios roles.', 409)
        admins = repo.active_administrators_for_update()
        admin_roles = {r.id for r in repo.active_roles(role_ids) if r.codigo == 'ADMINISTRADOR_SISTEMA'}
        if (user.estado == 'ACTIVO' and any(admin.id == user.id for admin in admins)
                and not admin_roles and len(admins) <= 1):
            raise InputError('Debe permanecer una cuenta administradora activa.', 409)
        for link in list(user.roles_rel):
            if link.rol_id not in role_ids:
                user.roles_rel.remove(link)
        for role_id in sorted(role_ids - current):
            user.roles_rel.append(UsuarioRol(rol_id=role_id))
        db.session.flush()
        return {'success': True, 'data': user_view(user)}
    return _persist(action)
