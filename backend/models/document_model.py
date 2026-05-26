from database import obtener_conexion_bd

def obtener_tipos_documento_activos():
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la BD")
    try:
        cursor = c.cursor()
        query = "SELECT id, nombre, codigo FROM tipos_documento WHERE estado = 'ACTIVO'"
        cursor.execute(query)
        return cursor.fetchall()
    finally:
        c.close()