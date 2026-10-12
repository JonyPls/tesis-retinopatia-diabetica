# 28C.4 — consumo transaccional durante el diagnóstico IA

**Sin cambios de esquema ni nuevas rutas.** `POST /api/diagnosticar` conserva el
Bearer y las reglas B1 `diagnosis.create` (`OFTALMOLOGO` activo con
`diagnostico_retinopatia.crear` e `imagenes.ver` del mismo rol) y
`diagnosis.create_with_visit` (además `visitas.crear` cuando crea visita). El
frontend continúa bloqueando Selección Auto hasta 28C.5.

## Contrato multipart

- **Manual (anterior):** `paciente_id`, `ojo_evaluado` (`Derecho` o `Izquierdo`),
  `imagen` (archivo), opcional `visita_id` o alias `diagnostico_id` de visita.
  Sigue sujeto a validación de formato/tamaño, CLIP fail-closed, ResNet50,
  Grad-CAM y persistencia 27A–27D. **No adquiere** confirmación ni etiqueta de
  procedencia del retinógrafo; un multipart no acredita su origen físico.
- **Exportación confirmada:** los mismos IDs/ojo, **sin `imagen`**, con campo
  multipart `confirmacion_exportacion` (64 caracteres hexadecimales minúsculos:
  comprobante opaco obtenido en 28C.3). Ejemplo sintético de campos:
  `paciente_id=101`, `ojo_evaluado=Derecho`,
  `confirmacion_exportacion=<comprobante de 64 hex>`. Nunca enviar comprobantes
  por URL. La respuesta exitosa conserva el contrato de diagnóstico original:
  `visita_id`, `diagnostico_id`, `diagnostico_retinopatia_id`, `detalle_id`,
  resultado IA, probabilidades y referencia Grad-CAM.

Ambas modalidades son excluyentes: archivo+comprobante, ninguno, comprobante
vacío/malformado, campos desconocidos/internos o archivos adicionales: **400**.
No existe degradación a manual si el comprobante falla. El backend no usa
`isExistingImage` ni booleanos del navegador para inferir procedencia. B1 se
evalúa antes de leer confirmación/copia/fuente o ejecutar CLIP/IA.

## Vinculación y transacción

La prelectura busca `SHA-256(bytes.fromhex(comprobante))` junto con el ID del
profesional autenticado; los comprobantes ajenos e inexistentes reciben 404.
Comprueba estado `CONFIRMADA`, caducidad UTC exacta, paciente, ojo, nombre
candidato, copia privada y fuente por descriptores seguros. SHA-256 de ambas
debe coincidir con `sha256_fuente`; el backend toma **solo los bytes de la copia**
para las tres validaciones y para IA. Un ojo/paciente incorrecto, una fuente
modificada/retirada o copia alterada bloquean la inferencia (409); copia
inaccesible: 503. Siguen aplicándose los límites y CLIP a la copia.

Después de la IA y de preparar los dos JPEG provisionales, el orden estable
de locks es **confirmación → visita → diagnóstico → detalle**. No se mantiene
ningún lock SQL durante CLIP/ResNet50. Un `SELECT ... FOR UPDATE` de la
confirmación precede a los INSERT del diagnóstico; se reevalúan estado,
caducidad, propietario, paciente y ojo. Después del `flush` del detalle se
vuelven a leer/hashear fuente y copia bajo el lock. Se fija `CONSUMIDA`,
`detalle_id` y fecha UTC, y se hace `flush` **sin commit propio**. El commit
único existente incluye visita/diagnóstico/detalle y consumo; el `UNIQUE` de
`detalle_id` y el lock impiden un segundo consumo. Revocación bloquea solo la
confirmación; si ganó antes del lock de inferencia, esta falla (409). Si ganó
el consumo, revocación posterior falla (409).

La coordinación MySQL–JPEG conserva la publicación sin sobrescritura, rollback,
limpieza de archivos propios y tratamiento conservador de commit incierto de
27B. Un fallo antes de commit deja la confirmación `CONFIRMADA` o, si otra
petición la revocó, `REVOCADA`; no crea detalle. Un commit que sí se confirmó
puede devolver 500 al perderse su acuse: conservar JPEG y copia y consultar
`POST /api/diagnosticar/retinografo/confirmaciones/estado` con el comprobante.
No reintentar automáticamente. `CONSUMIDA` señala que se confirmó un detalle,
pero la consulta actual **no devuelve `detalle_id` ni `visita_id`**. Si se perdió
el ID de una visita nueva, se requiere aprobar una ampliación mínima de la
respuesta de estado que revele ambos ID solo al confirmador, derivando visita
del detalle y comprobando la asociación; no se añade aquí un endpoint nuevo.
`CONFIRMADA` tampoco prueba que una solicitud anterior nunca llegó al servidor.
Si se perdió el comprobante al crearlo, su hash no permite recuperarlo: se
requiere una nueva revisión expresa, no una búsqueda permisiva por documento.

La verificación de la fuente es puntual. Una escritura externa **después** de
la última verificación y antes/después del commit no puede excluirse con este
filesystem; en todos los casos los bytes procesados proceden de la copia
confirmada. La raíz privada requiere ACL/permisos operativos restrictivos y
`RETINOGRAPH_PRIVATE_DIR` seguro, conforme a 28C.3. No se eliminan copias ni
confirmaciones consumidas automáticamente; retención institucional pendiente.
La confirmación de imagen no valida el grado sugerido por IA. Esta fase refina
la historia de revisión profesional del backlog; no cambia los requerimientos
originales de tesis ni las 17 políticas/rutas B1.
