# 29C.4 — Anulación clínica versionada de informes

`POST /api/informes/<int:informe_id>/anulacion` recibe exclusivamente JSON
`{"motivo": "razón clínica", "revision_esperada": 2}`. La revisión es un entero
positivo no booleano leído previamente del detalle autorizado. El motivo es
texto obligatorio (máximo 1000 caracteres; se eliminan espacios exteriores);
no se admiten campos de contenido, autor, fechas, vínculo, estado o revisión
establecidos por el cliente. Éxito `200` devuelve `data: {id, estado:
"ANULADO", revision_actual}`; no devuelve contenido clínico ni historial.

La política B1 `reports.annul_own` requiere Bearer válido, usuario y rol
`OFTALMOLOGO` activos y `informes.anular` vigente **en ese mismo rol**. El
permiso no se combina con grants de otros roles, ni se sustituye por
`informes.editar` o `informes.gestionar`. Antes de leer el informe por ID se
comprueban los grants; se obtiene el principal con `SELECT FOR UPDATE` y se
comprueba `informes.usuario_id == identidad JWT`. Administración y otros
profesionales no reciben autoridad sobre informes ajenos.

`REPORTS_ANNUL_ENABLED` exige el valor booleano `True` en `app.config` y está
desactivado por defecto. Con la bandera desactivada: `401` para autenticación
inválida, `403` para autenticados, sin SELECT por ID ni escrituras. Es
independiente de `REPORTS_EDIT_ENABLED`; `DELETE` permanece bloqueado, sin
activar `informes.inactivar`. La semilla del maestro añade **solo** el grant
preexistente `informes.anular` al rol `OFTALMOLOGO`: 16 tablas, 21 permisos,
cuatro roles, grants 7/14/6/6. El maestro no se ejecutó en MySQL habitual.

En una sola transacción se bloquea **informe → visita → versiones**; se
permite únicamente `ACTIVO` en visita `ACTIVA` o `CERRADA`, con revisión
coincidente e historial íntegro. Una visita `ANULADA` se rechaza por política
conservadora, pendiente de revisión institucional si fuera necesaria otra
conducta. No se altera ninguna visita, diagnóstico IA, PDF ni otro informe.
Después del control de integridad compartido con PUT, el principal pasa a
`ANULADO`, incrementa una sola vez la revisión y se inserta una instantánea
completa `ANULACION`: mismo contenido, conclusión y `schema_version` ya
persistidos, estado nuevo, autor JWT, fecha de servidor y motivo. Hay un
solo `commit`; no se actualizan las versiones anteriores ni el autor original.
Un informe sin versión inicial o inconsistente devuelve `409` y requiere
conciliación autorizada, **no** reparación automática. El informe anulado no
aparece en GET individual ni en los listados de informes vigentes; las filas
históricas se conservan en SQL hasta disponer de historial HTTP autorizado.

Respuestas: `400` solicitud/motivo/revisión inválidos; `401` autenticación;
`403` permiso, autoría o activación; `404` informe inexistente; `409` estado,
historial o revisión incompatible; `500` fallo interno o commit incierto. Se
intenta rollback tras errores, pero perder el acuse de `COMMIT` no demuestra
que MySQL haya revertido; no hay reintentos automáticos ni idempotencia. Dos
operaciones que compiten con la misma revisión se serializan mediante bloqueo
InnoDB: a lo sumo una confirma y la otra recibe `409`.

## Transición coordinada (pendiente de autorización)

1. Revisar pruebas con el propietario. Mantener **detenidos todos los POST y
   demás escritores clínicos** durante el cambio; nunca apuntar el backend
   nuevo al esquema habitual antiguo.
2. Respaldar y verificar la BD habitual, y decidir **antes de HeidiSQL** si
   se preservarán informes y otros datos existentes. El maestro incluye
   `DROP TABLE`: reconstruir **elimina** registros fuera de la semilla. Una
   migración conservadora y su ensayo aislado requieren aprobación separada.
3. Solo con autorización, reconstruir mediante HeidiSQL y comprobar las 16
   tablas, restricciones, columna `revision_actual`, versiones, 21 permisos y
   grants 7/14/6/6. Restaurar y conciliar datos históricos autorizados sin
   fabricar operaciones previas; verificar que los informes preexistentes
   poseen historia inicial coherente antes de habilitar corrección/anulación.
4. Desplegar coordinadamente el backend que crea `CREACION` en POST;
   mantener **ambas** banderas de edición y anulación desactivadas. Comprobar
   atomicidad y una versión 1 por creación antes de reanudar escrituras.
5. Tras validar roles, revocación, transacciones y visibilidad, solicitar
   autorización explícita para activar `REPORTS_ANNUL_ENABLED=True` y, por
   separado, `REPORTS_EDIT_ENABLED=True`. Comprobar que DELETE aún devuelve
   `403` a autenticados. No asignar `informes.inactivar`.

Persisten pendientes un historial HTTP autorizado, su interfaz, inactivación
separada y una política institucional de retención. Ni CHECK ni FK impiden
que una cuenta SQL privilegiada altere manualmente las versiones.
