"""Fase A: únicamente biblioteca estándar, lecturas locales y ningún SQL."""
import ast
from dataclasses import dataclass
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from uuid import UUID


APPROVED_TEMP = Path(r'C:\Users\ricar\AppData\Local\Temp\opencode')
MANIFEST_VERSION = 2
HARNESS_VERSION = 'codn-discard-mysql77-78d-pid-evidence-v2'
SCOPES = ('start_owned_mysql', 'create_synthetic_schema', 'synthetic_sql_writes',
          'synthetic_files', 'stop_owned_process', 'retire_owned_resources')
STUBS = {'dl_model.validator', 'dl_model.inference', 'services.report_service'}
APP_FILES = tuple('''database.py
routes/diagnosis_discard_routes.py
routes/diagnosis_routes.py
routes/files_routes.py
routes/informe_routes.py
services/diagnosis_discard_service.py
services/diagnosis_service.py
services/informe_service.py
services/retinograph_confirmation_service.py
services/retinograph_import_service.py
src/models/auth_entities.py
src/models/diagnosis_discard_entities.py
src/models/diagnosis_entities.py
src/models/informe_entities.py
src/models/patient_entities.py
src/repositories/auth_repository.py
src/repositories/diagnosis_discard_repository.py
src/repositories/diagnosis_repository.py
src/repositories/informe_repository.py
src/repositories/patient_repository.py
utils/clinical_dates.py
utils/diagnosis_discard_gate.py
utils/diagnosis_discard_storage.py
utils/diagnosis_storage.py
utils/retinograph_private_storage.py
utils/retinograph_storage.py
utils/security.py
utils/strict_authorization.py
utils/temporal_provenance.py
utils/utc_clock.py'''.splitlines())
HARNESS_FILES = tuple(f'discard_mysql77/{name}.py' for name in
                      ('__init__', 'safety', 'runtime', 'application', 'cases', 'worker', 'schema', 'resources', 'process_identity'))
COPY_FILES = (*APP_FILES, *HARNESS_FILES, 'b1_mysql_disposable_trial.py',
              'migrations/72_descarte_ia_propuesta.sql', 'discard_mysql_trial77.py')
DEPENDENCIES = ('flask', 'flask_sqlalchemy', 'sqlalchemy', 'pymysql', 'dotenv', 'jwt', 'PIL', 'numpy')


class SafetyError(RuntimeError):
    """Mensajes cerrados, sin volcar configuraciones o excepciones de terceros."""


def require(condition, code):
    if not condition:
        raise SafetyError(code)


def no_links(path):
    """lstat antes de resolve: rechazar también junctions y ancestros reparse."""
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'RUTA_NO_ABSOLUTA_O_TRAVERSAL')
    for item in (*reversed(path.parents), path):
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        require(not stat.S_ISLNK(info.st_mode) and
                not (getattr(info, 'st_file_attributes', 0) & 0x400), 'ENLACE_O_REPARSE')
    return path.resolve()


def inside(path, perimeter, *, allow_root=False):
    root = no_links(perimeter)
    value = no_links(path)
    require(value.is_relative_to(root) and (allow_root or value != root), 'FUERA_DEL_PERIMETRO')
    return value


def source_file(source, relative):
    require(relative in COPY_FILES, 'FUENTE_NO_PERMITIDA')
    path = inside(Path(source) / relative, source)
    require(path.is_file() and path.stat().st_nlink == 1, 'FUENTE_NO_REGULAR_O_COMPARTIDA')
    return path


def source_digest(source):
    digest = hashlib.sha256()
    for relative in sorted(COPY_FILES):
        digest.update(relative.encode('ascii') + b'\0')
        digest.update(source_file(source, relative).read_bytes())
    return digest.hexdigest()


def check_imports(source):
    """Una dependencia local nueva obliga a revisar la selección, no se copia sola."""
    for relative in APP_FILES:
        tree = ast.parse(source_file(source, relative).read_text(encoding='utf-8-sig'))
        for node in ast.walk(tree):
            names = ([alias.name for alias in node.names] if isinstance(node, ast.Import) else
                     [node.module, *(node.module + '.' + alias.name for alias in node.names)]
                     if isinstance(node, ast.ImportFrom) and node.module else [])
            for name in names:
                require(name != 'app' and not name.startswith('app.'), 'IMPORT_APP_PROHIBIDO')
                if any(name == stub or name.startswith(stub + '.') for stub in STUBS):
                    continue
                candidate = name.replace('.', '/') + '.py'
                if (Path(source) / candidate).is_file():
                    require(candidate in APP_FILES, 'DEPENDENCIA_LOCAL_NO_REVISADA')
                require(not name.startswith(('torch', 'clip', 'tensorflow', 'dl_model.')),
                        'MODELO_PESADO_NO_SUSTITUIDO')
    # Los paquetes existentes no se copian: solo se admiten inicializadores vacíos.
    for relative in APP_FILES:
        for parent in Path(relative).parents:
            init = Path(source) / parent / '__init__.py'
            if init.is_file():
                no_links(init.absolute())
                tree = ast.parse(init.read_text(encoding='utf-8-sig'))
                require(all(isinstance(n, ast.Pass) or
                            isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                            and isinstance(n.value.value, str) for n in tree.body),
                        'INICIALIZADOR_NO_VACIO')


def proposal_statements(source):
    sql = source_file(source, 'migrations/72_descarte_ia_propuesta.sql').read_text(encoding='utf-8')
    sql = re.sub(r'--[^\n]*', '', sql)
    statements = [s.strip() for s in sql.split(';') if s.strip()]
    names = ('diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones')
    require(len(statements) == 2, 'PROPUESTA_NO_ACOTADA')
    for statement, name in zip(statements, names):
        require(statement.startswith('CREATE TABLE ' + name + ' (') and
                statement.endswith('ENGINE=InnoDB') and
                not re.search(r'\b(DROP|INSERT|UPDATE|DELETE|GRANT|USE|DATABASE|TRIGGER|IF)\b',
                              statement.replace('ON DELETE RESTRICT', ''), re.I),
                'PROPUESTA_NO_PERMITIDA')
    require('CHARACTER SET ascii COLLATE ascii_bin' in statements[1], 'UUID_COLLATION')
    require('autor_id INT UNSIGNED' in statements[1], 'TIPO_AUTOR')
    return statements


@dataclass(frozen=True)
class Plan:
    run_id: str
    mysql_server: Path
    mysql_sha256: str
    sources_sha256: str
    authorization: str
    scopes: tuple
    authorization_status: str = 'NOT_AUTHORIZED'
    prepared_at_utc: str | None = None
    manifest_version: int = MANIFEST_VERSION
    harness_version: str = HARNESS_VERSION
    declared_resources: tuple = ()

    @property
    def root(self):
        return APPROVED_TEMP / ('codn77-' + self.run_id)

    @property
    def schema(self):
        return 'codn77_' + self.run_id.replace('-', '')


def planned_resources(plan):
    """Descripción exacta del runtime; NO son overrides de rutas, cuentas o puertos."""
    root = plan.root
    system = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
    return {
        'root': str(root), 'datadir': str(root / 'data'),
        'bootstrap_directory': str(root), 'bootstrap_file': str(root / 'bootstrap.sql'),
        'backend_copy': str(root / 'backend'),
        'retinal_and_gradcam_files': str(root / 'backend/uploads/retinas'),
        'temporary_files': str(root / 'tmp'), 'retinograph_exports': str(root / 'exports'),
        'private_retinograph_copies': str(root / 'private'), 'evidence': str(root / 'evidence'),
        'owner_marker': str(root / 'owner.json'), 'pid_file': str(root / 'mysql.pid'),
        'schema': plan.schema, 'application_account': 'codn77_app@127.0.0.1',
        'application_grants': 'SELECT,INSERT,UPDATE,DELETE on own schema only',
        'administrator_account': 'root@localhost in NEW disposable instance only',
        'mysql_initializer_and_server': str(plan.mysql_server),
        'python_worker_and_restart': str(Path(sys.executable).absolute()),
        'windows_identity_helper': str(system / 'whoami.exe'),
        'windows_acl_helper': str(system / 'icacls.exe'),
        'listener_address': '127.0.0.1',
        'port_policy': 'ephemeral_loopback_after_authorization_never_3306_no_existing_server',
        'process_policy': 'Popen handles created by this run; own Windows Job and descendants; no HTTP server',
        'credentials_policy': 'ephemeral generated ONLY during authorized execution; no habitual credentials',
        'retirement_operation': 'retire_owned_resources',
        'retirement_policy': 'stop own Job and handles; verify empty and FS identity; remove private tree; INCOMPLETE if unsafe',
        'removable_entries': 'data,backend,tmp,exports,private,bootstrap.sql,init.log,mysql.log,mysql.pid,owner.json,raw evidence',
        'retained_entries': 'evidence/ sanitized results,failure,startup,DDL fingerprints,retirement only',
    }


def validate_metadata(plan):
    require(type(plan.manifest_version) is int and plan.manifest_version == MANIFEST_VERSION and
            plan.harness_version == HARNESS_VERSION, 'VERSION_MANIFIESTO_NO_COMPATIBLE')
    try:
        date = datetime.strptime(plan.prepared_at_utc, '%Y-%m-%dT%H:%M:%SZ')
        require(date.strftime('%Y-%m-%dT%H:%M:%SZ') == plan.prepared_at_utc, 'FECHA_MANIFIESTO_NO_CANONICA')
    except (TypeError, ValueError):
        raise SafetyError('FECHA_MANIFIESTO_NO_VALIDA') from None
    require(plan.authorization_status in ('NOT_AUTHORIZED', 'AUTHORIZED') and
            type(plan.authorization) is str and
            (plan.authorization == '' if plan.authorization_status == 'NOT_AUTHORIZED' else bool(plan.authorization)),
            'ESTADO_AUTORIZACION_INCONSISTENTE')
    require(plan.scopes == SCOPES, 'ALCANCE_MANIFIESTO_INCONSISTENTE')
    require(dict(plan.declared_resources) == planned_resources(plan), 'RECURSOS_MANIFIESTO_INCONSISTENTES')


def load_plan(path):
    try:
        file = no_links(Path(path).absolute())
        require(file.suffix.lower() == '.json' and file.is_file() and file.stat().st_nlink == 1 and
                file.stat().st_size <= 262144, 'ARCHIVO_MANIFIESTO_NO_VALIDO')
        def unique_keys(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, 'CLAVE_MANIFIESTO_DUPLICADA')
                result[key] = value
            return result
        data = json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique_keys)
        require(set(data) == {'run_id', 'mysql_server', 'mysql_sha256', 'sources_sha256',
                              'authorization', 'scopes', 'authorization_status', 'prepared_at_utc',
                              'manifest_version', 'harness_version', 'resources'}, 'CONFIG_INCOMPLETA_O_EXTRA')
        require(str(UUID(data['run_id'])) == data['run_id'], 'RUN_ID_NO_CANONICO')
        require(all(re.fullmatch('[0-9a-f]{64}', data[key]) for key in
                    ('mysql_sha256', 'sources_sha256')), 'HASH_INVALIDO')
        require(type(data['resources']) is dict and
                all(type(key) is str and type(value) is str for key, value in data['resources'].items()),
                'RECURSOS_MANIFIESTO_NO_VALIDOS')
        plan = Plan(data['run_id'], Path(data['mysql_server']), data['mysql_sha256'],
                    data['sources_sha256'], data['authorization'], tuple(data['scopes']),
                    data['authorization_status'], data['prepared_at_utc'], data['manifest_version'],
                    data['harness_version'], tuple(sorted(data['resources'].items())))
        validate_metadata(plan)
        return plan
    except (OSError, ValueError, TypeError, KeyError):
        raise SafetyError('CONFIG_NO_VALIDA') from None


def preflight(source, plan=None):
    source = no_links(Path(source).absolute())
    check_imports(source)
    proposal_statements(source)
    digest = source_digest(source)
    dependencies = {name: importlib.util.find_spec(name) is not None for name in DEPENDENCIES}
    result = {'phase': 'A_NO_CONNECTION', 'sources_sha256': digest,
              'selected_files': len(COPY_FILES), 'dependencies': dependencies,
              'phase_b_configuration': 'MISSING' if plan is None else 'INSPECTED_NOT_AUTHORIZED',
              'mysql_execution': 'NOT_AUTHORIZED_BY_PREFLIGHT',
              'pending': ['MySQL DDL/checks/indexes', 'InnoDB races', 'filesystem restart',
                          'Windows Job and private ACL native review', 'browser recovery']}
    if plan is not None:
        try:
            require(str(UUID(plan.run_id)) == plan.run_id, 'RUN_ID_NO_CANONICO')
        except (ValueError, TypeError, AttributeError):
            raise SafetyError('RUN_ID_NO_CANONICO') from None
        if plan.prepared_at_utc is not None or plan.declared_resources:
            validate_metadata(plan)
        require(plan.sources_sha256 == digest, 'FUENTES_CAMBIARON')
        root = inside(plan.root, APPROVED_TEMP)
        require(not root.exists(), 'NO_REUTILIZAR_ENSAYO')
        server = no_links(plan.mysql_server)
        require(server.is_file() and server.name.lower() == 'mysqld.exe', 'BINARIO_NO_EXPLICITO')
        require(hashlib.sha256(server.read_bytes()).hexdigest() == plan.mysql_sha256,
                'BINARIO_CAMBIO')
        require(not root.is_relative_to(source) and not source.is_relative_to(root),
                'RAIZ_HABITUAL')
        result.update(run_id=plan.run_id, schema=plan.schema, destination='OWN_NEW_PROCESS_ONLY',
                      authorization_status=plan.authorization_status, harness_version=plan.harness_version,
                      prepared_at_utc=plan.prepared_at_utc)
    return result


def authorize(source, plan, confirmation):
    require(plan is not None and confirmation == plan.run_id, 'AUTORIZACION_EXPLICITA_REQUERIDA')
    require(plan.authorization_status == 'AUTHORIZED', 'MANIFIESTO_NO_AUTORIZADO')
    validate_metadata(plan)
    require(plan.authorization == 'PROMPT78_DISPOSABLE_ONLY:' + plan.run_id and
            plan.scopes == SCOPES, 'ALCANCE_NO_AUTORIZADO')
    require(os.name == 'nt', 'FASE_B_SOLO_WINDOWS_REVISADO')
    result = preflight(source, plan)
    require(all(result['dependencies'].values()), 'DEPENDENCIAS_INCOMPLETAS')
    return result


def clean_environment(root):
    """No heredar DB_*, MYSQL_*, PYTHONPATH, JWT ni configuración del retinógrafo."""
    environment = {k: os.environ[k] for k in ('SystemRoot', 'WINDIR', 'COMSPEC') if k in os.environ}
    environment.update(TEMP=str(root / 'tmp'), TMP=str(root / 'tmp'),
                       RETINOGRAPH_EXPORT_DIR=str(root / 'exports'),
                       PYTHONDONTWRITEBYTECODE='1')
    return environment


def copy_sources(source, root, expected_digest):
    """Solo B, raíz nueva creada por el llamador; no se copia ningún árbol completo."""
    require(source_digest(source) == expected_digest, 'FUENTES_CAMBIARON')
    target = inside(root / 'backend', root)
    target.mkdir(exist_ok=False)
    for relative in COPY_FILES:
        destination = inside(target / relative, root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as stream:
            stream.write(source_file(source, relative).read_bytes())
    require(source_digest(target) == expected_digest, 'COPIA_NO_IDENTICA')
    return target
