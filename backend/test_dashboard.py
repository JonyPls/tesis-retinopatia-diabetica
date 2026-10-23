"""Dashboard tests use only a disposable in-memory SQLite schema and synthetic rows."""

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from sqlalchemy import text

from database import db
from routes.dashboard_routes import dashboard_bp
from services.dashboard_service import clinical_summary
from src.repositories.dashboard_repository import DashboardRepository


def auth_user(grants):
    roles = []
    for code, permissions in grants.items():
        role = SimpleNamespace(codigo=code, estado='ACTIVO', permisos_rel=[
            SimpleNamespace(permiso=SimpleNamespace(codigo=permission, estado='ACTIVO'))
            for permission in permissions
        ])
        roles.append(SimpleNamespace(rol=role))
    return SimpleNamespace(estado='ACTIVO', roles_rel=roles, roles=[], permisos=[])


GRANTS = ('pacientes.ver', 'visitas.ver', 'diagnostico_retinopatia.ver')


class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', TESTING=True, SECRET_KEY='synthetic')
        db.init_app(self.app)
        self.app.register_blueprint(dashboard_bp)
        self.context = self.app.app_context()
        self.context.push()
        for ddl in (
            'CREATE TABLE pacientes (id INTEGER PRIMARY KEY, nro_documento TEXT, nombres TEXT, apellidos TEXT, estado TEXT)',
            'CREATE TABLE visitas_clinicas (id INTEGER PRIMARY KEY, paciente_id INTEGER, fecha_visita DATETIME, fecha_visita_origen TEXT, estado TEXT)',
            'CREATE TABLE diagnosticos_retinopatia (id INTEGER PRIMARY KEY, visita_id INTEGER, estado TEXT)',
            'CREATE TABLE diagnosticos_retinopatia_detalle (id INTEGER PRIMARY KEY, diagnostico_retinopatia_id INTEGER, resultado_ia_id INTEGER, resultado_final_id INTEGER, estado_validacion TEXT)',
            'CREATE TABLE grados_retinopatia (id INTEGER PRIMARY KEY, nombre TEXT)',
        ):
            db.session.execute(text(ddl))
        for level in range(5):
            db.session.execute(text('INSERT INTO grados_retinopatia VALUES (:id, :name)'),
                               {'id': level, 'name': f'Grado registrado {level}'})
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.engine.dispose()
        self.context.pop()

    def patient(self, id, state='ACTIVO'):
        db.session.execute(text('INSERT INTO pacientes VALUES (:id, :doc, :name, :last, :state)'),
                           dict(id=id, doc=f'DOC{id}', name=f'Paciente{id}', last='Sintético', state=state))

    def visit(self, id, patient, date='2026-10-20 10:00:00', origin='UTC_VERIFICADO', state='ACTIVA'):
        db.session.execute(text('INSERT INTO visitas_clinicas VALUES (:id, :patient, :date, :origin, :state)'),
                           dict(id=id, patient=patient, date=date, origin=origin, state=state))

    def diagnosis(self, id, visit, state, eyes):
        db.session.execute(text('INSERT INTO diagnosticos_retinopatia VALUES (:id, :visit, :state)'),
                           dict(id=id, visit=visit, state=state))
        for index, (ia, final, validation) in enumerate(eyes):
            db.session.execute(text('INSERT INTO diagnosticos_retinopatia_detalle VALUES (:id, :diag, :ia, :final, :status)'),
                               dict(id=id * 10 + index, diag=id, ia=ia, final=final, status=validation))

    def fixtures(self):
        self.patient(1)
        self.patient(2)
        self.patient(3, 'INACTIVO')
        self.patient(4)  # Sin visita
        self.visit(10, 1, '2026-10-20 10:00:00')
        self.visit(11, 1, '2030-01-01 10:00:00', 'NO_VERIFICADO')
        self.visit(12, 2, '2026-10-19 10:00:00')
        self.visit(13, 2, '2026-10-18 10:00:00')
        self.visit(14, 2, '2026-10-21 10:00:00', state='ANULADA')
        self.visit(15, 3)
        self.diagnosis(1, 10, 'VALIDADO', [(2, 4, 'CORREGIDO'), (0, 0, 'APROBADO')])
        self.diagnosis(2, 11, 'PROCESADO', [(1, 1, 'APROBADO'), (4, None, 'PENDIENTE')])
        self.diagnosis(3, 12, 'PROCESADO', [(3, None, 'PENDIENTE')])
        self.diagnosis(4, 13, 'ANULADO', [(0, 0, 'APROBADO')])
        self.diagnosis(5, 14, 'PROCESADO', [(2, None, 'PENDIENTE')])
        self.diagnosis(6, 15, 'PROCESADO', [(4, None, 'PENDIENTE')])
        db.session.commit()

    def test_aggregates_use_diagnoses_and_validated_eyes_not_ia_predictions(self):
        self.fixtures()
        self.assertEqual(DashboardRepository.counts(), dict(patients=3, evaluations=4, validated=1, pending=3))
        self.assertEqual(DashboardRepository.validated_eyes(), [
            dict(level=n, label=f'Grado registrado {n}', count=c)
            for n, c in enumerate((1, 1, 0, 0, 1))
        ])
        recent = DashboardRepository.recent_patients()
        self.assertEqual([row['id'] for row in recent], [1, 2])
        self.assertEqual(recent[0]['ultima_visita'], datetime(2026, 10, 20, 10))
        self.assertEqual(clinical_summary(auth_user({'OFTALMOLOGO': GRANTS}))['recent_patients'][0]['ultima_visita'],
                         '2026-10-20T10:00:00Z')

    def test_empty_and_missing_catalog_fail_closed(self):
        self.assertEqual(DashboardRepository.counts(), dict(patients=0, evaluations=0, validated=0, pending=0))
        self.assertEqual(DashboardRepository.recent_patients(), [])
        self.assertTrue(all(row['count'] == 0 for row in DashboardRepository.validated_eyes()))
        db.session.execute(text('DELETE FROM grados_retinopatia WHERE id = 4'))
        with self.assertRaises(ValueError):
            DashboardRepository.validated_eyes()

    def test_unverified_visits_are_not_ordered_as_recent(self):
        self.patient(1)
        self.visit(1, 1, '2030-01-01 10:00:00', 'NO_VERIFICADO')
        self.assertEqual(DashboardRepository.recent_patients(), [])

    def test_all_five_catalog_grades_and_limit_six(self):
        for level in range(5):
            self.patient(level + 1)
            self.visit(level + 1, level + 1, f'2026-10-{level + 10:02d} 10:00:00')
            self.diagnosis(level + 1, level + 1, 'VALIDADO', [(4, level, 'CORREGIDO')])
        for index in range(5, 8):
            self.patient(index + 1)
            self.visit(index + 1, index + 1, f'2026-10-{index + 10:02d} 10:00:00')
        db.session.commit()
        self.assertEqual([row['count'] for row in DashboardRepository.validated_eyes()], [1] * 5)
        self.assertEqual(DashboardRepository.counts()['evaluations'], 5)
        self.assertEqual(DashboardRepository.counts()['validated'], 5)
        self.assertEqual([row['id'] for row in DashboardRepository.recent_patients()], [8, 7, 6, 5, 4, 3])

    def get_as(self, grants):
        with patch('utils.security.jwt.decode', return_value={'user_id': 1, 'exp': 9999999999}), \
             patch('utils.security.AuthRepository.get_active_user_with_permissions_by_id',
                   return_value=auth_user(grants)):
            return self.app.test_client().get('/api/dashboard/clinico',
                                              headers={'Authorization': 'Bearer synthetic'})

    def test_endpoint_authorization_and_revocation(self):
        self.fixtures()
        self.assertEqual(self.get_as({'ADMINISTRADOR_SISTEMA': GRANTS}).status_code, 403)
        self.assertEqual(self.get_as({'ENFERMERO': GRANTS}).status_code, 403)
        self.assertEqual(self.get_as({'ASISTENTE_ADMINISTRATIVO': GRANTS}).status_code, 403)
        self.assertEqual(self.get_as({'OFTALMOLOGO': ('pacientes.ver',)}).status_code, 403)
        self.assertEqual(self.get_as({'OFTALMOLOGO': ('pacientes.ver',),
                                      'ADMINISTRADOR_SISTEMA': ('visitas.ver', 'diagnostico_retinopatia.ver')}).status_code, 403)
        allowed = self.get_as({'OFTALMOLOGO': GRANTS})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json['data']['kpis']['validated'], 1)
        self.assertEqual(allowed.json['data']['actions'],
                         {'patients': True, 'diagnosis': False, 'reports': False})
        self.assertEqual(allowed.headers['Cache-Control'], 'private, no-store')
        self.assertEqual(self.get_as({'OFTALMOLOGO': GRANTS[:-1]}).status_code, 403)
        self.assertEqual(self.app.test_client().get('/api/dashboard/clinico').status_code, 401)

    def test_endpoint_failure_is_not_reported_as_zero(self):
        with patch('utils.security.jwt.decode', return_value={'user_id': 1, 'exp': 9999999999}), \
             patch('utils.security.AuthRepository.get_active_user_with_permissions_by_id',
                   return_value=auth_user({'OFTALMOLOGO': GRANTS})), \
             patch.object(self.app.logger, 'exception'), \
             patch('routes.dashboard_routes.clinical_summary', side_effect=RuntimeError('test')):
            result = self.app.test_client().get('/api/dashboard/clinico',
                                                headers={'Authorization': 'Bearer synthetic'})
            self.assertEqual(result.status_code, 500)
            self.assertFalse(result.json['success'])

    def test_quick_actions_require_grants_from_eligible_role(self):
        user = auth_user({
            'OFTALMOLOGO': GRANTS,
            'ADMINISTRADOR_SISTEMA': ('diagnostico_retinopatia.crear', 'imagenes.ver',
                                      'informes.crear', 'informes.ver'),
        })
        self.assertEqual(clinical_summary(user)['actions'],
                         {'patients': True, 'diagnosis': False, 'reports': False})
        role = user.roles_rel[0].rol
        role.permisos_rel.extend(SimpleNamespace(permiso=SimpleNamespace(codigo=code, estado='ACTIVO'))
                                 for code in ('diagnostico_retinopatia.crear', 'imagenes.ver',
                                              'informes.crear', 'informes.ver'))
        self.assertEqual(clinical_summary(user)['actions'],
                         {'patients': True, 'diagnosis': True, 'reports': True})
        role.permisos_rel[-1].permiso.estado = 'INACTIVO'
        self.assertFalse(clinical_summary(user)['actions']['reports'])


if __name__ == '__main__':
    unittest.main()
