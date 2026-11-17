"""Validadores reales con CLIP/torch sustituidos; nunca cargan modelos."""
from contextlib import nullcontext
from io import BytesIO
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch
import sys

from PIL import Image
import cv2  # Cargar dependencias reales antes de restaurar sys.modules en el stub.
import numpy as np


fake_transformers = ModuleType('transformers')
fake_transformers.CLIPModel = Mock()
fake_transformers.CLIPProcessor = Mock()
fake_torch = ModuleType('torch')
fake_torch.no_grad = nullcontext
with patch.dict(sys.modules, {'transformers': fake_transformers, 'torch': fake_torch}):
    spec = spec_from_file_location('b1_only_validator_under_test',
                                   Path(__file__).parent / 'dl_model' / 'validator.py')
    validator = module_from_spec(spec)
    spec.loader.exec_module(validator)


def image_bytes(fmt, size=(400, 400)):
    stream = BytesIO()
    Image.new('RGB', size, 'black').save(stream, format=fmt)
    return stream.getvalue()


class DiagnosisInputTests(TestCase):
    def test_region_rejects_rectangles_and_screens_with_retinal_thumbnails(self):
        for label in ('white_square', 'wide_rectangle', 'retinal_interface', 'two_retinas'):
            with self.subTest(image=label):
                if label == 'two_retinas':
                    image = np.zeros((400, 800, 3), dtype=np.uint8)
                    for x in (200, 600):
                        cv2.circle(image, (x, 200), 185, (60, 100, 180), -1)
                else:
                    width = 400 if label == 'white_square' else 800
                    image = np.full((400, width, 3), 245, dtype=np.uint8)
                    if label == 'retinal_interface':
                        cv2.rectangle(image, (0, 0), (120, 399), (30, 25, 15), -1)
                        cv2.putText(image, 'PATIENT / RESULTS', (150, 60),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
                        for x in (320, 600):
                            cv2.rectangle(image, (x-110, 100), (x+110, 330), (0, 0, 0), -1)
                            cv2.circle(image, (x, 215), 95, (60, 100, 180), -1)
                _, encoded = cv2.imencode('.png', image)
                self.assertFalse(validator.validar_region_circular(encoded.tobytes())['valido'])

    def test_region_preserves_single_round_and_mildly_elliptical_fundus(self):
        for axes, center in (((180, 180), (200, 200)), ((180, 155), (200, 200)),
                             ((200, 200), (200, 200)), ((185, 185), (185, 200))):
            with self.subTest(axes=axes, center=center):
                image = np.zeros((400, 400, 3), dtype=np.uint8)
                cv2.ellipse(image, center, axes, 0, 0, 360, (60, 100, 180), -1)
                _, encoded = cv2.imencode('.png', image)
                self.assertTrue(validator.validar_region_circular(encoded.tobytes())['valido'])

    def test_clip_has_an_explicit_negative_for_interfaces_containing_retinas(self):
        self.assertIn('menus, buttons, text and retinal photographs', validator.CLIP_PROMPTS[7])
        probs = Mock()
        probs.argmax.return_value = 7
        logits = Mock()
        logits.softmax.return_value.squeeze.return_value = probs
        model = Mock(return_value=SimpleNamespace(logits_per_image=logits))
        processor = Mock(return_value={})
        with patch.object(validator, '_get_clip', return_value=(model, processor)):
            result = validator.validar_contenido_semantico(image_bytes('PNG'))
        self.assertFalse(result['valido'])
        self.assertIn('captura de pantalla', result['error'])
        self.assertEqual(processor.call_args.kwargs['text'], validator.CLIP_PROMPTS)

    def test_real_format_limits_and_declared_type(self):
        for fmt, filename, mime in (('JPEG', 's.jpg', 'image/jpeg'),
                                    ('PNG', 's.png', 'image/png'),
                                    ('TIFF', 's.tif', 'image/tiff')):
            with self.subTest(fmt=fmt):
                raw = image_bytes(fmt)
                self.assertTrue(validator.validar_formato_y_dimensiones(
                    raw, filename=filename, mimetype=mime)['valido'])
                for bad_name, bad_mime in ((filename, 'application/octet-stream'),
                                          ('incorrect.gif', mime), ('../s.jpg', mime)):
                    self.assertFalse(validator.validar_formato_y_dimensiones(
                        raw, filename=bad_name, mimetype=bad_mime)['valido'])
        for raw in (b'', b'not an image', image_bytes('PNG', (349, 350))):
            self.assertFalse(validator.validar_formato_y_dimensiones(
                raw, filename='s.png', mimetype='image/png')['valido'])
        for size in ((8193, 350), (6001, 5000)):
            stream = BytesIO()
            Image.new('1', size).save(stream, format='PNG')
            self.assertFalse(validator.validar_formato_y_dimensiones(
                stream.getvalue(), filename='s.png', mimetype='image/png')['valido'])

    def test_clip_success_rejection_and_every_failure_is_closed(self):
        raw = image_bytes('JPEG')
        probs = Mock()
        logits = Mock()
        logits.softmax.return_value.squeeze.return_value = probs
        model = Mock(return_value=SimpleNamespace(logits_per_image=logits))
        processor = Mock(return_value={})
        with patch.object(validator, '_get_clip', return_value=(model, processor)):
            probs.argmax.return_value = 0
            self.assertEqual(validator.validar_contenido_semantico(raw), {'valido': True})
            probs.argmax.return_value = 1
            self.assertFalse(validator.validar_contenido_semantico(raw)['valido'])
            model.side_effect = RuntimeError('synthetic private path')
            unavailable = validator.validar_contenido_semantico(raw)
            self.assertEqual(unavailable['status'], 503)
            self.assertNotIn('synthetic private path', str(unavailable))
            model.side_effect = None
            probs.argmax.side_effect = ValueError('synthetic private error')
            internal = validator.validar_contenido_semantico(raw)
            self.assertEqual(internal['status'], 500)
            self.assertNotIn('synthetic private error', str(internal))
        with patch.object(validator, '_get_clip', side_effect=RuntimeError('synthetic private path')):
            unavailable = validator.validar_contenido_semantico(raw)
            self.assertEqual(unavailable['status'], 503)
            self.assertFalse(unavailable['valido'])
        with patch.object(validator, '_clip_model', None), \
             patch.object(validator.CLIPModel, 'from_pretrained',
                          side_effect=RuntimeError('synthetic model unavailable')):
            unavailable = validator.validar_contenido_semantico(raw)
            self.assertFalse(unavailable['valido'])
            self.assertEqual(unavailable['status'], 503)


class DiagnosisImageGateTests(TestCase):
    """Servicio real y píxeles reales; repositorios, BD e inferencia aislados."""

    def setUp(self):
        from flask import Flask

        self.context = Flask(__name__).app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.repository = Mock()
        self.revisions = Mock()
        self.revisions.capture_inference.return_value = None
        self.session = Mock()
        self.predict = Mock()
        self.confirmations = ModuleType('services.retinograph_confirmation_service')
        self.confirmations.ConfirmationUseError = type('ConfirmationUseError', (Exception,), {})
        for name in ('load_for_inference', 'lock_for_consumption', 'consume_with_detail'):
            setattr(self.confirmations, name, Mock())
        services = ModuleType('services')
        services.retinograph_confirmation_service = self.confirmations

        def stub(name, **attributes):
            result = ModuleType(name)
            result.__dict__.update(attributes)
            return result

        stubs = {
            'database': stub('database', db=SimpleNamespace(session=self.session)),
            'dl_model.validator': validator,
            'dl_model.inference': stub('dl_model.inference', predecir_imagen_bytes=self.predict),
            'src.repositories.diagnosis_repository': stub(
                'src.repositories.diagnosis_repository', DiagnosisRepository=self.repository,
                DiagnosisValidationError=type('DiagnosisValidationError', (Exception,), {})),
            'src.repositories.diagnosis_discard_repository': stub(
                'src.repositories.diagnosis_discard_repository', DiagnosisDiscardRepository=self.revisions),
            'services': services,
            'services.retinograph_confirmation_service': self.confirmations,
            'utils.diagnosis_discard_gate': stub(
                'utils.diagnosis_discard_gate', DiscardError=type('DiscardError', (Exception,), {})),
        }
        spec = spec_from_file_location('isolated_image_gate_service',
                                       Path(__file__).parent / 'services' / 'diagnosis_service.py')
        self.service = module_from_spec(spec)
        with patch.dict(sys.modules, stubs), patch('os.makedirs'):
            spec.loader.exec_module(self.service)
        files = patch.object(self.service, 'DiagnosisFiles')
        self.files = files.start()
        self.addCleanup(files.stop)

    def process(self, raw, confirmed):
        from werkzeug.datastructures import FileStorage

        if confirmed:
            self.confirmations.load_for_inference.return_value = SimpleNamespace(
                data=raw, filename='fixture.png', mimetype='image/png')
            upload = None
        else:
            upload = FileStorage(stream=BytesIO(raw), filename='fixture.png', content_type='image/png')
        return self.service.procesar_diagnostico(
            upload, 7, 1, 'Derecho', 30, confirmacion_token='a' * 64 if confirmed else None)

    def assert_no_inference_or_write(self):
        self.predict.assert_not_called()
        self.files.assert_not_called()
        self.repository.crear_diagnostico_y_detalle.assert_not_called()
        self.session.commit.assert_not_called()
        self.confirmations.lock_for_consumption.assert_not_called()
        self.confirmations.consume_with_detail.assert_not_called()

    def test_screenshot_geometry_blocks_manual_and_confirmed_before_clip(self):
        raw = BytesIO()
        Image.new('RGB', (600, 600), 'white').save(raw, format='PNG')
        for confirmed in (False, True):
            with self.subTest(confirmed=confirmed), \
                    patch.object(self.service, 'validar_contenido_semantico') as semantic:
                response, status = self.process(raw.getvalue(), confirmed)
                self.assertEqual(status, 400)
                self.assertEqual(response['code'], 'IMAGEN_INVALIDA')
                self.assertIn('captura de pantalla', response['message'])
                semantic.assert_not_called()
                self.assert_no_inference_or_write()

    def test_semantic_screenshot_rejection_and_clip_outage_never_predict_or_write(self):
        image = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.circle(image, (200, 200), 180, (60, 100, 180), -1)
        _, encoded = cv2.imencode('.png', image)
        probs = Mock()
        probs.argmax.return_value = 7
        logits = Mock()
        logits.softmax.return_value.squeeze.return_value = probs
        model = Mock(return_value=SimpleNamespace(logits_per_image=logits))
        for confirmed in (False, True):
            for unavailable in (False, True):
                with self.subTest(confirmed=confirmed, unavailable=unavailable), patch.object(
                        validator, '_get_clip', return_value=(model, Mock(return_value={})),
                        side_effect=RuntimeError('synthetic unavailable') if unavailable else None):
                    response, status = self.process(encoded.tobytes(), confirmed)
                    self.assertEqual(status, 503 if unavailable else 422)
                    self.assertEqual(response['code'],
                                     'VALIDADOR_IMAGEN_NO_DISPONIBLE' if unavailable else 'IMAGEN_INVALIDA')
                    self.assert_no_inference_or_write()
