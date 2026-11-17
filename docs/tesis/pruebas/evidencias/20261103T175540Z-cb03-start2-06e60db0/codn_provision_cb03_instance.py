"""Initialize/start ONLY the exact CB-03 instance authorized on 2026-11-03.

No application imports, functional schemas, fixtures or installed services.
The PowerShell wrapper verifies the port, prepares private ACLs and logs evidence.
"""
import argparse
import ctypes
from ctypes import wintypes
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(r'D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql')
DATA = ROOT / 'data'
SERVER = Path(r'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe')
PORT = 33363
HABITUAL_UUID = '1b48ef4a-4e14-11f1-acd7-107c616721bd'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def protect_secret(secret):
    """Windows DPAPI, current user only, UI forbidden; never returns plain text."""
    raw = secret.encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    protected = Blob()
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt32.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    require(crypt32.CryptProtectData(ctypes.byref(source), 'CODN CB03 isolated administrator', None,
                                   None, None, 1, ctypes.byref(protected)), 'DPAPI no pudo proteger la credencial.')
    try:
        return ctypes.string_at(protected.pbData, protected.cbData)
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(protected.pbData)


def connection(password):
    import pymysql
    return pymysql.connect(host='127.0.0.1', port=PORT, user='root', password=password,
        charset='utf8mb4', autocommit=True, connect_timeout=2, read_timeout=10, write_timeout=10)


def verified_identity(conn, uuid):
    with conn.cursor() as cursor:
        cursor.execute('SELECT @@version, @@port, @@datadir, @@server_uuid, @@bind_address, DATABASE(), CURRENT_USER()')
        version, port, datadir, remote_uuid, bind, database, account = cursor.fetchone()
    require(str(version).startswith('8.0.') and port == PORT and bind == '127.0.0.1', 'Versión/puerto/bind no autorizados.')
    require(Path(datadir).resolve() == DATA.resolve() and remote_uuid == uuid and uuid != HABITUAL_UUID,
            'Conflicto de identidad; detener sin SQL funcional.')
    require(database is None and account == 'root@localhost', 'Esquema o identidad administrativa no esperados.')
    return dict(version=version, host='127.0.0.1', port=port, datadir=str(DATA.resolve()),
                server_uuid=remote_uuid, bind_address=bind, selected_database=database, administrative_account=account)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--initialize-authorized-instance', action='store_true')
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    require(args.initialize_authorized_instance, 'Opt-in explícito requerido.')
    evidence = args.evidence.resolve()
    expected_evidence = ROOT.parents[2] / 'docs' / 'tesis' / 'pruebas' / 'evidencias'
    require(expected_evidence.resolve() in evidence.parents, 'Evidencia fuera del repositorio autorizado.')
    require(ROOT.is_dir() and not DATA.exists(), 'Wrapper no preparó raíz vacía propia, o datadir ya existe.')
    require((ROOT / 'private').is_dir() and (ROOT / 'logs').is_dir() and (ROOT / 'work').is_dir(), 'Faltan carpetas privadas propias.')
    require(not (ROOT / 'my-cb03.ini').exists(), 'Configuración preexistente: no sobrescribir.')
    # A fresh bind probe also rejects a race after the PowerShell listener inventory.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', PORT))
    version = subprocess.run([str(SERVER), '--no-defaults', '--version'], capture_output=True,
                             text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
    require(version.returncode == 0 and 'Ver 8.0.' in version.stdout, 'Binario MySQL no compatible.')
    result = dict(started_utc=dt.datetime.now(dt.timezone.utc).isoformat(), state='INITIALIZING',
        authorized_datadir=str(DATA), port=PORT, binary=str(SERVER), binary_version=version.stdout.strip(),
        cb03_status='BLOQUEADO', functional_schema_created=False, fixtures_inserted=False,
        credentials='DPAPI current-user encrypted file under private ACL; no secret logged')
    server = None
    network = []
    # Restrict all driver connections/resolutions; no other endpoint can be contacted.
    def audit(event, values):
        if event in ('socket.connect', 'socket.getaddrinfo'):
            address = values[1] if event == 'socket.connect' else values[:2]
            require(tuple(address[:2]) == ('127.0.0.1', PORT), 'Intento de conexión fuera del destino autorizado.')
            network.append({'event': event, 'host': '127.0.0.1', 'port': PORT})
        if event == 'open' and isinstance(values[0], (str, bytes)):
            name = Path(values[0].decode() if isinstance(values[0], bytes) else values[0]).name
            require(not name.lower().startswith('.env'), 'Lectura de .env no autorizada.')
    sys.addaudithook(audit)
    try:
        config = '\n'.join([
            '[mysqld]', f'basedir="{SERVER.parent.parent.as_posix()}"', f'datadir="{DATA.as_posix()}"',
            f'port={PORT}', 'bind-address=127.0.0.1', 'mysqlx=OFF', 'skip-log-bin', 'skip-name-resolve',
            'general_log=OFF', 'slow_query_log=OFF', 'local_infile=OFF', 'secure_file_priv=NULL',
            'named_pipe=OFF', 'shared_memory=OFF', 'default-time-zone=+00:00', 'log_timestamps=UTC',
            'max_connections=15', 'innodb_buffer_pool_size=67108864',
            f'log-error="{(ROOT / "logs/server.err").as_posix()}"',
            f'pid-file="{(ROOT / "logs/server.pid").as_posix()}"', f'tmpdir="{(ROOT / "work").as_posix()}"', ''])
        ini = ROOT / 'my-cb03.ini'
        with ini.open('x', encoding='utf-8', newline='\n') as handle:
            handle.write(config)
        init_command = [str(SERVER), '--no-defaults', f'--basedir={SERVER.parent.parent}',
            f'--datadir={DATA}', '--initialize-insecure', f'--log-error={ROOT / "logs/init.err"}']
        start_command = [str(SERVER), f'--defaults-file={ini}']
        result.update(init_command=init_command, start_command=start_command)
        initialized = subprocess.run(init_command, capture_output=True, timeout=120, creationflags=subprocess.CREATE_NO_WINDOW)
        (ROOT / 'logs/init-stdout.log').write_bytes(initialized.stdout)
        (ROOT / 'logs/init-stderr.log').write_bytes(initialized.stderr)
        result['initialization_exit_code'] = initialized.returncode
        require(initialized.returncode == 0, 'Inicialización falló; conservar datadir/logs y detener.')
        auto = (DATA / 'auto.cnf').read_text(encoding='utf-8-sig')
        uuid = re.search(r'^server-uuid\s*=\s*([0-9a-f-]{36})\s*$', auto, re.M | re.I)
        require(uuid and uuid.group(1) != HABITUAL_UUID, 'auto.cnf no acredita UUID propio.')
        uuid = uuid.group(1)
        with (ROOT / 'logs/start-stdout.log').open('xb') as stdout, (ROOT / 'logs/start-stderr.log').open('xb') as stderr:
            server = subprocess.Popen(start_command, stdout=stdout, stderr=stderr,
                                      creationflags=subprocess.CREATE_NO_WINDOW)
        result['server_pid'] = server.pid
        deadline = time.monotonic() + 45
        import pymysql
        while time.monotonic() < deadline:
            require(server.poll() is None, 'Proceso MySQL nuevo terminó antes de estar disponible.')
            try:
                candidate = connection('')
            except pymysql.OperationalError as error:
                require(error.args[0] in (2003, 2013), 'Error de arranque no transitorio; detener.')
                time.sleep(.25)
                continue
            with candidate:
                first_identity = verified_identity(candidate, uuid)
                require(int((ROOT / 'logs/server.pid').read_text().strip()) == server.pid, 'PID-file no coincide con proceso propio.')
                # Generate no reusable public password; protect it BEFORE altering the account.
                password = secrets.token_urlsafe(48)
                with (ROOT / 'private/admin-password.dpapi').open('xb') as handle:
                    handle.write(protect_secret(password))
                with candidate.cursor() as cursor:
                    cursor.execute('ALTER USER CURRENT_USER() IDENTIFIED BY %s', (password,))
                result['administrative_password_configured'] = True
            break
        else:
            raise RuntimeError('No se pudo arrancar MySQL nuevo dentro del plazo.')
        with connection(password) as secured:
            result['identity'] = verified_identity(secured, uuid)
            with secured.cursor() as cursor:
                cursor.execute('SHOW DATABASES')
                databases = sorted(row[0] for row in cursor.fetchall())
                require(set(databases) == {'information_schema', 'mysql', 'performance_schema', 'sys'}, 'Esquemas ajenos inesperados en instancia nueva.')
                cursor.execute("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')")
                result['functional_tables_count'] = cursor.fetchone()[0]
                cursor.execute("SELECT PLUGIN_NAME, PLUGIN_STATUS FROM information_schema.PLUGINS WHERE PLUGIN_NAME = 'mysqlx'")
                result['mysqlx_plugin'] = [list(row) for row in cursor.fetchall()]
                cursor.execute("SELECT @@general_log, @@slow_query_log, @@log_bin, @@local_infile, @@secure_file_priv, @@session.time_zone")
                settings = cursor.fetchone()
                require(settings[:4] == (0, 0, 0, 0) and settings[4] is None and settings[5] == '+00:00', 'Configuración local no coincide.')
                result['settings'] = dict(general_log=False, slow_query_log=False, log_bin=False,
                    local_infile=False, secure_file_priv=None, session_time_zone='+00:00')
            result['databases'] = databases
        try:
            accidental = connection('')
        except pymysql.OperationalError as error:
            require(error.args[0] == 1045, 'No se pudo verificar rechazo de contraseña vacía.')
            result['empty_password_rejected'] = True
        else:
            accidental.close()
            raise RuntimeError('Credencial administrativa inicial no quedó protegida.')
        del password
        require(server.poll() is None and result['functional_tables_count'] == 0, 'Estado final no esperado.')
        marker = dict(purpose='CODN_CB03_DISPOSABLE', server_uuid=uuid, port=PORT, server_pid=server.pid,
            datadir=str(DATA), initialization_authorized=True, functional_schema_authorized=False,
            fixture_writes_authorized=False, verified_utc=dt.datetime.now(dt.timezone.utc).isoformat())
        (ROOT / 'codn-cb03-instance.json').write_text(json.dumps(marker, indent=2), encoding='utf-8')
        result['state'] = 'RUNNING_VERIFIED'
        result['network_events'] = network
        result['connections_to_habitual'] = 0
        result['config_sha256'] = hashlib.sha256(ini.read_bytes()).hexdigest()
        print(json.dumps({'state': result['state'], 'server_pid': server.pid, 'identity': result['identity'],
                          'functional_tables_count': 0, 'cb03_status': 'BLOQUEADO'}, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        result.update(state='STOPPED_ON_ERROR', exception_type=type(error).__name__)
        # Never print DBAPI exceptions or account SQL (might contain credentials).
        if type(error) is RuntimeError:
            result['reason'] = str(error)
        if server is not None and server.poll() is None:
            server.terminate()  # Only this newly created process handle; no existing service.
            server.wait(timeout=15)
        print(json.dumps({'state': result['state'], 'exception_type': type(error).__name__,
                          'reason': result.get('reason', 'Ver logs privados de preparación; no reintentar automáticamente.')}, ensure_ascii=False), flush=True)
        return 1
    finally:
        result['ended_utc'] = dt.datetime.now(dt.timezone.utc).isoformat()
        result['network_events'] = network
        (evidence / 'inicializacion-arranque.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
