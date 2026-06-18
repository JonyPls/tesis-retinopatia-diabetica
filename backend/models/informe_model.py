from database import use_db

@use_db
def listar_tipos_informe_activos(cursor):
    cursor.execute(
        "SELECT id, nombre, descripcion FROM tipos_informe WHERE estado = 'ACTIVO' ORDER BY id"
    )
    rows = cursor.fetchall()
    return [{"id": r["id"], "nombre": r["nombre"], "descripcion": r["descripcion"]} for r in rows]

@use_db
def obtener_tipo_informe_por_id(cursor, tipo_id):
    cursor.execute(
        "SELECT id, nombre, descripcion FROM tipos_informe WHERE id = %s AND estado = 'ACTIVO'",
        (tipo_id,),
    )
    return cursor.fetchone()

@use_db
def crear_diagnostico_simple(cursor, paciente_id, usuario_id):
    cursor.execute(
        "INSERT INTO diagnosticos (paciente_id, usuario_id) VALUES (%s, %s)",
        (paciente_id, usuario_id),
    )
    return cursor.lastrowid

@use_db
def crear_informe(cursor, diagnostico_id, tipo_informe_id, datos_estructurados):
    cursor.execute(
        "INSERT INTO informes (diagnostico_id, tipo_informe_id, datos_estructurados) VALUES (%s, %s, %s)",
        (diagnostico_id, tipo_informe_id, datos_estructurados),
    )
    return cursor.lastrowid

@use_db
def obtener_informe_por_id(cursor, informe_id):
    cursor.execute(
        """SELECT i.id, i.diagnostico_id, i.tipo_informe_id, ti.nombre AS tipo_informe_nombre,
                  i.datos_estructurados, i.estado,
                  i.fecha_creado, i.fecha_actualizado
           FROM informes i
           JOIN tipos_informe ti ON ti.id = i.tipo_informe_id
           WHERE i.id = %s AND i.estado = 'ACTIVO'""",
        (informe_id,),
    )
    return cursor.fetchone()

@use_db
def actualizar_informe(cursor, informe_id, datos_estructurados):
    cursor.execute(
        "UPDATE informes SET datos_estructurados = %s WHERE id = %s AND estado = 'ACTIVO'",
        (datos_estructurados, informe_id),
    )
    return cursor.rowcount

@use_db
def eliminar_informe(cursor, informe_id):
    cursor.execute(
        "UPDATE informes SET estado = 'INACTIVO' WHERE id = %s", (informe_id,)
    )
    return cursor.rowcount

@use_db
def listar_informes_por_paciente(cursor, paciente_id):
    cursor.execute(
        """SELECT i.id, i.diagnostico_id, i.tipo_informe_id, ti.nombre AS tipo_informe_nombre,
                  i.datos_estructurados, i.estado,
                  i.fecha_creado, i.fecha_actualizado
           FROM informes i
           JOIN diagnosticos d ON d.id = i.diagnostico_id
           JOIN tipos_informe ti ON ti.id = i.tipo_informe_id
           WHERE d.paciente_id = %s AND i.estado = 'ACTIVO'
           ORDER BY i.fecha_creado DESC""",
        (paciente_id,),
    )
    return cursor.fetchall()

@use_db
def obtener_informes_por_diagnostico(cursor, diagnostico_id):
    cursor.execute(
        """SELECT i.id, i.diagnostico_id, i.tipo_informe_id, ti.nombre AS tipo_informe_nombre,
                  i.datos_estructurados, i.estado,
                  i.fecha_creado, i.fecha_actualizado
           FROM informes i
           JOIN tipos_informe ti ON ti.id = i.tipo_informe_id
           WHERE i.diagnostico_id = %s AND i.estado = 'ACTIVO'
           ORDER BY ti.nombre""",
        (diagnostico_id,),
    )
    return cursor.fetchall()
