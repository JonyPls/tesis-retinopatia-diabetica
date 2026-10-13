# 29D.5D — procedencia temporal por campo (sin despliegue habitual)

## Esquema y confianza

El maestro conserva 16 tablas, FK, índices, tipos `DATETIME`/`TIMESTAMP`, permisos y semillas. Añade `VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO'` con `CHECK` (`NO_VERIFICADO`, `UTC_VERIFICADO`) por cada instante sujeto a acreditación:

| Tabla | Campos |
| --- | --- |
| `visitas_clinicas` | `fecha_visita`, `fecha_creado`, `fecha_actualizado` |
| `informes` | `fecha_creado`, `fecha_actualizado` |
| `informes_versiones` | `fecha_operacion` |
| `diagnosticos_retinopatia` | `fecha_creado`, `fecha_actualizado` |
| `diagnosticos_retinopatia_detalle` | `fecha_creado`, `fecha_actualizado`, `fecha_validacion` |

Cada nombre termina en `_origen`. Los defaults SQL dejan los valores existentes y las escrituras externas *sin marcador explícito* como `NO_VERIFICADO`. Una fecha NULL nunca se publica como instante. `fecha_nacimiento` (`DATE`) es civil; `fecha_consentimiento` es declarativa y no se convierte. Los campos de catálogos/pacientes fuera de los flujos de visitas, informes y diagnóstico no reciben nuevas marcas. Las confirmaciones del retinógrafo mantienen su contrato UTC y su política de caducidad previa; los nombres externos de exportación no acreditan UTC.

`UTC_VERIFICADO` expresa únicamente que el ORM controlado escribió el instante junto a su marcador bajo una conexión MySQL del motor Flask con listener UTC y sesión comprobada como `+00:00`; no constituye prueba criptográfica. En `before_insert` los instantes generados por el backend se escriben en el mismo INSERT que su marca; `informes_versiones.fecha_operacion` conserva el default SQL `CURRENT_TIMESTAMP(6)` en la sesión UTC. Los valores asignados explícitamente sin pasar por `set_verified_utc` quedan `NO_VERIFICADO`; la validación médica es el caso explícito acreditado. `before_update` empareja el reloj y la marca de `fecha_actualizado` en el mismo UPDATE ORM y no modifica otras marcas de fechas no cambiadas. El CHECK restringe vocabulario, **no** verifica el huso de un valor ni la identidad del escritor.

La lectura combina `fecha_*` y `fecha_*_origen`: `UTC_VERIFICADO` genera ISO 8601 terminado en `Z`; cualquier otro origen conserva componentes ISO sin zona. La respuesta incluye también el marcador. React interpreta solo ISO con zona explícita en `America/Lima`; mantiene el orden lógico del historial por `numero_version`. La lista de visitas expone `fecha_visita_origen`, de modo que la ventana existente de 24 h vuelve a seleccionar visitas acreditadas (incluye el límite exacto). Los listados agregados de pacientes priorizan el máximo de visitas acreditadas; para pacientes sin ellas conservan fecha no verificada sin atribuir zona. Los filtros y ordenación SQL preexistentes que mezclan eventos de distinto origen requieren revisión en 29D.5E. El PDF usa Lima para visitas/validaciones acreditadas y el día Lima en el nombre; una fecha incierta mantiene «pendiente de conciliación» y `fecha-no-conciliada`. `File.lastModified` en el archivo descargado del retinógrafo significa momento local de creación del objeto `File`, no tiempo clínico del nombre de exportación; no modifica sus bytes, SHA-256 ni comprobante.

## Límites que impiden desplegar

El listener ORM no cubre `UPDATE` Core, `Query.update`, SQL manual, scripts, importadores, otras conexiones SQLAlchemy ni escritores con acceso directo. Un escritor externo puede fijar fraudulentamente `UTC_VERIFICADO`, o puede modificar un `TIMESTAMP` con sesión no UTC y dejar la marca anterior intacta; el `ON UPDATE CURRENT_TIMESTAMP` del maestro puede cambiar `fecha_actualizado` conservando el marcador. **No hay garantía ante esos casos sin controlar los escritores, permisos o aprobar un mecanismo adicional (p. ej. triggers)**; no se han añadido triggers ni cambiado grants. No desplegar esta fase sobre habitual como garantía completa. Las conexiones ORM sin listener o con zona distinta fallan antes de una escritura ORM; el resto requiere inventario y control operativo aparte. Los diagnósticos y pacientes anteriores al corte no se acreditan por recencia, ID ni versión del código.

29D.5E: cerrar inventario de escritores y revisar filtros/paginación cronológicos mixtos y fallback de metadatos externos. 29D.5F: autorización **separada** para el ALTER habitual, después de respaldo NUEVO que incluya los tres registros de 29D.3, restauración comprobada en aislado, auditoría de escritores, corte coordinado de backend/SQL/frontend, verificación de sesión, plan de cancelación y decisión clínica sobre incertidumbre histórica. No usar el respaldo anterior al POST para descartar las tres filas. No activar banderas de informes ni habilitar DELETE durante ese corte. No convertir fechas históricas en la migración: añadir columnas con default `NO_VERIFICADO` y conservar las 16 tablas.

## Ensayos

`b1_mysql_disposable_trial.py` comprueba UUID distinto del habitual, datadir y puerto propios antes del maestro destructivo; valida las 11 columnas nuevas, sus defaults y los CHECK, además de la semilla y FK preexistentes. La suite ORM ensaya POST autorizado, lectura posterior, versiones CREACION/CORRECCION/ANULACION, edición de fila antigua sin sanear su fecha de creación, `ON UPDATE`, sesión no UTC rechazada, marcador inválido rechazado y el riesgo reproducible de `UPDATE` SQL directo (dentro de una transacción revertida). Vitest cubre ventana de 24 horas con visita exacta en el límite, anterior y ambigua. `unittest` PDF usa fechas e imágenes sustituidas sintéticas. Los resultados numéricos y bloqueos de ESLint se consignan en el informe de entrega.
