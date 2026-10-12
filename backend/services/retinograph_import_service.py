import os
import re
from datetime import datetime

from src.repositories.patient_repository import PatientRepository
from utils.retinograph_storage import (
    ExportRootError, OversizeExportError, UnsafeExportError,
    list_export_names, read_export,
)

RETINOGRAPH_EXPORT_DIR = os.environ.get(
    "RETINOGRAPH_EXPORT_DIR",
    r"C:\DATA\data_clinica",
)

FILENAME_PATTERN = re.compile(
    r"(?P<documento>[^_]+)_"
    r"(?P<fecha>[0-9]{8})_"
    r"(?P<hora>[0-9]{6})_"
    r"(?P<tipo_imagen>[^_]+)_"
    r"(?P<ojo>[RL])_"
    r"(?P<secuencia>[0-9]+)"
    r"\.(?P<extension>tif|tiff|jpg|jpeg|png)",
    re.IGNORECASE,
)

EYE_MAP = {
    "R": "OD",
    "L": "OI",
}


def obtener_seleccion_automatica(paciente_id):
    paciente = PatientRepository.obtener_paciente_por_id(paciente_id)
    if not paciente:
        return {"success": False, "message": "Paciente no encontrado"}, 404

    documento = str(paciente.get("nro_documento", "")).strip()
    if not documento:
        return {
            "success": False,
            "message": "El paciente no tiene documento registrado",
        }, 400

    try:
        names = list_export_names(RETINOGRAPH_EXPORT_DIR)
    except FileNotFoundError:
        return {
            "success": False,
            "message": "Recurso no encontrado.",
        }, 404
    except ExportRootError:
        return {"success": False, "message": "Exportaciones no disponibles."}, 503

    seleccion = {"OD": None, "OI": None}
    encontradas = 0

    for name in names:
        parsed = _parse_retinograph_filename(name)
        if not parsed or parsed["documento"] != documento:
            continue

        try:
            _, mime = read_export(RETINOGRAPH_EXPORT_DIR, name, parsed["extension"])
        except (FileNotFoundError, UnsafeExportError, ExportRootError):
            continue  # Una candidata desaparecida/no verificable nunca se ofrece.
        parsed["mime_type"] = mime
        parsed.pop("documento", None)  # El nombre ya lo incluye; no duplicar identidad.

        encontradas += 1
        ojo = parsed["ojo"]
        actual = seleccion[ojo]
        if actual is None or _selection_key(parsed) > _selection_key(actual):
            seleccion[ojo] = parsed

    return {
        "success": True,
        "data": {
            "paciente_id": paciente_id,
            "encontradas": encontradas,
            "imagenes": seleccion,
        },
    }, 200


def obtener_archivo_retinografo(paciente_id, filename):
    paciente = PatientRepository.obtener_paciente_por_id(paciente_id)
    if not paciente:
        return {"success": False, "message": "Paciente no encontrado"}, 404

    parsed = _parse_retinograph_filename(filename)
    if not parsed:
        return {"success": False, "message": "Nombre de imagen inválido"}, 400

    documento = str(paciente.get("nro_documento", "")).strip()
    if parsed["documento"] != documento:
        return {
            "success": False,
            "message": "No autorizado.",
        }, 403

    try:
        image, mime = read_export(RETINOGRAPH_EXPORT_DIR, filename, parsed["extension"])
    except FileNotFoundError:
        return {"success": False, "message": "Imagen no encontrada"}, 404
    except OversizeExportError:
        return {"success": False, "message": "Archivo demasiado grande."}, 413
    except UnsafeExportError:
        return {"success": False, "message": "Imagen no válida."}, 422
    except ExportRootError:
        return {"success": False, "message": "Exportaciones no disponibles."}, 503

    return {
        "success": True,
        "content": image,
        "mimetype": mime,
    }, 200


def _parse_retinograph_filename(filename):
    if (not isinstance(filename, str) or not filename or len(filename) > 255 or
            any(c in filename for c in ('/', '\\', ':', '\x00')) or
            any(ord(c) < 32 or ord(c) == 127 for c in filename) or
            filename in ('.', '..')):
        return None

    match = FILENAME_PATTERN.fullmatch(filename)
    if not match:
        return None

    raw = match.groupdict()
    try:
        exported_at = datetime.strptime(
            raw["fecha"] + raw["hora"],
            "%m%d%Y%H%M%S",
        )
    except ValueError:
        return None

    eye = EYE_MAP.get(raw["ojo"].upper())
    if not eye:
        return None

    sequence = int(raw["secuencia"])
    return {
        "filename": filename,
        "documento": raw["documento"],
        "ojo": eye,
        "ojo_original": raw["ojo"].upper(),
        "tipo_imagen": raw["tipo_imagen"],
        "secuencia": sequence,
        "extension": raw["extension"].lower(),
        "fecha_exportacion": exported_at.isoformat(),
        "mime_type": {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                      "tif": "image/tiff", "tiff": "image/tiff"}[raw["extension"].lower()],
    }


def _selection_key(parsed):
    return (
        parsed["fecha_exportacion"],
        parsed["secuencia"],
        parsed["filename"],  # empate estable, sin depender de os.scandir
    )
