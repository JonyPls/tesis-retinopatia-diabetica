# 29C.5 — Lectura B1 y visualización de versiones de informes

## Contratos HTTP

Ambas rutas requieren Bearer y la política B1 `reports.full_read`: cuenta y
rol `OFTALMOLOGO` activos, `informes.ver` vigente concedido desde ese rol.
La lectura es compartida entre oftalmólogos; no exige ser el autor. Los grants
de otros roles, administración, enfermería, asistencia y permisos legacy no
amplían este acceso. La comprobación general precede a cualquier lectura de
informe/paciente. Las respuestas, incluidos errores controlados, llevan
`Cache-Control: private, no-store`.

- `GET /api/informes/historial/paciente/<paciente_id>?page=1&per_page=10`
  devuelve `success`, `data: []` y `pagination: {page, per_page, total,
  has_more}`. Cada entrada incluye `id`, tipo, visita, fecha/estado de visita,
  `usuario_id`, `autor_original: {id, nombres, apellidos}`, `estado`,
  `revision_actual`, `fecha_creado`, `fecha_actualizado`. **No incluye datos
  estructurados, conclusión ni versiones.** No filtra por estado de informe,
  visita o paciente: permite localizar `ACTIVO`, `ANULADO` e `INACTIVO` incluso
  en visitas anuladas o pacientes inactivos; `404` si el paciente no existe.
  El orden es fecha de creación descendente e ID descendente. Los GET
  ordinarios de paciente/visita siguen mostrando solo informes `ACTIVO`.
- `GET /api/informes/<informe_id>/versiones?page=1&per_page=10` devuelve
  `data: {informe: {id, paciente_id, visita_id, fecha_visita, estado_visita,
  tipo_informe_id, tipo_informe_nombre, usuario_id, estado,
  revision_actual}, versiones: [...]}` y `pagination` al nivel superior. La
  lista va por `numero_version` ascendente; cada instantánea incluye
  `operacion`, `estado`, `schema_version`, `datos_estructurados`, `conclusion`,
  `autor_operacion_id`, `autor_operacion` (identidad mínima o `null`),
  `fecha_operacion`, `motivo` y `es_actual`. Para `MIGRACION_INICIAL` con autor
  nulo se señala **autor histórico no acreditado**; no se le atribuye una
  creación que no fue observada. No se repara ni se reconstruye historia.

Solo se aceptan `page` y `per_page` como enteros decimales positivos sin
ceros iniciales, no duplicados: `page <= 1 000 000`, `per_page <= 50`;
defaults 1 y 10. Parámetros inválidos: `400`, antes de datos clínicos.
Informe inexistente: `404`. Si no existe versión 1, falta secuencia, no
coinciden revisión/estado/contenido/schema con la última instantánea o no es
una inicial válida, el detalle histórico devuelve `409` sin revelar el
contenido, ni ejecutar backfill. Fallo de dependencia no identificado: `500`
sin SQL ni datos privados. La ruta es de solo lectura y no utiliza `FOR UPDATE`
ni commits; las lecturas comparten la vista coherente de la transacción InnoDB
(`REPEATABLE READ`) en MySQL 8. Un catálogo es solo descubrimiento: la
consistencia de instantáneas se comprueba al consultar versiones.

La paginación se acota y las identidades se obtienen mediante JOIN, sin una
consulta por informe/versión. La búsqueda por paciente aprovecha
`idx_visitas_paciente_fecha` y la FK indexada de `informes.visita_id`; el
detalle de versiones aprovecha `uq_informes_versiones_informe_numero`.
La ordenación por fecha de creación del informe podría necesitar optimización
si el volumen real aumenta; no se añadieron índices al maestro.

## Frontend y transición

En el paso de selección de paciente de `ClinicalReports`, un panel separado
muestra el catálogo y permite seleccionar un informe y su revisión. Indica
claramente la revisión clínica, la versión del formato JSON, estados no
vigentes, motivo, autor de la operación y contenido **de la instantánea
seleccionada**, no una conclusión sobrescrita por otra revisión. Cambiar de
paciente desmonta el panel; cambiar informe o página limpia inmediatamente
los datos previos y aborta/descarta respuestas tardías. El cliente Axios
existente envía JWT solo en Bearer; no hay almacenamiento ni logs clínicos,
ni botones para PUT, anulación o DELETE. Errores 401/403/404/409/500 se
muestran con mensajes seguros; el interceptor existente gestiona 401, nunca
cierra sesión por un 403. Vitest comprueba el componente con HTTP simulado;
no sustituye una prueba E2E en navegador.
El hook existente de informes descarta asimismo respuestas tardías de visitas
y listados vigentes cuando se cambia o limpia el paciente/visita, evitando
atribuir recursos de una selección anterior a la nueva.

`REPORTS_HISTORY_ENABLED` debe ser exactamente el booleano `True` en
`app.config` para habilitar **ambos** GET: por defecto JWT inválido da `401`
y autenticado `403`, sin consultar recursos clínicos. Ni esta bandera habilita
`REPORTS_EDIT_ENABLED` / `REPORTS_ANNUL_ENABLED`, ni estas habilitan el
historial; DELETE continúa bloqueado. Las 24 rutas B1 anteriores permanecen
activas por defecto; hay cuatro rutas de informes registradas con activación
explícita (PUT, anulación, dos GET históricos), más DELETE registrado pero
bloqueado. No se añadieron permisos, grants, tablas ni columnas.

**No conectar frontend/backend nuevo a MySQL habitual antiguo.** El maestro
de 16 tablas sigue incluyendo `DROP TABLE`: antes de usar HeidiSQL se requiere
ventana sin escritores, respaldo de MySQL habitual, decisión aprobada sobre
preservación y ensayo aislado de migración/restauración de datos. Reconstruir
no conserva datos fuera de la semilla. Conciliar informes preexistentes con
instantáneas `MIGRACION_INICIAL` conservadoras, verificar 16 tablas, 21
permisos y grants 7/14/6/6, desplegar POST compatible, comprobar que cada
creación genera versión 1; **solo después** autorizar y activar lectura
histórica. PUT y anulación requieren autorizaciones de activación separadas.
No se hizo transición ni acceso a la BD habitual.

Siguen pendientes la política institucional de retención, un plan de
conciliación por commits inciertos de escritura y las pruebas E2E en
navegador. Las FK y comprobaciones funcionales no vuelven criptográficamente
inmutables las filas frente a una cuenta SQL privilegiada.
