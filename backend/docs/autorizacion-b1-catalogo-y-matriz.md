# B1: catálogo canónico y matriz de autorización (cinco rutas activadas)

Referencia de estructura y códigos sembrados: `backend/db/centro-oftalmologico-db-v2.sql`.
El script v2 y la instancia MySQL pueden diferir; esta matriz no verifica grants
reales ni sustituye una revisión autorizada de catálogo/roles en la instancia.
Los decoradores actuales siguen en `backend/routes/` y `backend/utils/security.py`.
La propuesta separada de grants esta en
`backend/migrations/b1_grants_roles_propuesta.sql`; sus precondiciones, respaldo
y prueba desechable se detallan en `backend/docs/autorizacion-b1-transicion-grants.md`.

## Códigos y semántica

| Código canónico | Origen | Alcance propuesto |
| --- | --- | --- |
| `pacientes.ver`, `pacientes.crear`, `visitas.ver` | SQL v2 | Lectura/alta de pacientes y lectura de visitas. |
| `diagnostico_retinopatia.crear`, `diagnostico_retinopatia.validar` | SQL v2 | Procesar IA y validar médicamente: operaciones distintas. |
| `diagnostico_retinopatia.ver` | Nuevo: migración B1 propuesta | Leer diagnósticos IA. |
| `imagenes.ver` | Nuevo: migración B1 propuesta | Leer retinografías/Grad-CAM. |
| `informes.ver`, `informes.crear`, `informes.editar`, `informes.anular` | SQL v2 | Leer, crear, editar y anular: funciones diferentes. |
| `informes.inactivar` | Nuevo: migración B1 propuesta | Baja lógica a `INACTIVO` del DELETE actual; no es anulación clínica. |

`informes.editar_ajenos` es un **código nuevo pendiente de aprobación**, NO
incluido en la migración B1. Una edición ajena requiere además autoría y
auditoría; los informes finalizados no deben modificarse silenciosamente.
No existe endpoint para `informes.anular`: tampoco debe tratarse como alias del
DELETE que inactiva. `pacientes.editar`, `visitas.crear`, `dashboard.ver`,
`usuarios.ver`, `usuarios.crear`, `usuarios.editar`,
`usuarios.asignar_roles` y `configuracion.ver` figuran en SQL v2, pero no hay
rutas clínicas independientes que los exijan como tales. Las visitas se crean hoy
desde los flujos de diagnóstico o informe.

**Desajustes actuales:** Flask usa `diagnosticos.ver/crear/validar/gestionar`,
`informes.eliminar/gestionar` y `pacientes.gestionar`, distintos o ausentes en
SQL v2. `clinico.ver`, `clinico.leer`, `clinico.acceder`,
`clinico.gestionar` y `clinico.*` son requisitos generales en el decorador
actual, no concesiones mínimas aceptables para la futura política.
La nomenclatura de este documento no cambia su funcionamiento actual.

## Roles y convención de la matriz

`O` = `OFTALMOLOGO`; `E` = `ENFERMERO`; `S` =
`ASISTENTE_ADMINISTRATIVO` (los códigos sembrados en SQL v2). Cada rol indicado
debe estar **activo y habilitado para la operación**, además de contar con
**todos** los permisos unidos por `+`. Su presencia sola nunca concede acceso.
Estos son `roles.codigo`, propuestos como identificadores estables; `Usuario.roles`
devuelve actualmente `roles.nombre` y las comprobaciones frontend/backend usan
nombres literales. La transición futura debe incorporar códigos del usuario
activo sin romper el contrato de nombres hasta adaptar clientes y tests; no se
deben inferir códigos desde textos/acento. E y S solo acceden a tareas
asistenciales/operativas autorizadas. El rol
`ADMINISTRADOR_SISTEMA` no concede acceso clínico por jerarquía; una cuenta
multirrol necesita habilitación y permiso clínicos de procedencia válida.
`GERENTE` no es un rol sembrado en v2 y no adquiere capacidad clínica automática.
La consulta clínica compartida permite al O autorizado leer **todos** los
pacientes: no existe vínculo exclusivo paciente-profesional.

### Perfiles propuestos y grants heredados

| Perfil | Grants mínimos para las funciones aprobadas | Permitido / denegado |
| --- | --- | --- |
| `ADMINISTRADOR_SISTEMA` (administrativo) | Semilla v2: conservar `dashboard.ver`, `configuracion.ver`, `usuarios.ver/crear/editar/asignar_roles` (códigos concretos) y `catalogos.gestionar`; retirar los once grants clínicos detallados en la propuesta SQL. | Puede administrar cuentas y privilegios administrativos ajenos cuando exista API segura. No diagnostica, valida ni gestiona informes por la sola jerarquía. Dashboard actual consulta pacientes: resolver esa dependencia antes del corte estricto. |
| Gerente (rol **futuro**, sin seed) | Permisos de cuentas operativas delegables **por definir**; no asignar ni crear el rol aquí. | Gestión de trabajadores/especialistas dentro de una lista autorizada; no crea administradores/gerentes, no se autoeleva y no adquiere facultades clínicas automáticamente. |
| `OFTALMOLOGO` (médico habilitado) | Lectura compartida: `pacientes.ver`, `visitas.ver`, `informes.ver`, `diagnostico_retinopatia.ver` [nuevo] e `imagenes.ver` [nuevo]. Mantener `diagnostico_retinopatia.crear` y `diagnostico_retinopatia.validar` como facultades separadas y expresas. | Consulta historiales de TODOS los pacientes; crea/valida solo cuando conserva cada permiso médico y la habilitación profesional correspondiente. `informes.editar` permite editar propios con autoría; ajenos requiere autorización especial y auditoría. No recibe `informes.inactivar` automáticamente. |
| `ENFERMERO` (asistencial) | Conservar semilla de `pacientes.ver/crear`, `visitas.ver/crear` e `informes.ver` según tarea; sin grants nuevos automáticos. | Apoyo asistencial aprobado. No valida IA ni edita/inactiva informes por defecto. |
| `ASISTENTE_ADMINISTRATIVO` (operativo) | Conservar `pacientes.ver/crear/editar`, `visitas.ver`, `informes.ver` según alcance aprobado; **retirar `informes.crear`**. | Puede registrar pacientes y, cuando exista endpoint apropiado, actualizar SOLO campos administrativos. No crea/edita/valida informes clínicos ni valida IA. `pacientes.editar` por sí solo no separa campos clínicos: falta autorización por campo/API. |

Si una persona es administrador **y** oftalmólogo, las facultades médicas deben
provenir de su rol y habilitación clínica vigentes, no de los grants del rol
administrativo. Los permisos individuales heredados/concedidos/denegados son
una fase posterior: este documento no implementa `usuario_permiso`.

**Salvo las cinco rutas de pacientes marcadas como activas**, las filas
siguientes están pendientes de implementación: sus permisos no se exigen hoy
con la semántica estricta. Los códigos marcados `[nuevo]` no
están sembrados en v2. `+` representa AND; `o` representa OR explícito solo
donde se indica. Las precondiciones incluyen cuenta activa y JWT válido.

| Método y ruta actual | Operación / dominio | Permiso(s) canónico(s) | Roles propuestos | Condición especial y estado |
| --- | --- | --- | --- | --- |
| GET `/api/pacientes` | Listar / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección según grant del rol; sin asignación médica exclusiva. |
| POST `/api/pacientes` | Registrar / pacientes | `pacientes.crear` | O, E, S | Activa B1; entrada según procedencia del grant de creación y salida según lectura independiente. |
| GET `/api/pacientes/<int:id>` | Detalle / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección según rol y grant vigente, 404 si no existe. |
| GET `/api/diagnosticos/paciente/<int:id>` | Historial / compuesto | `pacientes.ver` + `visitas.ver` + `diagnostico_retinopatia.ver` [nuevo] + `informes.ver` | O; E/S solo si habilitados para **todo** el contenido | La respuesta actual contiene IA e informes; alternativa: filtrar secciones por permiso. Pendiente de decisión. |
| GET `/api/pacientes/<int:id>/visitas` | Historial / compuesto | `pacientes.ver` + `visitas.ver` + `diagnostico_retinopatia.ver` [nuevo] + `informes.ver` | O; E/S solo si habilitados para **todo** el contenido | Misma respuesta compuesta que la fila anterior; pendiente de decisión. |
| GET `/api/pacientes/buscar` | Buscar / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección por rol. S no recibe última visita ni orden clínico. |
| GET `/api/pacientes/recientes` | Recientes / pacientes | `pacientes.ver` | O, E, S | Activa B1; S recibe altas recientes, no visitas recientes ni fecha de visita. |
| GET `/api/documentos` | Tipos de documento / catálogo | `pacientes.ver` | O, E, S | Catálogo para registro de pacientes; pendiente. |
| POST `/api/diagnosticar` | Crear IA / diagnósticos | `diagnostico_retinopatia.crear` | O | No equivale a validación médica; pendiente. |
| GET `/api/diagnosticar/visita/<int:visita_id>/detalles` | Leer IA / diagnósticos | `diagnostico_retinopatia.ver` [nuevo] | O | Datos por ojo; pendiente. |
| GET `/api/diagnosticar/diagnostico/<int:diagnostico_id>/detalles` | Leer IA / diagnósticos | `diagnostico_retinopatia.ver` [nuevo] | O | Datos por ojo; pendiente. |
| GET `/api/visitas/<int:visita_id>/reporte-diagnostico` | Descargar PDF / compuesto | `pacientes.ver` + `diagnostico_retinopatia.ver` [nuevo] + `imagenes.ver` [nuevo] | O | Incluye identidad, predicción, decisión e imágenes; pendiente de decisión contractual. |
| GET `/api/diagnosticar/retinografo/auto-seleccion/<int:paciente_id>` | Seleccionar exportadas / imágenes | `pacientes.ver` + `imagenes.ver` [nuevo] | O; E si autorizado | Consulta, no ejecuta la inferencia; pendiente. |
| GET `/api/diagnosticar/retinografo/imagen` | Descargar exportada / imágenes | `imagenes.ver` [nuevo] | O; E si autorizado | Solo archivo correspondiente al paciente; pendiente. |
| PUT `/api/diagnosticar/detalle/<int:detalle_id>/validar` | Validar / diagnóstico IA | `diagnostico_retinopatia.validar` | O con habilitación médica | Procedencia clínica obligatoria incluso en multirrol; pendiente. |
| GET `/api/tipos-informe` | Leer tipos / catálogo informes | `informes.ver` **o** `informes.crear` | O, E, S según tarea | Solo catálogo; alternativa OR pendiente de confirmación. |
| POST `/api/informes` | Registrar / informes | `informes.crear` | O | Ni asistente ni enfermero crean informes oftalmológicos por defecto. Si crea visita, verificar dependencia de `visitas.crear` antes del corte; pendiente. |
| GET `/api/informes/<int:informe_id>` | Leer / informes | `informes.ver` | O, E, S según tarea | Todos los especialistas O con lectura ven informes de todos los pacientes; pendiente. |
| PUT `/api/informes/<int:informe_id>` | Editar / informes | `informes.editar` | O | **Propio:** comparar `informes.usuario_id`; **ajeno:** requiere permiso especial nuevo pendiente y auditoría. Finalizados: impedir edición silenciosa. Pendiente. |
| DELETE `/api/informes/<int:informe_id>` | Inactivar / informes | `informes.inactivar` [nuevo] | O con habilitación específica | Baja lógica `INACTIVO`, NO anulación; autoría/trazabilidad pendientes. |
| GET `/api/informes/paciente/<int:paciente_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | Lectura compartida sujeta a permiso; pendiente. |
| GET `/api/informes/visita/<int:visita_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | No basta `visitas.ver` por sí solo; pendiente. |
| GET `/api/informes/diagnostico/<int:diagnostico_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | El servicio actual interpreta el ID como visita; pendiente. |
| GET `/uploads/retinas/<path:filename>` | Ver archivo protegido / imágenes | `imagenes.ver` [nuevo] | O; E si autorizado | Conservar comprobación de archivo registrado; pendiente. |

`POST /api/login` y `GET /` no son rutas clínicas protegidas. No existe hoy
endpoint para anular clínicamente un informe: cuando se implemente debe usar
`informes.anular`, con estado y trazabilidad propios, no `informes.inactivar`.

## Alcance de búsqueda B1 y delegación futura

Las dos rutas B1 de búsqueda previamente activadas (`/api/pacientes/buscar` y
`/api/pacientes/recientes`) devuelven solo identidad/documento al
`ASISTENTE_ADMINISTRATIVO` autorizado. No incluyen `ultima_visita` para ese
alcance y ordenan por alta del paciente, no por atención. Oftalmólogo y
enfermero con grant vigente mantienen la fecha de última visita para su
consulta clínica/asistencial. La respuesta se proyecta según la procedencia
del permiso del rol activo del servidor, no según el JWT o datos del cliente.
No se añaden datos de contacto a estos resultados breves: siguen pendientes
las vistas/operaciones administrativas limitadas a campos para gestionarlos.

**Backlog HU-11/HU-12 (sin implementación):** el asistente podrá registrar
solicitudes de alta de trabajadores, incluidos oftalmólogos, siempre en
estado pendiente de aprobación. El gerente o administrador activará cuentas
según sus competencias; la habilitación médica exige verificar credenciales
profesionales. El asistente no podrá asignar roles médicos o administrativos
privilegiados ni activar cuentas pendientes. Las funciones delegadas se
resolverán en el futuro modelo híbrido de permisos individuales, sin crear
ahora un rol Gerente ni permisos o tablas adicionales.

**Siguiente prioridad de minimización:** (1) GET
`/api/pacientes/<id>/visitas` y GET `/api/diagnosticos/paciente/<id>`
incluyen IA, imágenes referenciadas e informes completos; (2) listados y
detalles de `/api/informes/*`, PDF diagnóstico y archivos protegidos pueden
exponer clínica según su decorador antiguo. Evaluar individualmente tanto
la autorización como la proyección antes de activar B1 en cada ruta: minimizar
solo estas cinco rutas no protege el resto del sistema.

## Activación del listado y detalle (Prompt 18)

Rutas reales: `GET /api/pacientes` y `GET /api/pacientes/<int:id>`.
Ambas usan `patients.read` (`pacientes.ver` de un rol O/E/S habilitante
y activo), sin segundo `token_required`. `ADMINISTRADOR_SISTEMA` solo no
habilita la lectura. No hay filtro de propietario: el oftalmólogo autorizado
consulta también a pacientes registrados por otros profesionales. El alcance
se recalcula por procedencia del grant en **cada petición**, sin usar claims
de rol, parámetros del cliente o caché persistente.

**Inventario anterior** (claves `data`, sin anidamientos): el listado devolvía
`id`, `tipo_doc_abrev`, `tipo_doc_id`, `nro_documento`, `nombres`, `apellidos`,
`sexo`, `fecha_nacimiento`, `telefono`, `correo`, `direccion`,
`antecedentes_clinicos`, `alergias`, `consentimiento_informado`,
`fecha_consentimiento`, `ultima_visita` y `maxima_gravedad`.
El detalle devolvía `id`, `tipo_doc_abrev`, `tipo_doc_id`, `tipo_doc`,
`nro_documento`, `nombres`, `apellidos`, `sexo`, `fecha_nacimiento`,
`telefono`, `correo`, `direccion`, `antecedentes_clinicos`, `alergias`,
`consentimiento_informado` y `fecha_consentimiento`. Identidad: documento,
nombre, sexo y nacimiento; contacto: teléfono, correo y dirección;
`antecedentes_clinicos` y `alergias` son clínicos; consentimiento de atención
es sensible (no se presupone administrativo); `ultima_visita` es asistencial
y `maxima_gravedad` es resultado clínico IA. Ninguna de estas dos respuestas
incluía objetos anidados, pero la proyección rechaza estructuras en claves
permitidas y descarta campos extra aunque el servicio los añadiese.

**Proyección nueva** (`data` conserva lista/objeto, `success` y HTTP; se añade
`scope` y en detalle `history_available` como indicación de UI, nunca como
autorización del endpoint de visitas):

| Perfil habilitado | Listado (`data[]`) | Detalle (`data`) |
| --- | --- | --- |
| Asistente | Identidad, sexo/nacimiento y contacto, sin consentimiento ni visitas | Los mismos + `tipo_doc`; sin antecedentes, alergias, diagnósticos, informes, imágenes ni historial |
| Enfermero | Campos del asistente + consentimiento y `ultima_visita`; sin gravedad IA | Campos del asistente + consentimiento y alergias; sin antecedentes ni datos de visitas/IA/informes |
| Oftalmólogo | Campos del enfermero + `maxima_gravedad` solo si su rol habilita `diagnosis.read` | Campos del enfermero + antecedentes y alergias |
| Administrador solo | 403 | 403 |
| Administrador + Oftalmólogo habilitado | Alcance del oftalmólogo, sin combinar grants administrativos | Alcance del oftalmólogo |

`ultima_visita` deriva del join de visitas solo para E/O; el join de IA se
realiza únicamente cuando el oftalmólogo tiene grant de lectura IA vigente.
Para el asistente ninguna de las dos consultas toca tablas clínicas; listar
y detallar cuestan cada una **4 SELECT** (3 autenticación/autorización + 1
handler) en todos los perfiles probados, sin N+1. Búsqueda/recientes conservan
5/4 SELECT respectivamente. El listado sigue ordenado por `p.id DESC` y la
paginación actual del listado es del cliente; el detalle conserva 404. Los
formularios de alta no se modifican; la pantalla del listado oculta columnas
clínicas no disponibles y el perfil solo solicita visitas cuando el backend
indica alcance clínico + permiso compuesto `history.full_read`. La UI no
sustituye la protección del endpoint heredado de visitas.

## Registro de pacientes B1 (Prompt 19)

Antes, POST usaba `@token_required` +
`@clinical_access_required('pacientes.crear', 'pacientes.gestionar')`. El
servicio tomaba `tipo_doc`, `nro_documento`, `nombres`, `apellidos`, `sexo`,
`fecha_nacimiento`, `telefono`, `correo`, `direccion`,
`antecedentes_clinicos`, `alergias` y `consentimiento_informado`, ignorando
otras claves. Generaba `tipo_doc_id` desde catálogo, `fecha_consentimiento`,
ID, estado y fechas de registro; tras insertar leía el detalle **clínico** y
lo devolvía completo en `data`. Se conservan 201 (`success`, `message`,
`data`), 400 para entradas inválidas y 409 por duplicado.

POST exige ahora `patients.create`: JWT y cuenta activos más
`pacientes.crear` vigente aportado por rol O/E/S habilitante, sin bypass del
administrador. El alcance de creación se evalúa por procedencia válida en
cada petición, independiente de `patient_read_scope`.

| Perfil creador | Claves de entrada admitidas | Claves prohibidas |
| --- | --- | --- |
| Asistente | `tipo_doc`, `nro_documento`, `nombres`, `apellidos`, `sexo`, `fecha_nacimiento`, `telefono`, `correo`, `direccion`, `consentimiento_informado` | Antecedentes, alergias, IA, visitas, imágenes, campos derivados y cualquier clave desconocida |
| Enfermero | Las del asistente + `alergias` | Antecedentes, IA, visitas, imágenes y campos derivados |
| Oftalmólogo | Las del enfermero + `antecedentes_clinicos` | IA, visitas, imágenes y campos derivados |
| Administrador solo | Ninguna (403) | La jerarquía no sustituye la habilitación clínica |

Las claves prohibidas se rechazan con 400 **aunque sean nulas o vacías**, antes
de consultas o escrituras del servicio. Tampoco se aceptan estructuras
anidadas, arrays, alias, claves desconocidas ni tipos inesperados. Solo el
booleano explícito `consentimiento_informado` satisface la validación previa:
el formulario lo identifica como **constancia del formulario físico firmado y
archivado**, necesaria para el alta, no como permiso para consultar contenido
clínico. El servidor no inventa dicha constancia. La clasificación definitiva
de esa constancia para el asistente requiere confirmación institucional; si no
es parte de su labor, habrá que rediseñar la precondición de alta antes de
retirársela. `fecha_consentimiento`, `tipo_doc_id`, ID, estados y fechas los
genera el sistema, no son entradas admitidas.

La respuesta 201 se proyecta según **`pacientes.ver` independiente**: lector
asistente recibe identidad/contacto sin consentimiento; lector enfermero suma
consentimiento y alergias; lector oftalmólogo suma antecedentes. Si solo hay
permiso de crear y no de leer, `data` contiene **únicamente el ID** y se evita
la consulta de detalle. Ni el grant de creación ni el de un rol no habilitante
elevan el alcance de respuesta. El callback frontend usa solo ID y la identidad
introducida por el propio usuario, sin reenviar datos clínicos.

En MySQL 8 desechable, POST con lectura usa **6 SELECT** (tres de
autenticación/autorización, catálogo de documento, comprobación de duplicado y
lectura de detalle) y un INSERT, sin N+1. Crear sin lectura omite el SELECT de
detalle. Rechazos por autorización o por campos no permitidos no escriben.
El arnés valida aislamiento y reversión de los grants de su instancia temporal;
no se modificaron scripts SQL B1 ni MySQL habitual.

Sigue pendiente la transición autorizada de `diagnostico_retinopatia.ver` en
la BD habitual: su ausencia omite `maxima_gravedad` del listado médico y
deja `history_available=false`. No se implementa bypass ni se activan rutas
de historial, diagnóstico, PDF o imágenes en este bloque.

## Dependencias antes de activar B1

1. Autorizar comprobación de catálogo/grants en instancia v2 y aplicar la
   migración de **catálogo** únicamente tras verificar precondiciones. Después,
   aplicar, si se aprueba, la propuesta de grants en una operación **separada**;
   la migración de catálogo no los concede. Confirmar que administrador/gerente no heredan
   validación médica solo por jerarquía.
2. Elegir respuesta completa con permisos combinados o filtrado por secciones
   para los historiales; confirmar requisitos de PDF e imágenes. Evitar bloqueo
   de oftalmólogos por los tres permisos nuevos sin grants.
3. Definir edición propia/ajena, estado de finalización, auditoría y si
   `visitas.crear` debe exigirse cuando POST informes crea una visita.
4. Sustituir el bypass central por cuenta activa + rol habilitante **y** permiso
   vigente; revisar también todos los decoradores y comodines. No añadir
   excepciones por rol ni transformar `informes.anular` en baja lógica.
5. Probar perfiles sintéticos con Flask aislado, luego integración sobre datos
   ficticios autorizados; preservar la lectura compartida y denegar escrituras
   sin permiso. Solo después cambiar la semántica de A1-DELETE-PERMISSION.
