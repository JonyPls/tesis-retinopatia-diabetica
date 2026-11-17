"""Focal CB-03 runner. --prepare is offline; --inspect/--run require pinned approval.

Never provisions MySQL, runs a schema script, creates tables, commits or DELETEs.
"""
import argparse
import ast
import datetime as dt
import getpass
import hashlib
import html
import importlib.metadata
import json
from pathlib import Path
import shutil
import sys
import trace
import unittest

from codn_cb03_mysql import (ACTIVITY, BACKEND, SafetyGateError, environment, load_targets,
                            table_counts, validate_config)

FUNCTIONS = {
    'src/repositories/informe_repository.py': ['obtener_informes_por_visita', 'validar_visita', 'obtener_informe_por_id', '_to_dict'],
    'src/repositories/patient_repository.py': ['obtener_diagnosticos_paciente', '_extract_report_conclusion'],
}


class Result(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.subcases = []
        self.methods = []

    def addSubTest(self, test, subtest, err):
        self.subcases.append({'method': test.id(), 'input': str(subtest), 'status': 'APROBADO' if err is None else 'FALLIDO'})
        super().addSubTest(test, subtest, err)

    def addSuccess(self, test):
        self.methods.append({'method': test.id(), 'status': 'APROBADO'})
        super().addSuccess(test)

    def addFailure(self, test, err):
        self.methods.append({'method': test.id(), 'status': 'FALLIDO'})
        super().addFailure(test, err)

    def addError(self, test, err):
        self.methods.append({'method': test.id(), 'status': 'FALLIDO', 'exception_type': err[0].__name__})
        super().addError(test, err)


def offline_checks():
    import test_codn_cb03_report_queries as suite
    methods = unittest.defaultTestLoader.getTestCaseNames(suite.ReportQueryTests)
    assert len(methods) == 10
    checks = []
    for filename in ['codn_cb03_mysql.py', 'codn_run_cb03_mysql.py', 'test_codn_cb03_report_queries.py']:
        compile((BACKEND / filename).read_text(encoding='utf-8'), str(BACKEND / filename), 'exec')
        checks.append({'check': 'syntax ' + filename, 'status': 'APROBADO'})
    # No host is contacted: invalid/unapproved destinations must fail BEFORE connect.
    examples = [('no_config', {}), ('unapproved', {'exclusive_test_instance': False}),
                ('habitual_port', {'exclusive_test_instance': True, 'read_only_inspection_authorized': True,
                                   'host': '127.0.0.1', 'port': 3306})]
    for label, config in examples:
        try:
            validate_config(config)
        except SafetyGateError:
            checks.append({'check': label + ' rejected before imports/connection', 'status': 'APROBADO'})
        else:
            raise AssertionError('Safety gate accepted ' + label)
    from sqlalchemy.orm import configure_mappers
    from sqlalchemy.dialects import mysql
    from sqlalchemy import select
    target = load_targets()
    configure_mappers()  # Actual ORM mapping only; no engine, DB, DDL or fixtures.
    for cls in [target.Informe, target.VisitaClinica, target.Paciente, target.Usuario, target.InformeVersion]:
        str(select(cls).compile(dialect=mysql.dialect()))
        checks.append({'check': 'offline MySQL SELECT compilation ' + cls.__name__, 'status': 'APROBADO'})
    checks.append({'check': 'ten integration methods discovered, NOT executed', 'status': 'APROBADO'})
    return methods, checks


def coverage_report(counter, output):
    measurements = []
    counts = {(str(Path(path).resolve()), line): count for (path, line), count in counter.results().counts.items()}
    for relative, functions in FUNCTIONS.items():
        path = BACKEND / relative
        source = path.read_text(encoding='utf-8')
        tree = ast.parse(source)
        included = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name in functions:
                included.update(range(node.body[0].lineno, node.end_lineno + 1))
        executable = included & set(trace._find_executable_linenos(str(path)))
        hit = {line for line in executable if counts.get((str(path.resolve()), line), 0)}
        measurements.append({'file': relative, 'functions': functions, 'executed': len(hit),
            'executable': len(executable), 'percent': round(100 * len(hit) / len(executable), 2),
            'missing_lines': sorted(executable-hit), 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        text = ['REAL trace COUNTS; function bodies; lines, NOT branches or SQL predicate coverage.']
        for number, line in enumerate(source.splitlines(), 1):
            marker = str(counts[(str(path.resolve()), number)]) if number in hit else ('>>>>>>' if number in executable else '')
            text.append(f'{marker:>7} {number:4}: {line}')
        (output / (relative.replace('/', '__') + '.cover.txt')).write_text('\n'.join(text) + '\n', encoding='utf-8')
    return measurements


def artifacts(output, data):
    output.mkdir(parents=True, exist_ok=True)
    (output / 'resultado.json').write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    for filename in ['codn_cb03_mysql.py', 'codn_run_cb03_mysql.py', 'test_codn_cb03_report_queries.py']:
        shutil.copy2(BACKEND / filename, output / filename)
    for relative in FUNCTIONS:
        path = BACKEND / relative
        numbered = '\n'.join(f'{n:4}: {line}' for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1))
        (output / (relative.replace('/', '__') + '.fuente.txt')).write_text(numbered + '\n', encoding='utf-8')
    title = 'CB-03 — ' + data['status']
    page = f'''<!doctype html><html lang="es"><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font:17px system-ui;margin:35px;max-width:1100px}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f6;padding:15px}}</style>
<h1>{html.escape(title)}</h1><p>Reporte real del runner; no es una captura de consola.</p>
<p>Modo {html.escape(data['mode'])} · métodos CB-03 ejecutados: {data['methods_executed']} · subcasos: {data['subcases_executed']}</p>
<p>{html.escape(data.get('reason', 'Ver resultado JSON para evidencia completa.'))}</p>
<p>Preparación offline no acredita ejecución SQL. No hay porcentaje de cobertura si no se ejecutó la integración.</p>
<pre>{html.escape(json.dumps(data, ensure_ascii=False, indent=2, default=str))}</pre></html>'''
    (output / 'reporte.html').write_text(page, encoding='utf-8')
    hashes = [hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name
              for path in sorted(output.iterdir()) if path.is_file() and path.name != 'SHA256SUMS.txt']
    (output / 'SHA256SUMS.txt').write_text('\n'.join(hashes) + '\n', encoding='utf-8')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'inspect', 'run'])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    endpoint = [None]
    network_attempts = []
    guard_blocks = []
    def guard(event, values):
        if event == 'open' and isinstance(values[0], (str, bytes)):
            name = Path(values[0].decode() if isinstance(values[0], bytes) else values[0])
            if name.name.lower().startswith('.env') or name.suffix.lower() in ('.ckpt', '.pth', '.pt', '.safetensors'):
                guard_blocks.append('private environment/model access')
                raise SafetyGateError('Lectura de entorno/modelo no permitida.')
        if event in ('socket.connect', 'socket.getaddrinfo'):
            address = values[1] if event == 'socket.connect' else values[:2]
            network_attempts.append(event)
            if endpoint[0] is None or tuple(address[:2]) != endpoint[0]:
                guard_blocks.append('network outside approved endpoint')
                raise SafetyGateError('Conexión fuera del destino previamente autorizado.')
        if event in ('subprocess.Popen', 'os.system', 'socket.bind'):
            guard_blocks.append(event)
            raise SafetyGateError('Proceso/servidor secundario no permitido en este runner.')
    sys.addaudithook(guard)
    # No inherited application environment is consulted for DB configuration.
    versions = {}
    for package in ['Flask', 'Flask-SQLAlchemy', 'SQLAlchemy', 'PyMySQL']:
        versions[package] = importlib.metadata.version(package)
    data = {'case': 'CB-03', 'mode': args.mode, 'started_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'python': sys.version, 'versions': versions, 'status': 'BLOQUEADO',
            'methods_implemented': 10, 'methods_executed': 0, 'subcases_executed': 0,
            'failures': 0, 'errors': 0, 'coverage': None, 'database_connections': 0,
            'fixture_writes': False, 'png': 'PENDIENTE'}
    exit_code = 3
    try:
        if args.mode == 'prepare':
            methods, checks = offline_checks()
            data.update(method_names=methods, preparation_checks=checks,
                reason='Preparación validada sin SQL; falta instancia exclusiva verificada y autorización de fixtures.')
            print('PREPARACIÓN OFFLINE: ' + str(len(checks)) + ' comprobaciones correctas; 10 métodos descubiertos, NO ejecutados.')
        else:
            if args.config is None:
                raise SafetyGateError('Falta --config con destino autorizado; no se abrió ninguna conexión.')
            config = json.loads(args.config.read_text(encoding='utf-8-sig'))
            validate_config(config, writes=args.mode == 'run')
            endpoint[0] = (config['host'], config['port'])
            password = getpass.getpass('Contraseña de la cuenta EXCLUSIVA de pruebas (no se registra): ')
            with environment(config, password, writes=args.mode == 'run') as env:
                data.update(database_connections='real MySQL, pinned identity', identity=env.identity, schema=env.schema)
                if args.mode == 'inspect':
                    data['reason'] = 'Inspección real completada; no ejecuta CB-03 ni autoriza INSERT. Aprobar destino/operaciones por separado.'
                    data['status'] = 'PENDIENTE'
                    exit_code = 0
                else:
                    import test_codn_cb03_report_queries as suite
                    suite.ENVIRONMENT = env
                    data['fixture_writes'] = True
                    f = env.fixtures
                    data['fixture_ids'] = {group: {label: obj.id for label, obj in getattr(f, group).items()}
                        for group in ['patients', 'visits', 'types', 'reports', 'diagnoses']}
                    counter = trace.Trace(count=True, trace=False, ignoredirs=[sys.base_prefix])
                    def execute():
                        tests = unittest.defaultTestLoader.loadTestsFromTestCase(suite.ReportQueryTests)
                        return unittest.TextTestRunner(verbosity=2, resultclass=Result).run(tests)
                    result = counter.runfunc(execute)
                    data.update(methods_executed=result.testsRun, subcases_executed=len(result.subcases),
                        failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped),
                        method_results=result.methods, subcase_results=result.subcases,
                        observations=env.observations, coverage=coverage_report(counter, args.output))
                    env.session.rollback()
                    with env.engine.connect() as connection:
                        after = table_counts(connection, env.schema['counts_before'])
                    data['counts_after_rollback'] = after
                    data['rows_restored'] = after == env.schema['counts_before']
                    success = result.wasSuccessful() and result.testsRun == 10 and not result.skipped and data['rows_restored']
                    data['status'], exit_code = ('APROBADO', 0) if success else ('FALLIDO', 1)
                    data['reason'] = 'Repositorios reales contra MySQL real; fixtures revertidas. Ver observaciones y límites.'
    except SafetyGateError as error:
        data['reason'] = str(error)  # Controlled messages only; no DBAPI secrets.
        data['status'] = 'BLOQUEADO'
    except Exception as error:
        data['reason'] = 'Preparación/entorno no completado. Tipo de excepción: ' + type(error).__name__
        data['status'] = 'BLOQUEADO' if data['methods_executed'] == 0 else 'FALLIDO'
        exit_code = 3 if data['status'] == 'BLOQUEADO' else 1
    data.update(ended_utc=dt.datetime.now(dt.timezone.utc).isoformat(), exit_code=exit_code)
    data.update(activity=dict(ACTIVITY), network_events=len(network_attempts), guard_blocks=guard_blocks)
    if guard_blocks:
        data['status'], data['exit_code'], exit_code = 'BLOQUEADO', 3, 3
    artifacts(args.output, data)
    print(json.dumps({'status': data['status'], 'reason': data['reason'], 'methods_executed': data['methods_executed'],
                      'subcases_executed': data['subcases_executed'], 'exit_code': exit_code}, ensure_ascii=False))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
