"""Confirmación profesional declarada; no crea diagnósticos ni acredita origen del equipo."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import hmac
import re
import secrets

from sqlalchemy.exc import SQLAlchemyError

from database import db
from src.models.diagnosis_entities import ConfirmacionExportacionRetinografo
from src.repositories.patient_repository import PatientRepository
from services import retinograph_import_service as exports
from utils.retinograph_storage import (
    ExportRootError, OversizeExportError, UnsafeExportError, read_export,
)
from utils.retinograph_private_storage import (
    PrivateCopy, PrivateStorageError, PrivateCopyChangedError, read_private_copy,
)
from utils.retinograph_storage import MAX_BYTES


TOKEN_PATTERN = re.compile(r'[0-9a-f]{64}\Z')
HASH_PATTERN = re.compile(r'[0-9a-fA-F]{64}\Z')


def failure(code, message):
    return {'success': False, 'message': message}, code


def register(patient_id, filename, eye, preview_hash, professional_id):
    patient = PatientRepository.obtener_paciente_por_id(patient_id)
    if not patient:
        return failure(404, 'Paciente no encontrado.')
    parsed = exports._parse_retinograph_filename(filename)
    if not parsed:
        return failure(400, 'Nombre de exportación inválido.')
    if parsed['documento'] != str(patient['nro_documento']).strip():
        return failure(404, 'Exportación no encontrada.')
    if (parsed['ojo'] == 'OD' and eye != 'Derecho' or
            parsed['ojo'] == 'OI' and eye != 'Izquierdo'):
        return failure(409, 'Ojo incompatible con la exportación; revise el origen.')
    try:
        data, _ = read_export(exports.RETINOGRAPH_EXPORT_DIR, filename, parsed['extension'])
    except FileNotFoundError:
        return failure(404, 'Exportación no encontrada.')
    except OversizeExportError:
        return failure(413, 'Archivo demasiado grande.')
    except UnsafeExportError:
        return failure(422, 'Imagen no válida.')
    except ExportRootError:
        return failure(503, 'Exportaciones no disponibles.')
    actual_hash = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(actual_hash, preview_hash.lower()):
        return failure(409, 'La imagen cambió; vuelva a revisarla.')

    token = secrets.token_hex(32)
    copy = PrivateCopy()
    try:
        copy.publish(data)  # Mismos bytes que los hasheados: ninguna reapertura de fuente.
    except PrivateStorageError:
        copy.compensate()
        db.session.rollback()
        return failure(503, 'Almacenamiento privado no disponible.')

    now = datetime.utcnow()  # DATETIME(6) UTC naive, igual que el maestro.
    record = ConfirmacionExportacionRetinografo(
        token_verificador=hashlib.sha256(bytes.fromhex(token)).digest(),
        paciente_id=patient_id, confirmado_por=professional_id,
        ojo_confirmado=eye, nombre_exportacion=filename,
        sha256_fuente=actual_hash, clave_copia=copy.key,
        fecha_confirmacion=now, fecha_expiracion=now + timedelta(minutes=60),
        estado='CONFIRMADA',
    )
    try:
        db.session.add(record)
        db.session.flush()
    except SQLAlchemyError:
        db.session.rollback()
        copy.compensate()  # No se intentó commit.
        return failure(500, 'No se pudo registrar la confirmación.')
    expires_at = now + timedelta(minutes=60)
    try:
        db.session.commit()
    except SQLAlchemyError:
        # No existe atomicidad DB/filesystem: tras intentar commit no borrar
        # una copia que podría tener una fila persistida.
        db.session.rollback()
        return failure(500, 'Persistencia incierta; no repita la confirmación sin conciliar.')
    return {
        'success': True, 'confirmacion': {
            'identificador': token, 'paciente_id': patient_id,
            'ojo_confirmado': eye, 'estado': 'CONFIRMADA',
            'fecha_expiracion': expires_at.isoformat() + 'Z',
        },
    }, 201


def _owned(token, professional_id, *, lock=False):
    digest = hashlib.sha256(bytes.fromhex(token)).digest()
    query = db.session.query(ConfirmacionExportacionRetinografo).filter_by(
        token_verificador=digest, confirmado_por=professional_id)
    record = (query.with_for_update().populate_existing().first() if lock else query.first())
    if record is None or not hmac.compare_digest(record.token_verificador, digest):
        return None
    return record


class ConfirmationUseError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ConfirmedImage:
    data: bytes
    filename: str
    mimetype: str
    sha256: str
    key: str


def _available(record, patient_id, eye):
    if (record.estado != 'CONFIRMADA' or record.detalle_id is not None or
            datetime.utcnow() >= record.fecha_expiracion):
        raise ConfirmationUseError(409, 'Confirmación no disponible.')
    if record.paciente_id != patient_id or record.ojo_confirmado != eye:
        raise ConfirmationUseError(409, 'Confirmación incompatible con paciente u ojo.')
    parsed = exports._parse_retinograph_filename(record.nombre_exportacion)
    if (parsed is None or (parsed['ojo'] == 'OD') != (eye == 'Derecho')):
        raise ConfirmationUseError(409, 'Confirmación incompatible con el ojo.')
    return parsed


def _verify_source(record, extension):
    try:
        source, mimetype = read_export(exports.RETINOGRAPH_EXPORT_DIR,
                                       record.nombre_exportacion, extension)
    except FileNotFoundError:
        raise ConfirmationUseError(409, 'La exportación ya no está disponible.') from None
    except ExportRootError:
        raise ConfirmationUseError(503, 'Exportaciones no disponibles.') from None
    except (OversizeExportError, UnsafeExportError):
        raise ConfirmationUseError(409, 'La exportación cambió; vuelva a confirmarla.') from None
    if not hmac.compare_digest(hashlib.sha256(source).hexdigest(), record.sha256_fuente):
        raise ConfirmationUseError(409, 'La exportación cambió; vuelva a confirmarla.')
    return mimetype


def _verify_copy(record):
    try:
        return read_private_copy(record.clave_copia, record.sha256_fuente, limit=MAX_BYTES)
    except PrivateCopyChangedError:
        raise ConfirmationUseError(409, 'La copia confirmada cambió.') from None
    except PrivateStorageError:
        raise ConfirmationUseError(503, 'Copia privada no disponible.') from None


def load_for_inference(token, patient_id, eye, professional_id):
    """Comprobación barata previa: sin bloquear durante CLIP o la inferencia."""
    if not TOKEN_PATTERN.fullmatch(token):
        raise ConfirmationUseError(400, 'Comprobante inválido.')
    record = _owned(token, professional_id)
    if record is None:
        raise ConfirmationUseError(404, 'Confirmación no encontrada.')
    parsed = _available(record, patient_id, eye)
    mimetype = _verify_source(record, parsed['extension'])
    data = _verify_copy(record)
    return ConfirmedImage(data, record.nombre_exportacion, mimetype,
                          record.sha256_fuente, record.clave_copia)


def lock_for_consumption(token, patient_id, eye, professional_id, confirmed):
    """Serializa consumos/revocación antes de bloquear o insertar recursos clínicos.

    Se llama después de la inferencia; la fila permanece bloqueada hasta el
    commit/rollback del servicio de diagnóstico. Nunca hace commit propio.
    """
    record = _owned(token, professional_id, lock=True)
    if record is None:
        raise ConfirmationUseError(404, 'Confirmación no encontrada.')
    _available(record, patient_id, eye)
    if (record.nombre_exportacion != confirmed.filename or
            record.sha256_fuente != confirmed.sha256 or record.clave_copia != confirmed.key):
        raise ConfirmationUseError(409, 'La confirmación cambió.')


def consume_with_detail(token, patient_id, eye, professional_id, confirmed, detail_id):
    """Revalidar la fila ya bloqueada, antes de publicar JPEG.

    No hace commit. La revocación bloquea solo esta fila; el orden de locks del
    diagnóstico confirmado es confirmación -> visita -> diagnóstico -> detalle.
    """
    record = _owned(token, professional_id, lock=True)
    if record is None:
        raise ConfirmationUseError(404, 'Confirmación no encontrada.')
    parsed = _available(record, patient_id, eye)
    if (record.nombre_exportacion != confirmed.filename or
            record.sha256_fuente != confirmed.sha256 or
            record.clave_copia != confirmed.key or
            not hmac.compare_digest(hashlib.sha256(confirmed.data).hexdigest(), confirmed.sha256)):
        raise ConfirmationUseError(409, 'La confirmación cambió.')
    _verify_source(record, parsed['extension'])
    if not hmac.compare_digest(_verify_copy(record), confirmed.data):
        raise ConfirmationUseError(409, 'La copia confirmada cambió.')
    record.estado = 'CONSUMIDA'
    record.detalle_id = detail_id
    record.fecha_consumo = datetime.utcnow()
    db.session.flush()  # Misma transacción de la visita, diagnóstico y detalle.


def status(token, professional_id):
    record = _owned(token, professional_id)
    if record is None:
        return failure(404, 'Confirmación no encontrada.')
    expired = datetime.utcnow() >= record.fecha_expiracion
    return {'success': True, 'confirmacion': {
        'paciente_id': record.paciente_id,
        'ojo_confirmado': record.ojo_confirmado,
        'estado': record.estado,
        'vigente': record.estado == 'CONFIRMADA' and not expired,
        'expirada': expired,
        'fecha_expiracion': record.fecha_expiracion.isoformat() + 'Z',
    }}, 200


def revoke(token, professional_id):
    try:
        record = _owned(token, professional_id, lock=True)
        if record is None:
            db.session.rollback()
            return failure(404, 'Confirmación no encontrada.')
        now = datetime.utcnow()
        if record.estado != 'CONFIRMADA' or now >= record.fecha_expiracion:
            db.session.rollback()
            return failure(409, 'Confirmación no revocable.')
        record.estado = 'REVOCADA'
        record.revocada_por = professional_id
        record.fecha_revocacion = now
        patient_id, eye = record.paciente_id, record.ojo_confirmado
        db.session.flush()
        db.session.commit()
        return {'success': True, 'confirmacion': {
            'estado': 'REVOCADA', 'paciente_id': patient_id,
            'ojo_confirmado': eye,
        }}, 200
    except SQLAlchemyError:
        db.session.rollback()
        return failure(500, 'No se pudo revocar la confirmación.')
