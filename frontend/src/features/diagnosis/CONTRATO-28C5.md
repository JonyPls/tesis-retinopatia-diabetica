# Confirmación visual de exportaciones — 28C.5

La selección automática solo presenta candidatas. Cada ojo exige un clic expreso
de revisión paciente–imagen–ojo. Se descarga el Blob por el cliente Axios con
Bearer; el hash Web Crypto se calcula sobre los bytes originales del archivo
creado desde ese Blob, no sobre la vista TIFF renderizada en canvas. Si la vista
o SHA-256 no están disponibles, no se registra la asociación.

Los contratos JSON reales de registro, estado y revocación están en
`backend/docs/confirmaciones-exportacion-retinografo-28c3.md`. Solo el registro
envía `confirmo_asociacion: true`. El multipart de inferencia confirmada usa
`confirmacion_exportacion` y nunca `imagen`; la carga manual hace lo contrario.
El comprobante existe únicamente en un ref del hook de diagnóstico, ligado al
paciente, ojo, archivo y nombre candidato; no se guarda en almacenamiento de
navegador, URL, estado global ni logs. Cambiar de contexto descarta su referencia
local, **no** revoca la fila MySQL ni prueba que una solicitud pendiente haya
fallado. La revocación requiere acción expresa y respuesta del servidor.

Tras un POST incierto con comprobante, la consulta de estado puede informar
`CONSUMIDA`, pero no devuelve IDs de visita o detalle: no se inventan ni se
reintenta el POST. El profesional debe consultar el historial si no conoce la
visita. Si se pierde la respuesta inicial del registro tampoco puede
recuperarse el comprobante del hash almacenado: hace falta una nueva revisión
expresa. Confirmación de imagen, resultado IA y validación médica son estados
distintos. Los Vitest del frontend simulan HTTP; la integración Flask–ORM/MySQL
aislada de 28C.4 verifica el backend, no un navegador conectado a MySQL real.

## Regresiones backend pendientes de quedar permanentes

El arnés `backend/b1_orm_mysql_trial.py` prueba actualmente HTTP 503 de CLIP
con `infer.assert_not_called()` y `estado == CONFIRMADA`, pero en ese punto no
aserta explícitamente `detalle_id is None`, ausencia de diagnóstico/detalle,
JPEG definitivo nuevo y cuerpo HTTP sin datos sensibles; parte de ello se
infiere de comprobaciones posteriores, no constituye una aserción local.
La prueba de ojo validado comprueba 409, ausencia de inferencia, `estado` de
confirmación, `estado_validacion`, `resultado_final_id`, comentario y ausencia
de JPEG *nuevo*, pero su fixture `CORREGIDO` no fija `validado_por` ni
`fecha_validacion` ni compara predicción IA, motivo, fechas, columnas del
diagnóstico padre o bytes de ambos JPEG anteriores. La revisión aislada
reforzada de 28C.4 verificó estos invariantes en memoria y pasó; incorporar
esas aserciones y un fixture con validador/fecha sintéticos en un cambio backend
focalizado posterior, sin ampliar este trabajo frontend.
