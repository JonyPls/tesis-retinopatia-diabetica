"""Pruebas de almacenamiento privado sin modelos, datos clínicos ni MySQL."""

import errno
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image

from utils.diagnosis_storage import DiagnosisFiles, inspect_candidates


class DiagnosisStorageTests(unittest.TestCase):
    def test_inspection_is_read_only_and_requires_reliable_references(self):
        with tempfile.TemporaryDirectory() as folder:
            files = DiagnosisFiles(folder)
            original = files.prepare(Image.new('RGB', (350, 350)))
            files.publish(original, 'P7_Derecho_' + 'a' * 32 + '.jpg')
            name = next(Path(folder).glob('*.jpg')).name
            self.assertEqual(inspect_candidates(folder, {name}, minimum_age_seconds=0)
                             ['unreferenced_candidates'], [])
            with self.assertRaises(ValueError):
                inspect_candidates(folder, None)
            old = time.time() - 90000
            os.utime(original, (old, old))
            os.utime(Path(folder) / name, (old, old))
            self.assertEqual(inspect_candidates(folder, set(), minimum_age_seconds=86400),
                             {'temporary_candidates': [], 'unreferenced_candidates': []})
            files.release()
            result = inspect_candidates(folder, set(), minimum_age_seconds=86400)
            self.assertEqual(result['unreferenced_candidates'], [name])
            self.assertEqual(result['temporary_candidates'], [original.name])
            self.assertTrue((Path(folder) / name).exists())
            self.assertTrue(original.exists())

    def test_exclusive_fallback_never_overwrites_other_file(self):
        with tempfile.TemporaryDirectory() as folder:
            files = DiagnosisFiles(folder)
            original = files.prepare(Image.new('RGB', (350, 350)))
            name = 'P7_Derecho_' + 'b' * 32 + '.jpg'
            target = Path(folder) / name
            target.write_bytes(b'previous')
            with patch('utils.diagnosis_storage.os.link',
                       side_effect=OSError(errno.ENOTSUP, 'synthetic unsupported')):
                with self.assertRaises(FileExistsError):
                    files.publish(original, name)
                self.assertEqual(target.read_bytes(), b'previous')
                target.unlink()
                files.publish(original, name)
            self.assertEqual(files._identity(target), files.published[name])
            files.cleanup(published=True)
            files.release()
            self.assertFalse(target.exists())
            self.assertFalse(original.exists())

    def test_partial_provisional_write_can_be_cleaned_without_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            files = DiagnosisFiles(folder)
            def partial_write(image, output, *args, **kwargs):
                output.write(b'incomplete')
                raise OSError('synthetic interrupted write')
            with patch.object(Image.Image, 'save', partial_write):
                with self.assertRaises(OSError):
                    files.prepare(Image.new('RGB', (350, 350)))
            self.assertEqual(len(files.temporary), 1)
            files.cleanup(published=True)
            files.release()
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])
            self.assertEqual(list(Path(folder).glob('*.jpg')), [])
