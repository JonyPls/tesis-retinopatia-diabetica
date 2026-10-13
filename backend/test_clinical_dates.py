"""Synthetic temporal contract tests; no database or real patient data."""

from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from pypdf import PdfReader
from reportlab.platypus import Paragraph

from utils.clinical_dates import (civil_date, unverified_clinical_fields,
                                  unverified_wall_time, utc_instant)


class ClinicalDateContracts(unittest.TestCase):
    def test_aware_and_explicit_naive_utc(self):
        moment = datetime(2030, 1, 2, 0, 30, 1, 123456, timezone.utc)
        self.assertEqual(utc_instant(moment), '2030-01-02T00:30:01.123456Z')
        self.assertEqual(utc_instant(moment.astimezone(timezone(timedelta(hours=-5)))),
                         '2030-01-02T00:30:01.123456Z')
        self.assertEqual(utc_instant(moment.replace(tzinfo=None), naive_origin='UTC'),
                         '2030-01-02T00:30:01.123456Z')

    def test_unknown_naive_cannot_claim_utc(self):
        moment = datetime(2030, 1, 1, 19, 30)
        with self.assertRaises(ValueError):
            utc_instant(moment)
        self.assertEqual(unverified_wall_time(moment), '2030-01-01T19:30:00')
        self.assertNotIn('GMT', unverified_wall_time(moment))
        self.assertIsNone(unverified_wall_time(None))

    def test_civil_dates_and_nested_unverified_projection(self):
        self.assertEqual(civil_date(date(2000, 1, 1)), '2000-01-01')
        with self.assertRaises(TypeError):
            civil_date(datetime(2000, 1, 1))
        original = {'fecha_nacimiento': date(2000, 1, 1), 'data': [{
            'fecha_visita': datetime(2030, 1, 2),
            'diagnostico_ia': {'detalles': [{'fecha_validacion': datetime(2030, 1, 3)}]},
        }]}
        result = unverified_clinical_fields(original)
        self.assertEqual(result['fecha_nacimiento'], '2000-01-01')
        self.assertEqual(result['data'][0]['fecha_visita'], '2030-01-02T00:00:00')
        self.assertEqual(result['data'][0]['diagnostico_ia']['detalles'][0]['fecha_validacion'],
                         '2030-01-03T00:00:00')
        self.assertIsInstance(original['data'][0]['fecha_visita'], datetime)

    def test_pdf_timezone_boundary_and_ambiguous_record(self):
        from services import report_service
        utc = datetime(2030, 1, 2, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(report_service._format_datetime(utc), '01/01/2030 19:30')
        # Windows without IANA tzdata: documented Lima fixed-offset fallback,
        # only tested for this synthetic contemporary date (not historic DST).
        with patch.object(report_service, 'LOCAL_TZ', timezone(timedelta(hours=-5))):
            self.assertEqual(report_service._format_datetime(utc), '01/01/2030 19:30')
        with patch.object(report_service, 'LOCAL_TZ', None):
            with self.assertRaises(report_service.ReportTemplateError):
                report_service._format_datetime(utc)
        self.assertEqual(report_service._format_datetime(datetime(2030, 1, 2, 0, 30)),
                         'Fecha pendiente de conciliación')
        self.assertEqual(report_service._format_datetime(date(2000, 1, 1), include_time=False),
                         '01/01/2000')

        patient = SimpleNamespace(nombres='Paciente', apellidos='Sintetico',
                                  nro_documento='DOC-SINTETICO', sexo='Femenino',
                                  fecha_nacimiento=date(2000, 1, 1), tipo_documento=None)
        visit = SimpleNamespace(fecha_visita=datetime(2030, 1, 2, 0, 30),
                                paciente=patient, usuario_id=1, motivo_consulta=None,
                                estado='ACTIVA')
        diagnosis = SimpleNamespace(estado='PROCESADO', modelo_nombre='Modelo sintético',
                                    modelo_version='1', detalles=[SimpleNamespace(ojo_evaluado='Derecho')])
        with (patch.object(report_service, 'VisitaClinica') as visits,
              patch.object(report_service, 'Diagnostico') as diagnoses,
              patch.object(report_service, 'Usuario') as users,
              patch.object(report_service, '_apply_institutional_template', side_effect=lambda value: value),
              patch.object(report_service, '_build_eye_section',
                           side_effect=lambda detail, styles: Paragraph('Ojo sintetico', styles['Normal'])),
              patch.object(report_service, '_local_now', return_value=utc)):
            visits.query.filter.return_value.first.return_value = visit
            diagnoses.query.filter.return_value.first.return_value = diagnosis
            users.query.get.return_value = None
            content, name = report_service.generar_reporte_diagnostico_pdf(1)
        self.assertIn('fecha-no-conciliada.pdf', name)
        pdf = ' '.join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertIn('Fecha pendiente de conciliación', pdf)
        self.assertIn('01/01/2030 19:30', pdf)
        self.assertIn('01/01/2000', pdf)


if __name__ == '__main__':
    unittest.main()
