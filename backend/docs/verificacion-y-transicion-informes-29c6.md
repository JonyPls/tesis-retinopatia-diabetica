# 29C.6 — Verificación y plan de transición (NO ejecutado en MySQL habitual)

## Alcance, evidencia y límite de la prueba

El maestro `backend/db/centro-oftalmologico-db-v2.sql` contiene `DROP TABLE` de
las 16 tablas. Su SHA-256 esperado es
`76CC327785A5F08667BAA1041B8E2703F2CFC10EF39D2910010055C2B6F27EDD`.
Los números de grants de los documentos 29C.2/29C.3 son históricos: el maestro
actual, tras 29C.4, tiene 7/14/6/6. No reutilizar instrucciones antiguas de
reconstrucción sin verificar esta revisión del maestro.

`b1_mysql_disposable_trial.py --run-disposable --orm-integration` crea un MySQL
8 nuevo en datadir temporal, valida `@@port`, `@@datadir`, `@@server_uuid`, versión
y ausencia previa del esquema, reconstruye dos veces y compara semillas. La
prueba SQL de 29C.2 verifica columna `revision_actual`, restricciones CHECK,
FK restrictivas, unicidades, 16 tablas, 21 permisos, 4 roles, grants y
prohibición de borrar informes/visitas con versiones; revierte el DML sintético.
La integración HTTP usa blueprints Flask reales y ORM, sin importar `app.py`,
ni conectar a `.env` ni ejecutar inferencia/PDF reales. Sus fixtures y cambios
de grants se restituyen y los fingerprints de las tablas clínicas se cotejan.

Pruebas 29C.3–29C.6: POST de visita nueva e informe en un solo commit con
`CREACION` n.º 1, dos correcciones propias (n.os 2 y 3) y anulación propia
(n.º 4), autor JWT, motivos, conclusiones, fecha, revisión clínica separada
de `schema_version`, comparación del principal con última instantánea y de
versiones anteriores antes/después. Visita cerrada no se reabre; no se crea
diagnóstico IA ni se ejecuta PDF. El GET ordinario deja de devolver el informe
anulado; el catálogo y las páginas de versiones lo mantienen. La consulta
histórica no ejecuta INSERT/UPDATE/DELETE y usa `Cache-Control: private,
no-store`.

La matriz prueba **las ocho combinaciones** de los tres booleanos de
`app.config`: `REPORTS_EDIT_ENABLED`, `REPORTS_ANNUL_ENABLED` y
`REPORTS_HISTORY_ENABLED`. Ausente, `False` y valores no booleanos no activan
la funcionalidad. Una operación desactivada deniega a autenticados con `403`
antes de consultar informes/versiones; JWT ausente o inválido produce `401`.
Las activadas conservan controles de `reports.edit_own`, `reports.annul_own` o
`reports.full_read`; un 403 con bandera activa puede significar falta de grant
o autoría. El payload deliberadamente inválido de la matriz devuelve `400`
únicamente si superó la guardia de PUT/anulación, sin modificar el informe.
DELETE permanece `403` para autenticados en todas las combinaciones.

Las pruebas previas de Flask/MySQL cubren revocaciones entre solicitudes,
administrador exclusivo, enfermería, asistencia, rol múltiple, cuentas
inactivas, editor ajeno, historial compartido, token en URL, visitas anuladas,
pacientes inactivos e informes `INACTIVO`. Dos POST de la misma visita/tipo,
dos PUT, PUT–anulación y anulación–anulación compiten en **conexiones MySQL
independientes**; se comprueba un ganador y un `409` y se verifica el estado
persistido y las versiones, no solo códigos HTTP. El bloqueo de escritura
sigue informe → visita → versiones. Se rechazan revisiones obsoletas,
historial incompleto o desalineado e informes anulados/inactivos. No se
reparan instantáneas durante un GET. Las restricciones SQL no constituyen
inmutabilidad frente a un administrador privilegiado.

Los ensayos de error cubren fallo antes/después de `flush`, fallo de inserción
de la versión, duplicados/violaciones de integridad y acuse perdido tras un
`COMMIT` confirmado. El rollback comprobado no deja escritura parcial. En
`500` posterior al inicio del commit **NO** se garantiza rollback: suspender
reintentos; consultar, con autorización, el detalle vigente si aplica,
el catálogo histórico por paciente y las páginas de versiones (incluido el
último número, motivo, fecha y autor); contrastar con la solicitud y el
registro de operación del servidor sin exponer datos en logs. Si no aparece
el informe por ID en GET vigente, puede estar anulado: consultar el catálogo.
Si el historial está deshabilitado o devuelve `409`, mantener el caso en
cuarentena para conciliación SQL supervisada, sin volver a enviar POST/PUT/
anulación ni fabricar una revisión. **No existe idempotencia persistente
completa.**

## Contratos reales y frontend

| Método/ruta | Entrada y éxito | Error / uso frontend |
|---|---|---|
| GET `/api/informes/<id>` | `200 {success,data}`: principal **ACTIVO**, `revision_actual`, `schema_version`, datos, conclusión, fechas y visita/paciente/profesional | `404` para no vigente/inexistente; solo lectura B1; origen futuro de `revision_esperada` |
| POST `/api/informes` | `paciente_id`, `tipo_informe_id`, `datos_estructurados`, `visita_id`/alias opcionales; `201 data:{id,visita_id,diagnostico_id}` | guarda secuencialmente tipos 2, 3 y 4; éxito parcial de varios POST **no** revierte los anteriores |
| PUT `/api/informes/<id>` | exactamente `{datos_estructurados,motivo,revision_esperada}`; `200 data:{id,revision_actual}` | `403` bandera/grant/propiedad; `409` revisión/estado; sin UI de escritura |
| POST `/api/informes/<id>/anulacion` | exactamente `{motivo,revision_esperada}`; `200 data:{id,estado:"ANULADO",revision_actual}` | distinta de PUT; sin UI de anulación |
| GET `/api/informes/historial/paciente/<id>` | `200 {success,data:[metadatos],pagination}` | incluye ACTIVO, ANULADO, INACTIVO; `404` paciente inexistente |
| GET `/api/informes/<id>/versiones` | `200 {success,data:{informe,versiones},pagination}`; `es_actual` marca última revisión, no `schema_version` | `404` inexistente; `409` principal/historial inconsistentes; no reparación |

Los GET históricos aceptan `page` (1–1 000 000) y `per_page` (1–50; default
10), rechazando otros parámetros con `400`; orden estable y JOIN sin N+1.
Bearer se envía en cabecera desde el Axios común; los tokens en URL se
rechazan. Las rutas pueden devolver `401` sin sesión válida, `403` para
autenticados denegados, `404` inexistente, `409` conflicto y `500` error
interno/commit incierto. PUT puede responder además `400`, `422`, `413`;
POST `400`, `409`, `422`, `500`. Los mensajes de `500` no exponen contenido.
El panel `ReportHistoryPanel` consulta el catálogo al seleccionar paciente:
si la bandera de historial está apagada muestra **acceso denegado** (`403`),
sin mostrar versiones ni cerrar sesión. No finge que el paciente carece de
informes ni interpreta `403` como `401`. Cambiar paciente desmonta el panel;
cambiar informe o página limpia el contenido y descarta/aborta respuestas
tardías. Se muestran autor acreditado o desconocido en `MIGRACION_INICIAL`,
motivo, versión elegida y aviso de no vigencia. No hay botones de escritura,
logs clínicos ni persistencia del historial en almacenamiento web.

Vitest utiliza respuestas simuladas/Axios simulado y jsdom; `Flask.test_client`
usa handlers reales y MySQL 8 real pero **no navegador**. En el repositorio
no se declararon Playwright/Cypress/Puppeteer/Selenium ni infraestructura
reproducible de E2E. No se instalarán herramientas ni se apuntará un servidor
web real al MySQL habitual para suplirlo. Las pruebas de navegador son
**pendientes**, no aprobadas por equivalencia con Vitest.

## Procedimiento propuesto para MySQL habitual — solo para aprobación

### A. Inventario y respaldo: SOLO LECTURA antes de cualquier DROP

Propietario/DBA: identificar por canal seguro el host, puerto, `@@server_uuid`,
`@@datadir`, `DATABASE()` y `@@version`, confirmar ambiente y bloquear el
acceso de prueba a cualquier esquema no autorizado. No compartir resultados
con datos personales. Desde una **sesión de solo lectura** de la BD habitual,
una vez que el propietario autorice el inventario (NO ejecutado aquí):

```sql
SELECT DATABASE(), @@version, @@port, @@server_uuid, @@datadir;
SELECT table_name FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name;
SELECT table_name, column_name, column_type, is_nullable, column_default
 FROM information_schema.columns WHERE table_schema = DATABASE()
 AND ((table_name = 'informes' AND column_name IN ('revision_actual','schema_version'))
   OR table_name = 'informes_versiones') ORDER BY table_name, ordinal_position;
SELECT COUNT(*) AS total_visitas FROM visitas_clinicas;
SELECT COUNT(*) AS total_diagnosticos FROM diagnosticos_retinopatia;
SELECT COUNT(*) AS total_informes FROM informes;
SELECT estado, COUNT(*) AS total FROM informes GROUP BY estado;
SELECT COUNT(*) AS total_pacientes FROM pacientes;
SELECT COUNT(*) AS total_usuarios FROM usuarios;
SELECT COUNT(*) AS total_roles FROM roles;
SELECT COUNT(*) AS total_permisos FROM permisos;
SELECT COUNT(*) AS total_grants FROM rol_permiso;
SELECT table_name, table_rows AS estimacion_no_exacta FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
```

Ejecutar consultas de `informes_versiones` **solo si existe**; `table_rows` es
aproximado para InnoDB. Inventariar recuentos exactos de cada tabla que se
quiera conservar, incluidas imágenes/confirmaciones y catálogos locales
presentes, y relaciones/IDs; comprobar los archivos clínicos fuera de BD
por separado sin mostrarlos ni asumir que `mysqldump` los incluye. Verificar
tipos, FK, índices y semilla mediante `information_schema` antes de decidir
una migración; no asumir igualdad de nombres/columnas entre generaciones.

**Detener primero todas las escrituras** (API, tareas, integraciones y acceso
manual), bloquear nuevas sesiones escritoras y confirmar que no quedan
transacciones/colas pendientes. Con credenciales administradas fuera de Git,
realizar un respaldo **completo de datos y estructura**, no únicamente del
maestro: por ejemplo `mysqldump` MySQL 8 de la instancia habitual con
`--single-transaction --routines --events --triggers --hex-blob --databases
<esquema_habitual>`, autenticación `-p` interactiva o mecanismo seguro
equivalente; nunca poner la contraseña en la línea de comandos ni en un
archivo versionado. Evaluar `--set-gtid-purged=OFF` según la política DBA.
Proteger y cifrar el archivo, registrar tamaño/hash/fecha/UUID/posición de
recuperación según política local, respaldar además el maestro y los
adjuntos fuera de BD, verificar lectura del dump y **restaurarlo en una
instancia separada** para comprobar recuentos, FK, grants/cuentas necesarias,
autenticación y datos de muestra sintéticos o verificados por el custodio.
Un dump del esquema aislado NO respalda registros creados por la aplicación;
el maestro contiene semillas, no la actividad clínica real. No avanzar si la
restauración o el plan de rollback no se han ensayado.

### B. Elección explícita (no equivalentes)

**Opción 1, limpieza de desarrollo:** solo si el propietario acredita y
aprueba por escrito que se pueden descartar **todos** los datos ajenos a
semillas (incluidas visitas/diagnósticos/informes, cuentas y configuraciones
locales). Con respaldo restaurable y ventana sin escritores, verificar el
SHA-256 del archivo local, la identidad del servidor y la BD seleccionada en
HeidiSQL; revisar el script completo y su `CREATE DATABASE`/`USE` antes de
iniciarlo. Ejecutar el maestro exclusivamente tras autorización expresa, NO
en esta fase. Comprobar 16 tablas, 21 permisos, 4 roles, grants 7/14/6/6,
`revision_actual`, FK/CHECK y unicidades; desplegar backend compatible y,
solo en ambiente autorizado para pruebas, crear una visita/informe sintéticos
y comprobar versión 1, autor y contenido. Limpiar el fixture mediante
procedimiento aprobado (las FK restrictivas impiden borrados automáticos).
No llamar a esto conservación de datos.

**Opción 2, preservación:** NO ejecutar el maestro con `DROP TABLE` sobre la
BD con datos. Obtener inventario real de versiones, diferencias de esquema y
FK; diseñar y aprobar una migración de estructura, roles y **todos** los
datos/catálogos necesarios con mapeo de IDs y claves externas, sin asumir que
la semilla sustituye los registros existentes. Ensayar respaldos y el plan
en una **copia aislada restaurada**, con escritores detenidos durante el
corte. Para cada informe previo, registrar su estado conocido en
`MIGRACION_INICIAL` n.º 1 (autor de operación `NULL` si no está acreditado),
`revision_actual=1` solo conforme al plan de conservación, sin inventar
correcciones históricas; comparar contenido, conclusión, estado, formato,
visita y creador con el principal. Reconciliar cardinalidades, IDs, FK,
permisos y archivos externos; ensayar la misma migración con rollback en
copia. Ninguna migración conservadora se entrega ni se autoriza aquí.

### C. Corte, controles y reversión

1. Aprobar opción, restauración ensayada, responsables, ventana, acceso y
   aceptación de pérdida de datos (si opción 1). **Congelar POST** y todos
   los demás escritores; dejar historial/PUT/anulación sin activar.
2. Respaldar MySQL habitual, fuera de Git, con los escritores suspendidos;
   registrar y comprobar hash del dump, del maestro y el UUID del servidor.
   Si falla identidad, respaldo, hash o copia restaurable, **cancelar**.
3. Ejecutar únicamente la estrategia aprobada en la instancia previamente
   identificada; impedir que un backend antiguo escriba en el esquema nuevo
   y que el backend nuevo lea el antiguo. En HeidiSQL seleccionar la conexión
   correcta por host/puerto/UUID y esquema, revisar advertencias de `DROP`,
   verificar encoding y ejecución íntegra; nunca usar "ejecutar script" sobre
   MySQL habitual sin la aprobación independiente para este paso.
4. Antes de reanudar POST, desplegar backend que inserta `CREACION` en el
   mismo commit, cotejar 16 tablas, `revision_actual`, versiones, restricciones,
   21 permisos, 4 roles y grants 7/14/6/6; comprobar exclusividad de
   `informes.anular` en OFTALMOLOGO y cero grants de
   `informes.inactivar`. Consultar el total de informes frente a versiones,
   comprobar ausencia de versiones huérfanas, versiones n.º 1 válidas,
   secuencias 1..`revision_actual` y última instantánea congruente; no
   corregir discrepancias mediante GET ni con un backfill automático.
5. Confirmar con un ensayo seguro permitido por el propietario que POST
   crea exactamente una visita/informe/versión 1 juntos; si no se admiten
   fixtures en habitual, mantener escrituras suspendidas y efectuar esa
   comprobación en copia restaurada **de la misma versión**. Evaluar roles
   efectivos, JWT, GET ordinario y catálogo, cabeceras, revocación, banderas
   desactivadas, DELETE `403` y duplicados/rollback antes de habilitar tráficos.
   Si falla una sola comprobación: **no reanudar**; parar servicios, preservar
   evidencias, y restaurar backup completo y adjuntos con el procedimiento
   DBA ensayado. Un DDL MySQL tiene commits implícitos: `ROLLBACK` SQL no
   deshace una ejecución parcial del maestro.
6. Conciliar eventos inciertos con detalle/historial autorizado, sin reintento
   de escrituras. Sólo entonces reanudar POST y monitorizar informes sin
   versión 1. Mantener escritor antiguo desconectado del esquema actualizado.

Consultas de **solo lectura**, para esquema actualizado y después de obtener
autorización, que no muestran datos clínicos completos:

```sql
SELECT COUNT(*) AS informes_sin_version_inicial FROM informes i
 LEFT JOIN informes_versiones v ON v.informe_id=i.id AND v.numero_version=1
 WHERE v.id IS NULL OR v.operacion NOT IN ('CREACION','MIGRACION_INICIAL');
SELECT COUNT(*) AS revisiones_incompletas FROM informes i
 LEFT JOIN (SELECT informe_id, COUNT(*) AS n, MIN(numero_version) AS primero,
                   MAX(numero_version) AS ultimo FROM informes_versiones
            GROUP BY informe_id) v ON v.informe_id=i.id
 WHERE v.n IS NULL OR v.n<>i.revision_actual OR v.primero<>1
    OR v.ultimo<>i.revision_actual;
SELECT COUNT(*) AS instantaneas_finales_distintas FROM informes i
 LEFT JOIN informes_versiones v ON v.informe_id=i.id
                                  AND v.numero_version=i.revision_actual
 WHERE v.id IS NULL OR NOT (v.estado <=> i.estado)
    OR NOT (v.schema_version <=> i.schema_version)
    OR NOT (v.conclusion <=> i.conclusion)
    OR NOT (v.datos_estructurados <=> i.datos_estructurados);
SELECT COUNT(*) AS versiones_huerfanas FROM informes_versiones v
 LEFT JOIN informes i ON i.id=v.informe_id WHERE i.id IS NULL;
SELECT r.codigo, COUNT(*) AS grants FROM rol_permiso rp
 JOIN roles r ON r.id=rp.rol_id GROUP BY r.codigo ORDER BY r.codigo;
SELECT r.codigo, p.codigo FROM rol_permiso rp JOIN roles r ON r.id=rp.rol_id
 JOIN permisos p ON p.id=rp.permiso_id
 WHERE p.codigo IN ('informes.anular','informes.inactivar') ORDER BY p.codigo, r.codigo;
```

Los recuentos de inconsistencias/orfandad deben ser **cero** antes de activar
funciones; conservar los resultados, examinar por separado casos afectados
en acceso autorizado, y cancelar el corte si difieren del inventario.

### D. Activación gradual, por aprobación independiente

1. POST versionado tras esquema y conciliación, bajo observación.
2. `REPORTS_HISTORY_ENABLED` booleano `True` solo tras verificar GET,
   políticas B1 y contratos/caché; inicio por consulta de un paciente ficticio
   autorizado. Al desactivarla vuelve `403`, nunca `401` si el token es válido.
3. `REPORTS_EDIT_ENABLED` booleano `True` **por separado**, tras prueba
   clínica manual de revisión esperada, motivo, autoría, conflicto y rollback.
4. `REPORTS_ANNUL_ENABLED` booleano `True` **por separado**, tras prueba de
   estado, motivo, autoría y visibilidad no vigente. No activar por leer grants.

La reversión de banderas es inmediata desde configuración supervisada;
**no** deshace correcciones/anulaciones ya confirmadas. DELETE, inactivación
y edición ajena siguen bloqueadas/no implementadas. Evitar retención/purga
automática hasta política institucional.

## Comprobación manual de interfaz tras actualización autorizada

En un navegador real contra frontend/backend **del entorno coordinado y
verificado**, con cuenta oftalmológica ficticia autorizada: seleccionar
paciente ficticio, constatar listado ordinario solo ACTIVO y catálogo histórico
separado; abrir revisiones 1..N y alternar instantáneas (motivo, autor, fecha,
conclusión de cada una); comprobar aviso ANULADO/INACTIVO y
`MIGRACION_INICIAL` sin autor acreditado cuando corresponda. Pasar a otro
paciente/informe mientras la red retrasa la respuesta anterior y comprobar
que desaparece el contenido previo. Deshabilitar historial de forma
controlada y confirmar `403`/mensaje de acceso denegado **sin cerrar sesión**;
sesión expirada `401`, cambio de grants `403`, recurso inexistente `404` y
historial inconsistente `409`. Comprobar cabeceras `private, no-store`, ausencia
de JWT en URL, almacenamiento y consola clínica; confirmar ningún botón de
edición/anulación activo. Formularios 2/3/4 y POST secuencial conservados,
sin repetir automáticamente el segundo POST tras fallo o commit incierto.
No realizar esta comprobación contra MySQL habitual antiguo.

## Riesgos sin resolver

Hay **16 `expectedFailure` históricos** en `backend/test_auth_security.py`,
todos sobre rutas aisladas que conservan lógica legacy; no son pruebas
aprobatorias de los endpoints B1 reales. Su inventario y vigencia:

| Prueba (`test_…`) | Brecha legacy; control B1 que sigue importando |
|---|---|
| `a1_clinical_read_role_should_not_grant_delete` | Leer no debe dar DELETE; DELETE B1 sigue bloqueado. |
| `b1_clinical_role_without_patient_read_permission_is_denied` | Rol solo eludía grant; B1 pacientes exige `pacientes.ver`. |
| `b1_oftalmologist_without_diagnosis_create_permission_is_denied` | Rol solo eludía permiso IA; B1 exige grant. |
| `b1_validation_requires_medically_enabled_ophthalmologist` | Rol Médico genérico accedía; B1 validación limita rol. |
| `b1_administrator_has_no_automatic_medical_validation` | Administrador eludía autorización médica; B1 separa ámbito. |
| `b1_manager_has_no_automatic_clinical_access` | Gerente antiguo figuraba en `ADMIN_ROLES`; B1 no hereda jerarquía. |
| `b1_multiple_roles_without_medical_validation_permission_are_denied` | Multirrol eludía grant médico; B1 comprueba procedencia. |
| `b1_general_read_permission_cannot_bypass_delete` | `clinico.ver`/comodín legacy eludía DELETE; B1 lo bloquea. |
| `b1_report_read_permission_does_not_authorize_inactivation` | Leer informe no inactiva; B1 DELETE bloqueado. |
| `b1_permission_revocation_with_issued_jwt_is_enforced` | Revocación antigua eludida por rol; B1 consulta grants vigentes. |
| `b1_admin_with_admin_permissions_cannot_create_diagnosis` | Admin legacy podía crear IA; B1 deniega. |
| `b1_assistant_cannot_create_report_even_if_stale_grant_exists` | Grant heredado eludía rol; B1 restringe POST. |
| `b1_assistant_cannot_validate_even_with_legacy_grant` | Grant legacy eludía rol; B1 restringe validación IA. |
| `b1_history_requires_report_reading_for_full_response` | Historial compuesto antiguo permitía menos grants; B1 exige política completa. |
| `b1_pdf_with_images_requires_image_reading` | PDF antiguo omitía `imagenes.ver`; B1 exige ambos. |
| `b1_indirect_visit_without_visit_create_permission_is_denied` | POST antiguo creaba visita sin grant; B1 exige `visitas.crear` en visita nueva. |

Son objetivos de seguridad todavía relevantes para accesos legacy aislados,
pero las rutas B1 reales tienen pruebas independientes que pasan. No borrar
ni declarar resueltos estos 16 fallos esperados. ESLint continúa bloqueado por configuración preexistente
(`eslint.config.js`, propiedad `recommended` indefinida): no se corrigió.
No hay E2E de navegador aprobado. Retención institucional, recuperación
automatizada de commits inciertos e idempotencia persistente, modificación SQL
privilegiada, guardado secuencial parcialmente confirmado y conciliación de
datos heredados siguen pendientes. No se activó PUT, anulación, historial,
DELETE, inactivación ni edición ajena en MySQL habitual.
