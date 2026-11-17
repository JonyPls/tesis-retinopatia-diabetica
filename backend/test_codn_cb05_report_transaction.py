"""CB-05: service transaction decisions, not physical MySQL atomicity."""
import unittest
from unittest.mock import Mock, call
from flask import Flask
from sqlalchemy.exc import DBAPIError, IntegrityError
from codn_test_support import report_target, NotFound, Conflict

service = report_target()


def integrity(code=1062, index='uq_informes_visita_tipo'):
    return IntegrityError('synthetic statement', {}, Exception(code, index))


class ReportTransactionTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config['DIAGNOSIS_DISCARD_ENABLED'] = False
        ctx = app.app_context()
        ctx.push()
        self.addCleanup(ctx.pop)
        self.logger = app.logger
        self.repo, self.db = service.InformeRepository, service.db
        self.repo.reset_mock(return_value=True, side_effect=True)
        self.db.reset_mock(return_value=True, side_effect=True)
        self.repo.obtener_tipo_informe_por_id.return_value = {'schema_version_actual': 2}
        self.repo.crear_visita.return_value = 901
        self.repo.crear_informe.return_value = 701
        self.order = Mock()
        for name in ['validar_paciente', 'obtener_tipo_informe_por_id', 'validar_visita',
                     'crear_visita', 'crear_informe', 'crear_version_inicial']:
            self.order.attach_mock(getattr(self.repo, name), name)
        self.order.attach_mock(self.db.session.commit, 'commit')
        self.order.attach_mock(self.db.session.rollback, 'rollback')

    def payload(self, **changes):
        data = dict(paciente_id=501, tipo_informe_id=4,
                    datos_estructurados={'ojos': ['OD'], 'valores': {'od': 540}, 'conclusion': ['  Sintético  ', 'Control']})
        data.update(changes)
        return data

    def create(self, **changes):
        return service.crear_nuevo_informe(self.payload(**changes), 42)

    def expected_insert(self, visit=901):
        return call.crear_informe(visita_id=visit, tipo_informe_id=4, usuario_id=42,
            datos_estructurados=self.payload()['datos_estructurados'], conclusion='Sintético\nControl', schema_version=2)

    def test_new_visit_exact_order_identifiers_and_single_commit(self):
        response, status = self.create()
        self.assertEqual(status, 201)
        self.assertEqual(response['data'], {'id': 701, 'visita_id': 901, 'diagnostico_id': 901})
        self.assertEqual(self.order.mock_calls, [call.validar_paciente(501), call.obtener_tipo_informe_por_id(4),
            call.crear_visita(501, 42), self.expected_insert(), call.crear_version_inicial(701, 42), call.commit()])
        self.db.session.rollback.assert_not_called()

    def test_existing_visit_does_not_create_visit(self):
        response, status = self.create(visita_id=902)
        self.assertEqual(status, 201)
        self.assertEqual(response['data']['visita_id'], 902)
        self.assertEqual(self.order.mock_calls, [call.validar_paciente(501), call.obtener_tipo_informe_por_id(4),
            call.validar_visita(902, 501), self.expected_insert(902), call.crear_version_inicial(701, 42), call.commit()])
        self.repo.crear_visita.assert_not_called()

    def test_missing_resources_and_foreign_visit_stop_subsequent_operations(self):
        for mode in ['patient', 'type', 'visit_missing', 'visit_foreign']:
            with self.subTest(resource=mode):
                self.repo.reset_mock(return_value=False, side_effect=True)
                self.db.reset_mock(return_value=True, side_effect=True)
                self.repo.obtener_tipo_informe_por_id.return_value = None if mode == 'type' else {'schema_version_actual': 2}
                if mode == 'patient':
                    self.repo.validar_paciente.side_effect = NotFound()
                elif mode.startswith('visit'):
                    self.repo.validar_visita.side_effect = NotFound()
                response, status = self.create(visita_id=902)
                self.assertEqual(status, 404)
                self.assertEqual(response['message'], 'Recurso no encontrado.')
                self.repo.crear_visita.assert_not_called()
                self.repo.crear_informe.assert_not_called()
                self.repo.crear_version_inicial.assert_not_called()
                self.db.session.commit.assert_not_called()
                self.db.session.rollback.assert_called_once_with()
                if mode == 'patient':
                    self.repo.obtener_tipo_informe_por_id.assert_not_called()
                if mode.startswith('visit'):
                    self.repo.validar_visita.assert_called_once_with(902, 501)

    def test_duplicate_classifier_requires_exact_mysql_code_and_named_index(self):
        for error, expected in [(integrity(), True), (integrity(9999), False),
                                (integrity(index='other_index'), False), (Exception(), False),
                                (IntegrityError('', {}, Exception(1062)), False)]:
            with self.subTest(original=str(error.orig) if hasattr(error, 'orig') else 'no original'):
                self.assertEqual(service._is_duplicate_report(error), expected)

    def test_duplicate_conflict_and_known_integrity_never_retry_or_commit(self):
        for error in [Conflict(), integrity()]:
            with self.subTest(error=type(error).__name__):
                self.repo.reset_mock()
                self.db.reset_mock(return_value=True, side_effect=True)
                self.repo.crear_informe.side_effect = error
                _, status = self.create(visita_id=902)
                self.assertEqual(status, 409)
                self.repo.crear_informe.assert_called_once()
                self.repo.crear_version_inicial.assert_not_called()
                self.db.session.commit.assert_not_called()
                self.db.session.rollback.assert_called_once_with()

    def test_precommit_failure_at_each_write_rolls_back_without_retry(self):
        for stage in ['crear_visita', 'crear_informe', 'crear_version_inicial']:
            with self.subTest(stage=stage):
                self.repo.reset_mock(return_value=False, side_effect=True)
                self.db.reset_mock(return_value=True, side_effect=True)
                getattr(self.repo, stage).side_effect = RuntimeError('synthetic-private-detail')
                response, status = self.create()
                self.assertEqual(status, 500)
                self.assertEqual(response['message'], 'No se pudo procesar la solicitud.')
                self.assertNotIn('synthetic-private-detail', str(response))
                getattr(self.repo, stage).assert_called_once()
                self.db.session.commit.assert_not_called()
                self.db.session.rollback.assert_called_once_with()
                if stage != 'crear_version_inicial':
                    self.repo.crear_version_inicial.assert_not_called()
                if stage == 'crear_visita':
                    self.repo.crear_informe.assert_not_called()

    def test_unrecognized_integrity_and_dbapi_before_commit_are_generic(self):
        for error in [integrity(index='other_index'), integrity(code=9999),
                      DBAPIError('synthetic statement', {}, Exception('synthetic-private-detail'))]:
            with self.subTest(error=type(error).__name__, original=str(error.orig)):
                self.repo.reset_mock()
                self.db.reset_mock(return_value=True, side_effect=True)
                self.repo.crear_informe.side_effect = error
                response, status = self.create()
                self.assertEqual(status, 500)
                self.assertEqual(response, {'success': False, 'message': 'No se pudo procesar la solicitud.'})
                self.db.session.rollback.assert_called_once_with()
                self.db.session.commit.assert_not_called()
                self.repo.crear_informe.assert_called_once()

    def test_commit_errors_are_uncertain_even_known_duplicate_and_never_retried(self):
        for error in [integrity(), DBAPIError('synthetic statement', {}, Exception('ack lost')),
                      RuntimeError('synthetic-private-detail')]:
            with self.subTest(error=type(error).__name__):
                self.repo.reset_mock()
                self.db.reset_mock(return_value=True, side_effect=True)
                self.db.session.commit.side_effect = error
                with self.assertLogs(self.logger, level='WARNING') as captured:
                    response, status = self.create()
                self.assertEqual(status, 500)
                self.assertEqual(response['message'], 'No se pudo procesar la solicitud.')
                self.assertTrue(any('incierto' in line for line in captured.output))
                self.db.session.commit.assert_called_once_with()
                self.db.session.rollback.assert_called_once_with()
                self.repo.crear_informe.assert_called_once()
                self.repo.crear_version_inicial.assert_called_once_with(701, 42)

    def test_failed_rollback_preserves_public_error_and_no_retry(self):
        self.repo.crear_version_inicial.side_effect = RuntimeError('synthetic insertion failure')
        self.db.session.rollback.side_effect = RuntimeError('synthetic rollback failure')
        with self.assertLogs(self.logger, level='ERROR') as captured:
            response, status = self.create()
        self.assertEqual(status, 500)
        self.assertEqual(response, {'success': False, 'message': 'No se pudo procesar la solicitud.'})
        self.assertTrue(any('No se pudo completar rollback de informe' in line for line in captured.output))
        self.db.session.rollback.assert_called_once_with()
        self.db.session.commit.assert_not_called()
        self.repo.crear_version_inicial.assert_called_once_with(701, 42)

    def test_invalid_envelope_ids_and_structured_data_stop_before_repository(self):
        for changes, status in [({'paciente_id': True}, 400), ({'visita_id': 0}, 400),
                                ({'visita_id': 902, 'diagnostico_id': 903}, 400),
                                ({'datos_estructurados': {}}, 422),
                                ({'datos_estructurados': {'usuario_id': 99}}, 422)]:
            with self.subTest(changes=changes):
                _, actual = self.create(**changes)
                self.assertEqual(actual, status)
                self.repo.validar_paciente.assert_not_called()
                self.repo.crear_informe.assert_not_called()
                self.db.session.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
