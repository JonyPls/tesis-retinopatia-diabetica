"""78A: mocks de inventario/procesos y árboles propios. Nunca ejecutar escenarios SQL."""
import ast
from contextlib import ExitStack, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import socket
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch
from uuid import uuid4

from discard_mysql77.application import seed
from discard_mysql77.resources import OwnedTrial
from discard_mysql77.safety import APPROVED_TEMP, SafetyError
from discard_mysql77.schema import InventoryGate, check_expression, checked_sequence, verify_inventory


class Offline78ATests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('NO_NETWORK')))
        self.stack.enter_context(patch('pymysql.connect', side_effect=AssertionError('NO_SQL')))
        self.stack.enter_context(patch('pymysql.Connect', side_effect=AssertionError('NO_SQL')))
        self.stack.enter_context(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('NO_SQL')))

    def test_gate_blocks_seed_before_any_database_or_files_access(self):
        h = SimpleNamespace(gate=InventoryGate(), app=SimpleNamespace(config={'DIAGNOSIS_DISCARD_ENABLED': False}), db=Mock())
        with self.assertRaises(SafetyError):
            seed(h)
        self.assertEqual(h.db.mock_calls, [])

    def test_schema_failure_never_invokes_fixture_callbacks(self):
        gate = InventoryGate()
        insert = Mock()
        install = Mock()
        validate = Mock(side_effect=SafetyError('SCHEMA_MISMATCH'))
        with self.assertRaises(SafetyError):
            checked_sequence(gate, install, validate, insert, Mock(), Mock(), insert)
        install.assert_called_once_with()
        insert.assert_not_called()
        with self.assertRaises(SafetyError):
            gate.ready()

    def test_extension_failure_invalidates_base_and_never_runs_enabled(self):
        gate, disabled, enabled = InventoryGate(), Mock(), Mock()
        with self.assertRaises(SafetyError):
            checked_sequence(gate, Mock(), lambda: gate.approve('base'), disabled, Mock(),
                             Mock(side_effect=SafetyError('PARTIAL_DDL')), enabled)
        disabled.assert_called_once_with()
        enabled.assert_not_called()
        with self.assertRaises(SafetyError):
            gate.ready()

    def test_sequence_requires_positive_inventory_not_just_returning(self):
        with self.assertRaises(SafetyError):
            checked_sequence(InventoryGate(), Mock(), Mock(), Mock(), Mock(), Mock(), Mock())

    def test_sequence_order_is_install_verify_fixtures_twice(self):
        gate, events = InventoryGate(), []
        def approved(phase):
            events.append('verify_' + phase)
            gate.approve(phase)
        checked_sequence(gate, lambda: events.append('install_base'), lambda: approved('base'),
            lambda: events.append('fixtures_disabled'), lambda: events.append('install_extension'),
            lambda: approved('full'), lambda: events.append('fixtures_enabled'))
        self.assertEqual(events, ['install_base', 'verify_base', 'fixtures_disabled',
                                 'install_extension', 'verify_full', 'fixtures_enabled'])

    def test_engine_guard_rejects_direct_writes_and_allows_readonly_inventory(self):
        gate = InventoryGate()
        for sql in ('INSERT INTO x VALUES (1)', '/* mock */ UPDATE x SET id=1',
                    '-- mock\nDELETE FROM x', 'REPLACE INTO x VALUES (1)', 'CALL writer()',
                    'WITH c AS (SELECT 1) UPDATE x SET id=1'):
            with self.subTest(sql=sql.split()[0]), self.assertRaises(SafetyError):
                gate.guard_sql(None, None, sql, None, None, False)
        gate.guard_sql(None, None, 'SELECT * FROM information_schema.COLUMNS', None, None, False)
        gate.approve('base')
        gate.guard_sql(None, None, 'INSERT INTO x VALUES (1)', None, None, False)

    def test_check_normalization_preserves_precedence_and_literals(self):
        self.assertEqual(check_expression("a IS NULL OR (b IN ('A','B') AND c >= 1)"),
                         check_expression("((`a` is null) or ((`b` in (_utf8mb4'A',_utf8mb4'B')) and (`c` >= 1)))"))
        self.assertNotEqual(check_expression('(a = 1 OR b = 2) AND c = 3'),
                            check_expression('a = 1 OR (b = 2 AND c = 3)'))
        self.assertNotEqual(check_expression("a IN ('ACTIVO')"), check_expression("a IN ('activo')"))
        self.assertEqual(check_expression('x = y + INTERVAL 60 MINUTE'),
                         check_expression('(`x` = (`y` + interval 60 minute))'))
        with self.assertRaises(SafetyError):
            check_expression('a; DROP TABLE x')

    def inventory_fixture(self):
        from sqlalchemy import Column, CheckConstraint, Index, MetaData, Table, text
        from sqlalchemy.dialects.mysql import INTEGER
        metadata = MetaData()
        table = Table('probe', metadata, Column('id', INTEGER(unsigned=True), primary_key=True),
            Column('flag', INTEGER(), nullable=False, server_default=text('0')),
            CheckConstraint('flag >= 0', name='ck_probe'))
        Index('ix_probe_flag', table.c.flag)
        inspector = Mock()
        inspector.get_table_names.return_value = ['probe']
        inspector.get_columns.return_value = [
            {'name': 'id', 'type': INTEGER(unsigned=True), 'nullable': False, 'default': None},
            {'name': 'flag', 'type': INTEGER(), 'nullable': False, 'default': '0'}]
        inspector.get_pk_constraint.return_value = {'constrained_columns': ['id']}
        inspector.get_unique_constraints.return_value = []
        inspector.get_foreign_keys.return_value = []
        inspector.get_indexes.return_value = [{'column_names': ['flag'], 'unique': False}]
        inspector.get_check_constraints.return_value = [{'name': 'ck_probe', 'sqltext': '(`flag` >= 0)'}]
        options = {'engine': 'InnoDB', 'enforced': 'YES', 'triggers': 0}
        connection = Mock()
        def execute(statement):
            sql = str(statement)
            result = Mock()
            if 'information_schema.TABLES ' in sql:
                result.all.return_value = [('probe', options['engine'])]
            elif 'information_schema.TABLE_CONSTRAINTS' in sql:
                result.all.return_value = [('ck_probe', options['enforced'])]
            elif 'information_schema.COLUMNS' in sql:
                result.all.return_value = [('probe', 'id', None, None), ('probe', 'flag', None, None)]
            elif 'information_schema.TRIGGERS' in sql:
                result.scalar.return_value = options['triggers']
            else:
                raise AssertionError('Solo consultas de inventario simuladas')
            return result
        connection.execute.side_effect = execute
        admin = Mock()
        admin.connect.return_value.__enter__ = Mock(return_value=connection)
        admin.connect.return_value.__exit__ = Mock(return_value=False)
        h = SimpleNamespace(gate=InventoryGate(), admin=admin, db=Mock(),
                            app=SimpleNamespace(config={'DIAGNOSIS_DISCARD_ENABLED': False}))
        return h, metadata, inspector, options

    def test_native_inventory_passes_only_matching_mock_schema(self):
        h, metadata, inspector, _options = self.inventory_fixture()
        with patch('sqlalchemy.inspect', return_value=inspector):
            verify_inventory(h, metadata, full=False)
        h.gate.ready()
        self.assertEqual(h.gate.phase, 'base')

    def test_all_inventory_mismatches_prevent_inserts(self):
        from sqlalchemy.dialects.mysql import INTEGER
        for mismatch in ('table', 'type', 'null', 'default', 'pk', 'fk', 'unique', 'index', 'check',
                         'engine', 'enforced', 'trigger'):
            with self.subTest(mismatch=mismatch):
                h, metadata, inspector, options = self.inventory_fixture()
                if mismatch == 'table': inspector.get_table_names.return_value = ['probe', 'unexpected']
                if mismatch == 'type': inspector.get_columns.return_value[0]['type'] = INTEGER(unsigned=False)
                if mismatch == 'null': inspector.get_columns.return_value[1]['nullable'] = True
                if mismatch == 'default': inspector.get_columns.return_value[1]['default'] = '99'
                if mismatch == 'pk': inspector.get_pk_constraint.return_value = {'constrained_columns': ['flag']}
                if mismatch == 'fk': inspector.get_foreign_keys.return_value = [dict(constrained_columns=['flag'], referred_table='other', referred_columns=['id'])]
                if mismatch == 'unique': inspector.get_unique_constraints.return_value = [{'column_names': ['flag']}]
                if mismatch == 'index': inspector.get_indexes.return_value = []
                if mismatch == 'check': inspector.get_check_constraints.return_value[0]['sqltext'] = 'flag < 0'
                if mismatch == 'engine': options['engine'] = 'MyISAM'
                if mismatch == 'enforced': options['enforced'] = 'NO'
                if mismatch == 'trigger': options['triggers'] = 1
                with patch('sqlalchemy.inspect', return_value=inspector), self.assertRaises(SafetyError):
                    verify_inventory(h, metadata, full=False)
                with self.assertRaises(SafetyError):
                    seed(h)
                self.assertEqual(h.db.mock_calls, [])

    def test_prepared_corrected_case_uses_exact_ID_and_full_snapshots(self):
        # Inspección estructural, NO invocar el escenario clínico.
        source = Path(__file__).parent / 'discard_mysql77/cases.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'reject_corrected_selected')
        calls = [n for n in ast.walk(function) if isinstance(n, ast.Call)]
        validation = next(n for n in calls if isinstance(n.func, ast.Name) and n.func.id == 'validate')
        self.assertTrue(next(k.value.value for k in validation.keywords if k.arg == 'corrected'))
        code = ast.get_source_segment(source.read_text(encoding='utf-8'), function)
        for required in ("f.details['Derecho']", "f.details['Izquierdo']", 'clinical_snapshot(h)',
                         'files(h)', 'RESULTADO_VALIDADO', 'estado_validacion'):
            self.assertIn(required, code)

    def test_prepared_retinograph_calls_real_HTTP_not_fixture_confirmation(self):
        tree = ast.parse((Path(__file__).parent / 'discard_mysql77/cases.py').read_text(encoding='utf-8'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'real_retinograph_flow')
        names = {n.func.id for n in ast.walk(function) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        self.assertIn('request', names)
        self.assertNotIn('confirmation', names)
        self.assertNotIn('patch', names)
        literals = {n.value for n in ast.walk(function) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertTrue({'CONSUMIDA', 'Izquierdo', 'confirmacion_exportacion', 'COMPROBANTE_VINCULADO'} <= literals)


class FakeProcess:
    def __init__(self, returncode=None):
        self.returncode = returncode
        self.pid = 12345  # No se usa para matar/identificar procesos reales.
        self.stdin = self.stdout = self.stderr = None
        self.terminated = False

    def poll(self): return self.returncode
    def terminate(self):
        self.terminated = True
        self.returncode = 1
    def wait(self, timeout): return self.returncode
    def communicate(self, input=None, timeout=None):
        self.returncode = 0
        return '', ''


class FakeJob:
    def __init__(self): self.members = []
    def assign(self, process): self.members.append(process)
    def stop(self):
        for process in self.members:
            if process.poll() is None: process.terminate()
    def empty(self): return all(p.poll() is not None for p in self.members)
    def close(self): pass


class Retirement78ATests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('NO_NETWORK')))
        self.temporary = self.stack.enter_context(TemporaryDirectory(prefix='codn78a-offline-', dir=APPROVED_TEMP))
        self.parent = Path(self.temporary)
        self.owner = OwnedTrial(self.parent / 'new-own-trial', str(uuid4()), retirement_authorized=True, job_factory=FakeJob)
        self.root = self.owner.root

    def populate(self):
        (self.root / 'data').mkdir()
        (self.root / 'data/mysql.ibd').write_bytes(b'SYNTHETIC_AUTH_SECRET')
        (self.root / 'bootstrap.sql').write_text('SYNTHETIC_ROOT_PASSWORD', encoding='utf-8')
        (self.root / 'tmp').mkdir()
        (self.root / 'tmp/patient.bin').write_bytes(b'SYNTHETIC_PRIVATE_IMAGE')
        (self.root / 'evidence').mkdir()
        (self.root / 'evidence/results.json').write_text(json.dumps({'cases': [{'name': 'synthetic', 'status': 'passed'}],
            'trace': [], 'unexpected_secret': 'MUST_NOT_RETAIN'}), encoding='utf-8')
        (self.root / 'evidence/mysql.log').write_text('MUST_NOT_RETAIN', encoding='utf-8')

    def fake_spawn(self, process):
        with patch.object(subprocess, 'Popen', return_value=process):
            return self.owner.spawn(['SYNTHETIC_NEVER_EXECUTED'])

    def test_success_stops_only_owned_handles_and_keeps_sanitized_evidence(self):
        self.populate()
        owned, foreign = FakeProcess(), FakeProcess()
        self.fake_spawn(owned)
        report = self.owner.retire()
        self.assertEqual(report['status'], 'COMPLETED')
        self.assertTrue(owned.terminated)
        self.assertFalse(foreign.terminated)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'evidence'})
        text = ''.join(p.read_text(encoding='utf-8') for p in (self.root / 'evidence').iterdir())
        for secret in ('SYNTHETIC_AUTH_SECRET', 'SYNTHETIC_ROOT_PASSWORD', 'MUST_NOT_RETAIN', self.owner.owner):
            self.assertNotIn(secret, text)

    def test_start_failure_still_removes_bootstrap_and_datadir(self):
        self.populate()
        with patch.object(subprocess, 'Popen', side_effect=OSError('SYNTHETIC')):
            with self.assertRaises(OSError): self.owner.spawn(['SYNTHETIC'])
        self.assertEqual(self.owner.retire()['status'], 'COMPLETED')
        self.assertFalse((self.root / 'bootstrap.sql').exists())
        self.assertFalse((self.root / 'data').exists())

    def test_trial_error_and_failed_assignment_stop_own_process_and_retire(self):
        self.populate()
        process = FakeProcess()
        with patch.object(FakeJob, 'assign', side_effect=SafetyError('JOB_FAILURE')):
            with self.assertRaises(SafetyError): self.fake_spawn(process)
        self.assertTrue(process.terminated)
        self.assertEqual(self.owner.retire()['status'], 'COMPLETED')

    def test_trial_exception_treatment_also_stops_descendants(self):
        self.populate()
        parent, descendant, foreign = FakeProcess(), FakeProcess(), FakeProcess()
        self.fake_spawn(parent)
        self.owner._job.members.append(descendant)  # Simular herencia del Job, no adoptar PID externo.
        try:
            raise RuntimeError('SYNTHETIC_TRIAL_FAILURE_SECRET')
        except RuntimeError:
            report = self.owner.retire()
        self.assertEqual(report['status'], 'COMPLETED')
        self.assertTrue(parent.terminated and descendant.terminated)
        self.assertFalse(foreign.terminated)

    def test_runtime_setup_error_always_retires_even_before_start(self):
        from discard_mysql77 import runtime
        plan = SimpleNamespace(root=self.parent / 'failed-setup', run_id=str(uuid4()))
        output = StringIO()
        with patch.object(runtime, 'authorize'), \
                patch.object(runtime, 'private_acl', side_effect=RuntimeError('SYNTHETIC_SECRET')), \
                redirect_stdout(output), self.assertRaises(SafetyError):
            runtime.execute(Path(__file__).parent, plan, plan.run_id)
        self.assertEqual({p.name for p in plan.root.iterdir()}, {'evidence'})
        self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())

    def test_cleaning_failure_is_explicit_and_does_not_keep_bootstrap_silently(self):
        self.populate()
        original = Path.unlink
        def unlink(path, *args, **kwargs):
            if path.name == 'mysql.ibd': raise PermissionError('SYNTHETIC')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            report = self.owner.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertIn('data', report['pending'])
        self.assertFalse((self.root / 'bootstrap.sql').exists())
        self.assertTrue((self.root / 'owner.json').exists())
        self.assertTrue((self.root / 'evidence/retirement.json').exists())

    def test_marker_removal_failure_cannot_persist_false_completed_status(self):
        self.populate()
        original = Path.unlink
        def unlink(path, *args, **kwargs):
            if path.name == 'owner.json': raise PermissionError('SYNTHETIC')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            report = self.owner.retire()
        recorded = json.loads((self.root / 'evidence/retirement.json').read_text(encoding='utf-8'))
        self.assertEqual(report['status'], recorded['status'])
        self.assertEqual(recorded['status'], 'INCOMPLETE')
        self.assertIn('owner_marker', recorded['pending'])

    def test_root_replacement_with_same_UUID_and_marker_is_not_owned(self):
        self.populate()
        old = self.parent / 'renamed-owned-root'
        self.root.rename(old)
        self.root.mkdir()
        (self.root / 'owner.json').write_bytes((old / 'owner.json').read_bytes())
        protected = self.root / 'foreign.bin'
        protected.write_bytes(b'NEVER_DELETE')
        report = self.owner.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertEqual(protected.read_bytes(), b'NEVER_DELETE')
        self.assertTrue((old / 'data/mysql.ibd').exists())

    def test_refuses_external_hardlink_without_deleting_external_target(self):
        external = self.parent / 'external.bin'
        external.write_bytes(b'PROTECTED')
        (self.root / 'data').mkdir()
        os.link(external, self.root / 'data/alias.bin')
        report = self.owner.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertEqual(external.read_bytes(), b'PROTECTED')

    def test_symlink_outside_is_not_followed_and_is_reported(self):
        external = self.parent / 'external'
        external.mkdir()
        protected = external / 'protected.bin'
        protected.write_bytes(b'PROTECTED')
        try: os.symlink(external, self.root / 'unsafe', target_is_directory=True)
        except OSError: self.skipTest('SO sin permisos de symlink')
        report = self.owner.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertEqual(protected.read_bytes(), b'PROTECTED')

    def test_process_stop_failure_forbids_any_file_cleanup(self):
        self.populate()
        self.fake_spawn(FakeProcess())
        with patch.object(FakeJob, 'stop', side_effect=OSError('SYNTHETIC')):
            report = self.owner.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertTrue((self.root / 'bootstrap.sql').exists())
        self.assertIn('owned_processes_and_private_tree', report['pending'])

    def test_missing_retirement_scope_and_existing_roots_are_rejected(self):
        with self.assertRaises(SafetyError):
            OwnedTrial(self.parent / 'unauthorized', str(uuid4()), retirement_authorized=False)
        with self.assertRaises(FileExistsError):
            OwnedTrial(self.root, str(uuid4()), retirement_authorized=True)


if __name__ == '__main__':
    main()
