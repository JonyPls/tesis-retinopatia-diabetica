"""CB-04: actual validators/service/storage; synthetic pixels, no real models."""
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image, ImageDraw
from flask import Flask
from werkzeug.datastructures import FileStorage
from codn_test_support import photo_targets, DiagnosisValidationError
from utils.diagnosis_storage import DiagnosisFiles

validator, service = photo_targets()


def pixels(size=(400, 400), radius=180, fmt='PNG'):
    image = Image.new('RGB', size, 'black')
    if radius:
        x, y = size[0] // 2, size[1] // 2
        ImageDraw.Draw(image).ellipse((x-radius, y-radius, x+radius, y+radius), fill=(180, 100, 50))
    buffer = BytesIO()
    image.save(buffer, fmt)
    return buffer.getvalue()


class DiagnosisLogicTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        ctx = self.app.app_context()
        ctx.push()
        self.addCleanup(ctx.pop)
        self.folder = tempfile.TemporaryDirectory(prefix='codn-cb04-')
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.foreign = self.root / 'foreign-control.txt'
        self.foreign.write_bytes(b'synthetic-other-operation')
        folder_patch = patch.object(service, 'UPLOAD_FOLDER', str(self.root))
        folder_patch.start()
        self.addCleanup(folder_patch.stop)
        for mock in [service.db, service.DiagnosisRepository, service.DiagnosisDiscardRepository,
                     service.predecir_imagen_bytes]:
            mock.reset_mock(return_value=True, side_effect=True)
        service.DiagnosisRepository.crear_diagnostico_y_detalle.return_value = (901, 801, 701)
        service.DiagnosisDiscardRepository.capture_inference.return_value = None
        self.raw = pixels()

    def predict(self):
        return {'diagnostico_codigo': 2, 'diagnostico_texto': 'RD Moderado', 'confianza_general': 87.5,
                'probabilidades_detalle': [2, 3, 87.5, 5, 2.5],
                'cam_image_array': np.zeros((400, 400, 3), dtype=np.uint8)}

    def run_service(self, raw=None):
        upload = FileStorage(stream=BytesIO(self.raw if raw is None else raw), filename='synthetic.png', content_type='image/png')
        return service.procesar_diagnostico(upload, 501, 42, 'Derecho', 901)

    def semantic(self, winner=0):
        probs = Mock()
        probs.argmax.return_value = winner
        logits = Mock()
        logits.softmax.return_value.squeeze.return_value = probs
        model = Mock(return_value=type('Output', (), {'logits_per_image': logits})())
        processor = Mock(return_value={})
        return model, processor, probs

    def assert_no_write(self):
        service.predecir_imagen_bytes.assert_not_called()
        service.DiagnosisRepository.crear_diagnostico_y_detalle.assert_not_called()
        service.db.session.commit.assert_not_called()
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['foreign-control.txt'])

    def test_real_format_dimension_and_declared_type_boundaries(self):
        cases = [('jpeg', pixels(fmt='JPEG'), 'fixture.jpg', 'image/jpeg', True),
                 ('png350', pixels(size=(350, 350), radius=150), 'fixture.png', 'image/png', True),
                 ('tiff', pixels(fmt='TIFF'), 'fixture.tif', 'image/tiff', True),
                 ('empty', b'', 'fixture.png', 'image/png', False),
                 ('corrupt', b'corrupt synthetic bytes', 'fixture.png', 'image/png', False),
                 ('gif', pixels(fmt='GIF'), 'fixture.gif', 'image/gif', False),
                 ('349px', pixels(size=(349, 350), radius=150), 'fixture.png', 'image/png', False),
                 ('wrong_mime', self.raw, 'fixture.png', 'image/jpeg', False),
                 ('path', self.raw, '../fixture.png', 'image/png', False)]
        for label, raw, name, mime, valid in cases:
            with self.subTest(case=label):
                self.assertEqual(validator.validar_formato_y_dimensiones(raw, filename=name, mimetype=mime)['valido'], valid)
        # Lower configured caps exercise upper bounds without large allocations.
        for limits in [{'max_side': 399}, {'max_pixels': 159999}]:
            with self.subTest(limits=limits):
                self.assertFalse(validator.validar_formato_y_dimensiones(self.raw, **limits)['valido'])
        service.predecir_imagen_bytes.assert_not_called()

    def test_real_region_accepts_dominant_and_rejects_empty_small_or_corrupt(self):
        for label, raw, valid in [('dominant', self.raw, True), ('black', pixels(radius=0), False),
                                  ('small', pixels(radius=30), False), ('corrupt', b'not pixels', False)]:
            with self.subTest(case=label):
                self.assertEqual(validator.validar_region_circular(raw)['valido'], valid)

    def test_real_semantic_decisions_and_dependency_errors_are_controlled(self):
        for mode in ['accepted', 'rejected', 'load_error', 'processor_error', 'model_error', 'invalid_argmax', 'corrupt']:
            with self.subTest(mode=mode):
                model, processor, probs = self.semantic(1 if mode == 'rejected' else 0)
                if mode == 'processor_error':
                    processor.side_effect = RuntimeError('synthetic-private-detail')
                if mode == 'model_error':
                    model.side_effect = RuntimeError('synthetic-private-detail')
                if mode == 'invalid_argmax':
                    probs.argmax.side_effect = ValueError('synthetic-private-detail')
                with patch.object(validator, '_get_clip', return_value=(model, processor),
                                  side_effect=RuntimeError('synthetic-private-detail') if mode == 'load_error' else None):
                    response = validator.validar_contenido_semantico(b'corrupt' if mode == 'corrupt' else self.raw)
                self.assertEqual(response['valido'], mode == 'accepted')
                self.assertNotIn('synthetic-private-detail', str(response))
                if mode in ['load_error', 'model_error', 'processor_error']:
                    self.assertEqual(response['status'], 503)
                if mode in ['invalid_argmax', 'corrupt']:
                    self.assertEqual(response['status'], 500)
                if mode in ['load_error', 'corrupt']:
                    model.assert_not_called()
                    processor.assert_not_called()

    def test_pipeline_preflight_bytes_format_and_region_stop_following_stages(self):
        for mode in ['preflight', 'oversize', 'corrupt', 'too_small', 'black']:
            with self.subTest(mode=mode):
                service.DiagnosisRepository.reset_mock(return_value=False, side_effect=True)
                service.db.reset_mock(return_value=True, side_effect=True)
                service.DiagnosisRepository.comprobar_creacion.side_effect = DiagnosisValidationError() if mode == 'preflight' else None
                raw = {'corrupt': b'corrupt', 'too_small': pixels(size=(349, 350)), 'black': pixels(radius=0)}.get(mode, self.raw)
                self.app.config['DIAGNOSIS_MAX_IMAGE_BYTES'] = 4 if mode == 'oversize' else validator.MAX_IMAGE_BYTES
                with patch.object(service, 'validar_contenido_semantico') as semantic, \
                     patch.object(service, 'validar_region_circular', wraps=validator.validar_region_circular) as region:
                    _, status = self.run_service(raw)
                self.assertEqual(status, {'preflight': 404, 'oversize': 413}.get(mode, 400))
                semantic.assert_not_called()
                if mode != 'black':
                    region.assert_not_called()
                self.assert_no_write()

    def test_semantic_rejection_and_unavailable_service_prevent_inference(self):
        for mode in ['rejected', 'unavailable', 'internal']:
            with self.subTest(mode=mode):
                model, processor, probs = self.semantic(1)
                if mode == 'internal':
                    probs.argmax.side_effect = ValueError('synthetic failure')
                with patch.object(validator, '_get_clip', return_value=(model, processor),
                                  side_effect=RuntimeError('synthetic unavailable') if mode == 'unavailable' else None):
                    response, status = self.run_service()
                self.assertEqual(status, {'rejected': 422, 'unavailable': 503, 'internal': 500}[mode])
                if mode == 'unavailable':
                    self.assertEqual(response['code'], 'VALIDADOR_IMAGEN_NO_DISPONIBLE')
                self.assert_no_write()

    def test_success_uses_real_validators_and_jpeg_storage_with_simulated_prediction(self):
        model, processor, _ = self.semantic()
        service.predecir_imagen_bytes.return_value = self.predict()
        with patch.object(validator, '_get_clip', return_value=(model, processor)):
            response, status = self.run_service()
        self.assertEqual(status, 200)
        service.predecir_imagen_bytes.assert_called_once_with(self.raw)
        service.DiagnosisRepository.comprobar_creacion.assert_called_once_with(501, 'Derecho', 901, require_existing_diagnosis=False)
        args, kwargs = service.DiagnosisRepository.crear_diagnostico_y_detalle.call_args
        values, visit = args
        self.assertEqual((values['paciente_id'], values['usuario_id'], values['ojo_evaluado'], visit), (501, 42, 'Derecho', 901))
        self.assertEqual(values['probabilidad_ia'], .875)
        self.assertEqual(values['resultado_ia'], 2)
        self.assertEqual(kwargs, {'require_existing_diagnosis': False, 'inference_revision': None})
        self.assertEqual([response['data'][key] for key in ['visita_id', 'diagnostico_retinopatia_id', 'detalle_id']], [901, 801, 701])
        self.assertEqual(len(list(self.root.glob('*.jpg'))), 2)
        self.assertEqual(list((self.root / '.pending').iterdir()), [])
        for path in self.root.glob('*.jpg'):
            with Image.open(path) as image:
                self.assertEqual(image.format, 'JPEG')
                image.verify()
        self.assertEqual(self.foreign.read_bytes(), b'synthetic-other-operation')
        service.db.session.commit.assert_called_once_with()
        service.db.session.rollback.assert_called_once_with()  # release initial read snapshot

    def test_precommit_insert_prepare_or_publication_failure_compensates_only_owned_files(self):
        for stage in ['prepare_second', 'insert', 'publish_second']:
            with self.subTest(stage=stage):
                service.db.reset_mock(return_value=True, side_effect=True)
                service.DiagnosisRepository.reset_mock(return_value=False, side_effect=True)
                service.predecir_imagen_bytes.reset_mock(return_value=False, side_effect=True)
                service.predecir_imagen_bytes.return_value = self.predict()
                instances = []
                def factory(root):
                    files = DiagnosisFiles(root)
                    instances.append(files)
                    if stage == 'prepare_second':
                        original = files.prepare
                        files.prepare = Mock(side_effect=lambda image: original(image) if not files.temporary else (_ for _ in ()).throw(OSError('synthetic prepare failure')))
                    if stage == 'publish_second':
                        original = files.publish
                        files.publish = Mock(side_effect=lambda temporary, name: original(temporary, name) if not files.published else (_ for _ in ()).throw(OSError('synthetic publish failure')))
                    return files
                if stage == 'insert':
                    service.DiagnosisRepository.crear_diagnostico_y_detalle.side_effect = RuntimeError('synthetic-private-detail')
                model, processor, _ = self.semantic()
                with patch.object(validator, '_get_clip', return_value=(model, processor)), patch.object(service, 'DiagnosisFiles', side_effect=factory):
                    response, status = self.run_service()
                self.assertEqual(status, 500)
                self.assertNotIn('synthetic-private-detail', str(response))
                self.assertEqual(service.db.session.rollback.call_count, 2)
                service.db.session.commit.assert_not_called()
                service.predecir_imagen_bytes.assert_called_once_with(self.raw)
                self.assertEqual(list(self.root.glob('*.jpg')), [])
                self.assertEqual(list((self.root / '.pending').iterdir()), [])
                self.assertEqual(instances[0].active_names, set())
                self.assertEqual(self.foreign.read_bytes(), b'synthetic-other-operation')

    def test_uncertain_commit_consults_independent_mock_connection_and_conserves_safely(self):
        for mode in ['row_exists', 'row_absent', 'lookup_error', 'rollback_error']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix='codn-uncertain-') as directory:
                service.db.reset_mock(return_value=True, side_effect=True)
                service.predecir_imagen_bytes.reset_mock(return_value=False, side_effect=True)
                service.predecir_imagen_bytes.return_value = self.predict()
                service.db.session.commit.side_effect = RuntimeError('synthetic ack lost')
                if mode == 'rollback_error':
                    service.db.session.rollback.side_effect = [None, RuntimeError('synthetic rollback failure')]
                connection = service.db.engine.connect.return_value.__enter__.return_value
                connection.execute.return_value.first.return_value = None if mode in ['row_absent', 'rollback_error'] else ('original', 'gradcam')
                if mode == 'lookup_error':
                    service.db.engine.connect.side_effect = RuntimeError('synthetic lookup failure')
                instances = []
                def factory(root):
                    files = DiagnosisFiles(root)
                    instances.append(files)
                    return files
                model, processor, _ = self.semantic()
                with patch.object(service, 'UPLOAD_FOLDER', directory), patch.object(service, 'DiagnosisFiles', side_effect=factory), \
                     patch.object(validator, '_get_clip', return_value=(model, processor)):
                    response, status = self.run_service()
                self.assertEqual(status, 500)
                self.assertFalse(response['success'])
                service.db.session.commit.assert_called_once_with()
                self.assertEqual(service.db.session.rollback.call_count, 2)
                service.predecir_imagen_bytes.assert_called_once_with(self.raw)
                service.db.engine.connect.assert_called_once_with()
                if mode != 'lookup_error':
                    connection.execute.assert_called_once()
                    self.assertEqual(connection.execute.call_args.args[1], {'id': 701})
                self.assertEqual(len(list(Path(directory).glob('*.jpg'))), 0 if mode == 'row_absent' else 2)
                self.assertEqual(list((Path(directory) / '.pending').iterdir()), [])
                self.assertEqual(instances[0].active_names, set())

    def test_storage_never_overwrites_or_removes_foreign_file(self):
        files = DiagnosisFiles(self.root)
        original = files.prepare(Image.new('RGB', (350, 350)))
        name = 'P501_Derecho_' + 'a' * 32 + '.jpg'
        target = self.root / name
        target.write_bytes(b'synthetic other owner')
        with self.assertRaises(FileExistsError):
            files.publish(original, name)
        files.cleanup(published=True)
        files.release()
        self.assertEqual(target.read_bytes(), b'synthetic other owner')
        self.assertFalse(original.exists())
        self.assertEqual(files.active_names, set())


if __name__ == '__main__':
    unittest.main(verbosity=2)
