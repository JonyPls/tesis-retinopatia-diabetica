# 78B — Manifiesto verificable, NOT_AUTHORIZED

## A. Identidad y archivos

Manifiesto:
[`backend/trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json`](../trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json).

- UUID NUEVO: `bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4`.
- Preparación UTC: `2026-11-02T04:45:48Z` (fecha UTC, no cambio del reloj local).
- Versión del formato: **2**.
- Versión del arnés: `codn-discard-mysql77-78a-manifest-v2`.
- Estado: **NOT_AUTHORIZED**; `authorization` permanece vacío.
- Digest de los **41 fuentes seleccionados**, SHA-256:
  `95125f3383eeadebba5502dac530d6189fea7cca167ff36a97afdefbe48497aa`.
- Binario previsto: `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe`.
- SHA-256 del binario, calculado leyendo el archivo SIN ejecutarlo:
  `1c40b282f3defe814926abb3256790e936b82b62107b1b601eb5b20a5364c366`.

No se reutiliza el UUID `cb377eb7-8057-43d8-a664-41a7838ed32e` propuesto en 78.
No se crea la raíz del ensayo, datadir, fotos, cuentas, procesos ni secretos.
Los únicos archivos nuevos de preparación son JSON, documentación y pruebas.

El cargador anterior no admitía estos metadatos. Se amplió únicamente
`discard_mysql77/safety.py`: validación cerrada de formato/fecha/versión/estado,
recursos concordantes, JSON sin claves duplicadas y rechazo de NOT_AUTHORIZED
antes de crear recursos. El ejecutor CLI se incluye ahora en el digest/copia
selectiva: cambiarlo también invalida el manifiesto. No se modificó código clínico,
frontend, modelos, `.env`, compuertas, SQL de migración ni permisos habituales.

El JSON NO es una firma de consentimiento humano. No hay token de autorización
válido en el documento; marcar una casilla o decir «continuar» no autoriza SQL.
La futura autorización requiere decisión explícita del responsable, actualización
concordante de estado/cadena y confirmación CLI, para ESTE UUID/recursos/alcances.

## B. Recursos previstos y propiedad

En la tabla, **R** significa exactamente:

```text
C:\Users\ricar\AppData\Local\Temp\opencode\codn77-bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4
```

Las rutas completas y políticas están en `resources` del JSON. No son parámetros
alternativos: el cargador exige igualdad exacta con las rutas derivadas y políticas
que utiliza el runtime. No se admite elegir otro host, puerto, usuario o esquema.

| Recurso | Identificación | Ubicación prevista | Operación creadora futura | Acreditación de propiedad | Retirada autorizada |
| --- | --- | --- | --- | --- | --- |
| Raíz | UUID nuevo | R | `OwnedTrial`, mkdir exclusivo | Identidad FS registrada al crear + identidad de marcador/nonce; no UUID solo | Privados retirados; solo evidencia saneada queda. Raíz existente no se reutiliza. |
| Datadir/instancia | MySQL NUEVO | `R\data` | `mysqld --initialize-insecure` en raíz privada | Raíz propia, handle recién creado/Job, listener/PID, @@datadir y @@server_uuid | Parar y verificar todos los procesos; retirar datadir, incluido catálogo/auth de la instancia. |
| Bootstrap | Archivo privado generado después de autorizar | Directorio R, archivo `R\bootstrap.sql` | Inicialización con contraseña efímera mediante init-file | Raíz propia, ACL privada, archivo exclusivo y sin enlaces | Unlink tras identidad SQL; también cubierto por retirada ante errores. |
| Copia de código | Allowlist actual, con hash | `R\backend` | `copy_sources` | Hash antes/después, sin enlaces, creación exclusiva | Recorrido confinado tras parada; sin afectar fuentes originales. |
| JPEG y Grad-CAM | Solo fixtures/predictor sintéticos | `R\backend\uploads\retinas` | Fixtures y rutas reales con IA sustituida | Inventario aprobado, nombres/IDs/identidades de archivo; escritor=lector=limpieza | CLI de la fábrica temporal y retirada final; nunca uploads habitual. |
| Exportaciones | JPEG sintéticos por paciente/ojo | `R\exports` | Caso real de confirmación HTTP/B1 | Raíz privada, hash y asociaciones verificadas | Solo entradas propias del árbol. |
| Copias privadas | Retinógrafo SINTÉTICO | `R\private` | Servicio real `PrivateCopy` | Identidad, hash y comprobante reales del ensayo | Pruebas preservan copia; retirada final elimina solo copia sintética. |
| Temporales y logs | Provisionales del ensayo | `R\tmp`, `R\init.log`, `R\mysql.log` | Procesos propios | Dentro del árbol exclusivo; no perfiles implícitos | Se eliminan; no se copian logs ni salida cruda a evidencia. |
| Marcador/PID file | Identidad auxiliar, no prueba única | `R\owner.json`, `R\mysql.pid` | `OwnedTrial`/mysqld propio | Identidad FS/marcador más handles, Job y listener | Eliminados en retirada; no matar por PID leído. |
| Esquema | `codn77_bde4e98a0eaa43dda1dc5f8aae670ec4` | Solo servidor nuevo, datadir propio | CREATE DATABASE explícito | Identidad OS/SQL antes de CREATE y guards en cada conexión del worker | Eliminación física del datadir propio tras parada; sin DROP remoto/habitual. |
| Cuenta app | `codn77_app@127.0.0.1` | Catálogo de ESA instancia | CREATE USER y GRANT | Solo SELECT/INSERT/UPDATE/DELETE del esquema identificado | Catálogo/auth retirados junto al datadir. |
| Administrador | Root solo de instancia NUEVA | Catálogo propio | Bootstrap de servidor nuevo | Credenciales efímeras, identidad OS/SQL; nunca credenciales habituales | Cerrar conexión, parar Job, retirar bootstrap/datadir. |
| Evidencias | JSON saneado | `R\evidence` | Worker y retirada | Allowlist/sanitizador; códigos, IDs técnicos y huellas DDL | Conservar solo resultados/fallo saneados, huellas y retirement.json. |

### Procesos previstos

- Binario MySQL identificado arriba: una inicialización y luego servidor nuevo,
  siempre con `--no-defaults`, datadir propio y listener `127.0.0.1`.
- Worker y worker de reinicio: el Python del venv identificado en el manifiesto,
  con `-I -B`, copia temporal, entrada por pipe y Job propio. No servidor HTTP.
- Helpers Windows: `C:\WINDOWS\System32\whoami.exe` para SID y
  `C:\WINDOWS\System32\icacls.exe` para ACL de la raíz nueva. No se ejecutan ahora.
- Job Windows sin nombre compartido: handles propios, herencia de descendientes,
  KILL_ON_JOB_CLOSE. No adopta procesos activos.
- Puerto: `free_loopback_port()` solo DESPUÉS de autorizar, bind efímero a loopback,
  nunca 3306. Liberar ese socket no garantiza reserva: por eso se comprueba después
  que el listener pertenezca al Popen creado aquí ANTES de abrir SQL. Si no coincide,
  detenerse; no probar una conexión al listener ajeno.

No se ha reservado ni abierto un puerto en esta preparación. Los binds de tests
de rechazo están bloqueados mediante mocks.

## C. Operaciones futuras que requieren autorización

Los seis alcances propuestos (NO concedidos) son:

1. `start_owned_mysql`: inicializar/iniciar exclusivamente el binario/datadir nuevos.
2. `create_synthetic_schema`: esquema indicado, cuentas/grants propios, 16 tablas
   base y dos técnicas de la propuesta 72; sin SQL maestro privado.
3. `synthetic_sql_writes`: fixtures B1/pacientes/visitas/resultados ficticios,
   validación/descarte/Informes/confirmaciones reales sobre datos sintéticos,
   carreras con conexiones independientes, probes de rollback 1205/1213 y consultas
   de inventario/estado/locks. Sin inferencia ResNet50 real.
4. `synthetic_files`: crear JPEG/Grad-CAM/exportaciones/copias privadas, comprobar
   rutas/reemplazos/enlaces y eliminar únicamente archivos del ensayo autorizado.
5. `stop_owned_process`: detener procesos y workers de reinicio acreditados por
   handles/Job propio. No seleccionar procesos por nombre o puerto.
6. `retire_owned_resources`: retirar datadir/auth/bootstrap/código/temporales/fotos
   propios después de cerrar conexiones, terminar y comprobar vacío del Job.

No se generan contraseñas, JWT ni credenciales de BD reales en esta preparación.
En B se generarían valores efímeros; bootstrap privado antes de aceptar TCP, resto
por pipes anónimos, nunca `.env`, argv, DSN impreso o credenciales de desarrollo.
Los tests offline solo utilizan marcadores técnicos y contenido ficticio, no
contraseñas operativas.

### Secuencia contrastada con código

`runtime.execute` valida autorización/manifiesto antes de `OwnedTrial`, raíz nueva,
ACL/copia/binario y arranque. Comprueba Popen/PID/listener/datadir antes de conectar;
después comprueba UUID/versión/destino SQL y crea esquema/cuenta limitados.

`worker.run` comprueba otra vez raíz/marcador/digest/PID/destino; instala el esquema
base y `checked_sequence` exige inventario base positivo ANTES de fixtures apagados.
Invalida la aprobación al instalar la extensión; exige inventario full ANTES de
fixtures habilitados. `seed`, `case` y guards DML de ambos motores aplican la barrera.
También se inventaría antes de limpieza en un worker reiniciado.

Después: integridad (incluido CORREGIDO y retinógrafo real sintético), B1, nueve
carreras, idempotencia/incertidumbre, errores MySQL, archivos y reinicio. Fail-fast:
no retries automáticos de POST inciertos. Por último, evidencia saneada y retirada.

## D. Verificación realizada sin MySQL

Comandos realmente ejecutados desde `backend`:

```powershell
.\venv\Scripts\python.exe -B -m unittest test_discard_mysql_preflight77 test_discard_mysql_schema77 test_discard_mysql78a test_discard_mysql78b -v
.\venv\Scripts\python.exe -B discard_mysql_trial77.py --config trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json
```

**62/62 tests offline aprobados, sin skips:** 51 anteriores + 11 del manifiesto.
Incluyen JSON duplicado/inconsistente, metadatos, cada recurso alterado, scopes,
hashes, autorización ausente y tentativa CLI simulada con UUID coincidente:
NOT_AUTHORIZED bloquea antes de `OwnedTrial`, Popen o red. No se ejecutó B real.

Preflight real: `A_NO_CONNECTION`, `INSPECTED_NOT_AUTHORIZED`, 41 fuentes y todas
las dependencias detectadas. Estado NOT_AUTHORIZED; hash de fuentes/binario
coincidentes; raíz candidata inexistente y sin enlaces en los ancestros actuales.
Sintaxis/whitespace y git diff --check se comprueban también al cerrar el incremento.

Se contrastaron las cuatro correcciones 78A: barrera antes de escrituras, retirada
con identidad/Job, negativo CORREGIDO solo/mixto y circuito HTTP/B1 real preparado.
La última comprobación es estructural; esos casos clínicos NO se ejecutaron.

## E. Parada, aislamiento y bloqueos

La preparación offline es satisfactoria, **no acredita aislamiento operativo**.
No se consultaron instancias ni esquemas preexistentes. El diseño no ofrece una
entrada para usar uno: exige raíz inexistente y proceso nuevo. La existencia del
binario/hash no prueba su versión en ejecución; eso se comprobará en B.

Se detiene ante estado/autorización/UUID/alcances discordantes, metadata/recurso
alterado, cambio de digest (incluido lanzador), binario distinto, raíces ajenas,
enlaces/reparse points, identidad de proceso/listener/SQL no acreditada, DDL o
InventoryGate rechazados. Los casos detienen también la secuencia ante pérdida
de visita, efecto duplicado, ojo/validación no seleccionados alterados, inferencia
obsoleta confirmada, carrera incompatible o deadlock inesperado. No se ajustan
restricciones automáticamente para continuar.

La retirada revisada conserva identidad FS/marcador EN MEMORIA, handles creados
por el ensayo y vacío del Job. No borra mientras queden escritores ni si cambió la
pertenencia. Inspecciona sin seguir enlaces; retira candidatos seguros y reporta
INCOMPLETE con pendientes ante fallo. No copia secretos/logs; solo evidencia
saneada. Ese resultado impide declarar un ensayo exitoso.

Pendientes: autorización humana específica; ACL/SID/Job y compatibilidad de jobs
del SO; proceso/PID/listener/puerto/destino SQL nuevos; versión >=8.0.16 de la
serie admitida por la utilidad B1; DDL nativo y filesystem; carreras InnoDB y
revisión visual. El overlay sintético no acredita DDL clínico real. NO_CONFIRMADA
no es un negativo terminal; no se amplió recuperación ni se habilitaron compuertas.

## F. Comando futuro previsto (NO ejecutado)

La CLI real solo añade `--config`, `--execute`, `--authorize-run` a su ayuda estándar.
No existe una opción inventada `--preflight`: A es el comportamiento predeterminado.

Desde `backend`, la forma de ejecución posterior sería:

```powershell
.\venv\Scripts\python.exe -B discard_mysql_trial77.py --config "trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json" --execute --authorize-run "<PENDIENTE_DE_AUTORIZACION>"
```

Es deliberadamente inoperante: el placeholder NO es una confirmación válida y el
manifiesto sigue NOT_AUTHORIZED con autorización vacía. No se proporciona aquí
una cadena de autorización válida. Solo una decisión posterior expresa permitiría
preparar una revisión autorizada, repetir A y aportar la confirmación exigida.
Ni tener el JSON, editar solo el estado ni decir «seguir» satisfacen ese requisito.

## G. Dictamen

1. **Manifiesto listo para revisión:** sí, nuevo UUID, hashes/metadatos/recursos
   verificados, estado NOT_AUTHORIZED, sin credenciales.
2. **Aislamiento offline satisfactorio:** sí como preparación, no como prueba de
   una instancia operativa. La raíz ni siquiera se ha creado.
3. **Verificación de inicio pendiente:** OS/ACL/Job, todos los procesos y su puerto,
   identidad SQL, versión, inventario nativo, UTC/RR y almacenamiento.
4. **Autorización faltante:** crear/usar/parar/retirar ESTE ensayo, esquema/cuentas,
   DDL/DML/carreras y archivos sintéticos, incluidos los seis scopes exactos.
5. **Puede solicitarse B:** sí para evaluación/ejecución controlada tras esa
   autorización y nuevo preflight; no es aprobación automática ni activación CODN.

No se inició MySQL, abrió SQL, creó esquemas, aplicó migraciones, modificó recursos
habituales, leyó `.env`, activó flags, ejecutó inferencia real ni hizo commit/push.
