"""Append CB-03 preparation evidence while preserving the historical report bytes."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RUN = json.loads((HERE / 'ejecucion_cb03.json').read_text(encoding='utf-8-sig'))
EVIDENCE = Path(RUN['evidence'])
CASE = EVIDENCE / 'CB-03'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    data = json.loads((CASE / 'resultado.json').read_text(encoding='utf-8'))
    assert data['status'] == 'BLOQUEADO' and data['methods_executed'] == 0
    assert data['network_events'] == 0 and data['activity']['insert_attempts'] == 0
    specs = [
        ['R1', 'A', 'V1', 'T2/Beta', 'ACTIVO', 2], ['R2', 'A', 'V1', 'T1/Alfa', 'ACTIVO', 1],
        ['R3', 'A', 'V1', 'T3/Gamma', 'INACTIVO', 1], ['R4', 'A', 'V1', 'T4/Omega', 'ANULADO', 1],
        ['R5', 'A', 'V2', 'T1/Alfa', 'ACTIVO', 1], ['R6', 'B', 'VB', 'T1/Alfa', 'ACTIVO', 1],
        ['R7', 'A', 'VA', 'T1/Alfa', 'ACTIVO', 1], ['R8', 'I', 'VI', 'T1/Alfa', 'ACTIVO', 1],
    ]
    fixture = {'status': 'DISEÑO_NO_INSERTADO', 'numeric_ids': None,
        'patients': {'A': 'ACTIVO', 'B': 'ACTIVO', 'I': 'INACTIVO', 'E': 'ACTIVO_SIN_VISITAS'},
        'visits': {'V1': ['A', 'ACTIVA'], 'V2': ['A', 'ACTIVA'], 'V0': ['A', 'ACTIVA'],
                   'VB': ['B', 'ACTIVA'], 'VA': ['A', 'ANULADA'], 'VI': ['I', 'ACTIVA']},
        'reports_columns': ['report', 'patient', 'visit', 'type/name', 'state', 'versions'], 'reports': specs,
        'diagnoses': {'VB': 'padding (sin detalles)', 'V1': 'dos ojos; ID diferente de V1'},
        'details': ['Derecho de V1', 'Izquierdo de V1'],
        'expected_list_order': {'V1': ['R2', 'R1'], 'V2': ['R5'], 'V0': [], 'VB': ['R6'], 'VA': ['R7'], 'VI': ['R8']},
        'expected_history_A': {'V1': ['R2', 'R1'], 'V2': ['R5'], 'V0': []},
        'expected_counts_V1': {'active_reports': 2, 'eyes': 2, 'versions_R1': 2},
        'expected_individual': {'R1': 'visible', 'R3': None, 'R4': None, 'R7': None, 'R8': None},
        'note': 'Oráculo simbólico previo e independiente de salidas del repositorio. Caracterización explícita de filtros distintos, no aprobación de una política uniforme.'}
    (CASE / 'fixtures-esperados.json').write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding='utf-8')
    scenarios = [
        ('S01', 'V1 válida', 'Lista exacta R2/R1, orden Alfa/Beta, IDs de visita correctos.'),
        ('S02', 'V2 y VB como controles', 'Intersección vacía con V1; conjuntos propios exactos.'),
        ('S03', 'ACTIVO/INACTIVO/ANULADO', 'Incluir R1; excluir R3/R4; solo ACTIVO serializado.'),
        ('S04', 'V0 sin informes', '[], total=0, tiene_informes=0, diagnostico_ia=None.'),
        ('S05', 'validar_visita(VB,A)', 'NotFound real; control V1/A válido.'),
        ('S06', 'VA anulada y R7 activo', 'Listado incluye R7; detalle None; historial excluye VA; validar_visita lanza NotFound. Diferencia documentada.'),
        ('S07', 'Dos ojos y versiones R1', 'Conteo activo=2, ojos=2, versiones_R1=2; diagnóstico real distinto del ID visita.'),
        ('S08', 'A con V1/V2/V0 y B/VB', 'Agrupación exacta por visita; ninguna contaminación; fallback de conclusión JSON.'),
        ('S09', 'Detalle R1/R3/R4/R7/R8', 'Vigencia de informe/visita/paciente; metadatos de paciente y visita; contraste de VI en listado.'),
        ('S10', 'E sin visitas y recursos inexistentes', 'Retorno temprano con una consulta real (spy wraps); lista vacía/None/NotFound; fase DML cerrada.'),
    ]
    matrix = ['# CB-03 — Matriz previa de escenarios', '',
              'Ningún escenario de integración se ejecutó. Estados PENDIENTE; caso global BLOQUEADO por entorno/autorización.', '',
              '| Código | Condición / entrada | Aserción esperada | Método | Obtenido |', '|---|---|---|---|---|']
    for scenario, name, expected in scenarios:
        method = data['method_names'][int(scenario[1:])-1]
        matrix.append(f'| {scenario} | {name} | {expected} | `{method}` | PENDIENTE — no ejecutado |')
    matrix += ['', '## Fixtures sintéticas (sin IDs asignados)', '',
               '| Informe | Paciente | Visita | Tipo | Estado | Versiones |', '|---|---|---|---|---|---:|']
    matrix.extend('| ' + ' | '.join(map(str, row)) + ' |' for row in specs)
    matrix += ['', 'V0 no tiene informes. E no tiene visitas. VI pertenece al paciente inactivo I.',
               'Se usarán 1 tipo documental, 1 cargo, 1 usuario sin login, 4 pacientes, 6 visitas,',
               '4 tipos de informe, 8 informes, 9 versiones, 2 grados sintéticos, 2 diagnósticos y 2 detalles.',
               'Total previsto: 40 filas, todas nuevas y sintéticas, en 11 tablas InnoDB. Ningún archivo fotográfico.',
               'IDs obtenidos con flush/autoincrement; si V1 y su diagnóstico coinciden, abortar/revertir y revisar la fixture, nunca asumir alias universal.']
    (CASE / 'matriz-escenarios.md').write_text('\n'.join(matrix) + '\n', encoding='utf-8')
    instance = Path(RUN['proposed_instance_root'])
    config = dict(exclusive_test_instance=False, read_only_inspection_authorized=False,
        fixture_writes_authorized=False, approval_reference=None, host='127.0.0.1', port=RUN['proposed_port'],
        database='codn_cb03_20261103_a3c5f7f4', username='codn_cb03', server_uuid=None,
        instance_root=str(instance), datadir=str(instance / 'data'))
    (HERE / 'CB03_DESTINO_PROPUESTO.example.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    procedure = f'''# CB-03 — Procedimiento y solicitud de provisionamiento

**Estado actual: NO AUTORIZADO / NO EJECUTADO.** No existe destino SQL verificado de pruebas.
Esta propuesta no autoriza ejecutarse a sí misma. No se debe cambiar un booleano en el JSON para sustituir la autorización del usuario.

## Inventario real y límite de lo verificado

- Se detectaron procesos mysqld PID 19808/20248; solo se observaron listeners 3306/33060 del PID 20248.
- Sus ExecutablePath no fueron accesibles (null). No se deduce identidad de esas instancias ni se conecta a ellas.
- Binario local presente: `C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe`, versión del archivo 8.0.46.0; no acredita versión de un servidor arrancado.
- Puerto propuesto {RUN['proposed_port']}: sin listener al inventariar; debe comprobarse de nuevo antes del arranque.
- `Temp/opencode`: no se encontraron directorios candidatos mysql/b1/disposable; no se buscó contenido clínico.
- Evidencia: `evidencias/{RUN['run_id']}/inventario-entorno.json`. Cero conexiones SQL.

## Etapa 1: aprobación solicitada para inicializar y arrancar una instancia NUEVA

Destino propuesto, todavía no creado:

```text
host: 127.0.0.1
port: {RUN['proposed_port']}
root: {instance}
datadir: {instance / 'data'}
mysqld: C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe
```

Operaciones a autorizar: comprobar que root/datadir no existen; crear únicamente esa raíz; ejecutar `mysqld --no-defaults --initialize-insecure` para ese datadir nuevo; arrancar un proceso propio oculto con bind a 127.0.0.1, puerto {RUN['proposed_port']}, MySQL X apagado (`--mysqlx=OFF`), binlog apagado y logs bajo esa raíz. No servicios de Windows ni configuración habitual. Si el puerto está ocupado o el datadir existe, detenerse; no borrarlos ni reutilizarlos.

La inicialización escribe tablas internas del nuevo servidor; requiere autorización separada aunque no haya fixtures. No se ejecuta aquí.

Después del arranque, leer solo el `auto.cnf` propio y conectar únicamente al nuevo puerto para consultar `@@version`, `@@port`, `@@server_uuid`, `@@datadir`; cotejar UUID/ruta/puerto con el proceso propio y rechazar UUID habitual histórico. Registrar resultado sin contraseñas. El UUID todavía es **desconocido**, no se inventa ni se presenta como destino ya verificado.

## Etapa 2: esquema exclusivo, cuenta y nueva aprobación concreta

Presentar al usuario el UUID/datadir/puerto obtenidos antes de cualquier DDL del esquema de pruebas o INSERT de fixtures.
Esquema propuesto: `codn_cb03_20261103_a3c5f7f4` (vacío). Cuenta propuesta: `codn_cb03`, solo SELECT e INSERT en ese esquema; ninguna autorización global, sin CREATE/DROP/ALTER/UPDATE/DELETE/TRIGGER/EVENT/FILE. Custodiar contraseña fuera del repositorio y evidencias.

Se necesita DDL saneado y revisado para las tablas requeridas por los modelos/repositorios actuales. **No se adjunta ni inventa un esquema productivo, ni se da por compatible uno no inspeccionado.** La selección/extracción de DDL de una fuente local autorizada y la creación del esquema requieren aprobación expresa. No ejecutar SQL maestro ni semillas con DROP/INSERT; no `db.create_all`, migraciones, reconstrucción, SQLite ni datos copiados de la base habitual.

El arnés B1 existente NO se reutiliza como comando: administra SQL maestro, reconstrucciones, semillas históricas y limpieza. Solo se reutilizan sus ideas de fijar UUID/datadir/puerto, suppress load_dotenv, configurar UTC y usar repositorios reales.

Una vez provisionados esquema/cuenta, crear en la raíz propia un acta `codn-cb03-instance.json` con `purpose=CODN_CB03_DISPOSABLE`, UUID y puerto reales. Copiar el JSON de ejemplo fuera de evidencias, completar UUID real y activar únicamente los permisos de inspección expresamente concedidos. El ejemplo permanece inactivo y sin contraseña.

## Etapa 3: inspección de solo lectura

Desde `backend/`, en una carpeta de evidencia NUEVA:

```powershell
.\\venv\\Scripts\\python.exe -B -u codn_run_cb03_mysql.py inspect --config '<config-autorizada.json>' --output '<nueva-evidencia-inspeccion>'
```

El runner pide la contraseña sin registrarla; no lee `.env`. Verifica identidad fijada y auto.cnf, columnas/tipos lógicos/PK/autoincrement/FK/índices/uniquidad/checks, InnoDB, tablas vacías, ausencia de triggers visibles y privilegios limitados. Conserva metadatos, no filas clínicas. Las diferencias signed/unsigned y las restricciones extra deben revisarse con el DDL: la comprobación automática acredita compatibilidad mínima, no equivalencia con producción. SHOW DATABASES/SHOW TRIGGERS con cuenta restringida no prueban ausencia de objetos ocultos; complementar con el acta del administrador de la instancia nueva.

Si falla una condición, registrar BLOQUEADO sin modificar el esquema. Cuenta, esquema o UUID desconocidos no se sustituyen por defaults.

## Etapa 4: autorización de fixtures y ejecución

Mostrar destino verificado + resultado de inspección + matriz de 40 filas sintéticas. Obtener autorización expresa para los INSERT de esas 11 tablas. Solo entonces reflejarla en `fixture_writes_authorized` y `approval_reference`.

```powershell
.\\venv\\Scripts\\python.exe -B -u codn_run_cb03_mysql.py run --config '<config-autorizada.json>' --output '<nueva-evidencia-CB03>'
```

Se usa SQLAlchemy/MySQL real y una transacción única en InnoDB. Antes de cada INSERT se vuelve a comprobar identidad remota; tras fixtures se cierra la fase de escrituras. Los 10 métodos invocan repositorios reales. Único spy: execute con wraps para contar una consulta real de retorno temprano. Ningún mock sustituye las consultas objetivo.

Limpieza: rollback de la transacción propia; no DELETE, DROP ni TRUNCATE. Después se comparan conteos de todas las tablas desde una conexión independiente con el baseline vacío. Los contadores AUTO_INCREMENT pueden avanzar pese al rollback y no se afirma que los bytes del datadir queden iguales. Si el rollback/consulta final falla, registrar fallo y conservar instancia para conciliación; no repetir automáticamente ni borrar datos.

Mantener proceso/datadir para revisión; apagado del PID propio y eliminación recursiva del datadir no se automatizan ni quedan autorizados en esta propuesta. Requieren alcance acordado y verificación de ruta/PID. No tocar servicios o archivos habituales.

## Evidencias y criterio de salida

Log completo con comando/código de salida, identidad, metadatos, IDs dinámicos, esperado/obtenido, resultados de métodos/subcasos, conteos antes/después, trace de funciones objetivo y fuentes exactas. Cobertura solo de líneas; no ramas ni porcentaje automático de predicados SQL.
Para PNG: después de ejecución real, abrir el HTML en navegador y capturarlo con Recortes; identificarlo como reporte, nunca como consola o interfaz clínica. Actualmente PNG pendiente y ninguna cobertura de CB-03 medida.

Punto exacto de detención actual: **antes de crear/inicializar datadir o arrancar MySQL**, y por tanto antes de cualquier DDL del esquema, INSERT o conexión a un destino no autorizado.
'''
    (HERE / 'PROCEDIMIENTO_CB03_MYSQL_AISLADO.md').write_text(procedure, encoding='utf-8')
    relative = 'evidencias/' + RUN['run_id'] + '/CB-03'
    appendix = f'''

<!-- CODN-CB03-START -->
# CB-03 — Filtrado y asociación interna de informes (preparación posterior)

## Identificación

- RUN-ID nuevo: **{RUN['run_id']}**; Git `{RUN['head']}`.
- Estado actual: **BLOQUEADO** por falta de instancia MySQL exclusiva identificada y autorizada.
- Objetivo: verificar filtrado, vigencia, asociaciones, conteos, agrupación, vacíos y NotFound en repositorios SQL reales.
- Tipo previsto: integración de caja blanca SQLAlchemy/MySQL 8.0, sin mocks de repositorios.
- Funciones: `InformeRepository.obtener_informes_por_visita`, `validar_visita`, `obtener_informe_por_id`, `_to_dict`; `PatientRepository.obtener_diagnosticos_paciente` y `_extract_report_conclusion` (serialización/fallback necesarios para comprobar resultados).

## Diseño

- Precondiciones pendientes: UUID/host/puerto/datadir/esquema/cuenta de instancia exclusiva, DDL compatible saneado, autorización de INSERT, tablas vacías InnoDB y cuenta SELECT/INSERT.
- [Diez escenarios y aserciones previas]({relative}/matriz-escenarios.md); [oráculo simbólico independiente]({relative}/fixtures-esperados.json).
- A/B, V1/V2/V0/VB y VA anulada; I inactivo/VI y E sin visitas; 8 informes/9 versiones, 2 ojos y diagnóstico con ID distinto de visita. 40 filas sintéticas previstas; **ninguna insertada**.
- Esperados derivados de matriz previa, con diferencia de filtros explícita: lista por visita aplica ACTIVO de informe; detalle exige también visita no anulada y paciente activo; historial excluye visita anulada. Esto caracteriza contratos distintos; no aprueba una regla uniforme no acordada.
- Guardas: configuración explícita sin `.env`, identidad local/remota fijada, revalidación antes de cada INSERT, commits/DDL/UPDATE/DELETE prohibidos; rollback y comprobación independiente de conteos previstos.

## Ejecución

- Archivo implementado: [`test_codn_cb03_report_queries.py`](../../../backend/test_codn_cb03_report_queries.py), 10 métodos. [Runner](../../../backend/codn_run_cb03_mysql.py) y [utilidad de aislamiento](../../../backend/codn_cb03_mysql.py).
- **Métodos de integración ejecutados: 0; subcasos ejecutados: 0; fallos de aserción de integración: 0; resultado SQL: no obtenido.** No hay aprobación ni omisiones que sustituyan la ejecución.
- Preparación real UTC: {data['started_utc']} → {data['ended_utc']} (America/Lima UTC−05).
- Se ejecutaron **12 comprobaciones de infraestructura offline**: sintaxis de tres archivos, rechazo de configuraciones ausentes/no autorizadas/puerto habitual, compilación de SELECT MySQL para cinco entidades reales y descubrimiento de 10 métodos. No son pruebas CB-03 aprobadas.
- También se ejecutó el runner en modo run sin --config para demostrar rechazo previo a conexión: salida 3, 0 métodos/0 conexiones/0 INSERT. Log independiente.
- Comandos desde `backend/`:

```powershell
.\\venv\\Scripts\\python.exe -B -u codn_run_cb03_mysql.py prepare --output "{CASE}"
.\\venv\\Scripts\\python.exe -B -u codn_run_cb03_mysql.py run --output "{CASE / 'guarda-sin-config'}"
```

- Código de salida de ambos: **3**, diseñado para estado bloqueado; proceso de preparación correcto, integración no ejecutada. No es código 0 de aprobación de CB-03.
- Versiones por metadatos: Python 3.12.10; Flask 3.1.3; Flask-SQLAlchemy 3.1.1; SQLAlchemy 2.0.30; PyMySQL 1.1.2. Sin instalaciones nuevas.
- Inventario nativo: listeners observados solo 3306/33060, sin prueba de aislamiento. No se consultó su DB, UUID, datadir, permisos, esquema o registros. La versión del archivo mysqld es 8.0.46.0, distinta de verificar versión de servidor en ejecución.

## Evidencias

- [Preparación íntegra]({relative}/preparacion-02.log), [salida]({relative}/exit-preparacion-02.txt), [JSON real]({relative}/resultado.json), [rechazo sin configuración]({relative}/guarda-sin-config/rechazo.log).
- [Inventario de procesos/puertos](evidencias/{RUN['run_id']}/inventario-entorno.json), [HTML del estado real]({relative}/reporte.html), fuentes numeradas y copias de suite/utilidades en la carpeta del caso.
- [Procedimiento de provisionamiento y autorización](PROCEDIMIENTO_CB03_MYSQL_AISLADO.md), [destino propuesto inactivo](CB03_DESTINO_PROPUESTO.example.json).
- [Hashes de esta corrida](evidencias/{RUN['run_id']}/SHA256SUMS.txt). El informe anterior se conserva byte por byte en `INFORME_ANTES_CB03.md`; su SHA-256 es `{RUN['report_before_sha256']}`.
- PNG: **PENDIENTE**. Capturar el reporte después de ejecución real; ninguna imagen fabricada. Las restricciones del control de navegador de la intervención anterior no se eludieron.
- Cobertura: **no obtenida**. El runner contiene instrumentación trace para una ejecución futura; compilar/discover no ejecuta las consultas ni genera porcentaje válido de CB-03.

## Análisis

- Hallazgo estático confirmado por lectura: el listado por visita no filtra visita anulada/paciente inactivo, mientras el detalle sí lo hace; el historial tiene sus propios filtros. No es un hallazgo experimental nuevo ni un fallo declarado contra una política uniforme aprobada. S06/S09 lo comprobarán realmente cuando exista entorno.
- No se acreditó compatibilidad del esquema instalado, atomicidad, ausencia de datos reales en una instancia ni resultados de consultas. No se leyó `.env`, SQL maestro, dumps ni contenido clínico.
- Las condiciones de la petición obligan a detenerse antes de escribir fixtures sin destino aislado autorizado. La propuesta concreta inicializa y arranca solo un datadir nuevo; UUID y operaciones de esquema/fixtures deben presentarse y aprobarse después.
- **Conclusión: BLOQUEADO; diez escenarios implementados pero ninguno ejecutado contra MySQL.** Se conservan sin cambios los resultados históricos CB-01/02/04/05 (41 métodos/175 subcasos). Las cinco CN continúan pendientes.
<!-- CODN-CB03-END -->
'''
    report = HERE / 'INFORME_PRUEBAS_CAJA_BLANCA.md'
    old = (EVIDENCE / 'INFORME_ANTES_CB03.md').read_bytes()
    assert sha(EVIDENCE / 'INFORME_ANTES_CB03.md').upper() == RUN['report_before_sha256']
    current = report.read_bytes()
    if b'<!-- CODN-CB03-START -->' not in current:
        assert current == old, 'Informe cambió desde el snapshot; no sobrescribir.'
        report.write_bytes(old + appendix.encode('utf-8'))
    else:
        assert current.startswith(old), 'Historia alterada.'
        report.write_bytes(old + appendix.encode('utf-8'))
    assert report.read_bytes().startswith(old)
    diff = subprocess.run(['git', 'diff', '--exit-code', RUN['head'], '--', 'backend/src', 'backend/services',
                           'backend/utils', 'backend/dl_model', 'frontend'], cwd=ROOT, capture_output=True, text=True)
    assert diff.returncode == 0, 'Fuentes funcionales modificadas; revisar antes de documentar.'
    (EVIDENCE / 'verificacion-fuentes.txt').write_text('git diff --exit-code ' + RUN['head'] +
        ' -- backend/src backend/services backend/utils backend/dl_model frontend\nexit=0\n', encoding='utf-8')
    verified = 0
    historical = HERE / 'evidencias' / '20261103T160850Z-421d66ca'
    for line in (historical / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        expected, filename = line.split('  ', 1)
        assert sha(historical / filename) == expected, 'Evidencia histórica cambió: ' + filename
        verified += 1
    (EVIDENCE / 'preservacion-historica.json').write_text(json.dumps({
        'historical_evidence_files_verified': verified, 'historical_report_bytes_preserved': len(old),
        'historical_report_sha256': sha(EVIDENCE / 'INFORME_ANTES_CB03.md'),
        'main_report_current_sha256': sha(report)}, indent=2), encoding='utf-8')
    for source in [Path(__file__), HERE / 'PROCEDIMIENTO_CB03_MYSQL_AISLADO.md', HERE / 'CB03_DESTINO_PROPUESTO.example.json']:
        (EVIDENCE / source.name).write_bytes(source.read_bytes())
    status = subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True)
    (EVIDENCE / 'git-status-final.txt').write_text(status, encoding='utf-8')
    manifest = [sha(path) + '  ' + path.relative_to(EVIDENCE).as_posix() for path in sorted(EVIDENCE.rglob('*'))
                if path.is_file() and path != EVIDENCE / 'SHA256SUMS.txt']
    (EVIDENCE / 'SHA256SUMS.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
    print(json.dumps({'status': data['status'], 'methods_implemented': 10, 'methods_executed': 0,
        'offline_checks': len(data['preparation_checks']), 'historical_hashes_verified': verified,
        'evidence_files_hashed': len(manifest), 'report': str(report)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
