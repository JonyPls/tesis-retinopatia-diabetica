from database import use_db

@use_db
def obtener_usuario_por_username(cursor, username):
    query = """
        SELECT 
            u.id, u.username, u.password_hash, u.nombres, u.apellidos, u.correo,
            u.tipo_doc, u.nro_documento, u.cmp, u.rne, u.estado,
            GROUP_CONCAT(r.nombre) AS roles 
        FROM usuarios u
        LEFT JOIN usuario_rol ur ON u.id = ur.usuario_id
        LEFT JOIN roles r ON ur.rol_id = r.id AND r.estado = 'ACTIVO'
        WHERE u.username = %s AND u.estado = 'ACTIVO'
        GROUP BY u.id
    """
    cursor.execute(query, (username,))
    user = cursor.fetchone()
    
    if user and user['roles']:
        user['roles'] = user['roles'].split(',')
    elif user:
        user['roles'] = []
        
    return user
