"""Confirmación profesional declarada; no crea diagnósticos ni acredita origen del equipo."""

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
from utils.retinograph_private_storage import PrivateCopy, PrivateStorageError


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
    record = (query.with_for_update().first() if lock else query.first())
    if record is None or not hmac.compare_digest(record.token_verificador, digest):
        return None
    return record


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
