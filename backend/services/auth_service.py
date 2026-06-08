import os
import jwt
import datetime
from werkzeug.security import check_password_hash
from models.auth_model import obtener_usuario_por_username

def autenticar_usuario(username, password):
    if not username or not password:
        return {"success": False, "message": "Faltan credenciales."}, 400

    try:
        user = obtener_usuario_por_username(username)
        
        if user and check_password_hash(user['password_hash'], password):
            expiration = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
            
            # Generar Token JWT (Válido por 24 horas)
            token = jwt.encode({
                'user_id': user['id'],
                'username': user['username'],
                'roles': user['roles'],
                'exp': expiration
            }, os.getenv('SECRET_KEY'), algorithm="HS256")

            return {
                "success": True,
                "message": f"Bienvenido, {user['nombres']} {user['apellidos']}",
                "data": {
                    "token": token,
                    "user": {
                        "id": user['id'],
                        "username": user['username'],
                        "nombres": user['nombres'],
                        "apellidos": user['apellidos'],
                        "roles": user['roles']
                    }
                }
            }, 200

        return {"success": False, "message": "Usuario o contraseña incorrectos."}, 401
    
    except Exception as e:
        return {"success": False, "message": str(e)}, 500