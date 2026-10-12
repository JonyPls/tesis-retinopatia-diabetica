# Recuperación de resultados por ojo (27D)

Antes: el hook envía OD y luego OI; guarda el ID de visita solo en una variable
local. Un fallo en OI retornaba sin publicar el éxito de OD en pantalla. La vista
de visita podía presentar `resultado_ia_id` como «Decisión médica» aun con
`estado_validacion=PENDIENTE`.

Ahora cada 200 se conserva inmediatamente por ojo y se recuerda la visita.
Después de 409, 500 o pérdida de respuesta, se consulta
`GET /api/diagnosticar/visita/<visita_id>/detalles` si hay ID conocido y permiso.
Solo detalles recibidos en el GET se incorporan como resultados confirmados;
no se reenvía ningún POST. El ojo de persistencia incierta no se reintenta desde
esta pantalla. Si falta el ID tras crear una visita y perder la respuesta, se
bloquea también el otro ojo para no abrir una segunda visita. El historial de
visita sirve para comprobar resultados posteriormente, si se tienen los
permisos de lectura. Un GET 404 significa que no se encontró **diagnóstico**
en esa visita en el momento de la consulta, no que el POST no se confirmará;
401/403 tampoco equivalen a ausencia de datos.

Límite del contrato: si se pierde la respuesta del primer POST que creó una
visita nueva, el cliente no recibe `visita_id` y no puede consultar el GET por
visita ni el GET por ID de diagnóstico sin descubrir previamente la visita en
el historial. Para recuperación determinista posterior haría falta aprobar un
identificador de operación estable o una lectura autorizada que permita localizar
la visita de esa solicitud, sin crear ni repetir la inferencia. La selección
inicial de visitas de este flujo excluye las que ya tienen diagnóstico IA, por
lo que después de salir del flujo la revisión se hace desde el historial.

`maxima_gravedad` puede mezclar grados IA pendientes y grados médicos. La
presentación del resumen advierte ese límite; una separación agregada de ambos
valores requeriría un contrato backend distinto, fuera de 27D.
