# 75 — Recuperación mínima de descartes IA en la misma pestaña

Preparado y deshabilitado por defecto. No cambia flags, `.env`, backend, MySQL,
permisos, comprobantes, modelos DL, limpieza de archivos ni contrato de Informes.
No se realizaron inferencias/descartes reales, migraciones, commits, push o nuevos
servidores. Se conserva el trabajo previo de 72–74.

## Marcador exacto

Clave de **sessionStorage**, separada por usuario:
`codn.discard-recovery.v1.{actorId}`. Valor: lista con hasta 16 marcadores pendientes,
uno por visita; los límites excedidos fallan cerrados, no expulsan un marcador.

```json
[{"version":1,"actorId":1,"visitId":30,"operationId":"11111111-1111-4111-8111-111111111111"}]
```

Esos son los únicos cuatro campos persistidos. La presencia representa pendiente
de conciliación local; no se persiste un resultado CONFIRMADA, revisión, ID de
paciente/padre/detalles, selección de ojos, payload, timestamp ni aceptación.
Tampoco nombres, documento, fotografías, URLs, Grad-CAM, probabilidades, notas,
grados, JWT o credenciales. No hay nuevos datos en localStorage. El journal
completo de 73 continúa exclusivamente en memoria.

El marcador NO autoriza: solo permite construir el GET de una operación, siempre
con la autenticación y B1 vigentes del backend. Formato/version/IDs enteros seguros,
UUID canónico, claves exactas, tamaño y duplicados se validan antes de usarlo.
No se borra automáticamente contenido corrupto o de formato desconocido.

## Creación y retiro

1. Validar revisión/selección/consentimiento/contexto y generar un único UUID.
2. Fusionar marcadores existentes con evidencia pendiente conocida en memoria,
   para no perder otra operación si falta su copia en storage.
3. Escribir únicamente los cuatro campos y comprobar con getItem el contenido
   exacto. Si falla acceso, escritura, cuota o lectura de verificación, NO hacer POST.
4. Registrar el journal síncrono y enviar el POST existente una sola vez.
5. Confirmación normal: aplicar transición selectiva existente y después retirar
   el marcador mediante otra escritura/lectura verificadas. Nunca retirarlo solo
   por recibir 200. Si falla el retiro, permanece pendiente/falla cerrado.
6. Rechazo definitivo 400/401/403/409 de ese único POST: conservar resultados y
   retirar su marcador. No existe POST repetido con ese UUID desde recuperación;
   por tanto no se borra un marcador de una escritura anterior incierta al tratar
   un rechazo de reintento. Mientras hay evidencia pendiente no puede abrirse otra
   operación sobre esa visita.

Si se interrumpe la página después de guardar el marcador pero antes del POST,
puede quedar un marcador sin operación backend. Se conserva de manera conservadora:
no hay un protocolo backend para distinguirlo de una petición todavía en curso.

## Inicialización y recuperación

Solo con capacidad habilitada, en layout se leen los marcadores de la cuenta
autenticada, antes de permitir acciones. Sin habilitación no se lee/escribe este
storage ni se consultan los endpoints nuevos.

- Se consulta `GET /diagnosticar/visita/{visitId}/operaciones-descarte/{operationId}`.
  No se recupera una solicitud POST desde storage y nunca se genera otro UUID para
  esa conciliación. Las consultas por UUID se excluyen mientras otra está en curso.
- Si no hay paciente/visita seleccionados, la confirmación se reconoce y muestra
  sin instalar datos clínicos ni liberar el marcador. Hay una acción real para
  consultar otra vez y se pide volver a seleccionar paciente/visita.
- El selector existente permite reseleccionar las visitas asociadas a marcadores,
  incluso si conservan otro ojo o dejaron la ventana de recientes. No crea visitas
  ni modifica el filtro habitual para las demás.
- Con el contexto correcto seleccionado, se consulta contexto-descarte con su
  `operacion_id` (parámetro ya soportado por 72, útil si el padre quedó vacío y la
  visita era compartida): paciente,
  revisión no anterior a la operación, visita ACTIVA, padre/estado consistentes y
  ausencia de los IDs descartados entre los actuales. El diagnóstico padre real
  nunca se toma del ID de visita.
- Si el journal sigue en memoria, primero se intenta su transición exacta de 73,
  conservando el otro ojo y sus borradores. Si falla por diferencias, no se borra
  ni sustituye una evaluación que siga en memoria: se exige reselección limpia.
- Tras recarga/reselección limpia, se usa el GET de detalles por visita existente
  SOLO para consultar los detalles **actuales** y bloquear los ojos registrados.
  Se comparan IDs/ojo/estado con el contexto; una segunda lectura de contexto
  exige misma revisión, padre y conjunto de IDs/estados antes de adoptar.
- No se restaura una evaluación completa desde el navegador: archivos y previews
  continúan vacíos; no se descargan fotografías ni se reconstruyen confirmaciones
  del retinógrafo. Los resultados/validaciones y comentarios ya PERSISTIDOS que
  muestra el flujo proceden únicamente de esa consulta backend actual, no de
  borradores perdidos. Un detalle nuevo del mismo ojo se conserva por su nuevo ID.
- Solo después de esa adopción se retira el marcador y se permite Paso 2 en la
  misma visita. Si no quedan detalles, no se consulta un padre eliminado y ambos
  ojos quedan disponibles. La fotografía manual vuelve a exigir la revisión de 69.

Las respuestas están ligadas al usuario/sesión (incluida generación de cambios de
autenticación), paciente, visita, versión local y UUID. Cambiar de contexto/sesión
o desmontar impide instalar una respuesta tardía. Se conserva el hecho operativo
para otra consulta, sin aplicar el descarte a un detalle nuevo por compartir ojo.

## Errores y bloqueo proporcional

| Situación | Comportamiento |
| --- | --- |
| POST timeout/404/5xx/éxito no verificable | Conservar identidad y journal, consultar el mismo UUID, bloquear inferencia/validación del contexto. |
| GET NO_CONFIRMADA | Mantener marcador, advertencia y consulta manual. No equivale a rollback. |
| GET 404/403/409/5xx/timeout | No retirar marcador ni convertir en ausencia. Un 403 no expulsa del módulo. |
| Confirmada, contexto ilegible/403/otra persona creadora | Conservar el hecho y el marcador; no instalar ni liberar evaluación no verificable. |
| Contexto cambia durante consulta, otro paciente o IDs antiguos reaparecen | Fallo cerrado; reseleccionar/consultar de nuevo sin POST. |
| Storage inaccesible/corrupto | No nuevas escrituras de Diagnóstico IA hasta verificarlo; no se puede atribuir con seguridad el contenido ilegible a una visita. Los demás módulos y navegación general no se bloquean. |

Con marcador válido solo se excluyen acciones sobre su visita. Otras evaluaciones
y módulos permanecen disponibles. La ausencia en storage no elimina evidencia
pendiente que aún exista en memoria. No hay botón de olvidar, TTL que desbloquee,
replay automático, ni compensación clínica.

`NO_CONFIRMADA` indefinida necesita comprobación/protocolo backend adicional para
acreditar un resultado negativo terminal. Este incremento conserva el bloqueo;
no inventa una cancelación ni permite repetir la operación por timeout.

## Sesión y pestañas

- Recarga de la misma pestaña: recupera UUID; una petición puede seguir en curso.
- Salir del módulo/regresar: journal en memoria y marcador siguen disponibles.
- Logout: no se muestran ni consultan los marcadores anteriores; se conserva su
  clave técnica para que el MISMO usuario pueda volver y reautorizar el GET.
- Otra cuenta: lee exclusivamente su propia clave; ninguna respuesta antigua
  instala datos o mensajes de recuperación de la cuenta anterior.
- Dos pestañas: sessionStorage por pestaña, sin eventos de sincronización ni
  uso de localStorage. Algunos navegadores copian inicialmente sessionStorage al
  abrir desde un opener/duplicar pestaña; ese caso puede duplicar GET del mismo UUID,
  nunca reenvía POST. No se promete un lock global entre pestañas.
- Marcador antiguo: no caduca para desbloquear. Si no puede verificarse, conserva
  el bloqueo y requiere revisión autorizada.
- Cierre de pestaña/navegador, sesión expirada, limpieza o manipulación/eliminación
  deliberada de datos locales NO tienen recuperación garantizada. El storage no
  es una frontera contra código del mismo origen ni reemplaza autorización B1.

No se persiste useDiagnosis completo ni se implementa recuperación histórica,
versionado, historial de operaciones o cambios backend.

## Verificación y activación

Pruebas con HTTP y storage aislados; los fixtures de contrato reales de 74 siguen
vigentes. Las tres caracterizaciones de pérdida de UUID de `diagnosisReload74`
se convirtieron en pruebas de regresión que exigen identidad/bloqueo tras recargar,
no se eliminaron para esconder un fallo. Las pruebas existentes solo añaden
aislamiento de sessionStorage y la nueva conexión de UI.

Compuerta frontend opt-in sin cambio, las tres backend siguen False. Resolver
recarga con mocks NO acredita carreras reales InnoDB, instalación del esquema,
permisos del despliegue o comportamiento de un navegador real. Permanecen pendientes
los ensayos MySQL expresamente autorizados y la revisión visual, sin activación.
No cambiar banderas durante operaciones pendientes sin drenaje y conciliación.

### Resultados ejecutados

- Nuevas pruebas de recuperación: **39/39**, con storage aislado y sin backend real.
- Focalizadas (8 archivos): **162/162**; incluyen corrección, pérdida de memoria,
  adopción de contexto, UI, navegación, integridad, Informes y fixture HTTP de 74.
- Suite completa: **569 casos, 566 correctos y 3 fallos preexistentes** únicamente
  en `diagnosisManualConfirmation.test.tsx`: espera `·` y recibe `|`. Mismos nombres
  comparados con la ejecución del snapshot HEAD `a9028e3` realizada en 74. No se
  cambiaron el modal manual ni esas expectativas.
- `npm run build`: TypeScript y Vite correctos; advertencia de bundle >500 kB.
- ESLint focalizado: no puede cargar `eslint.config.js:15:31`, TypeError sobre
  `recommended`, ya reproducido en HEAD durante 74. No se reparó fuera de alcance.
- `git diff --check`: correcto, solo avisos LF/CRLF. Se comprueba además whitespace
  de los archivos nuevos/no seguidos por Git.
- No hubo prueba de navegador real ni ensayo MySQL, ni se afirma lo contrario.

### Archivos de 75

- `src/features/diagnosis/store/diagnosisDiscardStore.ts`
- `src/features/diagnosis/hooks/useDiagnosisCorrection.ts`
- `src/features/diagnosis/api/diagnosisDiscardService.ts`
- `src/features/diagnosis/hooks/useDiagnosis.ts`
- `src/features/diagnosis/pages/Diagnosis.tsx`
- `src/test/diagnosisRecovery75.test.tsx` (nuevo)
- `src/test/diagnosisReload74.test.tsx`
- `src/test/diagnosisCorrection.test.tsx`
- `src/test/diagnosisResultStep.test.tsx`
- `docs/73_correccion_fotografias.md` y este documento.
