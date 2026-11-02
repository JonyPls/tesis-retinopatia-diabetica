"""ÚNICA suite 77 autorizada: stdlib, mocks, AST y directorios propios; ningún SQL."""
import ast
from contextlib import ExitStack, redirect_stdout
from dataclasses import replace
from io import StringIO
import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch
from uuid import uuid4

from discard_mysql77 import safety


SOURCE = Path(__file__).resolve().parent


class Preflight77Tests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        # Si un refactor introduce una operación activa, estos tests deben fallar.
        self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('NO_PROCESSES')))
        self.stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('NO_PROCESSES')))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('NO_NETWORK')))
        self.temp = self.stack.enter_context(TemporaryDirectory(prefix='codn77-offline-', dir=safety.APPROVED_TEMP))
        self.root = Path(self.temp)
        self.stack.enter_context(patch.object(safety, 'APPROVED_TEMP', self.root))

    def plan(self):
        server = self.root / 'mysqld.exe'
        server.write_bytes(b'NOT_AN_EXECUTABLE_SYNTHETIC_FIXTURE')
        import hashlib
        identifier = str(uuid4())
        return safety.Plan(identifier, server, hashlib.sha256(server.read_bytes()).hexdigest(),
            safety.source_digest(SOURCE), 'PROMPT78_DISPOSABLE_ONLY:' + identifier, safety.SCOPES)

    def test_imports_have_no_active_effects(self):
        before = set(sys.modules)
        for name in ('discard_mysql77.application', 'discard_mysql77.runtime', 'discard_mysql77.cases',
                     'discard_mysql77.worker', 'discard_mysql_trial77'):
            importlib.import_module(name)
        check = set(sys.modules) - before
        self.assertFalse(check & {'app', 'database', 'pymysql', 'sqlalchemy', 'flask', 'torch',
                                  'dl_model.inference', 'dl_model.validator'})

    def test_preflight_does_not_import_application_or_write_files(self):
        before = set(self.root.iterdir())
        report = safety.preflight(SOURCE)
        self.assertEqual(report['phase'], 'A_NO_CONNECTION')
        self.assertEqual(set(self.root.iterdir()), before)
        self.assertEqual(report['mysql_execution'], 'NOT_AUTHORIZED_BY_PREFLIGHT')
        self.assertNotIn('database', sys.modules)

    def test_cli_default_is_phase_A(self):
        from discard_mysql_trial77 import main as cli
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(cli([]), 0)
        self.assertEqual(json.loads(output.getvalue())['phase'], 'A_NO_CONNECTION')

    def test_environment_cannot_activate_phase_B(self):
        from discard_mysql_trial77 import main as cli
        with patch.dict(os.environ, {'DIAGNOSIS_DISCARD_ENABLED': 'true', 'MYSQL_PWD': 'synthetic',
                                     'DB_HOST': 'habitual', 'CODN_RUN_MYSQL': 'true'}), \
                redirect_stdout(StringIO()) as output:
            self.assertEqual(cli([]), 0)
        self.assertEqual(json.loads(output.getvalue())['phase'], 'A_NO_CONNECTION')

    def test_cli_execute_without_plan_never_reaches_launch(self):
        from discard_mysql_trial77 import main as cli
        with redirect_stdout(StringIO()):
            self.assertEqual(cli(['--execute']), 2)

    def test_missing_confirmation_is_closed(self):
        plan = self.plan()
        for confirmation in (None, '', str(uuid4())):
            with self.subTest(confirmation=bool(confirmation)), self.assertRaises(safety.SafetyError):
                safety.authorize(SOURCE, plan, confirmation)

    def test_manifest_needs_independent_explicit_scope(self):
        plan = self.plan()
        for invalid in (replace(plan, authorization=''), replace(plan, scopes=()),
                        replace(plan, scopes=(*safety.SCOPES, 'habitual_database'))):
            with self.assertRaises(safety.SafetyError):
                safety.authorize(SOURCE, invalid, invalid.run_id)

    def test_incomplete_config_and_connection_overrides_are_rejected(self):
        path = self.root / 'plan.json'
        for data in ({}, {'host': '127.0.0.1'}, {'database': 'development'}, {'password': 'synthetic'}):
            path.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaises(safety.SafetyError):
                safety.load_plan(path)

    def test_valid_plan_is_inspected_without_starting(self):
        plan = self.plan()
        report = safety.preflight(SOURCE, plan)
        self.assertEqual(report['schema'], 'codn77_' + plan.run_id.replace('-', ''))
        self.assertFalse(plan.root.exists())

    def test_existing_run_is_never_reused(self):
        plan = self.plan()
        plan.root.mkdir()
        with self.assertRaises(safety.SafetyError):
            safety.preflight(SOURCE, plan)

    def test_changed_sources_or_binary_is_closed(self):
        plan = self.plan()
        for invalid in (replace(plan, sources_sha256='0' * 64), replace(plan, mysql_sha256='0' * 64)):
            with self.assertRaises(safety.SafetyError):
                safety.preflight(SOURCE, invalid)

    def test_habitual_and_sibling_paths_are_rejected(self):
        for path in (SOURCE / 'uploads/retinas', SOURCE / 'db', SOURCE / '.env', self.root.parent):
            with self.subTest(path=path.name), self.assertRaises(safety.SafetyError):
                safety.inside(path, self.root)

    def test_traversal_and_relative_paths_are_rejected(self):
        for path in (Path('relative'), self.root / '..' / 'outside'):
            with self.assertRaises(safety.SafetyError):
                safety.no_links(path)

    def test_own_temporary_paths_are_accepted(self):
        expected = self.root / 'backend/uploads/retinas'
        self.assertEqual(safety.inside(expected, self.root), expected)

    def test_reparse_points_are_rejected_before_resolve(self):
        target = self.root / 'junction'
        original = Path.lstat
        def info(path):
            if path == target:
                return SimpleNamespace(st_mode=0o040755, st_file_attributes=0x400)
            return original(path)
        with patch.object(Path, 'lstat', info), self.assertRaises(safety.SafetyError):
            safety.inside(target / 'retinas', self.root)

    def test_symlink_is_not_followed(self):
        target = self.root / 'target'
        target.mkdir()
        link = self.root / 'link'
        try:
            os.symlink(target, link, target_is_directory=True)
        except OSError:
            self.skipTest('SO no autoriza crear symlinks; reparse se cubre también con mock')
        with self.assertRaises(safety.SafetyError):
            safety.inside(link / 'photo.jpg', self.root)

    def test_hardlinked_source_is_rejected(self):
        source = self.root / 'source'
        source.mkdir()
        original = source / 'database.py'
        original.write_text('synthetic', encoding='utf-8')
        os.link(original, source / 'alias.py')
        with self.assertRaises(safety.SafetyError):
            safety.source_file(source, 'database.py')

    def test_explicit_copy_includes_current_uncommitted_bytes_only(self):
        root = self.root / 'copy'
        root.mkdir()
        digest = safety.source_digest(SOURCE)
        destination = safety.copy_sources(SOURCE, root, digest)
        self.assertEqual(safety.source_digest(destination), digest)
        actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
        self.assertEqual(actual, set(safety.COPY_FILES))
        self.assertFalse(any(name in actual for name in ('.env', 'app.py', 'b1_orm_mysql_trial.py')))
        self.assertEqual((destination / 'services/diagnosis_discard_service.py').read_bytes(),
                         (SOURCE / 'services/diagnosis_discard_service.py').read_bytes())

    def test_master_sql_is_never_selected(self):
        self.assertEqual([p for p in safety.COPY_FILES if p.endswith('.sql')],
                         ['migrations/72_descarte_ia_propuesta.sql'])
        with self.assertRaises(safety.SafetyError):
            safety.source_file(SOURCE, 'db/centro-oftalmologico-db-v2.sql')

    def test_proposal_is_only_two_technical_creates(self):
        statements = safety.proposal_statements(SOURCE)
        self.assertEqual(len(statements), 2)
        self.assertTrue(all(s.endswith('ENGINE=InnoDB') for s in statements))

    def test_tampered_proposal_and_unreviewed_import_fail_closed(self):
        destination = self.root / 'tampered'
        destination.mkdir()
        sandbox = safety.copy_sources(SOURCE, destination, safety.source_digest(SOURCE))
        proposal = sandbox / 'migrations/72_descarte_ia_propuesta.sql'
        proposal.write_text(proposal.read_text(encoding='utf-8') + '\nDROP DATABASE habitual;', encoding='utf-8')
        with self.assertRaises(safety.SafetyError):
            safety.proposal_statements(sandbox)
        target = sandbox / 'services/diagnosis_service.py'
        target.write_text(target.read_text(encoding='utf-8') + '\nimport app\n', encoding='utf-8')
        with self.assertRaises(safety.SafetyError):
            safety.check_imports(sandbox)

    def test_worker_rejects_habitual_perimeter_before_importing_driver(self):
        from discard_mysql77.worker import run
        with self.assertRaises(safety.SafetyError):
            run({'run_id': str(uuid4()), 'root': str(SOURCE.parent)})

    def test_noncanonical_plan_object_cannot_bypass_loader(self):
        plan = self.plan()
        with self.assertRaises(safety.SafetyError):
            safety.preflight(SOURCE, replace(plan, run_id='not-a-uuid'))

    def test_environment_has_no_inherited_credentials_or_profiles(self):
        with patch.dict(os.environ, {'MYSQL_PWD': 'synthetic', 'DB_HOST': 'do-not-use',
                                     'SECRET_KEY': 'do-not-copy', 'PYTHONPATH': 'habitual'}):
            environment = safety.clean_environment(self.root)
        self.assertFalse(set(environment) & {'MYSQL_PWD', 'DB_HOST', 'SECRET_KEY', 'PYTHONPATH'})
        self.assertEqual(environment['RETINOGRAPH_EXPORT_DIR'], str(self.root / 'exports'))

    def test_only_safe_B1_functions_are_reused(self):
        tree = ast.parse((SOURCE / 'discard_mysql77/runtime.py').read_text(encoding='utf-8'))
        imports = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module == 'b1_mysql_disposable_trial']
        self.assertEqual([[a.name for a in n.names] for n in imports],
                         [['free_loopback_port', 'ensure_own_server']])
        names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
        self.assertFalse(names & {'rmtree', 'kill', 'run_trial', 'client_script'})

    def test_global_flags_and_no_real_inference_are_static(self):
        app = ast.parse((SOURCE / 'app.py').read_text(encoding='utf-8-sig'))
        flags = {}
        for node in app.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Subscript) and isinstance(target.slice, ast.Constant):
                        if str(target.slice.value).startswith('DIAGNOSIS_DISCARD_'):
                            flags[target.slice.value] = ast.literal_eval(node.value)
        self.assertEqual(flags, {name: False for name in ('DIAGNOSIS_DISCARD_ENABLED',
            'DIAGNOSIS_DISCARD_SCHEMA_VERIFIED', 'DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY')})
        self.assertNotIn('app.py', safety.COPY_FILES)
        self.assertFalse(any(path.startswith('dl_model/') for path in safety.COPY_FILES))

    def test_compilation_without_pyc_or_imports(self):
        for path in (*safety.HARNESS_FILES, 'discard_mysql_trial77.py'):
            compile((SOURCE / path).read_text(encoding='utf-8'), path, 'exec')


if __name__ == '__main__':
    main()
