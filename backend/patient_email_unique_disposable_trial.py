"""Ensayo opt-in del índice pendiente, SOLO en un servidor MySQL nuevo y desechable."""
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time

import pymysql

from b1_mysql_disposable_trial import (
    ADMIN, APPROVED_TEMP, BACKEND, HABITUAL_UUID, SERVER, SCHEMA,
    client_script, connect, ensure_own_server, free_loopback_port, require,
)


def run(connection, port):
    migration = BACKEND / 'migrations' / 'pacientes_correo_unico_pendiente.sql'
    statement = migration.read_text(encoding='utf-8').split('ALTER TABLE pacientes', 1)[1].strip().rstrip(';')
    statement = 'ALTER TABLE pacientes ' + statement
    suffix = secrets.token_hex(5)
    email = f'prueba-{suffix}@example.com'

    def add(document, mail=None, phone='900000000', doc_type=1):
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO pacientes
                (tipo_doc_id, nro_documento, nombres, apellidos, sexo,
                 fecha_nacimiento, consentimiento_informado, correo, telefono)
                VALUES (%s, %s, 'Paciente', 'Sintetico', 'Femenino', '2000-01-01', 1, %s, %s)''',
                           (doc_type, document, mail, phone))
            return cursor.lastrowid

    with connection.cursor() as cursor:
        cursor.execute("""SELECT COUNT(*) FROM (
            SELECT NULLIF(LOWER(TRIM(correo)), '') AS email_key
            FROM pacientes GROUP BY email_key
            HAVING email_key IS NOT NULL AND COUNT(*) > 1
        ) AS duplicate_groups""")
        require(cursor.fetchone()[0] == 0, 'El seed desechable contiene correos duplicados; ensayo cancelado.')

    first = add(f'7{suffix[:7]}', ' ' + email.upper() + ' ')
    second = add(f'8{suffix[:7]}', email)
    with connection.cursor() as cursor:
        try:
            cursor.execute(statement)
        except pymysql.IntegrityError as error:
            require(error.args[0] == 1062, 'La migración falló por un motivo distinto a duplicidad.')
        else:
            raise RuntimeError('La migración aceptó correos históricos duplicados.')
        cursor.execute('SELECT COUNT(*) FROM pacientes WHERE id IN (%s, %s)', (first, second))
        require(cursor.fetchone()[0] == 2, 'La migración modificó registros históricos.')
        cursor.execute('DELETE FROM pacientes WHERE id IN (%s, %s)', (first, second))
        cursor.execute(statement)
        cursor.execute("""SELECT COUNT(*) FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'pacientes'
              AND index_name = 'uq_pacientes_correo_normalizado' AND non_unique = 0""")
        require(cursor.fetchone()[0] == 1, 'No se creó el índice esperado.')

    add(f'7{suffix[:7]}', ' ' + email.upper() + ' ')
    try:
        add(f'8{suffix[:7]}', email)
    except pymysql.IntegrityError as error:
        require(error.args[0] == 1062, 'El correo duplicado falló por otro motivo.')
    else:
        raise RuntimeError('El índice admitió un correo repetido con distinto caso/espacios.')
    add(f'8{suffix[:7]}', None)
    add(f'9{suffix[:7]}', None)  # NULL opcional y teléfono compartido
    add(f'6{suffix[:7]}', '')  # correo vacío opcional
    add(f'5{suffix[:7]}', '')
    add(f'4{suffix[:7]}', doc_type=2)  # documento idéntico de distinto tipo
    add(f'4{suffix[:7]}')
    add('000' + suffix[:6], doc_type=3)  # ceros iniciales conservados
    add(suffix[:6], doc_type=3)
    try:
        add(f'4{suffix[:7]}')
    except pymysql.IntegrityError as error:
        require(error.args[0] == 1062, 'El documento duplicado falló por otro motivo.')
    else:
        raise RuntimeError('La clave documental dejó de ser única.')

    # Probar además el servicio real y las consultas ORM, sin usar la BD habitual.
    from flask import Flask
    from sqlalchemy.engine import URL
    from database import configure_utc_sessions, db
    from services.patient_service import registrar_nuevo_paciente
    from src.repositories.patient_repository import PatientRepository

    app = Flask('patient_email_disposable_trial')
    app.config.update(SQLALCHEMY_DATABASE_URI=URL.create(
        'mysql+pymysql', username='root', password='', host='127.0.0.1',
        port=port, database=SCHEMA), SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    configure_utc_sessions(app)
    with app.app_context():
        document = f'{secrets.randbelow(90000000) + 10000000:08d}'
        while PatientRepository.obtener_paciente_por_documento(1, document):
            document = f'{secrets.randbelow(90000000) + 10000000:08d}'
        payload = dict(tipo_doc='DNI', nro_documento=document, nombres='Prueba',
                       apellidos='Sintetica', sexo='Femenino', fecha_nacimiento='2000-01-01',
                       consentimiento_informado=True, telefono='900000000',
                       correo=f'nuevo-{suffix}@example.com')
        try:
            created, status = registrar_nuevo_paciente(
                payload, create_scope='administrative', read_scope=None)
            require(status == 201, 'El servicio no registró el paciente ficticio en MySQL desechable.')
            duplicate, status = registrar_nuevo_paciente(
                {**payload, 'nro_documento': document[:-1] + str((int(document[-1]) + 1) % 10),
                 'correo': '  ' + payload['correo'].upper() + '  '},
                create_scope='administrative', read_scope=None)
            require(status == 409 and 'correo' in duplicate.get('errors', {}),
                    'El servicio no detectó el correo duplicado.')
            require(PatientRepository.obtener_paciente_por_correo(payload['correo']) == created['data']['id'],
                    'La consulta ORM de correo normalizado no devolvió el alta esperada.')
            duplicate, status = registrar_nuevo_paciente(
                {**payload, 'correo': None}, create_scope='administrative', read_scope=None)
            require(status == 409 and 'nro_documento' in duplicate.get('errors', {}),
                    'El servicio no detectó el documento duplicado.')
            other_type, status = registrar_nuevo_paciente(
                {**payload, 'tipo_doc': 'CE', 'correo': None},
                create_scope='administrative', read_scope=None)
            require(status == 201 and other_type['data']['id'] != created['data']['id'],
                    'Tipo de documento diferente bloqueado indebidamente.')
        finally:
            db.session.remove()
    print('MySQL desechable: índice funcional, duplicados, nulos, teléfonos y clave documental OK.')


def main():
    require(APPROVED_TEMP.is_dir() and SERVER.is_file() and ADMIN.is_file(),
            'No está disponible el entorno desechable autorizado.')
    port = free_loopback_port()
    root = Path(tempfile.mkdtemp(prefix='patient-email-disposable-', dir=APPROVED_TEMP))
    data = root / 'data'
    server = None
    try:
        initialized = subprocess.run([
            str(SERVER), '--no-defaults', f'--basedir={SERVER.parent.parent}',
            f'--datadir={data}', '--initialize-insecure', f'--log-error={root / "init.err"}',
        ], capture_output=True, timeout=120)
        require(initialized.returncode == 0, 'No se pudo inicializar MySQL desechable.')
        server = subprocess.Popen([
            str(SERVER), '--no-defaults', f'--basedir={SERVER.parent.parent}',
            f'--datadir={data}', f'--port={port}', '--bind-address=127.0.0.1',
            '--skip-log-bin', f'--log-error={root / "server.err"}',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            require(server.poll() is None, 'MySQL temporal se cerró al arrancar.')
            try:
                with connect(port) as connection:
                    uuid = ensure_own_server(connection, data, port)
                break
            except pymysql.OperationalError:
                time.sleep(0.25)
        else:
            raise RuntimeError('MySQL temporal no aceptó conexiones.')
        require(uuid != HABITUAL_UUID, 'La instancia habitual está fuera del ensayo.')
        client_script(port, '', BACKEND / 'db' / 'centro-oftalmologico-db-v2.sql')
        with connect(port, database=SCHEMA) as connection:
            require(ensure_own_server(connection, data, port) == uuid, 'Servidor temporal distinto.')
            run(connection, port)
    finally:
        if server is not None and server.poll() is None:
            subprocess.run([str(ADMIN), '--no-defaults', '--protocol=tcp',
                            '--host=127.0.0.1', f'--port={port}', '--user=root', 'shutdown'],
                           capture_output=True, timeout=15)
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.terminate()  # Solo PID propio.
                server.wait(timeout=10)
        if server is None or server.poll() is not None:
            shutil.rmtree(root)  # Solo el directorio temporal creado aquí.


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No imprimir SQL, datos ni credenciales en fallos de MySQL.
        print(f'Ensayo detenido: {type(error).__name__}' +
              (f' (código {error.args[0]})' if isinstance(error, pymysql.MySQLError) else ''))
        raise SystemExit(1)
