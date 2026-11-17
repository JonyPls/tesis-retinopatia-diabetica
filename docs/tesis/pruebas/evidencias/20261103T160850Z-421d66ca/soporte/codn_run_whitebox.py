"""Run one CODN suite in a fresh process with guards, real trace and JSON evidence.

Usage (from backend): python -B codn_run_whitebox.py test_codn_cb01_authorization OUT
No app/DB initialization, subprocesses, sockets, env files or model loads allowed.
"""
import ast
import datetime as dt
import hashlib
import importlib.abc
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import trace
import traceback
import unittest
from unittest.mock import patch

TARGETS = {
    'test_codn_cb01_authorization': {
        'services/auth_service.py': ['autenticar_usuario'],
        'utils/security.py': ['token_required'],
        'utils/strict_authorization.py': ['evaluate_rule', 'evaluate_operation', 'patient_read_scope',
            'patient_create_scope', 'strict_authorization_required'],
        'src/repositories/auth_repository.py': ['get_user_by_username'],
    },
    'test_codn_cb02_patient_validation': {
        'services/patient_service.py': ['_clean_text', '_clean_multiline_text', '_valid_person_name',
            '_normalize_document', '_parse_birth_date', '_validate_patient_data', 'registrar_nuevo_paciente'],
        'utils/identity_validation.py': ['valid_email'],
    },
    'test_codn_cb04_diagnosis_logic': {
        'dl_model/validator.py': ['validar_formato_y_dimensiones', 'validar_region_circular', 'validar_contenido_semantico'],
        'services/diagnosis_service.py': ['procesar_diagnostico', '_undo_creation'],
        'utils/diagnosis_storage.py': ['__init__', '_mark_active', 'release', 'prepare', 'verify', 'publish', '_identity', 'cleanup'],
    },
    'test_codn_cb05_report_transaction': {
        'services/informe_service.py': ['_extraer_conclusion', '_positive_id', '_validar_datos_estructurados',
            '_is_duplicate_report', '_rollback_informe', 'crear_nuevo_informe'],
    },
}


class EvidenceResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.events = []
        self.subcases = 0

    def addSubTest(self, test, subtest, err):
        self.subcases += 1
        self.events.append({'method': test.id(), 'subcase': str(subtest), 'status': 'APROBADO' if err is None else 'FALLIDO'})
        self.stream.writeln('  SUBCASO ' + ('OK ' if err is None else 'FAIL ') + str(subtest))
        super().addSubTest(test, subtest, err)

    def addSuccess(self, test):
        self.events.append({'method': test.id(), 'status': 'APROBADO'})
        super().addSuccess(test)

    def addFailure(self, test, err):
        self.events.append({'method': test.id(), 'status': 'FALLIDO', 'kind': 'assertion'})
        super().addFailure(test, err)

    def addError(self, test, err):
        self.events.append({'method': test.id(), 'status': 'FALLIDO', 'kind': 'error'})
        super().addError(test, err)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    name, output = sys.argv[1:]
    targets = TARGETS[name]  # explicit allowlist; no discovery
    backend = Path(__file__).resolve().parent
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='codn-whitebox-')).resolve()
    tempfile.tempdir = str(temporary)
    attempts = []
    def within(path, roots):
        path = Path(path).resolve()
        return any(path == root or root in path.parents for root in roots)
    def deny(reason):
        attempts.append({'reason': reason, 'stack': [f'{Path(frame.filename).name}:{frame.lineno}:{frame.name}'
                         for frame in traceback.extract_stack(limit=8)]})
        raise PermissionError('CODN test guard: ' + reason)
    def guard(event, args):
        if event in ('socket.connect', 'socket.bind', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
            deny(event)
        if event == 'open':
            path, mode, flags = args
            if isinstance(path, (str, bytes, os.PathLike)):
                path = Path(os.fsdecode(path))
                if path.name.lower().startswith('.env') or path.suffix.lower() in ('.ckpt', '.safetensors', '.pth', '.pt'):
                    deny('private environment/model file access')
                writing = bool((flags or 0) & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
                if writing and not within(path, [output, temporary]):
                    deny('write outside evidence/temporary roots: ' + path.name)
        if event in ('os.mkdir', 'os.remove', 'os.rmdir'):
            if not within(os.fsdecode(args[0]), [output, temporary]):
                deny('filesystem mutation outside evidence/temporary roots')
        if event in ('os.rename', 'os.link'):
            if not all(within(os.fsdecode(path), [output, temporary]) for path in args[:2]):
                deny('filesystem relocation outside evidence/temporary roots')
    class ImportGuard(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname in ('database', 'app', 'dotenv') or fullname.split('.')[0] in (
                    'torch', 'torchvision', 'transformers', 'pytorch_lightning', 'pymysql') or fullname.startswith('src.models.'):
                deny('unisolated import: ' + fullname)
    sys.addaudithook(guard)
    sys.meta_path.insert(0, ImportGuard())
    # Clear inherited environment; preserve only basic OS paths required by DLLs.
    os.environ.clear()
    os.environ.update({'SYSTEMROOT': r'C:\Windows', 'WINDIR': r'C:\Windows',
                       'TEMP': str(temporary), 'TMP': str(temporary), 'HF_HUB_OFFLINE': '1',
                       'TRANSFORMERS_OFFLINE': '1', 'PYTHONDONTWRITEBYTECODE': '1'})
    started = dt.datetime.now(dt.timezone.utc)
    counter = trace.Trace(count=True, trace=False, ignoredirs=[sys.base_prefix])
    runner = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult)
    def execute():
        # PyJWT's optional crypto imports ask platform for Windows version;
        # avoid the stdlib fallback that launches `ver` in a child shell.
        with patch('platform._syscmd_ver', return_value=('Windows', 'isolated-test', '0')):
            suite = unittest.defaultTestLoader.loadTestsFromName(name)
            return runner.run(suite)
    print('CODN WHITE-BOX | ' + name, flush=True)
    print('UTC: ' + started.isoformat() + ' | Python: ' + sys.version.split()[0], flush=True)
    print('Isolation: explicit stubs; network, env/model reads and external writes guarded.', flush=True)
    result = counter.runfunc(execute)
    coverage = []
    counts = {(str(Path(path).resolve()), line): count for (path, line), count in counter.results().counts.items()}
    for relative, functions in targets.items():
        path = backend / relative
        source = path.read_text(encoding='utf-8')
        tree = ast.parse(source)
        executable = set(trace._find_executable_linenos(str(path)))
        included = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in functions:
                # Function bodies only, including nested closures; exclude def/decorator lines.
                included.update(range(node.body[0].lineno, node.end_lineno + 1))
        denominator = executable & included
        hits = {line for line in denominator if counts.get((str(path.resolve()), line), 0)}
        missed = sorted(denominator - hits)
        coverage.append({'file': relative, 'functions': functions, 'executed': len(hits),
                         'executable': len(denominator), 'percent': round(100 * len(hits) / len(denominator), 2),
                         'missing_lines': missed, 'executed_lines': sorted(hits),
                         'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        lines = source.splitlines()
        report = ['Real CPython trace counts; function-body scope; lines, NOT branches.', 'Functions: ' + ', '.join(functions)]
        for number, line in enumerate(lines, 1):
            marker = (str(counts.get((str(path.resolve()), number), 0)) if number in hits else '>>>>>>') if number in denominator else ''
            report.append(f'{marker:>7} {number:4}: {line}')
        (output / (relative.replace('/', '__') + '.cover.txt')).write_text('\n'.join(report) + '\n', encoding='utf-8')
    end = dt.datetime.now(dt.timezone.utc)
    versions = {}
    for package in ['Flask', 'SQLAlchemy', 'PyJWT', 'Pillow', 'numpy', 'opencv-python', 'coverage', 'pytest']:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = 'not installed'
    exit_code = 0 if result.wasSuccessful() and not attempts else 1
    metadata = {'suite': name, 'started_utc': started.isoformat(), 'ended_utc': end.isoformat(),
                'duration_seconds': round((end - started).total_seconds(), 3), 'python': sys.version,
                'versions': versions, 'methods': result.testsRun, 'subcases': result.subcases,
                'failures': len(result.failures), 'errors': len(result.errors), 'skipped': len(result.skipped),
                'exit_code': exit_code, 'status': 'APROBADO' if exit_code == 0 else 'FALLIDO',
                'guard_attempts': attempts, 'events': result.events, 'coverage': coverage,
                'temporary_root': temporary.name,
                'assertion_count': None, 'assertion_count_note': 'Not instrumented; nested unittest/mock assertions are not a reliable static count.'}
    (output / 'resultado.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    for row in coverage:
        print(f"LINES {row['file']}: {row['executed']}/{row['executable']} = {row['percent']}%", flush=True)
    print(f'RESULTADO {metadata["status"]}: {result.testsRun} methods; {result.subcases} subcases; exit {exit_code}', flush=True)
    print('Guard attempts: ' + str(len(attempts)), flush=True)
    # Only the private, resolved root created by this process is removed.
    import shutil
    shutil.rmtree(temporary)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
