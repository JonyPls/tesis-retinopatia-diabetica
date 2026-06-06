from functools import wraps
from flask import request, jsonify
import jwt
import os

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # 1. Buscamos el token en los encabezados (Headers) de la petición HTTP
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(" ")[1]
        
        # 2. Fallback: token como query parameter (para <img> tags)
        if not token:
            token = request.args.get('token')

        # 3. Si no hay token, bloqueamos el acceso inmediatamente
        if not token:
            return jsonify({
                "status": "error", 
                "message": "Falta el token de autorización. Acceso denegado."
            }), 401

        # 4. Validamos que el token sea auténtico y no haya expirado
        try:
            data = jwt.decode(token, os.getenv('SECRET_KEY'), algorithms=["HS256"])
            request.current_user = data
            
        except jwt.ExpiredSignatureError:
            return jsonify({
                "status": "error", 
                "message": "El token ha expirado. Por favor, inicie sesión nuevamente."
            }), 401
        except jwt.InvalidTokenError:
            return jsonify({
                "status": "error", 
                "message": "Token inválido o corrupto."
            }), 401

        # 5. Si todo está perfecto, dejamos que la petición continúe hacia la ruta original
        return f(*args, **kwargs)
        
    return decorated