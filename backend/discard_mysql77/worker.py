"""Hijo B aislado. Sin credenciales en argv; importar este módulo no hace nada."""
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import time


def run(payload):
    started = time.monotonic()
    from discard_mysql77.process_identity import check_worker_pid
    from discard_mysql77.safety import (APPROVED_TEMP, inside, require, source_digest,
                                       proposal_statements)
    from discard_mysql77.runtime import listener_pid
    from uuid import UUID
    require(str(UUID(payload['run_id'])) == payload['run_id'], 'RUN_ID_NO_CANONICO')
    root = inside(Path(payload['root']), APPROVED_TEMP)
    require(root == APPROVED_TEMP / ('codn77-' + payload['run_id']), 'RAIZ_NO_PROPIA')
    marker = inside(root / 'owner.json', root)
    require(marker.stat().st_nlink == 1 and json.loads(marker.read_text(encoding='utf-8')) ==
            {'run_id': payload['run_id'], 'owner': payload['owner']}, 'MARCADOR_NO_PROPIO')
    check_worker_pid(root / 'mysql.pid', root, payload['pid'], started)
    backend = inside(root / 'backend', root)
    require(Path.cwd() == backend and source_digest(backend) == payload['sources_sha256'],
            'COPIA_CAMBIO_O_CWD_AJENO')
    require(payload['schema'] == 'codn77_' + payload['run_id'].replace('-', ''), 'ESQUEMA_NO_PROPIO')
    require(listener_pid(payload['port']) == payload['pid'], 'PEER_NO_PROPIO')
    import pymysql
    import socket
    from unittest.mock import patch
    from sqlalchemy import create_engine, event
    from sqlalchemy.engine import URL
    from sqlalchemy.schema import CreateTable, CreateIndex
    original = pymysql.connect
    original_socket_connect = socket.socket.connect
    def network_guard(sock, address):
        require(address == ('127.0.0.1', payload['port']), 'CONEXION_FUERA_DEL_ENSAYO')
        return original_socket_connect(sock, address)
    def guarded_connect(*args, **kwargs):
        require(not args and kwargs.get('host') == '127.0.0.1' and
                kwargs.get('port') == payload['port'] and
                kwargs.get('user') in ('root', 'codn77_app') and
                (kwargs.get('database') or kwargs.get('db')) == payload['schema'] and
                not any(kwargs.get(key) for key in ('read_default_file', 'read_default_group',
                        'unix_socket', 'local_infile')) and
                listener_pid(payload['port']) == payload['pid'], 'CONEXION_NO_PERMITIDA')
        connection = original(**kwargs)
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT @@server_uuid, @@datadir, @@port')
                uuid, datadir, port = cursor.fetchone()
                require(uuid == payload['server_uuid'] and port == payload['port'] and
                        Path(datadir).resolve() == inside(root / 'data', root), 'IDENTIDAD_SQL_CAMBIO')
        except Exception:
            connection.close()
            raise
        return connection
    with ExitStack() as stack:
        stack.enter_context(patch.object(socket.socket, 'connect', network_guard))
        stack.enter_context(patch.object(pymysql, 'connect', guarded_connect))
        # SQLAlchemy usa pymysql.connect; negar también el alias DBAPI.
        stack.enter_context(patch.object(pymysql, 'Connect', guarded_connect))
        from discard_mysql77.application import load_application, synthetic_metadata
        h = load_application(payload, stack)
        admin = create_engine(URL.create('mysql+pymysql', username='root',
            password=payload['admin_password'], host='127.0.0.1', port=payload['port'],
            database=payload['schema']), isolation_level='REPEATABLE READ', hide_parameters=True,
            connect_args={'connect_timeout': 3, 'read_timeout': 15, 'write_timeout': 15})
        stack.callback(admin.dispose)
        h.admin = admin
        h.trace = []
        from discard_mysql77.schema import checked_sequence, verify_inventory
        with h.app.app_context():
            engine = h.db.engine
        stack.callback(engine.dispose)
        event.listen(engine, 'before_cursor_execute', h.gate.guard_sql)
        event.listen(admin, 'before_cursor_execute', h.gate.guard_sql)
        @event.listens_for(engine, 'handle_error')
        def record_db_error(context):
            code = getattr(context.original_exception, 'args', (None,))[0]
            h.trace.append({'event': 'db_error', 'code': code if isinstance(code, int) else None})
        @event.listens_for(engine, 'checkout')
        def settings(connection, _record, _proxy):
            with connection.cursor() as cursor:
                cursor.execute('SET SESSION innodb_lock_wait_timeout=8')
                cursor.execute('SELECT @@transaction_isolation, @@time_zone, CONNECTION_ID()')
                isolation, zone, identifier = cursor.fetchone()
                require(isolation == 'REPEATABLE-READ' and zone == '+00:00', 'SESION_NO_RR_UTC')
                h.trace.append({'event': 'checkout', 'connection': identifier})
        metadata = synthetic_metadata(h)
        if payload.get('action') == 'cleanup':
            verify_inventory(h, metadata, full=True)
            for name in ('DIAGNOSIS_DISCARD_ENABLED', 'DIAGNOSIS_DISCARD_SCHEMA_VERIFIED',
                         'DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY'):
                h.app.config[name] = True
            from services.diagnosis_discard_service import clean_operation
            with h.app.app_context():
                result, status = clean_operation(payload['operation_id'])
                require(status == 200 and result['data']['limpieza'] == 'COMPLETADA',
                        'LIMPIEZA_REINICIO_NO_COMPLETADA')
            return
        from discard_mysql77.cases import run_disabled, run_enabled
        results = []
        def install_base():
            ddl = []
            with admin.begin() as connection:
                for table in metadata.sorted_tables:
                    statement = CreateTable(table)
                    ddl.append(str(statement.compile(dialect=admin.dialect)))
                    connection.execute(statement)
                    for index in table.indexes:
                        connection.execute(CreateIndex(index))
            (root / 'evidence/synthetic-schema.sql').write_text(';\n'.join(ddl), encoding='utf-8')

        def validate(full):
            verify_inventory(h, metadata, full=full)
            with admin.connect() as connection:
                tables = sorted(metadata.tables)
                if full:
                    tables += ['diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones']
                actual = [connection.exec_driver_sql(f'SHOW CREATE TABLE `{table}`').first()[1] for table in tables]
                (root / 'evidence' / ('actual-schema.sql' if full else 'base-schema.sql')).write_text(
                    ';\n'.join(actual), encoding='utf-8')

        def install_extension():
            with admin.begin() as connection:
                for statement in proposal_statements(backend):
                    connection.exec_driver_sql(statement)

        def enabled_cases():
            for name in ('DIAGNOSIS_DISCARD_ENABLED', 'DIAGNOSIS_DISCARD_SCHEMA_VERIFIED',
                         'DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY'):
                h.app.config[name] = True
            run_enabled(h, results)
        try:
            checked_sequence(h.gate, install_base, lambda: validate(False),
                lambda: run_disabled(h, results), install_extension, lambda: validate(True), enabled_cases)
        finally:
            (root / 'evidence/results.json').write_text(json.dumps({'cases': results, 'trace': h.trace,
                'limits': ['synthetic PK/FK type overlay; not habitual DDL',
                           'no per-eye UNIQUE invented', 'no terminal-negative fence',
                           'browser not tested', 'activation not authorized']}), encoding='utf-8')


def main():
    # -I excluye cwd: añadir únicamente la copia explícita que contiene este archivo.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    payload = {}
    try:
        payload = json.load(sys.stdin)
        run(payload)
        return 0
    except Exception as error:
        # No imprimir excepción/SQL/config/tracebacks con contraseñas o JWT.
        try:
            from discard_mysql77.safety import APPROVED_TEMP, inside, require
            from uuid import UUID
            require(str(UUID(payload['run_id'])) == payload['run_id'], 'UUID')
            root = inside(Path(payload['root']), APPROVED_TEMP)
            require(root == APPROVED_TEMP / ('codn77-' + payload['run_id']), 'ROOT')
            marker = inside(root / 'owner.json', root)
            require(json.loads(marker.read_text(encoding='utf-8')) ==
                    {'run_id': payload['run_id'], 'owner': payload['owner']}, 'OWNER')
            code = getattr(getattr(error, 'orig', None), 'args', (None,))[0]
            failure = {
                'error_class': type(error).__name__,
                'mysql_code': code if isinstance(code, int) else None}
            from discard_mysql77.process_identity import WorkerPidError
            if isinstance(error, WorkerPidError):
                failure['worker_pid'] = error.pid_evidence
            inside(root / 'evidence/failure.json', root).write_text(json.dumps(failure), encoding='utf-8')
        except Exception:
            pass  # Sin propiedad acreditada NO escribir ni intentar limpieza.
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
