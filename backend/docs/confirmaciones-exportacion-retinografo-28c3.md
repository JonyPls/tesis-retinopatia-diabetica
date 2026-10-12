# 28C.3 — registro, consulta y revocación (sin inferencia)

Las 14 rutas B1 anteriores no cambian; se añaden **tres operaciones B1** en el
blueprint de diagnóstico. Las tres exigen Bearer, cuenta y rol `OFTALMOLOGO`
activos y `pacientes.ver` + `imagenes.ver` activos **desde el mismo rol**.
Administrador solo, enfermero y asistente no pueden utilizarlas. Una
confirmación concreta solo puede consultarla o revocarla su confirmador. No se
exige `diagnostico_retinopatia.crear` hasta la inferencia futura.

## Contratos (JSON, sin comprobantes en URL)

- `POST /api/diagnosticar/retinografo/confirmaciones`: JSON exacto con
  `paciente_id` entero positivo, `nombre_exportacion` (nombre candidato),
  `ojo_confirmado` (`Derecho` o `Izquierdo`), `sha256_previsualizacion` (64
  caracteres hexadecimales) y `confirmo_asociacion: true`. Ejemplo sintético:
  `{"paciente_id":101,"nombre_exportacion":"00000000_01012026_101010_fundus_R_1.jpg","ojo_confirmado":"Derecho","sha256_previsualizacion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","confirmo_asociacion":true}`.
  Respuesta **201**: `{"success":true,"confirmacion":{"identificador":"<secreto aleatorio de 64 hex>","paciente_id":101,"ojo_confirmado":"Derecho","estado":"CONFIRMADA","fecha_expiracion":"<UTC ISO-8601>"}}`.
- `POST /api/diagnosticar/retinografo/confirmaciones/estado`: JSON exacto
  `{"identificador":"<secreto recibido al crear>"}`. Respuesta **200**:
  paciente, ojo, estado persistido, `vigente`, `expirada` y `fecha_expiracion`.
  Vigencia solo si `CONFIRMADA` y no ha transcurrido la expiración. No cambia
  automáticamente el estado en MySQL.
- `POST /api/diagnosticar/retinografo/confirmaciones/revocar`: mismo JSON.
  Respuesta **200** si `CONFIRMADA`, vigente y del mismo oftalmólogo: conserva
  revocador y hora UTC. **409** si ya revocada, consumida o expirada. Se bloquea
  la fila con `SELECT ... FOR UPDATE` para serializar revocaciones; no se borra
  evidencia ni copia privada. Otros profesionales y comprobantes inexistentes
  reciben el mismo **404**, sin enumeración de ID secuenciales.

Todos los campos son obligatorios; se rechazan extras, incluido `confirmado_por`,
`revocada_por`, rutas y fechas. El usuario siempre proviene del JWT validado y
de sus roles/grants actuales en MySQL. Respuestas `private, no-store`, incluso
401/403. Las nuevas rutas no aceptan parámetros query. 400 solicitud inválida,
401/403 autenticación/autorización, 404 paciente/exportación/comprobante no
accesible, 409 discrepancia de ojo/hash/estado, 413 petición/imagen demasiado
grande, 422 imagen corrupta/no admisible, 503 exportaciones o almacenamiento
indisponibles, 500 error de persistencia (incluido commit incierto). Nunca se
devuelven rutas internas, identificadores de copia, hash verificador ni detalles
de SQL.

## Bytes, copia y trazabilidad

Se consulta un paciente activo; documento en nombre y R/L solo identifican una
**candidata**. Un ojo observado distinto al sugerido se rechaza (409), no se
corrige solo. `read_export` de 28A lee por descriptor confinado y valida
JPEG/PNG/TIFF, tamaño y dimensiones. El SHA-256 del cliente solo compara la
previsualización; el servidor calcula y persiste el suyo **sobre los mismos
bytes** que escribe a la copia. El hash no certifica origen del retinógrafo ni
pertenencia clínica. No se reabre la fuente después de verificarla.

La ubicación privada se configura explícitamente en Flask con
`RETINOGRAPH_PRIVATE_DIR`: **ruta absoluta preexistente**, fuera de `uploads` y
de cualquier directorio servido por HTTP, con ACL/permisos de directorio
limitados al servicio. Si falta o no es segura, el registro falla cerrado con
503. En Windows se comprueban ancestros sin reparse points y se mantienen
handles mientras se escribe; en POSIX se usan descriptores de directorio con
`O_NOFOLLOW` y `dir_fd`. Archivos nuevos usan creación exclusiva y, donde el
filesystem lo permite, hard link atómico para publicar. La clave es aleatoria
de 128 bits, no procede del nombre del paciente ni del comprobante. La copia
se verifica en tamaño y SHA-256 antes y después de publicarse; no se ofrece
ninguna ruta HTTP para leerla. Directorio y almacenamiento subyacente deben
estar protegidos frente a escritores externos; las pruebas de POSIX siguen
pendientes de ejecución en Linux.

El comprobante usa 256 bits de entropía CSPRNG; MySQL guarda solo
`SHA-256(bytes.fromhex(comprobante))` en `BINARY(32)`. Es sensible y no va en
logs, URL ni nombre de archivo. Se entrega **una sola vez** al crear: si se
pierde la respuesta, no puede reconstruirse desde su verificador. Una futura
consulta de conciliación requeriría un diseño autorizado específico; no se
implementa búsqueda por paciente, documento o nombre.

Se publica la copia antes de `INSERT`/`flush`/`commit`. Fallos previos al commit
revierten MySQL y compensan únicamente archivos propios cuya identidad de
filesystem aún coincide. Si `commit` devuelve un resultado incierto, se
conserva la copia: **MySQL y filesystem no son atómicos**. No existe limpieza
automática. Copias caducadas solo son candidatas a conciliación controlada
después de 24 horas; retención clínica definitiva pendiente de política
institucional. La asociación de imagen es diferente de la validación posterior
de la predicción IA.

**Pendiente 28C.4:** comprobación transaccional de paciente/ojo/usuario, estado,
vigencia, hash de fuente y copia, y consumo ligado al detalle de diagnóstico.
El `POST /api/diagnosticar` sigue inalterado y Selección Auto **bloqueada**.
Estas operaciones materializan la historia refinada de revisión profesional de
exportaciones; no cambian los requerimientos originales de la tesis.
