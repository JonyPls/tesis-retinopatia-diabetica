# 28C.6 — verificación y límites del flujo

## Contratos contrastados con código

`GET /api/diagnosticar/retinografo/auto-seleccion/<paciente_id>` devuelve
`{success:true,data:{paciente_id,encontradas,imagenes:{OD,OI}}}`; cada candidata
contiene `filename`, `ojo` (`OD`/`OI`), `ojo_original` (`R`/`L`),
`tipo_imagen`, `secuencia`, `extension`, `fecha_exportacion` e `mime_type`.
`GET /api/diagnosticar/retinografo/imagen` recibe `paciente_id` y `filename`
en la query, devuelve los bytes originales como Blob bajo Bearer; jamás recibe
JWT ni comprobante en la URL.

`POST /api/diagnosticar/retinografo/confirmaciones` recibe JSON exacto
`paciente_id`, `nombre_exportacion`, `ojo_confirmado` (`Derecho`/`Izquierdo`),
`sha256_previsualizacion` (64 hex, admite mayúsculas) y
`confirmo_asociacion:true`. Devuelve 201 y `confirmacion` con `identificador`
(64 hex minúsculas), paciente, ojo, `estado:CONFIRMADA` y
`fecha_expiracion` (ISO UTC con `Z`). El backend compara SHA-256 contra
la exportación abierta de nuevo y publica la copia privada antes del commit.
`POST .../confirmaciones/estado` y `POST .../confirmaciones/revocar` reciben
solo `{identificador}` en JSON, no query; el estado contiene paciente, ojo,
`estado` (`CONFIRMADA`, `REVOCADA`, `CONSUMIDA`), `vigente`, `expirada` y
`fecha_expiracion`. La expiración es bandera temporal, **no** un cuarto estado
persistido. Revocar solo una confirmación vigente y no consumida devuelve 200;
para consumida/expirada devuelve 409, ajena o inexistente 404.

`POST /api/diagnosticar` usa multipart: manual = `imagen` + paciente/ojo;
confirmada = `confirmacion_exportacion` + paciente/ojo, **sin** `imagen`.
`visita_id` opcional o `diagnostico_id` como alias histórico del ID de visita,
no ID del padre; el alias requiere diagnóstico existente. El cliente usa
`visita_id`. La respuesta exitosa devuelve `data.visita_id`, `detalle_id`,
`diagnostico_codigo`, probabilidades y referencia Grad-CAM; el historial
`GET /api/diagnosticar/visita/<visita_id>/detalles` presenta el resultado
persistido por ojo, independiente de la validación médica. Axios envía FormData
como multipart y Flask lee sus textos de `request.form` y solo `imagen` de
`request.files`; las pruebas Flask ejercitan el parser real con ambos modos.
La autorización Bearer la aplica el interceptor y B1 en cada ruta; 401
invalida la sesión, 403 no la cierra. Entre fallos: 400 entrada, 404
inaccesible, 409 conflicto/cambio/consumo, 413 tamaño, 422 imagen técnica o
semánticamente rechazada, 500 persistencia incierta y 503 infraestructura o
CLIP indisponible. No hay inferencia por simple selección ni reintento
automático de POST clínico.

## Cobertura ejecutada y no ejecutada

El ensayo MySQL 8 desechable verifica identidad/version/puerto/datadir/UUID
y destino de conexión antes de aplicar el maestro solo al datadir recién
creado: 15 tablas, 64 pruebas Flask–ORM/MySQL reales, 0 fallos/errores. CLIP
y ResNet50 están sustituidos; archivos y usuarios son sintéticos, y JPEG,
exportaciones y copia privada viven en directorios temporales. Cubre carreras
de confirmación, revocación, consumo y ojo duplicado (200/409), commits
inciertos y rollback. Se añadieron al arnés snapshots íntegros del detalle y
padre, validador/fecha/motivo sintéticos, comparación byte a byte de original
y Grad-CAM, y ausencia de persistencia/filtración ante 503 CLIP. La suite
backend unittest: 131 OK, 16 expected failures. Vitest: 128/128 (Axios
simulado); TypeScript pasa. **No es una ejecución de navegador contra Flask**:
el repositorio no incluye Playwright, Cypress, Selenium ni arnés que levante
frontend y backend aislados juntos; no se instalaron dependencias. En
particular, la experiencia de login, vista real OD/OI, liberación real de
Blob URL, CORS y Web Crypto del navegador no se observaron contra HTTP real.

## Configuración / ensayo manual Windows (solo entorno aislado)

1. Preparar una instancia MySQL 8 desechable, nunca la habitual, con datadir
   nuevo bajo el directorio temporal aprobado y puerto libre de loopback.
   Confirmar `@@version`, `@@port`, `@@datadir`, `@@server_uuid`, esquema y
   destino **antes** del maestro. `b1_mysql_disposable_trial.py
   --run-disposable --orm-integration` automatiza ese aislamiento y apaga la
   instancia; no proporciona un servidor persistente para un navegador.
2. Crear carpetas absolutas y separadas, p. ej. tres subdirectorios temporales
   distintos para exportaciones sintéticas, copia privada y JPEG. Asegurar
   permisos de escritura solo al proceso backend y no servir la carpeta
   privada por HTTP. No usar `uploads`, la carpeta estática, symlinks,
   junctions ni datos reales. Los nombres de copia se generan en servidor;
   nunca utilizar un nombre aportado por el navegador como ruta privada.
3. Para levantar Flask de forma aislada hace falta configurar explícitamente
   `app.config['RETINOGRAPH_PRIVATE_DIR']` con la ruta absoluta **preexistente**,
   y apuntar el ORM solo al MySQL temporal, las exportaciones y los JPEG a
   las carpetas temporales, y reemplazar CLIP/IA por dobles deterministas.
   El `backend/app.py` actual **no** transfiere `RETINOGRAPH_PRIVATE_DIR` desde
   `os.environ` a `app.config`: definir `$env:RETINOGRAPH_PRIVATE_DIR` en
   PowerShell no resuelve el bloqueo. `RETINOGRAPH_EXPORT_DIR` sí se lee del
   entorno al importar el servicio; los JPEG se inicializan según el working
   directory de `diagnosis_service.py`. Se requiere un arranque de pruebas
   aprobado que inyecte esas rutas sin editar `.env` ni producción; no iniciar
   `backend/app.py` habitual contra la base real para probar este flujo.
4. Con frontend (`http://localhost:5173`), backend aislado y CORS autorizado,
   entrar como oftalmólogo sintético. Buscar paciente sintético, elegir visita
   vacía, Selección Auto, comprobar vistas R/L y cero POST clínicos; confirmar
   cada ojo separadamente y contrastar hash SHA-256 de cada respuesta Blob,
   vigencia, POST multipart sin archivo, resultado de ambos ojos, `CONSUMIDA`
   y detalle/historial, dejando validación médica pendiente. Usar DevTools
   para verificar que URLs solo llevan `paciente_id`/`filename` en descarga,
   jamás JWT/comprobante, y que las blob URLs se revocan al cambiar contexto.
   En casos sintéticos separados: revocación previa, expiración, cambio de
   paciente durante GET, token de ojo ajeno, POST incierto sin reintento y
   modalidad manual. No repetir POST inciertos sobre una visita sin conciliar.

En Linux no se ensayaron permisos/ACL del filesystem, confinamiento
`O_NOFOLLOW`/`dir_fd`, hard links, CORS ni el flujo visual en navegador.
La copia privada requiere carpeta absoluta existente no pública; el backend
rechaza raíces dentro de `uploads` y de la carpeta estática, y el operador
debe protegerla también frente a otros escritores privilegiados. La consulta
`CONSUMIDA` no incluye `visita_id` ni `detalle_id`: no reconstruir respuestas
perdidas ni equiparar consumo a validación médica. Si se pierde la respuesta
de creación, el verificador almacenado no permite recrear el comprobante.
