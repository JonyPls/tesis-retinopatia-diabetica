"""Manifiesto v2: solo ficheros propios, mocks de procesos/red y lectura de fuentes."""
from contextlib import ExitStack, redirect_stdout
from io import StringIO
import hashlib
import json
from pathlib import Path
import socket
import subprocess
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
from uuid import uuid4

from discard_mysql77 import safety
from discard_mysql_trial77 import main as cli


SOURCE = Path(__file__).resolve().parent
MANIFEST = SOURCE / 'trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json'


class Manifest78BTests(TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.process = self.stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('NO_PROCESS')))
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('NO_NETWORK')))
        self.stack.enter_context(patch.object(socket.socket, 'bind', side_effect=AssertionError('NO_PORT_RESERVATION')))
        self.parent = Path(self.stack.enter_context(TemporaryDirectory(prefix='codn78b-offline-', dir=safety.APPROVED_TEMP)))
        self.stack.enter_context(patch.object(safety, 'APPROVED_TEMP', self.parent))
        self.file = self.parent / 'manifest.json'
        server = self.parent / 'mysqld.exe'
        server.write_bytes(b'SYNTHETIC_NOT_EXECUTABLE')
        self.plan = safety.Plan(str(uuid4()), server, hashlib.sha256(server.read_bytes()).hexdigest(),
            safety.source_digest(SOURCE), '', safety.SCOPES, prepared_at_utc='2026-11-02T00:00:00Z')

    def document(self):
        plan = self.plan
        return {'manifest_version': safety.MANIFEST_VERSION, 'harness_version': safety.HARNESS_VERSION,
            'run_id': plan.run_id, 'prepared_at_utc': plan.prepared_at_utc,
            'authorization_status': 'NOT_AUTHORIZED', 'authorization': '',
            'mysql_server': str(plan.mysql_server), 'mysql_sha256': plan.mysql_sha256,
            'sources_sha256': plan.sources_sha256, 'scopes': list(safety.SCOPES),
            'resources': safety.planned_resources(plan)}

    def write(self, data=None):
        self.file.write_text(json.dumps(self.document() if data is None else data), encoding='utf-8')
        return self.file

    def test_roundtrip_is_explicitly_not_authorized_and_immutable(self):
        plan = safety.load_plan(self.write())
        self.assertEqual(plan.authorization_status, 'NOT_AUTHORIZED')
        self.assertEqual(plan.authorization, '')
        self.assertEqual(dict(plan.declared_resources), safety.planned_resources(plan))
        self.assertIsInstance(plan.declared_resources, tuple)

    def test_config_preflight_neither_creates_run_root_nor_reserves_port(self):
        self.write()
        with redirect_stdout(StringIO()) as output:
            self.assertEqual(cli(['--config', str(self.file)]), 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report['authorization_status'], 'NOT_AUTHORIZED')
        self.assertEqual(report['phase'], 'A_NO_CONNECTION')
        self.assertFalse(self.plan.root.exists())
        self.process.assert_not_called()

    def test_execute_with_matching_UUID_still_rejects_not_authorized_before_resources(self):
        self.write()
        with patch('discard_mysql77.runtime.OwnedTrial', side_effect=AssertionError('NO_RESOURCES')) as resources, \
                redirect_stdout(StringIO()) as output:
            self.assertEqual(cli(['--config', str(self.file), '--execute', '--authorize-run', self.plan.run_id]), 2)
        self.assertEqual(json.loads(output.getvalue())['code'], 'MANIFIESTO_NO_AUTORIZADO')
        resources.assert_not_called()
        self.process.assert_not_called()
        self.assertFalse(self.plan.root.exists())

    def test_each_resource_claim_is_verified_not_used_as_an_override(self):
        for key in self.document()['resources']:
            with self.subTest(resource=key):
                data = self.document()
                data['resources'][key] = 'UNAPPROVED_ALTERNATIVE'
                with self.assertRaises(safety.SafetyError):
                    safety.load_plan(self.write(data))

    def test_invalid_metadata_status_scope_and_extra_fields_fail_closed(self):
        mutations = [
            ('manifest_version', 99), ('manifest_version', True), ('harness_version', 'legacy'),
            ('prepared_at_utc', '2026-02-30T00:00:00Z'), ('prepared_at_utc', '2026-11-02'),
            ('authorization_status', 'CONTINUE'), ('scopes', list(safety.SCOPES[:-1])),
            ('password', 'SYNTHETIC_MUST_NOT_BE_ACCEPTED'), ('host', '127.0.0.1'),
            ('port', 3306), ('database', 'habitual'),
        ]
        for key, value in mutations:
            with self.subTest(field=key, value_type=type(value).__name__):
                data = self.document()
                data[key] = value
                with self.assertRaises(safety.SafetyError):
                    safety.load_plan(self.write(data))

    def test_duplicate_JSON_keys_are_rejected_including_nested_resources(self):
        raw = json.dumps(self.document())
        for changed in (raw.replace('"NOT_AUTHORIZED"', '"NOT_AUTHORIZED", "authorization_status": "AUTHORIZED"', 1),
                        raw.replace('"resources": {', '"resources": {"root":"UNAPPROVED",', 1)):
            self.file.write_text(changed, encoding='utf-8')
            with self.assertRaises(safety.SafetyError):
                safety.load_plan(self.file)

    def test_status_and_authorization_text_cannot_disagree(self):
        for status, marker in (('NOT_AUTHORIZED', 'UNAPPROVED'), ('AUTHORIZED', '')):
            data = self.document()
            data.update(authorization_status=status, authorization=marker)
            with self.assertRaises(safety.SafetyError):
                safety.load_plan(self.write(data))

    def test_authorized_label_alone_is_not_sufficient(self):
        data = self.document()
        data.update(authorization_status='AUTHORIZED', authorization='MISSING_EXTERNAL_APPROVAL')
        plan = safety.load_plan(self.write(data))
        with self.assertRaises(safety.SafetyError):
            safety.authorize(SOURCE, plan, plan.run_id)
        self.process.assert_not_called()

    def test_changed_hashes_fail_without_touching_the_run(self):
        for key in ('sources_sha256', 'mysql_sha256'):
            data = self.document()
            data[key] = '0' * 64
            with self.assertRaises(safety.SafetyError):
                safety.preflight(SOURCE, safety.load_plan(self.write(data)))
        self.assertFalse(self.plan.root.exists())

    def test_cli_launcher_is_now_bound_by_selected_source_digest(self):
        self.assertIn('discard_mysql_trial77.py', safety.COPY_FILES)
        self.assertEqual([p for p in safety.COPY_FILES if p.endswith('.sql')],
                         ['migrations/72_descarte_ia_propuesta.sql'])

    def test_consumed_repository_manifest_remains_historical_and_stale(self):
        data = json.loads(MANIFEST.read_text(encoding='utf-8'))
        self.assertEqual(data['authorization_status'], 'AUTHORIZED')
        self.assertEqual(data['scopes'], list(safety.SCOPES))
        self.assertEqual(data['run_id'], 'bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4')
        self.assertNotEqual(data['run_id'], 'cb377eb7-8057-43d8-a664-41a7838ed32e')
        self.assertEqual(data['sources_sha256'],
                         '95125f3383eeadebba5502dac530d6189fea7cca167ff36a97afdefbe48497aa')
        self.assertEqual(data['harness_version'], 'codn-discard-mysql77-78a-manifest-v2')
        self.assertNotEqual(data['harness_version'], safety.HARNESS_VERSION)
        self.assertNotEqual(data['sources_sha256'], safety.source_digest(SOURCE))
        self.assertFalse(any(key in data for key in ('password', 'jwt', 'DB_HOST', 'dsn')))


if __name__ == '__main__':
    main()
