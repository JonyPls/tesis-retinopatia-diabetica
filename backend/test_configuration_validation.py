"""Validaciones administrativas sin conexiones ni escrituras en MySQL."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from services import configuration_service as service
from utils.identity_validation import valid_email


class ConfigurationValidationTests(unittest.TestCase):
    def setUp(self):
        self.payload = dict(nombres='Ana', apellidos='Pérez', username='ana_test',
                            correo=' ana@example.com ', tipo_doc_id=91, nro_documento='00001234',
                            cargo_id=92, cmp=None, rne=None, password='clave-segura-10', role_ids=[7])

    def test_catalog_includes_document_code_without_assuming_id(self):
        with patch.object(service.repo, 'roles', return_value=[]), \
             patch.object(service.repo, 'permissions', return_value=[]), \
             patch.object(service.repo, 'document_types', return_value=[SimpleNamespace(
                 id=91, codigo='DNI', nombre='Documento Nacional de Identidad')]), \
             patch.object(service.repo, 'positions', return_value=[]):
            self.assertEqual(service.catalog()['document_types'], [{
                'id': 91, 'nombre': 'Documento Nacional de Identidad', 'codigo': 'DNI'}])

    def test_document_formats_by_code_and_leading_zeroes(self):
        for code, accepted, rejected in (
            ('DNI', '00001234', ('1234567', '000012345', '1234ABCD', '１２３４５６７８')),
            ('CE', 'ab001234', ('A123456', 'AB12345678901', 'A123-456')),
            ('PAS', 'a01', ('AB', 'ABCDEFGHIJ', 'AB_12')),
        ):
            with self.subTest(code=code), patch.object(service.repo, 'document_type',
                                                       return_value=SimpleNamespace(codigo=code)):
                values = {'tipo_doc_id': 91, 'nro_documento': accepted}
                service._validate_new_document(values)
                self.assertEqual(values['nro_documento'], accepted if code == 'DNI' else accepted.upper())
                for value in rejected:
                    with self.subTest(value=value), self.assertRaisesRegex(service.InputError, 'nro_documento:'):
                        service._validate_new_document({'tipo_doc_id': 91, 'nro_documento': value})

    def test_email_syntax_matches_patient_policy_and_remains_required(self):
        self.assertTrue(valid_email('ana@example.com'))
        self.assertFalse(valid_email('ana@dominio..com'))
        for value in ('ana@dominio..com', 'ana@.com', 'ana@dominio', 'ana x@example.com', ''):
            with self.subTest(value=value), self.assertRaises(service.InputError):
                service._user_data({**self.payload, 'correo': value}, creating=True)
        self.assertEqual(service._user_data(self.payload, creating=True)['correo'], 'ana@example.com')

    def test_optional_professional_numbers_are_digits_not_all_zeroes_and_at_most_twenty(self):
        self.assertIsNone(service._user_data(self.payload, creating=True)['cmp'])
        self.assertEqual(service._user_data({**self.payload, 'cmp': '001', 'rne': '12345678901234567890'},
                                            creating=True)['cmp'], '001')
        for field in ('cmp', 'rne'):
            for value in ('000', 'a123', '12-34', '1' * 21, '  '):
                with self.subTest(field=field, value=value), self.assertRaisesRegex(service.InputError, field):
                    service._user_data({**self.payload, field: value}, creating=True)

    def test_password_is_hashed_without_silently_stripping_spaces(self):
        with patch.object(service.repo, 'valid_document_and_position', return_value=True), \
             patch.object(service.repo, 'document_type', return_value=SimpleNamespace(codigo='DNI')), \
             patch.object(service, '_role_ids', return_value={7}), \
             patch.object(service.db.session, 'add'), patch.object(service.db.session, 'flush'), \
             patch.object(service.db.session, 'commit'), \
             patch.object(service, 'user_view', return_value={}), \
             patch.object(service, 'generate_password_hash', return_value='hashed') as hashed:
            response, status = service.create_user({**self.payload, 'password': ' clave-segura-10 '})
            self.assertEqual(status, 201)
            self.assertTrue(response['success'])
            hashed.assert_called_once_with(' clave-segura-10 ')

    def test_edit_validates_changed_document_but_keeps_historical_document_for_other_edits(self):
        user = SimpleNamespace(tipo_doc_id=91, nro_documento='LEGACY', nombres='Ana', cargo_id=92)
        with patch.object(service.repo, 'user_for_update', return_value=user), \
             patch.object(service.repo, 'valid_document_and_position', return_value=True), \
             patch.object(service.repo, 'document_type', return_value=SimpleNamespace(codigo='DNI')), \
             patch.object(service.db.session, 'flush'), patch.object(service.db.session, 'commit'), \
             patch.object(service.db.session, 'rollback'), \
             patch.object(service, 'user_view', return_value={}) as view:
            result, status = service.edit_user(4, {'nombres': 'María'})
            self.assertEqual(status, 200)
            self.assertTrue(result['success'])
            self.assertEqual(user.nro_documento, 'LEGACY')
            self.assertEqual(user.nombres, 'María')
            for payload in ({'nro_documento': '1234567'}, {'tipo_doc_id': 92}):
                with self.subTest(payload=payload):
                    result, status = service.edit_user(4, payload)
                    self.assertEqual(status, 400)
                    self.assertIn('nro_documento:', result['message'])
                    self.assertEqual(user.nro_documento, 'LEGACY')
            result, status = service.edit_user(4, {'nro_documento': '00001234'})
            self.assertEqual(status, 200)
            self.assertEqual(user.nro_documento, '00001234')
            self.assertEqual(view.call_count, 2)

    def test_edit_normalizes_changed_ce_document_without_losing_leading_zeroes(self):
        user = SimpleNamespace(tipo_doc_id=91, nro_documento='00001234', cargo_id=92)
        with patch.object(service.repo, 'user_for_update', return_value=user), \
             patch.object(service.repo, 'valid_document_and_position', return_value=True), \
             patch.object(service.repo, 'document_type', return_value=SimpleNamespace(codigo='CE')), \
             patch.object(service.db.session, 'flush'), patch.object(service.db.session, 'commit'), \
             patch.object(service.db.session, 'rollback'), \
             patch.object(service, 'user_view', return_value={}):
            result, status = service.edit_user(4, {'tipo_doc_id': 92, 'nro_documento': 'ab001234'})
            self.assertEqual(status, 200)
            self.assertTrue(result['success'])
            self.assertEqual(user.nro_documento, 'AB001234')


if __name__ == '__main__':
    unittest.main()
