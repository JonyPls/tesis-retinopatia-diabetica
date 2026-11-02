# 78A — Cuatro brechas subsanadas; fase B NO ejecutada

Solo cambian el paquete `discard_mysql77`, sus pruebas y documentación. No se
modifican servicios/modelos clínicos, frontend, B1 funcional, `.env` ni compuertas.
No se inició mysqld, abrió SQL, aplicó DDL, insertó datos o ejecutó inferencia real.

## 1. Barrera DDL antes de fixtures

`schema.py` introduce `InventoryGate`, `verify_inventory` y `checked_sequence`:

1. Identidad OS/SQL de la instancia propia (controles existentes).
2. Instalar las 16 tablas base sintéticas; aprobación inicialmente inválida.
3. Consultar inventario efectivo: conjunto exacto de tablas/columnas, tipos/signo,
   nulabilidad/defaults, PK, FK y acciones, UNIQUE, índices declarados, charset/
   collation explícitos, CHECK/ENFORCED, ausencia de triggers e InnoDB.
4. Aprobar fase **base**, luego ejecutar fixtures/casos con capacidad apagada.
5. Invalidar aprobación, instalar solo propuesta técnica 72, inventariar esquema
   completo, aprobar fase **full** y solo entonces habilitar la fábrica sintética.

`seed()` comprueba la barrera antes de tocar DB o archivos. `case()` también lo
exige; ambos motores tienen guard de DML. El worker de reinicio verifica el
inventario completo antes de actualizar un manifiesto. Una validación que falla
o simplemente retorna sin aprobar NO autoriza inserciones. Un DDL parcial no
conserva la aprobación base ni desencadena correcciones automáticas.

Se normalizan únicamente representaciones equivalentes: alias de enteros,
display widths y formato de CHECK. El parser conserva precedencia, operadores,
literales y argumentos; sintaxis desconocida falla cerrada. No se cambian
restricciones/tipos reales para hacer pasar el ensayo. Cualquier diferencia nativa
inesperada exige revisión y detiene B. La prueba offline recorre todos los CHECK
de los modelos reales sin evaluarlos ni abrir SQL.

Sigue existiendo el overlay SIGNED/UNSIGNED de metadatos EXCLUSIVO de pruebas.
Esta barrera compara el esquema sintético autorizado; no acredita el DDL clínico
habitual ni añade la UNIQUE diagnóstico/ojo que no está declarada.

## 2. Retirada de recursos propios

`resources.py` crea la raíz exclusivamente con mkdir sin reutilización y conserva
en memoria su identidad FS (device/inode), la identidad del marcador y nonce.
UUID/PID file por sí solos no acreditan pertenencia. Cambiar la raíz incluso
copiando exactamente el marcador hace fallar la comprobación.

Todos los procesos de inicialización/MySQL/worker son creados por `OwnedTrial` y
registrados mediante sus handles Popen. Un Job Windows propio, con
KILL_ON_JOB_CLOSE, contiene esos procesos y los descendientes heredados. El worker
recibe credenciales por stdin SOLO DESPUÉS de asignarse al Job. Si la asignación
falla, no hay fallback: se detiene ese handle propio y falla la preparación.

La retirada cubre el try/finally desde la preparación/ACL, no solo el servidor ya
iniciado. Cierra la conexión administrativa, termina exclusivamente procesos
propios, espera sus handles y confirma que el Job no tiene procesos activos.
Solo entonces inventaría/borrará candidatos dentro de la raíz creada:

- datadir completo (incluidos usuarios/grants/hashes de la instancia desechable);
- bootstrap, logs, temporales y fuentes del sandbox;
- JPEG/Grad-CAM, exportaciones, copias privadas y manifiestos sintéticos.

No utiliza rmtree genérico, DROP remoto, selección global por puerto o PID recibido.
Cada candidato se inspecciona sin seguir enlaces/reparse points; compara identidad
de nuevo antes de borrar. Hardlinks solo se retiran si todos sus enlaces están
contabilizados dentro del mismo candidato propio; un enlace externo se rechaza.

En éxito solo queda `root/evidence/` con JSON saneado de resultados, códigos/clases
de error e IDs de conexiones, huellas SHA-256 del DDL y `retirement.json`. No se
conservan SQL crudo, logs, tokens, DSN, contraseñas o registros de autenticación.
Campos desconocidos de la evidencia se descartan; no se copia salida de procesos.

Ante fallo de parada, propiedad incierta, enlaces o errores de IO:

- NO se borra un árbol que pueda tener escritores vivos o pertenencia incierta.
- Se intenta retirar cada candidato independiente seguro (por ejemplo bootstrap
  aunque otra carpeta no se pueda eliminar).
- Se devuelve **INCOMPLETE** con recursos pendientes, sin imprimir el error crudo.
- Se conserva la ACL privada de los restos. El informe de retirada queda en la
  evidencia si es seguro escribirlo; en todo caso el ejecutor emite el estado
  saneado y la raíz/pendientes por consola y NO declara éxito.
- El responsable debe tratar esos restos de la ruta exacta: no hay borrado de
  recursos inciertos ni promesa de superar restricciones del SO.

El nuevo alcance obligatorio es **`retire_owned_resources`**, además de los cinco
anteriores. Los manifiestos previos sin este alcance son rechazados; deben
actualizarse hashes y obtenerse autorización nueva. Ningún manifiesto se creó o
autorizó en 78A. El UUID propuesto en 78 no supone aprobación ni debe reutilizarse
sin nuevo preflight y decisión expresa.

## 3. CORREGIDO seleccionado

`reject_selected_CORREGIDO` y `reject_selected_CORREGIDO_mixed` preparan OD
CORREGIDO mediante el PUT real y solicitan su ID exacto, solo o con OI pendiente.
Exigen 409/RESULTADO_VALIDADO y snapshots completos idénticos de filas y bytes:
grado final, validador, fecha/procedencia, comentario/motivo, JPEG/Grad-CAM,
visita, revisión y operaciones. No puede aparecer eliminación parcial ni un
manifiesto nuevo. El caso independiente `preserve_CORREGIDO` sigue descartando
solo OI y conservando íntegramente OD, incluso tras reinferencia sintética.

## 4. Circuito real del retinógrafo preparado

`real_retinograph_flow` se prepara en modo apagado **sin tablas técnicas** y en
modo habilitado, cada uno con fixture nuevo. No llama al helper de inserción
directa `confirmation()` ni sustituye servicios de confirmación/almacenamiento:

1. Paciente/visita sintéticos y JPEG de 350×350 en exports propio, nombre con el
   documento sintético y ojo L; hash SHA-256 de los bytes.
2. POST real `/api/diagnosticar/retinografo/confirmaciones`, JWT y motor B1 reales.
   Antes comprueba rechazo de hash incorrecto, ojo incompatible y administrador.
3. Verifica CONFIRMADA, paciente/ojo/hash y bytes idénticos en copia privada real.
4. Consulta real de estado y POST de diagnóstico con el token, sin upload manual;
   solo predictor/validadores IA son sintéticos, no ResNet50.
5. Verifica CONSUMIDA, detalle asociado, fecha y hash del detalle, en la misma visita.
6. Intenta reutilizar el token en una visita vacía del mismo paciente para que el
   rechazo no se deba a duplicar el ojo. No hay escrituras clínicas parciales.
7. Descarte del detalle vinculado solo o en lote con OD pendiente: 409 por
   COMPROBANTE_VINCULADO en modo habilitado, 403 en modo apagado; filas, archivos,
   copia privada y asociaciones intactos.

Estos escenarios clínicos NO se ejecutaron en 78A. La prueba offline únicamente
inspecciona que la función usa rutas reales y no invoca el fixture directo ni mocks
de confirmación. Su comportamiento efectivo sigue pendiente de B autorizada.

## Verificación offline

Desde `backend`:

```powershell
.\venv\Scripts\python.exe -B -m unittest test_discard_mysql_preflight77 test_discard_mysql_schema77 test_discard_mysql78a -v
.\venv\Scripts\python.exe -B discard_mysql_trial77.py
```

- 27 tests originales de seguridad + 1 fábrica/DDL compilado + 23 tests 78A:
  **51/51 pruebas offline aprobadas**, sin skips.
- Mocks de inventario incompatible: tablas, signo/tipo, nulabilidad, default, PK,
  FK, UNIQUE, índice, CHECK, enforcement, engine y trigger; ningún fixture insertado.
- Orden base/full, invalidación parcial, seed bloqueado y guard DML directo/CTE.
- Retirada con directorios propios y Popen/Job falsos: éxito, fallo de arranque,
  asignación, preparación, ensayo, descendientes, fallo de limpieza/parada/marcador,
  raíz reemplazada y enlaces externos. No se llaman APIs nativas del Job.
- Sintaxis sin pyc, imports inertes, fuente selectiva actual y git diff --check.

**Dictamen:** cuatro brechas subsanadas en código de pruebas y verificadas offline.
Preparado para evaluar una B expresamente autorizada, no para activación clínica.
Siguen pendientes MySQL real, representación nativa del inventario, carreras,
Job/ACL nativos de Windows, sistema de archivos del ensayo y revisión visual.
NO_CONFIRMADA sigue sin significado negativo terminal; no se amplía ese contrato.
