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
