"""Authorized second start: SAME initialized datadir, no initialize or application SQL."""
import argparse
import ctypes
from ctypes import wintypes
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

from codn_provision_cb03_instance import ROOT, DATA, SERVER, PORT, protect_secret, require, connection

UUID = 'eee45878-d7ac-11f1-bc4f-107c616721bd'
CONFIG_SHA256 = '6dee5fa065178c2971d8271d9d6a11302306db9f4a6e06deb5ebcfe0078834e6'


def unprotect(blob):
    from codn_provision_cb03_instance import Blob
    buf = ctypes.create_string_buffer(blob)
    source = Blob(len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    require(crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)),
            'No se pudo validar recuperación DPAPI.')
    try:
        return ctypes.string_at(result.pbData, result.cbData).decode('utf-8')
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(result.pbData)


def identity(conn, queries):
    query = ('SELECT @@server_uuid, @@datadir, @@port, @@version, @@hostname, '
             '@@skip_name_resolve, @@bind_address, DATABASE(), CURRENT_USER()')
    with conn.cursor() as cursor:
        cursor.execute(query)
        values = cursor.fetchone()
    result = dict(zip(['server_uuid', 'datadir', 'port', 'version', 'hostname', 'skip_name_resolve',
                      'bind_address', 'selected_database', 'account'], values))
    require(result['server_uuid'] == UUID and Path(result['datadir']).resolve() == DATA.resolve(), 'Identidad UUID/datadir distinta.')
    require(result['port'] == PORT and result['version'] == '8.0.46' and result['bind_address'] == '127.0.0.1',
            'Puerto/versión/bind distintos de los autorizados.')
    require(result['skip_name_resolve'] == 0 and result['selected_database'] is None and result['account'] == 'root@localhost',
            'Resolución/cuenta/esquema inesperados.')
    queries.append({'sql': query, 'result': result})
    return result


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--second-start-authorized', action='store_true')
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--credential-directory', required=True, type=Path)
    args = parser.parse_args()
    require(args.second_start_authorized, 'Falta opt-in del segundo arranque.')
    evidence = args.evidence.resolve()
    require((ROOT.parents[2] / 'docs/tesis/pruebas/evidencias').resolve() in evidence.parents, 'Evidencia fuera de raíz autorizada.')
    private = args.credential_directory.resolve()
    require(ROOT.parents[2] not in private.parents and private.is_dir() and not list(private.iterdir()),
            'Credencial requiere directorio vacío, privado y FUERA del repositorio.')
    ini = ROOT / 'my-cb03.ini'
    require(DATA.is_dir() and (DATA / 'mysql').is_dir() and (DATA / 'ibdata1').is_file(), 'No se conserva datadir inicializado esperado.')
    require(hashlib.sha256(ini.read_bytes()).hexdigest() == CONFIG_SHA256, 'Configuración cambió desde intento registrado.')
    require(re.search(r'^server-uuid=' + UUID + r'\s*$', (DATA / 'auto.cnf').read_text(), re.M), 'UUID local distinto.')
    tag = evidence.name
    logfile, pidfile = ROOT / ('logs/' + tag + '.err'), ROOT / ('logs/' + tag + '.pid')
    require(not logfile.exists() and not pidfile.exists(), 'Logs/PID de este intento ya existen.')
    command = [str(SERVER), f'--defaults-file={ini}', '--skip-name-resolve=OFF', '--no-monitor',
               f'--log-error={logfile}', f'--pid-file={pidfile}']
    network = []
    def guard(event, values):
        if event in ('socket.connect', 'socket.getaddrinfo'):
            address = values[1] if event == 'socket.connect' else values[:2]
            require(tuple(address[:2]) == ('127.0.0.1', PORT), 'Red fuera del único destino autorizado.')
            network.append({'event': event, 'host': '127.0.0.1', 'port': PORT})
        if event == 'open' and isinstance(values[0], (str, bytes)):
            name = Path(values[0].decode() if isinstance(values[0], bytes) else values[0]).name
            require(not name.lower().startswith('.env'), 'Lectura .env prohibida.')
    sys.addaudithook(guard)
    result = dict(started_utc=dt.datetime.now(dt.timezone.utc).isoformat(), state='PREPARING_SECOND_START',
        start_command=command, validation_command=command + ['--validate-config'], initialization_executed=False,
        cb03_status='BLOQUEADO', functional_sql_executed=False, queries=[], network_events=network,
        credential_storage='Windows DPAPI current-user + private ACL, outside repository; not included in evidence')
    server = None
    password = None
    exit_code = 1
    try:
        validation = subprocess.run(command + ['--validate-config'], capture_output=True,
            timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        (evidence / 'compatibilidad-stdout.log').write_bytes(validation.stdout)
        (evidence / 'compatibilidad-stderr.log').write_bytes(validation.stderr)
        result['configuration_validation_exit_code'] = validation.returncode
        require(validation.returncode == 0, 'Parámetros incompatibles; no arrancar.')
        with (ROOT / ('logs/' + tag + '-stdout.log')).open('xb') as stdout, \
             (ROOT / ('logs/' + tag + '-stderr.log')).open('xb') as stderr:
            server = subprocess.Popen(command, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW)
        result['server_pid'] = server.pid
        import pymysql
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            require(server.poll() is None, 'Proceso propio terminó durante arranque.')
            try:
                initial = connection('')
            except pymysql.OperationalError as error:
                code = error.args[0] if error.args and type(error.args[0]) is int else None
                if code not in (2003, 2013):
                    result['initial_connection_error_number'] = code
                    raise
                time.sleep(.25)
                continue
            with initial:
                result['identity_before_credential_change'] = identity(initial, result['queries'])
                require(pidfile.is_file() and int(pidfile.read_text().strip()) == server.pid, 'PID real no coincide: detener.')
                password = secrets.token_urlsafe(48)
                encrypted = protect_secret(password)
                require(unprotect(encrypted) == password, 'Prueba DPAPI falló antes de cambiar credencial.')
                credential_file = private / 'admin-password.dpapi'
                with credential_file.open('xb') as handle:
                    handle.write(encrypted)
                with initial.cursor() as cursor:
                    cursor.execute('ALTER USER CURRENT_USER() IDENTIFIED BY %s', (password,))
                result['administrative_credential_change_count'] = 1
                result['queries'].append({'sql': 'ALTER USER CURRENT_USER() IDENTIFIED BY <bound secret, never logged>', 'result': 'completed'})
            break
        else:
            raise RuntimeError('Se agotó el plazo de conexión inicial.')
        # Reconnect using the encrypted store, NOT the original in-memory password.
        with connection(unprotect(credential_file.read_bytes())) as secured:
            result['identity'] = identity(secured, result['queries'])
            with secured.cursor() as cursor:
                for query in [
                    'SHOW DATABASES',
                    "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')",
                    'SELECT @@general_log, @@slow_query_log, @@log_bin, @@local_infile, @@secure_file_priv, @@session.time_zone',
                    "SELECT PLUGIN_NAME, PLUGIN_STATUS FROM information_schema.PLUGINS WHERE PLUGIN_NAME = 'mysqlx'",
                ]:
                    cursor.execute(query)
                    rows = [list(row) for row in cursor.fetchall()]
                    result['queries'].append({'sql': query, 'result': rows})
                    if query == 'SHOW DATABASES':
                        require({row[0] for row in rows} == {'mysql', 'information_schema', 'performance_schema', 'sys'}, 'Esquemas no esperados.')
                        result['databases'] = [row[0] for row in rows]
                    elif 'TABLE_SCHEMA, TABLE_NAME' in query:
                        require(not rows, 'Hay tablas funcionales; detener.')
                        result['functional_tables_count'] = 0
                    elif '@@general_log' in query:
                        require(rows == [[0, 0, 0, 0, None, '+00:00']], 'Ajustes de logging/seguridad/UTC inesperados.')
                    else:
                        require(not any(row[1] == 'ACTIVE' for row in rows), 'MySQL X no debe estar activo.')
            result['secured_login_from_dpapi'] = True
        try:
            blank = connection('')
        except pymysql.OperationalError as error:
            require(error.args[0] == 1045, 'No se confirmó rechazo de credencial vacía.')
            result['empty_password_rejected_error'] = 1045
        else:
            blank.close()
            raise RuntimeError('Acceso sin contraseña todavía permitido.')
        require(server.poll() is None, 'Servidor propio terminó después de validación.')
        marker = dict(purpose='CODN_CB03_DISPOSABLE', server_uuid=UUID, port=PORT, server_pid=server.pid,
            datadir=str(DATA), verified_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
            initialization_authorized=True, functional_schema_authorized=False, fixture_writes_authorized=False)
        require(not (ROOT / 'codn-cb03-instance.json').exists(), 'Acta ya existente: no sobrescribir.')
        (ROOT / 'codn-cb03-instance.json').write_text(json.dumps(marker, indent=2), encoding='utf-8')
        result.update(state='RUNNING_AUTHENTICATED_VERIFIED', connections_to_habitual=0, credentials_in_repository=False)
        # Credential LOCATION only: kept under runtime ignored root, not published evidence.
        (ROOT / 'private/credential-location.json').write_text(json.dumps({'dpapi_file': str(credential_file)}), encoding='utf-8')
        exit_code = 0
    except Exception as error:
        result.update(state='STOPPED_ON_ERROR', exception_type=type(error).__name__)
        if getattr(error, 'args', None) and type(error.args[0]) is int:
            result['client_error_number'] = error.args[0]
        elif type(error) is RuntimeError:
            result['reason'] = str(error)
        if server is not None and server.poll() is None:
            server.terminate()
            server.wait(timeout=15)
    finally:
        result.update(ended_utc=dt.datetime.now(dt.timezone.utc).isoformat(), exit_code=exit_code,
                      network_events=network, config_sha256=hashlib.sha256(ini.read_bytes()).hexdigest())
        target = evidence / 'segundo-arranque.json'
        serialized = json.dumps(result, ensure_ascii=False, indent=2)
        require(password is None or password not in serialized, 'Guardia de confidencialidad del resultado.')
        target.write_text(serialized, encoding='utf-8')
        if password:
            for path in evidence.iterdir():
                if path.is_file():
                    require(password.encode() not in path.read_bytes(), 'Secreto detectado en evidencia: no publicar.')
        print(json.dumps({k: result[k] for k in ['state', 'exit_code', 'cb03_status']} |
            {'identity': result.get('identity'), 'server_pid': result.get('server_pid'),
             'client_error_number': result.get('client_error_number'), 'reason': result.get('reason')}, ensure_ascii=False), flush=True)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
