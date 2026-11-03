"""Fase B preparada, NO ejecutada en 77. Nunca acepta un destino SQL externo."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

from .safety import (SafetyError, authorize, clean_environment, copy_sources, inside,
                      no_links, require)
from .resources import OwnedTrial
from .process_identity import StartupIdentity


def listener_pid(port):
    """Tabla TCP del SO: acreditar PID ANTES de la primera conexión SQL."""
    from ctypes import wintypes

    class Row(ctypes.Structure):
        _fields_ = [(name, wintypes.DWORD) for name in
                    ('state', 'address', 'port', 'remote_address', 'remote_port', 'pid')]

    size = wintypes.ULONG(0)
    api = ctypes.WinDLL('iphlpapi', use_last_error=True).GetExtendedTcpTable
    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.ULONG), wintypes.BOOL,
                    wintypes.ULONG, ctypes.c_int, wintypes.ULONG]
    api.restype = wintypes.DWORD
    require(api(None, ctypes.byref(size), False, 2, 3, 0) in (0, 122), 'TABLA_TCP_NO_DISPONIBLE')
    buffer = ctypes.create_string_buffer(size.value)
    require(api(buffer, ctypes.byref(size), False, 2, 3, 0) == 0, 'TABLA_TCP_NO_DISPONIBLE')
    count = wintypes.DWORD.from_buffer(buffer).value
    result = []
    for index in range(count):
        row = Row.from_buffer(buffer, 4 + index * ctypes.sizeof(Row))
        if row.state == 2 and socket.ntohs(row.port & 0xffff) == port:
            require(socket.inet_ntoa(int(row.address).to_bytes(4, 'little')) == '127.0.0.1',
                    'LISTENER_NO_LOOPBACK')
            result.append(row.pid)
    require(len(result) <= 1, 'LISTENER_AMBIGUO')
    return result[0] if result else None


def private_acl(root, environment):
    system = Path(os.environ['SystemRoot']) / 'System32'
    result = subprocess.run([str(system / 'whoami.exe'), '/user', '/fo', 'csv', '/nh'],
                            capture_output=True, text=True, env=environment, check=False)
    import re
    identifiers = re.findall(r'S-1-5-(?:[0-9]+-)*[0-9]+', result.stdout)
    require(result.returncode == 0 and len(identifiers) == 1, 'SID_NO_VERIFICABLE')
    result = subprocess.run([str(system / 'icacls.exe'), str(root), '/inheritance:r',
                             '/grant:r', '*' + identifiers[0] + ':(OI)(CI)F'],
                            capture_output=True, env=environment, check=False)
    require(result.returncode == 0, 'ACL_PRIVADA_NO_APLICADA')


def execute(source, plan, confirmation):
    # Primera instrucción: no importar pymysql/arneses B1 antes de autorizar.
    authorize(source, plan, confirmation)
    resources = OwnedTrial(plan.root, plan.run_id, retirement_authorized=True)
    root = resources.root
    connection = None
    diagnostic = None
    process = None
    stage = 'PREPARATION'
    failure = None
    evidence_written = False
    try:
        environment = clean_environment(root)
        private_acl(root, environment)
        for name in ('tmp', 'data', 'exports', 'private', 'evidence'):
            inside(root / name, root).mkdir()
        sandbox = copy_sources(source, root, plan.sources_sha256)
        # Reutilización localizada: NO main/run_trial/client_script/master/ORM de B1.
        from b1_mysql_disposable_trial import free_loopback_port, ensure_own_server
        port = free_loopback_port()
        require(port != 3306, 'PUERTO_RESERVADO')
        datadir, pidfile = root / 'data', root / 'mysql.pid'
        diagnostic = StartupIdentity(resources, plan.mysql_server, datadir, pidfile, port, listener_pid)
        base = [str(plan.mysql_server), '--no-defaults', f'--basedir={plan.mysql_server.parents[1]}',
                f'--datadir={datadir}']
        require(hashlib.sha256(plan.mysql_server.read_bytes()).hexdigest() == plan.mysql_sha256,
                'BINARIO_CAMBIO')
        stage = 'INITIALIZE'
        initialized = resources.run([*base, '--initialize-insecure', f'--log-error={root / "init.log"}'],
                                    cwd=root, env=environment, timeout=120, role='INITIALIZER')
        require(initialized.returncode == 0, 'INICIALIZACION_FALLO')
        initialized_event = diagnostic.observe(resources.latest_process('INITIALIZER'), 'INITIALIZE')
        initialized_event['reason'] = 'INITIALIZED'
        diagnostic.record(initialized_event)
        resources.owned()
        password, app_password = secrets.token_hex(32), secrets.token_hex(32)
        bootstrap = inside(root / 'bootstrap.sql', root)
        with bootstrap.open('x', encoding='ascii') as stream:
            stream.write("ALTER USER 'root'@'localhost' IDENTIFIED BY '" + password + "';\n")
        stage = 'MYSQL_SPAWN'
        # MySQL Windows 8.0.46: evitar monitor/hijo, NO adoptar descendientes.
        process = resources.spawn([*base, '--no-monitor', '--console', '--bind-address=127.0.0.1', f'--port={port}',
            '--mysqlx=OFF', '--skip-log-bin', '--skip-name-resolve', '--named-pipe=OFF',
            '--shared-memory=OFF', '--persisted-globals-load=OFF', f'--init-file={bootstrap}',
            '--local-infile=OFF', '--secure-file-priv=NULL', '--transaction-isolation=REPEATABLE-READ',
            '--innodb-lock-wait-timeout=8', f'--pid-file={pidfile}', f'--tmpdir={root / "tmp"}',
            f'--log-error={root / "mysql.log"}'], cwd=root, env=environment,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, role='MYSQL')

        stage = 'STARTUP_WAIT'
        diagnostic.wait_ready(process)  # Mismo límite 60 s / 50 ms; sin reintentos de lanzamiento.
        stage = 'PRE_SQL'
        diagnostic.check(process, stage)
        import pymysql
        stage = 'SQL_PROVISION'
        connection = pymysql.connect(host='127.0.0.1', port=port, user='root', password=password,
                                     autocommit=True, connect_timeout=2, read_timeout=10,
                                     write_timeout=10, local_infile=False)
        server_uuid = ensure_own_server(connection, datadir, port)
        with connection.cursor() as cursor:
            cursor.execute('SELECT @@version, @@pid_file')
            version, actual_pidfile = cursor.fetchone()
            parts = version.split('-')[0].split('.')
            require(tuple(map(int, parts[:3])) >= (8, 0, 16), 'CHECK_NO_ACREDITADO')
            require(no_links(Path(actual_pidfile)) == pidfile, 'PIDFILE_NO_COINCIDE')
            diagnostic.sql_identity_verified = True
            diagnostic.check(process, 'SQL_IDENTITY_VERIFIED')
            cursor.execute(f'CREATE DATABASE `{plan.schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
            cursor.execute("CREATE USER 'codn77_app'@'127.0.0.1' IDENTIFIED BY %s", (app_password,))
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{plan.schema}`.* TO 'codn77_app'@'127.0.0.1'")
        connection.close()
        connection = None
        stage = 'POST_PROVISION'
        diagnostic.check(process, stage)
        require(bootstrap.stat().st_nlink == 1, 'BOOTSTRAP_NO_EXCLUSIVO')
        inside(bootstrap, root).unlink()
        payload = {'root': str(root), 'run_id': plan.run_id, 'schema': plan.schema,
                   'port': port, 'pid': process.pid, 'server_uuid': server_uuid,
                   'owner': resources.owner,
                   'admin_password': password, 'app_password': app_password,
                   'sources_sha256': plan.sources_sha256, 'jwt_key': secrets.token_hex(32)}
        # Secretos solo por pipe anónimo, nunca argv, archivo, URL impresa o env.
        worker = sandbox / 'discard_mysql77/worker.py'
        stage = 'WORKER'
        result = resources.run([sys.executable, '-I', '-B', str(worker)],
                                input=json.dumps(payload), text=True, cwd=sandbox,
                                env=environment, timeout=900, role='WORKER')
        stage = 'POST_WORKER'
        diagnostic.check(process, stage)
        # No imprimir stdout/stderr/tracebacks SQL del hijo.
        require(result.returncode == 0, 'ENSAYO_FALLO_VER_EVIDENCIA_SANEADA')
        summary = {'phase': 'B', 'status': 'PASSED_SYNTHETIC_ONLY',
                   'run_id': plan.run_id, 'schema': plan.schema, 'pid': process.pid,
                   'port': port, 'server_uuid': server_uuid, 'resources': 'RETIRED_EVIDENCE_ONLY'}
    except SafetyError as error:
        failure = error
    except Exception:
        failure = SafetyError('ENSAYO_INTERRUMPIDO_SIN_REINTENTOS')
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass  # La parada del job cierra también las conexiones del proceso.
        if diagnostic is not None:
            try:
                if failure is not None:
                    observed = process or resources.latest_process('MYSQL' if stage != 'INITIALIZE' else 'INITIALIZER')
                    reason = ('INITIALIZE_FAILED' if stage == 'INITIALIZE' else
                              'SPAWN_FAILED' if stage == 'MYSQL_SPAWN' else 'SQL_OR_WORKER_FAILURE')
                    diagnostic.failure(observed, stage, reason)
                diagnostic.write()  # Antes de terminar procesos/borrar PID/datadir.
                evidence_written = True
            except Exception:
                pass  # No sustituir el fallo original por errores de diagnóstico.
        try:
            retirement = resources.retire()
        except Exception:
            retirement = {'status': 'INCOMPLETE', 'pending': ['private_tree_requires_review']}
        print(json.dumps({'phase': 'B_RETIREMENT', 'run_id': plan.run_id, 'root': str(root),
                          'startup_evidence_written': evidence_written, **retirement}))
    if failure is not None:
        raise failure from None
    require(retirement['status'] == 'COMPLETED', 'RETIRADA_INCOMPLETA_NO_DECLARAR_EXITO')
    require(evidence_written, 'EVIDENCIA_ARRANQUE_NO_CONSERVADA')
    print(json.dumps(summary))
    return 0
