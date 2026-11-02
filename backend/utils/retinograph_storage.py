"""Lectura acotada de exportaciones: solo descriptores confinados, sin rutas públicas.

La comprobación de contenido no certifica paciente, ojo ni origen clínico.
"""

import io
import errno
import os
import stat
import sys
import warnings
from contextlib import contextmanager
from pathlib import Path

from flask import current_app, has_app_context
from PIL import Image


MAX_BYTES = 20 * 1024 * 1024
MAX_SIDE = 8192
MAX_PIXELS = 30_000_000
MIN_SIDE = 350
IMAGE_FORMATS = {
    "jpg": ("JPEG", "image/jpeg"), "jpeg": ("JPEG", "image/jpeg"),
    "png": ("PNG", "image/png"),
    "tif": ("TIFF", "image/tiff"), "tiff": ("TIFF", "image/tiff"),
}


class UnsafeExportError(Exception):
    """El recurso no es un archivo exportado técnicamente admisible."""


class ExportRootError(Exception):
    """No se puede acreditar el confinamiento del directorio configurado."""


class OversizeExportError(UnsafeExportError):
    """Exportación que supera el límite de bytes."""


@contextmanager
def _open_posix(root, name):
    # Abrir cada componente relativo al descriptor anterior: nunca seguir
    # enlaces, incluso si se cambia un ancestro durante la operación.
    if not os.path.isabs(root):
        raise ExportRootError()
    components = Path(os.path.abspath(root)).parts
    if not components or components[0] != os.path.sep:
        raise ExportRootError()
    fd = None
    try:
        fd = os.open(components[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for component in components[1:]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        if name is None:
            yield os.listdir(fd)
            return
        try:
            file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=fd)
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise UnsafeExportError() from exc
            raise
        try:
            yield file_fd
        finally:
            os.close(file_fd)
    finally:
        if fd is not None:
            os.close(fd)


@contextmanager
def _open_windows(root, name, *, for_delete=False):
    # CreateFileW + OPEN_REPARSE_POINT impide seguir enlaces/junctions. Se
    # conservan abiertos todos los ancestros (sin FILE_SHARE_DELETE ni WRITE)
    # y el archivo hasta terminar la lectura; no se reabre por su ruta.
    import ctypes
    import msvcrt
    from ctypes import wintypes

    if not os.path.isabs(root):
        raise ExportRootError()
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                       wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    class FileInfo(ctypes.Structure):
        _fields_ = [("attributes", wintypes.DWORD), ("created", wintypes.FILETIME),
                    ("accessed", wintypes.FILETIME), ("written", wintypes.FILETIME),
                    ("volume", wintypes.DWORD), ("size_high", wintypes.DWORD),
                    ("size_low", wintypes.DWORD), ("links", wintypes.DWORD),
                    ("index_high", wintypes.DWORD), ("index_low", wintypes.DWORD)]
    information = kernel.GetFileInformationByHandle
    information.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInfo)]
    information.restype = wintypes.BOOL
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    close.restype = wintypes.BOOL
    final_path = kernel.GetFinalPathNameByHandleW
    final_path.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    final_path.restype = wintypes.DWORD

    REPARSE = 0x400
    DIRECTORY = 0x10
    flags = 0x00200000 | 0x02000000  # OPEN_REPARSE_POINT | BACKUP_SEMANTICS
    root = os.path.normpath(root)

    def checked_open(path, directory):
        access = 0x80 if directory else 0x80000000 | (0x10000 if for_delete else 0)
        handle = create(path, access, 0x1,
                        None, 3, flags, None)  # READ_ATTRIBUTES/GENERIC_READ; SHARE_READ
        if handle == wintypes.HANDLE(-1).value:
            raise OSError(ctypes.get_last_error(), "No se puede abrir la exportación")
        try:
            info = FileInfo()
            if not information(handle, ctypes.byref(info)):
                raise OSError(ctypes.get_last_error(), "No se pudo verificar la exportación")
            if info.attributes & REPARSE or bool(info.attributes & DIRECTORY) != directory:
                raise UnsafeExportError()
            buffer = ctypes.create_unicode_buffer(32768)
            length = final_path(handle, buffer, len(buffer), 0)
            if not length or length >= len(buffer):
                raise ExportRootError()
            resolved = buffer.value
            if resolved.startswith("\\\\?\\UNC\\"):
                resolved = "\\\\" + resolved[8:]
            elif resolved.startswith("\\\\?\\"):
                resolved = resolved[4:]
            if os.path.normcase(os.path.normpath(resolved)) != os.path.normcase(os.path.normpath(path)):
                raise ExportRootError()
            return handle
        except BaseException:
            close(handle)
            raise

    # Mantener abiertos todos los componentes para que no puedan renombrarse
    # entre la inspección y la apertura del hijo.
    handles = []
    fd = None
    try:
        path = Path(root)
        for parent in reversed((path, *path.parents)):
            handles.append(checked_open(str(parent), True))
        if name is None:
            with os.scandir(root) as entries:
                yield [entry.name for entry in entries]
            return
        file_handle = checked_open(os.path.join(root, name), False)
        try:
            fd = msvcrt.open_osfhandle(file_handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            close(file_handle)
            raise
        yield fd
    finally:
        if fd is not None:
            os.close(fd)
        for handle in reversed(handles):
            close(handle)


def _opener():
    if sys.platform == "win32":
        return _open_windows
    if os.name == "posix" and hasattr(os, "O_NOFOLLOW") and os.open in os.supports_dir_fd:
        return _open_posix
    raise ExportRootError()


def list_export_names(root):
    try:
        with _opener()(root, None) as names:
            return names
    except FileNotFoundError:
        raise
    except (OSError, UnsafeExportError) as exc:
        raise ExportRootError() from exc


def read_export(root, name, extension):
    """Leer una sola vez un archivo regular, acotado y validado por contenido.

    Lanza FileNotFoundError, UnsafeExportError o ExportRootError sin exponer rutas.
    """
    if (not name or name in (".", "..") or "/" in name or "\\" in name or
            ":" in name or "\x00" in name or os.path.basename(name) != name):
        raise UnsafeExportError()
    expected = IMAGE_FORMATS.get(extension.lower())
    if not expected or not name.lower().endswith("." + extension.lower()):
        raise UnsafeExportError()
    limit = (current_app.config.get("RETINOGRAPH_MAX_IMAGE_BYTES", MAX_BYTES)
             if has_app_context() else MAX_BYTES)
    if type(limit) is not int or not 0 < limit <= MAX_BYTES:
        # La configuración solo puede restringir, nunca ampliar el máximo aprobado.
        raise ExportRootError()
    try:
        with _opener()(root, name) as fd:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_size == 0:
                raise UnsafeExportError()
            if before.st_size > limit:
                raise OversizeExportError()
            with os.fdopen(os.dup(fd), "rb") as stream:
                data = stream.read(limit + 1)
            after = os.fstat(fd)
            if len(data) > limit:
                raise OversizeExportError()
            if (len(data) != before.st_size or
                    (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
                raise UnsafeExportError()
    except (NotADirectoryError, FileNotFoundError):
        raise FileNotFoundError() from None
    except OSError as exc:
        raise ExportRootError() from exc

    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != expected[0]:
                raise UnsafeExportError()
            # No afirmar que un contenedor TIFF multipágina está verificado
            # comprobando únicamente su primera página.
            if getattr(image, "n_frames", 1) != 1:
                raise UnsafeExportError()
            width, height = image.size
            if (not MIN_SIDE <= width <= MAX_SIDE or
                    not MIN_SIDE <= height <= MAX_SIDE or width * height > MAX_PIXELS):
                raise UnsafeExportError()
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                image.load()
    except UnsafeExportError:
        raise
    except Exception as exc:
        # Decodificadores TIFF/PNG/JPEG pueden fallar con diversas excepciones
        # ante entradas corruptas; ninguna debe devolver detalles del parser.
        raise UnsafeExportError() from exc
    return data, expected[1]
