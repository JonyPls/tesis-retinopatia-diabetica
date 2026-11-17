"""Ten CB-03 integration scenarios. Import/discovery never connects to a DB.

Only codn_run_cb03_mysql.py may inject a verified environment. Running this file
or discovery without that environment fails closed; no skip or mock approval.
"""
import unittest
from unittest.mock import patch
from codn_cb03_mysql import SafetyGateError

ENVIRONMENT = None


class ReportQueryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if ENVIRONMENT is None:
            raise SafetyGateError('CB-03 sin entorno MySQL verificado/autorizado. Utilizar el runner focalizado.')
        cls.env = ENVIRONMENT
        cls.t, cls.f = cls.env.target, cls.env.fixtures
        cls.repo = cls.t.InformeRepository

    def value(self, condition, actual, expected):
        self.env.observations.append({'method': self._testMethodName, 'condition': condition,
                                      'expected': expected, 'obtained': actual})
        self.assertEqual(actual, expected, condition)

    def expected_ids(self, visit):
        return [self.f.reports[label].id for label in self.f.expected[visit]]

    def history(self, patient='A'):
        return self.t.PatientRepository.obtener_diagnosticos_paciente(self.f.patients[patient].id)

    def test_01_valid_visit_exact_active_reports_and_order(self):
        rows = self.repo.obtener_informes_por_visita(self.f.visits['V1'].id)
        self.value('IDs exactos en orden por nombre de tipo', [r['id'] for r in rows], self.expected_ids('V1'))
        self.value('Nombres de tipos ordenados', [r['tipo_informe_nombre'] for r in rows], ['Alfa CB03', 'Beta CB03'])
        self.value('Asociación visita', [r['visita_id'] for r in rows], [self.f.visits['V1'].id] * 2)

    def test_02_other_visits_and_patient_are_excluded(self):
        rows = self.repo.obtener_informes_por_visita(self.f.visits['V1'].id)
        ids = {r['id'] for r in rows}
        foreign = {self.f.reports[label].id for label in ['R5', 'R6']}
        self.value('Intersección V1 con V2/VB vacía', sorted(ids & foreign), [])
        for visit in ['V2', 'VB']:
            with self.subTest(visit=visit):
                self.value('Conjunto independiente ' + visit,
                    [r['id'] for r in self.repo.obtener_informes_por_visita(self.f.visits[visit].id)], self.expected_ids(visit))

    def test_03_report_states_active_inactive_annulled(self):
        rows = self.repo.obtener_informes_por_visita(self.f.visits['V1'].id)
        ids = {r['id'] for r in rows}
        for label, expected in [('R1', True), ('R3', False), ('R4', False)]:
            with self.subTest(report=label, state=self.f.reports[label].estado):
                self.value('Inclusión según estado ' + label, self.f.reports[label].id in ids, expected)
        self.value('Solo ACTIVO serializado', sorted({r['estado'] for r in rows}), ['ACTIVO'])

    def test_04_visit_without_reports_returns_empty_collection(self):
        self.value('V0 sin informes', self.repo.obtener_informes_por_visita(self.f.visits['V0'].id), [])
        rows = {r['visita_id']: r for r in self.history()}
        row = rows[self.f.visits['V0'].id]
        self.value('V0 informes agrupados', row['informes'], [])
        self.value('V0 total', row['total_informes'], 0)
        self.value('V0 bandera', row['tiene_informes'], 0)
        self.value('V0 sin IA', row['diagnostico_ia'], None)

    def test_05_foreign_visit_rejected_with_real_notfound(self):
        with self.assertRaises(self.repo.NotFound):
            self.repo.validar_visita(self.f.visits['VB'].id, self.f.patients['A'].id)
        self.value('Asociación válida devuelve visita',
            self.repo.validar_visita(self.f.visits['V1'].id, self.f.patients['A'].id).id, self.f.visits['V1'].id)
        self.env.observations.append({'method': self._testMethodName, 'condition': 'VB no pertenece a A',
            'expected': 'InformeRepository.NotFound', 'obtained': 'InformeRepository.NotFound'})

    def test_06_annulled_visit_characterizes_distinct_predicates(self):
        visit = self.f.visits['VA'].id
        self.value('Listado aplica estado de informe; no estado de visita',
            [r['id'] for r in self.repo.obtener_informes_por_visita(visit)], self.expected_ids('VA'))
        self.value('Detalle excluye visita anulada', self.repo.obtener_informe_por_id(self.f.reports['R7'].id), None)
        self.value('Historial excluye VA', visit in {r['visita_id'] for r in self.history()}, False)
        with self.assertRaises(self.repo.NotFound):
            self.repo.validar_visita(visit, self.f.patients['A'].id)
        self.env.observations.append({'method': self._testMethodName, 'condition': 'validar VA',
            'expected': 'InformeRepository.NotFound', 'obtained': 'InformeRepository.NotFound'})

    def test_07_counts_do_not_multiply_by_eyes_or_versions(self):
        from sqlalchemy import func, select
        rows = {r['visita_id']: r for r in self.history()}
        v1 = rows[self.f.visits['V1'].id]
        self.value('V1 total informes activos con 2 ojos', v1['total_informes'], 2)
        self.value('V1 total ojos', v1['total_ojos_diagnosticados'], 2)
        self.value('V1 bandera IA', v1['tiene_diagnostico_ia'], 1)
        self.value('IDs diagnóstico y visita distintos', self.f.diagnoses['V1'].id != self.f.visits['V1'].id, True)
        self.value('ID IA real en historial', v1['diagnostico_ia']['id'], self.f.diagnoses['V1'].id)
        version_count = self.env.session.execute(select(func.count()).select_from(self.t.InformeVersion)
            .where(self.t.InformeVersion.informe_id == self.f.reports['R1'].id)).scalar_one()
        self.value('Fixture efectivamente tiene dos versiones R1', version_count, 2)
        self.value('Recuento activo sigue independiente de versiones', len(v1['informes']), 2)

    def test_08_patient_reports_are_grouped_under_exact_visit(self):
        rows = self.history()
        self.value('Visitas exactas A (sin VA)', sorted(r['visita_id'] for r in rows),
                   sorted(self.f.visits[v].id for v in ['V1', 'V2', 'V0']))
        by_visit = {r['visita_id']: r for r in rows}
        for visit in ['V1', 'V2', 'V0']:
            with self.subTest(visit=visit):
                row = by_visit[self.f.visits[visit].id]
                self.value('Informes agrupados ' + visit, [r['id'] for r in row['informes']], self.expected_ids(visit))
                self.value('Conteo ' + visit, row['total_informes'], len(self.f.expected[visit]))
        self.value('B conserva solo VB', [r['visita_id'] for r in self.history('B')], [self.f.visits['VB'].id])
        r1 = next(r for r in by_visit[self.f.visits['V1'].id]['informes'] if r['id'] == self.f.reports['R1'].id)
        self.value('Helper extrae conclusión JSON sin conclusión en columna', r1['conclusion'], 'Conclusión sintética R1')

    def test_09_individual_report_filters_report_visit_and_patient(self):
        for label, allowed in [('R1', True), ('R3', False), ('R4', False), ('R7', False), ('R8', False)]:
            with self.subTest(report=label, allowed=allowed):
                row = self.repo.obtener_informe_por_id(self.f.reports[label].id)
                self.value('Detalle permitido ' + label, row is not None, allowed)
                if allowed:
                    self.value('Paciente en detalle', row['paciente']['id'], self.f.patients['A'].id)
                    self.value('Visita en detalle', row['visita']['id'], self.f.visits['V1'].id)
                    self.value('Alias legacy es visita', row['diagnostico_id'], self.f.visits['V1'].id)
        self.value('Listado VI no comprueba paciente activo',
            [r['id'] for r in self.repo.obtener_informes_por_visita(self.f.visits['VI'].id)], self.expected_ids('VI'))

    def test_10_real_early_return_missing_resources_and_read_only_queries(self):
        with patch.object(self.env.session, 'execute', wraps=self.env.session.execute) as execute:
            self.value('Paciente E sin visitas', self.history('E'), [])
            self.value('Retorno temprano: una única consulta SQL real', execute.call_count, 1)
        missing_visit = max(v.id for v in self.f.visits.values()) + 1000000
        missing_report = max(r.id for r in self.f.reports.values()) + 1000000
        self.value('Visita inexistente lista vacía', self.repo.obtener_informes_por_visita(missing_visit), [])
        self.value('Informe inexistente None', self.repo.obtener_informe_por_id(missing_report), None)
        with self.assertRaises(self.repo.NotFound):
            self.repo.validar_visita(missing_visit, self.f.patients['A'].id)
        self.env.observations.append({'method': self._testMethodName, 'condition': 'validar visita inexistente',
            'expected': 'InformeRepository.NotFound', 'obtained': 'InformeRepository.NotFound'})
        # SQL guard is read-only throughout ALL scenario methods, not just this one.
        self.value('Fase de escritura cerrada', self.env.gate['writes'], False)


if __name__ == '__main__':
    unittest.main(verbosity=2)
