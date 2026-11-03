# 77 — Arnés focalizado preparado; MySQL NO ejecutado

**Actualización 78B:** el cargador exige manifiesto v2 con estado explícito,
fecha/versión y recursos verificados. El formato anterior de seis campos ya no
se acepta. Ver [78b_manifiesto_mysql.md](78b_manifiesto_mysql.md) y el manifiesto
NOT_AUTHORIZED enlazado allí. La CLI conserva sus mismos tres argumentos.

**Actualización 78A:** se subsanaron las cuatro brechas estáticas señaladas en 78.
Consultar [78a_subsanacion_arnes_mysql.md](78a_subsanacion_arnes_mysql.md) para las
barreras de inventario, retirada completa, casos nuevos y verificación offline.

Este incremento añade únicamente infraestructura/código de pruebas. No acredita
una instancia actualmente disponible, DDL habitual, concurrencia real ni activación.
No modifica `app.py`, frontend, permisos persistidos, `.env`, inferencia funcional
ni arneses B1 originales. El trabajo no confirmado de 72–75 se conserva.

## A. Arquitectura y reutilización

Entrada: `backend/discard_mysql_trial77.py`. Por defecto ejecuta **solo A**.

| Archivo | Responsabilidad |
| --- | --- |
| `discard_mysql77/safety.py` | Preflight stdlib, selección de fuentes, hash, manifiesto, perímetro y rechazo de enlaces. |
| `discard_mysql77/runtime.py` | B futura: instancia NUEVA propia, ACL, PID/puerto, credenciales y lanzamiento del worker. |
| `discard_mysql77/application.py` | Fábrica Flask, predictor sintético, metadatos copiados y fixtures. |
| `discard_mysql77/worker.py` | Proceso aislado, guards SQL/red, instalación y secuencia; evidencia saneada. |
| `discard_mysql77/schema.py` | Inventario efectivo completo y barrera base/full antes de fixtures/DML. |
| `discard_mysql77/resources.py` | Propiedad por identidad FS/creación, Job Windows, retirada y evidencia saneada. |
| `discard_mysql77/cases.py` | Casos B reales preparados; no son tests auto-descubiertos. |
| `test_discard_mysql_preflight77.py` | Tests offline de seguridad, imports, rutas y rechazos. |
| `test_discard_mysql_schema77.py` | Fábrica y DDL compilado sin conexión, en copia temporal y proceso nuevo. |

Solo se reutilizan `free_loopback_port` y `ensure_own_server` de
`b1_mysql_disposable_trial.py`, mediante import diferido DESPUÉS de autorizar B.
La comprobación histórica de UUID de B1 es adicional: **no acredita propiedad**.
La propiedad se establece antes de conectar por Popen/handle, tabla TCP del SO,
PID file, datadir nuevo y marcador del ensayo.

No se llaman `main`, `run_trial`, `client_script`, reconstrucción del maestro ni
`run_orm_integration`. El arnés ORM B1 solo aportó patrones de Flask, configuración
SQLAlchemy explícita, UTC, predictor sustituido y coordinación por eventos.
Su import global carga dependencias/rutas y su servicio puede crear uploads según
cwd: NO se importa. Tampoco se importan fixtures SQLite 72/74, que normalizan tipos,
parchean la raíz y sustituyen autenticación; no acreditarían MySQL/B1 reales.

## B–C. Fases, preflight y autorización

### A — permitida ahora

Desde `backend`, comandos sin SQL:

```powershell
.\venv\Scripts\python.exe -B discard_mysql_trial77.py
.\venv\Scripts\python.exe -B -m unittest test_discard_mysql_preflight77 test_discard_mysql_schema77 -v
```

El primer comando solo lee fuentes seleccionados y comprueba imports/propuesta,
dependencias y digest. No busca instancias, asigna puertos, inicia ejecutables,
lee `.env`, abre SQL ni crea un sandbox. Sin manifiesto informa
`phase_b_configuration=MISSING`: **no es un destino autorizado**.
`--config RUTA` permite revisar un manifiesto sin ejecutar B.

Controles preparados y comprobados offline:

- Imports del arnés sin Flask, SQLAlchemy, PyMySQL, `database` ni modelos DL.
- Ninguna variable heredada puede seleccionar B. Sin `--execute`, siempre A.
- Sin manifiesto/confirmación/alcance exactos, B falla antes de lanzar procesos.
- Manifiesto cerrado: rechaza host, puerto, usuario, contraseña, DSN y claves extra.
- UUID canónico, esquema `codn77_<uuid_sin_guiones>` y raíz nueva fija bajo
  `C:\Users\ricar\AppData\Local\Temp\opencode\codn77-<uuid>`.
- Binario `mysqld.exe` absoluto y hash SHA-256 explícitos; hash de fuentes exacto.
- No reutiliza una raíz existente; cambio de fuentes/binario invalida aprobación.
- `lstat` ANTES de resolver: rechaza traversal, rutas relativas, enlaces,
  junctions/reparse points y ancestros enlazados. Fuentes hardlinked rechazadas.
- Sin copia de maestro SQL; solo las DOS sentencias CREATE técnicas de 72.
- Errores de entrada salen como códigos cerrados, no como configuraciones/secretos.

### B — preparada, NO autorizada ni ejecutada en 77

La autorización humana del Prompt 78 debe identificar UUID, binario/hash, digest,
raíz/datadir/esquema derivados, cuentas y alcance de escritura/retirada.
El manifiesto no demuestra por sí solo consentimiento humano.

El formato vigente está materializado en
[`../trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json`](../trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json).
Es un documento de revisión, **NOT_AUTHORIZED**, sin cadena de autorización ni
credenciales. Incluye fecha UTC, versión v2, versión del arnés, hashes, alcances y
recursos derivados. Esos recursos se comparan con el runtime; no son overrides.

Solo después de aprobarlo, B requerirá simultáneamente `--execute --config RUTA
--authorize-run UUID`. No ejecutar ese comando en 77.
También requiere estado AUTHORIZED y autorización concordante: un UUID coincidente
por sí solo no desbloquea la fase B. Preparar o inspeccionar el JSON no autoriza nada.
No acepta instancias preexistentes o destinos SQL alternativos.

## D. Esquema sintético

Se copian las 16 tablas clínicas/catálogos/B1/Informes declaradas en los cuatro
módulos de entidades utilizados. Se conservan columnas, nulabilidad, defaults,
FK, acciones ON DELETE, CHECK, UNIQUE e índices existentes. No se usa maestro
privado, dumps ni datos habituales. No se llama `db.create_all()`.

**Overlay de pruebas explícito:** los modelos clínicos genéricos no coinciden en
signo con extensiones MySQL. En una **copia** de MetaData se alinean los dominios
`usuarios.id`, `pacientes.id` a INT UNSIGNED y `visitas_clinicas.id`,
`diagnosticos_retinopatia_detalle.id` a BIGINT UNSIGNED, propagándolos a sus FK.
Se fija InnoDB/utf8mb4 en esta copia. NO se mutan los modelos de aplicación.
No se añade una UNIQUE diagnóstico/ojo que no esté declarada: su ausencia sigue
siendo un límite que requiere contrastar DDL autorizado antes de activar.

Primero se instalan las tablas base desde CreateTable/CreateIndex compilados y
se compara el inventario efectivo con los metadatos autorizados. Solo tras aprobarlo
se prueba el modo apagado SIN extensión. Luego se invalida la aprobación, se instala
la propuesta 72 y se verifica el esquema completo ANTES de permitir nuevos fixtures.
DDL MySQL no se considera transaccional como lote.
Ante instalación parcial se detiene sin DROP compensatorio.

Quedan preparadas comprobaciones nativas de tipos/signo, PK/FK, defaults, collation
ASCII/binaria, índices, InnoDB, CHECK ENFORCED y rechazo real de estado inválido.
El inventario no inserta fixtures. `seed()` y ambos motores rechazan escrituras
antes de una aprobación; el worker de limpieza/reinicio también verifica el esquema.
La repetición de CREATE debe fallar con 1050, sin ocultarlo mediante IF NOT EXISTS.
**Todo eso sigue pendiente de ejecución MySQL.**

La visibilidad limitada de la cuenta app no acredita inspección de triggers/FK de
otros esquemas en un despliegue real: el ensayo parte de una instancia nueva, hace
inventario administrativo y no permite a la cuenta app crear dependencias.

## E. Pruebas disponibles

Requisito **O**: Python/dependencias locales, mocks, copia temporal propia y
conectores/procesos del hijo bloqueados. Requisito **M**: autorización B, binario
MySQL 8.0 >=8.0.16 aprobado, Windows, cuenta/ACL privadas, conexiones físicas
independientes y archivos sintéticos. Ninguna prueba M fue ejecutada.

| Nombre/grupo | Escenario y resultado exigido | Requisito | Estado |
| --- | --- | --- | --- |
| `Preflight77Tests` | Imports inertes, default A, autorización ausente, configuración extra/incompleta, cambios de hash, enlaces, raíz habitual, maestro, env y flags. Rechazo cerrado. | O | Ejecutada sin MySQL. |
| `OfflineSchema77Tests` | Fábrica real desde copia, rutas/CLI, 16 tablas compiladas, todas las FK compatibles, B1 real, sin modelos/SQL. | O | Ejecutada sin MySQL. |
| `disabled_without_technical_tables` | Inferencia y PUT tradicionales, Informes con clave homónima histórica, comprobante conservado y descarte denegado. | M | Preparada; pendiente autorización. |
| `native_schema_*` | Tipos/defaults/índices/CHECK reales; reinstalación rechazada y rollback de inserción inválida. | M | Preparada; pendiente autorización. |
| `single_eye_*`, `preserve_APROBADO/CORREGIDO`, `both_eyes_*` | Snapshot completo del ojo/visita; revisión +1; padre preservado o retirado si vacío; inferencia nueva en MISMA visita. | M | Preparadas; pendiente autorización. |
| `reject_*` | Validado, CONSUMIDA, informes ACTIVO/INACTIVO/ANULADO, visita CERRADA/ANULADA, paciente/detalle ajeno y lote mixto: cero cambios parciales/archivos. | M | Preparadas; pendiente autorización. |
| `reject_selected_CORREGIDO*` | OD CORREGIDO seleccionado solo o junto a OI: rechazo y snapshots médicos, archivos, revisión y operaciones intactos. | M | Preparadas; pendiente autorización. |
| `real_retinograph_disabled/enabled` | Rutas B1 reales: hash, ojo/paciente, copia privada, confirmación, consumo, rechazo de reutilización y descarte vinculado. | M | Preparadas; pendiente autorización. |
| `B1_*` | Permiso ausente/revocado, admin puro, grant solo administrativo, rol/usuario inactivo, otro creador/visita y crear/validar sin descarte: 401/403. Caso positivo usa B1 real. | M | Preparadas; pendiente autorización. |
| `race_*` | Nueve carreras detalladas abajo: estado final coherente, UUID/revisión exactos, sin resurrección de detalles. | M | Preparadas; pendiente autorización. |
| `UUID_content_*`, `lost_ack_*`, `rollback_*` | Idempotencia intencionada, contenido distinto rechazado, detalle nuevo intacto, ACK perdido conciliado SOLO con GET; rollback no borra JPEG. | M | Preparadas; pendiente autorización. |
| `lock_timeout_GET/POST_*` | 1205 real en solicitud protegida; respuesta no confirmatoria, rollback, reconsultas GET sin repetir POST. | M | Preparadas; pendiente autorización. |
| `mysql_1205/1213_*` | Timeout/deadlock real sobre visitas sintéticas; rollback explícito de TODA transacción, incluso escritura anterior no fallida. | M | Preparadas; pendiente autorización. |
| `cleanup_*`, `shared_file_*`, `hardlink_*`, `outside_root_*` | Manifiesto pendiente tras commit; ausencia/idempotencia; reemplazo, nombre reutilizado, cambio de identidad, enlaces, referencia viva y raíz/cwd incorrectos conservan archivos ajenos. | M | Preparadas; pendiente autorización. |
| `preserve_unaffected_retinograph_*` | Comprobante CONSUMIDA, todas las columnas del ojo no seleccionado y bytes de copia privada intactos tras descarte y limpieza. | M | Preparada; pendiente autorización. |
| `cleanup_new_process_*`, `cleanup_unlink_before_commit_*` | Nuevo proceso Flask reanuda manifiesto; unlink seguido de fallo antes de commit permite reintentar por ausencia. | M | Preparadas; pendiente autorización. |

Los IDs de usuarios/paciente/visita/padre/detalles/grados se obtienen de los flush
del fixture. La inferencia es sintética, determinista y no verifica clasificación,
preprocesado ni Grad-CAM reales. No se sustituyen autorización, repositorios,
servicios de descarte, validación médica, Informes o almacenamiento.

## F. Coordinación InnoDB

Sesiones propias por request/contexto Flask y conexiones físicas distintas.
`REPEATABLE READ`, UTC y lock timeout explícitos. Tercera conexión administrativa
nueva comprueba resultados, sin snapshot viejo. Los eventos SQL se instalan solo
en el motor app de prueba y se retiran al terminar cada caso.

Para locks: primer trabajador pausa en `after_cursor_execute`, **después** del
SELECT FOR UPDATE/INSERT real. El segundo notifica antes de su sentencia. El
coordinador acredita espera mediante `performance_schema.data_lock_waits` y sus
THREAD/PROCESSLIST IDs; Event.wait y el sondeo no se usan como prueba de bloqueo.
No se reemplaza FOR UPDATE por mutex Python. Un 1213/1205 inesperado hace fallar
el caso aunque el servicio lo traduzca a HTTP genérico; no hay retries automáticos.

| Carrera | Primer punto retenido / competidor | Verificación final |
| --- | --- | --- |
| PUT primero | Diagnóstico D bloqueado / descarte obtiene V y espera D. | PUT 200; descarte 409, detalle validado intacto, revisión sin cambio, sin operación. |
| Descarte primero | D retenido / PUT espera D. | Descarte 200; PUT antiguo 404, solo ojo conservado, revisión 1, UUID exacto. |
| Inferencia anterior | Predictor pausa tras captura R y rollback; sin SQL abierto. | Descarte R+1; inferencia 409 INFERENCIA_OBSOLETA, ningún detalle obsoleto. |
| Mismo UUID | V retenida / segundo POST espera V. | Dos resultados idénticos, una operación y un incremento. |
| UUID distintos | V retenida / segundo POST espera V. | Uno confirma, otro 409, no reemplazos eliminados. |
| Otro ojo | Pausa tras INSERT del ojo incorporado / descarte espera V. | Ojo nuevo conservado; el orden inverso está cubierto por inferencia anterior. |
| Informe primero | V retenida por creación / descarte espera V. | Informe/versión confirmados; descarte INFORMES_EXISTENTES. |
| Descarte antes de informe | V retenida / informe con R espera V. | Revisión 1, informe CONTEXTO_INFORME_OBSOLETO, sin documento parcial. |
| Visitas distintas | Retener consulta global de referencias de archivo / otro descarte. | Ambos contextos coherentes y UUID separados; registrar posible contención/deadlock, **no afirmar lock-free**. |

Los probes 1205/1213 usan dos visitas propias: cada transacción modifica primero
una fila distinta; 1205 retiene una y 1213 invierte el orden de locks. Se hace
rollback total y una conexión nueva compara TODAS las filas de visitas.
Los fallos se investigan; no se repite la operación para conseguir un pase.

## G–H. Archivos, procesos, B1 y seguridad

Solo se copian archivos permitidos actuales, byte por byte y con hash final. Esto
incluye los fuentes 72–75 no confirmados; no se usa `git archive HEAD`. No se copian
`.env`, SQL maestro, uploads, checkpoints, modelos pesados, claves del retinógrafo,
dependencias o configuración habitual. El módulo B1 copiado no ejecuta su main.

El sandbox tiene `backend/uploads/retinas` para JPEG/Grad-CAM, `tmp`, `exports`,
`private` y `evidence`. El manifiesto de limpieza real vive en SQL en la tabla
técnica, no en un segundo JSON de prueba. La raíz de escritura, lectura HTTP y
limpieza debe coincidir SIN parchear `storage_root`. La CLI se invoca con el runner
de ESTA fábrica Flask, nunca `flask --app app` habitual.

En B futura: raíz nueva con ACL privada del usuario actual; mysqld `--no-defaults`,
solo loopback, sin MySQL X, named pipes, shared memory, binlog, local infile ni
persisted globals. PID/listener propio se acredita ANTES de SQL. Un archivo
bootstrap NUEVO bajo ACL privada fija root aleatorio antes de aceptar TCP y se
retira tras verificar identidad. La retirada cubre también fallos de preparación,
arranque y ensayo; si propiedad, procesos o SO impiden limpiar, el resultado es
INCOMPLETE con recursos pendientes explícitos bajo ACL privada. No contiene
credenciales copiadas del entorno habitual.
El resto de credenciales viaja solo en pipes anónimos, no argv/env/DSN impreso.

Cuenta `codn77_app@127.0.0.1`: SELECT/INSERT/UPDATE/DELETE solo sobre el esquema
derivado; sin DDL, GRANT o DROP. Root de ESA instancia instala el esquema, observa
locks y verifica inventario. Guards del worker comprueban loopback, puerto/PID,
esquema exacto, cuenta y UUID/datadir de cada conexión física. No hay clientes con
perfiles implícitos. SECRET_KEY es sintética/efímera; B1 consulta cuentas/roles/
grants SQL reales. No se admiten autorizaciones legadas ni JWT decodificados por mock.

El worker de reinicio también comprueba perímetro, marcador, PID y hash; no es una
entrada alternativa para el entorno habitual. Sin servidores HTTP adicionales.
Los logs privados NO se vuelcan. La retirada conserva solo JSON saneado de casos,
estado, clases de error/códigos MySQL, connection IDs y huellas SHA-256 de DDL;
retira logs, DDL crudo, datadir, fotos, credenciales y marcador privado. El Job Windows
contiene procesos propios y descendientes; se verifica vacío antes de eliminar.

Los tests de symlink no omiten el caso nativo si falta privilegio: detienen la
secuencia para decisión del responsable. El servicio puede dejar symlinks como
PENDIENTE (UnsafeExportError) y cambios de identidad como CONFLICTO: ambos deben
conservar el objeto. No se fuerza COMPLETADA para ocultar un conflicto.

## I. Verificación realmente ejecutada

- `test_discard_mysql_preflight77`: **27/27**; `test_discard_mysql_schema77`:
  **1/1**. Total **28/28** sin MySQL. Solo stdlib/mocks, archivos
  temporales propios e imports/compilación en hijo con Engine.connect,
  pymysql.connect/Connect y socket.connect bloqueados; procesos del hijo bloqueados.
- Compilación Python con `compile()` sin generar pyc; fase A con el venv del proyecto.
- `git diff --check` y control de whitespace de archivos nuevos.
- **Ningún mysqld, conexión SQL, migración, grant persistido, inferencia real,
  servidor HTTP, descarte clínico, commit ni push.**

La fábrica/DDL offline NO valida el dialecto en servidor ni locks. La fase B puede
descubrir fallos del propio arnés; no se presenta como ejecución ya acreditada.
El estado real de esquema y sistema clínico habitual permanece desconocido.

## J. Procedimiento propuesto para Prompt 78 (NO ejecutado)

1. Repetir A con el venv; revisar diffs/allowlist/hashes y requisitos locales.
2. Identificar un UUID NUEVO y aprobar binario, raíz, esquema, cuentas, ACL y
   alcances del manifiesto. Rechazar cualquier intento de reutilizar instancia.
3. Obtener autorización humana explícita para B, datos sintéticos, limpieza de
   archivos propios y parada del proceso propio. La autorización 77 NO sirve.
4. Revisar el manifiesto con A. Solo entonces ejecutar B con doble confirmación.
5. Secuencia B: identidad OS/SQL → base sintética → inventario base → modo apagado →
   invalidación → propuesta 72 → inventario completo → integridad → B1 → carreras → incertidumbre/errores MySQL →
   almacenamiento/reinicio. Fail-fast, sin retry POST ni compensaciones DDL.
6. Detener ante identidad/ruta/hash/ACL incompatible, DDL parcial, cambios del otro
   ojo, UUID/revisión incoherente, borrado parcial, deadlock inesperado o exposición
   diagnóstica. No tocar procesos ni recursos externos para resolverlo.
7. Recopilar `results.json`, secuencia de conexiones/esperas y huellas del DDL
   sintético/efectivo. Revisar solo evidencia saneada. Guardar versión/binario/PID/puerto/
   UUID/datadir y resultado de retirada del proceso.
8. La autorización debe incluir `retire_owned_resources`. La parada usa handles
   creados por el ensayo y su Job Windows; no mata por PID adivinado ni por puerto.
   Tras cerrar conexiones y confirmar TODOS los procesos terminados, se retiran
   datadir/esquema, material privado y fuentes temporales mediante un recorrido
   confinado que no sigue enlaces. Solo queda `evidence/` saneado. No hay rmtree
   genérico ni DROP contra servidores. Propiedad incierta o fallo de borrado implica
   INCOMPLETE, recursos pendientes explícitos y prohibición de declarar éxito.

Limitaciones visibles: NO_CONFIRMADA solo significa ausencia de registro en esa
consulta, no negativo terminal; un GET/404/timeout no desbloquea. No se implementa
cierre por UUID ni descubrimiento de operaciones. Pérdida de marcador/cierre de
pestaña y E2E visual/red/browser siguen pendientes; el ACK perdido del ensayo es
una inyección después de commit, no una prueba de navegador. Los probes directos
de errores MySQL no equivalen a probar todos los caminos HTTP posibles.

Aunque B llegara a pasar, las compuertas habituales permanecen apagadas. Revisar
DDL real autorizado, recuperación limitada, UI, coordinación de escritores y
procedimiento de desactivación antes de una decisión de activación independiente.
