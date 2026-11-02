# 72 — Backend de descarte IA (preparado, NO activado)

No se ejecutó esta migración sobre MySQL. No se aprovisionaron permisos. No hay
interfaz nueva. No importar `app.py` para ejecutar pruebas: precarga CLIP y usa
la configuración habitual. Las pruebas de este incremento construyen Flask y
SQLite en memoria explícitamente y usan imágenes sintéticas en TemporaryDirectory.

## Compuertas

`app.py` establece en False (sin activación por variables de entorno):

- `DIAGNOSIS_DISCARD_ENABLED`
- `DIAGNOSIS_DISCARD_SCHEMA_VERIFIED`
- `DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY`

Además se requiere `DIAGNOSIS_DISCARD_STORAGE_ROOT`: ruta absoluta idéntica a la
raíz de escritura y a la servida por HTTP (`backend/uploads/retinas`). No hay
fallback de ruta. Arrancar con otro cwd bloquea el descarte, no limpia otro árbol.
La raíz y sus ancestros deben estar protegidos contra escritores ajenos del SO.

Con ENABLED=False, inferencia e informes no consultan la extensión. No se añade
ninguna columna ni relación cargable a VisitaClinica. No hay create_all al arrancar.
Con ENABLED=True pero sin esquema/contrato verificado, se rechaza sin escribir
clínica. Las tablas ausentes producen error controlado, nunca omisión de barrera.

Todos los procesos deben actualizarse, detener/drainar inferencias antiguas y
activar coordinadamente. Nunca mezclar procesos con la bandera apagada y encendida:
un escritor antiguo no ejecuta la barrera. No desactivar durante solicitudes.

## API nueva

Ambas rutas requieren la regla estricta `diagnosis.discard_pending`: OFTALMOLOGO
activo, grants exactos desde ese rol de pacientes.ver, visitas.ver,
diagnostico_retinopatia.ver, imagenes.ver y
diagnostico_retinopatia.descartar_pendiente. El servicio verifica propietario y
relaciones bajo lock. No se conceden grants. No se reutiliza crear/validar.

GET `/api/diagnosticar/visita/{id}/contexto-descarte?operacion_id={UUID}`

Devuelve visita/paciente, estado, ID real de diagnóstico o null, revisión,
detalles (ID, ojo, estado, elegible y bloqueo), operación confirmada si existe.
Sin URLs, rutas de almacenamiento, probabilidades ni motivos médicos.
Una operación ausente significa NO_CONFIRMADA: podría haber otra petición en
curso; NO demuestra rollback. Una visita vacía tampoco demuestra un descarte.
La lectura bloquea visita para una instantánea consistente y termina con rollback.

GET `/api/diagnosticar/visita/{id}/operaciones-descarte/{UUID}` consulta solo una
operación del autor actual. Permite conciliar incluso si otro profesional creó
después un diagnóstico en esa visita; no devuelve detalles de ese diagnóstico.

POST `/api/diagnosticar/visita/{id}/descartar-resultados`

```json
{"paciente_id":7,"diagnostico_retinopatia_id":9,"detalle_ids":[12],
 "revision_esperada":0,"operacion_id":"11111111-1111-4111-8111-111111111111",
 "confirmo_descarte":true}
```

Máximo 4096 bytes, IDs positivos, uno/dos IDs distintos, UUID canónico y true
explícito. Campos desconocidos/aliases/rutas se rechazan. Lote atómico. El orden
de IDs no cambia la identidad canónica de solicitud. Mismo UUID/autor/contenido
devuelve el resultado original; otro contenido devuelve 409. Un UUID diferente
nunca se redirige a nuevos detalles del mismo ojo.

Éxito: `success/data` con operacion_id, persistencia=CONFIRMADA, resultado
(visita, IDs descartados/restantes, padre restante o null, estado, revisión),
limpieza=PENDIENTE y fecha_utc. No se borra filesystem durante la petición.
400: estructura; 401/403: autorización/flag; 409: estado/revisión/dependencias;
503: instalación, almacenamiento o persistencia incierta. Siempre private/no-store.
Ante PERSISTENCIA_INCIERTA consultar el mismo UUID; no crear uno nuevo ni reintentar
ciegamente. No hay reintentos automáticos de escrituras clínicas.

## Elegibilidad e invariantes

Visita ACTIVA, creador del padre, padre/detalles consistentes. Seleccionados:
PENDIENTE, resultado_final/validado_por/fecha_validacion null, comentario/motivo
null o cadena vacía; sin comprobante vinculado y sin informe de ningún estado en
la visita. Se rechazan padres anulados/vacíos/inconsistentes y ojos duplicados.
Otros detalles pueden estar validados o provenir del retinógrafo: se preservan.
Se consulta FK de comprobante en backend; nunca se modifica comprobante/copia/hash.

Antes del DELETE se inspeccionan FK entrantes: solo se admiten las relaciones
conocidas RESTRICT/NO ACTION. Se rechazan triggers en las dos tablas objetivo
en MySQL y referencias entrantes desde otros esquemas. La cuenta de inspección
debe tener visibilidad suficiente; esto NO sustituye la inspección autorizada
previa del DDL y escritores.
La función no protege contra un operador privilegiado alterando el esquema
durante la transacción ni contra escrituras SQL que omitan los protocolos.

DELETE exacto de detalles, flush y nueva lectura bloqueante; padre PROCESADO si
queda pendiente, VALIDADO si todos los restantes están consistentemente validados,
DELETE explícito del padre si vacío. Nunca se elimina/actualiza estado de visita.
La extensión de revisión se conserva por visita, incluso si ya no existe padre.

## Concurrencia e Informes

Orden: visita -> diagnóstico -> detalles. No bloquear comprobantes después de
visita (retinógrafo ya usa confirmación -> visita -> diagnóstico -> detalle).
La validación mantiene diagnóstico -> detalle y no adquiere después visita.
Los lectores abandonan snapshot RR de autenticación antes de locks clínicos.
El descarte serializa sobre visita y padre con procesamiento y sobre padre con
PUT. FK/PK son última defensa; cualquier fallo hace rollback del lote completo.

Inferencia captura revisión antes de los modelos, libera transacción y comprueba
revisión bajo lock de visita antes de insertar. Descarte incrementa revisión en
la misma transacción que operación y DELETE. No se mantiene lock durante modelos.

Con capacidad habilitada, creación de informes con visita existente exige
`revision_inferencia_esperada` (entero) en el nivel superior de POST /api/informes.
Debe venir de la instantánea mostrada al usuario, no de una consulta automática
inmediatamente antes de guardar. Backend bloquea visita y compara revisión antes
de crear informe. Si informe confirma primero, descarte ve el informe; si descarte
confirma primero, formulario antiguo recibe 409. Informes que crean visita propia
no tienen evidencia previa que descartar. No se modifica contenido/versionado.

Prompt 73 debe enviar esta revisión en Informes antes de activar READY; también
debe tratar un 403 de descarte como permiso adicional, no expulsión del módulo.
No hay cambio frontend en 72. Referencias copiadas a otro informe/PDF externo no
son detectables por el modelo actual. No hay revocación de PDFs ya descargados.

Para obtener la revisión al abrir el formulario existe GET
`/api/visitas/{id}/revision-inferencia`, también opt-in, con la regla
`reports.inference_context`: OFTALMOLOGO y grants informes.crear, pacientes.ver,
visitas.ver desde su rol. No exige permiso de descarte ni propiedad del diagnóstico
(los informes mantienen su acceso clínico compartido). Devuelve solo visita,
paciente y revision_inferencia, no evidencia ni operaciones ajenas. Capturar al
mostrar el contexto, no refrescar/reintentar silenciosamente después de un 409.

## Limpieza recuperable

`OperacionDescarteIA` es un manifiesto técnico, no historial clínico: UUID, autor,
visita, solicitud canónica, resultado operativo y nombres/identidades de archivos.
No FK a padre/detalles eliminados. No guarda fotografías, predicciones o copias.
La FK a visita es RESTRICT. Mantener registros para idempotencia y conciliación;
no purgarlos ni resetear/reutilizar IDs sin un procedimiento posterior aprobado.

La tarea se confirma atómicamente con DELETE/revisión. Una lectura nueva tras
commit verifica la tarea antes de limpiar. Reintento explícito de una operación:

`flask --app app diagnosis_discard limpiar --operacion-id UUID --confirmar`

NO ejecutarlo en habitual ahora. Cargar app precarga modelos: el comando no hace
inferencia, pero debe ejecutarse solo en despliegue autorizado. No añade servidor.
El comando conserva las tres compuertas. Para listar pendientes se usa la tabla
técnica en mantenimiento autorizado; no hay endpoint HTTP de borrado de archivos.

Revalida raíz, nombre FINAL_NAME, ausencia de referencias en TODOS los detalles,
archivo regular/no hardlinks, device/inode/tamaño/mtime. Windows elimina por el
mismo handle con DELETE y OPEN_REPARSE_POINT; POSIX usa directorios O_NOFOLLOW y
unlink relativo. Exige raíz sin escritores no confiables. Nunca usa glob de
paciente/ojo, rutas del cliente ni cleanup de creación. Ausencia es idempotente;
identidad cambiada/referencia compartida queda CONFLICTO; error IO queda PENDIENTE.
Un crash tras unlink y antes de commit deja manifiesto reintentable. Un archivo
ausente al descartar no autoriza eliminar otro aparecido después (identidad null).
Operaciones fallidas/commit ambiguo nunca invocan limpieza. No se promete atomicidad
SQL/filesystem ni recuperación de copias externas.

## Instalación futura y reversión

1. Mantener flags apagados. Respaldar y verificar DDL real en esquema autorizado:
   InnoDB, tipos/signo FK, unicidad por visita/ojo, IDs no reutilizables, FK entrantes
   y triggers. Revisar y adaptar tipos del SQL propuesto; no ejecutar maestro.
2. Ensayar `72_descarte_ia_propuesta.sql` en base aislada expresamente autorizada.
   No fue ejecutado aquí. No añadir columnas a tablas clínicas.
3. Aprovisionar catálogo/grant específico SOLO con aprobación; no hay SQL de grants.
4. Integrar Prompt 73 y contrato de revisión de Informes. Probar carreras reales
   MySQL RR, caídas y filesystem del despliegue. SQLite no acredita FOR UPDATE.
5. Actualizar y drenar todos los procesos; configurar raíz y las compuertas en
   despliegue explícito. Verificar lectura autorizada antes de permitir descarte.
6. Reversión: detener escrituras nuevas y drenar solicitudes; apagar flags en todos
   los procesos. Conservar tablas/manifiestos y respaldos, NO ejecutar DROP ni
   restaurar resultados por compensación. Las limpiezas pendientes requieren
   mantenimiento controlado; no se borran tablas con trabajo o conciliación pendiente.

## Verificación de este incremento

- `test_diagnosis_discard`: 33 pruebas aisladas correctas.
- `test_auth_security`: 119 ejecutadas, 16 expected failures ya declarados.
- Almacenamiento de diagnóstico/retinógrafo/copia privada y dashboard: 27 correctas.
- Fechas clínicas/validadores de imagen con modelos sustituidos: 7 correctas.
- Validación de configuración: 7 correctas; registro de pacientes: 10 correctas.
- AST de los 13 archivos Python afectados y git diff --check correctos.

Estos conjuntos se ejecutan en procesos separados para aislar los stubs de módulos
de las pruebas existentes. No se ejecutó b1_orm_mysql_trial.py ni otro ensayo MySQL.
Las carreras se cubren mediante órdenes intercalados y servicios reales sobre
SQLite, no con una afirmación de FOR UPDATE multiproceso en MySQL. Esa verificación,
el DDL real y el contrato frontend siguen siendo bloqueos de activación.
