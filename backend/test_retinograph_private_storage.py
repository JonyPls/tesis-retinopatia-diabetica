"""Pruebas aisladas del almacenamiento privado, sin BD ni imágenes clínicas."""

import errno
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from flask import Flask

from utils.retinograph_private_storage import PrivateCopy, PrivateStorageError


class PrivateRetinographStorageTests(unittest.TestCase):
    def setUp(self):
        approved = r'C:\Users\ricar\AppData\Local\Temp\opencode' if os.name == 'nt' else None
        self.temp = tempfile.TemporaryDirectory(prefix='b1-private-', dir=approved)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'private'
        self.root.mkdir()
        self.app = Flask(__name__)
        self.app.config['RETINOGRAPH_PRIVATE_DIR'] = str(self.root)
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)

    def test_exact_bytes_fallback_and_restricted_location(self):
        for fallback in (False, True):
            with self.subTest(fallback=fallback):
                data = os.urandom(1200)
                copy = PrivateCopy()
                if fallback:
                    with patch('utils.retinograph_private_storage.os.link',
                               side_effect=OSError(errno.ENOTSUP, 'synthetic')):
                        copy.publish(data)
                else:
                    copy.publish(data)
                self.assertEqual((self.root / copy.key).read_bytes(), data)
                self.assertEqual(len(copy.key), 32)
                self.assertFalse((self.root / copy.stage).exists())
                copy.compensate()
                self.assertFalse((self.root / copy.key).exists())
        self.app.config['RETINOGRAPH_PRIVATE_DIR'] = 'relative/private'
        with self.assertRaises(PrivateStorageError):
            PrivateCopy().publish(b'bytes')

    def test_no_overwrite_or_unrelated_file_deleted_on_failure(self):
        other = self.root / ('a' * 32)
        other.write_bytes(b'previous')
        with patch('utils.retinograph_private_storage.secrets.token_hex',
                   side_effect=['a' * 32, 'b' * 32]):
            copy = PrivateCopy()
        with self.assertRaises(PrivateStorageError):
            copy.publish(b'new')
        copy.compensate()
        self.assertEqual(other.read_bytes(), b'previous')
        self.assertEqual(list(self.root.iterdir()), [other])

    def test_failure_cleans_only_own_provisional_file(self):
        other = self.root / 'unrelated'
        other.write_bytes(b'keep')
        copy = PrivateCopy()
        with patch('utils.retinograph_private_storage.os.fsync',
                   side_effect=OSError(errno.EIO, 'synthetic')):
            with self.assertRaises(PrivateStorageError):
                copy.publish(b'synthetic')
        copy.compensate()
        self.assertEqual(list(self.root.iterdir()), [other])

    def test_reparse_or_symlink_root_rejected(self):
        alias = Path(self.temp.name) / 'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('La plataforma no permite crear symlinks de prueba.')
        self.app.config['RETINOGRAPH_PRIVATE_DIR'] = str(alias)
        with self.assertRaises(PrivateStorageError):
            PrivateCopy().publish(b'synthetic')
        self.assertEqual(list(self.root.iterdir()), [])
