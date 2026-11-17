"""CB-02: real patient validation, frozen civil date, mocked persistence."""
from datetime import date, datetime
import unittest
from unittest.mock import patch
from flask import Flask
from codn_test_support import patient_target

service = patient_target()
TODAY = date(2026, 11, 3)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 11, 3, 12, 0)
        return value.replace(tzinfo=tz) if tz else value


class PatientValidationTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        ctx = self.app.app_context()
        ctx.push()
        self.addCleanup(ctx.pop)
        clock = patch.object(service, 'datetime', FrozenDatetime)
        clock.start()
        self.addCleanup(clock.stop)
        for mock in [service.PatientRepository, service.DocumentRepository, service.Paciente, service.db]:
            mock.reset_mock(return_value=True, side_effect=True)
        service.DocumentRepository.obtener_tipo_documento_por_codigo.return_value = {'id': 1}
        service.PatientRepository.obtener_paciente_por_documento.return_value = None
        service.PatientRepository.obtener_paciente_por_correo.return_value = None
        service.PatientRepository.insertar_paciente.return_value = 501

    def payload(self, **changes):
        data = dict(tipo_doc='DNI', nro_documento='90000001', nombres='Ana',
                    apellidos="O'Connor", sexo='Femenino', fecha_nacimiento='2000-01-01',
                    consentimiento_informado=True, correo=None)
        data.update(changes)
        return data

    def register(self, data):
        return service.registrar_nuevo_paciente(data, create_scope='clinical', read_scope=None)

    def no_persistence(self):
        service.PatientRepository.insertar_paciente.assert_not_called()
        service.db.session.commit.assert_not_called()
        service.Paciente.assert_not_called()

    def test_valid_normalized_input_reaches_repository_once(self):
        response, status = self.register(self.payload(tipo_doc=' dni ', nro_documento='90-000 001',
            nombres='  Mari\u0301a   Jose\u0301 ', apellidos="  O'Connor  ",
            correo='  CODN.CB02@EXAMPLE.COM ', telefono='900 000 000', direccion='  Calle   Prueba '))
        self.assertEqual(status, 201)
        self.assertEqual(response['data'], {'id': 501})
        values = service.Paciente.call_args.kwargs
        for key, expected in dict(nombres='María José', apellidos="O'Connor", nro_documento='90000001',
            correo='codn.cb02@example.com', telefono='900000000', direccion='Calle Prueba',
            fecha_nacimiento=date(2000, 1, 1), tipo_doc_id=1).items():
            with self.subTest(field=key):
                self.assertEqual(values[key], expected)
        service.PatientRepository.insertar_paciente.assert_called_once_with(service.Paciente.return_value)
        service.PatientRepository.obtener_paciente_por_correo.assert_called_once_with('codn.cb02@example.com')
        service.db.session.commit.assert_called_once_with()
        service.db.session.rollback.assert_not_called()

    def test_required_fields_reported_without_repository_access(self):
        for field in ['tipo_doc', 'nro_documento', 'nombres', 'apellidos', 'sexo', 'fecha_nacimiento', 'consentimiento_informado']:
            with self.subTest(missing=field):
                data = self.payload()
                del data[field]
                response, status = self.register(data)
                self.assertEqual(status, 400)
                self.assertIn('consent' if field == 'consentimiento_informado' else field, response['errors'])
                self.no_persistence()
                service.DocumentRepository.obtener_tipo_documento_por_codigo.assert_not_called()

    def test_invalid_formats_are_accumulated_and_never_persisted(self):
        response, status = self.register(self.payload(nombres='Ana3', apellidos='Lopez-',
            nro_documento='123', sexo='otro', correo='sin-arroba', telefono='123'))
        self.assertEqual(status, 400)
        self.assertEqual(set(response['errors']), {'nombres', 'apellidos', 'nro_documento', 'sexo', 'correo', 'telefono'})
        self.no_persistence()

    def test_person_names_and_document_helpers(self):
        for name, expected in [('María José', True), ("O'Connor", True), ('Ana-María', True),
                               ('Ana3', False), ('Ana\x00', False), ('Ana\u200b', False), ('张伟', False), ('', False)]:
            with self.subTest(name=name):
                self.assertEqual(service._valid_person_name(name), expected)
        for value, kind, expected in [('90-000 001', 'DNI', '90000001'), (' ab-123456 ', 'CE', 'AB123456'), ('xy 123', 'PAS', 'XY123')]:
            with self.subTest(document_type=kind):
                self.assertEqual(service._normalize_document(value, kind), expected)

    def test_birth_dates_fixed_clock_and_age_boundaries(self):
        cases = [(None, False), ('2026-2-01', False), ('2026-02-31', False), ('2026-11-04', False),
                 ('1899-12-31', False), ('1906-11-03', True), ('1905-11-04', True), ('1905-11-03', False),
                 ('2026-11-03', True), ('2000-02-29', True)]
        for value, valid in cases:
            with self.subTest(birth=value):
                parsed, error = service._parse_birth_date(value, today=TODAY)
                self.assertEqual(error is None, valid)
                self.assertEqual(parsed, date.fromisoformat(value) if valid else None)
                if not valid:
                    response, status = self.register(self.payload(fecha_nacimiento=value))
                    self.assertEqual(status, 400)
                    self.assertIn('fecha_nacimiento', response['errors'])
                    self.no_persistence()

    def test_name_length_boundaries_direct_validator(self):
        for field, limits in [('nombres', [1, 2, 80, 81]), ('apellidos', [1, 2, 100, 101])]:
            for size in limits:
                with self.subTest(field=field, length=size):
                    values = dict(nombres='Ana', apellidos='Prueba')
                    values[field] = 'A' * size
                    errors = service._validate_patient_data('DNI', '90000001', values['nombres'], values['apellidos'],
                        'Femenino', '2000-01-01', None, None, True)
                    maximum = 80 if field == 'nombres' else 100
                    self.assertEqual(field in errors, not 2 <= size <= maximum)

    def test_optional_field_lengths_and_email_variants(self):
        for field, maximum in [('direccion', 255), ('antecedentes_clinicos', 2000), ('alergias', 1000)]:
            for size in [maximum, maximum + 1]:
                with self.subTest(field=field, length=size):
                    service.PatientRepository.insertar_paciente.reset_mock()
                    service.Paciente.reset_mock()
                    service.db.session.commit.reset_mock()
                    response, status = self.register(self.payload(**{field: 'A' * size}))
                    self.assertEqual(status, 201 if size == maximum else 400)
                    if size > maximum:
                        self.assertIn(field, response['errors'])
                        self.no_persistence()
        for email, valid in [(None, True), ('', True), ('cb02@example.com', True), ('bad@', False),
                              ('a..b@example.com', False), ('a b@example.com', False), ('a@-example.com', False),
                              ('a' * 140 + '@example.com', False)]:
            with self.subTest(email=email):
                service.PatientRepository.reset_mock()
                service.Paciente.reset_mock()
                service.db.session.commit.reset_mock()
                response, status = self.register(self.payload(correo=email))
                self.assertEqual(status, 201 if valid else 400)
                if not valid:
                    self.assertIn('correo', response['errors'])
                    self.no_persistence()
                if not email:
                    service.PatientRepository.obtener_paciente_por_correo.assert_not_called()

    def test_duplicate_document_or_email_prevents_insert_and_commit(self):
        for document, email in [(True, False), (False, True), (True, True)]:
            with self.subTest(document=document, email=email):
                service.PatientRepository.obtener_paciente_por_documento.return_value = 501 if document else None
                service.PatientRepository.obtener_paciente_por_correo.return_value = 502 if email else None
                response, status = self.register(self.payload(correo='cb02@example.com'))
                self.assertEqual(status, 409)
                self.assertEqual(set(response['errors']), ({'nro_documento'} if document else set()) | ({'correo'} if email else set()))
                self.no_persistence()

    def test_invalid_envelope_types_controls_and_scope_do_not_persist(self):
        for data in [None, [], self.payload(extra='x'), self.payload(consentimiento_informado='true'),
                     self.payload(nombres='Ana\x00'), self.payload(nombres=42)]:
            with self.subTest(payload_type=type(data).__name__, data=str(data)):
                _, status = self.register(data)
                self.assertEqual(status, 400)
                self.no_persistence()
        _, status = service.registrar_nuevo_paciente(self.payload(antecedentes_clinicos='fixture'), create_scope='administrative', read_scope=None)
        self.assertEqual(status, 400)
        self.no_persistence()

    def test_unknown_catalog_document_does_not_insert(self):
        service.DocumentRepository.obtener_tipo_documento_por_codigo.return_value = None
        _, status = self.register(self.payload())
        self.assertEqual(status, 400)
        service.DocumentRepository.obtener_tipo_documento_por_codigo.assert_called_once_with('DNI')
        self.no_persistence()


if __name__ == '__main__':
    unittest.main(verbosity=2)
