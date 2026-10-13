import json
import math
from flask import current_app
from sqlalchemy.exc import DBAPIError, IntegrityError
from database import db
from src.repositories.informe_repository import InformeRepository


def _extraer_conclusion(datos_estructurados):
    if not isinstance(datos_estructurados, dict):
        return None

    conclusion = datos_estructurados.get("conclusion")
    if isinstance(conclusion, list):
        items = [str(item).strip() for item in conclusion if str(item).strip()]
        return "\n".join(items) if items else None
    if conclusion is None:
        return None

    texto = str(conclusion).strip()
    return texto or None


def obtener_tipos():
    tipos = InformeRepository.listar_tipos_informe_activos()
    return {"success": True, "data": tipos}, 200


_FIELDS = {'paciente_id', 'tipo_informe_id', 'datos_estructurados', 'visita_id', 'diagnostico_id'}
_RESERVED = {'id', 'usuario_id', 'user_id', 'creador', 'estado', 'fecha_creado', 'fecha_actualizado',
             'paciente_id', 'tipo_informe_id', 'visita_id', 'diagnostico_id', 'schema_version',
             'revision_actual', 'numero_version', 'editor_id', 'autor_operacion_id', 'fecha_operacion'}


class InvalidReportData(Exception):
    pass


def _positive_id(value, maximum):
    return type(value) is int and 0 < value <= maximum


def _validar_datos_estructurados(value):
    """Contrato estructural, sin decidir rangos ni diagnósticos clínicos."""
    if type(value) is not dict or not value:
        raise InvalidReportData()

    def visit(node, depth):
        if depth > 8:
            raise InvalidReportData()
        if type(node) is dict:
            if len(node) > 128:
                raise InvalidReportData()
            for key, item in node.items():
                if (type(key) is not str or not key or len(key) > 100 or
                        key.lower() in _RESERVED):
                    raise InvalidReportData()
                visit(item, depth + 1)
        elif type(node) is list:
            if len(node) > 128:
                raise InvalidReportData()
            for item in node:
                visit(item, depth + 1)
        elif type(node) is str:
            if len(node) > 8192:
                raise InvalidReportData()
        elif node is None or type(node) is bool or type(node) is int:
            pass
        elif type(node) is float:
            if not math.isfinite(node):
                raise InvalidReportData()
        else:
            raise InvalidReportData()

    visit(value, 0)
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')) > 65536:
        raise InvalidReportData()
    if 'conclusion' in value:
        conclusion = value['conclusion']
        if (conclusion is not None and type(conclusion) is not str and
                (type(conclusion) is not list or
                 any(type(item) is not str for item in conclusion))):
            raise InvalidReportData()
    if 'ojos' in value:
        eyes = value['ojos']
        if (type(eyes) is not list or not 1 <= len(eyes) <= 2 or
                any(eye not in ('OD', 'OI') for eye in eyes) or len(set(eyes)) != len(eyes)):
            raise InvalidReportData()
    for key in ('valores', 'campos', 'grados'):
        if key in value:
            entries = value[key]
            if (type(entries) is not dict or
                    any(eye not in ('od', 'oi') for eye in entries)):
                raise InvalidReportData()
            for item in entries.values():
                if key == 'valores':
                    if type(item) not in (int, float) or not math.isfinite(item):
                        raise InvalidReportData()
                elif (type(item) is not dict or
                      any(type(field) is not str for field in item.values())):
                    raise InvalidReportData()


def _is_duplicate_report(error):
    original = getattr(error, 'orig', None)
    args = getattr(original, 'args', ())
    return (bool(args) and args[0] == 1062 and
            'uq_informes_visita_tipo' in str(args[1] if len(args) > 1 else ''))


def _rollback_informe():
    try:
        db.session.rollback()
    except Exception:
        current_app.logger.error("No se pudo completar rollback de informe")


def crear_nuevo_informe(datos, usuario_id):
    if type(datos) is not dict or not {'paciente_id', 'tipo_informe_id', 'datos_estructurados'} <= datos.keys() or set(datos) - _FIELDS:
        return {"success": False, "message": "Solicitud de informe inválida."}, 400
    paciente_id, tipo_id = datos['paciente_id'], datos['tipo_informe_id']
    if not _positive_id(paciente_id, 4294967295) or not _positive_id(tipo_id, 65535):
        return {"success": False, "message": "Identificador inválido."}, 400
    has_visit, has_alias = 'visita_id' in datos, 'diagnostico_id' in datos
    if (has_visit and not _positive_id(datos['visita_id'], 18446744073709551615) or
            has_alias and not _positive_id(datos['diagnostico_id'], 18446744073709551615) or
            has_visit and has_alias and datos['visita_id'] != datos['diagnostico_id']):
        return {"success": False, "message": "Identificador de visita inválido."}, 400
    visita_id = datos['visita_id'] if has_visit else datos.get('diagnostico_id')
    try:
        _validar_datos_estructurados(datos['datos_estructurados'])
    except (InvalidReportData, ValueError, OverflowError, TypeError):
        return {"success": False, "message": "Datos estructurados inválidos."}, 422

    commit_started = False
    try:
        InformeRepository.validar_paciente(paciente_id)
        tipo = InformeRepository.obtener_tipo_informe_por_id(tipo_id)
        if not tipo:
            raise InformeRepository.NotFound()
        if visita_id:
            InformeRepository.validar_visita(visita_id, paciente_id)
        else:
            visita_id = InformeRepository.crear_visita(paciente_id, usuario_id)

        informe_id = InformeRepository.crear_informe(
            visita_id=visita_id,
            tipo_informe_id=tipo_id,
            usuario_id=usuario_id,
            datos_estructurados=datos['datos_estructurados'],
            conclusion=_extraer_conclusion(datos['datos_estructurados']),
            schema_version=tipo.get("schema_version_actual") or 1,
        )
        InformeRepository.crear_version_inicial(informe_id, usuario_id)
        commit_started = True
        db.session.commit()
    except InformeRepository.NotFound:
        _rollback_informe()
        return {"success": False, "message": "Recurso no encontrado."}, 404
    except InformeRepository.Conflict:
        _rollback_informe()
        return {"success": False, "message": "Ya existe un informe de este tipo para la visita."}, 409
    except IntegrityError as error:
        _rollback_informe()
        if not commit_started and _is_duplicate_report(error):
            return {"success": False, "message": "Ya existe un informe de este tipo para la visita."}, 409
        if commit_started:
            current_app.logger.warning("Resultado de commit de informe incierto; no reintentar automáticamente")
        else:
            current_app.logger.error("Error de integridad al crear informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except DBAPIError:
        # El rollback limpia la sesión; si falló commit NO prueba que MySQL no persistiera.
        _rollback_informe()
        if commit_started:
            current_app.logger.warning("Resultado de commit de informe incierto; no reintentar automáticamente")
        else:
            current_app.logger.error("Error de persistencia al crear informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except Exception:
        _rollback_informe()
        if commit_started:
            current_app.logger.warning("Resultado de commit de informe incierto; no reintentar automáticamente")
        else:
            current_app.logger.error("Error al crear informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500

    return {"success": True, "data": {"id": informe_id, "visita_id": visita_id, "diagnostico_id": visita_id}}, 201

def _parsear_datos(informe: dict) -> dict:
    if isinstance(informe.get("datos_estructurados"), str):
        try:
            informe["datos_estructurados"] = json.loads(informe["datos_estructurados"])
        except (json.JSONDecodeError, TypeError):
            pass
    if not informe.get("conclusion"):
        informe["conclusion"] = _extraer_conclusion(informe.get("datos_estructurados"))
    return informe

def obtener_informe(informe_id):
    informe = InformeRepository.obtener_informe_por_id(informe_id)
    if not informe:
        return {"success": False, "message": "Informe no encontrado."}, 404
    return {"success": True, "data": _parsear_datos(informe)}, 200


def _paginacion(total, page, per_page):
    return {"page": page, "per_page": per_page, "total": total,
            "has_more": page * per_page < total}


def obtener_versiones_informe(informe_id, page, per_page):
    try:
        row = InformeRepository.obtener_contexto_historico(informe_id)
        if row is None:
            return {"success": False, "message": "Informe no encontrado."}, 404
        informe, tipo, visita, paciente, creador = row
        total, inicial, ultima, versiones = InformeRepository.versiones_historicas(
            informe_id, page, per_page)
        if (inicial is None or inicial.operacion not in ('CREACION', 'MIGRACION_INICIAL') or
                ultima is None or total != informe.revision_actual or
                ultima.numero_version != informe.revision_actual or
                ultima.datos_estructurados != informe.datos_estructurados or
                ultima.conclusion != informe.conclusion or ultima.estado != informe.estado or
                ultima.schema_version != informe.schema_version):
            current_app.logger.error("Historial inconsistente en consulta de informe")
            return {"success": False, "message": "Historial no disponible por inconsistencia."}, 409
        return {"success": True, "data": {
            "informe": {"id": informe.id, "paciente_id": paciente.id,
                        "visita_id": visita.id, "fecha_visita": visita.fecha_visita,
                        "estado_visita": visita.estado, "tipo_informe_id": tipo.id,
                        "tipo_informe_nombre": tipo.nombre, "usuario_id": creador.id,
                        "estado": informe.estado, "revision_actual": informe.revision_actual},
            "versiones": [
                {"numero_version": version.numero_version, "operacion": version.operacion,
                 "schema_version": version.schema_version,
                 "datos_estructurados": version.datos_estructurados,
                 "conclusion": version.conclusion, "estado": version.estado,
                 "autor_operacion_id": version.autor_operacion_id,
                 "autor_operacion": ({"id": autor.id, "nombres": autor.nombres,
                                       "apellidos": autor.apellidos} if autor else None),
                 "fecha_operacion": version.fecha_operacion, "motivo": version.motivo,
                 "es_actual": version.numero_version == informe.revision_actual}
                for version, autor in versiones],
        }, "pagination": _paginacion(total, page, per_page)}, 200
    except Exception:
        current_app.logger.error("Error al consultar versiones de informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def obtener_historial_paciente(paciente_id, page, per_page):
    try:
        total, rows = InformeRepository.listar_historial_paciente(paciente_id, page, per_page)
        return {"success": True, "data": [
            {"id": informe.id, "tipo_informe_id": tipo.id,
             "tipo_informe_nombre": tipo.nombre, "visita_id": visita.id,
             "fecha_visita": visita.fecha_visita, "estado_visita": visita.estado,
             "usuario_id": creador.id,
             "autor_original": {"id": creador.id, "nombres": creador.nombres,
                                "apellidos": creador.apellidos},
             "estado": informe.estado, "revision_actual": informe.revision_actual,
             "fecha_creado": informe.fecha_creado, "fecha_actualizado": informe.fecha_actualizado}
            for informe, tipo, visita, creador in rows],
            "pagination": _paginacion(total, page, per_page)}, 200
    except InformeRepository.NotFound:
        return {"success": False, "message": "Paciente no encontrado."}, 404
    except Exception:
        current_app.logger.error("Error al consultar catálogo histórico de informes")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500


def bloquear_informe_para_edicion(informe_id):
    return InformeRepository.bloquear_informe(informe_id)


def cancelar_edicion():
    _rollback_informe()


def actualizar_informe_existente(informe_id, datos, usuario_id, informe_bloqueado):
    """El recurso llega bloqueado por la guardia B1 y conserva esa transacción."""
    informe = informe_bloqueado
    if informe is None or informe.id != informe_id or informe.usuario_id != usuario_id:
        _rollback_informe()
        return {"success": False, "message": "No autorizado."}, 403
    if (type(datos) is not dict or set(datos) !=
            {'datos_estructurados', 'motivo', 'revision_esperada'}):
        _rollback_informe()
        return {"success": False, "message": "Solicitud de informe inválida."}, 400
    revision = datos['revision_esperada']
    motivo = datos['motivo']
    if not _positive_id(revision, 18446744073709551615) or type(motivo) is not str or not motivo.strip() or len(motivo) > 1000:
        _rollback_informe()
        return {"success": False, "message": "Revisión o motivo inválido."}, 400
    motivo = motivo.strip()

    commit_started = False
    try:
        visita = InformeRepository.bloquear_visita_de_informe(informe)
        if (visita is None or visita.estado not in ('ACTIVA', 'CERRADA') or
                informe.estado != 'ACTIVO' or revision != informe.revision_actual or
                revision == 18446744073709551615):
            raise InformeRepository.Conflict()
        if not InformeRepository.version_actual_consistente(informe):
            current_app.logger.error("Historial inconsistente; corrección de informe rechazada")
            raise InformeRepository.Conflict()
        try:
            _validar_datos_estructurados(datos['datos_estructurados'])
        except (InvalidReportData, ValueError, OverflowError, TypeError):
            _rollback_informe()
            return {"success": False, "message": "Datos estructurados inválidos."}, 422
        InformeRepository.corregir_informe(
            informe, datos['datos_estructurados'],
            _extraer_conclusion(datos['datos_estructurados']), usuario_id, motivo,
        )
        nueva_revision = informe.revision_actual
        commit_started = True
        db.session.commit()
    except InformeRepository.Conflict:
        _rollback_informe()
        return {"success": False, "message": "Conflicto de revisión o estado."}, 409
    except IntegrityError as error:
        _rollback_informe()
        if not commit_started and _is_duplicate_version(error):
            return {"success": False, "message": "Conflicto de revisión o estado."}, 409
        current_app.logger.warning("Resultado de commit de corrección incierto" if commit_started
                                   else "Error de integridad al corregir informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except Exception:
        _rollback_informe()
        current_app.logger.warning("Resultado de commit de corrección incierto" if commit_started
                                   else "Error de persistencia al corregir informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    return {"success": True, "message": "Informe actualizado correctamente.",
            "data": {"id": informe_id, "revision_actual": nueva_revision}}, 200


def _is_duplicate_version(error):
    original = getattr(error, 'orig', None)
    args = getattr(original, 'args', ())
    return (len(args) > 1 and args[0] == 1062 and
            'uq_informes_versiones_informe_numero' in str(args[1]))


def anular_informe_existente(informe_id, datos, usuario_id, informe_bloqueado):
    """El informe se bloqueó y verificó como propio antes de entrar aquí."""
    informe = informe_bloqueado
    if informe is None or informe.id != informe_id or informe.usuario_id != usuario_id:
        _rollback_informe()
        return {"success": False, "message": "No autorizado."}, 403
    if type(datos) is not dict or set(datos) != {'motivo', 'revision_esperada'}:
        _rollback_informe()
        return {"success": False, "message": "Solicitud de informe inválida."}, 400
    revision, motivo = datos['revision_esperada'], datos['motivo']
    if (not _positive_id(revision, 18446744073709551615) or type(motivo) is not str or
            not motivo.strip() or len(motivo) > 1000):
        _rollback_informe()
        return {"success": False, "message": "Revisión o motivo inválido."}, 400
    motivo = motivo.strip()

    commit_started = False
    try:
        visita = InformeRepository.bloquear_visita_de_informe(informe)
        if (visita is None or visita.estado not in ('ACTIVA', 'CERRADA') or
                informe.estado != 'ACTIVO' or revision != informe.revision_actual or
                revision == 18446744073709551615):
            raise InformeRepository.Conflict()
        if not InformeRepository.version_actual_consistente(informe):
            current_app.logger.error("Historial inconsistente; anulación de informe rechazada")
            raise InformeRepository.Conflict()
        InformeRepository.anular_informe(informe, usuario_id, motivo)
        nueva_revision = informe.revision_actual
        commit_started = True
        db.session.commit()
    except InformeRepository.Conflict:
        _rollback_informe()
        return {"success": False, "message": "Conflicto de revisión o estado."}, 409
    except IntegrityError as error:
        _rollback_informe()
        if not commit_started and _is_duplicate_version(error):
            return {"success": False, "message": "Conflicto de revisión o estado."}, 409
        current_app.logger.warning("Resultado de commit de anulación incierto" if commit_started
                                   else "Error de integridad al anular informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    except Exception:
        _rollback_informe()
        current_app.logger.warning("Resultado de commit de anulación incierto" if commit_started
                                   else "Error de persistencia al anular informe")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
    return {"success": True, "message": "Informe anulado correctamente.",
            "data": {"id": informe_id, "estado": "ANULADO", "revision_actual": nueva_revision}}, 200

def eliminar_informe_existente(informe_id):
    filas = InformeRepository.eliminar_informe(informe_id)
    if filas == 0:
        return {"success": False, "message": "Informe no encontrado o inactivo."}, 404
    return {"success": True, "message": "Informe eliminado correctamente."}, 200

def obtener_informes_paciente(paciente_id):
    informes = InformeRepository.listar_informes_por_paciente(paciente_id)
    return {"success": True, "data": [_parsear_datos(inf) for inf in informes]}, 200

def obtener_informes_por_paciente(paciente_id):
    return obtener_informes_paciente(paciente_id)

def consultar_informes_por_visita(visita_id):
    informes = InformeRepository.obtener_informes_por_visita(visita_id)
    return {"success": True, "data": [_parsear_datos(inf) for inf in informes]}, 200

def consultar_informes_por_diagnostico(diagnostico_id):
    return consultar_informes_por_visita(diagnostico_id)
