# 81–82 — Visitas recientes y reanudación de correcciones pendientes

El selector de Diagnóstico IA admite solo ACTIVA, fecha UTC verificada en el
intervalo inclusivo [ahora - 24 horas, ahora] y sin resultados IA registrados.
El endpoint sigue limitado al paciente solicitado y protegido por B1; no se
modificaron backend, permisos, fechas ni datos MySQL. ACTIVA/CERRADA/ANULADA son
los estados del modelo y del contrato inspeccionado. Estados ausentes o
desconocidos quedan excluidos. Se mantienen UTC/Lima y la opción Nueva visita.

Se retiró del selector la excepción basada en marcadores de descarte que permitía
mostrar visitas con IA o fuera de plazo. El marcador no acredita elegibilidad.
No se añadió historial ni edición de diagnósticos antiguos.

## Compatibilidad con Prompt 75

Se conserva la consulta independiente mediante «Consultar corrección pendiente»:
el marcador de la misma pestaña conserva actor/visita/UUID y permite consultar
el estado sin seleccionar una visita, sin POST/replay ni liberar el marcador.
La ausencia NO_CONFIRMADA sigue sin demostrar fracaso terminal.

## Reanudación excepcional implementada en Prompt 82

La limitación de 81 se resuelve con «Reanudar corrección pendiente», una acción
discreta junto a la consulta y disponible solo con marcador válido del usuario
autenticado y permiso local de descarte. No requiere que la visita aparezca en el
selector ni la agrega a sus opciones. No abre un historial general.

La acción consulta de nuevo el estado de la operación, incluso si hay una copia
confirmada en memoria. Usa exclusivamente GET existentes para verificar el UUID,
visita, revisión, detalles actuales, identidad clínica del paciente y metadatos de
la visita; vuelve a comprobar el contexto y el plazo antes de adoptarlos. Solo
reanuda una operación CONFIRMADA sobre una visita ACTIVA, con fecha UTC verificada
dentro de las últimas 24 horas, sin informes ni incompatibilidades acreditadas.

Tras verificar, reconstruye paciente/visita y resultados vigentes desde backend,
conserva el resultado y la validación del otro ojo y vuelve al Paso 2 en la misma
visita. No recupera fotografías ni borradores desde sessionStorage: su formato
actor/visita/UUID sigue intacto. No sustituye archivos o resultados locales, ni una
selección manual cuya vista previa aún se esté generando. Se bloquean operaciones
clínicas durante la reanudación y se rechazan respuestas tardías de otro contexto
o sesión. El marcador se retira solo después de adoptar el contexto verificado.

NO_CONFIRMADA, 403/404, incertidumbre o inelegibilidad conservan el marcador y el
bloqueo de la evaluación afectada. Se puede volver a consultar, nunca repetir
automáticamente el POST. Las visitas vencidas, cerradas/anuladas o no verificables
no se habilitan para continuar; se muestra el motivo. No borrar sessionStorage ni
fabricar marcadores para forzar acceso. La limpieza física sigue siendo explícita
y no forma parte de esta recuperación.

Las visitas 15–21 de PRUEBA79 tienen IA y no sirven como selección ordinaria.
Para probar manualmente «Corregir fotografías», elegir Nueva visita para el
paciente de prueba y usar el botón en Paso 3 sin abandonar esa evaluación.

Verificación de 81: 173 tests frontend focalizados aprobados (8 archivos), incluidos
estados, límites inclusivos de 24 h, UTC/Lima, contexto de paciente, navegación,
corrección y marcadores de recuperación. TypeScript y Vite build aprobados;
`git diff --check` sin errores. Sin conexiones MySQL, inferencias/descartes reales,
reinicios de servidores, cambios B1/backend clínico, commits ni push.

Verificación de 82: 233 tests frontend focalizados aprobados (9 archivos), incluidos
recarga confirmada/incierta, selector intacto, cambios de usuario/contexto,
inelegibilidad, ausencia de marcador, respuestas tardías, conservación del otro
ojo, estado fresco, doble clic, bloqueo durante recuperación y vista previa
manual pendiente. TypeScript y Vite build aprobados; `git diff --check` sin errores.
Recorrido real en navegador/API no ejecutado en este prompt. Sin MySQL, inferencias,
descartes reales, nuevos endpoints, cambios B1/Informes, reinicios, commits ni push.
