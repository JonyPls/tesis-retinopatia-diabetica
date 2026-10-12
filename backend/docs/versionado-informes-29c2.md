# 29C.2 — Estructura persistente del historial clínico de informes

## Alcance y estado

El maestro MySQL 8 incorpora `informes.revision_actual BIGINT UNSIGNED NOT NULL
DEFAULT 1` (`ck_informes_revision`) y una tabla nueva `informes_versiones`.
`revision_actual` es la revisión **clínica**; `schema_version` sigue designando
la versión del esquema JSON del tipo de examen y **no** registra revisiones.
Ninguna de las dos columnas acredita por sí sola la existencia de historial.
El maestro anterior no contenía informes semilla; las versiones comienzan vacías.
Las 15 tablas previas, 21 permisos, cuatro roles, grants 7/13/6/6, semillas y
`uq_informes_visita_tipo` permanecen. El maestro reconstruido tiene 16 tablas.

Cada fila de `informes_versiones` contiene `informe_id`, `numero_version`,
`operacion`, una instantánea completa de `schema_version`, `datos_estructurados`,
`conclusion` y `estado`, más `autor_operacion_id`, `fecha_operacion` y `motivo`.
No duplica identidades ni imágenes: paciente, visita y creador original siguen
resolviéndose a través del informe principal. `UNIQUE(informe_id, numero_version)`
permite recuperar una secuencia ordenada. `CREACION` representa una futura
instantánea inicial real (autor obligatorio, versión 1, motivo opcional);
`MIGRACION_INICIAL` representa exclusivamente el estado **conocido al corte**
de un registro previo (versión 1; puede no conocerse el actor de migración).
No se reconstruyen ediciones que nunca quedaron almacenadas. `CORRECCION`,
`ANULACION` e `INACTIVACION` exigen autor y motivo no compuesto solo por
espacios en blanco; el permiso y la operación funcional se habilitarán en
fases posteriores. No se concedieron `informes.anular` ni
`informes.inactivar` ni se habilitaron PUT/DELETE.

Las FK del historial son `ON UPDATE RESTRICT ON DELETE RESTRICT` hacia
`informes.id BIGINT UNSIGNED` y `usuarios.id INT UNSIGNED`. En MySQL 8
desechable se comprobó que, con historial existente, se rechaza tanto un
`DELETE informes` directo como un `DELETE visitas_clinicas` que intenta
activar el `ON DELETE CASCADE` previo de `informes.visita_id`; no hizo falta
cambiar esa FK. También se conservaron las FK restrictivas hacia tipo y
creador, y la unicidad visita/tipo sin depender del estado. Las pruebas usan
datos sintéticos y hacen rollback. Una cuenta SQL con facultad de borrar
primero el historial sigue pudiendo destruirlo: las FK no son inmutabilidad
criptográfica ni sustituyen control de privilegios y política de retención;
no hay purga automática mientras esa política no se apruebe.

## Despliegue y reconstrucción

**No aplicar todavía el maestro al MySQL habitual.** Contiene `DROP TABLE`
y está ignorado por Git. Antes de cualquier reconstrucción habitual, el
propietario debe crear y verificar por separado respaldos del maestro y de la
base real; planificar la exportación/restitución de datos mediante un
procedimiento aprobado y comprobar el SQL final. La instancia desechable
reconstruye dos veces verificando datadir, puerto, UUID y base. `informes_versiones`
se crea después de `informes` y se elimina antes en el maestro.

El ORM nuevo **no es compatible** con el esquema habitual antiguo: los SELECT
de `Informe` esperan `revision_actual`. A la inversa, el POST 29B sobre el
maestro nuevo continúa creando informes `revision_actual=1` **sin versión
inicial**. No desplegar ORM y SQL por separado ni habilitar escrituras clínicas
habituales sobre este esquema hasta integrar 29C.3. El orden recomendado es:
preparar y probar 29C.3 fuera de producción; planificar ventana de mantenimiento
sin POST; respaldar y verificar; actualizar esquema y hacer corte conservador de
informes preexistentes con una única `MIGRACION_INICIAL` por registro;
desplegar simultáneamente código que cree `CREACION` en la misma transacción
del POST; conciliar número de informes, revisiones y versiones antes de
reanudar escrituras. No introducir migraciones incrementales automáticas en
el proceso habitual de HeidiSQL ni ejecutar el maestro sobre datos existentes
sin un plan explícito de restauración.

El esquema no garantiza por sí mismo que cada `revision_actual` tenga una
instantánea equivalente ni que los datos de la versión sean idénticos a los
del principal. 29C.3 debe establecer esa consistencia mediante la transacción
de creación; las fases de edición/anulación deben hacerlo en cada cambio. La
política aprobada permite corregir informes activos propios de visita activa
o cerrada con motivo (sin reabrirla), y rechaza visita anulada; ninguna ruta de
escritura nueva ni consulta HTTP del historial existe todavía.
