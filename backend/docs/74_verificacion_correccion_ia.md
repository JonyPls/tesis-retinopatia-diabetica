# 74 — Verificación integral parcial; NO autoriza activación

## Seguridad y alcance

No hubo conexiones MySQL, migraciones, DDL habitual, grants, inferencia real,
limpieza de fotografías existentes, cambios `.env`, servidores nuevos, commits ni
push. Se preservó el trabajo no confirmado de 72/73. Las tres compuertas backend
siguen False y la flag frontend sigue opt-in ausente de configuración de entorno.

Las suites backend se ejecutaron en procesos separados, con `dotenv.load_dotenv`
sustituido antes de importar y `pymysql.connect` bloqueado. SQLite `sqlite://`
explícito, Flask propio, predictor sustituido y TemporaryDirectory. No se importó
`app.py` ni se ejecutaron los arneses MySQL B1. No consta autorización nueva para
un MySQL aislado; los ensayos históricos no la sustituyen.

## A. Contratos

Se comparó un fixture con **JSON HTTP de las rutas Flask reales**, utilizando
servicio, repositorio y SQLite temporal; TypeScript consume ese mismo fixture.
Solo se normaliza la fecha UTC variable tras validar su formato.

- GET contexto: visita=30/paciente=7, padre real=9, detalles 11/12, OD/OI,
  estado/elegibilidad/bloqueo/revisión; el frontend no confunde padre y visita.
- POST: exactamente paciente_id, diagnostico_retinopatia_id, detalle_ids,
  revision_esperada, operacion_id UUID canónico, confirmo_descarte=true.
- GET operación: CONFIRMADA con operación propia o NO_CONFIRMADA con null.
  POST confirmado y GET conciliado representan el mismo resultado.
- GET revisión: visita_id, paciente_id y revision_inferencia. No requiere permiso
  de descarte; sí el contrato B1 específico de creación de Informes.
- Sin detalles: padre/estado=null, detalles=[], misma visita ACTIVA y revisión
  incrementada. Limpieza PENDIENTE y COMPLETADA aceptadas por TypeScript.
- Errores reales 400, 403, 409 y 503 no se convierten en confirmaciones. 401 se
  cubre en la suite backend original. 404/5xx, timeout y éxito malformado se cubren
  con mocks de incertidumbre en el hook. Nunca reenvía el POST automáticamente.

No se encontró una incompatibilidad de los cuatro envelopes HTTP inspeccionados.
No es una prueba E2E de navegador/red/MySQL ni de todos los valores posibles de IDs.
El cliente rechaza enteros que no son seguros en JavaScript; no redondea IDs grandes.

## B. Integridad por ojo

| Escenario | Evidencia aislada |
| --- | --- |
| OI manual pendiente | Solo elimina 12; todas las columnas de OD 11 se conservan, visita 30 permanece. |
| OD APROBADO/CORREGIDO | Conserva cada columna, validador, fecha, grado, comentario y motivo; padre restante VALIDADO. |
| Ambos | Padre vacío desaparece; visita persiste y el repositorio normal admite nuevo diagnóstico/detalle en esa visita. |
| Lote incompatible | Validación o comprobante en un seleccionado rechazan todo el lote, sin eliminación parcial. |
| Informe existente | Rechazo en cualquier estado documental; documento, filas y archivos sintéticos intactos. |

Frontend: limpieza selectiva de resultado/ref, archivo/preview y borradores del
ojo confirmado, generación invalidada y filtro de IDs retirados. Se conservan
OD, decisiones locales y confirmedVisitId; Paso 2 solo tras confirmación. Nueva
imagen manual exige nueva aceptación y usa handleSave; navegación/confirmaciones
Auto y protección de imágenes procesadas conservan sus pruebas anteriores.

## C. Concurrencia y esquema

Órdenes inspeccionados: descarte visita → operación → diagnóstico → detalles;
inferencia manual visita → diagnóstico → detalle; retinógrafo confirmación →
visita → diagnóstico → detalle; validación diagnóstico → detalle; creación de
informe visita → revisión → informe/versión → commit. Los lectores de descarte y
revisión abandonan el snapshot de autenticación antes de adquirir locks clínicos.
No hay llamada a cleanup dentro del POST.

Se probaron órdenes secuenciales/intercalados con repositorios y servicios reales:
validación antes/después, cálculo de IA suspendido durante descarte, otro detalle,
UUID repetido, sustitución por nuevo ID y conflicto de informe. Una prueba adicional
comprueba que check_report precede al INSERT, con transacción activa y sin commit
intermedio. SQLite NO acredita bloqueo InnoDB, RR multiproceso, deadlocks ni esperas.
Casos MySQL detallados en [74_mysql_pendiente.md](74_mysql_pendiente.md).

### Compatibilidad estática de la propuesta 72

- Tablas clínicas referenciadas preceden a las dos tablas técnicas. Las técnicas
  no requieren orden entre sí ni FK hacia diagnósticos/detalles descartables.
- PK revisión=visita; PK operación=UUID; índices visita/limpieza y los implícitos
  de FK en InnoDB. La unicidad por visita/ojo de tablas clínicas es prerrequisito
  del DDL real, no está acreditada por este fixture SQLite portable.
- FK técnicas RESTRICT; no cascadas hacia manifiestos. JSON nativo, DATETIME(6),
  CHECK de revisión/limpieza y defaults son compatibles previstos con MySQL
  >=8.0.16. UTC se genera en aplicación, no se supone por el tipo DATETIME.
- **Discrepancia corregida:** los metadatos técnicos compilaban autor_id signed,
  UUID con collation heredada, sin defaults de servidor ni engine explícito, a
  diferencia del SQL propuesto. Se alinearon variantes MySQL/defaults/InnoDB;
  una prueba compila el DDL sin ejecutarlo y contrasta ambos archivos.
- Los modelos clínicos legados usan Integer/BigInteger genéricos; eso NO prueba
  el signo real de usuarios.id/visitas_clinicas.id. La propuesta usa UNSIGNED:
  contrastar ambos lados de cada FK con DDL autorizado antes de instalar. No se
  cambió el SQL por adivinar el esquema habitual.
- No se usa IF NOT EXISTS ni create_all al arrancar. DDL parcialmente fallido y
  reversión requieren procedimiento aprobado; no prometer rollback atómico de
  CREATE TABLE MySQL ni borrar manifiestos durante reversión.

## D. Archivos

Solo se borraron archivos sintéticos temporales. Confirmado con pruebas:
rollback conserva filas/archivos/revisión; ACK perdido deja operación persistida
y archivos sin limpieza anticipada; reintento explícito/idempotente; ausencia de
archivo; sustitución de identidad; rutas peligrosas; referencias vivas; hardlink
y symlink (incluida sustitución después del snapshot) rechazados sin borrar el
destino. Copias privadas no se modifican. Se ejecutó la rama Windows del borrado
por handle; la rama POSIX se inspeccionó pero no se ejecutó aquí.

Esto no acredita las ACL, raíces, todos los escritores externos o el filesystem
de un despliegue real. La limpieza requiere mantenimiento explícito posterior.

## E. Informes

Modo apagado probado sin tablas técnicas y con mocks que prohíben consultarlas:
payload antiguo y claves históricas homónimas/anidadas conservados. En modo de
prueba habilitado, captura al adoptar visita, envío superior, invalidación por
cambio de visita/sesión y rechazo de revisión obsoleta sin refresco silencioso.
El servicio comprueba revisión y escribe bajo la misma transacción; falta ensayo
real concurrente M05. El primer informe sin visita conserva su contrato y el
resto del lote usa revisión 0 de su visita nueva, ya protegida por el primer informe.

## F. Recarga e incertidumbre — BLOQUEO ABIERTO

Las tres pruebas de `diagnosisReload74.test.tsx` son **caracterizaciones de una
limitación**, no pruebas de que la recuperación esté implementada. Simulan pérdida
completa de memoria del store, no solamente desmontaje React.

1. Envío sin respuesta: en la misma sesión JS conserva UUID/payload y bloquea.
2. Commit antes de recargar: backend conserva operación canónica, resultado,
   revisión y manifiesto; la memoria frontend nueva no conserva UUID.
3. Petición aún en curso al recargar: backend puede confirmar después. Un GET
   ausente/404 no demuestra rollback. No existe listado de operaciones para
   redescubrir de manera general un UUID perdido.
4. El frontend recién cargado no reconoce esa operación pendiente y puede ofrecer
   el flujo normal al volver a seleccionar contexto/cargar otra fotografía.
5. Si la inferencia capturó revisión antes del descarte, no puede persistir tras
   este; si empieza después y captura revisión nueva, puede persistir en un ojo
   libre. Si el ojo sigue ocupado, el backend rechaza el duplicado. Esto evita
   sobrescrituras por ojo/revisión, pero NO recupera la intención/estado operativo
   perdido ni acredita el flujo requerido después de una recarga.

**No se declaró resuelto ni se añadió persistencia clínica al navegador.** La
mitigación operativa vigente es NO activar. Propuesta mínima para un incremento
acotado de recuperación: guardar antes del POST únicamente un marcador técnico
{autor, visita, UUID} en sessionStorage, sin token, documento, fotografía ni
resultado; si falla ese guardado, no enviar. Al volver, bloquear escrituras del
contexto y consultar exclusivamente GET del UUID. No reintentar POST ni eliminar
el marcador por TTL/404. Vincular a usuario/visita y no aplicarlo a nuevos IDs.

Guardar solo UUID no basta para liberar el flujo: falta adopción inequívoca de un
snapshot backend actual sin evaluación previa local, comprobación de identidades
y tratamiento de NO_CONFIRMADA persistente, cambios de sesión y almacenamiento
inaccesible/corrupto. Esa recuperación y su política negativa requieren trabajo
adicional; no se implementaron apresuradamente como recuperación histórica general.
Antes de activar deben implementarse/probarse o aprobarse explícitamente otro
procedimiento que mantenga exclusión segura tras recarga. M07 sigue bloqueado.

## G. B1

Verificados evaluador exacto y rutas HTTP: rol clínico activo con grants propios,
admin sin facultad clínica, grant solo administrativo, permiso revocado/inactivo,
no creador, paciente/padre/IDs incompatibles y conservación de contexto ante 403.
Leer/crear/validar no otorga descarte. El lector de revisión de Informes tiene
permiso separado. Sin cambios a permisos persistidos.

## H. Pruebas ejecutadas

| Conjunto | Resultado |
| --- | --- |
| Backend descarte/compatibilidad 72 + integración 74 | 49/49 correctas (37 existentes + 12 nuevas). |
| Auth backend | 119: 103 correctas, 16 expected failures legados. |
| Almacenamiento diagnóstico/retinógrafo/privado | 20/20 correctas. |
| Validadores con modelos sustituidos y fechas | 7/7 correctas. |
| Dashboard/configuración/registro paciente | 24/24 correctas. |
| Frontend focalizadas (7 archivos) | 121/121 correctas; incluye 3 caracterizaciones del bloqueo de recarga. |
| Frontend completa | 528: 525 correctas, 3 fallos preexistentes. |
| TypeScript + Vite | Correctos; advertencia bundle >500 kB. |
| Python AST | 11 archivos correctos, sin importar app/modelos DL. |
| git diff --check + whitespace de archivos nuevos | Correctos; solo avisos LF/CRLF de Git. |
| ESLint focalizado | Bloqueado por configuración preexistente eslint.config.js:15. |
| MySQL/navegador real | No ejecutados: sin autorización MySQL explícita y sin herramienta visual disponible. |

Referencia: snapshot Git **a9028e3**, extraído a temporal (sin resetear el trabajo),
mismos tests/dependencias. Auth: mismos 16 nombres y hashes de traceback normalizado.
Frontend: la prueba manual ejecutada en HEAD reproduce los mismos 3 nombres y
mensajes `·` esperado / `|` recibido. No se alteró esa UI ni sus expectativas para
ocultar fallos. ESLint sobre el snapshot HEAD reproduce el mismo TypeError al
cargar la configuración. JSON de ambas ejecuciones quedó solo como evidencia temporal.

Fallo transitorio durante construcción de la prueba nueva de symlink: el opener
rechaza con UnsafeExportError, no ValueError. Se corrigió la aserción para admitir
la excepción real y verificar también que el destino persiste. Suite final sin
errores nuevos. Logs de commit incierto y avisos de claves JWT son casos sintéticos.

## I. Archivos de este incremento

- `backend/src/models/diagnosis_discard_entities.py`: alineación estática con SQL.
- `backend/test_discard_integration74.py`: pruebas/serialización Flask real.
- `frontend/src/test/fixtures/diagnosisDiscardContract74.json`: fixture compartido.
- `frontend/src/test/diagnosisDiscardContract74.test.ts`: contrato TypeScript.
- `frontend/src/test/diagnosisReload74.test.tsx`: reproducción de limitación.
- Este informe y `backend/docs/74_mysql_pendiente.md`.

## J. Matriz de activación

| Componente | Estado | Condición pendiente |
| --- | --- | --- |
| Backend | Verificado parcialmente | Servicios/rutas aislados sí; despliegue real no. Flags False. |
| Frontend | Verificado parcialmente | Hooks/componentes sí; recuperación de recarga y navegador no. Flag apagada. |
| DDL | Verificado parcialmente | Propuesta/modelos alineados; DDL/FK reales no inspeccionados. |
| Migración | Pendiente | Sin instalación/ensayo autorizado. |
| Permisos B1 | Verificado parcialmente | Política aislada sí; aprovisionamiento autorizado pendiente. |
| Concurrencia MySQL | Bloqueado | Sin autorización/instancia acreditada; M01–M08 no ejecutados. |
| Limpieza de archivos | Verificado parcialmente | Temporales Windows sí; despliegue/caídas reales pendientes. |
| Contrato de Informes | Verificado parcialmente | Compatibilidad y transacción aisladas sí; carrera InnoDB pendiente. |
| Recuperación ante fallos | Bloqueado | Misma memoria JS sí; pérdida del UUID por recarga no resuelta. |
| Pruebas visuales | Pendiente | Sin revisión real de navegador. |

Checklist visual pendiente: ubicación discreta y distinción de validación;
paciente/visita/OD/OI correctos; selección/consentimiento vacíos; advertencia;
cancelación/Escape sin escritura; bloqueo durante envío; conflicto/incertidumbre;
scroll/footer móvil; Tab/Shift+Tab y restauración de foco al abrir/cerrar.

## K. Dictamen

Se corrigió una divergencia demostrable de metadatos técnicos respecto de la
propuesta 72. No se encontraron envelopes incompatibles ni pérdida del otro ojo
en las pruebas ejecutadas. La brecha conocida de recarga de 73 queda reproducida,
documentada y NO corregida. No se garantiza recuperación segura fuera de memoria.

**74 puede cerrarse solo como verificación parcial, no como autorización de
activación.** Faltan recuperación segura, autorización/entorno/DDL/migración y
permisos, carreras MySQL, validación de limpieza en despliegue y revisión visual.
No activar ninguna compuerta con este informe.
