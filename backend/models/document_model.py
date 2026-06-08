from database import use_db

@use_db
def obtener_tipos_documento_activos(cursor):
    query = "SELECT id, nombre, codigo FROM tipos_documento WHERE estado = 'ACTIVO'"
    cursor.execute(query)
    return cursor.fetchall()

@use_db
def obtener_tipo_documento_por_codigo(cursor, codigo):
    cursor.execute("SELECT id FROM tipos_documento WHERE codigo = %s", (codigo,))
    return cursor.fetchone()
