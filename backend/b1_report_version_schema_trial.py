"""Ensayos de esquema 29C.2: solo tras comprobar MySQL 8 temporal por UUID/datadir."""

import json

import pymysql


SCHEMA = 'centro_oftalmologico_db_v2'
TABLE = 'informes_versiones'


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def rows(connection, statement, parameters=None):
    with connection.cursor() as cursor:
        cursor.execute(statement, parameters)
        return cursor.fetchall()


def check_report_version_schema(connection):
    columns = {name: (kind.lower(), nullable) for name, kind, nullable in rows(connection, """
        SELECT column_name, column_type, is_nullable FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
    """, (SCHEMA, TABLE))}
    check(columns == {
        'id': ('bigint unsigned', 'NO'), 'informe_id': ('bigint unsigned', 'NO'),
        'numero_version': ('bigint unsigned', 'NO'),
        'operacion': ("enum('CREACION','MIGRACION_INICIAL','CORRECCION','ANULACION','INACTIVACION')".lower(), 'NO'),
        'schema_version': ('smallint unsigned', 'NO'),
        'datos_estructurados': ('json', 'YES'), 'conclusion': ('text', 'YES'),
        'estado': ("enum('ACTIVO','INACTIVO','ANULADO')".lower(), 'NO'),
        'autor_operacion_id': ('int unsigned', 'YES'),
        'fecha_operacion': ('datetime(6)', 'NO'),
        'fecha_operacion_origen': ('varchar(16)', 'NO'), 'motivo': ('varchar(1000)', 'YES'),
    }, 'Columnas o tipos reales de informes_versiones incorrectos.')
    report_columns = {name: (kind, nullable, default) for name, kind, nullable, default in rows(connection, """
        SELECT column_name, column_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema=%s AND table_name='informes'
          AND column_name IN ('id','visita_id','tipo_informe_id','usuario_id',
                              'schema_version','revision_actual')
    """, (SCHEMA,))}
    check({key: report_columns[key][:2] for key in report_columns} == {
        'id': ('bigint unsigned', 'NO'), 'visita_id': ('bigint unsigned', 'NO'),
        'tipo_informe_id': ('smallint unsigned', 'NO'), 'usuario_id': ('int unsigned', 'NO'),
        'schema_version': ('smallint unsigned', 'NO'),
        'revision_actual': ('bigint unsigned', 'NO')
    } and str(report_columns['revision_actual'][2]) == '1',
        'revision_actual o sus tipos FK no coinciden con el maestro.')
    check(rows(connection, """SELECT engine, table_collation FROM information_schema.tables
        WHERE table_schema=%s AND table_name=%s""", (SCHEMA, TABLE)) ==
          (('InnoDB', 'utf8mb4_0900_ai_ci'),), 'Engine/collation de versiones incorrectos.')
    foreign_keys = set(rows(connection, """
        SELECT rc.constraint_name, k.column_name, k.referenced_table_name,
               k.referenced_column_name, rc.delete_rule, rc.update_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage k
          ON k.constraint_schema=rc.constraint_schema AND k.table_name=rc.table_name
         AND k.constraint_name=rc.constraint_name
        WHERE rc.constraint_schema=%s AND rc.table_name=%s
    """, (SCHEMA, TABLE)))
    check(foreign_keys == {
        ('fk_informes_versiones_informe', 'informe_id', 'informes', 'id', 'RESTRICT', 'RESTRICT'),
        ('fk_informes_versiones_autor', 'autor_operacion_id', 'usuarios', 'id', 'RESTRICT', 'RESTRICT'),
    }, 'FK de versiones no preservan autores e informes.')
    indexes = set(rows(connection, """
        SELECT index_name, column_name, seq_in_index FROM information_schema.statistics
        WHERE table_schema=%s AND table_name=%s
    """, (SCHEMA, TABLE)))
    check(indexes == {
        ('PRIMARY', 'id', 1),
        ('uq_informes_versiones_informe_numero', 'informe_id', 1),
        ('uq_informes_versiones_informe_numero', 'numero_version', 2),
        ('idx_informes_versiones_autor_fecha', 'autor_operacion_id', 1),
        ('idx_informes_versiones_autor_fecha', 'fecha_operacion', 2),
    }, 'Indices de versiones no coinciden con el diseño.')
    checks = set(rows(connection, """SELECT table_name, constraint_name, enforced
        FROM information_schema.table_constraints
        WHERE constraint_schema=%s AND table_name IN ('informes',%s)
          AND constraint_type='CHECK'""", (SCHEMA, TABLE)))
    check(checks == {(table, name, 'YES') for table, names in {
        'informes': ('ck_informes_revision', 'ck_informes_fecha_creado_origen',
                     'ck_informes_fecha_actualizado_origen'),
        TABLE: ('ck_informes_versiones_numero', 'ck_informes_versiones_operacion',
                 'ck_informes_versiones_estado', 'ck_informes_versiones_inicial',
                 'ck_informes_versiones_autor', 'ck_informes_versiones_motivo',
                 'ck_versiones_fecha_operacion_origen'),
    }.items() for name in names}, 'CHECK de informe/versiones no activos.')
    check(rows(connection, """SELECT delete_rule, update_rule FROM
        information_schema.referential_constraints WHERE constraint_schema=%s
        AND table_name='informes' AND constraint_name='fk_informes_visita'""",
        (SCHEMA,)) == (('CASCADE', 'CASCADE'),),
        'La FK de visita se alteró antes de demostrar que es necesario.')
    check(rows(connection, """SELECT COUNT(*) FROM information_schema.statistics
        WHERE table_schema=%s AND table_name='informes'
          AND index_name='uq_informes_visita_tipo'""", (SCHEMA,)) == ((2,),),
        'Se perdió la unicidad visita-tipo.')
    check(rows(connection, "SELECT COUNT(*) FROM informes") == ((0,),) and
          rows(connection, "SELECT COUNT(*) FROM informes_versiones") == ((0,),),
          'El maestro no debe sembrar informes ni versiones.')


def check_report_version_integrity(connection):
    """DML sintético revertido por completo; el DROP del maestro nunca se usa aquí."""
    connection.begin()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""INSERT INTO usuarios
                (username,password_hash,nombres,apellidos,correo,tipo_doc_id,cargo_id,nro_documento)
                VALUES ('version_schema_synthetic','synthetic-only','Prueba','Sintetica',
                        'version-schema@example.invalid',1,2,'99000019')""")
            author = cursor.lastrowid
            cursor.execute("""INSERT INTO usuarios
                (username,password_hash,nombres,apellidos,correo,tipo_doc_id,cargo_id,nro_documento)
                VALUES ('version_editor_synthetic','synthetic-only','Editor','Sintetico',
                        'version-editor@example.invalid',1,2,'99000021')""")
            editor = cursor.lastrowid
            cursor.execute("""INSERT INTO pacientes
                (tipo_doc_id,nro_documento,nombres,apellidos,sexo,fecha_nacimiento)
                VALUES (1,'99000020','Paciente','Sintetico','Masculino','2000-01-01')""")
            patient = cursor.lastrowid
            cursor.execute('INSERT INTO visitas_clinicas (paciente_id,usuario_id) VALUES (%s,%s)',
                           (patient, author))
            visit = cursor.lastrowid
            cursor.execute('INSERT INTO diagnosticos_retinopatia (visita_id,usuario_id) VALUES (%s,%s)',
                           (visit, author))
            diagnosis = cursor.lastrowid
            data = json.dumps({'ojos': ['OD'], 'nota': 'Solo sintético'}, ensure_ascii=False)
            cursor.execute("""INSERT INTO informes
                (visita_id,tipo_informe_id,usuario_id,schema_version,datos_estructurados,conclusion)
                VALUES (%s,2,%s,7,%s,%s)""", (visit, author, data, 'Conclusión sintética'))
            report = cursor.lastrowid
            check(rows(connection, 'SELECT revision_actual,schema_version FROM informes WHERE id=%s',
                       (report,)) == ((1, 7),), 'Revisión inicial y versión de esquema se confundieron.')

            def insert(report_id=report, number=1, operation='CREACION', user=author,
                       reason=None, status='ACTIVO', payload=data):
                cursor.execute("""INSERT INTO informes_versiones
                    (informe_id,numero_version,operacion,schema_version,datos_estructurados,
                     conclusion,estado,autor_operacion_id,motivo)
                    VALUES (%s,%s,%s,7,%s,%s,%s,%s,%s)""",
                    (report_id, number, operation, payload, 'Conclusión sintética',
                     status, user, reason))

            def rejected(label, expected_codes, action):
                before = rows(connection, 'SELECT COUNT(*) FROM informes_versiones')[0][0]
                try:
                    action()
                except pymysql.MySQLError as error:
                    check(error.args[0] in expected_codes, f'{label}: error SQL inesperado.')
                else:
                    raise RuntimeError(f'{label}: MySQL aceptó una fila prohibida.')
                check(rows(connection, 'SELECT COUNT(*) FROM informes_versiones')[0][0] == before,
                      f'{label}: el rechazo dejó una versión persistida.')

            rejected('informe inexistente', {1452}, lambda: insert(report_id=999999999))
            rejected('autor inexistente', {1452}, lambda: insert(user=999999999))
            rejected('autor obligatorio en creación', {3819}, lambda: insert(user=None))
            rejected('revisión cero', {3819}, lambda: insert(number=0))
            rejected('operación inválida', {1265, 3819}, lambda: insert(operation='OTRA'))
            rejected('estado inválido', {1265, 3819}, lambda: insert(status='OTRO'))
            rejected('creación no inicial', {3819}, lambda: insert(number=2))
            for operation in ('CORRECCION', 'ANULACION', 'INACTIVACION'):
                rejected(f'{operation} sin autor', {3819},
                         lambda op=operation: insert(number=2, operation=op, user=None, reason='Motivo'))
                for reason in (None, '', ' \t  '):
                    rejected(f'{operation} sin motivo', {3819},
                             lambda op=operation, motive=reason: insert(number=2,
                                operation=op, reason=motive))
            rejected('revision principal cero', {3819}, lambda: cursor.execute(
                'UPDATE informes SET revision_actual=0 WHERE id=%s', (report,)))

            insert()
            rejected('mismo informe y numero', {1062}, insert)
            insert(number=2, operation='CORRECCION', user=editor,
                   reason='Corrección sintética')
            check(rows(connection, """SELECT numero_version,operacion,JSON_EXTRACT(datos_estructurados,
                '$.nota'),conclusion,schema_version,estado,autor_operacion_id,fecha_operacion IS NOT NULL
                FROM informes_versiones WHERE informe_id=%s ORDER BY numero_version""", (report,)) == (
                    (1, 'CREACION', '"Solo sintético"', 'Conclusión sintética', 7, 'ACTIVO', author, 1),
                    (2, 'CORRECCION', '"Solo sintético"', 'Conclusión sintética', 7, 'ACTIVO', editor, 1),
                ), 'Contenido JSON, conclusión, orden o schema_version no se conservó.')
            rejected('eliminar autor de una versión', {1451}, lambda: cursor.execute(
                'DELETE FROM usuarios WHERE id=%s', (editor,)))
            rejected('cambiar id del autor de una versión', {1451}, lambda: cursor.execute(
                'UPDATE usuarios SET id=%s WHERE id=%s', (editor + 10000, editor)))
            # Informe anterior al corte: no inferir quién editó ni inventar operaciones.
            cursor.execute("""INSERT INTO informes
                (visita_id,tipo_informe_id,usuario_id,estado,datos_estructurados)
                VALUES (%s,3,%s,'INACTIVO',%s)""", (visit, author, data))
            historical = cursor.lastrowid
            check(rows(connection, 'SELECT COUNT(*) FROM informes_versiones WHERE informe_id=%s',
                       (historical,)) == ((0,),), 'El esquema inventó versiones iniciales.')
            cursor.execute("""INSERT INTO informes_versiones
                (informe_id,numero_version,operacion,schema_version,datos_estructurados,
                 estado,autor_operacion_id) SELECT id,revision_actual,'MIGRACION_INICIAL',
                 schema_version,datos_estructurados,estado,NULL FROM informes WHERE id=%s""",
                (historical,))
            check(rows(connection, """SELECT operacion,estado,autor_operacion_id,
                JSON_EXTRACT(datos_estructurados,'$.nota') FROM informes_versiones
                WHERE informe_id=%s""", (historical,)) ==
                  (('MIGRACION_INICIAL', 'INACTIVO', None, '"Solo sintético"'),),
                  'La instantánea de migración atribuyó una operación inexistente.')

            rejected('informe con historial', {1451}, lambda: cursor.execute(
                'DELETE FROM informes WHERE id=%s', (report,)))
            rejected('visita con informe versionado', {1451}, lambda: cursor.execute(
                'DELETE FROM visitas_clinicas WHERE id=%s', (visit,)))
            check(rows(connection, 'SELECT COUNT(*) FROM informes WHERE visita_id=%s',
                       (visit,)) == ((2,),) and
                  rows(connection, 'SELECT COUNT(*) FROM diagnosticos_retinopatia WHERE id=%s',
                       (diagnosis,)) == ((1,),),
                  'La eliminación de visita afectó informes o diagnósticos a pesar del historial.')
            rejected('duplicado visita-tipo', {1062}, lambda: cursor.execute(
                'INSERT INTO informes (visita_id,tipo_informe_id,usuario_id) VALUES (%s,2,%s)',
                (visit, author)))
    finally:
        connection.rollback()
    check(rows(connection, 'SELECT COUNT(*) FROM informes_versiones') == ((0,),),
          'Las pruebas de integridad dejaron historial clínico persistido.')
