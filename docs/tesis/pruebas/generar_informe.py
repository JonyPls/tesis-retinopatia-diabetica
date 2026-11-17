"""Build traceable Markdown/HTML from real result JSON/logs; never invent results."""
import ast
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RUN = json.loads((HERE / 'ejecucion_actual.json').read_text(encoding='utf-8-sig'))
EVIDENCE = Path(RUN['evidence'])
LIMA = dt.timezone(dt.timedelta(hours=-5), 'America/Lima')
INFO = {
    'CB-01': {
        'name': 'Autenticación y autorización estricta',
        'objective': 'Verificar credenciales, JWT, identidad vigente, grants por rol habilitante y bloqueo de operaciones protegidas.',
        'mocks': 'AuthRepository; entidades de roles/grants sintéticas. En una variante se invoca get_user_by_username real con query simulada para verificar estado=ACTIVO. Hash y JWT reales con clave ficticia, nunca impresa.',
        'conditions': 'Credenciales ausentes/incorrectas/válidas, cuenta inactiva filtrada, cada grant faltante, procedencia de roles, reglas vacías/comodines/any_of, alcance de pacientes, recurso denegado, JWT inválido/expirado, recarga de identidad y cortocircuito de handler/recurso.',
        'limits': 'No verifica SQL ni asignaciones reales de la base. Usuario inactivo se representa por la exclusión en el repositorio; el servicio delega allí esa condición. No cubre todas las modalidades condicionales del decorador ni helpers heredados.',
    },
    'CB-02': {
        'name': 'Validaciones internas del alta de pacientes',
        'objective': 'Verificar validaciones y normalización previas a escritura, límites reproducibles y ausencia de insert/commit al rechazar datos.',
        'mocks': 'PatientRepository, DocumentRepository, constructor Paciente y db.session; reloj datetime del servicio fijado al 03/11/2026. valid_email y funciones objetivo reales.',
        'conditions': 'Datos válidos, cada obligatorio ausente, acumulación de errores, formatos de nombre/documento/correo, edades 120/121, fechas imposibles/futuras, límites de nombres/dirección/antecedentes/alergias, opcionales, duplicados y normalización NFC/espacios/mayúsculas.',
        'limits': 'No prueba índices, concurrencia ni integridad física MySQL. No se inyectan errores de persistencia de pacientes; están fuera de este objetivo previo a escritura. Los límites de longitud de nombres se evalúan directamente en el validador.',
    },
    'CB-04': {
        'name': 'Validación y compensación del procesamiento fotográfico',
        'objective': 'Verificar validadores, cortocircuitos, interpretación de predicción simulada y limpieza segura ante fallos y commit incierto.',
        'mocks': 'CLIP (modelo/procesador/tensores), torch.no_grad, predecir_imagen_bytes (sustituye ResNet50/Grad-CAM), repositorios, confirmaciones del retinógrafo y db.session/engine. Pillow, NumPy, OpenCV, validadores, servicio y DiagnosisFiles reales. Fallos de preparación/publicación inyectados sobre almacenamiento real temporal.',
        'conditions': 'JPEG/PNG/TIFF válidos, 349/350 px, caps superiores configurados reducidos, bytes corruptos/GIF/MIME/nombre inválidos; región dominante/negra/pequeña; semántica aceptada/rechazada/503/500; preflight/límite de bytes; éxito simulado, preparación/inserción/publicación fallidas; consulta independiente simulada tras commit incierto; rollback fallido; colisión con archivo ajeno.',
        'limits': 'No ejecuta inferencia real ni acredita exactitud clínica. Las formas geométricas sintéticas son fixtures declaradas, no retinografías aptas para CN-05. Los límites superiores se ensayan con caps configurados menores para evitar grandes asignaciones. La consulta tras commit es simulada; no acredita estado del motor. No evalúa consumo de confirmaciones de retinógrafo ni descarte.',
    },
    'CB-05': {
        'name': 'Control transaccional de creación de informes',
        'objective': 'Verificar orden visita→informe→versión→commit, IDs, errores, rollback y ausencia de reintentos inseguros.',
        'mocks': 'InformeRepository (incluidas excepciones de frontera NotFound/Conflict), DiagnosisDiscardRepository y db.session. Servicio, validación estructural, clasificación de IntegrityError y gate con descarte apagado reales. DBAPIError/IntegrityError son clases reales de SQLAlchemy con causas sintéticas.',
        'conditions': 'Nueva visita/existente, paciente/tipo/visita inexistentes o ajenos, duplicado Conflict/1062 del índice conocido, fallo en cada escritura, integridad desconocida, DBAPI antes de commit, errores durante commit incluidos duplicados, rollback que falla y envelopes inválidos.',
        'limits': 'Comprueba llamadas/orden y tratamiento público, no atomicidad física. Asociación ajena se simula mediante NotFound del repositorio; validar_visita SQL real no se ejecuta. La ausencia de residuos y el acuse perdido real requieren integración MySQL aislada (CB-03/ampliación CB-05).',
    },
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def escape(value):
    return html.escape(str(value), quote=True)


def main():
    status = subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True).strip()
    (EVIDENCE / 'git-status-final.txt').write_text(status + '\n', encoding='utf-8')
    diff = subprocess.check_output(['git', 'diff', '--exit-code', RUN['head'], '--', 'backend/services',
        'backend/utils', 'backend/dl_model', 'backend/src', 'frontend'], cwd=ROOT, text=True)
    (EVIDENCE / 'verificacion-fuentes.txt').write_text('git diff --exit-code ' + RUN['head'] +
        ' -- backend/services backend/utils backend/dl_model backend/src frontend\nexit=0\n' + diff,
        encoding='utf-8')
    sections, summary, all_coverage = [], [], []
    total_methods = total_subcases = 0
    for code, info in INFO.items():
        folder = EVIDENCE / code
        data = json.loads((folder / 'resultado.json').read_text(encoding='utf-8'))
        log = (folder / 'ejecucion-04.log').read_text(encoding='utf-8')
        if str(data['exit_code']) != (folder / 'exit-04.txt').read_text(encoding='utf-8-sig').strip():
            raise ValueError('Exit code mismatch')
        test_path = ROOT / 'backend' / (data['suite'] + '.py')
        shutil.copy2(test_path, folder / test_path.name)
        source = test_path.read_text(encoding='utf-8')
        tree = ast.parse(source)
        events = data['events']
        matrix = ['# Matriz condición → entrada → aserción → resultado', '',
                  'Cada fila corresponde a un método. Las entradas/subcasos íntegros están en resultado.json y el log.',
                  'Las aserciones citadas son extractos del archivo ejecutado; incluyen assert de unittest y mocks.', '',
                  '| Condición / método | Entradas ejecutadas | Aserciones explícitas (extracto) | Resultado |',
                  '|---|---|---|---|']
        methods_html = []
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name.startswith('test_'):
                matches = [e for e in events if e['method'].endswith('.' + node.name)]
                obtained = 'FALLIDO' if any(e['status'] != 'APROBADO' for e in matches) else ('APROBADO' if matches else 'PENDIENTE')
                assertions = [ast.unparse(n) for n in ast.walk(node)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr.startswith('assert')]
                inputs = [e['subcase'].split(') (', 1)[-1] for e in matches if 'subcase' in e]
                entry = '; '.join(inputs) or 'Variante única; fixture/pasos explícitos en archivo de prueba.'
                row = [node.name, entry, '; '.join(assertions), obtained]
                matrix.append('| ' + ' | '.join(value.replace('|', '\\|').replace('\n', ' ') for value in row) + ' |')
                methods_html.append(f'<tr><td>{escape(node.name)}</td><td>{escape(obtained)}</td></tr>')
        (folder / 'matriz-condiciones.md').write_text('\n'.join(matrix) + '\n', encoding='utf-8')
        coverage_rows = []
        for item in data['coverage']:
            all_coverage.append((code, item))
            path = ROOT / 'backend' / item['file']
            if digest(path) != item['source_sha256']:
                raise ValueError('Functional source changed after execution: ' + item['file'])
            numbered = '\n'.join(f'{n:4}: {line}' for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1))
            (folder / (item['file'].replace('/', '__') + '.fuente.txt')).write_text(numbered + '\n', encoding='utf-8')
            coverage_rows.append(f"| `{item['file']}` | {item['executed']}/{item['executable']} | {item['percent']:.2f}% |")
        command = f'.\\venv\\Scripts\\python.exe -B -u codn_run_whitebox.py {data["suite"]} "{folder}"'
        (folder / 'comando.txt').write_text('Working directory: ' + str(ROOT / 'backend') + '\n' + command +
            '\nPowerShell: > "' + str(folder / 'ejecucion-04.log') + '" 2>&1\n$LASTEXITCODE=' + str(data['exit_code']) + '\n', encoding='utf-8')
        start = dt.datetime.fromisoformat(data['started_utc']).astimezone(LIMA)
        relative = 'evidencias/' + RUN['run_id'] + '/' + code
        pngs = sorted(folder.glob('*.png'))
        png_text = ', '.join(f'[{p.name}]({relative}/{p.name})' for p in pngs) if pngs else '**PENDIENTE** de captura auténtica del reporte; ver instrucciones manuales.'
        execution_body = f'''# {code} — {info['name']}

## Identificación

- Objetivo: {info['objective']}
- Tipo: caja blanca unitaria, funciones reales con dependencias aisladas.
- Componentes/funciones: ver tabla de cobertura, `.cover.txt` y fuentes numeradas; funciones exactas en `resultado.json`.

## Diseño

- Precondiciones: dependencias locales, proceso nuevo, guardas activas, ninguna base ni servicio compartido, fixtures sintéticas.
- Entradas y condiciones: {info['conditions']}
- Esperado: cada variante cumple su aserción; rechazos negativos correctos son éxitos. Ningún handler/insert/commit posterior al rechazo cuando corresponde.
- Sustituciones: {info['mocks']}

## Ejecución

- Archivo: [`{test_path.name}`](../../../{test_path.relative_to(ROOT).as_posix()}). Copia exacta bajo la carpeta del caso.
- Fecha local: {start.isoformat()}; UTC: {data['started_utc']} → {data['ended_utc']}.
- Duración del proceso instrumentado antes de inventariar versiones/cerrar artefactos: {data['duration_seconds']} s.
- Comando (desde `backend/`):

```powershell
{command}
```

- Métodos: **{data['methods']}**; subcasos `subTest`: **{data['subcases']}**; fallos: {data['failures']}; errores: {data['errors']}; omitidos: {data['skipped']}.
- Aserciones: no se instrumentó un conteo exacto. No se confunde métodos, subcasos ni llamadas `assert` estáticas con número de aserciones ejecutadas.
- Obtenido: **{data['status']}**; código de salida **{data['exit_code']}**; intentos prohibidos detectados por la guarda: **{len(data['guard_attempts'])}**.

## Evidencias

- [Log íntegro final]({relative}/ejecucion-04.log), [salida del proceso]({relative}/exit-04.txt), [resultado estructurado]({relative}/resultado.json), [comando exacto]({relative}/comando.txt).
- [Matriz condición/entrada/aserción/resultado]({relative}/matriz-condiciones.md).
- [Reporte HTML auténtico derivado de logs/trace]({relative}/reporte.html). Es un reporte, no una consola ni captura de CODN.
- PNG: {png_text}
- Fuentes numeradas `.fuente.txt` y contadores `.cover.txt` conservados en la misma carpeta; hashes en el manifiesto.

| Archivo funcional / alcance de funciones | Líneas ejecutadas/elegibles | Cobertura de líneas |
|---|---:|---:|
{chr(10).join(coverage_rows)}

## Análisis

- Interpretación: todas las variantes obligatorias previstas para este alcance se evaluaron con aserciones internas. Las rutas negativas generan mensajes ERROR/WARNING deliberados en el log; el veredicto depende de las aserciones y la salida final.
- Defectos funcionales detectados: ninguno en estos escenarios. No se modificó código funcional para conseguir el resultado.
- Límites: {info['limits']}
- Conclusión: **{data['status']}** dentro del alcance unitario descrito; ninguna conclusión adicional de integración, rendimiento o calidad clínica.
'''
        sections.append(execution_body)
        summary.append(f"| {code} | {data['methods']} | {data['subcases']} | {data['status']} | {data['exit_code']} |")
        total_methods += data['methods']
        total_subcases += data['subcases']
        # HTML is a direct rendering of actual result files, labelled as such.
        cov_html = ''.join(f"<tr><td>{escape(row['file'])}</td><td>{row['executed']}/{row['executable']}</td><td>{row['percent']:.2f}%</td></tr>" for row in data['coverage'])
        page = f'''<!doctype html><html lang="es"><meta charset="utf-8"><title>CODN {code} — evidencia real</title>
<style>body{{font:16px system-ui;margin:28px;max-width:1200px;color:#18202a}}h1{{font-size:25px}}h2{{font-size:19px;margin-top:20px}}table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;border-bottom:1px solid #ddd;padding:5px 10px;font-size:14px}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f6;padding:14px;font:12px Consolas,monospace}}.result{{font-size:20px;font-weight:700}}</style>
<h1>CODN · {code} · {escape(info['name'])}</h1><p>Reporte de ejecución real · RUN {escape(RUN['run_id'])}<br>{escape(start.isoformat())} · Python {escape(data['python'].split()[0])}</p>
<p class="result">{escape(data['status'])} · {data['methods']} métodos · {data['subcases']} subcasos · salida {data['exit_code']}</p>
<p>Fallos {data['failures']} · errores {data['errors']} · omitidos {data['skipped']} · intentos prohibidos {len(data['guard_attempts'])}</p>
<h2>Cobertura real de líneas (trace; funciones seleccionadas)</h2><table><tr><th>Fuente</th><th>Ejecutadas/elegibles</th><th>Líneas %</th></tr>{cov_html}</table>
<p>Sin medición de ramas. Mocks declarados en el informe. No prueba MySQL físico ni inferencia real.</p>
<h2>Métodos ejecutados</h2><table>{''.join(methods_html)}</table>
<h2>Log íntegro preservado</h2><p>Transcripción del archivo ejecucion-04.log; no es una consola simulada.</p><pre>{escape(log)}</pre>
<h2>Comando exacto desde backend</h2><pre>{escape(command)}</pre></html>'''
        (folder / 'reporte.html').write_text(page, encoding='utf-8')
    versions = json.loads((EVIDENCE / 'CB-01/resultado.json').read_text(encoding='utf-8'))['versions']
    header = f'''# CODN — Informe de pruebas de caja blanca

## Alcance y resultado

RUN-ID: **{RUN['run_id']}**. Ejecución nueva del **3 de noviembre de 2026 (America/Lima)**.
Cuatro casos unitarios, **{total_methods} métodos y {total_subcases} subcasos**. Los subcasos están dentro de los métodos: no se suman como pruebas independientes. CB-03 y las cinco CN permanecen **PENDIENTES**.

| Caso | Métodos | Subcasos | Estado | Salida |
|---|---:|---:|---|---:|
{chr(10).join(summary)}

## Reproducibilidad y aislamiento

- Git: `{RUN['head']}`. Árbol limpio antes de esta intervención; no persistían los dos cambios locales mencionados en la auditoría anterior. No se revierten cambios. [Estado final](evidencias/{RUN['run_id']}/git-status-final.txt).
- Auditoría copiada byte por byte; SHA-256 `{RUN['plan_sha256']}`. Se conserva su contexto histórico (modo Plan, herramientas disponibles entonces); no describe restricciones actuales.
- Python 3.12.10 local, unittest/mock/trace de biblioteca estándar. Versiones por metadatos: {', '.join(f'{k}={v}' for k,v in versions.items())}. No se instaló nada.
- Cada suite se ejecutó en un proceso separado, sin discovery, `app.py`, `database.init_db`, DDL, servicios ni MySQL.
- Imports de base/repositorios/modelos sustituídos antes de cargar fuentes objetivo. Lectura de `.env`/pesos, conexiones, resolución de red, procesos secundarios y escrituras fuera de raíces de evidencia/temporales rechazadas por el runner.
- Variables heredadas eliminadas; las pruebas auth usan solo una clave ficticia. El mkdir de importación de diagnosis_service se suprime y se comprueba una vez. UPLOAD_FOLDER se redirige después a TemporaryDirectory propio; DiagnosisFiles real trabaja solo allí.
- Consulta auxiliar `platform._syscmd_ver` simulada para que dependencias de JWT no lancen `ver`. No se altera autenticación productiva. Descargas deshabilitadas y librerías de IA sustituidas antes de importar.
- [Verificación de fuentes sin cambios](evidencias/{RUN['run_id']}/verificacion-fuentes.txt). Sin commits ni push.

## Incidencias de preparación conservadas

1. CB-01, `ejecucion-01.log`: Python de Microsoft Store no pudo iniciar bajo el acceso restringido; no ejecutó tests. Se resolvió con la ejecución autorizada del Python local.
2. CB-01, `ejecucion-02.log` y `ejecucion-03.log`: aserciones pasaron pero la guarda marcó FALLIDO por tres intentos de la biblioteca platform de abrir NUL para lanzar una consulta de versión. Se bloquearon; no hubo escritura clínica. La traza diagnóstica está en `resultado-previo-CB-01.json`.
3. Se corrigió exclusivamente la utilidad de pruebas para simular esa consulta de SO y preservar UTF-8 en los logs; ejecución final `ejecucion-04.log`, cero intentos prohibidos. Las demás suites se repitieron para usar la misma versión final del runner. Los resultados previos no se borraron.

## Criterio de cobertura

Medición real con `trace.Trace(count=True, trace=False)`. Denominador: líneas ejecutables según tablas de líneas de CPython (`trace._find_executable_linenos`) dentro de cuerpos de las funciones explícitas y sus cierres anidados. Incluye validación estructural y helpers seleccionados; excluye imports, definiciones, otras funciones del archivo, tests, mocks, dependencias, frontend y rutas no objetivo. Algunas líneas de docstring/multilínea son eventos elegibles de CPython; no se equiparan a sentencias lógicas.

Cada `.cover.txt` conserva conteos por línea y `>>>>>>` para faltantes. `resultado.json` incluye funciones, líneas ejecutadas/faltantes, denominador y SHA-256 de la fuente. **No es cobertura de todo el archivo/repositorio, de ramas, de condiciones independientes ni MC/DC.** No hay proveedor de ramas instalado. Las matrices detallan condiciones/aserciones ensayadas sin convertirlas en un porcentaje de ramas.

## Evidencia visual y trazabilidad

Los HTML se generan exclusivamente de logs y contadores reales, con rótulo de reporte derivado; no imitan una consola. Los PNG, cuando figuran por caso, son capturas originales del visor nativo mediante Windows.Graphics.Capture (habilidad computer-use), sin montaje ni edición. No son capturas de la aplicación clínica ni de una consola en vivo. El log íntegro y las fuentes acompañan cada captura y prevalecen para auditoría.

Si falta un PNG: abrir `evidencias/{RUN['run_id']}/CB-XX/reporte.html` en navegador local; maximizar, mostrar encabezado/cobertura/métodos; usar Recortes de Windows y guardar `CB-XX-reporte.png` dentro de su carpeta. Para consola en vivo: desde `backend`, ejecutar el comando de `comando.txt` en una carpeta de evidencia **nueva**, esperar el resumen/código de salida y capturar sin tokens ni otros archivos en pantalla. No sobrescribir esta corrida.

Cada carpeta contiene copia de la suite ejecutada; `soporte/` conserva runner, fixtures y generador exactos. `SHA256SUMS.txt` registra todos los archivos de la corrida salvo el propio manifiesto; PNG/HTML son evidencia auxiliar, logs/JSON/archivos ejecutados son respaldo primario.

'''
    footer = '''
## Continuación y limitaciones académicas

No se detectaron defectos funcionales en las variantes ejecutadas. Los errores inyectados esperados no son defectos observados del producto. La divergencia histórica entre filtros de informes no fue ensayada aquí y sigue pendiente de CB-03.

Para CB-03: provisionar y autorizar una instancia MySQL aislada sin datos reales; verificar host/puerto/datadir/UUID/versión y esquema/índices efectivos; revisar semillas sintéticas y cuenta restringida. Crear runner focalizado de repositorios reales para A/B, V1/V2/V0/visita anulada, estados de informe y multiplicación por ojos/versiones. Comparar conjuntos exactos y conteos con una tabla independiente. No usar SQLite como equivalencia ni ejecutar arneses masivos/DDL sobre la instancia habitual.

La ampliación física de CB-05 requiere sesiones MySQL independientes para comprobar residuos tras fallo y persistencia tras acuse perdido; una llamada a rollback simulada no la demuestra. CN-05 exige imagen sintética apta e inferencia real, sin presentar estos mocks como evidencia de clasificación clínica. Las cinco CN y CB-03 siguen pendientes, no aprobadas por estas suites.
'''
    (HERE / 'INFORME_PRUEBAS_CAJA_BLANCA.md').write_text(header + '\n'.join(sections) + footer, encoding='utf-8')
    support = EVIDENCE / 'soporte'
    support.mkdir(exist_ok=True)
    for source in [ROOT / 'backend/codn_test_support.py', ROOT / 'backend/codn_run_whitebox.py', Path(__file__)]:
        shutil.copy2(source, support / source.name)
    manifest = ['# CODN evidence SHA-256 — paths relative to this RUN-ID; manifest excludes itself']
    for path in sorted(EVIDENCE.rglob('*')):
        if path.is_file() and path.name != 'SHA256SUMS.txt':
            manifest.append(digest(path) + '  ' + path.relative_to(EVIDENCE).as_posix())
    (EVIDENCE / 'SHA256SUMS.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
    print(json.dumps({'run_id': RUN['run_id'], 'methods': total_methods, 'subcases': total_subcases,
        'report': str(HERE / 'INFORME_PRUEBAS_CAJA_BLANCA.md'), 'files_hashed': len(manifest)-1}, ensure_ascii=False))


if __name__ == '__main__':
    main()
