"""Exportaciones ficticias; nunca usa la carpeta de exportación real ni MySQL."""

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import time
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

from utils import retinograph_storage as storage


FAKE_REPO = types.ModuleType("src.repositories.patient_repository")
FAKE_REPO.PatientRepository = types.SimpleNamespace(obtener_paciente_por_id=Mock())
with patch.dict(sys.modules, {"src.repositories.patient_repository": FAKE_REPO}):
    spec = importlib.util.spec_from_file_location(
        "isolated_retinograph_service", Path(__file__).parent / "services" / "retinograph_import_service.py")
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)


def synthetic_image(fmt="JPEG", size=(350, 350)):
    stream = io.BytesIO()
    Image.new("RGB", size, (35, 60, 90)).save(stream, format=fmt)
    return stream.getvalue()


class RetinographStorageTests(unittest.TestCase):
    def setUp(self):
        # Fuera de las exportaciones reales y dentro del directorio temporal aprobado.
        approved = Path(r"C:\Users\ricar\AppData\Local\Temp\opencode") if os.name == "nt" else None
        self.temp = tempfile.TemporaryDirectory(prefix="retinograph-synthetic-", dir=approved)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name, "exports")
        self.root.mkdir()
        self.doc = "12345678"
        self.patient = Mock(return_value={"nro_documento": self.doc})
        self.patient_patch = patch.object(FAKE_REPO.PatientRepository, "obtener_paciente_por_id", self.patient)
        self.patient_patch.start()
        self.addCleanup(self.patient_patch.stop)
        self.root_patch = patch.object(service, "RETINOGRAPH_EXPORT_DIR", str(self.root))
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def name(self, eye="R", seq=1, ext="jpg", stamp="01012026_101010"):
        return f"{self.doc}_{stamp}_fundus_{eye}_{seq}.{ext}"

    def write(self, name=None, *, fmt="JPEG", size=(350, 350), contents=None):
        name = name or self.name()
        data = synthetic_image(fmt, size) if contents is None else contents
        Path(self.root, name).write_bytes(data)
        return name, data

    def get(self, name):
        return service.obtener_archivo_retinografo(7, name)

    def select(self):
        return service.obtener_seleccion_automatica(7)

    def test_valid_jpeg_png_tiff_download_and_selection(self):
        for eye, ext, fmt in (("R", "jpg", "JPEG"), ("L", "png", "PNG"),
                              ("R", "tiff", "TIFF")):
            with self.subTest(ext=ext):
                name, data = self.write(self.name(eye=eye, seq=2 if fmt == "TIFF" else 1, ext=ext), fmt=fmt)
                response, code = self.get(name)
                self.assertEqual(code, 200, response)
                self.assertEqual(response["content"], data)
                self.assertEqual(response["mimetype"], storage.IMAGE_FORMATS[ext][1])
                self.assertNotIn("directory", response)
        response, code = self.select()
        self.assertEqual(code, 200, response)
        self.assertEqual(response["data"]["encontradas"], 3)
        self.assertEqual(response["data"]["imagenes"]["OD"]["extension"], "tiff")
        self.assertEqual(response["data"]["imagenes"]["OI"]["ojo"], "OI")
        self.assertEqual(len(response["data"]["candidatas"]), 3)
        self.assertNotIn(str(self.root), str(response))

    def test_invalid_names_never_open_files(self):
        name = self.name()
        cases = (name + ".exe", "../" + name, "..\\" + name,
                 str(self.root / name), "C:\\tmp\\" + name, "", name + "\n",
                 name.replace("_R_", "_X_"), name.replace("01012026", "13322026"))
        with patch.object(service, "read_export") as opened:
            for candidate in cases:
                with self.subTest(candidate=candidate):
                    response, code = self.get(candidate)
                    self.assertEqual(code, 400, response)
            opened.assert_not_called()

    def test_document_mismatch_and_patient_missing(self):
        name, _ = self.write()
        other = "99999999" + name[8:]
        self.write(other)
        self.assertEqual(self.get(other)[1], 403)
        selection, code = self.select()
        self.assertEqual(code, 200)
        self.assertEqual(selection["data"]["encontradas"], 1)
        self.patient.return_value = None
        self.assertEqual(self.get(name)[1], 404)
        self.assertEqual(self.select()[1], 404)

    def test_content_size_dimensions_and_missing_files_fail_closed(self):
        name = self.name()
        cases = ((b"", 422), (b"not-an-image", 422),
                 (synthetic_image("PNG"), 422), (synthetic_image(size=(349, 350)), 422),
                 (synthetic_image(size=(8193, 350)), 422),
                 (synthetic_image("JPEG")[:120], 422))
        for data, expected in cases:
            with self.subTest(data=data[:8]):
                self.write(name, contents=data)
                self.assertEqual(self.get(name)[1], expected)
                self.assertEqual(self.select()[0]["data"]["encontradas"], 0)
        with patch.object(storage, "MAX_BYTES", 512):
            self.write(name)
            self.assertEqual(self.get(name)[1], 413)
        (self.root / name).unlink()
        self.assertEqual(self.get(name)[1], 404)
        self.assertEqual(self.select()[0]["data"]["encontradas"], 0)

    def test_disappearing_and_inaccessible_candidates_are_not_selected(self):
        name, _ = self.write()
        original = service.read_export

        def disappear(root, candidate, extension):
            Path(root, candidate).unlink()
            return original(root, candidate, extension)

        with patch.object(service, "read_export", side_effect=disappear):
            response, code = self.select()
        self.assertEqual(code, 200)
        self.assertEqual(response["data"]["encontradas"], 0)
        self.write(name)
        with patch.object(service, "read_export", side_effect=storage.ExportRootError):
            self.assertEqual(self.select()[0]["data"]["encontradas"], 0)
            self.assertEqual(self.get(name)[1], 503)

    def test_unapproved_or_absent_root_fails_closed(self):
        name, _ = self.write()
        with patch.object(service, "RETINOGRAPH_EXPORT_DIR", "relative/exports"):
            self.assertEqual(self.get(name)[1], 503)
            self.assertEqual(self.select()[1], 503)
        with patch.object(service, "RETINOGRAPH_EXPORT_DIR", str(self.root / "missing")):
            self.assertEqual(self.get(name)[1], 404)
            self.assertEqual(self.select()[1], 404)

    def test_order_by_timestamp_sequence_and_stable_filename_tie(self):
        names = [self.name(seq=3, stamp="01012026_101010"),
                 self.name(seq=1, stamp="01022026_101010"),
                 self.name(seq=1, stamp="01022026_101010").replace("fundus", "retina")]
        for name in names:
            self.write(name)
        response, code = self.select()
        self.assertEqual(code, 200)
        self.assertEqual(response["data"]["imagenes"]["OD"]["filename"], max(names[1:]))
        self.assertEqual(response["data"]["encontradas"], 3)
        self.assertEqual([item["filename"] for item in response["data"]["candidatas"]],
                         sorted(names, reverse=True))

    def test_bounded_work_for_synthetic_selection_and_download(self):
        names = [self.name(eye="R", seq=i) for i in (1, 2)] + [self.name(eye="L")]
        for name in names:
            self.write(name)
        original = service.read_export
        inspected = []

        def recorded(root, candidate, extension):
            data, mime = original(root, candidate, extension)
            inspected.append((candidate, len(data)))
            return data, mime

        with patch.object(service, "read_export", side_effect=recorded):
            start = time.perf_counter()
            self.assertEqual(self.select()[0]["data"]["encontradas"], 3)
            select_time = time.perf_counter() - start
            start = time.perf_counter()
            self.assertEqual(self.get(names[0])[1], 200)
            download_time = time.perf_counter() - start
        self.assertEqual(len(inspected), 4)  # 3 candidatas, 1 descarga nueva sin caché.
        self.assertTrue(all(0 < length <= storage.MAX_BYTES for _, length in inspected))
        print(f"Retinógrafo sintético: selección 3 archivos, 3 aperturas, {select_time:.3f}s; "
              f"descarga 1 apertura, {download_time:.3f}s; máximo leído {max(n for _, n in inspected)} bytes")

    def test_symlinks_and_root_indirections_fail_closed(self):
        external = Path(self.temp.name, "outside.jpg")
        external.write_bytes(synthetic_image())
        internal_name, _ = self.write()
        for target, alias in ((external, self.name(seq=2)), (self.root / internal_name, self.name(seq=3))):
            try:
                Path(self.root, alias).symlink_to(target)
            except (OSError, NotImplementedError) as exc:
                self.skipTest(f"Symlink no autorizado en esta plataforma: {exc}")
            self.assertNotEqual(self.get(alias)[1], 200)
        self.assertEqual(self.select()[0]["data"]["encontradas"], 1)
        indirect = Path(self.temp.name, "root-alias")
        indirect.symlink_to(self.root, target_is_directory=True)
        with patch.object(service, "RETINOGRAPH_EXPORT_DIR", str(indirect)):
            self.assertNotEqual(self.get(internal_name)[1], 200)
            self.assertNotEqual(self.select()[1], 200)

    @unittest.skipUnless(os.name == "nt", "Los junctions son exclusivos de Windows")
    def test_windows_junction_ancestor_rejected(self):
        parent = Path(self.temp.name, "junction")
        other = Path(self.temp.name, "other")
        other.mkdir()
        name = self.name()
        (other / name).write_bytes(synthetic_image())
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(parent), str(other)],
                                capture_output=True, check=False)
        if result.returncode:
            self.skipTest("No se permite crear junction en este entorno")
        with patch.object(service, "RETINOGRAPH_EXPORT_DIR", str(parent)):
            self.assertNotEqual(self.get(name)[1], 200)
            self.assertNotEqual(self.select()[1], 200)

    def test_name_swap_cannot_redirect_open_descriptor(self):
        name, original = self.write()
        replacement = self.name(seq=4)
        self.write(replacement, contents=synthetic_image("JPEG", size=(360, 360)))
        opener = storage._open_windows if os.name == "nt" else storage._open_posix

        @contextmanager
        def swap(root, candidate):
            with opener(root, candidate) as fd:
                if candidate is not None:
                    try:
                        os.replace(self.root / replacement, self.root / name)
                    except PermissionError:
                        # Windows SHARE_READ sin SHARE_DELETE bloquea el reemplazo.
                        pass
                yield fd

        with patch.object(storage, "_open_windows" if os.name == "nt" else "_open_posix", swap):
            data, _ = storage.read_export(str(self.root), name, "jpg")
        self.assertEqual(data, original)

    def test_descriptor_closed_when_content_is_invalid(self):
        name, _ = self.write(contents=b"invalid")
        original = storage._open_windows if os.name == "nt" else storage._open_posix
        descriptor = []

        @contextmanager
        def capture(root, candidate):
            with original(root, candidate) as fd:
                descriptor.append(fd)
                yield fd

        with patch.object(storage, "_open_windows" if os.name == "nt" else "_open_posix", capture):
            self.assertEqual(self.get(name)[1], 422)
        with self.assertRaises(OSError):
            os.fstat(descriptor[0])


if __name__ == "__main__":
    unittest.main()
