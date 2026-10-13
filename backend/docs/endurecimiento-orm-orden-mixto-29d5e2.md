# 29D.5E.2 — endurecimiento ORM y orden mixto (no despliegue)

## Autorización temporal

El ensayo MySQL 8 desechable reprodujo la reutilización de `_verified_utc_fields` tras un `flush`: una asignación manual posterior a `fecha_visita` conservaba `UTC_VERIFICADO`. El permiso ahora corresponde a un **campo y valor generados por `set_verified_utc`**; un listener de atributo lo anula ante cualquier asignación posterior, incluso si se asigna el mismo valor. `before_insert`/`before_update` comprueban sesión UTC, consumen el permiso por operación y exigen correspondencia entre valor y marca. Un rollback tras el flush no recupera el permiso: reintentar exige generar de nuevo el instante y su acreditación. Los defaults automáticos `fecha_creado`/`fecha_actualizado` y el default SQL UTC de `fecha_operacion` siguen sujetos a la sesión Flask UTC. Esta protección no es una barrera contra código Python que manipule directamente el estado privado de una instancia ORM, ni contra SQL ajeno al mapper.

## Política de lectura

En listados de visitas e informes: instantes `UTC_VERIFICADO` primero, descendentes por fecha acreditada con ID único como desempate; fechas `NO_VERIFICADO` después, en orden operativo descendente por ID. Las versiones mantienen `numero_version`. Los agregados de pacientes solo devuelven `ultima_visita` si hay visita acreditada; `visitas_sin_fecha_verificada` anuncia que existen históricos consultables sin pretender que su `MAX(fecha_visita)` sea el último instante. La búsqueda mantiene prioridad textual antes de agrupar temporalmente y pagina con ID como último criterio. Los listados administrativos sin fecha acreditada usan ID operativo. La línea temporal y el selector de informes conservan los históricos; el filtro de fecha civil solo restringe instantes acreditados e informa que los ambiguos siguen visibles. React no usa `new Date` de fechas ambiguas para decidir orden ni duración de comparaciones clínicas. El botón «última visita acreditada» no afirma antigüedad clínica de históricos.

## Límites de los escritores

| Modalidad de escritura | Motor UTC Flask | Hook de mapper | Resultado y política |
| --- | --- | --- | --- |
| ORM INSERT normal, UPDATE normal o parcial | Sí | Sí | Nuevos defaults/onupdate UTC acreditados; fecha explícita solo se acredita con `set_verified_utc`; sin permiso, queda `NO_VERIFICADO`. |
| ORM fecha manual, sin cambio efectivo, expiración o dos flush/commits | Sí | Sí cuando hay DML | Permiso por campo/valor consumido tras el flush; la siguiente fecha manual queda `NO_VERIFICADO`; un no-op no prueba una nueva fecha. |
| Rollback y reintento | Sí | Sí al reescribir | Rollback tras flush no revalida permiso; nuevo `set_verified_utc` acredita el reintento. |
| `session.execute(update(...))` / `Query.update` | Sí | No | Es posible conservar falsamente `UTC_VERIFICADO`; prohibir para fechas clínicas. |
| `Connection.execute(update(...))` / `exec_driver_sql` | Sí | No | Misma vulnerabilidad; no interpretar sesión UTC como procedencia de la fila. |
| SQL textual desde ORM o PyMySQL directo | Según conexión | No | Escritura directa insegura incluso con sesión UTC; PyMySQL no hereda el checkout del motor Flask. Prohibir. |
| `ON UPDATE CURRENT_TIMESTAMP` de MySQL | Según conexión | No | Puede modificar `fecha_actualizado` conservando marcador anterior; la prueba lo forzó y revirtió. |
| PyMySQL con sesión no UTC | No | No | Una fecha nueva puede estar desplazada y conservar `UTC_VERIFICADO`; prohibir. |
| Promoción de marcador sin fecha nueva / marcador inválido | Sí | Sí / CHECK MySQL | La promoción ORM se rechaza y el CHECK rechaza valores inválidos; no protege el SQL directo con marcador válido. |
| Transacción fallida | Depende | Depende | Rollback íntegro en los ensayos; un commit ambiguo exige conciliación antes de reintentar. |

Los eventos de mapper no se ejecutan en `session.execute(update(...))`, `Query.update`, `Connection.execute(update(...))`, `exec_driver_sql` ni PyMySQL directo. El checkout UTC de un motor Flask **no** añade procedencia a estas escrituras. El `ON UPDATE CURRENT_TIMESTAMP` del maestro puede cambiar `fecha_actualizado` con el marcador anterior intacto; un `UPDATE` sin cambio efectivo no modifica la fecha. Las pruebas reproducen los bypass en transacciones revertidas. No se agregaron triggers, cuentas, grants, columnas ni índices. El backend habitual sigue configurado como `root@localhost`; su segregación y mínimo privilegio pertenecen a 29D.5E.3, antes de plantear 29D.5F. No ejecutar la aplicación actualizada sobre MySQL habitual.

29D.5F necesita respaldo posterior a 29D.3 y restauración comprobada, inventario de escritores y corte conjunto autorizado; las tres filas antiguas deben recibir `NO_VERIFICADO` sin conversión de fechas. Revisar `EXPLAIN` en volumen representativo antes de decidir índices; los ensayos sintéticos no acreditan rendimiento de producción ni sustituyen E2E de navegador.
