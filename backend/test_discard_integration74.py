"""Verificación 74: solo Flask propio, SQLite en memoria y archivos temporales.

No importa app.py/init_db ni conecta a MySQL. El fixture compartido se obtiene
del JSON HTTP real, no de una segunda implementación del contrato.
"""
import json
from contextlib import ExitStack
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

with patch('dotenv.load_dotenv', return_value=False):
    import test_diagnosis_discard as fixtures
    from database import db
    from services import diagnosis_discard_service as service
    from src.models.diagnosis_entities import DiagnosticoDetalle, Diagnostico
    from src.models.informe_entities import Informe
    from utils import diagnosis_discard_storage as storage
    from utils.retinograph_storage import UnsafeExportError


CONTRACT = Path(__file__).resolve().parents[1] / 'frontend/src/test/fixtures/diagnosisDiscardContract74.json'
OPERATION = '11111111-1111-4111-8111-111111111111'
SECOND = '22222222-2222-4222-8222-222222222222'
PREFIX = '/api/diagnosticar/visita/30'


def serialized_contract(f):
    """Las únicas normalizaciones son fechas variables, conservando su formato."""
    client = f.app.test_client()
    profile = fixtures.user({'OFTALMOLOGO': (*fixtures.GRANTS, 'informes.crear')})
    headers = {'Authorization': 'Bearer synthetic'}

    def response(method, path, body=None):
        value = client.open(path, method=method, json=body, headers=headers)
        assert value.headers.get('Cache-Control') == 'private, no-store'
        data = value.get_json()

        def normalize(node):
            if isinstance(node, dict):
                for key, child in node.items():
                    if key == 'fecha_utc':
                        fixtures.datetime.fromisoformat(child.replace('Z', '+00:00'))
                        assert child.endswith('Z') and len(child) == 27
                        node[key] = '2026-11-01T00:00:00.000000Z'
                    else:
                        normalize(child)
            elif isinstance(node, list):
                for child in node:
                    normalize(child)
        normalize(data)
        return {'status': value.status_code, 'body': data}

    request = f.payload(operacion_id=OPERATION)
    with patch('utils.security.jwt.decode', return_value={'user_id': 1, 'exp': 9999999999}), \
            patch('utils.security.AuthRepository.get_active_user_with_permissions_by_id', return_value=profile) as auth:
        result = {'request': request}
        result['context'] = response('GET', PREFIX + '/contexto-descarte')
        result['revisionBefore'] = response('GET', '/api/visitas/30/revision-inferencia')
        result['unconfirmed'] = response('GET', PREFIX + '/operaciones-descarte/' + OPERATION)
        result['invalid'] = response('POST', PREFIX + '/descartar-resultados', {**request, 'confirmo_descarte': 1})
        result['discard'] = response('POST', PREFIX + '/descartar-resultados', request)
        result['operation'] = response('GET', PREFIX + '/operaciones-descarte/' + OPERATION)
        result['repeated'] = response('POST', PREFIX + '/descartar-resultados', request)
        result['remaining'] = response('GET', PREFIX + '/contexto-descarte')
        result['revisionAfter'] = response('GET', '/api/visitas/30/revision-inferencia')
        result['conflict'] = response('POST', PREFIX + '/descartar-resultados', {**request, 'operacion_id': SECOND})
        auth.return_value = fixtures.user({'OFTALMOLOGO': fixtures.GRANTS[:-1]})
        result['forbidden'] = response('GET', PREFIX + '/contexto-descarte')
        auth.return_value = profile
        f.app.config['DIAGNOSIS_DISCARD_SCHEMA_VERIFIED'] = False
        result['unavailable'] = response('GET', PREFIX + '/contexto-descarte')
        f.app.config['DIAGNOSIS_DISCARD_SCHEMA_VERIFIED'] = True
        result['lastDiscard'] = response('POST', PREFIX + '/descartar-resultados',
                                         f.payload([11], operacion_id=SECOND, revision_esperada=1))
        result['emptyVisit'] = response('GET', PREFIX + '/contexto-descarte')
        # Mantenimiento explícito únicamente sobre TemporaryDirectory de este fixture.
        assert service.clean_operation(OPERATION)[1] == 200
        result['cleaned'] = response('GET', PREFIX + '/operaciones-descarte/' + OPERATION)
        return result


class Integration74Tests(TestCase):
    def setUp(self):
        # Defensa adicional antes de cargar cualquier fixture con persistencia.
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch('pymysql.connect', side_effect=AssertionError('MySQL prohibido')))
        self.f = fixtures.DiscardTest()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        self.assertEqual(db.engine.url.drivername, 'sqlite')
        self.assertIn(db.engine.url.database, (None, '', ':memory:'))

    def test_real_http_serialization_matches_shared_frontend_fixture(self):
        actual = serialized_contract(self.f)
        self.assertEqual(actual, json.loads(CONTRACT.read_text(encoding='utf-8')))

    def test_mysql_technical_metadata_matches_proposal_without_executing_ddl(self):
        from sqlalchemy.schema import CreateTable
        from sqlalchemy.dialects import mysql
        from src.models.diagnosis_discard_entities import RevisionInferenciaVisita, OperacionDescarteIA
        revision = str(CreateTable(RevisionInferenciaVisita.__table__).compile(dialect=mysql.dialect()))
        operation = str(CreateTable(OperacionDescarteIA.__table__).compile(dialect=mysql.dialect()))
        self.assertIn('revision BIGINT UNSIGNED NOT NULL DEFAULT 0', revision)
        self.assertIn('autor_id INTEGER UNSIGNED NOT NULL', operation)
        self.assertIn('CHARACTER SET ascii COLLATE ascii_bin', operation)
        self.assertIn("DEFAULT 'PENDIENTE'", operation)
        self.assertTrue(all('ENGINE=InnoDB' in ddl for ddl in (revision, operation)))
        proposal = Path(__file__).with_name('migrations').joinpath('72_descarte_ia_propuesta.sql').read_text(encoding='utf-8')
        for fragment in ('autor_id INT UNSIGNED NOT NULL', 'CHARACTER SET ascii COLLATE ascii_bin',
                         'revision BIGINT UNSIGNED NOT NULL DEFAULT 0', "DEFAULT 'PENDIENTE'", 'ENGINE=InnoDB'):
            self.assertIn(fragment, proposal)

    def test_each_validation_state_preserves_all_other_eye_fields(self):
        for corrected in (False, True):
            with self.subTest(corrected=corrected):
                self.f.validated(corrected=corrected)
                before = {c.name: getattr(db.session.get(DiagnosticoDetalle, 11), c.name)
                          for c in DiagnosticoDetalle.__table__.columns}
                response, status = self.f.discard()
                self.assertEqual(status, 200, response)
                self.assertEqual({c: getattr(db.session.get(DiagnosticoDetalle, 11), c) for c in before}, before)
                self.assertEqual(db.session.get(Diagnostico, 9).estado, 'VALIDADO')
                # Restablecer SOLO el fixture en memoria para el siguiente subcaso.
                self.f.detail(12, 'Izquierdo')
                self.f.update(Diagnostico, 9, estado='PROCESADO')
                db.session.execute(fixtures.RevisionInferenciaVisita.__table__.delete())
                db.session.commit()

    def test_mixed_retinograph_batch_is_atomic_and_private_copy_untouched(self):
        private = Path(self.f.temp.name, 'private-retinograph-synthetic.bin')
        private.write_bytes(b'private-copy-never-targeted')
        self.f.insert(fixtures.ConfirmacionExportacionRetinografo, id=1, token_verificador=b'a' * 32,
                      paciente_id=7, confirmado_por=1, ojo_confirmado='Izquierdo', nombre_exportacion='synthetic',
                      sha256_fuente='a' * 64, clave_copia='b' * 32, estado='CONSUMIDA', detalle_id=12)
        db.session.commit()
        before = {p.name: p.read_bytes() for p in Path(self.f.temp.name).iterdir()}
        result, status = self.f.discard(self.f.payload([11, 12]))
        self.assertEqual(status, 409, result)
        self.assertEqual(self.f.ids(), [11, 12])
        self.assertEqual(before, {p.name: p.read_bytes() for p in Path(self.f.temp.name).iterdir()})

    def test_report_blocks_discard_without_touching_document_or_files(self):
        self.f.insert(Informe, id=1, visita_id=30, usuario_id=1, tipo_informe_id=1,
                      estado='ACTIVO', datos_estructurados={'nota': 'Sintética'})
        db.session.commit()
        before = set(Path(self.f.temp.name).iterdir())
        self.assertEqual(self.f.discard()[0]['code'], 'INFORMES_EXISTENTES')
        self.assertEqual(db.session.get(Informe, 1).datos_estructurados, {'nota': 'Sintética'})
        self.assertEqual(before, set(Path(self.f.temp.name).iterdir()))

    def test_report_revision_check_and_insert_share_transaction_until_commit(self):
        from services import informe_service as reports
        payload = {'paciente_id': 7, 'tipo_informe_id': 1, 'visita_id': 30,
                   'revision_inferencia_esperada': 0, 'datos_estructurados': {'nota': 'Sintética'}}

        def create(**values):
            check.assert_called_once_with(30, 0)
            commit.assert_not_called()
            self.assertTrue(db.session().in_transaction())
            self.f.insert(Informe, id=1, estado='ACTIVO', **values)
            return 1

        with patch.object(reports.DiagnosisDiscardRepository, 'check_report', wraps=fixtures.Repo.check_report) as check, \
                patch.object(db.session, 'commit', wraps=db.session.commit) as commit, \
                patch.object(reports.InformeRepository, 'validar_paciente'), \
                patch.object(reports.InformeRepository, 'validar_visita'), \
                patch.object(reports.InformeRepository, 'obtener_tipo_informe_por_id', return_value={'schema_version_actual': 1}), \
                patch.object(reports.InformeRepository, 'crear_informe', side_effect=create), \
                patch.object(reports.InformeRepository, 'crear_version_inicial'):
            result, status = reports.crear_nuevo_informe(payload, 1)
            self.assertEqual(status, 201, result)
            commit.assert_called_once_with()
        self.assertEqual(self.f.discard()[0]['code'], 'INFORMES_EXISTENTES')

    def test_manual_other_eye_preserves_every_column(self):
        before = {c.name: getattr(db.session.get(DiagnosticoDetalle, 11), c.name)
                  for c in DiagnosticoDetalle.__table__.columns}
        self.assertEqual(self.f.discard()[1], 200)
        self.assertEqual({c: getattr(db.session.get(DiagnosticoDetalle, 11), c) for c in before}, before)

    def test_lost_ack_keeps_uuid_server_side_but_fresh_inference_is_not_a_reconciliation(self):
        request = self.f.payload(operacion_id=OPERATION)
        old_revision = fixtures.Repo.capture_inference(30)
        db.session.rollback()
        commit = db.session.commit
        def lost_ack():
            commit()
            raise RuntimeError('synthetic response lost')
        with patch.object(db.session, 'commit', side_effect=lost_ack):
            self.assertEqual(self.f.discard(request)[0]['code'], 'PERSISTENCIA_INCIERTA')
        response, status = service.operation_status(30, 1, OPERATION)
        self.assertEqual(status, 200)
        self.assertEqual(response['data']['conciliacion'], 'CONFIRMADA')
        with self.assertRaises(fixtures.DiscardError):
            fixtures.Repo.check_inference(30, old_revision)
        db.session.rollback()
        # Una captura NUEVA es válida aunque el navegador haya perdido el UUID.
        # La revisión no garantiza recuperar el estado operativo de la interfaz.
        fresh_revision = fixtures.Repo.capture_inference(30)
        self.assertEqual(fresh_revision, 1)
        fixtures.Repo.check_inference(30, fresh_revision)
        self.assertIsNotNone(fixtures.Repo.operation(OPERATION))
        db.session.rollback()

    def test_absent_file_cleanup_and_retry_never_touch_another_file(self):
        request = self.f.payload()
        self.assertEqual(self.f.discard(request)[1], 200)
        entries = fixtures.Repo.operation(request['operacion_id']).archivos
        Path(self.f.temp.name, entries[0]['nombre']).unlink()  # Solo sintético.
        self.assertEqual(service.clean_operation(request['operacion_id'])[0]['data']['limpieza'], 'COMPLETADA')
        self.assertEqual(service.clean_operation(request['operacion_id'])[1], 200)
        self.assertTrue(Path(self.f.temp.name, db.session.get(DiagnosticoDetalle, 11).imagen_original_url).exists())

    def test_hardlink_identity_is_not_eligible_for_deletion(self):
        import os
        name = 'P7_Derecho_' + 'a' * 32 + '.jpg'
        original = Path(self.f.temp.name, name)
        original.write_bytes(b'synthetic')
        alias = Path(self.f.temp.name, 'synthetic-hardlink')
        os.link(original, alias)
        with self.assertRaises(ValueError):
            storage.snapshot(self.f.temp.name, name)
        self.assertEqual(alias.read_bytes(), b'synthetic')

    def test_symlink_is_not_followed(self):
        import os
        target = Path(self.f.temp.name, 'synthetic-target')
        target.write_bytes(b'never-delete-target')
        name = 'P7_Derecho_' + 'c' * 32 + '.jpg'
        original = Path(self.f.temp.name, name)
        original.write_bytes(b'synthetic-original')
        entry = storage.snapshot(self.f.temp.name, name)
        original.unlink()
        try:
            os.symlink(target, Path(self.f.temp.name, name))
        except OSError as error:
            self.skipTest(f'Creación de symlink no permitida por el SO: {error.errno}')
        with self.assertRaises((ValueError, OSError, UnsafeExportError)):
            storage.snapshot(self.f.temp.name, name)
        with self.assertRaises((ValueError, OSError, UnsafeExportError)):
            storage.remove_verified(self.f.temp.name, entry)
        self.assertEqual(target.read_bytes(), b'never-delete-target')

    def test_revoked_permission_and_inactive_user_are_denied_at_http_boundary(self):
        client = self.f.app.test_client()
        inactive = fixtures.user()
        inactive.estado = 'INACTIVO'
        revoked = fixtures.user()
        revoked.roles_rel[0].rol.permisos_rel[-1].permiso.estado = 'INACTIVO'
        for profile in (inactive, revoked, fixtures.user({'ADMINISTRADOR_SISTEMA': fixtures.GRANTS}),
                        fixtures.user({'OFTALMOLOGO': fixtures.GRANTS[:-1], 'ADMINISTRADOR_SISTEMA': fixtures.GRANTS})):
            with self.subTest(profile=profile), \
                    patch('utils.security.jwt.decode', return_value={'user_id': 1, 'exp': 9999999999}), \
                    patch('utils.security.AuthRepository.get_active_user_with_permissions_by_id', return_value=profile):
                result = client.post(PREFIX + '/descartar-resultados', json=self.f.payload(),
                                     headers={'Authorization': 'Bearer synthetic'})
                self.assertIn(result.status_code, (401, 403))
                self.assertEqual(self.f.ids(), [11, 12])


if __name__ == '__main__':
    main()
