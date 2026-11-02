"""Limpieza por manifiesto; nunca por patrones ni por rutas del cliente.

La raíz debe ser privada frente a otros escritores del SO. En Windows se borra
por el mismo handle verificado, sin ventana de reapertura por nombre.
"""
import os
import stat
import sys
from pathlib import Path

from flask import current_app
from utils.diagnosis_storage import FINAL_NAME
from utils.retinograph_storage import _opener, _open_windows


def storage_root():
    configured = current_app.config.get('DIAGNOSIS_DISCARD_STORAGE_ROOT')
    writer = os.path.abspath(os.path.join(os.getcwd(), 'uploads', 'retinas'))
    reader = str(Path(__file__).resolve().parents[1] / 'uploads' / 'retinas')
    # No aceptar otra raíz silenciosamente: podría limpiar un árbol distinto.
    if (not isinstance(configured, str) or not os.path.isabs(configured) or
            os.path.normcase(os.path.normpath(configured)) != os.path.normcase(writer) or
            os.path.normcase(writer) != os.path.normcase(reader)):
        raise ValueError('RAIZ_NO_VERIFICABLE')
    return configured


def identity(fd):
    value = os.fstat(fd)
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        raise ValueError('ARCHIVO_NO_EXCLUSIVO')
    return [str(value.st_dev), str(value.st_ino), str(value.st_size), str(value.st_mtime_ns)]


def snapshot(root, name):
    if not isinstance(name, str) or not FINAL_NAME.fullmatch(name):
        raise ValueError('NOMBRE_NO_VERIFICABLE')
    try:
        with _opener()(root, name) as fd:
            return {'nombre': name, 'identidad': identity(fd), 'estado': 'PENDIENTE'}
    except FileNotFoundError:
        return {'nombre': name, 'identidad': None, 'estado': 'PENDIENTE'}


def remove_verified(root, entry):
    name, expected = entry['nombre'], entry['identidad']
    if not isinstance(name, str) or not FINAL_NAME.fullmatch(name):
        raise ValueError('NOMBRE_NO_VERIFICABLE')
    try:
        if sys.platform == 'win32':
            import ctypes
            import msvcrt
            from ctypes import wintypes
            with _open_windows(root, name, for_delete=True) as fd:
                if identity(fd) != expected:
                    raise ValueError('IDENTIDAD_CAMBIADA')
                class Disposition(ctypes.Structure):
                    _fields_ = [('delete', wintypes.BOOLEAN)]
                kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                delete = kernel.SetFileInformationByHandle
                delete.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
                delete.restype = wintypes.BOOL
                info = Disposition(True)
                if not delete(msvcrt.get_osfhandle(fd), 4, ctypes.byref(info), ctypes.sizeof(info)):
                    raise OSError('LIMPIEZA_NO_COMPLETADA')
        elif os.name == 'posix' and os.open in os.supports_dir_fd:
            # Abrir todos los componentes sin seguir symlinks; unlink relativo
            # al descriptor confina el borrado incluso si se renombra la raíz.
            directory = None
            try:
                for component in Path(root).parts:
                    next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                      **({'dir_fd': directory} if directory is not None else {}))
                    if directory is not None:
                        os.close(directory)
                    directory = next_fd
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
                try:
                    if identity(fd) != expected:
                        raise ValueError('IDENTIDAD_CAMBIADA')
                    actual = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    if (actual.st_dev, actual.st_ino) != tuple(map(int, expected[:2])):
                        raise ValueError('IDENTIDAD_CAMBIADA')
                    os.unlink(name, dir_fd=directory)
                finally:
                    os.close(fd)
            finally:
                if directory is not None:
                    os.close(directory)
        else:
            raise ValueError('PLATAFORMA_NO_VERIFICABLE')
    except FileNotFoundError:
        pass  # Reintento idempotente. Nunca borrar un archivo aparecido después.
