"""78D: identidad/diagnóstico offline. Ningún proceso, Windows API nativa ni SQL."""
from contextlib import ExitStack, redirect_stdout
from io import StringIO
import ast
import ctypes
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch

from discard_mysql77 import process_identity as identity, resources, runtime, safety
from test_discard_mysql78a import FakeJob, FakeProcess


SOURCE = Path(__file__).resolve().parent


class Job(FakeJob):
    def contains(self, process):
        return process in self.members


def metadata(process, executable):
    return dict(handle_valid=True, handle_pid=process.pid, os_exit_code=259,
                executable_match=True, metadata_error_code=None, metadata_state='OK')


class Identity78DTests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.popen = self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('NO_NETWORK')))
        self.sql = Mock(side_effect=AssertionError('NO_SQL'))
        self.stack.enter_context(patch.dict(sys.modules, {
            'pymysql': SimpleNamespace(connect=self.sql, Connect=self.sql),
            'b1_mysql_disposable_trial': SimpleNamespace(free_loopback_port=lambda: 59991,
                                                        ensure_own_server=self.sql)}))
        self.native = self.stack.enter_context(patch.object(resources, 'windows_handle_metadata', side_effect=metadata))
        self.temp = Path(self.stack.enter_context(TemporaryDirectory(prefix='codn78d-offline-', dir=safety.APPROVED_TEMP)))
        self.trial = resources.OwnedTrial(self.temp / 'trial', 'offline', retirement_authorized=True, job_factory=Job)
        for name in ('data', 'evidence'):
            (self.trial.root / name).mkdir()
        self.exe = self.temp / 'server.fixture'
        self.exe.write_bytes(b'NOT_EXECUTABLE')
        self.process = FakeProcess()
        self.popen.side_effect = None
        self.popen.return_value = self.process
        self.trial.spawn(['NEVER_EXECUTED'], role='MYSQL')
        self.popen.side_effect = AssertionError('NO_PROCESS')
        self.pidfile = self.trial.root / 'mysql.pid'
        self.pidfile.write_text(str(self.process.pid), encoding='ascii')
        self.listener = Mock(return_value=self.process.pid)
        self.now = 0.0
        self.diagnostic = identity.StartupIdentity(self.trial, self.exe, self.trial.root / 'data',
                                                  self.pidfile, 59991, self.listener, clock=lambda: self.now)

    def reject(self, reason):
        with self.assertRaisesRegex(safety.SafetyError, '^' + reason + '$'):
            self.diagnostic.check(self.process, 'PRE_SQL')
        self.assertEqual(self.diagnostic.outcome, 'REJECTED')
        self.assertEqual(self.diagnostic.events[-1]['reason'], reason)
        self.sql.assert_not_called()

    def test_matching_pid_handle_job_executable_listener(self):
        self.diagnostic.check(self.process, 'PRE_SQL')
        event = self.diagnostic.events[-1]
        self.assertEqual(event['expected_pid'], event['handle_pid'])
        self.assertEqual(event['expected_pid'], event['pid_file_pid'])
        self.assertEqual(event['expected_pid'], event['listener_pid'])
        self.assertTrue(event['job_member'])
        self.assertEqual(self.diagnostic.outcome, 'VERIFIED')

    def test_different_and_foreign_numeric_pid_are_never_adopted(self):
        self.pidfile.write_text('9876\n', encoding='ascii')
        self.reject('PID_NO_COINCIDE')
        self.assertEqual(self.diagnostic.events[-1]['pid_file_pid'], 9876)
        self.assertTrue(all(call.args[0] is self.process for call in self.native.call_args_list))
        self.assertEqual(len(self.trial._processes), 1)

    def test_missing_pidfile_blocked_at_checkpoint(self):
        self.pidfile.unlink()
        self.reject('PIDFILE_MISSING')

    def test_empty_invalid_partial_and_non_ascii_pid_files(self):
        for content, reason in ((b'', 'PIDFILE_EMPTY'), (b'\n ', 'PIDFILE_EMPTY'),
                (b'12x', 'PIDFILE_INVALID'), (b'123\n456', 'PIDFILE_INVALID'),
                (b'\xff', 'PIDFILE_INVALID'), (b'0', 'PIDFILE_INVALID'),
                (b'4294967296', 'PIDFILE_INVALID'), (b'9' * 65, 'PIDFILE_INVALID')):
            with self.subTest(content_size=len(content)):
                self.pidfile.write_bytes(content)
                self.reject(reason)

    def test_numeric_partial_pid_is_rejected_without_wait(self):
        self.pidfile.write_bytes(b'123')
        wait = Mock()
        with self.assertRaisesRegex(safety.SafetyError, 'PID_NO_COINCIDE'):
            self.diagnostic.wait_ready(self.process, wait=wait)
        wait.assert_not_called()

    def test_terminated_process(self):
        self.process.returncode = 1
        self.reject('OWN_PROCESS_EXITED')
        self.assertEqual(self.diagnostic.events[-1]['returncode'], 1)

    def test_os_terminated_before_python_poll(self):
        self.native.side_effect = lambda p, e: dict(metadata(p, e), os_exit_code=1)
        self.reject('OWN_PROCESS_EXITED')

    def test_invalid_handle(self):
        self.native.side_effect = lambda p, e: dict(metadata(p, e), handle_valid=False, handle_pid=None)
        self.reject('OWN_HANDLE_INVALID')

    def test_handle_pid_mismatch(self):
        self.native.side_effect = lambda p, e: dict(metadata(p, e), handle_pid=999)
        self.reject('HANDLE_PID_MISMATCH')

    def test_wrong_job(self):
        self.trial._job.members.clear()
        self.reject('JOB_MEMBERSHIP_FAILED')

    def test_wrong_executable(self):
        self.native.side_effect = lambda p, e: dict(metadata(p, e), executable_match=False)
        self.reject('EXECUTABLE_MISMATCH')

    def test_identity_metadata_exception_and_api_failure(self):
        self.native.side_effect = OSError('SECRET_DSN_NEVER_RECORD')
        self.reject('PROCESS_METADATA_ERROR')
        self.assertEqual(self.diagnostic.events[-1]['pid_file_pid'], self.process.pid)
        self.native.side_effect = lambda p, e: dict(metadata(p, e), metadata_state='ERROR', metadata_error_code=5)
        self.reject('PROCESS_METADATA_ERROR')
        self.assertEqual(self.diagnostic.events[-1]['metadata_error_code'], 5)

    def test_job_metadata_error(self):
        with patch.object(self.trial._job, 'contains', side_effect=OSError('PRIVATE')):
            self.reject('PROCESS_METADATA_ERROR')

    def test_unregistered_handle_is_not_inspected(self):
        self.trial._processes.clear()
        self.native.reset_mock()
        self.reject('OWN_HANDLE_INVALID')
        self.native.assert_not_called()

    def test_listener_missing_foreign_or_metadata_failure(self):
        for pid, reason in ((None, 'LISTENER_NOT_READY'), (8888, 'LISTENER_MISMATCH')):
            self.listener.return_value = pid
            self.reject(reason)
        self.listener.side_effect = OSError('PRIVATE')
        self.reject('LISTENER_METADATA_ERROR')

    def test_foreign_listener_rejected_even_before_pidfile_without_wait(self):
        self.pidfile.unlink()
        self.listener.return_value = 8888
        wait = Mock()
        with self.assertRaisesRegex(safety.SafetyError, 'LISTENER_MISMATCH'):
            self.diagnostic.wait_ready(self.process, wait=wait)
        wait.assert_not_called()

    def test_wrong_paths_and_root_identity_blocked(self):
        self.diagnostic.datadir = self.trial.root / 'other'
        self.reject('CONFIGURED_PATH_MISMATCH')
        self.trial.marker.write_text('{}', encoding='utf-8')
        self.reject('ROOT_IDENTITY_ERROR')

    def test_pidfile_hardlink_and_read_error(self):
        alias = self.trial.root / 'alias'
        os.link(self.pidfile, alias)
        self.reject('PIDFILE_UNSAFE')
        alias.unlink()
        with patch.object(Path, 'open', side_effect=PermissionError('SECRET')):
            snapshot = identity.pid_snapshot(self.pidfile, self.trial.root)
        self.assertEqual(snapshot['pid_file_state'], 'READ_ERROR')

    def test_pidfile_replacement_during_read(self):
        original = os.fstat
        def changed(fd):
            info = original(fd)
            return SimpleNamespace(st_dev=info.st_dev, st_ino=info.st_ino, st_size=info.st_size + 1,
                                   st_mtime_ns=info.st_mtime_ns, st_nlink=info.st_nlink)
        with patch.object(os, 'fstat', side_effect=changed):
            self.reject('PIDFILE_CHANGED')

    def test_late_pidfile_and_listener_controlled_bounded_readiness(self):
        self.pidfile.unlink()
        self.listener.return_value = None
        waits = []
        def advance(delay):
            waits.append(delay)
            self.now += delay
            if len(waits) == 1: self.pidfile.write_bytes(b'')
            if len(waits) == 2: self.pidfile.write_text(str(self.process.pid), encoding='ascii')
            if len(waits) == 3: self.listener.return_value = self.process.pid
        self.diagnostic.wait_ready(self.process, timeout=1, wait=advance)
        self.assertEqual(waits, [0.05] * 3)
        self.assertEqual([e['reason'] for e in self.diagnostic.events],
            ['PIDFILE_MISSING', 'PIDFILE_EMPTY', 'LISTENER_NOT_READY', 'READY'])
        self.assertEqual(self.diagnostic.outcome, 'VERIFIED')

    def test_missing_or_empty_pidfile_times_out_without_relaunch(self):
        for empty in (False, True):
            with self.subTest(empty=empty):
                if empty: self.pidfile.write_bytes(b'')
                else: self.pidfile.unlink()
                self.diagnostic = identity.StartupIdentity(self.trial, self.exe, self.trial.root / 'data',
                    self.pidfile, 59991, self.listener, clock=lambda: self.now)
                def advance(delay): self.now += delay
                before = self.popen.call_count
                with self.assertRaisesRegex(safety.SafetyError, 'STARTUP_TIMEOUT'):
                    self.diagnostic.wait_ready(self.process, timeout=0.15, wait=advance)
                self.assertEqual(self.popen.call_count, before)
                self.assertLessEqual(len(self.diagnostic.events), 64)

    def test_readiness_after_deadline_is_not_accepted(self):
        def slow_listener(port):
            self.now = 2
            return self.process.pid
        self.diagnostic.listener = slow_listener
        with self.assertRaisesRegex(safety.SafetyError, 'STARTUP_TIMEOUT'):
            self.diagnostic.wait_ready(self.process, timeout=1)

    def test_sanitized_evidence_before_retirement_completed(self):
        self.pidfile.write_bytes(b'PASSWORD=SECRET_TOKEN;DSN=mysql://private')
        self.reject('PIDFILE_INVALID')
        self.diagnostic.write()
        artifact = self.trial.root / 'evidence/startup.json'
        before = json.loads(artifact.read_text(encoding='utf-8'))
        report = self.trial.retire()
        self.assertEqual(report['status'], 'COMPLETED')
        self.assertEqual(json.loads(artifact.read_text(encoding='utf-8')), before)
        self.assertNotIn('SECRET', artifact.read_text(encoding='utf-8'))
        self.assertFalse(self.pidfile.exists())
        self.assertTrue(self.process.terminated)
        self.assertEqual(report['evidence_rejected'], [])

    def test_sanitizer_rejects_extra_fields_and_stringified_numbers(self):
        self.diagnostic.check(self.process, 'PRE_SQL')
        self.diagnostic.write()
        path = self.trial.root / 'evidence/startup.json'
        value = json.loads(path.read_text(encoding='utf-8'))
        value['events'][0]['expected_pid'] = 'SECRET'
        with self.assertRaises(safety.SafetyError): identity.sanitize_startup(value)
        value['events'][0]['expected_pid'] = self.process.pid
        value['password'] = 'SECRET'
        path.write_text(json.dumps(value), encoding='utf-8')
        report = self.trial.retire()
        self.assertEqual(report['status'], 'COMPLETED')
        self.assertEqual(report['evidence_rejected'], ['untrusted_artifact'])
        self.assertFalse(path.exists())

    def test_incomplete_retirement_preserves_evidence_without_deleting_live_tree(self):
        self.diagnostic.check(self.process, 'PRE_SQL')
        self.diagnostic.write()
        with patch.object(self.trial._job, 'stop', side_effect=OSError('SECRET')):
            report = self.trial.retire()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertIn('owned_processes_and_private_tree', report['pending'])
        self.assertTrue(self.pidfile.exists())
        self.assertTrue((self.trial.root / 'evidence/startup.json').exists())
        self.assertEqual(self.trial.retire()['status'], 'COMPLETED')

    def test_event_history_is_bounded_and_retains_first_and_last(self):
        for index in range(200):
            self.now += 0.05
            self.listener.return_value = self.process.pid if index % 2 else None
            self.diagnostic.record(self.diagnostic.observe(self.process, 'STARTUP_WAIT'))
        self.assertEqual(len(self.diagnostic.events), 64)
        self.assertEqual(self.diagnostic.events[0]['elapsed_ms'], 50)
        self.assertEqual(self.diagnostic.events[-1]['reason'], 'READY')

    def test_checkpoint_stages_and_sql_identity_distinguished(self):
        self.diagnostic.check(self.process, 'PRE_SQL')
        self.diagnostic.sql_identity_verified = True
        self.diagnostic.check(self.process, 'POST_PROVISION')
        self.diagnostic.check(self.process, 'POST_WORKER')
        self.assertEqual([e['stage'] for e in self.diagnostic.events],
                         ['PRE_SQL', 'POST_PROVISION', 'POST_WORKER'])
        self.assertFalse(self.diagnostic.events[0]['sql_identity_verified'])
        self.assertTrue(self.diagnostic.events[-1]['sql_identity_verified'])

    def test_worker_comparison_captures_original_snapshot_without_process_lookup(self):
        self.pidfile.write_bytes(b'9876\n')
        with self.assertRaises(identity.WorkerPidError) as caught:
            identity.check_worker_pid(self.pidfile, self.trial.root, self.process.pid, identity.time.monotonic())
        self.pidfile.write_bytes(b'12345\n')
        failure = resources.sanitized_json('failure.json', json.dumps({
            'error_class': 'WorkerPidError', 'mysql_code': None, 'worker_pid': caught.exception.pid_evidence}))
        self.assertEqual(failure['worker_pid']['pid_file_pid'], 9876)
        self.assertEqual(failure['worker_pid']['reason'], 'PID_NO_COINCIDE')
        identity.check_worker_pid(self.pidfile, self.trial.root, self.process.pid, identity.time.monotonic())

    def test_worker_pid_states_and_sanitization(self):
        for raw, reason in ((b'', 'PIDFILE_EMPTY'), (b'SECRET', 'PIDFILE_INVALID')):
            self.pidfile.write_bytes(raw)
            with self.assertRaisesRegex(identity.WorkerPidError, reason) as caught:
                identity.check_worker_pid(self.pidfile, self.trial.root, self.process.pid, identity.time.monotonic())
            self.assertNotIn('SECRET', json.dumps(caught.exception.pid_evidence))
        self.pidfile.unlink()
        with self.assertRaisesRegex(identity.WorkerPidError, 'PIDFILE_MISSING'):
            identity.check_worker_pid(self.pidfile, self.trial.root, self.process.pid, identity.time.monotonic())

    def test_worker_main_persists_pid_rejection_and_retirement_keeps_it(self):
        from discard_mysql77 import worker
        run_id = '11111111-1111-4111-8111-111111111111'
        trial = resources.OwnedTrial(self.temp / ('codn77-' + run_id), run_id,
                                    retirement_authorized=True, job_factory=Job)
        (trial.root / 'evidence').mkdir()
        (trial.root / 'mysql.pid').write_bytes(b'9876\n')
        payload = dict(root=str(trial.root), run_id=run_id, owner=trial.owner, pid=12345)
        with patch.object(safety, 'APPROVED_TEMP', self.temp), patch.object(sys, 'stdin', StringIO(json.dumps(payload))):
            self.assertEqual(worker.main(), 1)
        self.assertEqual(trial.retire()['status'], 'COMPLETED')
        failure = json.loads((trial.root / 'evidence/failure.json').read_text(encoding='utf-8'))
        self.assertEqual(failure['worker_pid']['expected_pid'], 12345)
        self.assertEqual(failure['worker_pid']['pid_file_pid'], 9876)
        self.sql.assert_not_called()

    def runtime_failure(self, kind='mismatch', *, incomplete=False, write_error=False):
        root = self.temp / ('runtime-' + kind)
        plan = SimpleNamespace(root=root, run_id='offline', mysql_server=self.exe,
                               mysql_sha256=hashlib.sha256(self.exe.read_bytes()).hexdigest(), sources_sha256='offline')
        trial = resources.OwnedTrial(root, 'offline', retirement_authorized=True, job_factory=Job)
        processes = []
        def create(command, **options):
            if '--initialize-insecure' not in command and kind == 'spawn': raise OSError('SECRET')
            process = FakeProcess()
            processes.append(process)
            if '--initialize-insecure' not in command:
                self.assertIn('--no-monitor', command)
                self.assertEqual(command[1], '--no-defaults')
                (root / 'mysql.pid').write_bytes(b'9876\n')
            return process
        if kind == 'initialize':
            def initialize(command, **options):
                process = FakeProcess()
                process.communicate = lambda **kwargs: ('', '')
                process.returncode = 1
                return process
            create = initialize
        def factory():
            job = Job()
            original = job.assign
            def assign(process):
                if len(job.members) == 1 and kind == 'assignment': raise OSError('SECRET')
                original(process)
            job.assign = assign
            if incomplete: job.stop = Mock(side_effect=OSError('SECRET'))
            return job
        trial._job_factory = factory
        with ExitStack() as stack:
            stack.enter_context(patch.object(runtime, 'authorize'))  # Solo doble offline, ningún manifiesto/token.
            stack.enter_context(patch.object(runtime, 'OwnedTrial', return_value=trial))
            stack.enter_context(patch.object(runtime, 'private_acl'))
            stack.enter_context(patch.object(runtime, 'copy_sources', return_value=root / 'backend'))
            stack.enter_context(patch.object(runtime, 'listener_pid', return_value=12345))
            stack.enter_context(patch.object(subprocess, 'Popen', side_effect=create))
            if write_error:
                stack.enter_context(patch.object(identity.StartupIdentity, 'write', side_effect=OSError('SECRET')))
            output = stack.enter_context(redirect_stdout(StringIO()))
            with self.assertRaises(safety.SafetyError) as caught:
                runtime.execute(SOURCE, plan, None)
        self.sql.assert_not_called()
        self.assertNotIn('SECRET', output.getvalue())
        return trial, json.loads(output.getvalue()), str(caught.exception)

    def test_runtime_mismatch_records_before_retirement_without_sql(self):
        trial, report, reason = self.runtime_failure()
        self.assertEqual(reason, 'PID_NO_COINCIDE')
        self.assertEqual(report['status'], 'COMPLETED')
        evidence = json.loads((trial.root / 'evidence/startup.json').read_text(encoding='utf-8'))
        self.assertEqual(evidence['events'][-1]['pid_file_pid'], 9876)
        self.assertEqual(evidence['reason'], reason)
        self.assertFalse((trial.root / 'mysql.pid').exists())

    def test_runtime_spawn_assignment_and_initialize_failures_are_diagnosed(self):
        for kind, expected in (('spawn', 'SPAWN_FAILED'), ('assignment', 'JOB_ASSIGNMENT_FAILED'),
                               ('initialize', 'INITIALIZE_FAILED')):
            with self.subTest(kind=kind):
                trial, report, reason = self.runtime_failure(kind)
                self.assertEqual(report['status'], 'COMPLETED')
                evidence = json.loads((trial.root / 'evidence/startup.json').read_text(encoding='utf-8'))
                self.assertEqual(evidence['reason'], expected)
                if kind == 'assignment':
                    self.assertEqual(evidence['events'][-1]['job_assignment'], 'FAILED')

    def test_runtime_incomplete_does_not_hide_original_rejection(self):
        trial, report, reason = self.runtime_failure(incomplete=True)
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertEqual(reason, 'PID_NO_COINCIDE')
        self.assertTrue((trial.root / 'evidence/startup.json').exists())
        trial._job.stop = lambda: [p.terminate() for p in trial._processes]
        self.assertEqual(trial.retire()['status'], 'COMPLETED')

    def test_evidence_write_failure_does_not_skip_retirement_or_mask_rejection(self):
        trial, report, reason = self.runtime_failure(write_error=True)
        self.assertFalse(report['startup_evidence_written'])
        self.assertEqual(report['status'], 'COMPLETED')
        self.assertEqual(reason, 'PID_NO_COINCIDE')

    def test_no_monitor_regression_and_identity_module_in_source_digest(self):
        tree = ast.parse((SOURCE / 'discard_mysql77/runtime.py').read_text(encoding='utf-8'))
        spawns = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and
                  isinstance(n.func, ast.Attribute) and n.func.attr == 'spawn']
        self.assertEqual(len(spawns), 1)
        self.assertIn('--no-monitor', [n.value for n in ast.walk(spawns[0]) if isinstance(n, ast.Constant)])
        self.assertIn('discard_mysql77/process_identity.py', safety.COPY_FILES)

    def test_native_metadata_only_own_handle_with_fake_windows_api(self):
        # WinDLL completamente simulado: no se llama al SO ni a procesos reales.
        kernel = SimpleNamespace(GetProcessId=Mock(return_value=12345),
            GetExitCodeProcess=Mock(), QueryFullProcessImageNameW=Mock())
        def exit_code(handle, pointer):
            pointer._obj.value = 259
            return True
        def image_name(handle, flags, buffer, size):
            buffer.value = str(self.exe)
            return True
        kernel.GetExitCodeProcess.side_effect = exit_code
        kernel.QueryFullProcessImageNameW.side_effect = image_name
        process = SimpleNamespace(_handle=101)
        with patch.object(ctypes, 'WinDLL', return_value=kernel):
            result = identity.windows_handle_metadata(process, self.exe)
            self.assertTrue(result['handle_valid'])
            self.assertTrue(result['executable_match'])
            kernel.GetProcessId.assert_called_with(101)
            kernel.GetProcessId.return_value = 0
            with patch.object(ctypes, 'get_last_error', return_value=6):
                result = identity.windows_handle_metadata(process, self.exe)
            self.assertFalse(result['handle_valid'])
            self.assertEqual(result['metadata_state'], 'OK')
            kernel.GetProcessId.return_value = 12345
            kernel.QueryFullProcessImageNameW.side_effect = None
            kernel.QueryFullProcessImageNameW.return_value = False
            with patch.object(ctypes, 'get_last_error', return_value=5):
                result = identity.windows_handle_metadata(process, self.exe)
            self.assertEqual(result['metadata_state'], 'ERROR')
            self.assertEqual(result['metadata_error_code'], 5)

    def test_windows_job_membership_api_uses_exact_owned_job_and_handle(self):
        job = resources.WindowsJob.__new__(resources.WindowsJob)
        job.handle = 202
        job.kernel = SimpleNamespace(IsProcessInJob=Mock())
        def member(handle, job_handle, pointer):
            self.assertEqual((handle, job_handle), (101, 202))
            pointer._obj.value = True
            return True
        job.kernel.IsProcessInJob.side_effect = member
        self.assertTrue(job.contains(SimpleNamespace(_handle=101)))
        job.kernel.IsProcessInJob.side_effect = None
        job.kernel.IsProcessInJob.return_value = False
        with self.assertRaisesRegex(safety.SafetyError, 'JOB_PERTENENCIA_NO_VERIFICADA'):
            job.contains(SimpleNamespace(_handle=101))


if __name__ == '__main__':
    main()
