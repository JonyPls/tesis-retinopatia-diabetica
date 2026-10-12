"""Pruebas de estructura B1 28C.2: solo invocadas por MySQL temporal verificado."""

from datetime import datetime, timedelta

import pymysql


TABLE = 'confirmaciones_exportacion_retinografo'
SCHEMA = 'centro_oftalmologico_db_v2'


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def query(connection, sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()


def check_confirmation_schema(connection):
    expected = {
        'id': ('bigint unsigned', 'NO'),
        'token_verificador': ('binary(32)', 'NO'),
        'paciente_id': ('int unsigned', 'NO'),
        'confirmado_por': ('int unsigned', 'NO'),
        'ojo_confirmado': ("enum('Derecho','Izquierdo')", 'NO'),
        'nombre_exportacion': ('varchar(255)', 'NO'),
        'sha256_fuente': ('char(64)', 'NO'),
        'clave_copia': ('char(32)', 'NO'),
        'fecha_confirmacion': ('datetime(6)', 'NO'),
        'fecha_expiracion': ('datetime(6)', 'NO'),
        'estado': ("enum('CONFIRMADA','CONSUMIDA','REVOCADA')", 'NO'),
        'detalle_id': ('bigint unsigned', 'YES'),
        'fecha_consumo': ('datetime(6)', 'YES'),
        'revocada_por': ('int unsigned', 'YES'),
        'fecha_revocacion': ('datetime(6)', 'YES'),
    }
    actual = {name: (kind, nullable) for name, kind, nullable in query(connection, """
        SELECT column_name, column_type, is_nullable FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
    """, (SCHEMA, TABLE))}
    check(actual == expected, 'Tipos o nulabilidad de confirmaciones no coinciden con el SQL aprobado.')
    check(query(connection, """
        SELECT engine FROM information_schema.tables WHERE table_schema=%s AND table_name=%s
    """, (SCHEMA, TABLE)) == (('InnoDB',),), 'La tabla no es InnoDB.')
    foreign_keys = set(query(connection, """
        SELECT rc.constraint_name, k.column_name, k.referenced_table_name,
               k.referenced_column_name, rc.delete_rule, rc.update_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage k
          ON k.constraint_schema=rc.constraint_schema AND k.table_name=rc.table_name
         AND k.constraint_name=rc.constraint_name
        WHERE rc.constraint_schema=%s AND rc.table_name=%s
    """, (SCHEMA, TABLE)))
    check(foreign_keys == {
        ('fk_confirmacion_paciente', 'paciente_id', 'pacientes', 'id', 'RESTRICT', 'CASCADE'),
        ('fk_confirmacion_profesional', 'confirmado_por', 'usuarios', 'id', 'RESTRICT', 'CASCADE'),
        ('fk_confirmacion_revocador', 'revocada_por', 'usuarios', 'id', 'RESTRICT', 'RESTRICT'),
        ('fk_confirmacion_detalle', 'detalle_id', 'diagnosticos_retinopatia_detalle', 'id', 'RESTRICT', 'RESTRICT'),
    }, 'FK de confirmaciones incompletas o destructivas.')
    indexes = set(query(connection, """
        SELECT DISTINCT index_name FROM information_schema.statistics
        WHERE table_schema=%s AND table_name=%s
    """, (SCHEMA, TABLE)))
    check(indexes == {(name,) for name in (
        'PRIMARY', 'uq_confirmacion_token', 'uq_confirmacion_copia',
        'uq_confirmacion_detalle', 'idx_confirmacion_paciente_estado',
        'idx_confirmacion_profesional_fecha', 'idx_confirmacion_revocador',
    )}, 'Índices de confirmación incompletos.')
    checks = set(query(connection, """
        SELECT constraint_name, enforced FROM information_schema.table_constraints
        WHERE table_schema=%s AND table_name=%s AND constraint_type='CHECK'
    """, (SCHEMA, TABLE)))
    check(checks == {(name, 'YES') for name in (
        'ck_confirmacion_sha256', 'ck_confirmacion_copia', 'ck_confirmacion_vigencia',
        'ck_confirmacion_estado', 'ck_confirmacion_fechas',
    )}, 'Faltan CHECK realmente activos.')


def check_confirmation_integrity(connection):
    """Cada operación se revierte; pacientes, usuarios y detalles son sintéticos."""
    now = datetime(2030, 1, 2, 12, 0, 0, 123456)
    counter = 0
    connection.begin()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""INSERT INTO usuarios
                (username,password_hash,nombres,apellidos,correo,tipo_doc_id,cargo_id,nro_documento)
                VALUES ('b1_schema_synthetic','not-a-password','Prueba','Sintetica',
                        'schema@example.invalid',1,2,'99000001')""")
            user_id = cursor.lastrowid
            cursor.execute("""INSERT INTO pacientes
                (tipo_doc_id,nro_documento,nombres,apellidos,sexo,fecha_nacimiento)
                VALUES (1,'99000002','Paciente','Sintetico','Masculino','2000-01-01')""")
            patient_id = cursor.lastrowid
            cursor.execute("INSERT INTO visitas_clinicas (paciente_id,usuario_id) VALUES (%s,%s)",
                           (patient_id, user_id))
            visit_id = cursor.lastrowid
            cursor.execute("INSERT INTO diagnosticos_retinopatia (visita_id,usuario_id) VALUES (%s,%s)",
                           (visit_id, user_id))
            diagnosis_id = cursor.lastrowid
            details = []
            for eye in ('Derecho', 'Izquierdo'):
                cursor.execute("""INSERT INTO diagnosticos_retinopatia_detalle
                    (diagnostico_retinopatia_id,ojo_evaluado,imagen_original_url)
                    VALUES (%s,%s,'synthetic-only.jpg')""", (diagnosis_id, eye))
                details.append(cursor.lastrowid)

            def insert(**changes):
                nonlocal counter
                counter += 1
                values = dict(token_verificador=counter.to_bytes(32, 'big'),
                              paciente_id=patient_id, confirmado_por=user_id,
                              ojo_confirmado='Derecho', nombre_exportacion='synthetic_R_1.jpg',
                              sha256_fuente='a' * 64, clave_copia=f'{counter:032x}',
                              fecha_confirmacion=now, fecha_expiracion=now + timedelta(minutes=60),
                              estado='CONFIRMADA', detalle_id=None, fecha_consumo=None,
                              revocada_por=None, fecha_revocacion=None)
                values.update(changes)
                cursor.execute(f"INSERT INTO `{TABLE}` ({', '.join(values)}) "
                               f"VALUES ({', '.join(['%s'] * len(values))})", tuple(values.values()))
                return cursor.lastrowid

            def rejects(label, operation):
                try:
                    operation()
                except (pymysql.IntegrityError, pymysql.DataError):
                    return
                except pymysql.OperationalError as error:
                    if error.args[0] == 3819:  # CHECK violado, clasificado asi por PyMySQL.
                        return
                    raise
                raise RuntimeError(f'La restricción SQL no rechazó {label}.')

            confirmed = insert()
            consumed = insert(estado='CONSUMIDA', detalle_id=details[0], fecha_consumo=now)
            revoked = insert(estado='REVOCADA', revocada_por=user_id, fecha_revocacion=now)
            check(query(connection, f'SELECT estado, detalle_id FROM `{TABLE}` ORDER BY id') == (
                ('CONFIRMADA', None), ('CONSUMIDA', details[0]), ('REVOCADA', None)),
                'No se almacenaron los tres estados válidos.')
            rejects('paciente inexistente', lambda: insert(paciente_id=4294967294))
            rejects('confirmador inexistente', lambda: insert(confirmado_por=4294967294))
            rejects('revocador inexistente', lambda: insert(
                estado='REVOCADA', revocada_por=4294967294, fecha_revocacion=now))
            rejects('detalle inexistente', lambda: insert(
                estado='CONSUMIDA', detalle_id=9223372036854775807, fecha_consumo=now))
            rejects('token repetido', lambda: insert(token_verificador=(1).to_bytes(32, 'big')))
            rejects('copia repetida', lambda: insert(clave_copia=f'{1:032x}'))
            rejects('hash no hexadecimal', lambda: insert(sha256_fuente='Z' * 64))
            rejects('hash de longitud incorrecta', lambda: insert(sha256_fuente='a' * 63))
            rejects('clave de copia no segura', lambda: insert(clave_copia='/' * 32))
            rejects('estado inválido', lambda: insert(estado='INVENTADA'))
            rejects('CONFIRMADA consumida', lambda: insert(detalle_id=details[1], fecha_consumo=now))
            rejects('CONSUMIDA sin detalle', lambda: insert(estado='CONSUMIDA', fecha_consumo=now))
            rejects('CONSUMIDA sin fecha', lambda: insert(estado='CONSUMIDA', detalle_id=details[1]))
            rejects('CONSUMIDA revocada', lambda: insert(
                estado='CONSUMIDA', detalle_id=details[1], fecha_consumo=now,
                revocada_por=user_id, fecha_revocacion=now))
            rejects('REVOCADA sin revocador', lambda: insert(estado='REVOCADA', fecha_revocacion=now))
            rejects('REVOCADA sin fecha', lambda: insert(estado='REVOCADA', revocada_por=user_id))
            rejects('vigencia menor a 60 minutos', lambda: insert(
                fecha_expiracion=now + timedelta(minutes=59)))
            rejects('vigencia mayor a 60 minutos', lambda: insert(
                fecha_expiracion=now + timedelta(minutes=61)))
            rejects('consumo anterior a confirmación', lambda: insert(
                estado='CONSUMIDA', detalle_id=details[1], fecha_consumo=now - timedelta(seconds=1)))
            rejects('revocación anterior a confirmación', lambda: insert(
                estado='REVOCADA', revocada_por=user_id, fecha_revocacion=now - timedelta(seconds=1)))
            rejects('detalle asociado dos veces', lambda: insert(
                estado='CONSUMIDA', detalle_id=details[0], fecha_consumo=now))
            rejects('borrado de detalle consumido', lambda: cursor.execute(
                'DELETE FROM diagnosticos_retinopatia_detalle WHERE id=%s', (details[0],)))
            rejects('borrado en cascada de diagnóstico', lambda: cursor.execute(
                'DELETE FROM diagnosticos_retinopatia WHERE id=%s', (diagnosis_id,)))
            rejects('borrado en cascada de visita', lambda: cursor.execute(
                'DELETE FROM visitas_clinicas WHERE id=%s', (visit_id,)))
            rejects('borrado de paciente', lambda: cursor.execute(
                'DELETE FROM pacientes WHERE id=%s', (patient_id,)))
            rejects('borrado de confirmador/revocador', lambda: cursor.execute(
                'DELETE FROM usuarios WHERE id=%s', (user_id,)))
            check(query(connection, f'SELECT COUNT(*) FROM `{TABLE}`')[0][0] == 3,
                  'Un rechazo alteró las confirmaciones válidas.')
            left = insert(ojo_confirmado='Izquierdo', nombre_exportacion='synthetic_L_1.jpg')
            cursor.execute(f"""UPDATE `{TABLE}` SET estado='CONSUMIDA', detalle_id=%s,
                            fecha_consumo=%s WHERE id=%s""", (details[1], now, left))
            cursor.execute(f"""UPDATE `{TABLE}` SET estado='REVOCADA', revocada_por=%s,
                            fecha_revocacion=%s WHERE id=%s""", (user_id, now, confirmed))
            check(query(connection, f'SELECT ojo_confirmado, detalle_id FROM `{TABLE}` WHERE id=%s',
                        (left,)) == (('Izquierdo', details[1]),),
                  'El ojo izquierdo no conserva su detalle independiente.')
            check(query(connection, f'SELECT estado, revocada_por FROM `{TABLE}` WHERE id=%s',
                        (confirmed,)) == (('REVOCADA', user_id),),
                  'La revocación no conserva autor y estado.')
    finally:
        connection.rollback()
    check(query(connection, f'SELECT COUNT(*) FROM `{TABLE}`')[0][0] == 0,
          'El rollback no retiró las confirmaciones sintéticas.')
    print('CONFIRMACIONES SQL: estados, vigencia, unicidad, FK y borrados restringidos verificados.')
