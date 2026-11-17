"""CB-01: real authentication/policy/decorators, synthetic identities and JWTs."""
import datetime as dt
import os
import unittest
from dataclasses import replace
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

import jwt
from flask import Flask, request
from werkzeug.security import generate_password_hash
from codn_test_support import actor, auth_targets, load, module

auth, security, policy, repository = auth_targets()
KEY = 'codn-isolated-unit-tests-synthetic-signing-key'


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'SECRET_KEY': KEY}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.app = Flask(__name__)
        self.app.testing = True
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        repository.reset_mock(return_value=True, side_effect=True)
        self.rule = policy.OPERATION_RULES['history.full_read']
        self.user = actor((policy.OFTALMOLOGO, self.rule.all_of))
        self.user.password_hash = generate_password_hash('synthetic-password', method='pbkdf2:sha256:1000')

    def token(self, **changes):
        claims = dict(user_id=42, exp=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5))
        claims.update(changes)
        return jwt.encode(claims, KEY, algorithm='HS256')

    def test_missing_credentials_short_circuit(self):
        for username, password in [(None, 'x'), ('x', ''), ('', '')]:
            with self.subTest(username_present=bool(username), password_present=bool(password)):
                response, status = auth.autenticar_usuario(username, password)
                self.assertEqual(status, 400)
                self.assertFalse(response['success'])
                repository.get_user_by_username.assert_not_called()

    def test_invalid_credentials_and_repository_failure(self):
        for mode in ['absent', 'wrong_password', 'exception']:
            with self.subTest(mode=mode):
                repository.reset_mock(return_value=True, side_effect=True)
                repository.get_user_by_username.return_value = None if mode == 'absent' else self.user
                if mode == 'exception':
                    repository.get_user_by_username.side_effect = RuntimeError('synthetic-private-detail')
                response, status = auth.autenticar_usuario('actor_sintetico', 'incorrect')
                self.assertEqual(status, 500 if mode == 'exception' else 401)
                repository.get_user_by_username.assert_called_once_with('actor_sintetico')
                self.assertNotIn('synthetic-private-detail', str(response))
                self.assertNotIn('data', response)

    def test_active_login_real_hash_and_jwt(self):
        repository.get_user_by_username.return_value = self.user
        response, status = auth.autenticar_usuario('actor_sintetico', 'synthetic-password')
        self.assertEqual(status, 200)
        claims = jwt.decode(response['data']['token'], KEY, algorithms=['HS256'])
        self.assertEqual(claims['user_id'], 42)
        self.assertEqual(claims['roles'], [policy.OFTALMOLOGO])
        repository.get_user_by_username.assert_called_once_with('actor_sintetico')
        self.assertNotIn('password_hash', response['data']['user'])

    def test_real_repository_excludes_inactive_account_before_hash(self):
        query = Mock()
        query.filter_by.return_value.first.return_value = None
        real_repo = load('codn_auth_repo_target', 'src/repositories/auth_repository.py', {
            'src.models.auth_entities': module('src.models.auth_entities', Usuario=NS(query=query))})
        with patch.object(auth, 'AuthRepository', real_repo.AuthRepository), patch.object(auth, 'check_password_hash') as check:
            response, status = auth.autenticar_usuario('inactive_synthetic', 'synthetic-password')
        self.assertEqual(status, 401)
        query.filter_by.assert_called_once_with(username='inactive_synthetic', estado='ACTIVO')
        check.assert_not_called()
        self.assertFalse(response['success'])

    def test_history_all_grants_and_each_missing_permission(self):
        self.assertTrue(policy.evaluate_rule(self.user, self.rule))
        self.assertTrue(policy.evaluate_operation(self.user, 'history.full_read'))
        for permission in sorted(self.rule.all_of):
            with self.subTest(missing=permission):
                self.assertFalse(policy.evaluate_operation(
                    actor((policy.OFTALMOLOGO, self.rule.all_of - {permission})), 'history.full_read'))

    def test_role_provenance_prevents_mixing_and_admin_override(self):
        for user in [actor((policy.ADMINISTRADOR, self.rule.all_of)),
                     actor((policy.OFTALMOLOGO, []), (policy.ADMINISTRADOR, self.rule.all_of)),
                     actor((policy.ENFERMERO, self.rule.all_of))]:
            with self.subTest(roles=user.roles):
                self.assertFalse(policy.evaluate_rule(user, self.rule))

    def test_inactive_missing_and_malformed_grants_fail_closed(self):
        for mode in ['none', 'inactive_user', 'no_roles', 'null_role', 'inactive_role', 'inactive_permission', 'null_permission']:
            with self.subTest(mode=mode):
                user = actor((policy.OFTALMOLOGO, self.rule.all_of))
                if mode == 'none':
                    user = None
                elif mode == 'inactive_user':
                    user.estado = 'INACTIVO'
                elif mode == 'no_roles':
                    user.roles_rel = None
                elif mode == 'null_role':
                    user.roles_rel = [NS(rol=None)]
                elif mode == 'inactive_role':
                    user.roles_rel[0].rol.estado = 'INACTIVO'
                elif mode == 'inactive_permission':
                    user.roles_rel[0].rol.permisos_rel[0].permiso.estado = 'INACTIVO'
                else:
                    user.roles_rel[0].rol.permisos_rel[0].permiso = None
                self.assertFalse(policy.evaluate_rule(user, self.rule))

    def test_rule_structure_any_of_and_resource(self):
        for rule in [replace(self.rule, role_codes=frozenset()),
                     replace(self.rule, all_of=frozenset()),
                     replace(self.rule, all_of=frozenset({'informes.*'}))]:
            with self.subTest(rule=repr(rule)):
                self.assertFalse(policy.evaluate_rule(self.user, rule))
        self.assertFalse(policy.evaluate_operation(self.user, 'unknown.operation'))
        rule = replace(self.rule, all_of=frozenset(), any_of=frozenset({'informes.ver', 'extra'}), needs_resource_check=True)
        for resource in [None, False, True]:
            with self.subTest(resource=resource):
                self.assertEqual(policy.evaluate_rule(self.user, rule, resource_allowed=resource), resource is True)
        self.assertFalse(policy.evaluate_rule(self.user, replace(rule, any_of=frozenset({'extra'})), resource_allowed=True))
        self.assertFalse(policy.evaluate_rule(self.user, self.rule, resource_allowed=False))

    def test_patient_scopes_follow_grant_source(self):
        for code, expected in [(policy.OFTALMOLOGO, 'clinical'), (policy.ENFERMERO, 'assistance'),
                               (policy.ASISTENTE, 'administrative'), (policy.ADMINISTRADOR, None)]:
            with self.subTest(role=code):
                user = actor((code, ['pacientes.ver', 'pacientes.crear']))
                self.assertEqual(policy.patient_read_scope(user), expected)
                self.assertEqual(policy.patient_create_scope(user), expected)
        self.assertEqual(policy.patient_read_scope(actor((policy.OFTALMOLOGO, []), (policy.ASISTENTE, ['pacientes.ver']))), 'administrative')

    def test_invalid_tokens_never_lookup_identity_or_call_handler(self):
        expired = self.token(exp=dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=5))
        no_exp = jwt.encode({'user_id': 42}, KEY, algorithm='HS256')
        wrong_signature = jwt.encode({'user_id': 42, 'exp': 9999999999}, 'another-synthetic-signing-key-long-enough', algorithm='HS256')
        for label, token, url in [('missing', None, '/'), ('malformed', 'invalid', '/'),
                                  ('expired', expired, '/'), ('missing_exp', no_exp, '/'),
                                  ('signature', wrong_signature, '/'), ('url_token', self.token(), '/?token=synthetic')]:
            with self.subTest(mode=label):
                handler = Mock(return_value=({'ok': True}, 200))
                headers = {'Authorization': 'Bearer ' + token} if token else {}
                with self.app.test_request_context(url, headers=headers):
                    _, status = security.token_required(handler, eager_permissions=True)()
                self.assertEqual(status, 401)
                handler.assert_not_called()
                repository.get_active_user_with_permissions_by_id.assert_not_called()

    def test_identity_reload_replaces_stale_claims_and_denies_absent_identity(self):
        for mode in ['absent', 'revoked', 'allowed', 'lookup_error']:
            with self.subTest(mode=mode):
                repository.reset_mock(return_value=True, side_effect=True)
                user = actor((policy.OFTALMOLOGO, ['informes.ver'] if mode == 'allowed' else []))
                repository.get_active_user_with_permissions_by_id.return_value = None if mode == 'absent' else user
                if mode == 'lookup_error':
                    repository.get_active_user_with_permissions_by_id.side_effect = RuntimeError('synthetic lookup failure')
                handler = Mock(side_effect=lambda: ({'claims': request.current_user}, 200))
                decorated = policy.strict_authorization_required('reports.full_read')(handler)
                with self.app.test_request_context('/', headers={'Authorization': 'Bearer ' + self.token(permissions=['informes.ver'], permisos=['informes.ver'])}):
                    response, status = decorated()
                self.assertEqual(status, {'absent': 401, 'revoked': 403, 'allowed': 200, 'lookup_error': 500}[mode])
                repository.get_active_user_with_permissions_by_id.assert_called_once_with(42)
                if mode == 'allowed':
                    handler.assert_called_once_with()
                    self.assertEqual(response['claims']['permisos'], [])
                    self.assertNotIn('permissions', response['claims'])
                else:
                    handler.assert_not_called()

    def test_resource_lookup_is_short_circuited_and_denial_prevents_operation(self):
        for mode in ['no_grant', 'denied_resource', 'allowed_resource', 'unknown_rule', 'disabled']:
            with self.subTest(mode=mode):
                resource = Mock(return_value=mode == 'allowed_resource')
                handler = Mock(return_value=({'ok': True}, 200))
                repository.get_active_user_with_permissions_by_id.return_value = actor((policy.OFTALMOLOGO, [] if mode == 'no_grant' else ['informes.editar']))
                decorated = policy.strict_authorization_required(
                    'unknown' if mode == 'unknown_rule' else 'reports.edit_own',
                    resource_check=resource, enabled_config='UNSET' if mode == 'disabled' else None)(handler)
                with self.app.test_request_context('/', headers={'Authorization': 'Bearer ' + self.token()}):
                    _, status = decorated()
                self.assertEqual(status, 200 if mode == 'allowed_resource' else 403)
                if mode in ['denied_resource', 'allowed_resource']:
                    resource.assert_called_once()
                else:
                    resource.assert_not_called()
                if mode == 'allowed_resource':
                    handler.assert_called_once()
                else:
                    handler.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
