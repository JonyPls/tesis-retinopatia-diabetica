# 78D — Diagnóstico estático de PID_NO_COINCIDE

## A. Origen y reconstrucción

No se repitió 78C. Su único error conservado es `PID_NO_COINCIDE`; la retirada
histórica fue `COMPLETED`. No existen PID esperado/leído ni hito del fallo que
permitan reconstruir concluyentemente aquel intento. Este documento no cambia
el informe 78C ni acredita consultas/casos nativos ausentes de su evidencia.

La CLI `backend/discard_mysql_trial77.py:main()` delega en `runtime.execute()`
solamente con `--execute`, después de comprobar el manifiesto mediante `authorize()`.
Antes de 78D había dos lugares capaces de emitir el mismo código:

1. `runtime.py`, `execute().owned()`, anterior línea 100:
   `pidfile.read_text(encoding='ascii').strip() == str(process.pid)`.
   Se invocaba antes de la conexión SQL, después del aprovisionamiento y tras el
   worker, sin distinguir esos hitos en la evidencia.
2. `worker.py`, `run()`, anterior línea 20: la misma comparación con
   `payload['pid']`, antes de importar/conectar el driver. Su `main()` conservaba
   únicamente la clase de excepción y un código SQL numérico opcional.

Flujo anterior reconstruido de los fuentes:

- `OwnedTrial.spawn()` usa `subprocess.Popen` directamente, sin shell/wrapper,
  con el ejecutable aprobado. El PID esperado es `Popen.pid`, no uno descubierto
  por nombre, puerto o archivo. El inicializador es un Popen separado.
- El servidor recibía `--no-defaults` primero, basedir explícito, datadir nuevo,
  `--console`, loopback/puerto efímero y `--pid-file=<raíz>/mysql.pid` absoluto.
  Se crea una raíz nueva con marcador e identidad de filesystem y ACL privada;
  no se permite reutilizar una raíz previa.
- La espera anterior salía al existir el archivo y cualquier listener de ese
  puerto en loopback. Todavía no validaba el contenido del archivo ni su PID.
  Luego `owned()` exigía proceso vivo, PID idéntico y listener del mismo PID.
- `spawn()` registra exclusivamente sus objetos Popen y asigna su handle a un
  Job mediante `AssignProcessToJobObject`. Un fallo de asignación intenta detener
  ese handle propio; la retirada vuelve a tratar los handles registrados y el
  Job, nunca un PID leído del archivo. Los descendientes se retiraban por Job,
  pero no se adoptaban como identidad del servidor.
- Antes de SQL se comprobaban marcador/raíz, rutas sin enlaces, vida del Popen,
  PID file y tabla TCP de Windows. No había consulta de imagen desde el handle
  ni comprobación explícita `IsProcessInJob` en cada control de identidad.
- Después de conectar, `ensure_own_server()` verifica UUID nuevo, datadir, puerto,
  InnoDB, UTC y aislamiento. El padre comprueba también `@@pid_file` y versión.
  La ruta configurada antes de SQL no equivale a acreditar la ruta efectiva SQL.

Ahora el rechazo equivalente se decide en
`process_identity.py:StartupIdentity.observe()` cuando el estado del archivo es
`VALID` y `pid_file_pid != process.pid`, y lo propagan `check()`/`wait_ready()`.
La comprobación adicional del worker reside en `check_worker_pid()`, que genera
`WorkerPidError('PID_NO_COINCIDE')` con la observación original saneada.

## B. Diagnóstico: hechos frente a hipótesis

La metadata PE del ejecutable instalado informa `FileVersion=8.0.46.0` y
`ProductVersion=8.0.46.0`. Se leyó como archivo, **sin ejecutarlo**; no es una
consulta de versión de un servidor en ejecución ni prueba de procedencia del binario.

Se consultaron por HTTP de solo lectura los fuentes oficiales de la etiqueta
`mysql-8.0.46`:

- [restart_monitor_win.cc](https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/restart_monitor_win.cc):
  líneas 548–557 reconocen `initialize*` y `no-monitor` como opciones tempranas,
  pero no `console`; 572–574 distinguen el monitor mediante `MYSQLD_PARENT_PID`;
  416–483 crean el proceso hijo del mismo ejecutable; 666–702 controlan su ciclo.
- [mysqld.cc](https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/mysqld.cc):
  8460–8467 inicializan el monitor Windows salvo opción temprana; 9230–9231
  declaran `--no-monitor`; 11661–11669 crean/truncan el PID file y escriben
  `getpid()` seguido de salto de línea.

Esto demuestra una **incompatibilidad estática**: el comando anterior podía
iniciar un monitor cuyo PID de Popen no era el del servidor que escribe el PID
file/posee el listener. `--console` no lo evita en esos fuentes. No demuestra que
esa fuera la causa concreta de 78C: no se conservaron su árbol, sus PID ni el hito.

| Posible causa | Conclusión admisible sin otro arranque |
| --- | --- |
| Popen distinto de PID del servidor; auxiliar/descendiente | Incompatibilidad demostrada con el monitor del código oficial; causa histórica plausible, no confirmada. |
| Lectura prematura/vacía | Brecha demostrada del predicado anterior: archivo vacío + listener existente permitían salir de la espera y fallar la comparación. Secuencia reproducida offline, no atribuida a 78C. |
| Lectura parcial numérica | Puede producir un entero diferente; permanece rechazo inmediato, sin esperar que cambie al esperado. No hay evidencia histórica. |
| Archivo erróneo/residual/ajeno | La raíz nueva, ruta fija, marcador y retirada previa reducen la posibilidad; no hay prueba histórica. Un PID diferente nunca se adopta. |
| Ruta configurada diferente de efectiva | Configuración absoluta comprobable estáticamente; la efectiva necesita validar `@@datadir`/`@@pid_file` en el ensayo autorizado. |
| Finalización temprana | Se comprobaba `poll()`; faltaba conservar su estado y el hito. No hay evidencia histórica suficiente. |
| Fallo de asignación al Job | Existía rechazo en `assign()`, anterior a la comparación; no explica por sí solo el código observado. Pertenencia nativa pendiente. |
| Handle inválido o PID de otro proceso | No puede resolverse con el archivo PID; la nueva comprobación usa únicamente nuestro handle y bloquea ante discrepancia/error. |
| Implementación de comparación | La igualdad estricta no era un defecto por sí misma. Sí eran defectos la suposición de proceso único y la preparación basada solo en existencia. |

## C. Correcciones focalizadas y archivos

- `backend/discard_mysql77/runtime.py`: agrega la opción soportada `--no-monitor`
  **solo al servidor**. Conserva `--no-defaults` primero y no adopta descendientes.
  Integra hitos y diagnóstico antes de la retirada. Un error de escritura
  diagnóstica no evita retirar ni sustituye el rechazo original.
- Nuevo `backend/discard_mysql77/process_identity.py`: snapshot PID acotado,
  comparación estricta, metadatos desde handle propio, espera verificable y
  allowlist de evidencia. Archivo numérico distinto o malformado, handle,
  imagen, Job o listener ajenos: rechazo inmediato. Solo ausencia/vacío del PID
  file o listener aún ausente pueden esperar, con **60 s y sondeos de 50 ms**,
  igual que antes; sin relanzamiento y sin aceptación después del plazo.
  Un listener ajeno se rechaza incluso si falta todavía el PID file.
- `backend/discard_mysql77/resources.py`: registra rol/asignación, consulta
  `IsProcessInJob` con el Job exacto, consulta únicamente handles registrados y
  conserva `startup.json` después de validarlo nuevamente durante la retirada.
- `backend/discard_mysql77/worker.py`: captura el PID file **en la comparación**,
  sin volver a leerlo después para reconstruir un error; no abre procesos por PID.
- `backend/discard_mysql77/safety.py`: incorpora el nuevo fuente al digest/copia;
  versión `codn-discard-mysql77-78d-pid-evidence-v2` y política de evidencia actualizada.
- Nuevo `backend/test_discard_mysql78d.py`; ajuste exclusivamente de la prueba
  histórica consumida en `backend/test_discard_mysql78b.py`. El manifiesto anterior
  conserva autorización, UUID, versión y hashes históricos; no se escribe ni usa
  para autorizar/ejecutar, y ya no coincide con los nuevos fuentes/versión/recursos.

No se corrigen reglas clínicas, B1, retinógrafo ni incertidumbre/idempotencia.

## D. Evidencia mínima prevista para otro ensayo

`evidence/startup.json` se escribe de forma exclusiva antes de `retire()`, con un
máximo de 64 eventos, coalesciendo sondeos repetidos y reteniendo inicio/último
evento. No se conserva el archivo PID ni los logs crudos como evidencia.

Cada evento contiene solo:

- Hito fijo y milisegundos relativos monotónicos desde el diagnóstico previo a
  inicializar; los milisegundos del worker son relativos a su propia entrada.
- PID esperado/Popen, PID del handle propio y PID numérico del archivo si válido;
  PID del listener obtenido de la tabla TCP, nunca inspección del proceso ajeno.
- Estado del handle, `poll()`/código de salida Windows y código numérico de error
  de metadatos si lo hay; no se imprime la excepción ni el valor del handle.
- Archivo ausente/vacío/válido/inválido/inseguro/cambiado/error de lectura,
  tamaño, mtime, regularidad y enlace único. Contenido leído limitado a 65 bytes;
  **ningún contenido inválido se serializa**, ni siquiera parcialmente.
- Raíz/rutas verificadas, objeto registrado, asignación al Job y pertenencia real,
  comparación con imagen autorizada, identidad SQL ya verificada o todavía no.
- Motivo fijo del rechazo y resultado `PENDING`, `VERIFIED` o `REJECTED`.

Hitos: inicialización, espera de arranque, `PRE_SQL`, `SQL_IDENTITY_VERIFIED`,
`POST_PROVISION` y `POST_WORKER`. Un fallo al crear/asignar procesos conserva
también el rol del hito y la asignación fallida si hubo Popen registrado.
El segundo sitio conserva `failure.json.worker_pid` con PID esperado/leído,
estado/metadata del archivo, tiempo relativo y motivo, capturados antes de fallar.
No acredita por sí solo handle/Job en el worker: esos datos corresponden al padre.

No hay contraseñas, tokens, owner secreto, UUID SQL, DSN, argv, env, rutas privadas,
mensajes de excepción, datos clínicos ni imagen alternativa del ejecutable en la
nueva evidencia. Campos desconocidos/tipos inválidos se rechazan, no se preservan.
Si falla su escritura, se informa `startup_evidence_written=false`; no se promete
evidencia imposible ante pérdida de propiedad/permisos. La retirada continúa.
Con retirada `COMPLETED`, los JSON se vuelven a sanear y los privados desaparecen;
con `INCOMPLETE` por procesos vivos no se recorre/elimina el árbol, que requiere
revisión. El error primario se mantiene y la línea `B_RETIREMENT` informa el estado
real, sin convertir `INCOMPLETE` en éxito.

## E. Verificación offline

Desde `backend`:

```powershell
.\venv\Scripts\python.exe -B -m unittest test_discard_mysql_preflight77 test_discard_mysql_schema77 test_discard_mysql78a test_discard_mysql78b test_discard_mysql78d -v
.\venv\Scripts\python.exe -B discard_mysql_trial77.py
```

La suite 78D incorpora **37 tests**: coincidencia; PID diferente/ajeno; ausencia;
vacío/inválido/parcial; proceso terminado; handle inválido/diferente; Job/imagen
incorrectos; preparación tardía/plazo; error de metadatos/lectura/listener;
archivo reemplazado/hardlink; fallos de inicialización, Popen y asignación;
retirada `COMPLETED`/`INCOMPLETE`; fallo al escribir evidencia sin ocultar el error;
saneamiento/historial acotado; comparación real del worker con mocks y retención;
API Windows/Job totalmente simuladas; regresión `--no-monitor`/digest.

Los 62 tests anteriores siguen siendo aplicables con la adaptación histórica
indicada. No se usa su antigua premisa NOT_AUTHORIZED/raíz ausente para un recurso
ya consumido en 78C. Las pruebas de preparación solo crean fixtures offline;
ninguno de sus manifiestos o ejecutables ficticios se convierte en autorización
operativa ni recurso MySQL de este incremento.

Resultado conjunto: **99/99 aprobados, 0 fallos, 0 skips** (62 anteriores + 37 de
78D). Sintaxis: **43 archivos Python** compilados en memoria, sin importar los
fuentes clínicos ni generar pyc. Preflight real sin configuración: `A_NO_CONNECTION`,
42 fuentes seleccionados, `phase_b_configuration=MISSING` y
`mysql_execution=NOT_AUTHORIZED_BY_PREFLIGHT`.
Digest observado de fuentes:
`97042bfe32d789979b4594f5dbd16c16b1428ee533476357c77d01350605797d`.
`git diff --check`: sin errores; únicamente avisos LF/CRLF de Git. Los archivos
nuevos también superaron la comprobación explícita de whitespace/final de línea.
Los mocks **no acreditan comportamiento nativo** de Windows,
Job/ACL, MySQL, InnoDB ni casos clínicos.

## F. Seguridad y límites

Se mantiene `Popen PID == handle PID == PID file == listener PID`, proceso vivo,
imagen autorizada, raíz propia, rutas sin enlaces, Job asignado y pertenencia
verificada. No se consulta `OpenProcess(PIDfile)`, no se enumeran procesos ni se
adoptan descendientes/listeners. UUID/marcador o archivo PID nunca bastan solos.
La comprobación SQL efectiva sigue siendo necesaria después del control previo.

No se ejecutó `mysqld.exe`, ninguna conexión SQL, DDL/DML, migración, inferencia ni
fase B nativa. No se modificaron CODN clínico, frontend, B1, retinógrafo, `.env`,
fotos, compuertas, recursos habituales o evidencia de la raíz histórica. Sin
commits/push. No se creó/autoriza un nuevo manifiesto operativo ni token.

## G. Próximo ensayo (no autorizado aquí)

1. El arnés puede pasar a **preparar** un nuevo manifiesto tras las verificaciones
   offline; no equivale a autorización ni a garantía nativa. Usar nuevo UUID/raíz,
   fecha, versión vigente, digest de los 42 fuentes y hash binario verificado,
   seis scopes y política exacta de creación/retirada/evidencia. No recalcular ni
   modificar el manifiesto consumido para hacerlo pasar.
2. Repetir tests, metadatos del manifiesto, autorización explícita independiente,
   hashes actuales, raíz/recursos ausentes, rutas sin enlaces/hardlinks peligrosos,
   exclusión de secretos y destinos habituales, loopback/puerto no reservado,
   ACL/Job y alcance exacto de retirada. El preflight A no autoriza arrancar ni
   demuestra esos controles nativos: algunos solo podrán verificarse en B futura.
3. Ante otro desacuerdo, `startup.json` permitirá diferenciar PID del Popen y del
   archivo, vida/handle, Job, listener, imagen y preparación, con el hito exacto;
   `failure.json.worker_pid` separará el rechazo del worker. No se reconstruirá
   evidencia histórica ausente ni se aceptará un proceso distinto para continuar.
4. No queda un fallo offline conocido que impida **solicitar** una nueva
   autorización. Sigue pendiente comprobar nativamente `--no-monitor`, identidad,
   datadir efectivo, Job/ACL y retirada, luego inventario, integridad, B1,
   retinógrafo, nueve carreras y limpieza/incertidumbre. Ningún resultado 78D
   autoriza activar el descarte ni acredita validación integrada en navegador.
