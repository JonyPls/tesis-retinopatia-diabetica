# 29C.3 — Creación versionada y corrección propia bajo activación explícita

## Comportamiento implementado

`POST /api/informes` mantiene las políticas B1 `reports.create` y
`reports.create_with_visit`, la validación clínica estructural de 29B y su
respuesta `201` (`id`, `visita_id`, `diagnostico_id` como alias de visita). Tras
insertar y hacer `flush` de `informes`, el repositorio refresca el principal
desde MySQL e inserta la instantánea `informes_versiones` número 1, operación
`CREACION`, autor JWT y contenido, conclusión, estado y `schema_version`
efectivamente persistidos. Visita nueva, informe y versión comparten **una
única transacción/commit**. La ausencia de tabla/columna o el fallo de inserción
no degrada a informes sin historial: retorna error controlado y se intenta
rollback. Después de intentar commit una excepción puede significar resultado
incierto: no se reintenta automáticamente ni se afirma que no haya persistido.

El `GET /api/informes/<id>` autorizado añade `revision_actual` sin retirar
ninguna propiedad previa; `schema_version` sigue siendo la versión del esquema
JSON, no el número de revisión clínica. No se expone el historial por HTTP.

La ruta registrada `PUT /api/informes/<id>` exige
`app.config['REPORTS_EDIT_ENABLED'] is True`. **Sin esta configuración
explícita su valor efectivo es deshabilitado**: JWT/cuenta inválidos `401`,
cualquier autenticado `403` antes de leer el informe o escribirlo. No se
lee una variable de entorno como activación implícita. `DELETE` permanece
denegado independientemente de esta configuración. Solo después del cambio
coordinado de esquema y las comprobaciones de producción autorizadas podrá
el propietario establecer la bandera en la configuración de la aplicación;
este cambio **no** modifica configuración productiva.

Con la bandera activada, la autorización B1 `reports.edit_own` exige JWT
Bearer, usuario y rol `OFTALMOLOGO` activos, y `informes.editar` vigente en
ese rol. El guard comprueba esos grants **antes** del primer SELECT clínico,
obtiene el informe `SELECT FOR UPDATE` y exige
`informes.usuario_id == usuario autenticado`; la transacción y el bloqueo
permanecen en la misma sesión hasta finalizar el servicio. Ningún grant de
otro rol, administración, `informes.gestionar` ni permisos legacy sustituyen
este control. El autor original no cambia. El bloqueo de visita sigue al del
informe en un orden estable: **informe → visita → última versión**; evita
editar mientras cambia el estado de la visita. Se aceptan informes `ACTIVO`
de visitas `ACTIVA` y `CERRADA` (corrección documental posterior, sin reabrir
ni alterar visita o diagnóstico IA); visita `ANULADA` e informe `INACTIVO` o
`ANULADO` dan conflicto. No se puede editar un informe sin versión inicial o
con historial desalineado; no se inventa una `MIGRACION_INICIAL` al editar.

El cuerpo JSON de PUT contiene **exactamente** `datos_estructurados`, `motivo`
y `revision_esperada`. La revisión es entero positivo no booleano; el motivo
es texto de 1–1000 caracteres, no solo espacios; los datos reutilizan la
validación estructural 29B, sin introducir reglas médicas. Se rechazan campos
superiores de autor, vínculo, estado, fechas y versión, y claves internas
falsificadas. `conclusion` se extrae de los datos conforme al procedimiento
anterior. `revision_esperada` debe igualar `informes.revision_actual`, que se
incrementa exactamente una vez. El repositorio actualiza y refresca el
principal antes de insertar en la **misma transacción** una instantánea
completa `CORRECCION` con su nuevo número, motivo y autor de la operación.
Las filas históricas no se actualizan ni eliminan.

Errores: `400` envelope/motivo/revisión inválidos, `401` sesión inválida,
`403` permiso o autoría insuficiente / bandera desactivada, `404` informe
inexistente, `409` estado, historia o revisión obsoletos, `422` datos
estructurados incompatibles y `500` fallo interno o resultado de commit
incierto. No se devuelven SQL, detalles de otros pacientes ni trazas. Un
`409` requiere recargar el detalle y obtener una revisión nueva. Una
respuesta perdida tras commit requiere conciliación; no hay idempotencia
persistente ni reintentos automáticos. No hay UI de edición todavía.

## Transición del MySQL habitual (NO ejecutada en esta fase)

1. Revisar con el propietario los resultados de MySQL 8 aislado y definir
   explícitamente si se deben conservar informes y otros datos históricos.
2. Planificar una ventana **sin ningún escritor clínico**, incluyendo POST de
   informes, y respaldar/validar tanto el maestro ignorado por Git como la BD
   habitual. El ORM nuevo falla contra el esquema antiguo; no desplegarlo
   antes de coordinar el cambio.
3. Con autorización del propietario, preparar una estrategia aprobada de
   migración y restauración **antes** de usar HeidiSQL: el maestro de 16 tablas
   contiene `DROP TABLE` y elimina registros no presentes en la semilla.
   Reconstruir y preservar los datos previos **no son la misma operación**.
   Si se necesita conservarlos, no ejecutar el maestro hasta validar en
   instancia aislada la exportación, reimportación, identidad de FK y captura
   conservadora del estado conocido como `MIGRACION_INICIAL` (sin inventar
   autores ni operaciones pasadas). Esta fase no entrega una migración de datos.
4. Solo tras ese plan, reconstruir en HeidiSQL bajo control del propietario,
   verificar 16 tablas, `revision_actual`, versiones, FK/CHECK, 21 permisos,
   cuatro roles, grants 7/13/6/6 y unicidad visita–tipo. Restaurar y conciliar
   datos históricos aprobados **antes** de reanudar escrituras.
5. Desplegar en la misma ventana el backend compatible, con PUT **todavía
   deshabilitado**. Validar autorizadamente que una creación deja versión 1
   coincidente (o usar pruebas aisladas antes de producción). No reanudar POST
   hasta haber verificado creación atómica y reconciliación de informes previos.
6. Únicamente tras verificar esquema, historial, grants, rollback y controles
   B1, el propietario puede activar `REPORTS_EDIT_ENABLED=True` en la
   configuración supervisada del servidor. Comprobar además que DELETE siga
   bloqueado. La bandera no sustituye la revisión funcional ni la política de
   retención.

El frontend guarda tipos mediante POST secuenciales: un fallo posterior no
revierte los éxitos previos. Las versiones no son criptográficamente
inmutables ante una cuenta SQL privilegiada. Anulación (29C.4), inactivación,
edición ajena, consulta HTTP del historial y política institucional de
retención continúan fuera de esta fase.
