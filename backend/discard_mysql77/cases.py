"""Casos B ejecutables, no descubiertos por unittest/pytest ni ejecutados al importar."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from threading import Event, current_thread
import time
from unittest.mock import patch
from uuid import uuid4

from .application import (GRANTS, confirmation, discard_body, jpeg, request, seed)
from .safety import clean_environment, inside, require


def check(value):
    require(bool(value), 'ASERCION_DEL_CASO')


def post(h, f, body=None, actor=None):
    return request(h, f, 'POST', f'/api/diagnosticar/visita/{f.visit}/descartar-resultados',
                   body=body or discard_body(f), actor=actor)


def consult(h, f, operation):
    return request(h, f, 'GET', f'/api/diagnosticar/visita/{f.visit}/operaciones-descarte/{operation}')


def validate(h, f, eye='Izquierdo', corrected=False):
    return request(h, f, 'PUT', f'/api/diagnosticar/detalle/{f.details[eye]}/validar', body={
        'diagnostico_final': f.grades[1 if corrected else 2],
        'comentario_medico': 'Conservar comentario sintético',
        'motivo_correccion': 'Motivo sintético' if corrected else None})


def infer(h, f, eye='Izquierdo'):
    from io import BytesIO
    return request(h, f, 'POST', '/api/diagnosticar', data={
        'paciente_id': str(f.patient), 'visita_id': str(f.visit), 'ojo_evaluado': eye,
        'imagen': (BytesIO(jpeg()), 'synthetic.jpg', 'image/jpeg')})


def report(h, f, revision=0, legacy=False):
    body = {'paciente_id': f.patient, 'tipo_informe_id': f.report_type, 'visita_id': f.visit,
            'datos_estructurados': {'nota': 'Sintética', 'revision_inferencia_esperada': 'clave histórica'}}
    if not legacy:
        body['revision_inferencia_esperada'] = revision
    return request(h, f, 'POST', '/api/informes', body=body)


def rows(h, table, where='', parameters=None):
    from sqlalchemy import text
    check(table in h.db.metadata.tables)
    # Conexión observadora nueva, sin reutilizar snapshot de trabajadores.
    with h.admin.connect() as connection:
        values = [dict(row) for row in connection.execute(text(
            f'SELECT * FROM `{table}` ' + where), parameters or {}).mappings()]
        # MySQL no garantiza orden de un SELECT sin ORDER BY.
        return sorted(values, key=lambda row: json.dumps(row, sort_keys=True, default=str))


def clinical_snapshot(h):
    tables = ('visitas_clinicas', 'diagnosticos_retinopatia',
        'diagnosticos_retinopatia_detalle', 'informes', 'informes_versiones',
        'confirmaciones_exportacion_retinografo')
    if h.gate.phase == 'full':
        tables += ('diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones')
    return {table: rows(h, table) for table in tables}


def files(h):
    result = {}
    for folder in (h.root / 'backend/uploads/retinas', h.root / 'private', h.root / 'exports'):
        for path in folder.rglob('*'):
            path = inside(path, h.root)
            if path.is_file():
                result[str(path.relative_to(h.root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def state(h, f):
    return (rows(h, 'diagnosticos_retinopatia_detalle',
                 'WHERE diagnostico_retinopatia_id=:id', {'id': f.diagnosis}),
            rows(h, 'diagnostico_ia_revision_visita', 'WHERE visita_id=:id', {'id': f.visit}),
            rows(h, 'diagnostico_ia_descarte_operaciones', 'WHERE visita_id=:id', {'id': f.visit}))


def mutate(h, model, key, **values):
    row = h.db.session.get(model, key)
    for field, value in values.items():
        setattr(row, field, value)
    h.db.session.commit()
    h.db.session.remove()


def case(h, results, name, action, *, eyes=('Derecho', 'Izquierdo'), expected_codes=()):
    h.gate.ready(full=h.app.config['DIAGNOSIS_DISCARD_ENABLED'])
    before_errors = len([entry for entry in h.trace if entry['event'] == 'db_error'])
    with h.app.app_context():
        try:
            f = seed(h, eyes=eyes)
            action(f)
            # Un 1213/1205 inesperado no puede quedar oculto por un HTTP genérico.
            errors = [entry for entry in h.trace if entry['event'] == 'db_error'][before_errors:]
            check(tuple(entry['code'] for entry in errors) == expected_codes)
            results.append({'name': name, 'status': 'passed'})
        except Exception as error:
            results.append({'name': name, 'status': 'failed', 'error_class': type(error).__name__})
            raise
        finally:
            h.db.session.remove()


def run_disabled(h, results):
    def disabled(f):
        from sqlalchemy import inspect
        with h.admin.connect() as connection:
            check(not any(t.startswith('diagnostico_ia_') for t in inspect(connection).get_table_names()))
        # Comprobante sintético persistido; el flujo tradicional no lo altera.
        identifier = confirmation(h, f)
        before = rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE id=:id', {'id': identifier})
        check(validate(h, f, 'Derecho')[0] == 200)
        # Otra visita vacía de resultados para inferencia tradicional.
        g = seed(h, eyes=('Derecho',))
        check(infer(h, g)[0] == 200)
        check(report(h, g, legacy=True)[0] == 201)
        stored = rows(h, 'informes', 'WHERE visita_id=:id', {'id': g.visit})[0]['datos_estructurados']
        if isinstance(stored, str):
            stored = json.loads(stored)
        check(stored['revision_inferencia_esperada'] == 'clave histórica')
        check(post(h, f)[0] == 403)
        check(rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE id=:id', {'id': identifier}) == before)
    case(h, results, 'disabled_without_technical_tables', disabled)
    case(h, results, 'real_retinograph_disabled', lambda f: real_retinograph_flow(h, f, enabled=False),
         eyes=('Derecho',))


def real_retinograph_flow(h, f, *, enabled):
    """Rutas/servicios B1 y copia privada REALES; solo predictor/validadores IA sintéticos."""
    document = rows(h, 'pacientes', 'WHERE id=:id', {'id': f.patient})[0]['nro_documento']
    name = f'{document}_20261101_120000_FONDO_L_1.jpg'
    content = jpeg()
    digest = hashlib.sha256(content).hexdigest()
    export = inside(h.root / 'exports' / name, h.root)
    export.write_bytes(content)
    endpoint = '/api/diagnosticar/retinografo/confirmaciones'
    body = {'paciente_id': f.patient, 'nombre_exportacion': name, 'ojo_confirmado': 'Izquierdo',
            'sha256_previsualizacion': digest, 'confirmo_asociacion': True}
    before, before_files = clinical_snapshot(h), files(h)
    check(request(h, f, 'POST', endpoint, body={**body, 'sha256_previsualizacion': '0' * 64})[0] == 409)
    check(request(h, f, 'POST', endpoint, body={**body, 'ojo_confirmado': 'Derecho'})[0] == 409)
    check(request(h, f, 'POST', endpoint, body=body, actor=f.users[2])[0] == 403)
    check(clinical_snapshot(h) == before and files(h) == before_files)
    status, response = request(h, f, 'POST', endpoint, body=body)
    check(status == 201)
    token = response['confirmacion']['identificador']  # Solo memoria; no evidencia ni logs.
    record = rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE token_verificador=:token',
                  {'token': hashlib.sha256(bytes.fromhex(token)).digest()})[0]
    check(record['paciente_id'] == f.patient and record['ojo_confirmado'] == 'Izquierdo' and
          record['sha256_fuente'] == digest and record['estado'] == 'CONFIRMADA')
    private = inside(h.root / 'private' / record['clave_copia'], h.root)
    check(private.read_bytes() == content)
    check(request(h, f, 'POST', endpoint + '/estado', body={'identificador': token})[1]['confirmacion']['vigente'])
    payload = {'paciente_id': str(f.patient), 'visita_id': str(f.visit),
               'ojo_evaluado': 'Izquierdo', 'confirmacion_exportacion': token}
    status, result = request(h, f, 'POST', '/api/diagnosticar', data=payload)
    check(status == 200 and result['data']['visita_id'] == f.visit)
    detail_id = result['data']['detalle_id']
    consumed = rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE id=:id', {'id': record['id']})[0]
    check(consumed['estado'] == 'CONSUMIDA' and consumed['detalle_id'] == detail_id and
          consumed['fecha_consumo'] is not None)
    detail = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': detail_id})[0]
    check(detail['ojo_evaluado'] == 'Izquierdo' and detail['hash_archivo'] == digest)
    # Visita vacía del mismo paciente: el rechazo debe ser por comprobante consumido,
    # no meramente por duplicar un ojo ya existente.
    visit = h.patients.VisitaClinica(paciente_id=f.patient, usuario_id=f.users[0])
    h.db.session.add(visit)
    h.db.session.commit()
    unused_visit = visit.id
    h.db.session.remove()
    before, before_files = clinical_snapshot(h), files(h)
    check(request(h, f, 'POST', '/api/diagnosticar', data={**payload, 'visita_id': str(unused_visit)})[0] == 409)
    # Lote mixto con OD manual pendiente: tampoco hay borrado parcial.
    for ids in ([detail_id], [f.details['Derecho'], detail_id]):
        status, response = post(h, f, discard_body(f, ids))
        check(status == (409 if enabled else 403))
        if enabled:
            check(response['code'] == 'COMPROBANTE_VINCULADO')
    check(clinical_snapshot(h) == before and files(h) == before_files and private.read_bytes() == content)


def schema_contract(h, results):
    def contract(f):
        from sqlalchemy import inspect, text
        from .safety import proposal_statements
        with h.admin.connect() as connection:
            inspector = inspect(connection)
            columns = connection.execute(text('''SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE,
                COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME
                FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()''')).all()
            by_name = {(row[0], row[1]): row[2:] for row in columns}
            for table, name in (('usuarios', 'id'), ('pacientes', 'id'),
                                ('visitas_clinicas', 'id'), ('diagnosticos_retinopatia_detalle', 'id'),
                                ('diagnostico_ia_revision_visita', 'visita_id'),
                                ('diagnostico_ia_descarte_operaciones', 'autor_id')):
                check('unsigned' in by_name[(table, name)][0])
            uuid_column = by_name[('diagnostico_ia_descarte_operaciones', 'operacion_id')]
            check(uuid_column[0] == 'varchar(36)' and uuid_column[2:] == ('ascii', 'ascii_bin'))
            check(by_name[('diagnostico_ia_revision_visita', 'revision')][1] == '0')
            check(by_name[('diagnostico_ia_descarte_operaciones', 'estado_limpieza')][1] == 'PENDIENTE')
            check(inspector.get_pk_constraint('diagnostico_ia_revision_visita')['constrained_columns'] == ['visita_id'])
            check(inspector.get_pk_constraint('diagnostico_ia_descarte_operaciones')['constrained_columns'] == ['operacion_id'])
            indexes = {index['name'] for index in inspector.get_indexes('diagnostico_ia_descarte_operaciones')}
            check({'ix_diagnostico_ia_descarte_operaciones_visita_id',
                   'ix_diagnostico_ia_descarte_operaciones_estado_limpieza'} <= indexes)
            for table in ('diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones'):
                for fk in inspector.get_foreign_keys(table):
                    check(fk['options'].get('ondelete', 'RESTRICT').upper() in ('RESTRICT', 'NO ACTION'))
            unique = inspector.get_unique_constraints('diagnosticos_retinopatia')
            check(any(item['column_names'] == ['visita_id'] for item in unique))
        # Reinstalar no es idempotencia de DDL: falla explícitamente, sin compensación.
        try:
            with h.admin.begin() as connection:
                connection.exec_driver_sql(proposal_statements(h.root / 'backend')[0])
        except Exception as error:
            check(getattr(getattr(error, 'orig', None), 'args', (None,))[0] == 1050)
        else:
            check(False)
        # CHECK realmente aplicado, no solo texto presente en information_schema.
        try:
            with h.admin.begin() as connection:
                connection.execute(text('''INSERT INTO diagnostico_ia_descarte_operaciones
                    (operacion_id,visita_id,autor_id,solicitud,resultado,archivos,estado_limpieza,fecha_utc)
                    VALUES (:uuid,:visit,:actor,'{}','{}','[]','INVALID',UTC_TIMESTAMP(6))'''),
                    {'uuid': str(uuid4()), 'visit': f.visit, 'actor': f.users[0]})
        except Exception as error:
            check(getattr(getattr(error, 'orig', None), 'args', (None,))[0] == 3819)
        else:
            check(False)
        check(not state(h, f)[2])
    case(h, results, 'native_schema_types_constraints_and_repeat_install', contract)


def integrity(h, results):
    def single(f):
        before = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']})
        visit = rows(h, 'visitas_clinicas', 'WHERE id=:id', {'id': f.visit})
        body = discard_body(f)
        before_files = files(h)
        check(post(h, f, body)[0] == 200)
        details, revision, operations = state(h, f)
        check(details == before and revision[0]['revision'] == 1 and len(operations) == 1)
        check(operations[0]['operacion_id'] == body['operacion_id'])
        check(operations[0]['estado_limpieza'] == 'PENDIENTE' and files(h) == before_files)
        check(rows(h, 'visitas_clinicas', 'WHERE id=:id', {'id': f.visit}) == visit)
        status, response = infer(h, f)
        check(status == 200 and response['data']['visita_id'] == f.visit)
        check(response['data']['diagnostico_retinopatia_id'] == f.diagnosis)
        check(rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']}) == before)
    case(h, results, 'single_eye_and_reinfer_same_visit', single)
    for corrected in (False, True):
        def preserved(f, corrected=corrected):
            check(validate(h, f, 'Derecho', corrected)[0] == 200)
            before = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']})
            check(post(h, f)[0] == 200)
            check(rows(h, 'diagnosticos_retinopatia', 'WHERE id=:id', {'id': f.diagnosis})[0]['estado'] == 'VALIDADO')
            check(infer(h, f)[0] == 200)
            check(rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']}) == before)
        case(h, results, 'preserve_' + ('CORREGIDO' if corrected else 'APROBADO'), preserved)
    for mixed in (False, True):
        case(h, results, 'reject_selected_CORREGIDO_mixed' if mixed else 'reject_selected_CORREGIDO',
             lambda f, mixed=mixed: reject_corrected_selected(h, f, mixed=mixed))
    def both(f):
        visit = rows(h, 'visitas_clinicas', 'WHERE id=:id', {'id': f.visit})
        body = discard_body(f, list(f.details.values()))
        status, original = post(h, f, body)
        check(status == 200)
        check(not rows(h, 'diagnosticos_retinopatia', 'WHERE id=:id', {'id': f.diagnosis}))
        check(rows(h, 'visitas_clinicas', 'WHERE id=:id', {'id': f.visit}) == visit)
        status, response = infer(h, f)
        check(status == 200 and response['data']['visita_id'] == f.visit)
        check(response['data']['diagnostico_retinopatia_id'] != f.diagnosis)
        before = clinical_snapshot(h)
        check(post(h, f, body)[1]['data']['resultado'] == original['data']['resultado'])
        check(post(h, f, {**body, 'operacion_id': str(uuid4()), 'revision_esperada': 1})[0] == 409)
        check(clinical_snapshot(h) == before)
    case(h, results, 'both_eyes_new_parent_same_visit', both)
    for reason in ('validated', 'consumed', 'report_ACTIVE', 'report_INACTIVE', 'report_ANNULLED',
                   'visit_CERRADA', 'visit_ANULADA', 'patient', 'foreign_detail', 'mixed'):
        def rejected(f, reason=reason):
            body = discard_body(f)
            if reason in ('validated', 'mixed'):
                check(validate(h, f)[0] == 200)
                if reason == 'mixed':
                    body['detalle_ids'] = list(f.details.values())
            elif reason == 'consumed':
                confirmation(h, f, f.details['Izquierdo'])
                body['detalle_ids'] = list(f.details.values())
            elif reason.startswith('report_'):
                status, result = report(h, f)
                check(status == 201)
                mutate(h, h.reports.Informe, result['data']['id'],
                       estado={'ACTIVE': 'ACTIVO', 'INACTIVE': 'INACTIVO', 'ANNULLED': 'ANULADO'}[reason[7:]])
            elif reason.startswith('visit_'):
                mutate(h, h.patients.VisitaClinica, f.visit, estado=reason[6:])
            else:
                other = seed(h)
                if reason == 'patient':
                    body['paciente_id'] = other.patient
                else:
                    body['detalle_ids'] = [f.details['Derecho'], other.details['Izquierdo']]
            before, before_files = clinical_snapshot(h), files(h)
            check(post(h, f, body)[0] in (403, 409))
            check(clinical_snapshot(h) == before and files(h) == before_files)
        case(h, results, 'reject_' + reason, rejected)


def reject_corrected_selected(h, f, *, mixed):
    check(validate(h, f, 'Derecho', corrected=True)[0] == 200)
    corrected = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']})[0]
    check(corrected['estado_validacion'] == 'CORREGIDO' and corrected['motivo_correccion'] and
          corrected['resultado_final_id'] != corrected['resultado_ia_id'])
    before, before_files = clinical_snapshot(h), files(h)
    ids = [f.details['Derecho'], f.details['Izquierdo']] if mixed else [f.details['Derecho']]
    status, response = post(h, f, discard_body(f, ids))
    check(status == 409 and response['code'] == 'RESULTADO_VALIDADO')
    # Incluye TODAS las columnas médicas, visita, revisión, operaciones y bytes JPEG/Grad-CAM.
    check(clinical_snapshot(h) == before and files(h) == before_files)


def authorization(h, results):
    for mode in ('no_discard', 'admin', 'admin_only_grant', 'revoked', 'inactive_role',
                 'inactive_user', 'other_creator', 'other_visit', 'create_validate_only'):
        def denied(f, mode=mode):
            a, db = h.auth, h.db
            actor = f.users[0]
            grant = (f.roles['clinical'], f.permissions['diagnostico_retinopatia.descartar_pendiente'])
            restore = []
            if mode in ('no_discard', 'create_validate_only', 'admin_only_grant', 'revoked'):
                db.session.delete(db.session.get(a.RolPermiso, grant))
                restore.append(lambda: db.session.add(a.RolPermiso(rol_id=grant[0], permiso_id=grant[1])))
            if mode in ('admin', 'admin_only_grant'):
                if mode == 'admin':
                    actor = f.users[2]
                else:
                    db.session.add(a.UsuarioRol(usuario_id=actor, rol_id=f.roles['admin']))
                for code in GRANTS:
                    key = (f.roles['admin'], f.permissions[code])
                    if not db.session.get(a.RolPermiso, key):
                        db.session.add(a.RolPermiso(rol_id=key[0], permiso_id=key[1]))
            if mode in ('inactive_role', 'inactive_user'):
                model, key = (a.Rol, f.roles['clinical']) if mode == 'inactive_role' else (a.Usuario, actor)
                db.session.get(model, key).estado = 'INACTIVO'
                restore.append(lambda: setattr(db.session.get(model, key), 'estado', 'ACTIVO'))
            if mode == 'other_creator':
                actor = f.users[1]
            db.session.commit()
            db.session.remove()
            try:
                before, before_files = clinical_snapshot(h), files(h)
                if mode == 'other_visit':
                    other = seed(h)
                    before, before_files = clinical_snapshot(h), files(h)
                    status, _ = request(h, f, 'POST',
                        f'/api/diagnosticar/visita/{other.visit}/descartar-resultados', body=discard_body(f))
                else:
                    status, _ = post(h, f, actor=actor)
                check(status in (401, 403) and clinical_snapshot(h) == before and files(h) == before_files)
            finally:
                for restore_one in restore:
                    restore_one()
                db.session.commit()
                db.session.remove()
        case(h, results, 'B1_' + mode, denied)


@contextmanager
def sql_pause(h, first_match, second_match):
    """Pausar DESPUÉS del lock real; observar espera en performance_schema."""
    from sqlalchemy import event, text
    with h.app.app_context():
        engine = h.db.engine
    locked, attempted, release = Event(), Event(), Event()
    identities = {}
    first_paused = False
    def normalized(statement):
        return ' '.join(statement.lower().replace('`', '').split())
    def before(_connection, cursor, statement, _params, _context, _many):
        if current_thread().name.endswith('_1') and second_match(normalized(statement)):
            identities['second'] = cursor.connection.thread_id()
            attempted.set()
    def after(_connection, cursor, statement, _params, _context, _many):
        nonlocal first_paused
        if current_thread().name.endswith('_0') and not first_paused and first_match(normalized(statement)):
            first_paused = True
            identities['first'] = cursor.connection.thread_id()
            locked.set()
            check(release.wait(12))
    event.listen(engine, 'before_cursor_execute', before)
    event.listen(engine, 'after_cursor_execute', after)
    try:
        def observed_wait():
            check(attempted.wait(4))
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                with h.admin.connect() as observer:
                    waiting = observer.execute(text('''SELECT COUNT(*)
                        FROM performance_schema.data_lock_waits w
                        JOIN performance_schema.threads r ON r.THREAD_ID=w.REQUESTING_THREAD_ID
                        JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID
                        WHERE r.PROCESSLIST_ID=:second AND b.PROCESSLIST_ID=:first'''), identities).scalar()
                if waiting:
                    h.trace.append({'event': 'lock_wait_observed', **identities})
                    return
                Event().wait(0.01)  # Se acredita por la consulta, no por transcurso de tiempo.
            check(False)
        yield locked, attempted, release, observed_wait
    finally:
        release.set()
        event.remove(engine, 'before_cursor_execute', before)
        event.remove(engine, 'after_cursor_execute', after)


def locking(table):
    return lambda sql: ('from ' + table + ' ') in sql and 'for update' in sql


def race(h, first, second, first_match, second_match, *, wait=True):
    with sql_pause(h, first_match, second_match) as (locked, attempted, release, observed):
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix='codn77') as executor:
            try:
                a = executor.submit(first)
                check(locked.wait(4))
                b = executor.submit(second)
                if wait:
                    observed()
                else:
                    check(attempted.wait(4))
                    h.trace.append({'event': 'overlap_distinct_visits_not_lock_free_claim'})
                release.set()
                return a.result(timeout=15), b.result(timeout=15)
            finally:
                release.set()


def concurrency(h, results):
    V, D = locking('visitas_clinicas'), locking('diagnosticos_retinopatia')
    for validation_first in (True, False):
        def medical(f, validation_first=validation_first):
            body = discard_body(f)
            tasks = (lambda: validate(h, f), lambda: post(h, f, body))
            if not validation_first:
                tasks = tasks[::-1]
            a, b = race(h, *tasks, D, D if not validation_first else V)
            # Validación primero: descarte adquiere V libre y luego espera D.
            # La conexión contendiente se registra antes de V, la espera real se observa en D.
            check(a[0] == 200 and b[0] == (409 if validation_first else 404))
            details, revisions, ops = state(h, f)
            check(len(details) == (2 if validation_first else 1))
            check(len(ops) == (0 if validation_first else 1))
            check((revisions[0]['revision'] if revisions else 0) == (0 if validation_first else 1))
            if validation_first:
                check(next(row for row in details if row['id'] == f.details['Izquierdo'])['estado_validacion'] == 'APROBADO')
            else:
                check(ops[0]['operacion_id'] == body['operacion_id'])
        case(h, results, 'race_validation_first' if validation_first else 'race_discard_first_validation', medical)
    for same_uuid in (True, False):
        def concurrent_discard(f, same_uuid=same_uuid):
            a = discard_body(f)
            b = dict(a) if same_uuid else {**a, 'operacion_id': str(uuid4())}
            first, second = race(h, lambda: post(h, f, a), lambda: post(h, f, b), V, V)
            check(first[0] == 200 and second[0] == (200 if same_uuid else 409))
            details, revisions, operations = state(h, f)
            check(len(details) == 1 and revisions[0]['revision'] == 1 and len(operations) == 1)
            check(operations[0]['operacion_id'] == a['operacion_id'])
            if same_uuid:
                check(first[1]['data']['resultado'] == second[1]['data']['resultado'])
        case(h, results, 'race_same_UUID' if same_uuid else 'race_distinct_UUID', concurrent_discard)
    def stale(f):
        ready, release = Event(), Event()
        def pause():
            from database import db
            check(not db.session().in_transaction())
            ready.set()
            check(release.wait(12))
        h.predictor.pause = pause
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                future = executor.submit(lambda: infer(h, f))
                check(ready.wait(4))
                body = discard_body(f, [f.details['Derecho']])
                check(post(h, f, body)[0] == 200)
                release.set()
                status, response = future.result(timeout=15)
                check(status == 409 and response['code'] == 'INFERENCIA_OBSOLETA')
                details, revision, ops = state(h, f)
                check(not details and revision[0]['revision'] == 1 and len(ops) == 1)
            finally:
                release.set()
                h.predictor.pause = lambda: None
    case(h, results, 'race_old_inference_other_eye_after_discard', stale, eyes=('Derecho',))
    def other_first(f):
        body = discard_body(f, [f.details['Derecho']])
        a, b = race(h, lambda: infer(h, f), lambda: post(h, f, body),
                   lambda sql: sql.startswith('insert into diagnosticos_retinopatia_detalle '), V)
        check(a[0] == b[0] == 200)
        details, revisions, operations = state(h, f)
        check(len(details) == 1 and details[0]['id'] == a[1]['data']['detalle_id'])
        check(details[0]['ojo_evaluado'] == 'Izquierdo' and revisions[0]['revision'] == 1)
        check(operations[0]['operacion_id'] == body['operacion_id'])
    case(h, results, 'race_other_eye_commits_first', other_first, eyes=('Derecho',))
    for report_first in (True, False):
        def reports(f, report_first=report_first):
            body = discard_body(f)
            tasks = (lambda: report(h, f), lambda: post(h, f, body))
            if not report_first:
                tasks = tasks[::-1]
            a, b = race(h, *tasks, V, V)
            check(a[0] == (201 if report_first else 200) and b[0] == 409)
            check(b[1]['code'] == ('INFORMES_EXISTENTES' if report_first else 'CONTEXTO_INFORME_OBSOLETO'))
            details, revision, ops = state(h, f)
            check(len(details) == (2 if report_first else 1))
            check(len(ops) == (0 if report_first else 1))
            check((revision[0]['revision'] if revision else 0) == (0 if report_first else 1))
            check(len(rows(h, 'informes', 'WHERE visita_id=:id', {'id': f.visit})) == int(report_first))
            if report_first:
                check(len(rows(h, 'informes_versiones', 'WHERE informe_id=:id', {'id': a[1]['data']['id']})) == 1)
        case(h, results, 'race_report_first' if report_first else 'race_discard_before_stale_report', reports)
    def separate(f):
        g = seed(h)
        a, b = discard_body(f), discard_body(g)
        first, second = race(h, lambda: post(h, f, a), lambda: post(h, g, b),
                            lambda sql: 'imagen_original_url =' in sql and 'for update' in sql,
                            V, wait=False)
        check(first[0] == second[0] == 200)
        for fixture, body in ((f, a), (g, b)):
            details, revision, ops = state(h, fixture)
            check(len(details) == 1 and details[0]['id'] == fixture.details['Derecho'])
            check(revision[0]['revision'] == 1 and ops[0]['operacion_id'] == body['operacion_id'])
    case(h, results, 'race_separate_visits_global_reference_locks', separate)


def uncertain(h, results):
    def idempotent(f):
        body = discard_body(f)
        # GET ausente puede preceder a un POST que todavía confirmará.
        status, value = consult(h, f, body['operacion_id'])
        check(status == 200 and value['data'] == {'operacion': None, 'conciliacion': 'NO_CONFIRMADA'})
        status, first = post(h, f, body)
        check(status == 200)
        status, new = infer(h, f)
        check(status == 200 and new['data']['detalle_id'] != f.details['Izquierdo'])
        before = clinical_snapshot(h)
        check(post(h, f, body)[1]['data']['resultado'] == first['data']['resultado'])
        check(post(h, f, {**body, 'detalle_ids': [new['data']['detalle_id']]})[1]['code'] == 'OPERACION_REUTILIZADA')
        for revision in (0, 1):
            check(post(h, f, {**body, 'operacion_id': str(uuid4()), 'revision_esperada': revision})[0] == 409)
        check(clinical_snapshot(h) == before)
    case(h, results, 'UUID_content_and_old_ID_vs_replacement', idempotent)
    def lost(f):
        body = discard_body(f)
        before_files = files(h)
        commit = h.db.session.commit
        def lost_ack():
            commit()
            raise RuntimeError('SYNTHETIC_ACK_LOST')
        with patch.object(h.db.session, 'commit', side_effect=lost_ack):
            status, value = post(h, f, body)
        check(status == 503 and value['code'] == 'PERSISTENCIA_INCIERTA' and files(h) == before_files)
        # Solo GET: no repetir POST después de ACK perdido.
        for _ in range(2):
            status, value = consult(h, f, body['operacion_id'])
            check(status == 200 and value['data']['conciliacion'] == 'CONFIRMADA')
        details, revision, operations = state(h, f)
        check(len(details) == 1 and revision[0]['revision'] == 1 and len(operations) == 1)
    case(h, results, 'lost_ack_commit_and_GET_only_recovery', lost)
    def rollback(f):
        from src.repositories.diagnosis_discard_repository import DiagnosisDiscardRepository as Repo
        before, before_files = clinical_snapshot(h), files(h)
        with patch.object(Repo, 'increment', side_effect=RuntimeError('SYNTHETIC_BEFORE_COMMIT')):
            check(post(h, f)[0] == 503)
        check(clinical_snapshot(h) == before and files(h) == before_files)
    case(h, results, 'rollback_after_exact_DELETE_keeps_files', rollback)
    for method in ('GET', 'POST'):
        def lock_timeout(f, method=method):
            from sqlalchemy import event, text
            with h.app.app_context():
                engine = h.db.engine
            body = discard_body(f)
            before, before_files = clinical_snapshot(h), files(h)
            # Bloqueador y solicitud usan conexiones físicas distintas.
            def timeout(connection, _record, _proxy):
                with connection.cursor() as cursor:
                    cursor.execute('SET SESSION innodb_lock_wait_timeout=1')
            event.listen(engine, 'checkout', timeout)
            try:
                with engine.connect() as blocker:
                    transaction = blocker.begin()
                    blocker.execute(text('SELECT id FROM visitas_clinicas WHERE id=:id FOR UPDATE'), {'id': f.visit})
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        action = (lambda: consult(h, f, body['operacion_id'])) if method == 'GET' else (lambda: post(h, f, body))
                        try:
                            status, response = executor.submit(action).result(timeout=6)
                            check(status == 503 and not response['success'])
                        finally:
                            transaction.rollback()
                # Reconsultar, nunca repetir el POST incierto/rechazado por lock.
                for _ in range(2):
                    status, value = consult(h, f, body['operacion_id'])
                    check(status == 200 and value['data']['conciliacion'] == 'NO_CONFIRMADA')
                check(clinical_snapshot(h) == before and files(h) == before_files)
            finally:
                event.remove(engine, 'checkout', timeout)
        case(h, results, 'lock_timeout_' + method + '_GET_only_reconciliation', lock_timeout,
             expected_codes=(1205,))


def cleanup_cli(h, operation):
    result = h.app.test_cli_runner().invoke(args=[
        'diagnosis_discard', 'limpiar', '--operacion-id', operation, '--confirmar'])
    check(result.exit_code == 0)


def storage_cases(h, results):
    for variant in ('normal', 'absent', 'replaced', 'identity_changed', 'missing_then_reused',
                    'hardlink', 'symlink', 'referenced'):
        def cleanup(f, variant=variant):
            import os
            body = discard_body(f)
            if variant == 'missing_then_reused':
                detail = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Izquierdo']})[0]
                (Path(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT']) / detail['imagen_original_url']).unlink()
            check(post(h, f, body)[0] == 200)
            row = rows(h, 'diagnostico_ia_descarte_operaciones', 'WHERE operacion_id=:id', {'id': body['operacion_id']})[0]
            entries = row['archivos']
            if isinstance(entries, str):
                entries = json.loads(entries)
            path = inside(Path(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT']) / entries[0]['nombre'], h.root)
            protected = None
            if variant == 'absent':
                path.unlink()
            elif variant == 'replaced':
                path.unlink()
                path.write_bytes(b'NEW_SYNTHETIC_IDENTITY')
            elif variant == 'identity_changed':
                info = path.stat()
                os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
            elif variant == 'missing_then_reused':
                # Escoger la entrada ausente: el orden lexicográfico puede elegir Grad-CAM primero.
                entry = next(entry for entry in entries if entry['identidad'] is None)
                path = inside(Path(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT']) / entry['nombre'], h.root)
                path.write_bytes(b'NEW_SYNTHETIC_NAME_REUSED')
            elif variant == 'hardlink':
                os.link(path, path.with_suffix('.alias'))
            elif variant == 'symlink':
                protected = path.with_suffix('.protected')
                protected.write_bytes(b'SYNTHETIC_PROTECTED_TARGET')
                path.unlink()
                # Falta de privilegio de symlink debe bloquear el caso, no acreditarlo.
                os.symlink(protected, path)
            elif variant == 'referenced':
                mutate(h, h.diagnosis.DiagnosticoDetalle, f.details['Derecho'], imagen_original_url=path.name)
            cleanup_cli(h, body['operacion_id'])
            status, value = consult(h, f, body['operacion_id'])
            expected = {'COMPLETADA'} if variant in ('normal', 'absent') else (
                {'PENDIENTE', 'CONFLICTO'} if variant == 'symlink' else {'CONFLICTO'})
            check(status == 200 and value['data']['operacion']['limpieza'] in expected)
            if variant in ('normal', 'absent'):
                cleanup_cli(h, body['operacion_id'])
                check(not path.exists())
            else:
                check(path.exists())
            if protected:
                check(protected.read_bytes() == b'SYNTHETIC_PROTECTED_TARGET')
                # Retirar únicamente el enlace sintético creado por ESTE caso.
                check(path.is_symlink())
                path.unlink()
        case(h, results, 'cleanup_' + variant, cleanup)
    def shared(f):
        original = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Izquierdo']})[0]
        mutate(h, h.diagnosis.DiagnosticoDetalle, f.details['Derecho'], imagen_original_url=original['imagen_original_url'])
        before, before_files = clinical_snapshot(h), files(h)
        check(post(h, f)[1]['code'] == 'ARCHIVO_COMPARTIDO')
        check(clinical_snapshot(h) == before and files(h) == before_files)
    case(h, results, 'shared_file_refuses_discard', shared)
    def before_hardlink(f):
        import os
        row = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Izquierdo']})[0]
        path = inside(Path(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT']) / row['imagen_original_url'], h.root)
        os.link(path, path.with_suffix('.alias'))
        before, before_files = clinical_snapshot(h), files(h)
        check(post(h, f)[0] == 503)
        check(clinical_snapshot(h) == before and files(h) == before_files)
    case(h, results, 'hardlink_before_discard_is_rejected', before_hardlink)
    def other_retinograph(f):
        identifier = confirmation(h, f, f.details['Derecho'])
        confirmation_before = rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE id=:id', {'id': identifier})
        detail_before = rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']})
        private_before = {str(p): p.read_bytes() for p in (h.root / 'private').rglob('*') if p.is_file()}
        body = discard_body(f)
        check(post(h, f, body)[0] == 200)
        cleanup_cli(h, body['operacion_id'])
        check(rows(h, 'confirmaciones_exportacion_retinografo', 'WHERE id=:id', {'id': identifier}) == confirmation_before)
        check(rows(h, 'diagnosticos_retinopatia_detalle', 'WHERE id=:id', {'id': f.details['Derecho']}) == detail_before)
        check({str(p): p.read_bytes() for p in (h.root / 'private').rglob('*') if p.is_file()} == private_before)
    case(h, results, 'preserve_unaffected_retinograph_copy_and_confirmation', other_retinograph)
    def paths(f):
        before, before_files = clinical_snapshot(h), files(h)
        with patch.dict(h.app.config, DIAGNOSIS_DISCARD_STORAGE_ROOT=str(h.root / 'private')):
            check(post(h, f)[0] == 503)
        with patch('os.getcwd', return_value=str(h.root / 'tmp')):
            check(post(h, f)[0] == 503)
        for name in ('../external.jpg', str(h.root / 'external.jpg')):
            try:
                h.storage.snapshot(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT'], name)
            except ValueError:
                pass
            else:
                check(False)
        check(clinical_snapshot(h) == before and files(h) == before_files)
    case(h, results, 'outside_root_and_writer_reader_mismatch', paths)
    def restart(f):
        body = discard_body(f)
        check(post(h, f, body)[0] == 200)
        payload = {**h.payload, 'action': 'cleanup', 'operation_id': body['operacion_id']}
        # Aplicación nueva/proceso nuevo, mismo manifiesto SQL; no servidor HTTP.
        result = subprocess.run([sys.executable, '-I', '-B', str(h.root / 'backend/discard_mysql77/worker.py')],
            input=json.dumps(payload), text=True, cwd=h.root / 'backend',
            env=clean_environment(h.root), capture_output=True, timeout=60)
        check(result.returncode == 0)
        check(consult(h, f, body['operacion_id'])[1]['data']['operacion']['limpieza'] == 'COMPLETADA')
    case(h, results, 'cleanup_new_process_from_persistent_manifest', restart)
    def crash_after_unlink(f):
        body = discard_body(f)
        check(post(h, f, body)[0] == 200)
        # Inyectar caída tras unlink y antes de commit del estado de limpieza.
        with patch.object(h.db.session, 'commit', side_effect=RuntimeError('SYNTHETIC_CRASH')):
            from services.diagnosis_discard_service import clean_operation
            check(clean_operation(body['operacion_id'])[1] == 503)
        check(consult(h, f, body['operacion_id'])[1]['data']['operacion']['limpieza'] == 'PENDIENTE')
        cleanup_cli(h, body['operacion_id'])
        check(consult(h, f, body['operacion_id'])[1]['data']['operacion']['limpieza'] == 'COMPLETADA')
    case(h, results, 'cleanup_unlink_before_commit_idempotent_retry', crash_after_unlink)


def mysql_errors(h, results):
    """Errores reales, tablas/fila de dos visitas sintéticas; sin retry de POST."""
    from sqlalchemy import text
    def probe(f, deadlock):
        g = seed(h)
        with h.app.app_context():
            engine = h.db.engine
        before = rows(h, 'visitas_clinicas')
        ready, contender, release = Event(), Event(), Event()
        observed = []
        def worker(first):
            with engine.connect() as connection:
                transaction = connection.begin()
                try:
                    connection.execute(text('SET SESSION innodb_lock_wait_timeout=1'))
                    connection.execute(text('UPDATE visitas_clinicas SET observaciones=:note WHERE id=:id'),
                        {'note': 'SYNTHETIC_UNCOMMITTED', 'id': f.visit if first else g.visit})
                    if first:
                        ready.set()
                        check(contender.wait(4))
                        if deadlock:
                            connection.execute(text('UPDATE visitas_clinicas SET observaciones=:note WHERE id=:id'),
                                {'note': 'SYNTHETIC_UNCOMMITTED', 'id': g.visit})
                        else:
                            check(release.wait(4))
                    else:
                        check(ready.wait(4))
                        contender.set()
                        connection.execute(text('UPDATE visitas_clinicas SET observaciones=:note WHERE id=:id'),
                            {'note': 'SYNTHETIC_UNCOMMITTED', 'id': f.visit})
                except Exception as error:
                    code = getattr(getattr(error, 'orig', None), 'args', (None,))[0]
                    check(code == (1213 if deadlock else 1205))
                    observed.append(code)
                finally:
                    # 1205 no implica rollback total: hacerlo y acreditar ambas filas.
                    transaction.rollback()
                    if not first:
                        release.set()
        with ThreadPoolExecutor(max_workers=2) as executor:
            a = executor.submit(worker, True)
            check(ready.wait(4))
            b = executor.submit(worker, False)
            try:
                a.result(timeout=10)
                b.result(timeout=10)
            finally:
                release.set()
        check(observed == [1213 if deadlock else 1205])
        check(rows(h, 'visitas_clinicas') == before)
    for deadlock in (False, True):
        # Los errores esperados se registran explícitamente, fuera de case() que los prohíbe.
        name = 'mysql_1213_full_rollback' if deadlock else 'mysql_1205_full_rollback'
        with h.app.app_context():
            try:
                probe(seed(h), deadlock)
                results.append({'name': name, 'status': 'passed'})
            except Exception as error:
                results.append({'name': name, 'status': 'failed', 'error_class': type(error).__name__})
                raise
            finally:
                h.db.session.remove()


def run_enabled(h, results):
    schema_contract(h, results)
    case(h, results, 'real_retinograph_enabled', lambda f: real_retinograph_flow(h, f, enabled=True),
         eyes=('Derecho',))
    integrity(h, results)
    authorization(h, results)
    concurrency(h, results)
    uncertain(h, results)
    mysql_errors(h, results)
    storage_cases(h, results)
