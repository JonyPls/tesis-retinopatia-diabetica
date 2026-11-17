# CODN — Auditoría técnica y plan de pruebas de caja negra y caja blanca

**Fecha de inspección:** 3 de noviembre de 2026.  
**Repositorio:** `tesis-retinopatia-diabetica`.  
**Referencia Git inspeccionada:** `0cd1ab53156d333b6e16e9f4da07b91a7565be68`, más el árbol de trabajo local.  
**Estado de los diez casos:** NO EJECUTADOS. Este documento no contiene aprobaciones ni resultados experimentales nuevos.

## 1. Alcance y resumen ejecutivo

Se inspeccionaron fuentes relevantes de React, Flask, persistencia, IA, pruebas y documentación; se consultó el índice estructural de Codebase Memory y se contrastaron sus referencias con archivos reales. Se comprobaron versiones mediante metadatos locales y existencia de ejecutables/recursos, sin importar `app.py`, cargar modelos, conectar a MySQL, iniciar servicios ni ejecutar suites.

**Resultado:** 4 casos **Viable**, 6 **Condicionado**, 0 **No viable actualmente**, según el alcance base de la matriz. Viabilidad no significa aprobación. Los cuatro viables son pruebas internas aisladas con herramientas presentes; necesitan seleccionar/ampliar aserciones antes de la ejecución formal. La cobertura automatizada de ramas es una mejora condicionada adicional, no un recurso ya instalado.

**Ajustes principales:**

1. CN-03 se concreta como **creación de visita mediante registro de informe clínico**, no como un CRUD independiente de visitas que no se ha encontrado.
2. CN-04 distingue informes vigentes por visita de historial/versiones, cuyos filtros y banderas son diferentes.
3. CB-03 comprueba repositorios y agrupación real en MySQL, no solamente la respuesta de un endpoint.
4. CB-05 se concreta en **la transacción de creación de informe, visita opcional y versión inicial**.
5. CN-05 evalúa funcionalidad, no exactitud clínica del clasificador. No debe sustituirse la inferencia real por mocks y presentarse como prueba integral aprobada.

### Ubicación del entregable y restricciones

Por la restricción vigente del modo Plan, este archivo se crea exclusivamente en:

`C:\Users\ricar\.opencode\plan\AUDITORIA_PLAN_PRUEBAS_CODN.md`

La ubicación propuesta dentro del repositorio para una etapa posterior es `docs/tesis/pruebas/AUDITORIA_PLAN_PRUEBAS_CODN.md`. Actualmente hay documentación en `backend/docs/` y `frontend/docs/`, pero no una carpeta documental central en la raíz. No se ha creado ni modificado esa estructura. Las rutas relativas de este documento se refieren a la raíz del repositorio, no al directorio del plan.

Se detectaron cambios locales previos en `frontend/src/components/layout/AppHeader.tsx` y `frontend/src/test/appHeader.test.tsx`; no se alteraron. Deben registrarse al identificar la versión exacta de una futura ejecución.

### Convenciones de certeza

- **Confirmado:** observado en fuentes, metadatos o existencia local; no implica funcionamiento en ejecución.
- **Pendiente:** necesita verificación dinámica o identificación del entorno autorizado.
- **Propuesto:** fixture, prueba, comando o artefacto para una siguiente etapa; no existe necesariamente todavía.
- Los resultados citados en documentos antiguos son **antecedentes**, nunca evidencias de esta auditoría ni de una ejecución futura.

## 2. Arquitectura identificada

### 2.1 Tecnologías y organización

| Área | Confirmado | Referencias verificables |
|---|---|---|
| Frontend | React 18, TypeScript, Vite 5, Tailwind 3; React Router 6; Axios; Zustand; TanStack Query; componentes Radix; React Hook Form/Zod declarados | `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/App.tsx` |
| Organización frontend | Features `auth`, `dashboard`, `patients`, `diagnosis`, `reports`, `configuration`; componentes/utilidades compartidos | `frontend/src/features/`, `frontend/src/components/`, `frontend/src/lib/` |
| Backend | Python 3.12.10 local; Flask 3.1.3, Flask-CORS, PyJWT 2.12.1, Werkzeug, python-dotenv | `backend/requirements.txt`, `backend/app.py`, `backend/routes/auth_routes.py` |
| Capas backend | Blueprints HTTP → servicios → repositorios → entidades ORM/utilidades; consultas ORM y SQL parametrizado mediante SQLAlchemy | `backend/routes/`, `backend/services/`, `backend/src/repositories/`, `backend/src/models/` |
| Persistencia | Flask-SQLAlchemy 3.1.1, SQLAlchemy 2.0.30 y PyMySQL 1.1.2; conexión MySQL | `backend/database.py`, `backend/src/repositories/patient_repository.py` |
| IA | torch 2.3.0, torchvision 0.18.0, Lightning 2.2.4, transformers 4.44.2, grad-cam 1.5.5; OpenCV 4.9.0.80, NumPy, Pillow | `backend/requirements.txt`, `backend/dl_model/` |
| Documentos | Generación PDF con ReportLab; pypdf; plantilla clínica | `backend/services/report_service.py`, `backend/requirements.txt`, `backend/assets/pdf/plantilla_clinica.pdf` |

Las versiones de backend citadas se contrastaron con `importlib.metadata` del Python del entorno virtual, sin importar las librerías pesadas. Las versiones frontend de la tabla son familias declaradas; Vitest instalado se verificó separadamente.

### 2.2 Autenticación y autorización

- `backend/routes/auth_routes.py:login`: POST JSON con `username` y `password`; rechaza JSON no objeto o tipos incorrectos.
- `backend/services/auth_service.py:autenticar_usuario`: credenciales presentes, búsqueda de cuenta activa, `check_password_hash`, JWT HS256 con expiración de 24 horas, respuesta pública genérica ante fallo interno.
- `backend/src/repositories/auth_repository.py`: consultas de usuario activo y carga de roles/permisos con sus relaciones.
- `backend/utils/security.py:token_required`: Bearer en cabecera, rechazo de credenciales JWT en URL, validación de firma/expiración/claims y recarga de identidad activa. Los permisos del token no sustituyen los vigentes.
- **Política efectiva de los endpoints auditados:** `backend/utils/strict_authorization.py`, especialmente `OPERATION_RULES`, `evaluate_rule`, `evaluate_operation`, `strict_authorization_required`, `patient_read_scope` y `patient_create_scope`. Exige códigos de rol habilitante y grants activos procedentes de ese rol. El administrador no obtiene automáticamente privilegios clínicos. No confundirla con los helpers de autorización heredados, más permisivos, que también existen en `security.py`.
- Roles de política confirmados: `OFTALMOLOGO`, `ENFERMERO`, `ASISTENTE_ADMINISTRATIVO`, `ADMINISTRADOR_SISTEMA`. Sus asignaciones efectivas en una base en ejecución **no se inspeccionaron**.
- Frontend: `SessionRoute.tsx`, `ModuleRoute.tsx` y `moduleAccess.ts` bajo `frontend/src/features/auth/`; Axios agrega Bearer y trata 401/403 en `frontend/src/lib/api.ts`. Zustand persiste token/usuario en `auth-storage` (`store/authStore.ts`): no capturar localStorage ni publicar perfiles de navegador autenticados.

### 2.3 Persistencia y modelo de asociación

Las entidades declaran `Paciente` y `VisitaClinica` en `backend/src/models/patient_entities.py`; `Informe`, `InformeVersion` y `TipoInforme` en `backend/src/models/informe_entities.py`; los diagnósticos y detalles en `backend/src/models/diagnosis_entities.py`; usuarios/roles/permisos en `backend/src/models/auth_entities.py`.

La asociación relevante es **paciente → visita → informes / diagnóstico IA → detalles por ojo**. `Informe.visita_id` referencia la visita. Una visita sin IA puede tener informes. `crear_nuevo_informe` coordina la visita opcional, informe y versión inicial con un único commit; los repositorios hacen flush.

**Identificadores:** en respuestas de informes y parte de los contratos antiguos, `diagnostico_id` es un alias de `visita_id`. En `DiagnosisRepository.obtener_detalles_por_diagnostico`, en cambio, primero se interpreta como ID real del diagnóstico y solo después como visita. Usar las rutas explícitas por visita y fixtures donde los dos IDs sean distintos; no declarar equivalencia universal.

El ORM declara unicidad visita/tipo para informes y número de versión por informe. Esto **no acredita que esas restricciones estén instaladas en una base concreta**. No se leyeron `.env`, dumps ni contenido de `backend/db/`. Solo se confirmó la existencia del archivo local referenciado por el arnés, `backend/db/centro-oftalmologico-db-v2.sql`, y se inspeccionaron modelos/repositorios/documentación. No se asume su esquema instalado ni que su semilla sea apta para evidencias públicas.

### 2.4 Módulos, rutas y responsables

| Funcionalidad confirmada | Interfaz | API y componentes reales |
|---|---|---|
| Login y restricciones por módulo | `/` y rutas protegidas | POST `/api/login`; `auth_routes.py`, `auth_service.py`, `auth_repository.py`, `strict_authorization.py`; `frontend/src/features/auth/` |
| Usuarios, estado, roles y permisos | `/configuracion` | GET/POST `/api/configuracion/usuarios`; PATCH `/api/configuracion/usuarios/<id>`; PUT `.../<id>/estado`, `.../<id>/roles`; GET `/api/configuracion/catalogo`; GET/PUT `/api/configuracion/roles/<id>/permisos`; `configuration_routes.py`, `configuration_service.py`, `configuration_repository.py` |
| Alta, listado, búsqueda y detalle de pacientes | `/pacientes`, `/pacientes/:id`; alta también desde Diagnóstico | GET/POST `/api/pacientes`; GET `/api/pacientes/<id>`, `/buscar`, `/recientes`; `patient_routes.py`, `patient_service.py`, `patient_repository.py`; `CreatePatientDialog.tsx`, `hooks/usePatients.ts` |
| Consulta de visitas/historial por paciente | `/pacientes/:pacienteId/visitas/:visitaId` y perfil | GET `/api/pacientes/<id>/visitas`; alias GET `/api/diagnosticos/paciente/<id>`; `obtener_historial_diagnosticos`, `PatientRepository.obtener_diagnosticos_paciente`; `usePatientVisitDetail.ts` |
| Creación de visitas | «Nueva visita» en Informes o Diagnóstico | POST `/api/informes` sin visita → `crear_nuevo_informe` → `InformeRepository.crear_visita`; POST `/api/diagnosticar` sin visita → `DiagnosisRepository.crear_diagnostico_y_detalle` |
| Informes clínicos | `/informes`; pestaña Informes en detalle de visita | GET `/api/tipos-informe`; POST `/api/informes`; GET `/api/informes/<id>`, `/paciente/<id>`, `/visita/<id>`, `/diagnostico/<id>`; `informe_routes.py`, `informe_service.py`, `informe_repository.py`; `useReports.ts`, `VisitReportsTab.tsx`, `PatientReportDetailModal.tsx` |
| Versionado/historial de informes | Componentes históricos específicos | GET `/api/informes/<id>/versiones`, `/api/informes/historial/paciente/<id>`; PUT `/api/informes/<id>` y POST `.../<id>/anulacion` bajo banderas; DELETE autenticado bloqueado |
| Fotografías e IA | `/diagnostico` | POST `/api/diagnosticar`; GET `/api/diagnosticar/visita/<id>/detalles`; `diagnosis_routes.py`, `diagnosis_service.py`, `diagnosis_repository.py`; `useDiagnosis.ts`, `api/diagnosisService.ts`, `ImageUploader.tsx`, `ManualImageConfirmation.tsx`, `DiagnosisResults.tsx` |
| Importación de exportaciones del retinógrafo | Flujo opcional de Diagnóstico | GET `/api/diagnosticar/retinografo/auto-seleccion/<id>`, `/imagen`; POST `/confirmaciones`, `/confirmaciones/estado`, `/confirmaciones/revocar` bajo `/api/diagnosticar/retinografo`; servicios `retinograph_import_service.py`, `retinograph_confirmation_service.py` |
| Acceso a fotografías y PDF diagnóstico | Resultados/detalle de visita | GET `/uploads/retinas/<filename>` con autorización y comprobación de registro; GET `/api/visitas/<id>/reporte-diagnostico`; `files_routes.py`, `report_service.py` |
| Dashboard | `/dashboard` | Blueprint `backend/routes/dashboard_routes.py`, feature `frontend/src/features/dashboard/` |

**No confirmado como funcionalidad disponible:** edición de pacientes. `patient_routes.py` solo expone alta/lecturas, sin PUT/PATCH; no debe suponerse por existir un permiso llamado `pacientes.editar`. Tampoco se encontró POST independiente `/api/visitas`. La modificación de usuarios sí tiene endpoint real.

El frontend implementa formularios de informes para IDs **2, 3 y 4**: campo visual, gonioscopia y paquimetría (`frontend/src/features/reports/supportedTypes.ts`). No afirmar que todos los tipos de catálogo tengan formulario. La disponibilidad y correspondencia de esos IDs deben comprobarse en el catálogo aislado.

### 2.5 Flujo de IA y recursos

`backend/dl_model/validator.py` implementa formato/dimensiones, región dominante sobre fondo oscuro y validación semántica CLIP `openai/clip-vit-base-patch32`. Límites predeterminados observados: JPEG/PNG/TIFF; lado menor de 350 px; lado mayor de 8192 px; 30 millones de píxeles; 20 MiB en el servicio. Extensión, MIME y contenido deben ser compatibles.

`backend/dl_model/inference.py:predecir_imagen_bytes` usa preprocesamiento propio, entrada 224×224, normalización, clasificador de cinco grados y Grad-CAM. `get_modelo` carga `resnet50_best.ckpt` con `RetinopatiaModel`. Hay CPU como alternativa a CUDA. No se alteró ni ejecutó este pipeline.

**Presencia confirmada, funcionamiento pendiente:** checkpoint local, directorio de caché CLIP y archivo de pesos base ResNet50 en caché. No se comprobaron integridad, carga, compatibilidad CUDA, memoria ni latencia. El constructor de arquitectura usa pesos preentrenados; la presencia del checkpoint no excluye otras necesidades de caché. No autorizar descargas implícitas durante la ejecución formal sin preparación previa.

### 2.6 Arranque y configuración: inventario, no ejecución

| Recurso | Comando declarado/propuesto | Precaución |
|---|---|---|
| Frontend | Desde `frontend`: `npm run dev`; build `npm run build`; lint `npm run lint`; preview `npm run preview` | Scripts confirmados en `package.json`; no ejecutados. Vite configura puerto 8080 |
| Backend habitual | Desde `backend`: `.\venv\Scripts\python.exe app.py` | Lee `.env`, configura MySQL y precarga CLIP; NO usar para preparar pruebas aisladas sin revisión |
| Lanzador local | `.\venv\Scripts\python.exe run_local.py` | Exige `RETINOGRAPH_PRIVATE_DIR`, hace comprobaciones DB de descarte; configura historial activo y edición/anulación inactivas. No es un lanzador de tesis aislado |
| Unitarias Python | `.\venv\Scripts\python.exe -B -m unittest -v <modulo.Clase.metodo>` | Seleccionar por método y revisar fixture/importaciones; no ejecutar discovery indiscriminado |
| Frontend automatizado | Desde `frontend`: `.\node_modules\.bin\vitest.cmd run <archivo>` | Binario local presente; evita `npx` que pudiera descargar. No hay script `npm test` |

Variables identificadas en código, **sin leer sus valores reales**: `SECRET_KEY`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME`, `FRONTEND_ORIGIN`, `FLASK_DEBUG`, `FLASK_PORT`, `RETINOGRAPH_PRIVATE_DIR`, `RETINOGRAPH_EXPORT_DIR`, `VITE_API_BASE_URL`, `VITE_DIAGNOSIS_DISCARD_ENABLED`.

`database.init_db` no ofrece una variable separada `DB_PORT`; el arnés aislado construye su propia URL mediante SQLAlchemy. No inventar un `DB_PORT` efectivo en el lanzador habitual. Hay desajuste potencial entre Vite 8080 y el CORS por defecto de Flask, que permite `http://localhost:5173`. Debe resolverse en un lanzador de pruebas autorizado, sin editar configuraciones de producción ni `.env`.

Las banderas `REPORTS_HISTORY_ENABLED`, `REPORTS_EDIT_ENABLED`, `REPORTS_ANNUL_ENABLED` y las tres `DIAGNOSIS_DISCARD_*` son `app.config`; no asumir que se activan simplemente creando variables de entorno con esos nombres. El frontend solo activa descarte si `VITE_DIAGNOSIS_DISCARD_ENABLED === "true"`.

## 3. Infraestructura de pruebas y recursos locales

| Recurso | Estado confirmado | Uso y límite |
|---|---|---|
| `unittest`, `unittest.mock` | Estándar de Python 3.12.10 presente | Unitarias, spies, inyección de fallos, fixtures Flask; no requiere pytest |
| Flask `test_client` | Utilizado por pruebas existentes | Integración en proceso; no produce capturas de navegador |
| Suites backend | 17 archivos `backend/test_*.py` en la raíz del backend | Incluyen autenticación, pacientes, validadores, almacenamiento, configuración, fechas y descarte; número de archivos, no de tests ejecutados |
| Vitest | Declarado `^3.2.4`; instalado 3.2.7 | 38 archivos `frontend/src/test/*.test.*`; componentes/hooks/API con mocks |
| Testing Library y jsdom | Declarados; jsdom instalado 20.0.3 | DOM simulado; no sirve como evidencia visual de un E2E real |
| pytest / pytest-cov / coverage.py | No disponibles en `backend/venv` según metadatos; no declarados en requirements | No recomendar `pytest --cov` como comando listo para usar |
| Cobertura frontend | No están instalados `@vitest/coverage-v8` ni `@vitest/coverage-istanbul` | `--coverage` necesita proveedor compatible y autorización de preparación |
| Playwright/Cypress | No declarados; no encontrados en `frontend/node_modules`; Playwright Python tampoco | Sin infraestructura E2E confirmada; no existe herramienta de navegador expuesta a esta sesión |
| Navegadores | Chrome y Edge presentes en ubicaciones convencionales de Windows | Captura manual auténtica viable al disponer de entorno seguro; no se abrieron |
| Runtime Node | Node v24.14.1; npm presente | Su compatibilidad dinámica con la suite no se probó |
| MySQL local | Existen `mysqld.exe` y `mysql.exe` en MySQL Server 8.0 | No están en PATH según búsqueda; versión efectiva, permisos y capacidad de arrancar instancia aislada pendientes |
| Arnés MySQL | `backend/b1_mysql_disposable_trial.py`, `backend/b1_orm_mysql_trial.py` y ensayos relacionados | Implementación presente; inicializa/escribe/limpia una instancia propia. NO ejecutado ni autorizado como parte de esta inspección |
| SQLite temporal | Usado en `test_diagnosis_discard.py` y `test_discard_integration74.py` | Útil para esas fixtures; no acredita equivalencia con filtros/dialecto/bloqueos MySQL |

Los ensayos `b1_*_trial.py`, `discard_mysql_trial77.py` y `patient_email_unique_disposable_trial.py` no son comandos inocuos de inspección. El arnés B1 tiene opt-in `--run-disposable` y opción `--orm-integration`, comprueba datadir/puerto/UUID, pero también ejecuta inicialización SQL y limpieza. No ejecutarlo para obtener un simple inventario, ni reutilizar sus semillas sin revisión de privacidad.

### Reportes y cobertura posibles

- `unittest -v`: log de métodos, aserciones fallidas y resumen; se debe conservar código de salida. No genera JUnit/HTML de serie.
- Vitest: reporteros de consola y JUnit, por ejemplo `--reporter=default --reporter=junit --outputFile.junit=<ruta>` en la siguiente etapa. Confirmar la opción con el binario local antes de adoptarla; no ejecutada aquí.
- Python `trace` de la biblioteca estándar puede medir **líneas/sentencias ejecutadas** sin instalar paquetes. No mide ramas ni demuestra condiciones independientes. Ejecutar sobre una suite seleccionada con `--count --summary --missing` y `--coverdir` aislado, y restringir el análisis a los archivos/funciones objetivo.
- Para ramas HTML/XML: preparar con autorización `coverage.py` compatible; para frontend, proveedor Vitest de la misma versión. No instalados durante esta intervención.
- En ausencia de medidor de ramas, usar una tabla trazable condición → entrada → aserción → método ejecutado. Es evidencia de decisiones ensayadas, no un porcentaje de cobertura automática ni MC/DC certificado.

## 4. Antecedentes y trazabilidad

No se localizaron identificadores **CP-33 / CP-34** en el contenido textual buscado del repositorio/documentación ni en los nombres documentales versionados revisados. No se inspeccionaron PDFs de salida, documentos clínicos privados ni datos ignorados para intentar encontrarlos; pueden existir antecedentes fuera de este alcance.

| Antecedente real | Utilidad para los casos | Límite de reutilización |
|---|---|---|
| `backend/test_auth_security.py:AuthSecurityTests` | CN-01/CB-01; fixtures de usuarios/grants, JWT real de prueba, autorización antes de servicios | Muchos métodos prueban HTTP con servicios sustituidos; añadir evaluación directa de condiciones para CB-01 |
| `backend/test_patient_registration_validation.py:PatientRegistrationValidationTests` | CN-02/CB-02; validación directa, límites de edad/nombres/correo, duplicados y no inserción | Sus mocks no acreditan restricciones MySQL instaladas |
| `backend/test_diagnosis_input.py:DiagnosisInputTests` | CB-04; validadores reales con CLIP/torch sustituidos; formato, límites, 503/500 | No ejecuta clasificador real |
| `backend/test_diagnosis_storage.py:DiagnosisStorageTests` | CB-04; publicación exclusiva y limpieza de temporales | No demuestra una transacción clínica integral |
| `backend/test_diagnosis_discard.py:DiscardTest.inference_service` y métodos de indisponibilidad | CB-04; carga de servicio real sin modelos ni mkdir habitual, no inferencia tras rechazo | Fixture SQLite y modelos simulados; no presentarla como CN-05 |
| `backend/b1_orm_mysql_trial.py:RealORMStrictIntegrationTests` | CB-03/CB-05; lectura institucional, filtros, conteos, rollback y commit incierto | Solo dentro de instancia desechable verificada; no ejecutar la clase suelta: `config` se inyecta por el arnés |
| `frontend/src/test/b1ReportVisits.test.tsx` | CN-04/CB-03; selección de visita, conteo activo, apertura en solo lectura | Hook simulado en parte de la suite; no prueba SQL |
| `frontend/src/test/b1ReportPatientContext.test.tsx` | CB-03 complementario; respuestas tardías y cambios de paciente | Axios simulado; evidencia auténtica de hook, no E2E |
| `frontend/src/test/b1ReportHistory.test.tsx`, `authLogin.test.tsx`, `moduleRoutes.test.tsx`, `patientValidation.test.ts` | Regresión de informes/acceso/pacientes | Reutilizar procedimientos y entradas, no resultados históricos |
| `backend/docs/verificacion-y-transicion-informes-29c6.md`, `versionado-informes-29c2.md` a `29c5.md` | Contratos de informes/versionado; distinción mock/ORM/navegador y acuse de commit perdido | Sus cifras, estados de DB y comandos son históricos; contrastar con fuente y entorno nuevos |
| `backend/docs/81_visitas_recientes.md`, `83_validacion_tras_reconstruir_mysql.md`, `frontend/docs/73_correccion_fotografias.md`, `75_recuperacion_descarte.md` | Elegibilidad de visitas y separación de 503 por esquema/validador | No acredita el estado actual de MySQL ni un recorrido de navegador |
| `frontend/src/features/patients/README.md` | Consentimiento declarado; riesgo de unicidad de correo concurrente | Documenta limitación histórica; verificar metadatos de la base aislada antes de exigir unicidad concurrente |

No sumar las mismas ejecuciones como diez pruebas independientes: cada código tendrá objetivo, variantes y evidencias propios. Reusar una fixture está permitido; reetiquetar una captura o log anterior como nueva ejecución no.

## 5. Diseño de las cinco pruebas de caja negra

**Criterio común:** aprobar mediante comportamiento visible y datos de fixture conocidos, sin exigir llamadas internas, SQL, ramas o funciones concretas. Endpoints y fuentes de esta sección localizan el componente, pero no definen por sí solos el oráculo funcional. Confirmar las reglas de negocio propuestas con el responsable antes de ejecutar; una discrepancia entre contrato acordado y código se reporta como hallazgo, no se ajusta el esperado a posteriori.

### CN-01 — Inicio de sesión y control de acceso

- **Módulo y superficies:** Autenticación; `/`, `/pacientes`, `/diagnostico`, `/informes`, `/configuracion`; POST `/api/login` y lecturas protegidas. Referencias: `LoginForm.tsx`, `hooks/useLogin.ts`, `moduleAccess.ts`, `auth_routes.py` y `strict_authorization.py`.
- **Precondiciones/datos:** backend/frontend aislados; usuarios ficticios activos de oftalmología, enfermería, asistencia y administración; roles/grants documentados; una cuenta inactiva; contraseña de pruebas custodiada fuera de evidencias; contexto de navegador nuevo por actor.
- **Acciones:** intentar ingreso sin campos; con contraseña incorrecta y usuario inexistente; ingresar con credenciales válidas; visitar rutas permitidas y prohibidas tanto por menú como por URL directa; cerrar sesión e intentar volver a un módulo protegido.
- **Esperado observable:** inválidos sin sesión ni contenido protegido; válido con identidad ficticia visible y acceso al módulo permitido; usuario autenticado sin privilegio no ve contenido restringido aunque escriba la URL; ausencia/expiración de sesión obliga a autenticarse. Como apoyo API: 400 incompletas, 401 credenciales incorrectas/sesión inválida y 403 operación no autorizada.
- **Variantes:** oftalmólogo accede a pacientes/informes con grants suficientes; enfermería y asistencia no realizan validación médica ni consultan informes completos; administrador exclusivo accede a configuración pero no adquiere por ello acceso clínico. No basta que el menú oculte una opción: comprobar URL directa. Revocación durante sesión es ampliación opcional solo en cuentas aisladas.
- **Automatización:** recorrido manual reproducible disponible tras preparar entorno; Playwright opcional condicionado a instalación autorizada. Vitest existente sirve de antecedente, no reemplaza este recorrido.
- **Evidencias:** `CN-01-S01-login-invalido.png`, `CN-01-S02-acceso-permitido.png`, `CN-01-S03-acceso-denegado.png`; identidad/rol ficticios y URL visibles; nunca contraseña, token ni cabeceras Authorization.
- **Viabilidad:** **Condicionado** a entorno y cuentas sintéticas. Riesgos: sesión persistida de otro actor, grants desactualizados, diferencia entre nombre visible de rol y código de política. No se probaron credenciales reales.

### CN-02 — Registro y validación de pacientes

- **Módulo/superficies:** `/pacientes` → «Nuevo paciente»; POST `/api/pacientes`; consulta por listado/búsqueda/detalle. Componentes: `CreatePatientDialog.tsx`, `usePatients.ts`; backend `patient_routes.py` y `patient_service.py`.
- **Precondiciones/datos:** usuario ficticio con alta y lectura; catálogo documental presente; identificador de ejecución único. Ejemplo exclusivamente sintético: DNI `90000001` reservado en la base aislada, nombres `Ana Prueba`, apellidos `Paciente Sintetica`, sexo `Femenino`, fecha `2000-01-01`, correo `cn02.<run>@example.com`, consentimiento verdadero. Comprobar ausencia previa; no usar ese DNI en la base habitual. Teléfono/correo/dirección pueden quedar vacíos.
- **Acciones:** abrir alta; enviar vacío/incompleto; introducir documento corto, nombre numérico, fecha imposible/futura, correo mal formado y falta de consentimiento, por separado; corregir; guardar un alta válida; buscarla y abrir su detalle; repetir documento y luego correo con otro documento.
- **Esperado observable:** errores junto a campos o mensajes claros, permanencia de datos corregibles y ausencia del nuevo registro ante rechazo; éxito de alta visible y registro único recuperable con los datos normalizados; duplicados rechazados sin segunda alta. Apoyo API: 201 válido, 400 inválido y 409 duplicado detectado.
- **Variantes:** nombres con tildes y apóstrofes; campos opcionales vacíos; teléfono compartido no debe bloquear; fecha de hoy es admitida actualmente y no debe marcarse inválida por una regla inventada. Para tesis priorizar adultos ficticios y no afirmar gestión completa de representantes legales de menores.
- **Automatización:** interfaz manual; futura E2E posible. `patientValidation.test.ts`, `patientDialogUX.test.tsx` y suite Python son antecedentes, no evidencia visual nueva.
- **Evidencias:** `CN-02-S01-validaciones.png`, `CN-02-S02-alta-confirmada.png`, `CN-02-S03-consulta.png`, `CN-02-S04-duplicado.png`, todas con el mismo marcador de ejecución cuando corresponda.
- **Viabilidad:** **Condicionado** a DB/usuario aislados. No incluir concurrencia de correo como aprobado sin verificar índice real; el README de pacientes documenta una limitación histórica. No se ha confirmado edición de pacientes y no forma parte de este caso.

### CN-03 — Creación de visita mediante un informe clínico

- **Ajuste justificado:** se mantiene el objetivo de crear una visita asociada al paciente, usando el flujo real de Informes, sin depender de IA. No hay un POST independiente de visitas ni formulario CRUD confirmado.
- **Módulo/superficies:** `/informes`: tipo → paciente → «Nueva visita» → formulario → guardar; POST `/api/informes`; consulta posterior `/pacientes/:id` y `/pacientes/:pacienteId/visitas/:visitaId`. Referencias: `ClinicalReports.tsx`, `VisitaSelector.tsx`, `useReports.ts:saveAll`, `informe_routes.py:crear`, `informe_service.py:crear_nuevo_informe`.
- **Precondiciones/datos:** pacientes ficticios A y B, oftalmólogo con lectura necesaria, `informes.crear` y `visitas.crear`; tipo soportado disponible, preferentemente paquimetría; valores clínicos enteramente sintéticos aceptados por el formulario, fijados en fixture antes de la ejecución. Registrar historial inicial de A/B sin revelar pacientes reales.
- **Acciones:** seleccionar un solo tipo y A; elegir Nueva visita; intentar formulario incompleto; completar y guardar; abrir historial de A y la visita creada; revisar historial de B; repetir con visita existente de A para otro tipo. Cancelación previa al guardado como variante negativa.
- **Esperado observable:** incompleto/cancelado no produce nueva visita; guardado válido muestra éxito y una visita adicional en A con el informe ingresado; B no cambia; agregar un informe a visita existente no crea otra. No exigir botones de edición de motivo/fecha que no existen.
- **Variantes API complementarias:** paciente inexistente; asociación deliberada de paciente A con visita de B; actor sin permiso de creación de visita. Preparar estas entradas fuera del flujo normal de UI y capturar respuesta real como evidencia secundaria, sin considerar que la interfaz permite seleccionar visitas ajenas.
- **Automatización/evidencia:** manual o futura Playwright; capturas `CN-03-S01-paciente-nueva-visita.png`, `CN-03-S02-informe-guardado.png`, `CN-03-S03-historial-asociado.png`, `CN-03-S04-paciente-control.png`.
- **Viabilidad:** **Condicionado** a entorno, catálogo y fixtures. Para evitar confusión transaccional usar un informe en la variante principal: «Guardar Todo» realiza varios POST y no garantiza atomicidad de todo el lote. Ante fallo de red/500 consultar el estado antes de repetir.

### CN-04 — Consulta de informes por visita

- **Módulo/superficies:** principal: `/pacientes/:pacienteId/visitas/:visitaId` → pestaña Informes → «Ver informe»; secundaria: `/informes` → seleccionar paciente/visita → paso 3. APIs: GET `/api/pacientes/<id>/visitas`, `/api/informes/visita/<id>` y `/api/informes/<id>`. Historial/versiones es una variante adicional, no el listado vigente.
- **Precondiciones/datos:** paciente A con visitas V1/V2/V0 y paciente B con VB; informes activos con marcadores diferentes `CN04-V1`, `CN04-V2`, `CN04-VB`; V0 sin informes; informe inactivo/anulado de control, creado por fixture aislada autorizada, no mediante edición de datos habituales. Usuario con privilegios de historial completo.
- **Acciones:** abrir V1, leer tarjetas y detalle; cambiar a V2 y V0; abrir VB; volver rápidamente entre pacientes/visitas; comprobar que no permanece un informe del contexto anterior. Probar URL de A con visita de B como negativo. En `/informes`, comprobar registrados de la visita seleccionada y exclusión de tipos ya registrados al agregar uno.
- **Esperado observable:** cada vista muestra únicamente los informes vigentes del contexto acordado; contenido y visita del detalle coinciden con la fixture; V0 muestra vacío explícito; contexto ajeno no muestra sus informes; denegación no debe interpretarse como ausencia de informes. El rol restringido no obtiene el contenido por URL directa.
- **Filtros aplicables reales:** paciente, visita y vigencia; selección de tipo implementado en el asistente; paginación para endpoints históricos, si se activa esa variante. No hay base para exigir un filtro general de fecha/texto de informes no confirmado. El historial puede mostrar anulados, con indicación de no vigencia, sin contradecir el listado activo.
- **Automatización/evidencias:** manual o futura E2E; `CN-04-S01-V1-lista.png`, `CN-04-S02-V1-detalle.png`, `CN-04-S03-V2-lista.png`, `CN-04-S04-visita-vacia.png`, `CN-04-S05-contexto-invalido.png`; capturar encabezado paciente/visita y marcador del informe.
- **Viabilidad:** **Condicionado** a fixtures/DB. Existe una diferencia interna de filtros entre endpoints que debe analizar CB-03; no asumir que todas las lecturas excluyen visitas anuladas de la misma forma. No publicar PDFs clínicos existentes como evidencia.

### CN-05 — Ingreso, procesamiento y presentación de fotografías con IA

- **Módulo/superficies:** `/diagnostico`: paciente/visita → carga y confirmación de ojo → procesamiento → resultados. POST `/api/diagnosticar`, GET `/api/diagnosticar/visita/<id>/detalles`, GET autenticado `/uploads/retinas/<filename>`. Importación desde retinógrafo es extensión opcional; no exige equipo físico para la modalidad manual.
- **Precondiciones/datos:** oftalmólogo de prueba y grants completos; paciente ficticio con consentimiento; visita nueva o elegible; carpetas de entrada/salida privadas y aisladas; CLIP y clasificador/Grad-CAM reales disponibles. Imagen de prueba sin contenido clínico real, con origen y hash registrados; debe confirmarse que una fixture retiniana sintética no identificable supera las validaciones sin modificar modelos/umbrales. No se ha confirmado ninguna imagen positiva apta durante esta auditoría.
- **Acciones válidas:** seleccionar paciente y Nueva visita; adjuntar fixture a OD u OI; verificar vista previa y confirmar asociación; iniciar procesamiento; esperar fin sin medir como progreso real los porcentajes animados; revisar grado, probabilidades, ojo e imagen/Grad-CAM; consultar nuevamente el resultado persistido desde la visita.
- **Esperado observable:** asociación correcta; resultado de una de cinco categorías con probabilidades presentadas y recursos visibles; al consultar se conserva el resultado sin nuevo análisis; no se atribuye a otro paciente/ojo. Es apoyo a decisión clínica, no reemplazo del especialista. No exigir un grado clínico exacto sin un oráculo independiente, ni afirmar sensibilidad/especificidad con este caso.
- **Inválidos:** sin archivo, bytes corruptos, formato no permitido, resolución insuficiente, archivo excesivo y fotografía no retiniana no identificable. Debe verse rechazo entendible, sin resultado nuevo presentado como exitoso. Un archivo pequeño puede ser rechazado en cliente; registrar esa frontera. Fallo 503 de CLIP o interrupción de red se ensaya solo con control del entorno aislado, nunca apagando servicios compartidos; no fabricar respuestas y presentarlas como inferencia real.
- **Automatización:** manual tras preparación; E2E opcional. Los mocks de Vitest/unittest son útiles para CB-04, no sustituyen el éxito real de CN-05. Tener tiempos de espera por carga de modelos; no adoptar SLA no definido.
- **Evidencias:** `CN-05-S01-carga-confirmacion.png`, `CN-05-S02-procesamiento.png`, `CN-05-S03-resultados.png`, `CN-05-S04-reconsulta.png`, `CN-05-S05-rechazo.png`; conservar relación con hash del archivo, ojo y visita ficticia, sin imagen de un paciente real.
- **Viabilidad:** **Condicionado** a fixture positiva apta, modelos/cachés operativos, aislamiento y servicios. Si no se dispone de fixture no clínica aceptada, mantener pendiente el éxito integral o aprobar expresamente una sustitución: **CN-05A, rechazo seguro de imágenes inválidas y ausencia de resultado nuevo**. Ese alcance reducido no acredita procesamiento exitoso y exige actualizar la matriz; no realizar la sustitución silenciosamente.

## 6. Diseño de las cinco pruebas de caja blanca

**Criterio común:** invocar funciones reales y comprobar decisiones, parámetros, efectos y ausencia de efectos con aserciones explícitas. Una petición HTTP con comprobación exclusiva del status no cumple estos casos. Los dobles sustituyen dependencias externas, nunca la función objetivo. Los porcentajes de cobertura aquí son metas propuestas, no mediciones.

### CB-01 — Decisiones internas de autenticación y autorización

**Objetivos reales:** `backend/services/auth_service.py:autenticar_usuario`; `backend/utils/security.py:token_required`; `backend/utils/strict_authorization.py:evaluate_rule`, `evaluate_operation`, `patient_read_scope`, `strict_authorization_required`. Priorizar motor estricto de rutas auditadas.

**Lógica/rutas:** credenciales ausentes → 400 sin repositorio; inexistencia/hash incorrecto → 401; válido → JWT; excepción → 500 genérico. JWT ausente/vencido/inválido/URL → bloqueo; cuenta inactiva → bloqueo; permisos recargados → decisión vigente. En `evaluate_rule`, cuenta/rol/permiso activos, rol elegible, procedencia de grants, `all_of`, `any_of`, ausencia de comodines y comprobación de recurso.

| Entrada/variación | Aserciones internas propuestas |
|---|---|
| Usuario ausente, inactivo; regla desconocida/vacía/con comodín | Resultado booleano falso; handler/recurso no llamados |
| OFTALMOLOGO activo con todos los grants / falta uno | `evaluate_operation(..., 'history.full_read')` verdadero/falso; retirar cada grant por separado |
| ADMINISTRADOR con permiso clínico; OFTALMOLOGO sin ese grant | Falso: no se mezclan privilegios procedentes de roles no habilitantes |
| Rol/permiso inactivo, relación sin rol/permiso | Exclusión de esa relación; no autorización accidental |
| Regla con `any_of` sin/con coincidencia; recurso None/False/True | Salidas esperadas por condición y permiso; comprobar que recurso no se consulta si política ya deniega |
| Credenciales vacías, hash incorrecto, válidas y fallo del repositorio | `assert_not_called`/`assert_called_once_with` en repositorio, JWT verificable con clave ficticia, 400/401/200/500 sin secreto |
| Claims desactualizados y grant actual retirado | Identidad/grants cargados desde repositorio y handler bloqueado; los claims no amplían acceso |

**Pruebas/fixtures:** unitarias directas con `SimpleNamespace` de usuario→roles→permisos, `Mock`, clave/contraseñas ficticias; contextos Flask propios para request/JWT. Reutilizar el patrón de `backend/test_auth_security.py` y sus métodos `test_strict_admin_plus_ophthalmologist_requires_clinical_grant_source`, `test_strict_denied_user_does_not_trigger_resource_lookup`, pero añadir invocaciones directas a `evaluate_rule` para que las decisiones queden explícitas, no solo el transporte.

**Cobertura/evidencia:** meta de todas las salidas de decisión enumeradas y tabla de condiciones independiente; líneas mediante `trace` disponible; ramas mediante coverage.py solo tras preparación autorizada. Captura auténtica de ejecución, log y extractos de código con rangos de líneas. Nueva suite focalizada propuesta, no creada: `backend/test_codn_cb01_authorization.py`.

**Viabilidad:** **Viable**, sin DB, modelos ni servicio web. La cobertura automatizada de ramas es opcional condicionada; no se promete 100% de todo `security.py` ni MC/DC de todo el sistema.

### CB-02 — Validación interna del alta de pacientes

**Objetivos:** `backend/services/patient_service.py:_parse_birth_date`, `_validate_patient_data`, `_valid_person_name`, `_normalize_document`, `registrar_nuevo_paciente` (validación previa a escritura); utilidades de documento/correo en `backend/utils/identity_validation.py`.

**Lógica:** envelope/tipos y allowlist según alcance → normalización → validaciones acumuladas → fecha/longitudes → catálogo documental → detección de duplicados → inserción solo si es válido. `_validate_patient_data` recibe fecha pero no la valida: la fecha se comprueba separadamente con `_parse_birth_date`. No adjudicarle una rama inexistente.

| Entradas propuestas | Aserciones verificables |
|---|---|
| Payload None/lista; campo desconocido; campo clínico en alcance administrativo; consentimiento no booleano | 400, sin consulta documental ni insertar/commit |
| Nombres de longitudes 1/2/80/81; apellidos 1/2/100/101; tildes/apóstrofes frente a dígitos/control | Diccionario de errores correcto; normalización NFC/espacios en entidad enviada a insertar |
| DNI válido/inválido y tipo inexistente; teléfono vacío/válido/inválido; correo vacío/válido/inválido | Campo correspondiente en `errors`; opcionales vacíos admitidos; consulta de correo omitida cuando está vacío |
| Fecha mal formada/imposible, futura, anterior a 1900 | Error específico y ausencia de persistencia |
| `today=date(2026,11,3)` y nacimientos `1906-11-03`, `1905-11-04`, `1905-11-03` | Edades 120, 120 y 121: dos admitidos y uno rechazado; fecha de hoy admitida. Usar parámetro `today` real, no reloj dependiente de ejecución |
| Longitudes dirección 255/256, antecedentes 2000/2001, alergias 1000/1001 | Límite admitido/superado; probar campos clínicos solo en alcance autorizado |
| Documento/correo ya conocidos | 409, campos conflictivos exactos, `insertar_paciente` y commit nunca llamados |
| Entrada válida y correo con mayúsculas/espacios | Constructor con datos normalizados, insert una vez y commit una vez, 201 |

**Pruebas/fixtures:** reutilizar y ampliar `backend/test_patient_registration_validation.py:PatientRegistrationValidationTests`; particularmente `test_all_invalid_fields_reported_without_database_access`, `test_optional_email_and_shared_phone_do_not_block_insert`, `test_birth_date_and_birthday_boundary`. Modelo/repositorios/db simulados como en ese archivo; no importar aplicación ni abrir MySQL. La validación de frontend en `usePatients.ts:validatePatientForm` puede ser complemento con Vitest, no reemplazo de las decisiones backend.

**Cobertura/evidencias:** particiones válidas/invalidas y límites, sentencias con `trace`; meta de ejecutar las dos salidas de cada validación seleccionada, identificadas por método/subTest. Reportar ramas solo si se incorpora medidor. Log y captura `CB-02`, extractos reales y tabla de entradas/aserciones.

**Viabilidad:** **Viable**, sin DB real; mocks y fecha fija. La integridad concurrente de índices no queda probada por esta unidad.

### CB-03 — Filtrado y asociación interna de informes

**Objetivos principales:** `backend/src/repositories/informe_repository.py:InformeRepository.obtener_informes_por_visita`, `validar_visita`, `obtener_informe_por_id`; `backend/src/repositories/patient_repository.py:PatientRepository.obtener_diagnosticos_paciente`. Complemento: `frontend/src/features/reports/hooks/useReports.ts:loadInformesExistentes` y guardas `patientContext`/`existingContext`.

**Lógica confirmada:**

1. `obtener_informes_por_visita` filtra `Informe.visita_id` y `Informe.estado == 'ACTIVO'`, ordena por nombre del tipo y serializa.
2. Ese método **no** une paciente/visita para excluir paciente inactivo o visita anulada. `listar_informes_por_paciente` tampoco agrega todos esos filtros. No atribuirles reglas adicionales.
3. `obtener_informe_por_id` sí exige informe activo, visita no anulada y paciente activo. `validar_visita` rechaza visita ajena/anulada con `NotFound`.
4. `obtener_diagnosticos_paciente` usa SQL parametrizado por paciente; excluye visitas anuladas e informes no activos; `COUNT(DISTINCT i.id)` evita multiplicaciones por otros JOIN; agrupa informes en `informes_por_visita` y asigna únicamente los de cada visita. Si no hay visitas retorna antes de consultas de detalle/informe.
5. Frontend descarta respuestas de contexto anterior y excluye tipos ya presentes. Esa protección no demuestra por sí sola el filtrado de SQL.

**Fixtures/entradas:** MySQL aislado compatible; A/B, V1/V2/V0/VB y visita anulada; informes de dos tipos con nombres ordenables y estados ACTIVO/INACTIVO/ANULADO; dos detalles de ojo y versiones para detectar conteos duplicados. IDs diagnóstico/visita diferentes. No asumir las cifras de una semilla histórica.

**Aserciones directas:**

- Invocar repositorios reales: conjunto exacto de IDs activos de V1; no V2/VB/inactivos/anulados, orden por nombre y `visita_id` correcto.
- Vacío sin visitas/informes; comprobar salida temprana de `obtener_diagnosticos_paciente` con spy de consultas además del resultado.
- Cada visita de A conserva exclusivamente sus informes; total de activos correcto aunque haya varios ojos/versiones. Comparar con una tabla esperada de fixture independiente, no con otra llamada al mismo método.
- `validar_visita(VB,A)` y visita anulada lanzan `InformeRepository.NotFound`; visita correcta devuelve entidad de A.
- Comparar comportamiento de listado por visita versus detalle para visita anulada/paciente inactivo. Documentar la divergencia actual; si el requisito aprobado exige exclusión uniforme, registrar fallo funcional, no cambiar silenciosamente el esperado.
- Complemento Vitest: resolver primero petición de B y después la antigua de A; estado final solo de B; cambiar visita/limpiar impide reaparecer informes previos. Antecedente `b1ReportPatientContext.test.tsx`.

**Tipo/herramientas:** integración a nivel de repositorio con `unittest` y MySQL 8; no limitarse a `client.get`. Referencias reutilizables: `RealORMStrictIntegrationTests.test_29a_real_report_reads_catalog_and_pdf` y `test_29b_visit_report_counts_match_active_reports_without_versions_or_other_visits` en `backend/b1_orm_mysql_trial.py`. Requiere suite focalizada/fixture auditada; no lanzar indiscriminadamente ese arnés completo.

**Cobertura:** matrices de inclusión/exclusión por paciente, visita, estado y orden; ramas Python de salida temprana/agrupación/excepciones; cobertura de predicados SQL mediante fixtures adversariales y conjuntos exactos. Ejecutar una línea de SQL no equivale a cubrir todas sus condiciones. `trace` o coverage.py para líneas/ramas Python, no para cobertura SQL automática.

**Evidencias:** código evaluado, log de llamadas directas/aserciones, tabla sintética esperado/obtenido, consultas parametrizadas sanitizadas sin credenciales ni valores sensibles, reporte de líneas/ramas cuando exista. Prefijo `CB-03`.

**Viabilidad:** **Condicionado** a MySQL aislado/esquema/fixtures. Unitarias del hook sí son ejecutables con recursos presentes, pero no bastan para declarar aprobado el objetivo de filtrado SQL real. SQLite no es sustituto equivalente: este repositorio usa `CONCAT`, `FIELD`, tipos/constraints y semántica MySQL.

### CB-04 — Validaciones, bifurcaciones y errores del procesamiento fotográfico

**Objetivos:** `backend/dl_model/validator.py:validar_formato_y_dimensiones`, `validar_region_circular`, `validar_contenido_semantico`; `backend/services/diagnosis_service.py:procesar_diagnostico`, `_undo_creation`; `backend/utils/diagnosis_storage.py:DiagnosisFiles` como dependencia real o spy según variante.

**Rutas internas:** preflight antes de modelos → límite de bytes → formato → región → semántica → inferencia → preparar/publicar JPEG → commit → respuesta. Rechazo de una capa impide las siguientes. Excepciones clínicas, duplicados y persistencia llevan a compensación. `_undo_creation` no borra publicaciones si un commit iniciado puede haber persistido: verifica fila mediante conexión independiente o conserva ante incertidumbre.

| Entrada/inyección de fallo | Aserciones internas |
|---|---|
| Vacío/corrupto, extensión/MIME incorrectos, 349/350 px, lados/píxeles sobre límite | Salida real del validador; casos de frontera controlados; ningún modelo cargado |
| Imagen sintética oscura sin contornos; región pequeña/grande | Rechazo/aceptación de región sin adjudicarle circularidad geométrica que el algoritmo no mide |
| `_get_clip` falla; modelo/procesador falla; argmax inválido; ganador no retiniano; ganador 0 | 503, 503, 500, rechazo semántico, válido respectivamente; no se filtra texto privado de excepción |
| Preflight falla; exceso de bytes; cada capa rechaza | Spy: ninguna inferencia, escritura o publicación posterior; status/código público esperado |
| Validadores exitosos y predicción simulada de cinco clases | Función real usa bytes correctos, normaliza confianza de porcentaje a fracción para BD, conserva paciente/ojo y devuelve IDs; commit una vez |
| Segundo JPEG/publicación o inserción falla antes de commit | Rollback invocado, limpieza limitada a archivos de esa operación y release ejecutado; ningún reintento de inferencia |
| Commit intentado: fila existe/no existe/consulta falla; rollback falla | Se conserva cuando persiste/no se sabe; solo se eliminan publicaciones si se acredita seguridad según la lógica; no borrar otro ojo/operación |

**Tipo/fixtures:** unitarias con `unittest.mock`, bytes generados en memoria y `TemporaryDirectory` aprobado. No hace falta modelo real ni MySQL para el alcance base. Usar `test_diagnosis_input.py`, `test_diagnosis_storage.py` y el patrón `test_diagnosis_discard.py:DiscardTest.inference_service`: stub previo de imports pesados y supresión de `os.makedirs` durante import, luego carpeta temporal. No ejecutar toda la suite de descarte, que incluye DDL de su fixture SQLite, para probar estas rutas focalizadas. Para nuevas unitarias sustituir repositorios/db y validar las llamadas sin esquema.

**Cobertura/evidencias:** decisiones de cada capa y tabla de rutas de compensación; sentencias con `trace`; ramas automatizadas si se autoriza coverage.py. Log/assert_not_called/assert_called_once y archivos temporales de prueba identificados; captura real de consola/reporte con código `CB-04`.

**Viabilidad:** **Viable** para lógica real con dependencias simuladas y almacenamiento temporal; necesita preparar aserciones focalizadas adicionales. **No** acredita calidad ni ejecución de ResNet50/CLIP/Grad-CAM reales; esa frontera pertenece a CN-05 y a pruebas ML separadas.

### CB-05 — Transacción de informe y tratamiento de fallos de persistencia

**Operación concreta:** creación de un informe, su visita opcional y versión inicial. Objetivos: `backend/services/informe_service.py:crear_nuevo_informe`, `_rollback_informe`, `_is_duplicate_report`; llamadas reales previstas en `InformeRepository.crear_visita`, `crear_informe`, `crear_version_inicial` (`backend/src/repositories/informe_repository.py`).

**Lógica:** valida estructura/IDs/datos; paciente/tipo/visita deben existir; visita se crea solo cuando no se aporta; crea informe y versión; `commit_started` se activa inmediatamente antes de commit. Distingue NotFound, Conflict, IntegrityError duplicado conocido, otros errores, DBAPIError y commit incierto. Rollback limpia la sesión pero **no demuestra ausencia de persistencia** cuando el commit pudo confirmarse.

| Escenario y entrada | Aserciones internas, además de status |
|---|---|
| Payload válido sin visita | Orden: validar paciente/tipo → crear visita → informe con ID de esa visita → versión inicial → un commit; rollback no llamado |
| Payload válido con visita | `validar_visita(visita_id,paciente_id)` llamado; `crear_visita` no llamado; informe y versión usan IDs correctos |
| Paciente/tipo/visita ausentes o ajenos | 404; no commit ni llamadas posteriores; rollback ejecutado |
| Conflict o duplicado MySQL 1062 del índice `uq_informes_visita_tipo` antes de commit | 409; rollback; no commit; no segundo intento de inserción |
| IntegrityError de otro índice/código; fallo al crear informe o versión | 500 genérico, sin excepción/SQL/datos internos en respuesta; rollback y cero reintentos; commit no llamado si falló antes |
| DBAPIError/IntegrityError al commit | 500 y advertencia de resultado incierto; commit intentado una vez; no clasificarlo automáticamente como duplicado seguro ni como reversión demostrada |
| Rollback también falla | `_rollback_informe` registra mensaje controlado sin reemplazar el resultado público por una excepción no tratada |

**Tipo/herramientas:** unitarias de función real con `unittest`, spies de orden mediante `Mock.attach_mock`, repositorio/db simulados, contexto Flask propio y descarte desactivado para aislar esta transacción. Evitar importar `app.py` y evitar `.env` mediante stub/patch previo. Archivo nuevo propuesto, no creado: `backend/test_codn_cb05_report_transaction.py`.

**Ampliación de integración, condicionada:** en MySQL aislado, provocar fallo antes de commit y consultar con otra sesión los conteos visita/informe/versión: sin residuos. Para acuse perdido, ejecutar commit real y después lanzar excepción controlada: una fila y una versión permanecen, sin reintento. Antecedentes exactos: `test_29b_real_post_existing_vs_new_visit_grant_and_rollback`, `test_29b_real_post_duplicate_inactive_and_unexpected_integrity`, `test_29b_real_post_commit_uncertain_no_retry` en `backend/b1_orm_mysql_trial.py`. Nunca inyectar estos fallos en la base habitual. Un mock que recibió rollback **no acredita** atomicidad física de MySQL.

**Cobertura:** sentencias y tabla de ramas de excepciones/`commit_started`; meta de todas las rutas enumeradas. `trace` disponible; cobertura automática de ramas pendiente de herramienta. Evidencia `CB-05`: log/aserciones de orden y ausencia de reintento, extractos de función y, solo en ampliación real, conteos sintéticos por sesión independiente.

**Viabilidad:** **Viable** para control interno con mocks y aserciones; garantía física de integridad en el motor queda **condicionada** a la ampliación MySQL. El alcance y la limitación deben constar en el informe académico para no confundir las dos conclusiones.

## 7. Matriz consolidada de viabilidad

| Código | Funcionalidad | Componente o archivo | Herramienta sugerida | Evidencia prevista | Viabilidad |
|---|---|---|---|---|---|
| CN-01 | Login y acceso por actor | `frontend/src/features/auth/`; `backend/routes/auth_routes.py`; `utils/strict_authorization.py` | Chrome/Edge manual; Playwright opcional | Capturas reales de login/acceso/denegación y ficha | Condicionado |
| CN-02 | Alta y validación observable de pacientes | `CreatePatientDialog.tsx`, `usePatients.ts`; `backend/services/patient_service.py` | Navegador real con DB sintética | Formulario inválido, alta, consulta, duplicado | Condicionado |
| CN-03 | Visita nueva mediante informe | `useReports.ts:saveAll`; `informe_service.py:crear_nuevo_informe` | Navegador real | Selección, guardado y visita asociada; paciente control | Condicionado |
| CN-04 | Informes vigentes de visita seleccionada | `VisitReportsTab.tsx`, `PatientReportDetailModal.tsx`; `informe_routes.py` | Navegador real; apoyo API | Listas V1/V2/vacía, detalle y contexto inválido | Condicionado |
| CN-05 | Flujo fotográfico e IA real | `useDiagnosis.ts`; `diagnosis_service.py`; `dl_model/validator.py`, `inference.py` | Navegador + modelos reales | Carga, resultado, reconsulta y rechazo; hash de fixture | Condicionado |
| CB-01 | Decisiones auth y grants | `auth_service.py`; `security.py`; `strict_authorization.py:evaluate_rule` | unittest/mock; trace; coverage opcional | Aserciones directas de condiciones, log y código | Viable |
| CB-02 | Validaciones/límites de pacientes | `patient_service.py:_parse_birth_date`, `_validate_patient_data`, `registrar_nuevo_paciente` | unittest/mock; trace | Entradas límite, no inserción, normalización y log | Viable |
| CB-03 | Predicados SQL/asociación de informes | `informe_repository.py`; `patient_repository.py:obtener_diagnosticos_paciente` | unittest + MySQL aislado; Vitest complementario | Conjuntos exactos, conteos, exclusiones, código y log | Condicionado |
| CB-04 | Validaciones y compensación de fotos | `validator.py`; `diagnosis_service.py:procesar_diagnostico`, `_undo_creation` | unittest/mock/Pillow/OpenCV; trace | Cortocircuitos, fallos y limpieza segura, log/código | Viable |
| CB-05 | Control transaccional de creación de informe | `informe_service.py:crear_nuevo_informe`, `_rollback_informe` | unittest/mock; MySQL como ampliación | Orden de llamadas, commit/rollback, errores y no reintento | Viable |

**Total alcance base:** Viable **4**; Condicionado **6**; No viable actualmente **0**. Si se exige cobertura automática de ramas como requisito obligatorio de aprobación, los cuatro casos unitarios pasan a estar condicionados por esa herramienta. Si CB-05 se exige como garantía de integridad física MySQL, también debe clasificarse condicionado, resultando 3 viables/7 condicionados. No cambiar el criterio de contabilización sin registrarlo.

**Sustituciones:** CN-03 necesita reformulación, no pérdida de su objetivo; CB-05 necesitaba concretar operación y ya queda definida. Ningún caso se sustituye silenciosamente. CN-05A solo es alternativa reducida sometida a aprobación si la fixture positiva apta no puede obtenerse.

## 8. Preparación de un entorno reproducible y seguro

### 8.1 Puertas previas obligatorias

1. Autorizar por separado la creación de pruebas/fixtures/lanzador y el arranque de servicios en la siguiente etapa. El modo Plan no permite implementarlos en el repositorio.
2. Identificar una instancia MySQL **de pruebas, sin datos reales**, con host/puerto/datadir/UUID/version verificables y cuenta restringida. No basta usar otro nombre de esquema en el servidor habitual para afirmar aislamiento de instancia.
3. Preferir instancia de pruebas ya provisionada. Si se propone arnés desechable, revisar previamente SQL/semillas/limpieza y obtener autorización explícita para inicialización de esa instancia propia; el permiso de esta auditoría no autoriza migraciones ni reinicialización. No copiar datos de pacientes reales.
4. Validar metadatos mínimos contra repositorios: tablas/columnas/índices/FK/versiones/procedencia temporal requeridos. No ejecutar `db.create_all` como sustituto de esquema MySQL ni aplicar migraciones para hacer pasar casos.
5. Preparar fixtures sintéticas por actor/paciente/visita/informe y un manifiesto con IDs resueltos dinámicamente. Identificadores/documentos/correos reservados solo en esa instancia.
6. Diseñar un lanzador exclusivo de pruebas con Flask y blueprints reales, siguiendo el patrón de `b1_orm_mysql_trial.py` pero sin la suite masiva. Evitar importar `app.py` y `database.init_db`; impedir lectura de `.env`, configurar URL SQLAlchemy explícita y comprobar destino antes de cada escritura. Es infraestructura **propuesta**, no disponible como comando listo para CN.
7. Redirigir conjuntamente el directorio escritor `diagnosis_service.UPLOAD_FOLDER` y lector `files_routes.RETINAS_FOLDER` a una raíz temporal propia. También exportaciones/confirmaciones privadas/PDF si se usan. El escritor depende de cwd y el lector apunta a backend: cambiar solo cwd no garantiza aislamiento/coherencia. Hacerlo en el lanzador/fixture, sin modificar funciones productivas.
8. Definir API/CORS/puertos de prueba; frontend con URL de API aislada por entorno del proceso autorizado, sin editar `.env`. Verificar manualmente el destino antes de login/altas.
9. Mantener descarte/corrección de fotografías fuera del alcance base. No habilitar `DIAGNOSIS_DISCARD_*` ni `VITE_DIAGNOSIS_DISCARD_ENABLED` salvo caso adicional expresamente aprobado. Para CN-04 histórico opcional, fijar `REPORTS_HISTORY_ENABLED` conscientemente; no exigir edición/anulación.
10. Verificar carga offline de CLIP/clasificador/Grad-CAM y procedencia de fixture positiva no clínica en una preparación separada, sin registrar todavía aprobación de CN-05. Si fallan, detener ese caso y conservarlo pendiente.

### 8.2 Comandos focalizados para una etapa posterior

**No ejecutados en esta auditoría.** Son puntos de partida basados en suites existentes, no diez pruebas definitivas ya implementadas.

Desde `backend`, ejecutar métodos en procesos separados cuando usen stubs de importación para evitar contaminación de `sys.modules`:

```powershell
.\venv\Scripts\python.exe -B -m unittest -v test_patient_registration_validation.PatientRegistrationValidationTests.test_all_invalid_fields_reported_without_database_access
.\venv\Scripts\python.exe -B -m unittest -v test_patient_registration_validation.PatientRegistrationValidationTests.test_birth_date_and_birthday_boundary
.\venv\Scripts\python.exe -B -m unittest -v test_diagnosis_input.DiagnosisInputTests.test_real_format_limits_and_declared_type
.\venv\Scripts\python.exe -B -m unittest -v test_diagnosis_input.DiagnosisInputTests.test_clip_success_rejection_and_every_failure_is_closed
.\venv\Scripts\python.exe -B -m unittest -v test_auth_security.AuthSecurityTests.test_strict_admin_plus_ophthalmologist_requires_clinical_grant_source
```

Los métodos de autorización HTTP anteriores son regresión complementaria: completar CB-01 con la suite directa propuesta. Revisar también el consumo de memoria del test de imágenes antes de ejecutarlo. No ejecutar suites con DDL/descartes como parte de estas selecciones sin autorización específica de sus fixtures.

Desde `frontend`, sin descarga de dependencias:

```powershell
.\node_modules\.bin\vitest.cmd run src/test/b1ReportPatientContext.test.tsx
.\node_modules\.bin\vitest.cmd run src/test/b1ReportVisits.test.tsx
.\node_modules\.bin\vitest.cmd run src/test/authLogin.test.tsx src/test/moduleRoutes.test.tsx
```

Para formalizar CB-01/CB-04/CB-05 falta crear/adaptar suites focalizadas con las aserciones enumeradas. Para CB-03 falta un runner seguro de integración seleccionado; no ofrecer un comando que omita las verificaciones de identidad de la instancia. No utilizar discovery global ni `--run-disposable` como atajo.

## 9. Estrategia de evidencias auténticas

### 9.1 Estructura y trazabilidad propuestas

Fuera de este modo Plan, usar una raíz autorizada de artefactos sin datos reales, por ejemplo:

```text
<evidencias>/<RUN-ID>/
  manifiesto.md
  CN-01/ ... CN-05/
  CB-01/ ... CB-05/
```

`RUN-ID`: fecha/hora UTC y sufijo único. Cada ficha debe registrar código, variante `S01...`, requisito acordado, versión Git + cambios locales, entorno/herramientas, actor ficticio, fixtures/hashes, precondiciones, pasos/comando exacto, esperado, obtenido, aserciones, fecha/hora, duración, código de salida, estado y rutas de evidencia. Estados: **Pendiente**, **Bloqueado**, **Aprobado**, **Fallido**; usar Aprobado solo tras ejecución completa de sus variantes obligatorias. Un error esperado en una variante negativa no es por sí mismo un fallo del caso.

Conservar manifiesto de hashes SHA-256 de PNG/log/XML/reportes y fixtures publicables; capturas originales inalteradas, y copias recortadas/anotadas solo si se identifican como derivadas. Reutilización de una fixture no implica reutilización de resultados. No fabricar valores de obtenido para rellenar la tesis.

### 9.2 Caja negra

- Capturar **navegador real** (Chrome/Edge) con URL, contexto del paciente/visita ficticios, entradas no sensibles y salida visible. Usar Recortes de Windows o mecanismo real del navegador; el operador tendrá que hacerlo, pues esta sesión no dispone de control de navegador.
- Una captura no prueba toda la secuencia: mantener pasos numerados, capturas antes/después y ficha del recorrido; video/trace opcional si se autoriza una herramienta.
- Esperar resultados/cargas estables. No usar capturas de jsdom ni renders aislados para afirmar E2E. No confundir vista previa de imagen con análisis o persistencia completados.
- No incluir contraseñas, JWT, cookies, localStorage, URLs privadas, dumps, directorios clínicos reales ni pantallas con pacientes ajenos a fixtures. Un HAR/trace de navegador puede contener todo lo anterior: no publicarlo sin control/sanitización.
- Las entradas gráficas sintéticas de prueba son datos declarados de fixture; **no** se permite generar una imagen para aparentar una captura de interfaz o un resultado de IA no ejecutado.

### 9.3 Caja blanca

- Conservar archivo de prueba exacto, fuente objetivo y mapeo método → condición/rama → aserción. Documentar qué se simuló y qué código fue real.
- Capturar consola auténtica con comando, métodos, resumen y timestamp; acompañar log textual completo y código de salida. No editar una consola para aparentar éxito ni tomar una captura antes de que termine el proceso.
- Para cobertura, incluir configuración/comando y reporte real con archivos/funciones incluidos, líneas no cubiertas y denominador. La cobertura global del repositorio no es la métrica de un caso focalizado. `trace` debe etiquetarse como líneas, nunca como ramas.
- En CB-03 incluir resultados de las aserciones de conjuntos y conteos sobre fixtures; en CB-05 diferenciar «se llamó rollback» de «no hay residuos en otra sesión MySQL» y de «commit incierto». Reportar limitaciones aun cuando las unitarias aprueben.
- No atribuir cobertura de IA a funciones sustituidas por mocks ni contabilizar como evaluado el código de una dependencia no ejecutada.

## 10. Riesgos, dependencias y limitaciones

1. **No hay entorno de ejecución seguro confirmado.** No se consultaron servicios activos, credenciales ni datos para suplirlo. Las cinco CN están condicionadas por esta razón, aunque el navegador esté presente.
2. **Esquema instalado desconocido.** El modelo/código y documentos históricos no prueban instalación de índices, columnas de procedencia, versiones ni extensión de descarte. No modificar esquema para ocultar esa dependencia.
3. **Filtros heterogéneos:** listado de informes por visita/paciente y detalle/historial tienen predicados distintos. CB-03 debe explicitar qué contrato se verifica; registrar divergencias contra requisito.
4. **IDs legacy ambiguos:** especialmente detalles de diagnóstico. Preferir ID explícito por visita y fixtures no coincidentes.
5. **Varias escrituras por lote:** `useReports.saveAll` reutiliza visita entre POST, pero no revierte éxitos previos si falla un tipo posterior. CN-03 usa un solo tipo como variante base.
6. **Commit incierto:** 500 o timeout no significa ausencia de datos. No repetir automáticamente alta de informes/IA; consultar y conciliar con permiso en entorno de pruebas.
7. **IA no validada dinámicamente:** caché/checkpoint presentes no demuestran inferencia correcta. Puede haber descarga implícita, falta de memoria/CPU o rechazo semántico de fixture sintética.
8. **Límite ético de CN-05:** no se autorizó información clínica real como evidencia. Una fotografía pública/desidentificada sigue siendo imagen clínica y no se incorpora por defecto; requiere decidir un alcance compatible con la regla del usuario, no asumir consentimiento.
9. **Herramientas faltantes:** E2E automatizado y cobertura de ramas requieren preparación opcional autorizada; pytest no es necesario para las suites unittest existentes.
10. **Pruebas con efectos:** algunos tests locales crean/borran tablas en SQLite o administran MySQL desechable. No ejecutarlos indiscriminadamente ni considerarlos solo lectura porque su nombre empiece con `test_`.
11. **Datos de fixtures y documentación:** revisar semillas antes de exponerlas; no publicar resultados/cifras antiguas como nuevas. Los PDFs temporales existentes no se inspeccionaron ni reutilizaron.
12. **Alcance clínico:** estas pruebas funcionales/estructurales no establecen seguridad clínica, cumplimiento normativo integral ni exactitud del modelo. El consentimiento es una declaración de archivo físico, no verificación de representantes legales (`patients/README.md`).
13. **Cambios previos del usuario:** conservar los dos archivos modificados ya identificados; registrar huella de las fuentes relevantes si se necesitan resultados reproducibles sobre árbol no limpio. No revertirlos ni hacer commits automáticos.

## 11. Orden recomendado y criterio de salida de la siguiente etapa

1. **Aprobar el plan/alcances**: CN-03 reformulado, contrato de filtros CN-04/CB-03, frontera unitario/integración CB-05 y fixture positiva CN-05. Cambiar a un agente con permisos de implementación si se van a crear suites, lanzador o mover el documento al repositorio.
2. **Preparación sin datos reales**: fixtures, aislamiento, manifiesto, política de evidencias; incorporar herramientas adicionales solo si se aprueban. Cualquier DDL de instancia nueva necesita autorización separada; nunca migraciones de la habitual.
3. **CB-01 → CB-02 → CB-04 → CB-05 unitarios**: primero lógica determinista sin servicios; establecer captura/log y cobertura de líneas real. Corregir tests/infraestructura solo dentro de alcance autorizado; no modificar funcionalidades durante una etapa de evaluación.
4. **CB-03 y ampliación opcional CB-05** en MySQL aislado: verificar filtros/asociación/atomicidad física antes de los recorridos con escrituras de UI.
5. **CN-01**: validar sesiones y restricciones antes de registrar pacientes o procesar imágenes.
6. **CN-02 → CN-03 → CN-04**: alta sintética, visita/informe y consultas con fixtures controladas. Compartir fixtures solo con trazabilidad y precondiciones restablecidas.
7. **CN-05 al final**: modelos reales y fixture apta; resultado y errores, sin datos clínicos reales ni inferencia simulada presentada como auténtica. Si está bloqueado, documentar causa y decidir CN-05A de forma explícita.
8. **Cierre documental**: revisar evidencias, hashes, privacidad, variantes pendientes y reporte de cobertura; consolidar exactamente cinco CN y cinco CB, distinguiendo subcasos de casos. No declarar diez aprobadas si falta cualquier ejecución obligatoria.

### Criterio de salida

Cada caso debe tener ejecución nueva trazable, precondiciones confirmadas, aserciones/esperados acordados y evidencia auténtica. Una CN necesita comportamiento observable en sistema real aislado; una CB necesita comprobaciones de lógica interna explícitas. Si algo falla, registrar el resultado real y la incidencia; no cambiar el código funcional o fabricar evidencias para completar el número solicitado.

## 12. Verificación realizada en esta intervención

- Lecturas/search estructural y textual focalizadas; revisión de fuentes/pruebas/documentación enumeradas.
- Inventario de versiones por metadatos Python/JSON local; existencia de Chrome/Edge/MySQL/checkpoint/cachés y runtimes.
- `git status --short` y referencia HEAD para identificar el estado auditado.
- **No se ejecutaron** unittest, Vitest, E2E, inferencias, migraciones, scripts de reinicialización ni consultas a DB; no se instalaron dependencias, arrancaron servicios, modificaron funcionalidades o revelaron secretos.
- Único archivo creado por esta intervención: el presente Markdown en el directorio permitido de planes. Las pruebas, scripts y artefactos futuros identificados como propuestos **no se crearon**.
