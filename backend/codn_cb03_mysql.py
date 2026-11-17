"""CB-03 infrastructure. No connection or DML on import; deny by default.

The caller must obtain separate user approval for provisioning and fixture writes.
An explicit pinned, disposable instance is required; no .env or habitual fallback.
"""
from contextlib import contextmanager
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from types import SimpleNamespace as NS
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parent
HABITUAL_UUID = '1b48ef4a-4e14-11f1-acd7-107c616721bd'  # historical denylist, never a connection target
TABLES = ('tipos_documento', 'cargos', 'usuarios', 'pacientes', 'visitas_clinicas',
          'tipos_informe', 'informes', 'informes_versiones', 'grados_retinopatia',
          'diagnosticos_retinopatia', 'diagnosticos_retinopatia_detalle')
ACTIVITY = {'verified_checkouts': 0, 'insert_attempts': 0, 'commit_attempts_blocked': 0}


class SafetyGateError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise SafetyGateError(message)


def validate_config(config, *, writes=False):
    require(config.get('exclusive_test_instance') is True, 'Instancia exclusiva no autorizada.')
    require(config.get('read_only_inspection_authorized') is True, 'Inspección de instancia no autorizada.')
    require(config.get('host') == '127.0.0.1', 'Solo loopback IPv4 explícito.')
    port = config.get('port')
    require(type(port) is int and 1024 <= port <= 65535 and port not in (3306, 33060), 'Puerto ausente o habitual.')
    require(re.fullmatch(r'codn_cb03_[a-z0-9_]{8,50}', config.get('database', '')) is not None, 'Esquema exclusivo requerido.')
    require(config.get('username') and config['username'].lower() != 'root', 'Cuenta restringida requerida.')
    uuid = config.get('server_uuid', '')
    require(isinstance(uuid, str) and re.fullmatch(r'[0-9a-fA-F-]{36}', uuid) is not None and uuid != HABITUAL_UUID,
            'UUID no fijado o habitual.')
    root = Path(config.get('instance_root', '')).resolve()
    base = (BACKEND.parent / 'tmp' / 'codn-cb03').resolve()
    require(root != base and base in root.parents, 'Raíz fuera de tmp/codn-cb03/<instancia>.')
    datadir = Path(config.get('datadir', '')).resolve()
    require(datadir == root / 'data', 'Datadir no coincide con raíz propia/data.')
    require(root.is_dir() and datadir.is_dir(), 'Instancia propuesta todavía no provisionada.')
    marker = root / 'codn-cb03-instance.json'
    require(marker.is_file(), 'Falta acta local de instancia exclusiva.')
    owner = json.loads(marker.read_text(encoding='utf-8-sig'))
    require(owner.get('purpose') == 'CODN_CB03_DISPOSABLE' and owner.get('server_uuid') == uuid
            and owner.get('port') == port, 'Acta no coincide con UUID/puerto autorizado.')
    auto = datadir / 'auto.cnf'
    require(auto.is_file() and re.search(r'^server-uuid\s*=\s*' + re.escape(uuid) + r'\s*$',
            auto.read_text(encoding='utf-8-sig'), re.M | re.I), 'auto.cnf no acredita UUID fijado.')
    if writes:
        require(config.get('fixture_writes_authorized') is True, 'INSERT de fixtures no autorizado por el usuario.')
        require(config.get('approval_reference'), 'Falta referencia a aprobación humana de destino y operaciones.')
    return config


def load_targets():
    # Only configuration read is replaced. The DB object, ORM models and queries remain real.
    with patch('dotenv.load_dotenv', return_value=False):
        from database import db, configure_utc_sessions
        from src.models.auth_entities import Cargo, TipoDocumento, Usuario
        from src.models.patient_entities import Paciente, VisitaClinica
        from src.models.informe_entities import TipoInforme, Informe, InformeVersion
        from src.models.diagnosis_entities import GradoRetinopatia, Diagnostico, DiagnosticoDetalle
        from src.repositories.informe_repository import InformeRepository
        from src.repositories.patient_repository import PatientRepository
    return NS(**locals())


def identity(connection, config):
    values = connection.exec_driver_sql('SELECT @@version, @@port, @@datadir, @@server_uuid, DATABASE()').one()
    version, port, datadir, uuid, database = values
    require(str(version).startswith('8.0.'), 'Se requiere MySQL 8.0 real.')
    require(port == config['port'] and uuid == config['server_uuid'] and uuid != HABITUAL_UUID,
            'Identidad remota no coincide; no escribir.')
    require(Path(datadir).resolve() == Path(config['datadir']).resolve(), 'Datadir remoto distinto.')
    require(database == config['database'], 'Esquema seleccionado distinto.')
    return dict(version=version, host='127.0.0.1', port=port, datadir=str(Path(datadir).resolve()),
                server_uuid=uuid, database=database)


def table_counts(connection, names):
    # Names originate exclusively from MySQL metadata, never payload SQL.
    require(all(re.fullmatch(r'[A-Za-z0-9_]+', name) for name in names), 'Nombre SQL no esperado.')
    return {name: connection.exec_driver_sql(f'SELECT COUNT(*) FROM `{name}`').scalar_one() for name in sorted(names)}


def inspect_schema(connection, target):
    from sqlalchemy import inspect
    inspector = inspect(connection)
    names = inspector.get_table_names()
    require(set(TABLES) <= set(names), 'Faltan tablas requeridas; no se aplican migraciones.')
    databases = set(connection.exec_driver_sql('SHOW DATABASES').scalars())
    require(databases <= {'mysql', 'information_schema', 'performance_schema', 'sys', connection.engine.url.database},
            'Otros esquemas visibles en esta instancia; revisar exclusividad.')
    # SHOW DATABASES may hide inaccessible schemas: this is supporting evidence, not proof alone.
    tables = {}
    for name in TABLES:
        columns = inspector.get_columns(name)
        by_name = {column['name']: column for column in columns}
        expected = target.db.metadata.tables[name]
        require(set(expected.columns.keys()) <= set(by_name), 'Columnas incompatibles en ' + name)
        extra_required = [column['name'] for column in columns if column['name'] not in expected.columns
                          and not column.get('nullable') and column.get('default') is None
                          and not column.get('autoincrement') and not column.get('computed')]
        require(not extra_required, 'Columnas adicionales obligatorias incompatibles en ' + name)
        require(inspector.get_pk_constraint(name)['constrained_columns'] == ['id'], 'PK incompatible en ' + name)
        require(by_name['id'].get('autoincrement') is True, 'ID dinámico autoincrement requerido en ' + name)
        for column in expected.columns:
            require(column.type._type_affinity is by_name[column.name]['type']._type_affinity,
                    'Familia de tipo incompatible en ' + name + '.' + column.name)
        fks = inspector.get_foreign_keys(name)
        actual_fk = {(tuple(f['constrained_columns']), f['referred_table'], tuple(f['referred_columns'])) for f in fks}
        for constraint in expected.foreign_key_constraints:
            expected_fk = (tuple(c.name for c in constraint.columns), constraint.referred_table.name,
                           tuple(element.column.name for element in constraint.elements))
            require(expected_fk in actual_fk, 'FK requerida ausente en ' + name)
        indexes = inspector.get_indexes(name)
        uniques = inspector.get_unique_constraints(name)
        tables[name] = {'columns': [{key: str(value) for key, value in c.items()} for c in columns],
                        'foreign_keys': fks, 'indexes': indexes, 'unique_constraints': uniques,
                        'checks': inspector.get_check_constraints(name)}
    for name, columns in [('informes', ['visita_id', 'tipo_informe_id']),
                          ('informes_versiones', ['informe_id', 'numero_version']),
                          ('diagnosticos_retinopatia', ['visita_id'])]:
        constraints = tables[name]['unique_constraints'] + [i for i in tables[name]['indexes'] if i.get('unique')]
        require(any(c['column_names'] == columns for c in constraints), 'Unicidad requerida ausente en ' + name)
    engines = connection.exec_driver_sql('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()').all()
    require(all(engine == 'InnoDB' for _, engine in engines), 'Todas las tablas deben soportar rollback InnoDB.')
    triggers = connection.exec_driver_sql('SHOW TRIGGERS').all()
    require(not triggers, 'Triggers presentes: revisar efectos antes de fixtures.')
    grants = list(connection.exec_driver_sql('SHOW GRANTS FOR CURRENT_USER').scalars())
    privilege_summary = []
    for grant in grants:
        match = re.match(r'GRANT (.+?) ON (.+?) TO ', grant)
        require(match is not None, 'Grant/rol no analizable; revisar cuenta restringida.')
        privileges = set(match.group(1).split(', '))
        require(privileges <= {'USAGE', 'SELECT', 'INSERT'}, 'Cuenta con privilegios excesivos.')
        scope = match.group(2)
        if privileges - {'USAGE'}:
            require(scope == f'`{connection.engine.url.database}`.*', 'Grant fuera del esquema exclusivo.')
        privilege_summary.append({'privileges': sorted(privileges), 'scope': scope})
    require(any({'SELECT', 'INSERT'} <= set(g['privileges']) for g in privilege_summary), 'Cuenta necesita SELECT e INSERT.')
    counts = table_counts(connection, names)
    require(all(value == 0 for value in counts.values()), 'Esquema no vacío; no leer registros ni insertar fixtures.')
    return {'tables': tables, 'counts_before': counts, 'privileges': privilege_summary,
            'engines': [list(row) for row in engines], 'trigger_count': 0,
            'scope': 'compatibilidad requerida para estas consultas; no equivalencia completa del esquema productivo'}


@contextmanager
def environment(config, password, *, writes=False):
    validate_config(config, writes=writes)  # BEFORE imports/engine/connect
    from flask import Flask
    from sqlalchemy import event
    from sqlalchemy.engine import URL
    target = load_targets()
    app = Flask('codn_cb03_isolated')
    app.config.update(TESTING=True, SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_DATABASE_URI=URL.create('mysql+pymysql', username=config['username'], password=password,
            host=config['host'], port=config['port'], database=config['database']),
        SQLALCHEMY_ENGINE_OPTIONS={'connect_args': {'connect_timeout': 3, 'read_timeout': 10, 'write_timeout': 10},
                                  'pool_pre_ping': False})
    target.db.init_app(app)
    target.configure_utc_sessions(app)
    with app.app_context():
        engine = target.db.engine
        gate = {'writes': False}
        def checkout(raw, _record, _proxy):
            with raw.cursor() as cursor:
                cursor.execute('SELECT @@port, @@datadir, @@server_uuid, DATABASE()')
                port, datadir, uuid, schema = cursor.fetchone()
            require(port == config['port'] and uuid == config['server_uuid'] and schema == config['database']
                    and Path(datadir).resolve() == Path(config['datadir']).resolve(), 'Checkout con identidad distinta.')
            ACTIVITY['verified_checkouts'] += 1
        def before_sql(_conn, _cursor, statement, _params, _context, _many):
            stripped = statement.lstrip()
            if re.match(r'(?is)^(SELECT|SHOW|DESCRIBE)\b', stripped):
                return
            if re.fullmatch(r"(?is)SET SESSION time_zone\s*=\s*'\+00:00'", stripped):
                return
            match = re.match(r'(?is)^INSERT INTO `?([a-z0-9_]+)`?\s*\(', stripped)
            require(gate['writes'] and match and match.group(1) in TABLES, 'SQL de escritura fuera de fase/alcance autorizado.')
            identity(_conn, config)  # Recheck pinned destination immediately BEFORE every INSERT.
            ACTIVITY['insert_attempts'] += 1
        event.listen(engine, 'checkout', checkout)
        event.listen(engine, 'before_cursor_execute', before_sql)
        session = target.db.session()
        def no_commit(_session):
            ACTIVITY['commit_attempts_blocked'] += 1
            raise SafetyGateError('Commit prohibido; fixtures solo en transacción revertida.')
        event.listen(session, 'before_commit', no_commit)
        try:
            with engine.connect() as connection:
                remote = identity(connection, config)
                schema = inspect_schema(connection, target)
            env = NS(target=target, engine=engine, session=session, identity=remote,
                     schema=schema, gate=gate, observations=[])
            if writes:
                # One transaction for all fixtures/tests. No commit or compensating DELETE.
                session.begin()
                identity(session.connection(), config)
                gate['writes'] = True
                try:
                    env.fixtures = create_fixtures(target, session)
                finally:
                    gate['writes'] = False
            yield env
        finally:
            gate['writes'] = False
            session.rollback()
            target.db.session.remove()
            engine.dispose()


def create_fixtures(t, session):
    """Only reached inside environment(writes=True) after all gates pass."""
    def add(cls, **values):
        record = cls(**values)
        session.add(record)
        session.flush()
        return record
    doc = add(t.TipoDocumento, nombre='Documento CB03 sintético', codigo='CB03', estado='ACTIVO')
    cargo = add(t.Cargo, nombre='Cargo CB03 sintético', estado='ACTIVO')
    user = add(t.Usuario, username='cb03_actor_sintetico', password_hash='!DISABLED-CB03-NO-LOGIN',
        nombres='Actor', apellidos='Sintético', correo='cb03.actor@example.invalid', tipo_doc_id=doc.id,
        cargo_id=cargo.id, nro_documento='CB03-USER', estado='ACTIVO')
    patients = {label: add(t.Paciente, tipo_doc_id=doc.id, nro_documento='CB03-' + label,
        nombres='Paciente', apellidos='Sintético ' + label, sexo='Femenino', fecha_nacimiento=date(2000, 1, 1),
        consentimiento_informado=True, estado='INACTIVO' if label == 'I' else 'ACTIVO') for label in ['A', 'B', 'I', 'E']}
    visits = {label: add(t.VisitaClinica, paciente_id=patients[patient].id, usuario_id=user.id,
        motivo_consulta='Fixture CB03 ' + label, estado='ANULADA' if label == 'VA' else 'ACTIVA')
        for label, patient in [('V1', 'A'), ('V2', 'A'), ('V0', 'A'), ('VB', 'B'), ('VA', 'A'), ('VI', 'I')]}
    types = {label: add(t.TipoInforme, nombre=name, codigo_formulario='cb03_' + label,
        schema_version_actual=1, estado='ACTIVO') for label, name in
        [('T1', 'Alfa CB03'), ('T2', 'Beta CB03'), ('T3', 'Gamma CB03'), ('T4', 'Omega CB03')]}
    # Independent symbolic matrix, NOT results copied from a repository query.
    specs = [('R1', 'V1', 'T2', 'ACTIVO'), ('R2', 'V1', 'T1', 'ACTIVO'),
             ('R3', 'V1', 'T3', 'INACTIVO'), ('R4', 'V1', 'T4', 'ANULADO'),
             ('R5', 'V2', 'T1', 'ACTIVO'), ('R6', 'VB', 'T1', 'ACTIVO'),
             ('R7', 'VA', 'T1', 'ACTIVO'), ('R8', 'VI', 'T1', 'ACTIVO')]
    reports = {}
    for label, visit, typ, state in specs:
        data = {'fixture': label, 'conclusion': ['Conclusión sintética ' + label]}
        reports[label] = add(t.Informe, visita_id=visits[visit].id, tipo_informe_id=types[typ].id,
            usuario_id=user.id, datos_estructurados=data, conclusion=None, estado=state,
            schema_version=1, revision_actual=2 if label == 'R1' else 1)
        for revision in range(1, reports[label].revision_actual + 1):
            add(t.InformeVersion, informe_id=reports[label].id, numero_version=revision,
                operacion='CREACION' if revision == 1 else 'CORRECCION', schema_version=1,
                datos_estructurados=data, conclusion=None, estado=state, autor_operacion_id=user.id,
                motivo=None if revision == 1 else 'Versión sintética CB03')
    grades = [add(t.GradoRetinopatia, codigo='CB03_G' + str(i), nombre='Grado sintético ' + str(i),
                  estado='ACTIVO', requiere_alerta=False) for i in range(2)]
    # VB first ensures V1 and its real diagnosis ID differ in a fresh schema.
    diagnoses = {label: add(t.Diagnostico, visita_id=visits[label].id, usuario_id=user.id,
        estado='PROCESADO', modelo_nombre='SIMULADO-CB03', modelo_version='fixture') for label in ['VB', 'V1']}
    require(diagnoses['V1'].id != visits['V1'].id, 'Fixture requiere diagnóstico/visita no coincidentes; revertir y revisar secuencias.')
    details = [add(t.DiagnosticoDetalle, diagnostico_retinopatia_id=diagnoses['V1'].id,
        ojo_evaluado=eye, imagen_original_url='cb03-synthetic-no-file-' + str(i) + '.jpg',
        probabilidad_ia=.5, resultado_ia_id=grades[i].id, estado_validacion='PENDIENTE')
        for i, eye in enumerate(['Derecho', 'Izquierdo'])]
    return NS(patients=patients, visits=visits, types=types, reports=reports, diagnoses=diagnoses,
              details=details, expected={'V1': ['R2', 'R1'], 'V2': ['R5'], 'V0': [], 'VB': ['R6'], 'VA': ['R7'], 'VI': ['R8']})
