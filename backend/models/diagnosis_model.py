from database import obtener_conexion_bd

def crear_diagnostico(datos_bd):
    c = obtener_conexion_bd()
    if not c:
        raise Exception("Error de conexión a la base de datos.")
        
    try:
        cursor = c.cursor()
        
        # PASO 1: Insert en diagnosticos (solo lo que tiene esta tabla)
        query_diagnostico = """
            INSERT INTO diagnosticos (paciente_id, usuario_id)
            VALUES (%s, %s)
        """
        cursor.execute(query_diagnostico, (
            datos_bd['paciente_id'],
            datos_bd['usuario_id']
        ))
        
        diagnostico_id = cursor.lastrowid
        
        # PASO 2: Insert en diagnosticos_detalle (aquí sí van ojo, imagen, IA)
        query_detalle = """
            INSERT INTO diagnosticos_detalle 
                (diagnostico_id, ojo_evaluado, imagen_url, resultado_ia, probabilidad_ia, estado_validacion)
            VALUES (%s, %s, %s, %s, %s, 'Aprobado')
        """
        cursor.execute(query_detalle, (
            diagnostico_id,
            datos_bd['ojo_evaluado'],
            datos_bd['imagen_url'],
            datos_bd['resultado_ia'],
            datos_bd['probabilidad_ia']
        ))
        
        c.commit()
        return diagnostico_id
        
    except Exception as e:
        # Si algo falla en los INSERTs, revertimos todo para no dejar datos huérfanos
        c.rollback()
        raise Exception(f"Error al guardar el diagnóstico en BD: {str(e)}")
        
    finally:
        c.close()