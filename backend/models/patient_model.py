from database import use_db

@use_db
def obtener_pacientes(cursor):
    query = """
        SELECT
            p.id,
            td.codigo AS tipo_doc_abrev,
            p.nro_documento, 
            p.nombres,
            p.apellidos,
            p.sexo,
            p.fecha_nacimiento,
            p.telefono,
            MAX(d.fecha_registro) AS ultima_visita,
            MAX(dd.diagnostico_final) AS maxima_gravedad
        FROM pacientes p
        JOIN tipos_documento td ON p.tipo_doc = td.id
        LEFT JOIN diagnosticos d ON p.id = d.paciente_id 
        LEFT JOIN diagnosticos_detalle dd ON d.id = dd.diagnostico_id
        WHERE p.estado = 'ACTIVO'
        GROUP BY p.id, td.codigo
        ORDER BY p.id DESC
    """
    cursor.execute(query)
    return cursor.fetchall()

@use_db
def obtener_paciente_por_nrodocumento(cursor, nro_documento):
    cursor.execute("SELECT id FROM pacientes WHERE nro_documento = %s", (nro_documento,))
    return cursor.fetchone()

@use_db
def insertar_paciente(cursor, tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono):
    sql = """
        INSERT INTO pacientes (tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono) 
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """
    cursor.execute(sql, (tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono))

@use_db
def obtener_paciente_por_id(cursor, paciente_id):
    sql = """
        SELECT 
            p.id, 
            td.codigo AS tipo_doc_abrev,
            p.tipo_doc,
            p.nro_documento, 
            p.nombres, 
            p.apellidos, 
            p.sexo, 
            p.fecha_nacimiento, 
            p.telefono 
        FROM pacientes p
        LEFT JOIN tipos_documento td ON p.tipo_doc = td.id
        WHERE p.id = %s
    """
    cursor.execute(sql, (paciente_id,))
    return cursor.fetchone()

@use_db
def obtener_diagnosticos_paciente(cursor, paciente_id):
    sql = """
        SELECT
            d.id AS diagnostico_id,
            d.fecha_registro AS fecha_visita,
            CONCAT(u.nombres, ' ', u.apellidos) AS medico_tratante,
            CASE WHEN COUNT(DISTINCT dd.id) > 0 THEN 1 ELSE 0 END AS tiene_diagnostico_ia,
            CASE WHEN COUNT(DISTINCT i.id) > 0 THEN 1 ELSE 0 END AS tiene_informes
        FROM diagnosticos d
        JOIN usuarios u ON d.usuario_id = u.id
        LEFT JOIN diagnosticos_detalle dd ON dd.diagnostico_id = d.id
        LEFT JOIN informes i ON i.diagnostico_id = d.id AND i.estado = 'ACTIVO'
        WHERE d.paciente_id = %s
        GROUP BY d.id, d.fecha_registro, u.nombres, u.apellidos
        ORDER BY d.fecha_registro DESC
    """
    cursor.execute(sql, (paciente_id,))
    return cursor.fetchall()

@use_db
def buscar_paciente(cursor, query_text):
    search_pattern = f"%{query_text}%"
    sql = """
        SELECT p.id, td.codigo AS tipo_doc_abrev, p.tipo_doc, p.nro_documento, p.nombres, p.apellidos 
        FROM pacientes p
        LEFT JOIN tipos_documento td ON p.tipo_doc = td.id
        WHERE p.estado = 'ACTIVO' AND (
            p.nro_documento LIKE %s 
            OR CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE %s 
            OR CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE %s
        )
        LIMIT 5
    """
    cursor.execute(sql, (search_pattern, search_pattern, search_pattern))
    return cursor.fetchall()

@use_db
def obtener_pacientes_recientes(cursor, limit=6):
    sql = """
        SELECT
            p.id,
            td.codigo AS tipo_doc_abrev,
            p.nro_documento,
            p.nombres,
            p.apellidos
        FROM pacientes p
        JOIN tipos_documento td ON p.tipo_doc = td.id
        JOIN diagnosticos d ON p.id = d.paciente_id
        WHERE p.estado = 'ACTIVO'
        GROUP BY p.id, td.codigo
        ORDER BY MAX(d.fecha_registro) DESC
        LIMIT %s
    """
    cursor.execute(sql, (limit,))
    return cursor.fetchall()
