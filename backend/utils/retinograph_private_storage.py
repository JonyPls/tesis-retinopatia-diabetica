"""Copia privada de bytes ya validados; raíz preexistente y no servida por HTTP.

El operador debe proteger la raíz frente a otros escritores con privilegios.
Nunca se crea un directorio a partir de una ruta enviada por el cliente.
"""

import errno
import hashlib
import hmac
import os
import re
from contextlib import contextmanager
from pathlib import Path
import secrets
import stat
import sys

from flask import current_app

from utils.retinograph_storage import _open_windows, UnsafeExportError, ExportRootError


class PrivateStorageError(Exception):
    pass


class PrivateCopyChangedError(PrivateStorageError):
    pass


_KEY = re.compile(r'[0-9a-f]{32}\Z')
_SHA = re.compile(r'[0-9a-f]{64}\Z')


def _within(child, parent):
    try:
        return os.path.commonpath((child, parent)) == parent
    except ValueError:
        return False


@contextmanager
def _private_root():
    configured = current_app.config.get('RETINOGRAPH_PRIVATE_DIR')
    if not isinstance(configured, str) or not os.path.isabs(configured):
        raise PrivateStorageError()
    root = Path(os.path.abspath(configured))
    public = (Path(__file__).resolve().parents[1] / 'uploads',
              Path.cwd() / 'uploads')
    if current_app.static_folder:
        public += (Path(current_app.static_folder),)
    if any(_within(os.path.normcase(str(root)), os.path.normcase(str(folder.resolve())))
           for folder in public):
        raise PrivateStorageError()
    if sys.platform == 'win32':
        try:
            # Ancestros abiertos sin compartir WRITE/DELETE y sin reparse points.
            with _open_windows(str(root), None):
                yield root, None
        except (OSError, UnsafeExportError, ExportRootError) as error:
            raise PrivateStorageError() from error
    elif os.name == 'posix' and hasattr(os, 'O_NOFOLLOW') and os.open in os.supports_dir_fd:
        fd = None
        try:
            for component in root.parts:
                new_fd = (os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                          if fd is None else os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                                      dir_fd=fd))
                if fd is not None:
                    os.close(fd)
                fd = new_fd
            if fd is None:
                raise PrivateStorageError()
            yield root, fd
        except OSError as error:
            raise PrivateStorageError() from error
        finally:
            if fd is not None:
                os.close(fd)
    else:
        raise PrivateStorageError()


class PrivateCopy:
    def __init__(self):
        self.key = secrets.token_hex(16)
        self.stage = secrets.token_hex(16) + '.part'
        self.owned = {}  # nombre -> (device, inode); nunca eliminar nombres ajenos.

    @staticmethod
    def _path(root, name, dir_fd):
        return name if dir_fd is not None else str(root / name)

    def _open_new(self, root, dir_fd, name):
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0)
        if dir_fd is not None:
            flags |= os.O_NOFOLLOW
        fd = os.open(self._path(root, name, dir_fd), flags, 0o600,
                     **({'dir_fd': dir_fd} if dir_fd is not None else {}))
        identity = os.fstat(fd)
        self.owned[name] = (identity.st_dev, identity.st_ino)
        return fd

    def _verify_fd(self, fd, data):
        os.lseek(fd, 0, os.SEEK_SET)
        digest = hashlib.sha256()
        size = 0
        while chunk := os.read(fd, 1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
        if size != len(data) or digest.digest() != hashlib.sha256(data).digest():
            raise PrivateStorageError()

    def publish(self, data):
        try:
            with _private_root() as (root, dir_fd):
                fd = self._open_new(root, dir_fd, self.stage)
                try:
                    with os.fdopen(fd, 'w+b') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                        self._verify_fd(stream.fileno(), data)
                        source = self._path(root, self.stage, dir_fd)
                        target = self._path(root, self.key, dir_fd)
                        try:
                            os.link(source, target, follow_symlinks=False,
                                    **({'src_dir_fd': dir_fd, 'dst_dir_fd': dir_fd}
                                       if dir_fd is not None else {}))
                        except OSError as error:
                            if error.errno not in (errno.EPERM, errno.ENOTSUP, errno.ENOSYS):
                                raise
                            # Sin hard links: destino creado de forma exclusiva.
                            final_fd = self._open_new(root, dir_fd, self.key)
                            with os.fdopen(final_fd, 'w+b') as final:
                                final.write(data)
                                final.flush()
                                os.fsync(final.fileno())
                                self._verify_fd(final.fileno(), data)
                        else:
                            identity = os.fstat(stream.fileno())
                            self.owned[self.key] = (identity.st_dev, identity.st_ino)
                        # En ambos modos, comparar también el destino publicado.
                        verify_fd = os.open(target, os.O_RDONLY | getattr(os, 'O_BINARY', 0) |
                                            (os.O_NOFOLLOW if dir_fd is not None else 0),
                                            **({'dir_fd': dir_fd} if dir_fd is not None else {}))
                        with os.fdopen(verify_fd, 'rb') as verified:
                            identity = os.fstat(verified.fileno())
                            if (not stat.S_ISREG(identity.st_mode) or
                                    (identity.st_dev, identity.st_ino) != self.owned[self.key]):
                                raise PrivateStorageError()
                            self._verify_fd(verified.fileno(), data)
                finally:
                    self._remove(root, dir_fd, self.stage)
        except (OSError, ValueError) as error:
            raise PrivateStorageError() from error

    def _remove(self, root, dir_fd, name):
        identity = self.owned.get(name)
        if identity is None:
            return
        try:
            entry = os.stat(self._path(root, name, dir_fd), follow_symlinks=False,
                            **({'dir_fd': dir_fd} if dir_fd is not None else {}))
            if stat.S_ISREG(entry.st_mode) and (entry.st_dev, entry.st_ino) == identity:
                os.unlink(self._path(root, name, dir_fd),
                          **({'dir_fd': dir_fd} if dir_fd is not None else {}))
        except FileNotFoundError:
            pass

    def compensate(self):
        # Solo ante rollback cierto: un commit ambiguo exige conservar la copia.
        try:
            with _private_root() as (root, dir_fd):
                self._remove(root, dir_fd, self.stage)
                self._remove(root, dir_fd, self.key)
        except (OSError, PrivateStorageError):
            pass  # Nunca eliminar un recurso por nombre sin verificar su identidad.


def read_private_copy(key, sha256, *, limit):
    """Lee bytes limitados de la copia por un descriptor confinado, sin rutas públicas."""
    if (not isinstance(key, str) or not _KEY.fullmatch(key) or
            not isinstance(sha256, str) or not _SHA.fullmatch(sha256) or
            type(limit) is not int or not 0 < limit <= 20 * 1024 * 1024):
        raise PrivateStorageError()
    try:
        with _private_root() as (root, dir_fd):
            if dir_fd is None:
                # Reusar la comprobación Windows de ancestros/archivo con el
                # mismo handle; no abrir luego un nombre no verificado.
                opener = _open_windows(str(root), key)
            else:
                @contextmanager
                def opener():
                    fd = os.open(key, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_NONBLOCK', 0),
                                 dir_fd=dir_fd)
                    try:
                        yield fd
                    finally:
                        os.close(fd)
                opener = opener()
            with opener as fd:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
                    raise PrivateCopyChangedError()
                with os.fdopen(os.dup(fd), 'rb') as stream:
                    data = stream.read(limit + 1)
                after = os.fstat(fd)
                if (len(data) != before.st_size or
                        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
                        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or
                        not hmac.compare_digest(hashlib.sha256(data).hexdigest(), sha256)):
                    raise PrivateCopyChangedError()
                return data
    except (OSError, UnsafeExportError, ExportRootError) as error:
        raise PrivateStorageError() from error
