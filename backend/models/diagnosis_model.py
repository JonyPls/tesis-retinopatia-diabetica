from database import use_db

@use_db
def crear_diagnostico(cursor, datos_bd, diagnostico_id=None):
    if diagnostico_id is None:
        cursor.execute(
            "INSERT INTO diagnosticos (paciente_id, usuario_id) VALUES (%s, %s)",
            (datos_bd['paciente_id'], datos_bd['usuario_id'])
        )
        diagnostico_id = cursor.lastrowid

    cursor.execute("""
        INSERT INTO diagnosticos_detalle 
            (diagnostico_id, ojo_evaluado, imagen_url, resultado_ia, probabilidad_ia, resultado_completo, estado_validacion)
        VALUES (%s, %s, %s, %s, %s, %s, 'Pendiente')
        ON DUPLICATE KEY UPDATE
            id = LAST_INSERT_ID(id),
            imagen_url = VALUES(imagen_url),
            resultado_ia = VALUES(resultado_ia),
            probabilidad_ia = VALUES(probabilidad_ia),
            resultado_completo = VALUES(resultado_completo),
            estado_validacion = 'Pendiente',
            diagnostico_final = NULL,
            comentario_medico = NULL
    """, (
        diagnostico_id,
        datos_bd['ojo_evaluado'],
        datos_bd['imagen_url'],
        datos_bd['resultado_ia'],
        datos_bd['probabilidad_ia'],
        datos_bd.get('resultado_completo')
    ))

    detalle_id = cursor.lastrowid
    return diagnostico_id, detalle_id


@use_db
def obtener_detalles_por_diagnostico(cursor, diagnostico_id):
    cursor.execute("""
        SELECT id, ojo_evaluado, resultado_ia, probabilidad_ia,
               resultado_completo, diagnostico_final, estado_validacion,
               comentario_medico, imagen_url
        FROM diagnosticos_detalle
        WHERE diagnostico_id = %s
    """, (diagnostico_id,))
    return cursor.fetchall()


@use_db
def validar_detalle_diagnostico(cursor, detalle_id, diagnostico_final, comentario_medico=None):
    cursor.execute("SELECT resultado_ia FROM diagnosticos_detalle WHERE id = %s", (detalle_id,))
    detalle = cursor.fetchone()

    if not detalle:
        raise Exception("Detalle de diagnóstico no encontrado.")

    resultado_ia = detalle['resultado_ia']

    if int(diagnostico_final) == int(resultado_ia):
        estado_validacion = 'Aprobado'
    else:
        estado_validacion = 'Corregido'

    cursor.execute("""
        UPDATE diagnosticos_detalle 
        SET diagnostico_final = %s, 
            estado_validacion = %s, 
            comentario_medico = %s
        WHERE id = %s
    """, (diagnostico_final, estado_validacion, comentario_medico, detalle_id))

    return estado_validacion
