# 28C.2 — estructura de confirmaciones de exportación

Esta fase **solo incorpora esquema y ORM**. Selección Auto sigue bloqueada para
inferencia. No existen todavía endpoint, generación de identificadores, copia
privada, revocación, consumo ni consulta de estado. Confirmar la asociación
paciente–imagen–ojo **no** valida la predicción de IA.

## Maestro y datos

`backend/db/centro-oftalmologico-db-v2.sql` crea 15 tablas desde cero; la nueva
`confirmaciones_exportacion_retinografo` nace vacía. Los 21 permisos B1, cuatro
roles, grants 7/13/6/6 y los INSERT semilla originales no cambian. No ejecutar
las migraciones incrementales B1 sobre este maestro. La reconstrucción de la
base habitual queda a cargo del propietario desde HeidiSQL, después de hacer
su propio respaldo: **el script contiene DROP TABLE**. El respaldo previo a
28C.2 está bajo `backend/db/backups/`, ignorado por Git.

## Contrato de almacenamiento

- `id` y `detalle_id`: BIGINT UNSIGNED, este último nullable y único;
  `paciente_id`, `confirmado_por`, `revocada_por`: INT UNSIGNED, este último
  nullable. Sus FK usan `ON DELETE RESTRICT`. El detalle permite derivar visita
  y diagnóstico sin copiarlos. No se agregó una relación inversa con cascada.
- `ojo_confirmado`: `Derecho` o `Izquierdo`; `estado`: `CONFIRMADA`, `CONSUMIDA`
  o `REVOCADA`. El nombre de exportación es **sensible** y no certifica origen
  ni pertenencia clínica. `sha256_fuente` es un hash SHA-256 hexadecimal
  minúsculo; `clave_copia` son 32 caracteres hexadecimales minúsculos, previstos
  para un identificador generado solo por el servidor, nunca una ruta.
- `token_verificador BINARY(32)` almacena el SHA-256 de un **secreto opaco futuro
  de alta entropía**, no el secreto mismo. Esto reduce la exposición por acceso
  de lectura a la tabla; exige que el servicio genere el secreto mediante CSPRNG
  y compare su verificador sin exponerlo en respuestas o logs. No existe aún
  ninguna generación ni distribución de tokens.
- Cuatro fechas `DATETIME(6)` sin zona: el servicio futuro debe escribir y
  comparar instantes UTC coherentes. El CHECK exige exactamente 60 minutos entre
  confirmación y expiración. No hay triggers, eventos ni eliminación automática;
  la caducidad se evalúa frente al reloj en el servicio futuro. Las copias
  caducadas podrán ser candidatas a **conciliación controlada** después de 24 h,
  no a borrado inmediato ni automático.
- CHECK exige estado consistente con detalle/consumo/revocador/fechas, hash y
  clave de copia válidos y fechas de consumo/revocación no anteriores a la
  confirmación. UNIQUE evita reutilizar token, clave o detalle. Una FK verifica
la **existencia** del detalle; no comprueba por sí sola que su visita sea del
mismo paciente, su ojo sea el mismo, sus bytes coincidan o su profesional
esté autorizado. Esas comprobaciones y la exclusión transaccional entre
consumo y revocación corresponden a 28C.3. Los CHECK garantizan combinaciones
de columnas, no historial inmutable ni transiciones autorizadas: el servicio
debe prohibir revertir `CONSUMIDA` o `REVOCADA` a `CONFIRMADA` y preservar la
evidencia sin actualizar sus datos originales.

## Restricciones de eliminación y retención

Las FK impiden borrar paciente, confirmador y revocador referenciados, y detalle
consumido. Las cascadas anteriores visita → diagnóstico → detalle continúan
para datos sin confirmación consumida, pero un detalle referenciado bloquea su
eliminación física, incluso por cascada. El ORM existente emplea
`cascade='all, delete-orphan'` en diagnóstico → detalles; una eliminación de
diagnóstico vinculado fallará en BD: no se altera ni se silencia esta conducta.
Las FK del detalle y revocador restringen también cambios de sus ID: MySQL 8
no permite `ON UPDATE CASCADE` en columnas usadas por estos CHECK de estado.
La política institucional de conservación de evidencia clínica y copia privada
continúa pendiente; no borrar filas consumidas ni revocadas por caducidad.

## Comprobación aislada

`backend/b1_mysql_disposable_trial.py --run-disposable --orm-integration`
comprueba datadir, puerto y UUID del MySQL temporal antes de ejecutar el
maestro dos veces desde cero. Verifica la semilla y 15 tablas, restricciones
efectivas, cuatro FK, índices, altas sintéticas, rechazo de estados inválidos,
duplicados y borrados, rollback y relaciones ORM tras reabrir sesión. El modo
histórico conserva su expectativa de 14 tablas; no aplicar migraciones
históricas sobre el maestro nuevo. Las pruebas no ejecutan inferencia real.
