"""Configuración de arranque únicamente; sin servidores, MySQL ni modelos IA."""
import ast
from contextlib import nullcontext
import os
from pathlib import Path
import runpy
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch


BACKEND = Path(__file__).resolve().parent
FLAGS = ('DIAGNOSIS_DISCARD_ENABLED', 'DIAGNOSIS_DISCARD_SCHEMA_VERIFIED',
         'DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY')


class RunLocalTests(TestCase):
    def setUp(self):
        self.cwd = Path.cwd()
        self.addCleanup(os.chdir, self.cwd)
        self.config = {flag: False for flag in FLAGS}
        self.config.update(RETINOGRAPH_PRIVATE_DIR='existing-private-directory',
                           SQLALCHEMY_DATABASE_URI='unchanged-connection',
                           SECRET_KEY='unchanged-test-key', CORS='unchanged-cors')
        self.app = SimpleNamespace(config=self.config, run=Mock(),
                                   app_context=nullcontext, logger=Mock())
        module = ModuleType('app')
        module.app = self.app
        database = ModuleType('database')
        self.session = Mock()
        self.session.execute.return_value.scalar.return_value = 1
        database.db = SimpleNamespace(session=self.session)
        gate = ModuleType('utils.diagnosis_discard_gate')
        self.ready = gate.require_ready = Mock()
        self.dependencies = gate.verify_delete_dependencies = Mock()
        self.modules = patch.dict(sys.modules, {'app': module, 'database': database,
                                               'utils.diagnosis_discard_gate': gate})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_local_start_sets_flags_and_storage_before_serving_from_any_cwd(self):
        def serving(**options):
            self.assertEqual(Path.cwd(), BACKEND)
            self.assertTrue(all(self.config[flag] is True for flag in FLAGS))
            self.assertEqual(self.config['DIAGNOSIS_DISCARD_STORAGE_ROOT'],
                             str(BACKEND / 'uploads' / 'retinas'))
        self.app.run.side_effect = serving
        with TemporaryDirectory(prefix='codn-local-config-') as other:
            os.chdir(other)
            runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
            os.chdir(self.cwd)
        self.app.run.assert_called_once_with(host='127.0.0.1', port=5000,
                                             debug=False, use_reloader=False)
        self.assertIs(self.config['REPORTS_HISTORY_ENABLED'], True)
        self.assertIs(self.config['REPORTS_EDIT_ENABLED'], False)
        self.assertIs(self.config['REPORTS_ANNUL_ENABLED'], False)
        self.assertEqual(self.config['SQLALCHEMY_DATABASE_URI'], 'unchanged-connection')
        self.assertEqual(self.config['SECRET_KEY'], 'unchanged-test-key')
        self.assertEqual(self.config['CORS'], 'unchanged-cors')
        self.ready.assert_called_once_with()
        self.dependencies.assert_called_once_with()
        sql, params = self.session.execute.call_args.args
        self.assertTrue(str(sql).startswith('SELECT 1 FROM permisos'))
        self.assertEqual(params, {'permission': 'diagnostico_retinopatia.descartar_pendiente'})
        self.session.rollback.assert_called_once_with()
        self.session.commit.assert_not_called()

    def test_rebuilt_schema_disables_only_discard_before_serving(self):
        self.ready.side_effect = RuntimeError('missing extension tables')
        self.app.run.side_effect = lambda **_: self.assertTrue(
            all(self.config[flag] is False for flag in FLAGS))
        runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
        self.app.run.assert_called_once()
        self.dependencies.assert_not_called()
        self.session.execute.assert_not_called()
        self.session.rollback.assert_called_once_with()
        self.session.commit.assert_not_called()
        self.app.logger.warning.assert_called_once()
        self.assertIs(self.config['REPORTS_HISTORY_ENABLED'], True)

    def test_cascade_dependency_disables_discard_without_changing_it(self):
        self.dependencies.side_effect = RuntimeError('CASCADE')
        runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
        self.assertTrue(all(self.config[flag] is False for flag in FLAGS))
        self.session.execute.assert_not_called()
        self.session.commit.assert_not_called()
        self.app.run.assert_called_once()

    def test_missing_effective_permission_does_not_enable_discard(self):
        self.session.execute.return_value.scalar.return_value = None
        runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
        self.assertTrue(all(self.config[flag] is False for flag in FLAGS))
        self.session.rollback.assert_called_once_with()
        self.session.commit.assert_not_called()
        self.app.run.assert_called_once()

    def test_read_or_rollback_failure_keeps_flags_off(self):
        for failure in ('execute', 'rollback'):
            with self.subTest(failure=failure):
                self.session.reset_mock(side_effect=True)
                getattr(self.session, failure).side_effect = RuntimeError('unavailable')
                runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
                self.assertTrue(all(self.config[flag] is False for flag in FLAGS))
                self.session.commit.assert_not_called()

    def test_import_does_not_enable_flags_change_cwd_or_start_a_server(self):
        before = dict(self.config)
        runpy.run_path(str(BACKEND / 'run_local.py'), run_name='local_import_only')
        self.assertEqual(self.config, before)
        self.assertEqual(Path.cwd(), self.cwd)
        self.app.run.assert_not_called()

    def test_existing_private_storage_requirement_is_preserved(self):
        self.config.pop('RETINOGRAPH_PRIVATE_DIR')
        with self.assertRaisesRegex(SystemExit, 'RETINOGRAPH_PRIVATE_DIR'):
            runpy.run_path(str(BACKEND / 'run_local.py'), run_name='__main__')
        self.app.run.assert_not_called()
        self.assertTrue(all(self.config[flag] is False for flag in FLAGS))

    def test_production_app_keeps_literal_safe_defaults(self):
        tree = ast.parse((BACKEND / 'app.py').read_text(encoding='utf-8'))
        defaults = {}
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if (isinstance(target, ast.Subscript) and
                        isinstance(target.slice, ast.Constant) and target.slice.value in FLAGS):
                    defaults[target.slice.value] = ast.literal_eval(node.value)
        self.assertEqual(defaults, {flag: False for flag in FLAGS})


if __name__ == '__main__':
    main()
