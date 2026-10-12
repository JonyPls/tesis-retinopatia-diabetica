"""Archivos JPEG de diagnóstico: preparación privada y publicación sin reemplazo.

El almacenamiento debe estar en un filesystem que admita hard links o, como
alternativa, creación exclusiva. Los archivos publicados solo se sirven si
existe una referencia confirmada en MySQL (files_routes).
"""

import errno
import os
from collections import Counter
from pathlib import Path
import re
import tempfile
import time
from threading import Lock

from PIL import Image


FINAL_NAME = re.compile(r'P[0-9]+_(?:Derecho|Izquierdo)_[0-9a-f]{32}(?:_gradcam)?\.jpg\Z')
_active_lock = Lock()
_active = Counter()  # Solo este proceso; cuenta colisiones entre solicitudes.


class DiagnosisFiles:
    def __init__(self, root):
        self.root = Path(root)
        self.stage = self.root / '.pending'
        self.temporary = []
        self.published = {}  # nombre -> (device, inode) creado por esta solicitud
        self.active_names = set()

    def _mark_active(self, path):
        key = (self.root.resolve(), path.name)
        with _active_lock:
            if key not in self.active_names:
                _active[key] += 1
                self.active_names.add(key)

    def release(self):
        with _active_lock:
            for key in self.active_names:
                _active[key] -= 1
                if not _active[key]:
                    del _active[key]
        self.active_names.clear()

    def prepare(self, image):
        """JPEG completo y verificable, fuera de las rutas públicas."""
        self.stage.mkdir(exist_ok=True)
        if self.stage.is_symlink() or self.stage.resolve().parent != self.root.resolve():
            raise ValueError('Directorio provisional inválido')
        fd, path = tempfile.mkstemp(prefix='diagnosis-', suffix='.part', dir=self.stage)
        path = Path(path)
        self.temporary.append(path)  # Registrar antes de intentar escribir.
        self._mark_active(path)
        with os.fdopen(fd, 'wb') as output:
            image.save(output, 'JPEG', quality=90)
            output.flush()
            os.fsync(output.fileno())
        self.verify(path)
        return path

    @staticmethod
    def verify(path):
        with Image.open(path) as image:
            if image.format != 'JPEG':
                raise ValueError('JPEG provisional inválido')
            image.verify()
        with Image.open(path) as image:
            image.load()

    def publish(self, temporary, name):
        if not FINAL_NAME.fullmatch(name) or temporary not in self.temporary:
            raise ValueError('Nombre de almacenamiento inválido')
        target = self.root / name
        self._mark_active(target)
        identity = self._identity(temporary)
        try:
            # link es atómico y rechaza un destino existente en Windows y Linux.
            os.link(temporary, target)
        except OSError as error:
            if error.errno not in (errno.EPERM, errno.ENOTSUP, errno.ENOSYS):
                raise
            # Filesystems sin hard links: creación exclusiva; el archivo no
            # se puede leer vía HTTP hasta que MySQL confirme su referencia.
            with open(target, 'xb') as output:
                stat = os.fstat(output.fileno())
                self.published[name] = stat.st_dev, stat.st_ino
                with open(temporary, 'rb') as source:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        else:
            self.published[name] = identity
        self.verify(target)

    @staticmethod
    def _identity(path):
        stat = path.stat(follow_symlinks=False)
        return stat.st_dev, stat.st_ino

    def cleanup(self, *, published=False):
        """Solo elimina archivos propios cuyo nombre todavía identifica el mismo inode."""
        if published:
            for name, identity in self.published.items():
                target = self.root / name
                try:
                    if self._identity(target) == identity:
                        target.unlink()
                except FileNotFoundError:
                    pass
        for temporary in self.temporary:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def inspect_candidates(root, referenced_names, *, minimum_age_seconds=86400, now=None):
    """Solo inspección; el llamador debe consultar MySQL con éxito primero.

    Una coincidencia NO demuestra abandono: pueden existir procesos activos
    en otras instancias. Nunca borra recursos.
    """
    if referenced_names is None:
        raise ValueError('Se requiere una lectura confirmada de referencias MySQL')
    root = Path(root)
    if root.is_symlink() or minimum_age_seconds < 0:
        raise ValueError('Directorio o antigüedad de inspección inválidos')
    cutoff = (time.time() if now is None else now) - minimum_age_seconds
    found = {'temporary_candidates': [], 'unreferenced_candidates': []}
    for folder, key, pattern in ((root / '.pending', 'temporary_candidates',
                                  lambda name: name.startswith('diagnosis-') and name.endswith('.part')),
                                 (root, 'unreferenced_candidates', FINAL_NAME.fullmatch)):
        if folder.is_symlink() or not folder.is_dir():
            continue
        for file in folder.iterdir():
            with _active_lock:
                in_this_process = _active[(root.resolve(), file.name)] > 0
            if (not in_this_process and pattern(file.name) and not file.is_symlink() and file.is_file()
                    and file.stat().st_mtime < cutoff
                    and (key == 'temporary_candidates' or file.name not in referenced_names)):
                found[key].append(file.name)
        found[key].sort()
    return found


def inspect_database_candidates(root, *, minimum_age_seconds=86400):
    """Inspección operatoria (sin borrado); una consulta fallida aborta el informe."""
    from database import db
    from src.models.diagnosis_entities import DiagnosticoDetalle

    names = set()
    for original, gradcam in db.session.query(
            DiagnosticoDetalle.imagen_original_url,
            DiagnosticoDetalle.imagen_gradcam_url).all():
        names.add(original)
        if gradcam:
            names.add(gradcam)
    found = inspect_candidates(root, names, minimum_age_seconds=minimum_age_seconds)
    found['missing_referenced'] = sorted(
        name for name in names
        if (isinstance(name, str) and name == Path(name).name
            and ((Path(root) / name).is_symlink() or not (Path(root) / name).is_file()))
    )
    return found
