"""Descarte limitado, sin inferencia, versiones clínicas ni acceso a copias privadas."""
from copy import deepcopy
from uuid import UUID

from flask import current_app
from sqlalchemy import delete
from database import db
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle
from src.models.diagnosis_discard_entities import OperacionDescarteIA
from src.repositories.diagnosis_discard_repository import DiagnosisDiscardRepository as Repo
from utils.diagnosis_discard_gate import DiscardError, require_ready, verify_delete_dependencies, rollback_safely
from utils import diagnosis_discard_storage as storage


def positive(value):
    return type(value) is int and 0 < value <= 2**63 - 1


def parse_request(data):
    fields = {'paciente_id', 'diagnostico_retinopatia_id', 'detalle_ids', 'revision_esperada',
              'operacion_id', 'confirmo_descarte'}
    if type(data) is not dict or set(data) != fields:
        raise DiscardError(400, 'SOLICITUD_INVALIDA')
    ids = data['detalle_ids']
    if (not positive(data['paciente_id']) or not positive(data['diagnostico_retinopatia_id']) or
            type(ids) is not list or not 1 <= len(ids) <= 2 or
            any(not positive(id) for id in ids) or len(set(ids)) != len(ids) or
            type(data['revision_esperada']) is not int or not 0 <= data['revision_esperada'] < 2**63 - 1 or
            data['confirmo_descarte'] is not True or type(data['operacion_id']) is not str):
        raise DiscardError(400, 'SOLICITUD_INVALIDA')
    try:
        if str(UUID(data['operacion_id'])) != data['operacion_id']:
            raise ValueError()
    except ValueError:
        raise DiscardError(400, 'OPERACION_INVALIDA') from None
    return {**data, 'detalle_ids': sorted(ids)}


def validation_kind(detail):
    if detail.ojo_evaluado not in ('Derecho', 'Izquierdo') or detail.resultado_ia_id is None:
        return 'INCONSISTENTE'
    if detail.estado_validacion == 'PENDIENTE':
        if (any(value is not None for value in (detail.resultado_final_id, detail.validado_por,
                                                detail.fecha_validacion)) or
                detail.comentario_medico not in (None, '') or detail.motivo_correccion not in (None, '')):
            return 'INCONSISTENTE'
        return 'PENDIENTE'
    if (detail.estado_validacion not in ('APROBADO', 'CORREGIDO') or
            detail.resultado_final_id is None or detail.validado_por is None or detail.fecha_validacion is None):
        return 'INCONSISTENTE'
    same = detail.resultado_final_id == detail.resultado_ia_id
    if (detail.estado_validacion == 'APROBADO' and (not same or detail.motivo_correccion)) or (
            detail.estado_validacion == 'CORREGIDO' and
            (same or not detail.motivo_correccion or not detail.motivo_correccion.strip())):
        return 'INCONSISTENTE'
    return 'VALIDADO'


def eligibility(visit, diagnosis, details):
    linked = Repo.confirmation_ids([d.id for d in details])
    reports = Repo.has_reports(visit.id)
    kinds = [validation_kind(d) for d in details]
    consistent = (len(details) in (1, 2) and len({d.ojo_evaluado for d in details}) == len(details) and
                  'INCONSISTENTE' not in kinds and diagnosis.estado == (
                      'PROCESADO' if 'PENDIENTE' in kinds else 'VALIDADO'))
    output = []
    for detail, kind in zip(details, kinds):
        reason = ('VISITA_NO_ACTIVA' if visit.estado != 'ACTIVA' else
                  'DIAGNOSTICO_NO_COMPATIBLE' if not consistent else
                  'INFORMES_EXISTENTES' if reports else
                  'RESULTADO_VALIDADO' if kind == 'VALIDADO' else
                  'COMPROBANTE_VINCULADO' if detail.id in linked else None)
        output.append({'detalle_id': detail.id, 'ojo': 'OD' if detail.ojo_evaluado == 'Derecho' else 'OI',
                       'estado_validacion': detail.estado_validacion,
                       'elegible': reason is None, 'bloqueo': reason})
    return output


def detail_files(detail, patient_id):
    original, gradcam = detail.imagen_original_url, detail.imagen_gradcam_url
    prefix = f'P{patient_id}_{detail.ojo_evaluado}_'
    if (not isinstance(original, str) or not storage.FINAL_NAME.fullmatch(original) or
            not original.startswith(prefix) or original.endswith('_gradcam.jpg') or
            (gradcam and gradcam != original.replace('.jpg', '_gradcam.jpg'))):
        raise DiscardError(409, 'ARCHIVOS_INCONSISTENTES')
    return [original] + ([gradcam] if gradcam else [])


def public_operation(row):
    return {'operacion_id': row.operacion_id, 'persistencia': 'CONFIRMADA',
            'resultado': row.resultado, 'limpieza': row.estado_limpieza,
            'fecha_utc': row.fecha_utc.isoformat(timespec='microseconds') + 'Z'}


def error_response(error):
    return {'success': False, 'code': error.code, 'message': 'No se pudo completar la operación.'}, error.status


def report_context(visit_id):
    """Revisión para formularios de informes, sin necesitar permiso de descarte."""
    try:
        require_ready()
        db.session.rollback()
        visit = Repo.lock_visit(visit_id)
        if visit is None:
            raise DiscardError(404, 'VISITA_NO_ENCONTRADA')
        if visit.estado == 'ANULADA':
            raise DiscardError(409, 'VISITA_NO_COMPATIBLE')
        return {'success': True, 'data': {
            'visita_id': visit.id, 'paciente_id': visit.paciente_id,
            'revision_inferencia': Repo.revision(visit_id, lock=True)}}, 200
    except DiscardError as error:
        return error_response(error)
    except Exception:
        return error_response(DiscardError(503, 'CONTEXTO_NO_DISPONIBLE'))
    finally:
        rollback_safely()


def operation_status(visit_id, actor_id, operation_id):
    """Conciliar la operación propia aunque otro profesional haya creado un padre nuevo."""
    try:
        require_ready()
        db.session.rollback()
        if Repo.lock_visit(visit_id) is None:
            raise DiscardError(404, 'VISITA_NO_ENCONTRADA')
        row = Repo.operation(operation_id)
        if row is not None and (row.autor_id != actor_id or row.visita_id != visit_id):
            raise DiscardError(403, 'NO_AUTORIZADO')
        if row is None:
            # No revelar existencia de recursos ajenos por IDs adivinados.
            visit = Repo.lock_visit(visit_id)
            diagnosis = Repo.diagnosis(visit_id)
            if (diagnosis.usuario_id if diagnosis else visit.usuario_id) != actor_id:
                raise DiscardError(403, 'NO_AUTORIZADO')
        return {'success': True, 'data': {
            'operacion': public_operation(row) if row else None,
            'conciliacion': 'CONFIRMADA' if row else 'NO_CONFIRMADA'}}, 200
    except DiscardError as error:
        return error_response(error)
    except Exception:
        return error_response(DiscardError(503, 'CONTEXTO_NO_DISPONIBLE'))
    finally:
        rollback_safely()


def context(visit_id, actor_id, operation_id=None):
    try:
        require_ready()
        db.session.rollback()  # Abandonar snapshot RR de autenticación.
        visit = Repo.lock_visit(visit_id)
        if visit is None:
            raise DiscardError(404, 'VISITA_NO_ENCONTRADA')
        diagnosis = Repo.diagnosis(visit_id)
        operation = Repo.operation(operation_id) if operation_id else None
        if operation_id and operation is not None and (
                operation.autor_id != actor_id or operation.visita_id != visit_id):
            raise DiscardError(403, 'NO_AUTORIZADO')
        owner = diagnosis.usuario_id if diagnosis else visit.usuario_id
        if owner != actor_id and operation is None:
            raise DiscardError(403, 'NO_AUTORIZADO')
        if diagnosis is not None and diagnosis.usuario_id != actor_id:
            raise DiscardError(403, 'NO_AUTORIZADO')
        details = Repo.details(diagnosis.id) if diagnosis else []
        candidates = eligibility(visit, diagnosis, details) if diagnosis else []
        if any(c['elegible'] for c in candidates):
            try:
                verify_delete_dependencies()
                root = storage.storage_root()
            except DiscardError as error:
                for candidate in candidates:
                    if candidate['elegible']:
                        candidate.update(elegible=False, bloqueo=error.code)
            except Exception:
                for candidate in candidates:
                    if candidate['elegible']:
                        candidate.update(elegible=False, bloqueo='ALMACENAMIENTO_NO_VERIFICABLE')
            else:
                for candidate, detail in zip(candidates, details):
                    if not candidate['elegible']:
                        continue
                    try:
                        for name in detail_files(detail, visit.paciente_id):
                            if Repo.file_referenced(name, excluding=[detail.id]):
                                raise DiscardError(409, 'ARCHIVO_COMPARTIDO')
                            storage.snapshot(root, name)
                    except DiscardError as error:
                        candidate.update(elegible=False, bloqueo=error.code)
                    except Exception:
                        candidate.update(elegible=False, bloqueo='ALMACENAMIENTO_NO_VERIFICABLE')
        response = {'success': True, 'data': {
            'visita_id': visit.id, 'paciente_id': visit.paciente_id, 'estado_visita': visit.estado,
            'diagnostico_retinopatia_id': diagnosis.id if diagnosis else None,
            'estado_diagnostico': diagnosis.estado if diagnosis else None,
            'revision': Repo.revision(visit_id, lock=True),
            'detalles': candidates,
            'operacion': public_operation(operation) if operation else None,
            # Ausencia no demuestra rollback ni que no haya una petición en curso.
            'conciliacion': ('CONFIRMADA' if operation else 'NO_CONFIRMADA') if operation_id else None,
        }}
        return response, 200
    except DiscardError as error:
        return error_response(error)
    except Exception:
        current_app.logger.error('Error al consultar contexto de descarte IA')
        return error_response(DiscardError(503, 'CONTEXTO_NO_DISPONIBLE'))
    finally:
        rollback_safely()


def discard(visit_id, actor_id, data):
    commit_started = False
    try:
        require_ready()
        payload = parse_request(data)
        request_identity = {**payload, 'visita_id': visit_id}
        db.session.rollback()
        visit = Repo.lock_visit(visit_id)
        if visit is None:
            raise DiscardError(404, 'VISITA_NO_ENCONTRADA')
        operation = Repo.operation(payload['operacion_id'], lock=True)
        if operation is not None:
            if operation.autor_id != actor_id or operation.solicitud != request_identity:
                raise DiscardError(409, 'OPERACION_REUTILIZADA')
            return {'success': True, 'data': public_operation(operation)}, 200
        if visit.paciente_id != payload['paciente_id']:
            raise DiscardError(403, 'NO_AUTORIZADO')
        diagnosis = Repo.diagnosis(visit_id)
        if diagnosis is None or diagnosis.id != payload['diagnostico_retinopatia_id']:
            raise DiscardError(409, 'DIAGNOSTICO_CAMBIADO')
        if diagnosis.usuario_id != actor_id:
            raise DiscardError(403, 'NO_AUTORIZADO')
        if Repo.revision(visit_id, lock=True) != payload['revision_esperada']:
            raise DiscardError(409, 'REVISION_CAMBIADA')
        verify_delete_dependencies()
        details = Repo.details(diagnosis.id)
        candidates = {item['detalle_id']: item for item in eligibility(visit, diagnosis, details)}
        ids = payload['detalle_ids']
        for id in ids:
            candidate = candidates.get(id)
            if candidate is None:
                raise DiscardError(409, 'DETALLE_CAMBIADO')
            if not candidate['elegible']:
                raise DiscardError(409, candidate['bloqueo'])
        root = storage.storage_root()
        names = set()
        for detail in details:
            if detail.id in ids:
                names.update(detail_files(detail, visit.paciente_id))
        files = []
        for name in sorted(names):
            if Repo.file_referenced(name, excluding=ids):
                raise DiscardError(409, 'ARCHIVO_COMPARTIDO')
            files.append(storage.snapshot(root, name))
        # DELETE exacto, sin cascada ORM. Todas las precondiciones ya verificadas.
        db.session.execute(delete(DiagnosticoDetalle).where(
            DiagnosticoDetalle.id.in_(ids), DiagnosticoDetalle.diagnostico_retinopatia_id == diagnosis.id),
            execution_options={'synchronize_session': False})
        db.session.flush()
        remaining = Repo.details(diagnosis.id)
        if remaining:
            diagnosis.estado = ('PROCESADO' if any(validation_kind(d) == 'PENDIENTE' for d in remaining)
                                else 'VALIDADO')
            diagnosis_id = diagnosis.id
        else:
            db.session.execute(delete(Diagnostico).where(Diagnostico.id == diagnosis.id),
                               execution_options={'synchronize_session': False})
            diagnosis_id = None
        revision = Repo.increment(visit_id)
        operation = OperacionDescarteIA(
            operacion_id=payload['operacion_id'], visita_id=visit_id, autor_id=actor_id,
            solicitud=request_identity, archivos=files,
            resultado={'visita_id': visit_id, 'detalle_ids_descartados': ids,
                       'diagnostico_retinopatia_id': diagnosis_id,
                       'estado_diagnostico': diagnosis.estado if remaining else None,
                       'detalle_ids_restantes': [d.id for d in remaining], 'revision': revision})
        db.session.add(operation)
        db.session.flush()
        # Preparar respuesta antes del commit: no recargar una sesión expirada
        # y confundir fallo de lectura con fallo de la operación ya confirmada.
        response = public_operation(operation)
        commit_started = True
        db.session.commit()
        return {'success': True, 'data': response}, 200
    except DiscardError as error:
        return error_response(error)
    except Exception:
        current_app.logger.error('Commit de descarte IA incierto' if commit_started else 'Descarte IA rechazado por persistencia o almacenamiento')
        return error_response(DiscardError(503, 'PERSISTENCIA_INCIERTA' if commit_started else 'DESCARTE_NO_DISPONIBLE'))
    finally:
        rollback_safely()


def clean_operation(operation_id):
    """Solo mantenimiento explícito; nunca se invoca tras un commit incierto."""
    try:
        require_ready()
        db.session.rollback()
        # Obtener visita sin lock de operación para respetar visita -> operación.
        row = Repo.operation(operation_id)
        if row is None:
            raise DiscardError(404, 'OPERACION_NO_ENCONTRADA')
        visit_id = row.visita_id
        db.session.rollback()
        if Repo.lock_visit(visit_id) is None:
            raise DiscardError(409, 'VISITA_NO_ENCONTRADA')
        row = Repo.operation(operation_id, lock=True)
        if row.estado_limpieza == 'COMPLETADA':
            return {'success': True, 'data': public_operation(row)}, 200
        root = storage.storage_root()
        entries = deepcopy(row.archivos)
        conflict = False
        for entry in entries:
            if entry['estado'] == 'COMPLETADA':
                continue
            try:
                if Repo.file_referenced(entry['nombre']):
                    raise ValueError('ARCHIVO_REFERENCIADO')
                storage.remove_verified(root, entry)
                entry.update(estado='COMPLETADA', error=None)
            except ValueError:
                entry.update(estado='CONFLICTO', error='ARCHIVO_NO_VERIFICABLE')
                conflict = True
            except Exception:
                entry.update(estado='PENDIENTE', error='LIMPIEZA_NO_COMPLETADA')
        row.archivos = entries
        row.estado_limpieza = ('COMPLETADA' if all(e['estado'] == 'COMPLETADA' for e in entries)
                              else 'CONFLICTO' if conflict else 'PENDIENTE')
        db.session.flush()
        response = public_operation(row)
        db.session.commit()
        return {'success': True, 'data': response}, 200
    except DiscardError as error:
        return error_response(error)
    except Exception:
        current_app.logger.error('Limpieza IA pendiente de conciliación')
        return error_response(DiscardError(503, 'LIMPIEZA_NO_CONFIRMADA'))
    finally:
        rollback_safely()
