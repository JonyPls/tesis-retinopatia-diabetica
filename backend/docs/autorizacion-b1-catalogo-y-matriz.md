# B1: catálogo canónico y matriz de autorización (doce rutas activadas)

Referencia de estructura y códigos sembrados: `backend/db/centro-oftalmologico-db-v2.sql`.
Desde Prompt 21 ese maestro contiene directamente el catálogo y grants B1;
`[nuevo]` en las filas siguientes significa nuevo respecto a la semilla v2
**histórica**, no ausente del maestro actual. Ver `autorizacion-b1-maestro.md`.
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

**Salvo las doce rutas B1 marcadas como activas**, las filas
siguientes están pendientes de implementación: sus permisos no se exigen hoy
con la semántica estricta. Los códigos marcados `[nuevo]` faltaban en el v2
histórico, pero están sembrados en el maestro B1. `+` representa AND; `o` representa OR explícito solo
donde se indica. Las precondiciones incluyen cuenta activa y JWT válido.

| Método y ruta actual | Operación / dominio | Permiso(s) canónico(s) | Roles propuestos | Condición especial y estado |
| --- | --- | --- | --- | --- |
| GET `/api/pacientes` | Listar / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección según grant del rol; sin asignación médica exclusiva. |
| POST `/api/pacientes` | Registrar / pacientes | `pacientes.crear` | O, E, S | Activa B1; entrada según procedencia del grant de creación y salida según lectura independiente. |
| GET `/api/pacientes/<int:id>` | Detalle / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección según rol y grant vigente, 404 si no existe. |
| GET `/api/diagnosticos/paciente/<int:id>` | Historial / compuesto | `pacientes.ver` + `visitas.ver` + `diagnostico_retinopatia.ver` + `informes.ver` + `imagenes.ver` | O | Activa B1: misma respuesta compuesta que `/visitas`; incluye referencias de imágenes. |
| GET `/api/pacientes/<int:id>/visitas` | Historial / compuesto | `pacientes.ver` + `visitas.ver` + `diagnostico_retinopatia.ver` + `informes.ver` + `imagenes.ver` | O | Activa B1: no hay proyección asistencial; 404 paciente inexistente, 200 lista vacía sin visitas. |
| GET `/api/pacientes/buscar` | Buscar / pacientes | `pacientes.ver` | O, E, S | Activa B1; proyección por rol. S no recibe última visita ni orden clínico. |
| GET `/api/pacientes/recientes` | Recientes / pacientes | `pacientes.ver` | O, E, S | Activa B1; S recibe altas recientes, no visitas recientes ni fecha de visita. |
| GET `/api/documentos` | Tipos de documento / catálogo | `pacientes.ver` | O, E, S | Catálogo para registro de pacientes; pendiente. |
| POST `/api/diagnosticar` | Crear IA / diagnósticos | `diagnostico_retinopatia.crear` + `imagenes.ver`; también `visitas.crear` solo si crea visita | O | **Activa B1 (27C)**: todos los grants del mismo rol habilitante; no equivale a validación médica. |
| GET `/api/diagnosticar/visita/<int:visita_id>/detalles` | Leer IA / detalles por ojo | `diagnostico_retinopatia.ver` + `imagenes.ver` | O | **Activa B1**: referencias de retinas y Grad-CAM; 404 si no hay diagnóstico, 200 con `ojos: []` si existe sin detalles. |
| GET `/api/diagnosticar/diagnostico/<int:diagnostico_id>/detalles` | Leer IA / detalles por ojo | `diagnostico_retinopatia.ver` + `imagenes.ver` | O | **Activa B1**: conserva fallback histórico al ID de visita cuando no existe ID de diagnóstico; misma política para ambos. |
| GET `/api/visitas/<int:visita_id>/reporte-diagnostico` | Descargar PDF / compuesto | `pacientes.ver` + `diagnostico_retinopatia.ver` [nuevo] + `imagenes.ver` [nuevo] | O | Incluye identidad, predicción, decisión e imágenes; pendiente de decisión contractual. |
| GET `/api/diagnosticar/retinografo/auto-seleccion/<int:paciente_id>` | Seleccionar exportadas / imágenes | `pacientes.ver` + `imagenes.ver` | O | **Activa B1 (28B)**: `retinograph.select`; ambos grants vigentes del mismo rol oftalmológico; no ejecuta inferencia. |
| GET `/api/diagnosticar/retinografo/imagen` | Descargar exportada / imágenes | `pacientes.ver` + `imagenes.ver` | O | **Activa B1 (28B)**: `retinograph.download`; el nombre solo propone una candidata, no acredita identidad. |
| PUT `/api/diagnosticar/detalle/<int:detalle_id>/validar` | Primera validación por ojo | `diagnostico_retinopatia.validar` | O con habilitación médica | **Activa B1**: solo un detalle `PENDIENTE` de diagnóstico `PROCESADO`; 409 para revalidaciones; rectificación futura fuera de alcance. |
| GET `/api/tipos-informe` | Leer tipos / catálogo informes | `informes.ver` **o** `informes.crear` | O, E, S según tarea | Solo catálogo; alternativa OR pendiente de confirmación. |
| POST `/api/informes` | Registrar / informes | `informes.crear` | O | Ni asistente ni enfermero crean informes oftalmológicos por defecto. Si crea visita, verificar dependencia de `visitas.crear` antes del corte; pendiente. |
| GET `/api/informes/<int:informe_id>` | Leer / informes | `informes.ver` | O, E, S según tarea | Todos los especialistas O con lectura ven informes de todos los pacientes; pendiente. |
| PUT `/api/informes/<int:informe_id>` | Editar / informes | `informes.editar` | O | **Propio:** comparar `informes.usuario_id`; **ajeno:** requiere permiso especial nuevo pendiente y auditoría. Finalizados: impedir edición silenciosa. Pendiente. |
| DELETE `/api/informes/<int:informe_id>` | Inactivar / informes | `informes.inactivar` [nuevo] | O con habilitación específica | Baja lógica `INACTIVO`, NO anulación; autoría/trazabilidad pendientes. |
| GET `/api/informes/paciente/<int:paciente_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | Lectura compartida sujeta a permiso; pendiente. |
| GET `/api/informes/visita/<int:visita_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | No basta `visitas.ver` por sí solo; pendiente. |
| GET `/api/informes/diagnostico/<int:diagnostico_id>` | Listar / informes | `informes.ver` | O, E, S según tarea | El servicio actual interpreta el ID como visita; pendiente. |
| GET `/uploads/retinas/<path:filename>` | Ver archivo protegido / imágenes | `imagenes.ver` | O; E si autorizado | **Activa B1**: `images.read` con grant vigente del rol clínico, comprobación de archivo registrado, extensión de imagen y confinamiento al directorio. JWT solo por Bearer, no `?token=`. |

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
solo estas doce rutas no protege el resto del sistema.

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

En Prompt 19 la BD habitual aún carecía de `diagnostico_retinopatia.ver`:
por ello se omitía `maxima_gravedad` y `history_available=false`. El propietario
confirmó posteriormente la reconstrucción y verificación B1 de su instancia;
no se hizo un bypass ni se activaron historiales en **aquel** bloque.

## Historial compuesto de pacientes (Prompt 22)

`GET /api/diagnosticos/paciente/<int:id>` y
`GET /api/pacientes/<int:id>/visitas` tienen **el mismo contrato real**:
`{"success": true, "data": [visitas...]}`. Ambos llaman al mismo servicio.
Cada visita no anulada conserva identificador, fecha descendente, profesional,
motivo, observaciones, estado y totales; incluye diagnóstico IA no anulado con
estado, modelo y detalles por ojo (grados sugerido/final, probabilidad,
validación, comentarios, metadatos y URLs de imágenes), y los informes activos
con tipo, conclusión y contenido estructurado. El servicio **no** devuelve
identidad del paciente, antecedentes ni alergias: estos se consultan por el GET
de detalle independiente. El frontend `PatientProfile` y `PatientVisitDetail`
consumen `/pacientes/<id>/visitas`; el otro alias no tiene consumidor directo
identificado. Los detalles adicionales de diagnóstico, informes, PDF y archivos
se consultan mediante **otros endpoints heredados**, fuera de esta activación.

Por incluir todos los dominios en una sola respuesta, ambas rutas requieren
`history.full_read`: rol activo `OFTALMOLOGO` y los **cinco** grants activos
`pacientes.ver`, `visitas.ver`, `diagnostico_retinopatia.ver`, `informes.ver` e
`imagenes.ver` procedentes de ese rol habilitante, sin sumar los del Admin o
Asistente. No hay asignación exclusiva de pacientes a médicos. Asistente y
Enfermero no acceden al contenido completo; su futura vista asistencial
requiere contrato diferente. Se comprueba el ID del paciente activo sin cargar
datos clínicos: 404 para ausente, 200 con `data: []` cuando no hay visitas o
sin diagnóstico. El 403 se emite antes de consultar pacientes/visitas. Con
visitas se ejecutan tres consultas de historial agrupadas, no una por visita.

**Actualización Prompt 23:** las referencias de imágenes continúan siendo
nombres de archivo (no credenciales). La lectura de `/uploads/retinas` ya
requiere B1 y Bearer, y las dos vistas que antes añadían el JWT a la URL usan
Blob autenticado sin caché persistente. Los permisos B1 todavía **no** corrigen
el bypass del decorador antiguo en informes, detalle independiente de IA,
PDF y otras rutas de imágenes.
`usePatientVisitDetail` aún solicita detalles adicionales a un endpoint de
diagnóstico independiente y trata su error como ausencia de detalle ampliado;
su autorización, manejo de 403 y registro del error deben revisarse en un
bloque específico de diagnóstico. No se alteró ese endpoint en este bloque.

## Archivos retinianos y transporte de JWT (estado histórico: Prompt 23)

Inventario antes del cambio:

| Recurso / consumidor | Transporte y situación |
| --- | --- |
| `/uploads/retinas/<path:filename>`; `VisitDiagnosisTab.tsx` (historial, imagen original y Grad-CAM) | Antes añadía `?token=`; ahora obtiene Blob con Axios/Bearer y usa URL `blob:` revocada al cambiar recurso o sesión y al desmontar. |
| `/uploads/retinas/<path:filename>`; `useDiagnosis.ts` / `DiagnosisResults.tsx` (resultado recién procesado, Grad-CAM) | Antes `useDiagnosis` construía URL con `?token=`; ahora conserva el nombre y `DiagnosisResults` carga Blob con Bearer. La imagen original recién seleccionada es una previsualización local independiente. |
| `/api/diagnosticar/retinografo/imagen`; `descargarImagenRetinografo` en `diagnosisService.ts` | Ya descargaba Blob con Axios/Bearer; **desde 28B usa autorización B1 propia**, separada de `/uploads/retinas`. |
| `/api/visitas/<int:visita_id>/reporte-diagnostico`; `PatientVisitDetail.tsx` | Descarga PDF con Axios/Bearer y URL blob local, pero su autorización backend y aceptación de JWT en URL siguen pendientes. No se modificó el PDF. |
| Rutas de detalle de diagnóstico, informes, documentos y demás `@token_required` | El único lector de `request.args.get('token')` es `backend/utils/security.py`. Ese fallback global todavía acepta JWT en query en rutas legacy; ninguna construcción `?token=` permanece en el frontend fuente. |

`images.read` autoriza únicamente roles clínicos activos `OFTALMOLOGO` o
`ENFERMERO` **con `imagenes.ver` activo procedente de uno de esos roles**;
no autoriza Admin por jerarquía, Asistente ni permisos administrativos de un
multirrol. No se exige propiedad individual. Se consulta un archivo de imagen
con nombre plano dentro del directorio de retinas, registrado en un detalle de
diagnóstico/visita no anulado; respuestas sin caché (`private, no-store`) y
`nosniff`. Solicitudes con cualquier parámetro `token` reciben 401 en esta
ruta incluso cuando incluyan Bearer; el token del navegador nunca aparece en
la URL generada. Incluso las siete rutas B1 anteriores continúan usando el
fallback de `token_required`: el rechazo de `?token=` es **solo** de la ruta
de archivos migrada, no de todo B1. Otras rutas legacy también aceptan JWT
en URL; **A1-QUERY-TOKEN sigue como fallo esperado** y la vulnerabilidad global está solo corregida
parcialmente. Siguiente bloque necesario: revisar por separado todos los
consumidores/endpoints `@token_required` (incluidos retinógrafo, PDF,
diagnóstico independiente e informes), migrarlos a Bearer y solo entonces
eliminar el fallback global y convertir A1 en prueba ordinaria.

La imagen registrada añade **una** consulta SQL de existencia tras las tres
de autenticación/autorización (cuatro SELECT por lectura, independientes del
número de visitas). Los rechazos 403 ocurren antes de consultar archivos
(tres SELECT); el rechazo de `?token=` ocurre antes de tocar la BD. Las siete
rutas B1 anteriores permanecen; con archivos son **ocho** rutas B1.

## Cierre del transporte JWT por URL (Prompt 24)

Inventario de dependencias comprobado antes de retirar el fallback:

| Backend protegido | Consumidor / transporte vigente |
| --- | --- |
| `GET /uploads/retinas/<path:filename>` | `VisitDiagnosisTab.tsx` (original y Grad-CAM) y `DiagnosisResults.tsx` (Grad-CAM posterior al diagnóstico) descargan Blob vía `api.get` con el interceptor Bearer; crean y revocan URL blob local. La imagen de entrada recién seleccionada usa previsualización local, no JWT en URL. |
| `GET /api/diagnosticar/retinografo/imagen` | `descargarImagenRetinografo` usa `api.get` con `params: {paciente_id, filename}` y `responseType: 'blob'`: son parámetros de selección, **no** credenciales. `auto-seleccion` usa la misma instancia Axios. |
| `GET /api/visitas/<int:visita_id>/reporte-diagnostico` | `descargarReporteDiagnostico` descarga PDF Blob por Axios/Bearer; `PatientVisitDetail.tsx` crea/revoca una URL blob para descargarlo. |
| Pacientes, historiales, detalle IA, informes y documentos (`@token_required` o B1) | Consumidores web usan `frontend/src/lib/api.ts`: su interceptor coloca el JWT en `Authorization: Bearer`. No se encontraron `?token=`, `access_token`, `jwt` ni construcción equivalente de JWT en query en el frontend fuente. |
| `backend/utils/security.py` | Era el **único** lector de `request.args.get('token')`. `allow_query_token=True` lo habilitaba para toda ruta protegida; solo retinas lo desactivaba explícitamente. |

El middleware ahora acepta **únicamente** el Bearer de cabecera. Si la query
incluye `token`, `access_token`, `jwt` o `id_token` (sin distinguir mayúsculas),
responde 401 **antes de decodificar o consultar usuarios**, incluso con un
Bearer válido. También rechaza valores con forma de JWT en cualquier parámetro,
aunque se oculten bajo otro nombre o entre valores repetidos. Los parámetros
normales, como `paciente_id`, `filename`, `q` o `page`, conservan su semántica.
Se mantienen la validación HS256, la exigencia de
`exp` y `user_id`, la cuenta activa y las reglas/grants existentes. Se eliminó
la opción de habilitar tokens de query por ruta; no se añadió otra alternativa
de autenticación. `A1-QUERY-TOKEN` se ejecuta como prueba ordinaria. El riesgo
de **autorización legacy** (permisos de diagnósticos, PDF e informes) sigue
pendiente y es independiente del transporte del JWT: no se amplió B1 ni se
cambió esa política. **Ocho** rutas B1 continúan activas.

## Lecturas independientes de detalles IA (Prompt 25)

Inventario de `backend/routes/diagnosis_routes.py`: POST `/api/diagnosticar`
crea IA (pendiente); los dos GET `/api/diagnosticar/visita/<int:visita_id>/detalles`
y `/api/diagnosticar/diagnostico/<int:diagnostico_id>/detalles` devuelven
predicción y validación por ojo; GET `/api/visitas/<int:visita_id>/reporte-diagnostico`
devuelve PDF compuesto (pendiente); los dos GET `/api/diagnosticar/retinografo/*`
seleccionan/descargan imágenes exportadas (pendientes); PUT
`/api/diagnosticar/detalle/<int:detalle_id>/validar` es validación médica
(pendiente). GET `/api/documentos` solo lista tipos documentales, no
diagnósticos. GET `/api/diagnosticos/paciente/<int:id>` es historial B1 previo:
**no** se modificó.

Se activó `diagnosis.details_read` **solo en los dos GET de detalles**. Exige
JWT Bearer y cuenta activa, rol servidor `OFTALMOLOGO` vigente, y **ambos**
grants vigentes `diagnostico_retinopatia.ver` + `imagenes.ver` procedentes del
rol oftalmológico. Sin `imagenes.ver` los nombres de archivos originales y
Grad-CAM también son información protegida. No se exige `pacientes.ver`,
`visitas.ver` ni `informes.ver`: la respuesta no incluye identidad de paciente,
contenido de visita ni informes; `visita_id` es solo identificador. No se
combinan grants de un rol administrativo con los del médico ni se exige
propiedad individual del paciente.

El contrato de éxito se conserva: `data.visita_id`, `data.diagnostico_id` y
`data.ojos` (ID de detalle, OD/OI, predicción y probabilidad, grado final,
estado y comentarios de validación, nombres de archivo y Grad-CAM). En el
endpoint por visita, `diagnostico_id` **sigue siendo el ID de visita** por
compatibilidad; en el de diagnóstico, el ID solicitado tiene precedencia y,
si no existe, se prueba como ID de visita (fallback histórico ambiguo,
conservado pero protegido igual). No se añade identidad del validador:
`validado_por` no forma parte de este contrato actualmente. Ausencia de
diagnóstico: 404 genérico sin campos clínicos; diagnóstico existente sin ojos:
200 con `ojos: []`; fallo interno: 500 genérico. La lectura usa la misma
consulta agrupada de detalles para uno o dos ojos, sin N+1. La vista de visita
ahora muestra 401/403 del GET independiente como error de acceso, no como
diagnóstico ausente, incluidos los detalles de comparación; 404 corresponde
a la ausencia del diagnóstico y no al paciente. Mantiene Blob/Bearer para
las imágenes. Hay **diez** rutas B1 tras esta activación.

## Primera validación médica por ojo (Prompt 26B)

El PUT existente `/api/diagnosticar/detalle/<int:detalle_id>/validar` es la
**undécima** ruta B1. `diagnosis.validate` exige Bearer, cuenta activa, rol
`OFTALMOLOGO` activo y grant vigente `diagnostico_retinopatia.validar` de ese
rol, aun en cuentas multirrol. El 403 se decide antes de consultar el detalle.
No se restringe por médico creador ni paciente asignado. Otras diez rutas
siguen con sus propias reglas.

Solo se aceptan `diagnostico_final` entero (0–4, grado activo en el catálogo),
`comentario_medico` y `motivo_correccion` de tipo texto o nulos. Campos
desconocidos, atribución de validador, fecha, ojo, estado y datos de inferencia
son 400. La predicción `resultado_ia_id` permanece intacta. Si el grado final
coincide con IA el estado es `APROBADO` y se descarta motivo; si cambia,
se exige motivo y el estado es `CORREGIDO`. `validado_por` es el usuario activo
del JWT y `fecha_validacion` se asigna con la convención UTC del servidor.

El diagnóstico padre se bloquea con `SELECT ... FOR UPDATE` antes de bloquear
el detalle, por ID de diagnóstico; así las peticiones del mismo diagnóstico
se serializan sin bloquear otros pacientes. La lectura del detalle y el
chequeo final de ojos pendientes son *locking reads* actuales, incluso bajo
`REPEATABLE READ`. Una única confirmación persiste detalle y estado padre;
cualquier error revierte el conjunto. Detalle ya validado (incluido el mismo
grado): 409 sin sobrescribir valores anteriores. Ausencia: 404. Estado
incompatible: 409. Fallo interno: 500 genérico, sin traza clínica. La operación
no rectifica ni conserva un historial de revisiones: esa función requiere
otra política y auditoría futura.

OD y OI siguen siendo dos solicitudes independientes. Si falla OI tras el
éxito de OD, OD queda guardado y OI continúa pendiente; el estado padre solo
pasa a `VALIDADO` cuando no quedan detalles pendientes. El frontend marca
como confirmados únicamente los ojos cuyo PUT devolvió éxito, evita repetirlos
y, ante un 409, bloquea nuevos envíos desde la vista y pide actualizarla.
En el arnés MySQL 8 desechable, una primera validación con dos ojos cuesta
8 SELECT, 1 UPDATE, 0 INSERT; el último ojo además actualiza el estado padre.
La prueba con dos clientes/conexiones independientes sincronizados antes del
bloqueo verifica 200/409 y un único resultado persistido.

## Bloqueos inmediatos del POST de inferencia (Prompt 27A)

En 27A `POST /api/diagnosticar` continuaba con autorización legacy (11 rutas
B1). Desde 27C se aplica la regla aprobada, que exige
`OFTALMOLOGO` activo con `diagnostico_retinopatia.crear` e `imagenes.ver`
procedentes de ese rol y, cuando crea visita, `visitas.crear` adicionalmente.

CLIP ahora deniega con 503 genérico si no puede cargar o ejecutar el validador;
un resultado interno inesperado da 500 y el rechazo semántico 422; ninguno
permite inferencia ni inserción. En el POST se
limita la envoltura multipart solo para esta ruta y se leen como máximo
20 MiB + 1 byte del archivo (413 si excede). El validador comprueba por
contenido JPEG/PNG/TIFF, extensión, MIME declarado, decodificación, lado mínimo
350 px, máximo 8192 px y superficie máxima 30 millones de píxeles. Los máximos
se pueden configurar por aplicación con `DIAGNOSIS_MAX_IMAGE_BYTES`,
`DIAGNOSIS_MAX_IMAGE_SIDE`, `DIAGNOSIS_MAX_IMAGE_PIXELS`; no se cambió SQL.
El retinógrafo usa `mimetypes.guess_type` y `File.type` para las extensiones
permitidas; un MIME genérico no pasa como excepción implícita.

La visita solicitada debe existir, corresponder al paciente y estar `ACTIVA`;
las `CERRADA`/`ANULADA` devuelven 409. El alias `diagnostico_id` del POST
histórico se interpreta **como ID de visita**, no como PK de diagnóstico; ahora
exige que la visita ya tenga diagnóstico y no puede discrepar de `visita_id` si
ambos se envían. `ojo_evaluado` solo acepta `Derecho`/`Izquierdo`.

La consulta temprana del ojo evita inferencia innecesaria. Antes de insertar
se repiten las comprobaciones con bloqueo `FOR UPDATE` de la visita y el
diagnóstico; la restricción SQL única por diagnóstico/ojo es respaldo para
colisiones. Cualquier detalle anterior, `PENDIENTE` o validado, responde 409:
ni su predicción, archivos, comentario, resultado final, validador o fecha se
reescriben. Los JPEG nuevos usan UUID completo y apertura exclusiva: tampoco
truncan archivos previos ante una colisión de nombre. Si solo había un ojo validado (`VALIDADO`), incorporar el opuesto
pendiente devuelve el estado agregado a `PROCESADO` conservando íntegro el
primero. Registros antiguos incompletos tampoco se reparan sobrescribiendo.

El riesgo identificado en 27A (commit antes de guardar los JPEG) se trata en
27B, a continuación. La recuperación frontend de éxitos parciales queda para
27D.

## Persistencia coordinada del POST (Prompt 27B)

Se sustituye la descripción anterior de riesgo de *fallo controlado*: ahora
`DiagnosisRepository.crear_diagnostico_y_detalle` solo hace `flush`; el
servicio coordina el único `commit` o `rollback` de visita, diagnóstico y ojo.
Tras cerrar la transacción de lectura de autorización/prechequeo, CLIP e IA
generan en memoria; se escriben dos JPEG provisionales en
`uploads/retinas/.pending/` (mismo filesystem), se sincronizan y se vuelven a
decodificar. La lectura B1 solo permite nombres de archivo registrados en una
fila **confirmada** y no expone `.pending`. Después se vuelve a bloquear
visita/diagnóstico con `FOR UPDATE` y se hace `flush` antes de publicar ambos
JPEG; al final, `commit`. Cada petición solo gestiona su propio par de nombres
UUID; no toca archivos preexistentes. `os.link` publica sin reemplazo de manera
atómica en un filesystem compatible; cuando el sistema no admite enlaces duros,
la alternativa usa apertura `xb` y copia sincronizada, exclusiva pero **no
atómica**. En este último caso un archivo parcial aún no confirmado no será
servido por la ruta registrada; otros lectores con acceso directo al disco
podrían observarlo. Nunca se usa `os.replace`.

En error anterior al commit se hace rollback y después se retiran los archivos
publicados **solo si el inode coincide con el creado por esa petición** y los
provisionales propios. Si se intentó confirmar, una lectura con conexión
independiente comprueba si la fila quedó confirmada; si existe, o falla la
comprobación/rollback, **no** borra los JPEG definitivos. Se responde 500 sin
exponer detalles internos y se requiere conciliación si no se puede determinar
el estado. Un fallo en la limpieza final de provisionales no invalida una
transacción ya confirmada; queda para inspección. OD y OI siguen siendo
peticiones/transacciones distintas.

**No existe atomicidad distribuida ni durabilidad absoluta entre MySQL y
filesystem**: una caída después de publicar el primero o ambos archivos y
antes de confirmar puede dejar archivos definitivos sin fila; una caída
durante el commit puede dejar resultado incierto; una pérdida física de disco
o acceso directo externo puede dejar una fila confirmada sin JPEG. La copia
exclusiva de reserva puede dejar un JPEG parcial al caer el proceso. No hay
`fsync` de los directorios tras crear enlaces, por lo que fallos de energía
mantienen una ventana de durabilidad incluso con `fsync` de cada archivo.

Conciliación conservadora: `utils.diagnosis_storage.inspect_database_candidates`
en contexto Flask consulta **todas** las referencias del detalle y devuelve
solo nombres del patrón generado, sin borrar. Solo propone provisionales
`diagnosis-*.part` y definitivos UUID sin referencia tras un mínimo de 24 h;
excluye operaciones activas en el mismo proceso; un error MySQL aborta la
inspección. También lista referencias a archivos faltantes. No se ejecuta al
arrancar ni borra nada. La memoria local no
identifica trabajo activo en otros workers o servidores.
Un operador autorizado debe comprobar que no hay solicitudes activas en ninguna
instancia, validar la identidad del MySQL y la carpeta de uploads correctos,
repetir la consulta y contraste de referencias, investigar registros con JPEG
ausentes y conservar copia antes de cualquier acción manual. Sin tabla de
operaciones ni coordinación entre procesos no es seguro automatizar borrados
ni afirmar que un candidato es un huérfano definitivo. El cliente que reciba
un 500 por commit incierto no debe repetir a ciegas: consultar primero la
visita/ojo; una segunda solicitud del mismo ojo dará 409 si se confirmó.

## Autorización del POST (Prompt 27C)

La ruta usa `strict_authorization_required('diagnosis.create',
conditional_operation='diagnosis.create_with_visit', ...)`; ya no apila
`token_required` ni `clinical_access_required`. El motor B1 autentica Bearer,
carga la cuenta/roles/grants actuales y comprueba `diagnostico_retinopatia.crear`
+ `imagenes.ver` **desde OFTALMOLOGO activo**, antes de analizar multipart o
consultar información clínica. No exige `pacientes.ver`. Si falla, responde 401
o 403 sin ejecutar CLIP, inferencia ni persistencia y sin consultar pacientes,
visitas o diagnósticos. No hay caché de permisos entre solicitudes.

Después del chequeo común se limita el tamaño de la petición y se inspeccionan
solo `visita_id` y `diagnostico_id` del multipart; ambos son IDs de visita
positivos (el segundo es un **alias histórico**, no la PK del diagnóstico).
Si faltan ambos, se evalúa la política completa `diagnosis.create_with_visit`,
que además requiere `visitas.crear` del **mismo** rol O. Si hay alguno, no se
exige ese grant. Vacíos, cero, no numéricos, duplicados, fuera de rango o
contradictorios devuelven 400; exceso de cuerpo, 413. Nunca pasan a modalidad
de creación por ser falsy. Sin imagen ni datos clínicos adicionales, las
validaciones del handler conservan sus códigos previos. El cambio de nombre
`diagnostico_id` se reserva para una corrección funcional posterior.

Un administrador solo, enfermero o asistente sigue en 403; dos roles no pueden
completar los grants que le faltan al OFTALMOLOGO. Un administrador+oftalmólogo
solo opera si el rol médico aporta la política completa. Revocar un grant o
desactivar el rol/cuenta afecta a la solicitud siguiente. Se conservan la
atomicidad limitada de 27B, los 409 por ojo y visita, y las 11 rutas B1 previas;
ahora son **12**. La recuperación de OD/OI parcialmente completados y las
etiquetas médicas siguen pendientes para 27D.

## Exportaciones del retinógrafo (Prompt 28A)

Antes `FILENAME_PATTERN.match` admitía sufijos, la selección seguía symlinks y
contaba archivos por nombre, y la descarga comprobaba `abspath/commonpath` para
luego reabrir por nombre con `send_from_directory`. MIME procedía únicamente de
la extensión y el JSON devolvía `directorio` y `documento` redundante.

Ahora `utils.retinograph_storage` abre el directorio por componentes sin seguir
symlinks (POSIX: `dir_fd`/`O_NOFOLLOW`; Windows: `CreateFileW` con
`FILE_FLAG_OPEN_REPARSE_POINT`, atributos y ruta final del **mismo handle**, con
ancestros abiertos sin compartir DELETE/WRITE). La imagen se lee una sola vez
desde su descriptor validado, con tamaño máximo 20 MiB; se verifica su formato
JPEG/PNG/TIFF por Pillow, dimensiones 350–8192 px por lado y hasta 30 MP. El
límite `RETINOGRAPH_MAX_IMAGE_BYTES` puede reducir los 20 MiB por aplicación,
pero un valor inválido o que amplíe el máximo falla de forma segura. La
respuesta se construye desde bytes verificados en memoria y nunca reabre la
ruta. Errores son genéricos; no se publican rutas internas. El listado examina
solo candidatos con nombre y documento coincidentes; cuenta exclusivamente
archivos decodificables, y desempata fecha/secuencia con nombre completo en
orden lexicográfico. Ya no incluye `directorio` ni repite `documento` en JSON.
No hay caché persistente, las respuestas usan `private, no-store`.

**Límite de seguridad:** los handles protegen contra redirección por nombre,
pero no convierten el archivo en inmutable ante escritura concurrente sobre el
mismo inode (incluidos mapas de memoria previos). Se compara tamaño y mtime del
descriptor antes/después; la lectura está acotada y el contenido leído se valida,
pero un escritor con acceso directo al directorio puede producir cambios que no
constituyen una instantánea clínica. La configuración de la raíz y los permisos
del filesystem son una frontera de confianza: no se aceptan raíces relativas ni
ancestros symlink/junction, pero montajes especiales, hardlinks, exportadores
maliciosos y origen real de la exportación requieren controles operativos.
La prueba de junction y symlinks se ejecutó en Windows; POSIX se analizó en
código, pero no se ejecutó en Linux en esta entrega.

**Estado histórico al concluir 28A:** ambas mantenían decoradores legacy y
había 12 rutas B1. La migración posterior está documentada a continuación. El nombre/documento
y `R/L` solamente proponen una candidata, y la decodificación solo comprueba
validez técnica: no hay pertenencia clínica acreditada. El botón «Selección
Auto» ya no habilita inferencia de archivos importados sin una confirmación
trazable; definirla sin ampliar ni asumir el esquema corresponde a 28C. La carga
manual permanece fuera de esta comprobación específica y debe revisarse allí.

## Autorización de exportaciones (Prompt 28B)

Ambos GET sustituyen `@token_required` +
`@clinical_access_required('imagenes.ver', 'diagnosticos.crear')` por un solo
`@strict_authorization_required` con políticas **independientes**:
`retinograph.select` y `retinograph.download`. Cada una requiere cuenta activa,
rol `OFTALMOLOGO` activo, y los grants activos `pacientes.ver` e `imagenes.ver`
procedentes de ese rol. Sin propiedad médico–paciente. Administrador solo,
enfermero, asistente, jerarquía, comodines y `diagnostico_retinopatia.crear` no
habilitan acceso. `evaluate_rule` reúne permisos entre roles habilitantes;
estas dos reglas habilitan **solo** `OFTALMOLOGO`, por lo que no hay unión entre
roles diferentes ni cambio del evaluador compartido. Un usuario administrador
y oftalmólogo accede únicamente si el rol oftalmológico aporta ambos grants.
JWT en URL se rechaza aun con Bearer válido.

La autenticación carga las relaciones ORM vigentes una vez por solicitud antes
del handler. Pruebas Flask/ORM/MySQL 8 desechable: selección y descarga con
datos sintéticos, 4 SELECT por solicitud aprobada (3 autorización + 1 paciente),
3 SELECT y **ninguno clínico** ante 403; 2 aperturas en selección para dos
candidatas, 1 en descarga, 0 ante 403. No hay caché de grants entre solicitudes.
Las garantías de descriptor/contenido/no-store de 28A permanecen; symlinks y
junctions fueron probados en Windows, no hay ejecución POSIX en Linux en 28B.
El frontend distingue 401/403/404/red, descarta vistas Blob parciales y retira
imágenes al denegarse una nueva selección. Sigue sin permitir inferencia desde
una candidata no confirmada. **14 rutas B1**; no se han ampliado otras políticas.
28C debe definir la confirmación humana trazable paciente–imagen–ojo sin tratar
el nombre, R/L ni la decodificación como evidencia de asociación clínica.

## Confirmaciones de exportación (Prompt 28C.3)

Se mantienen las **14 rutas B1 anteriores** y se agregan tres operaciones
separadas: `retinograph.confirm`, `retinograph.confirm_status` y
`retinograph.revoke` (total **17 rutas B1**). Solo rol OFTALMOLOGO activo con
`pacientes.ver` e `imagenes.ver` activos del mismo rol. Los grants y el maestro
SQL no cambian. Consulta/revocación además exigen pertenencia al profesional
confirmador y un comprobante opaco en JSON, jamás en URL. La asociación humana
paciente–imagen–ojo no es validación médica de la IA. Contratos, caducidad,
almacenamiento privado y límites: `confirmaciones-exportacion-retinografo-28c3.md`.
En 28C.3 todavía no había consumo por POST ni desbloqueo de Selección Auto.

### Consumo posterior en POST (Prompt 28C.4)

El POST B1 existente admite archivo manual o `confirmacion_exportacion`, nunca
ambos. La segunda modalidad verifica los bytes de copia y fuente, procesa solo
la copia, y consume la confirmación bajo lock en la misma transacción que el
detalle (sin mantener locks durante IA). **Siguen siendo 17 rutas B1**; la
interfaz de Selección Auto sigue bloqueada. Contrato, concurrencia y límites de
conciliación: `confirmaciones-exportacion-retinografo-28c4.md`.

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
