from sqlalchemy.orm import joinedload, selectinload
from src.models.auth_entities import Usuario

class AuthRepository:
    @staticmethod
    def get_user_by_username(username: str) -> Usuario:
        return Usuario.query.filter_by(username=username, estado='ACTIVO').first()

    @staticmethod
    def get_active_user_by_id(user_id: int) -> Usuario:
        return Usuario.query.filter_by(id=user_id, estado='ACTIVO').first()

    @staticmethod
    def get_active_user_with_permissions_by_id(user_id: int) -> Usuario:
        from src.models.auth_entities import Rol, RolPermiso, UsuarioRol

        # Cargar las colecciones por lote; unir solo los enlaces N:1.
        # Conserva la procedencia rol -> permiso sin una consulta por permiso.
        grants = (selectinload(Usuario.roles_rel)
                  .joinedload(UsuarioRol.rol)
                  .selectinload(Rol.permisos_rel)
                  .joinedload(RolPermiso.permiso))
        return (Usuario.query.options(grants)
                .filter_by(id=user_id, estado='ACTIVO').first())
