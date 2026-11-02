# 73 — Corrección IA e instantánea de revisión en Informes

## Despliegue: preparado, no activado

La compuerta de compilación `VITE_DIAGNOSIS_DISCARD_ENABLED` solo acepta el texto
exacto `true`. Ausente o con otro valor está apagada. No se ha añadido/cambiado
ningún archivo .env. No habilita tablas, permisos o compuertas backend.

Con la compuerta apagada no se consultan los endpoints nuevos, no aparece la
acción destructiva y el payload de Informes conserva el contrato anterior.

Antes de activarla: migración y DDL verificados en MySQL aislado, aprovisionamiento
autorizado de permisos, prueba de locks multiproceso y limpieza recuperable,
despliegue/drenaje coordinado de todos los escritores y revisión de la UI.
Las tres compuertas backend del Prompt 72 se mantienen en False.

## Diagnóstico IA

El frontend verifica primero el contrato autorizado de contexto de descarte; el
permiso local solo filtra la presentación, no sustituye B1. El botón vuelve a
consultar al abrir el modal. Solo se permiten IDs exactos elegibles y pendientes.
No hay selección ni aceptación automática; cambiar la selección desmarca la casilla.
Cancelar/Escape no escribe. No se piden motivos ni se envían nombres de archivos.

La confirmación genera un UUID una sola vez, conserva la solicitud y bloquea
inferencia, navegación incompatible y validación. Un POST confirmado retira solo
los IDs seleccionados, limpia sus borradores/previews y conserva paciente, visita
confirmada y todo el otro ojo. Se invalida la generación del contexto y se recuerdan
los IDs descartados para que una lectura atrasada no los reintroduzca. El ID real
del padre procede del contexto backend, nunca del alias de visita; al quedar sin
resultados locales tampoco se conserva un padre eliminado como vigente.

La nueva fotografía usa handleSave. Los archivos manuales exigen una revisión
nueva del Prompt 69. Selección Auto y sus comprobantes permanecen sin modificaciones.
No se habilita el descarte de detalles con comprobantes consumidos.

Timeout, respuesta no verificable o 5xx conservan UUID/payload y consultan la
operación autorizada. NO_CONFIRMADA o 404 no prueban rollback: se mantiene el
bloqueo y hay un botón explícito para volver a consultar; no se reenvía el POST.
Un 409 conserva los resultados, consulta elegibilidad y requiere otra decisión
explícita. Un 403 de estas rutas no revoca el acceso general a Diagnóstico IA.

El journal Zustand completo sigue SIN persist: conserva identidad/hecho operativo
al cambiar contexto o desmontar, sin imágenes, probabilidades o decisiones médicas.
Desde el Prompt 75, se conserva además un marcador técnico mínimo en sessionStorage
ANTES del POST y se verifica su lectura. No se persiste el journal/payload completo.
Las respuestas tardías no se aplican a otro paciente, sesión o detalle.

Si los IDs restantes cambian concurrentemente, la transición local falla cerrada:
no elimina ni habilita un resultado nuevo/desconocido. Conserva el hecho confirmado
y exige revisar el contexto; no implementa recuperación histórica general.

La limitación de recarga identificada en 74 se aborda en
[75_recuperacion_descarte.md](75_recuperacion_descarte.md): la misma pestaña recupera
usuario/visita/UUID y consulta el GET, sin replay de POST ni restauración de fotos
o borradores. La adopción del contexto usa IDs vigentes del backend después de
reseleccionar paciente/visita. NO_CONFIRMADA persistente mantiene bloqueo: el
backend no acredita una ausencia terminal. Cierre de pestaña/borrado de datos,
recuperación histórica general y coordinación entre pestañas no se garantizan.
No se garantiza cancelar un commit al cerrar/desmontar una pantalla.

## Informes

Al seleccionar una visita existente se obtiene su revisión y se vincula a paciente,
visita y sesión. No se consulta ni sustituye justo antes de guardar. Cambiar visita
invalida inmediatamente la revisión; las respuestas anteriores se ignoran.

Con capacidad habilitada, POST /informes envía `revision_inferencia_esperada` en
el nivel superior, fuera de datos_estructurados. Falta de disponibilidad o un
conflicto de revisión impiden guardar; requieren reseleccionar/revisar la visita,
sin actualización ni reintento automáticos. La lectura de revisión usa el contrato
de Informes del backend, no requiere permiso de descarte ni propiedad del diagnóstico.

Sin visita, el primer informe conserva el payload anterior. Si el lote continúa
en la visita creada por ese primer informe, envía revisión inicial 0: la visita es
nueva y ya tiene un informe que impide descartes. No se crea otra visita para corregir IA.

En modo apagado no se añade ese campo al envelope ni se transforma/reserva el
contenido de datos_estructurados (incluidas claves históricas homónimas).

## Validación y límites

Pruebas con HTTP simulado, datos ficticios y componentes/hooks reales. Ninguna
prueba de este incremento llama a backend, MySQL, modelos o archivos clínicos.
Radix conserva foco, Escape y teclado; cuerpo con scroll, ancho relativo al viewport
y footer fuera del scroll. Revisión visual real móvil/escritorio y recorrido con
Tab/Shift+Tab pendientes en entorno de demostración autorizado, sin duplicar servidores.

### Resultado de verificación

- `npm run build`: TypeScript y Vite correctos. Advertencia de bundle >500 kB.
- Focalizadas: 30 casos de corrección, 12 de revisión de Informes y 25 del Paso 3
  correctos en la suite final (67/67). También se ejecutaron focalizadas por separado.
- Suite completa: 510 casos; 507 correctos y 3 fallos preexistentes, todos en
  `diagnosisManualConfirmation.test.tsx:107–108`: espera `·`, el componente usa `|`.
  Se verificaron ambas versiones en HEAD; ni la prueba ni el modal manual cambiaron.
- ESLint focalizado: bloqueado al cargar `eslint.config.js:15:31` por
  `Cannot read properties of undefined (reading 'recommended')`. No se reparó la
  configuración ajena al incremento ni se afirma que el lint haya pasado.
- `git diff --check`: sin errores de whitespace; advertencias de conversión LF/CRLF.
- No se realizaron pruebas visuales con navegador real ni pruebas MySQL.

## Endpoints integrados

El cliente tipado `diagnosisDiscardService.ts` valida el envelope y los IDs/revisión
de las respuestas antes de usarlos:

| Método | Ruta (prefijo `/api`) | Uso |
| --- | --- | --- |
| GET | `/diagnosticar/visita/{id}/contexto-descarte` | Disponibilidad, padre real, detalles y elegibilidad |
| POST | `/diagnosticar/visita/{id}/descartar-resultados` | IDs exactos, revisión y UUID del consentimiento |
| GET | `/diagnosticar/visita/{id}/operaciones-descarte/{UUID}` | Conciliar exclusivamente la misma operación |
| GET | `/visitas/{id}/revision-inferencia` | Instantánea de contexto al adoptar visita en Informes |

No se añaden endpoints, dependencias ni cambios backend en el Prompt 73. Se
conservó el trabajo backend previo sin activarlo. No se ejecutaron migraciones,
inferencias reales, descartes clínicos, limpieza de archivos, grants, commits o push.
