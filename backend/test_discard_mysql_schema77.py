"""Solo copia temporal/imports/compilación de DDL. Conectores y procesos del hijo prohibidos."""
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest import TestCase, main

from discard_mysql77.safety import APPROVED_TEMP, copy_sources, source_digest


class OfflineSchema77Tests(TestCase):
    def test_factory_and_mysql_DDL_compile_without_connections(self):
        source = Path(__file__).resolve().parent
        with TemporaryDirectory(prefix='codn77-schema-offline-', dir=APPROVED_TEMP) as temporary:
            root = Path(temporary)
            sandbox = copy_sources(source, root, source_digest(source))
            for name in ('private', 'exports', 'tmp'):
                (root / name).mkdir()
            # Proceso independiente: no contaminar módulos de suites ajenas con stubs.
            script = r'''
import sys, os
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch
sys.path.insert(0, str(Path.cwd()))
with ExitStack() as stack:
    stack.enter_context(patch('socket.socket.connect', side_effect=AssertionError('NO_NETWORK')))
    stack.enter_context(patch('subprocess.Popen', side_effect=AssertionError('NO_PROCESSES')))
    stack.enter_context(patch('pymysql.connect', side_effect=AssertionError('NO_SQL')))
    stack.enter_context(patch('pymysql.Connect', side_effect=AssertionError('NO_SQL')))
    stack.enter_context(patch('sqlalchemy.engine.Engine.connect', side_effect=AssertionError('NO_SQL')))
    stack.enter_context(patch('dotenv.load_dotenv', side_effect=AssertionError('NO_DOTENV')))
    from discard_mysql77.application import load_application, synthetic_metadata, GRANTS
    from sqlalchemy.schema import CreateTable
    from sqlalchemy import CheckConstraint
    from sqlalchemy.dialects import mysql
    from discard_mysql77.schema import check_expression
    from utils import utc_clock
    root = Path.cwd().parent
    payload = {'root': str(root), 'port': 59999, 'schema': 'codn77_offline_never_connect',
               'app_password': 'synthetic-no-connection', 'jwt_key': 'synthetic-no-connection'}
    h = load_application(payload, stack)
    metadata = synthetic_metadata(h)
    ddl = {name: str(CreateTable(table).compile(dialect=mysql.dialect()))
           for name, table in metadata.tables.items()}
    assert len(ddl) == 16, sorted(ddl)
    assert all('ENGINE=InnoDB' in statement for statement in ddl.values())
    assert h.gate.phase is None
    # Todos los CHECK reales deben ser reconocibles sin relajar su semántica.
    for table in h.db.metadata.tables.values():
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint):
                check_expression(str(constraint.sqltext))
    # Todas las FK deben coincidir en tipo/signo, sin tocar los metadatos originales.
    for table in metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                assert column.type.compile(dialect=mysql.dialect()) == fk.column.type.compile(dialect=mysql.dialect())
    assert 'id INTEGER UNSIGNED' in ddl['usuarios']
    assert 'id BIGINT UNSIGNED' in ddl['visitas_clinicas']
    assert 'UNIQUE (visita_id)' in ddl['diagnosticos_retinopatia']
    assert 'UNIQUE (diagnostico_retinopatia_id, ojo_evaluado)' not in ddl['diagnosticos_retinopatia_detalle']
    assert 'ON DELETE RESTRICT' in ddl['confirmaciones_exportacion_retinografo']
    for name in ('diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones'):
        assert name not in metadata.tables
        compiled = str(CreateTable(h.db.metadata.tables[name]).compile(dialect=mysql.dialect()))
        assert 'ENGINE=InnoDB' in compiled
        if name.endswith('operaciones'):
            assert 'CHARACTER SET ascii COLLATE ascii_bin' in compiled
            assert "DEFAULT 'PENDIENTE'" in compiled
        else:
            assert 'revision BIGINT UNSIGNED NOT NULL DEFAULT 0' in compiled
    from utils.strict_authorization import OPERATION_RULES
    expected = {'pacientes.ver', 'visitas.ver', 'diagnostico_retinopatia.ver', 'imagenes.ver',
                'diagnostico_retinopatia.descartar_pendiente'}
    assert OPERATION_RULES['diagnosis.discard_pending'].all_of == expected
    assert expected <= set(GRANTS)
    paths = {rule.rule for rule in h.app.url_map.iter_rules()}
    assert '/api/informes' in paths and '/api/diagnosticar' in paths
    assert 'diagnosis_discard' in h.app.cli.commands
    assert not h.app.config['DIAGNOSIS_DISCARD_ENABLED']
    assert not ({'app', 'torch', 'clip', 'tensorflow'} & set(sys.modules))
    # No hubo filas, migraciones, predictor ni limpieza; únicamente DDL como texto.
print('OFFLINE_FACTORY_SCHEMA_OK')
'''
            result = subprocess.run([sys.executable, '-I', '-B', '-c', script], cwd=sandbox,
                                    text=True, capture_output=True, timeout=60)
            # Solo código de prueba sintético; no existen credenciales ni SQL ejecutado.
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'OFFLINE_FACTORY_SCHEMA_OK')


if __name__ == '__main__':
    main()
