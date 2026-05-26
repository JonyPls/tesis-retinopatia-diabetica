from database import obtener_conexion_bd

def obtener_pacientes():
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la BD")
    try:
        cursor = c.cursor()
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
    finally:
        c.close()

def obtener_paciente_por_nrodocumento(nro_documento):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la BD")
    try:
        cursor = c.cursor()
        cursor.execute("SELECT id FROM pacientes WHERE nro_documento = %s", (nro_documento,))
        return cursor.fetchone()
    finally:
        c.close()

def insertar_paciente(tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la BD")
    try:
        cursor = c.cursor()
        sql = """
            INSERT INTO pacientes (tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono) 
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(sql, (tipo_doc, nro_documento, nombres, apellidos, sexo, fecha_nacimiento, telefono))
        c.commit()
    except Exception as e:
        c.rollback()
        raise e
    finally:
        c.close()

def obtener_paciente_por_id(paciente_id):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de BD")
    try:
        cursor = c.cursor()
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
    finally:
        c.close()

def obtener_diagnosticos_paciente(paciente_id):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de BD")
    try:
        cursor = c.cursor()
        sql = """
            SELECT 
                d.id AS diagnostico_id, 
                d.fecha_registro AS fecha_visita, 
                CONCAT(u.nombres, ' ', u.apellidos) AS medico_tratante,
                dd.ojo_evaluado, 
                dd.resultado_ia, 
                dd.probabilidad_ia,
                dd.diagnostico_final, 
                dd.estado_validacion,
                dd.comentario_medico
            FROM diagnosticos d
            JOIN usuarios u ON d.usuario_id = u.id
            LEFT JOIN diagnosticos_detalle dd ON d.id = dd.diagnostico_id
            WHERE d.paciente_id = %s
            ORDER BY d.fecha_registro DESC, dd.ojo_evaluado ASC
        """
        cursor.execute(sql, (paciente_id,))
        return cursor.fetchall()
    finally:
        c.close()

def buscar_paciente(query_text):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de base de datos")
    try:
        cursor = c.cursor()
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
    finally:
        c.close()

def obtener_pacientes_recientes(limit=6):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la BD")
    try:
        cursor = c.cursor()
        sql = """
            SELECT DISTINCT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.nro_documento,
                p.nombres,
                p.apellidos
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc = td.id
            JOIN diagnosticos d ON p.id = d.paciente_id
            WHERE p.estado = 'ACTIVO'
            ORDER BY d.fecha_registro DESC
            LIMIT %s
        """
        cursor.execute(sql, (limit,))
        return cursor.fetchall()
    finally:
        c.close()