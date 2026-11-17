# CODN — Resultados de interfaz con API simulada

Corrida: 20261103T182636Z-cn-81b0037d. 28 comprobaciones: 25 aprobadas y 3 fallidas en el registro inicial de comprobación. CN-01 S06, CN-03 S06 y CN-04 S06 repiten satisfactoriamente S01, S03 y S02, respectivamente. Alcance integral de los cinco CN PENDIENTE; CB-03 BLOQUEADA.

No se ejecutó MySQL ni inferencia real. Los resultados CB históricos se conservan sin reejecutar.

Nota de verificación visual: el PNG de CN-03 S06 muestra el diálogo previo al guardado. El aviso posterior se conserva por lectura del navegador en `CN-03/repeticion-aviso.txt` y está respaldado por el POST 201 del simulador.

## CN-01 — Inicio de sesión y control de acceso

Comprobar los mensajes de acceso, el ingreso a módulos permitidos, la restricción de configuración y el cierre de sesión.

Pendiente: Firma y expiración reales del JWT, recarga de identidad, roles vigentes y autorización del backend sobre una base aislada.

### S01-campos-vacios — FALLIDO

UTC: 2026-11-03T18:28:37.735Z
Esperado: El formulario impide ingreso sin usuario y contraseña
Obtenido: Lectura de mensaje vacía; incidencia de comprobación conservada.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S01-campos-vacios.png

### S02-credenciales-invalidas — APROBADO

UTC: 2026-11-03T18:28:50.266Z
Esperado: Mostrar rechazo de API simulada sin navegar
Obtenido: Usuario o contraseña incorrectos.; permanece en /
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S02-credenciales-invalidas.png

### S03-ingreso-valido — APROBADO

UTC: 2026-11-03T18:29:03.302Z
Esperado: Acceso a dashboard con actor sintético
Obtenido: Dashboard y Actor Sintético visibles
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S03-ingreso-valido.png

### S04-modulo-restringido — APROBADO

UTC: 2026-11-03T18:29:14.343Z
Esperado: Configuración no accesible para actor clínico; redirigir
Obtenido: URL final http://127.0.0.1:4187/dashboard
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S04-modulo-restringido.png

### S05-cierre-sesion — APROBADO

UTC: 2026-11-03T18:29:16.406Z
Esperado: Ruta protegida vuelve al login después de cerrar sesión
Obtenido: Login visible al abrir /pacientes sin sesión
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S05-cierre-sesion.png

### S06-repeticion-validacion-nativa — APROBADO

UTC: 2026-11-03T18:43:45.512Z
Esperado: Bloquear envío sin credenciales mediante validación nativa HTML
Obtenido: El navegador mostró Completa este campo, los dos inputs required tienen valueMissing=true y permanece en /
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-01/CN-01-S06-repeticion-validacion-nativa.png

## CN-02 — Registro y validación de pacientes

Comprobar campos obligatorios, alta visible, presentación de duplicado y rechazo de fecha futura.

Pendiente: Unicidad y almacenamiento real en MySQL, reglas del servicio y lectura desde una nueva sesión de backend.

### S01-obligatorios — APROBADO

UTC: 2026-11-03T18:29:38.918Z
Esperado: Errores por campos vacíos; no alta
Obtenido: Mensajes de DNI, nombres, apellidos, sexo, fecha y consentimiento
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-02/CN-02-S01-obligatorios.png

### S02-alta-simulada — APROBADO

UTC: 2026-11-03T18:30:36.319Z
Esperado: Mensaje de alta y fila Celia en listado
Obtenido: Tres pacientes; Celia Prueba Sintética 90000003 visible
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-02/CN-02-S02-alta-simulada.png

### S03-duplicado-simulado — APROBADO

UTC: 2026-11-03T18:31:01.212Z
Esperado: Mostrar conflicto sin segunda alta
Obtenido: Mensaje de documento duplicado de API simulada
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-02/CN-02-S03-duplicado-simulado.png

### S04-fecha-futura — APROBADO

UTC: 2026-11-03T18:31:17.547Z
Esperado: Rechazar fecha futura en frontend
Obtenido: La fecha de nacimiento no puede ser futura.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-02/CN-02-S04-fecha-futura.png

## CN-03 — Creación de visita mediante informe clínico

Comprobar el flujo Nueva visita a partir del registro de un informe clínico.

Pendiente: Creación transaccional real de visita, informe y versión inicial; commit y persistencia relacional.

### S01-nueva-visita — APROBADO

UTC: 2026-11-03T18:31:40.413Z
Esperado: Paciente A y Nueva Visita seleccionados
Obtenido: Ana Prueba Sintética; Nueva Visita elegida
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S01-nueva-visita.png

### S02-informe-incompleto — APROBADO

UTC: 2026-11-03T18:31:51.620Z
Esperado: Guardar Todo permanece deshabilitado sin valores
Obtenido: Guardar Todo deshabilitado
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S02-informe-incompleto.png

### S03-guardado-simulado — FALLIDO

UTC: 2026-11-03T18:32:03.302Z
Esperado: Confirmación de 1 informe registrado
Obtenido: Informes guardados; 1 informe(s) registrado(s) correctamente.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S03-guardado-simulado.png

### S04-reconsulta-historial — APROBADO

UTC: 2026-11-03T18:34:04.174Z
Esperado: Historial A incluye nueva visita del informe
Obtenido: Cuatro visitas; enlace a visita 905 visible
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S04-reconsulta-historial.png

### S05-paciente-control — APROBADO

UTC: 2026-11-03T18:34:06.208Z
Esperado: B conserva solo VB
Obtenido: Enlaces de visita de B: 1
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S05-paciente-control.png

### S06-repeticion-guardado — APROBADO

UTC: 2026-11-03T18:51:25.976Z
Esperado: Con valores OD 541 y OI 543, mostrar aviso de un informe guardado en nueva visita simulada
Obtenido: Aviso visible Informes guardados; 1 informe(s) registrado(s) correctamente. Captura inmediata y texto del aviso conservados.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-03/CN-03-S06-repeticion-guardado.png

## CN-04 — Consulta de informes clínicos por visita

Comprobar la presentación de informes por visita y el tratamiento de visita vacía y ajena al paciente.

Pendiente: Filtrado SQL, asociaciones y restricciones reales de acceso. La separación de respuestas está predefinida en el simulador.

### S01-listado-V1 — APROBADO

UTC: 2026-11-03T18:34:16.319Z
Esperado: V1 muestra su informe CN04-V1
Obtenido: CN04-V1 visible; CN04-V2 ausente
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S01-listado-V1.png

### S02-detalle-V1 — FALLIDO

UTC: 2026-11-03T18:34:24.074Z
Esperado: Detalle conserva paciente, visita y valores 540/542
Obtenido: Ana Prueba Sintética; 540 y 542 µm; CN04-V1
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S02-detalle-V1.png

### S03-cambio-V2 — APROBADO

UTC: 2026-11-03T18:34:26.098Z
Esperado: Cambio a V2 presenta exclusivamente CN04-V2
Obtenido: CN04-V2 visible; CN04-V1 ausente
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S03-cambio-V2.png

### S04-visita-vacia — APROBADO

UTC: 2026-11-03T18:34:34.028Z
Esperado: Estado vacío explícito para V0
Obtenido: Sin informes clínicos
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S04-visita-vacia.png

### S05-visita-ajena — APROBADO

UTC: 2026-11-03T18:34:51.097Z
Esperado: No mostrar informes de VB bajo paciente A
Obtenido: No se encontró la visita solicitada para este paciente.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S05-visita-ajena.png

### S06-repeticion-detalle — APROBADO

UTC: 2026-11-03T18:50:34.919Z
Esperado: Verificar en el diálogo cargado paciente, valores OD/OI y marcador V1
Obtenido: Diálogo cargado: Ana, 540 µm, 542 µm y CN04-V1; comprobación del contenido completa
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-04/CN-04-S06-repeticion-detalle.png

## CN-05 — Validación y procesamiento de fotografías mediante IA

Comprobar selección y previsualización de archivo, confirmación de ojo, presentación de rechazo y de respuesta positiva artificial.

Pendiente: Validación efectiva de tamaño, dimensiones, región ocular y CLIP; inferencia real ResNet50, Grad CAM, almacenamiento, validación médica y reconsulta completa de detalles.

### S01-sin-archivo — APROBADO

UTC: 2026-11-03T18:35:24.475Z
Esperado: No permitir análisis sin imágenes
Obtenido: Guardar y analizar deshabilitado
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S01-sin-archivo.png

### S02-formato-invalido — APROBADO

UTC: 2026-11-03T18:35:45.518Z
Esperado: Rechazar archivo TXT en cliente
Obtenido: Formato no admitido. Use JPG, PNG o TIFF.
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S02-formato-invalido.png

### S03-previsualizacion — APROBADO

UTC: 2026-11-03T18:35:52.103Z
Esperado: Previsualizar fixture en OD y habilitar envío
Obtenido: OD: Imagen lista para analizar; vista previa sintética
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S03-previsualizacion.png

### S04-confirmacion-ojo — APROBADO

UTC: 2026-11-03T18:35:57.269Z
Esperado: Exigir confirmación de paciente y ojo antes de enviar
Obtenido: Confirmar y analizar deshabilitado hasta marcar revisión
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S04-confirmacion-ojo.png

### S05-rechazo-api-simulada — APROBADO

UTC: 2026-11-03T18:36:43.469Z
Esperado: Mostrar rechazo del análisis sin resultado nuevo de éxito
Obtenido: Validación fallida OD; API SIMULADA; no se ejecutó inferencia
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S05-rechazo-api-simulada.png

### S06-resultado-api-simulada — APROBADO

UTC: 2026-11-03T18:41:29.684Z
Esperado: Mostrar la respuesta artificial de contrato y mantener la validación médica pendiente
Obtenido: La interfaz mostró nivel 2 y 87.5 % definidos por el simulador; imagen abstracta, sin inferencia ni Grad-CAM real
Captura PNG: evidencias/20261103T182636Z-cn-81b0037d/CN-05/CN-05-S06-resultado-api-simulada.png
