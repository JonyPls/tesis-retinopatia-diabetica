"""Validaciones de alta aisladas: sin engine, app ni escrituras de pacientes."""
import importlib.util
import sys
import types
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import Mock, patch
from sqlalchemy.exc import IntegrityError
from zoneinfo import ZoneInfo


fake_repository = types.ModuleType('src.repositories.patient_repository')
fake_repository.PatientRepository = type('PatientRepository', (), {})
fake_documents = types.ModuleType('src.repositories.document_repository')
fake_documents.DocumentRepository = type('DocumentRepository', (), {})
fake_models = types.ModuleType('src.models.patient_entities')
fake_models.Paciente = type('Paciente', (), {})
fake_database = types.ModuleType('database')
fake_database.db = None
with patch.dict(sys.modules, {
    'src.repositories.patient_repository': fake_repository,
    'src.repositories.document_repository': fake_documents,
    'src.models.patient_entities': fake_models,
    'database': fake_database,
}):
    spec = importlib.util.spec_from_file_location(
        'patient_registration_validation_under_test',
        Path(__file__).parent / 'services' / 'patient_service.py')
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)


def validate(*, nombres='María José', apellidos="O'Connor", correo=None):
    return service._validate_patient_data(
        'DNI', '90000001', nombres, apellidos, 'Femenino',
        '2000-01-01', None, correo, True)


class PatientRegistrationValidationTests(unittest.TestCase):
    def registration(self, **changes):
        payload = dict(tipo_doc='DNI', nro_documento='00000001',
                       nombres='María', apellidos='López', sexo='Femenino',
                       fecha_nacimiento='2000-01-01', consentimiento_informado=True,
                       telefono='900000000', correo=None)
        payload.update(changes)
        return payload

    def with_repositories(self, document=None, email=None, insert_id=501):
        from contextlib import ExitStack
        stack = ExitStack()
        stack.enter_context(patch.object(service.DocumentRepository,
                                         'obtener_tipo_documento_por_codigo', return_value={'id': 1}, create=True))
        stack.enter_context(patch.object(service.PatientRepository,
                                         'obtener_paciente_por_documento', return_value=document, create=True))
        stack.enter_context(patch.object(service.PatientRepository,
                                         'obtener_paciente_por_correo', return_value=email, create=True))
        insert = stack.enter_context(patch.object(service.PatientRepository,
                                                 'insertar_paciente', return_value=insert_id, create=True))
        stack.enter_context(patch.object(service, 'Paciente', Mock()))
        database = stack.enter_context(patch.object(service, 'db', Mock()))
        return stack, insert, database

    def test_document_and_email_conflicts_no_insert(self):
        stack, insert, database = self.with_repositories(document=11, email=12)
        with stack:
            response, status = service.registrar_nuevo_paciente(
                self.registration(correo='  Ana@EJEMPLO.com  '),
                create_scope='administrative', read_scope=None)
            self.assertEqual(status, 409)
            self.assertEqual(set(response['errors']), {'nro_documento', 'correo'})
            service.PatientRepository.obtener_paciente_por_documento.assert_called_once_with(1, '00000001')
            service.PatientRepository.obtener_paciente_por_correo.assert_called_once_with('ana@ejemplo.com')
            insert.assert_not_called()
            database.session.commit.assert_not_called()

    def test_all_invalid_fields_reported_without_database_access(self):
        payload = self.registration(nombres='Ana3', apellidos='López-',
                                    fecha_nacimiento='2026-02-31', correo='sin-arroba')
        stack, insert, database = self.with_repositories()
        with stack:
            response, status = service.registrar_nuevo_paciente(
                payload, create_scope='administrative', read_scope=None)
            self.assertEqual(status, 400)
            self.assertEqual(set(response['errors']),
                             {'nombres', 'apellidos', 'fecha_nacimiento', 'correo'})
            service.DocumentRepository.obtener_tipo_documento_por_codigo.assert_not_called()
            insert.assert_not_called()
            database.session.commit.assert_not_called()

    def test_future_and_older_than_120_dates_rejected(self):
        for birth in ('2999-01-01', '1899-12-31', '1900-01-01'):
            with self.subTest(birth=birth):
                stack, insert, database = self.with_repositories()
                with stack:
                    response, status = service.registrar_nuevo_paciente(
                        self.registration(fecha_nacimiento=birth),
                        create_scope='administrative', read_scope=None)
                    self.assertEqual(status, 400)
                    self.assertIn('fecha_nacimiento', response['errors'])
                    insert.assert_not_called()
                    database.session.commit.assert_not_called()

    def test_optional_email_and_shared_phone_do_not_block_insert(self):
        for email in (None, '  NUEVA@clinica.com  '):
            with self.subTest(email=email):
                stack, insert, database = self.with_repositories()
                with stack:
                    response, status = service.registrar_nuevo_paciente(
                        self.registration(correo=email, telefono='900000000'),
                        create_scope='administrative', read_scope=None)
                    self.assertEqual(status, 201)
                    self.assertEqual(response['data'], {'id': 501})
                    self.assertEqual(service.Paciente.call_args.kwargs['telefono'], '900000000')
                    if email:
                        self.assertEqual(service.Paciente.call_args.kwargs['correo'], 'nueva@clinica.com')
                    else:
                        service.PatientRepository.obtener_paciente_por_correo.assert_not_called()
                    insert.assert_called_once()
                    database.session.commit.assert_called_once()

    def test_document_type_is_part_of_identity(self):
        stack, insert, _ = self.with_repositories()
        with stack:
            service.DocumentRepository.obtener_tipo_documento_por_codigo.return_value = {'id': 2}
            response, status = service.registrar_nuevo_paciente(
                self.registration(tipo_doc='CE', nro_documento='00000001'),
                create_scope='administrative', read_scope=None)
            self.assertEqual(status, 201)
            service.PatientRepository.obtener_paciente_por_documento.assert_called_once_with(2, '00000001')
            insert.assert_called_once()

    def test_database_unique_conflict_rolled_back_and_classified(self):
        for key, field in (('uq_pacientes_documento', 'nro_documento'),
                           ('uq_pacientes_correo_normalizado', 'correo')):
            with self.subTest(key=key):
                stack, insert, database = self.with_repositories()
                with stack:
                    insert.side_effect = IntegrityError('INSERT', {},
                                                        Exception(1062, f"Duplicate entry for key '{key}'"))
                    response, status = service.registrar_nuevo_paciente(
                        self.registration(correo='ana@ejemplo.com'),
                        create_scope='administrative', read_scope=None)
                    self.assertEqual(status, 409)
                    self.assertEqual(set(response['errors']), {field})
                    database.session.rollback.assert_called_once()
                    database.session.commit.assert_not_called()

    def test_names_and_surnames(self):
        for name in ('Ana', 'María José', 'Muñoz', 'José-Luis', 'Çelik'):
            with self.subTest(name=name):
                self.assertFalse(validate(nombres=name))
        for surname in ('García-López', "O'Connor", 'D’Angelo'):
            with self.subTest(surname=surname):
                self.assertFalse(validate(apellidos=surname))
        for invalid in ('Ana3', 'Ana@', 'Ana😊', '  ', '--', 'Ana--María', '\nAna', 'AnaⅣ'):
            with self.subTest(invalid=invalid):
                self.assertIn('nombres', validate(nombres=invalid))
                self.assertIn('apellidos', validate(apellidos=invalid))

    def test_raw_control_characters_are_rejected_before_cleaning(self):
        payload = dict(tipo_doc='DNI', nro_documento='90000001',
                       nombres='Ana\nMaría', apellidos='López', sexo='Femenino',
                       fecha_nacimiento='2000-01-01', consentimiento_informado=True)
        response, status = service.registrar_nuevo_paciente(
            payload, create_scope='administrative', read_scope='administrative')
        self.assertEqual(status, 400)
        self.assertFalse(response['success'])

    def test_birth_date_and_birthday_boundary(self):
        today = date(2026, 10, 15)
        clinic_today = datetime.now(ZoneInfo('America/Lima')).date()
        self.assertIsNone(service._parse_birth_date(clinic_today.isoformat())[1])
        for value in ('2026-10-15', '1906-10-15', '1905-10-16',
                      '2000-02-29', '2024-02-29'):
            with self.subTest(value=value):
                self.assertIsNone(service._parse_birth_date(value, today=today)[1])
        self.assertIsNone(service._parse_birth_date('1900-01-01', today=date(2020, 12, 31))[1])
        for value, expected in (('1899-12-31', '1900'), ('1900-01-01', '120'),
                                ('1905-10-15', '120'), ('2026-10-16', 'futura'),
                                ('2026-02-31', 'Verifica'), ('1900-02-29', 'Verifica'),
                                ('2025-02-29', 'Verifica'), ('2000-2-29', 'Verifica')):
            with self.subTest(value=value):
                self.assertIn(expected, service._parse_birth_date(value, today=today)[1])
        self.assertIn('120', service._parse_birth_date('1905-10-16', today=date(2026, 10, 16))[1])

    def test_optional_email_and_domain_syntax(self):
        for email in (None, 'ana@example.com', 'nombre.apellido+tesis@clinica.com.pe'):
            with self.subTest(email=email):
                self.assertFalse(validate(correo=email))
        for email in ('sin-arroba', 'a@dominio', 'a@b..com', 'a@-dominio.com',
                      'a@dominio.c', 'a b@dominio.com', 'a@dominio .com',
                      'a😃@dominio.com', 'a()@dominio.com'):
            with self.subTest(email=email):
                self.assertIn('correo', validate(correo=email))


if __name__ == '__main__':
    unittest.main()
