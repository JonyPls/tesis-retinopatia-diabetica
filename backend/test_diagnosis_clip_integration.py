"""Prueba opt-in con captura externa y CLIP local; sin BD, ResNet50 ni descargas.

Defina DIAGNOSIS_SCREENSHOT_TEST_IMAGE con la ruta de una captura inválida.
La imagen no se copia al repositorio ni se incluye en los resultados del test.
"""
import io
import os
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest import TestCase, skipUnless


@skipUnless(os.environ.get('DIAGNOSIS_SCREENSHOT_TEST_IMAGE'),
            'Requiere una captura local explícita: DIAGNOSIS_SCREENSHOT_TEST_IMAGE')
class RealScreenshotValidationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        from transformers import CLIPModel, CLIPProcessor

        spec = spec_from_file_location('real_clip_image_validator',
                                       Path(__file__).parent / 'dl_model' / 'validator.py')
        cls.validator = module_from_spec(spec)
        spec.loader.exec_module(cls.validator)
        # Fallar si no está en caché: estas pruebas jamás descargan pesos.
        cls.validator._clip_model = CLIPModel.from_pretrained(
            cls.validator.CLIP_MODEL_ID, local_files_only=True).eval()
        cls.validator._clip_processor = CLIPProcessor.from_pretrained(
            cls.validator.CLIP_MODEL_ID, local_files_only=True)
        cls.raw = Path(os.environ['DIAGNOSIS_SCREENSHOT_TEST_IMAGE']).read_bytes()

    def test_readable_screenshot_is_rejected_by_geometry(self):
        from PIL import Image

        with Image.open(io.BytesIO(self.raw)) as image:
            image.load()
        self.assertFalse(self.validator.validar_region_circular(self.raw)['valido'])

    def test_real_clip_independently_rejects_screenshot_containing_retinas(self):
        result = self.validator.validar_contenido_semantico(self.raw)
        self.assertFalse(result['valido'])
        self.assertNotIn('status', result)  # Rechazo semántico, no indisponibilidad del modelo.
        self.assertIn('captura de pantalla', result['error'])
