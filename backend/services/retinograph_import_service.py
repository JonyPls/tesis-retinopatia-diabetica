import mimetypes
import os
import re
from datetime import datetime

from src.repositories.patient_repository import PatientRepository

RETINOGRAPH_EXPORT_DIR = os.environ.get(
    "RETINOGRAPH_EXPORT_DIR",
    r"C:\DATA\data_clinica",
)

FILENAME_PATTERN = re.compile(
    r"^(?P<documento>[^_]+)_"
    r"(?P<fecha>\d{8})_"
    r"(?P<hora>\d{6})_"
    r"(?P<tipo_imagen>[^_]+)_"
    r"(?P<ojo>[RL])_"
    r"(?P<secuencia>\d+)"
    r"\.(?P<extension>tif|tiff|jpg|jpeg|png)$",
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

    if not os.path.isdir(RETINOGRAPH_EXPORT_DIR):
        return {
            "success": False,
            "message": "Recurso no encontrado.",
        }, 404

    seleccion = {"OD": None, "OI": None}
    encontradas = 0

    for entry in os.scandir(RETINOGRAPH_EXPORT_DIR):
        if not entry.is_file():
            continue

        parsed = _parse_retinograph_filename(entry.name)
        if not parsed or parsed["documento"] != documento:
            continue

        encontradas += 1
        ojo = parsed["ojo"]
        actual = seleccion[ojo]
        if actual is None or _selection_key(parsed) > _selection_key(actual):
            seleccion[ojo] = parsed

    return {
        "success": True,
        "data": {
            "paciente_id": paciente_id,
            "documento": documento,
            "directorio": RETINOGRAPH_EXPORT_DIR,
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

    safe_name = os.path.basename(filename)
    if safe_name != filename:
        return {"success": False, "message": "Nombre de imagen inválido"}, 400

    full_path = os.path.abspath(os.path.join(RETINOGRAPH_EXPORT_DIR, safe_name))
    export_dir = os.path.abspath(RETINOGRAPH_EXPORT_DIR)
    if os.path.commonpath([export_dir, full_path]) != export_dir:
        return {"success": False, "message": "Ruta de imagen inválida"}, 400

    if not os.path.isfile(full_path):
        return {"success": False, "message": "Imagen no encontrada"}, 404

    return {
        "success": True,
        "directory": RETINOGRAPH_EXPORT_DIR,
        "filename": safe_name,
        "mimetype": _guess_mime_type(safe_name),
    }, 200


def _parse_retinograph_filename(filename):
    safe_name = os.path.basename(filename)
    if safe_name != filename:
        return None

    match = FILENAME_PATTERN.match(safe_name)
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
        "filename": safe_name,
        "documento": raw["documento"],
        "ojo": eye,
        "ojo_original": raw["ojo"].upper(),
        "tipo_imagen": raw["tipo_imagen"],
        "secuencia": sequence,
        "extension": raw["extension"].lower(),
        "fecha_exportacion": exported_at.isoformat(),
        "mime_type": _guess_mime_type(safe_name),
    }


def _selection_key(parsed):
    return (
        parsed["fecha_exportacion"],
        parsed["secuencia"],
    )


def _guess_mime_type(filename):
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"
