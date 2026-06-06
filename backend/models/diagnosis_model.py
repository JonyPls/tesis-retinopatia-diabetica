from database import use_db

@use_db
def crear_diagnostico(cursor, datos_bd):
    query_diagnostico = """
        INSERT INTO diagnosticos (paciente_id, usuario_id)
        VALUES (%s, %s)
    """
    cursor.execute(query_diagnostico, (
        datos_bd['paciente_id'],
        datos_bd['usuario_id']
    ))

    diagnostico_id = cursor.lastrowid

    query_detalle = """
        INSERT INTO diagnosticos_detalle 
            (diagnostico_id, ojo_evaluado, imagen_url, resultado_ia, probabilidad_ia, estado_validacion)
        VALUES (%s, %s, %s, %s, %s, 'Pendiente')
    """
    cursor.execute(query_detalle, (
        diagnostico_id,
        datos_bd['ojo_evaluado'],
        datos_bd['imagen_url'],
        datos_bd['resultado_ia'],
        datos_bd['probabilidad_ia']
    ))

    return diagnostico_id

@use_db
def validar_diagnostico(cursor, diagnostico_id, diagnostico_final, comentario_medico=None):
    cursor.execute("SELECT resultado_ia FROM diagnosticos_detalle WHERE diagnostico_id = %s", (diagnostico_id,))
    detalle = cursor.fetchone()

    if not detalle:
        raise Exception("Diagnóstico no encontrado.")

    resultado_ia = detalle['resultado_ia']

    if int(diagnostico_final) == int(resultado_ia):
        estado_validacion = 'Aprobado'
    else:
        estado_validacion = 'Corregido'

    query_update = """
        UPDATE diagnosticos_detalle 
        SET diagnostico_final = %s, 
            estado_validacion = %s, 
            comentario_medico = %s
        WHERE diagnostico_id = %s
    """
    cursor.execute(query_update, (diagnostico_final, estado_validacion, comentario_medico, diagnostico_id))

    return estado_validacion
