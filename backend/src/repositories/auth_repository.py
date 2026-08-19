from src.models.auth_entities import Usuario

class AuthRepository:
    @staticmethod
    def get_user_by_username(username: str) -> Usuario:
        return Usuario.query.filter_by(username=username, estado='ACTIVO').first()
