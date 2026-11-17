# CB-03 — Inicialización y arranque de MySQL aislado

RUN-ID: `20261103T173514Z-cb03-init-834c725e`. Fecha: 3 de noviembre de 2026 (America/Lima).

## Resultado real

**Datadir inicializado correctamente; arranque de preparación detenido por un conflicto de configuración/acceso administrativo. Instancia actualmente DETENIDA y CB-03 BLOQUEADA.**

La inicialización terminó con código 0. El servidor MySQL 8.0.46 llegó a indicar “ready for connections” en su log y el sistema operativo registró un listener exclusivo en 127.0.0.1:33363, propiedad del PID 18768. La primera conexión administrativa produjo un error no transitorio antes de ejecutar la consulta de identidad o configurar la contraseña. La utilidad detuvo el lanzador (PID 9240), pero MySQL había creado un proceso hijo. Se verificaron el PID 18768, su padre 9240, su ejecutable, el argumento defaults-file exacto y la propiedad del listener antes de detener únicamente ese hijo. Una observación posterior confirma que no existe ese proceso ni listener en 33363.

No se reintentó el arranque, no se reinicializó y no se eliminó ningún directorio. Los listeners habituales 3306/33060 permanecen bajo el PID 20248. Ninguna conexión se dirigió a ellos; el registro de auditoría del cliente contiene solo 127.0.0.1:33363.

## Identificadores y certeza

| Dato | Resultado | Evidencia / límite |
|---|---|---|
| Host/puerto | 127.0.0.1:33363 | Listener real durante arranque; actualmente cerrado |
| Versión efectiva de servidor | 8.0.46 | Log del proceso; `SELECT @@version` no se completó |
| Datadir inicializado | `D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql\data` | Comando de inicialización y configuración del proceso; `@@datadir` pendiente |
| UUID local | `eee45878-d7ac-11f1-bc4f-107c616721bd` | `auto.cnf` propio; **@@server_uuid todavía no confirmado por SQL** |
| Lanzador / servidor | 9240 / 18768 | Árbol de proceso y archivo PID, no eran el mismo PID |
| Estado actual | DETENIDA | `estado-detenido-verificado.json` |
| Contraseña administrativa segura | NO CONFIGURADA | El fallo ocurrió antes de generarla/guardar DPAPI/ALTER USER; no se deja servidor escuchando |
| Esquema funcional / fixtures | NO EJECUTADOS | No se emitió SQL funcional; solo inicialización interna de MySQL |
| CB-03 | BLOQUEADA | 0 métodos y 0 subcasos de integración nuevos |

## Configuración y privacidad

Se creó únicamente `my-cb03.ini` dentro de la raíz autorizada, con datos/logs/tmp propios, bind 127.0.0.1, puerto 33363, MySQL X apagado, sin binlog/general log/slow log, sin named pipe/shared memory, sin local_infile y secure_file_priv=NULL. No se modificaron configuración global, `.env`, servicios Windows, código funcional ni `.gitignore`.

La raíz tiene ACL restringida al usuario actual y SYSTEM. Se preparó el mecanismo DPAPI para proteger una credencial futura, pero **no se generó ni guardó contraseña en este intento**. No deben describirse como completadas las etapas posteriores a la conexión fallida.

El patrón existente `tmp/` excluye el datadir y sus claves/certificados de Git. `git check-ignore` confirmó la exclusión y `git ls-files` no encontró archivos rastreados bajo la raíz. No se copiaron archivos de datos, claves TLS ni contenido de private a las evidencias; solo configuración sin secretos, logs de arranque y metadatos. No hubo commits ni push.

## Hallazgos de preparación

1. **Configuración elegida por la utilidad:** incluyó `skip-name-resolve`. MySQL documenta que esta opción impide que el acceso inicial por 127.0.0.1 resuelva la cuenta root@localhost. Es la causa probable del rechazo observado. [Manual oficial de inicialización](https://dev.mysql.com/doc/refman/8.0/en/data-directory-initialization.html).
2. **Supervisión de procesos:** MySQL en Windows puede crear un monitor y un proceso servidor; está documentado y explica el PID hijo observado. `--no-monitor` permite evitar ese monitor para este uso desechable. [Manual oficial para Windows](https://dev.mysql.com/doc/refman/8.0/en/windows-installation.html).
3. **Limitación del diagnóstico:** la utilidad no registró el número del error del cliente y solo conservó un mensaje controlado. No se inventa un 1045/1130 ni se afirma confirmación SQL de la causa. La próxima utilidad debe registrar únicamente clase/número del error, sin mensajes o parámetros que contengan secretos.

## Comandos realmente ejecutados

Desde la raíz del repositorio:

```powershell
& .\backend\codn_start_cb03_instance.ps1 -InitializeAuthorizedInstance
```

Los argumentos exactos de initialize/start están en `inicializacion-arranque.json`, sin secretos. Inicialización: salida 0. Preparación completa: salida 1, porque no se completó identidad/credenciales. Se conservan scripts ejecutados y configuración exacta en esta carpeta de evidencia.

## Recuperación propuesta — NO EJECUTADA

Se solicita autorización exclusivamente para **reiniciar el mismo datadir ya inicializado**, mismo host/puerto/UUID local, sin repetir initialize ni borrar/reconstruir nada.

Precondiciones: verificar otra vez puerto libre, proceso propio inexistente, UUID local exacto y hash de configuración. Comando de arranque propuesto (sin modificar el archivo ya registrado):

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe' '--defaults-file=D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql\my-cb03.ini' --skip-name-resolve=OFF --no-monitor
```

Debe lanzarse oculto mediante la utilidad revisada, redirigiendo stdout/stderr a archivos NUEVOS. Los overrides afectan solo este proceso y archivo local. Verificar PID real desde pid-file y listener; si difieren o fallan identidad/credenciales, detener únicamente el proceso propio comprobado y documentar, sin retry automático.

Conectar únicamente a 127.0.0.1:33363; comprobar versión/UUID/datadir/bind y cuenta local; generar contraseña aleatoria fuerte, protegerla con DPAPI y ACL propia y ejecutar exactamente una operación administrativa `ALTER USER CURRENT_USER() IDENTIFIED BY <secreto en memoria>`. No incluir el secreto en comando, script, log, respuesta o informe. Verificar reconexión con la credencial y rechazo de contraseña vacía; consultar solo metadatos y ausencia de esquema funcional.

No incluye CREATE DATABASE, CREATE USER funcional/de pruebas, CREATE TABLE, GRANT, fixtures, migraciones, DROP ni TRUNCATE. Tras identidad y credenciales confirmadas, detenerse para presentar y obtener autorización del plan de esquema/fixtures. **No ejecutar de nuevo el inicializador original contra este datadir ya existente.**

## Segunda puerta: aún pendiente

El plan definitivo de esquema/índices/FK, scripts create-only revisados y 40 filas sintéticas en 11 tablas continúa pendiente de una instancia verificada por SQL. La matriz de escenarios de CB-03 y el procedimiento previo se conservan. No se solicita ni se presume aprobación de esa etapa en esta recuperación.

## Evidencias y preservación

`antes.json`, `despues.json`, `proceso-hijo.json`, `contencion-final.json` (observación inmediatamente después de Stop-Process), `estado-detenido-verificado.json` (verificación posterior del cierre), `inicializacion-arranque.json`, `estado-final-consolidado.json`, `preparacion.log`, `exit.txt`, `init.err`, `server.err`, configuración y scripts ejecutados. `SHA256SUMS.txt` identifica cada archivo.

Se verificaron 113 hashes de las dos corridas anteriores sin modificaciones. El informe de caja blanca recibe solo una nota posterior; sus resultados históricos se conservan. No hay nuevas pruebas aprobadas, porcentajes de cobertura o capturas de una ejecución inexistente.


<!-- CODN-CB03-SECOND-START -->
# Segundo arranque autorizado — resultado posterior

RUN-ID: **20261103T175540Z-cb03-start2-06e60db0**. Ejecución: 2026-11-03T17:55:42.401541+00:00 → 2026-11-03T17:55:44.348468+00:00 (UTC; America/Lima UTC−05).

**Estado actual: instancia DETENIDA; acceso administrativo no recuperado; identidad SQL sin confirmar; CB-03 BLOQUEADA.**

## Operaciones y resultado real

1. Se comprobó puerto 33363 libre, proceso anterior ausente y presencia de `auto.cnf`, `ibdata1` y directorio `mysql` en el mismo datadir.
2. Se comprobó el UUID local `eee45878-d7ac-11f1-bc4f-107c616721bd` y el hash del INI original `6dee5fa065178c2971d8271d9d6a11302306db9f4a6e06deb5ebcfe0078834e6`. No se modificó ese archivo.
3. Se validaron los argumentos autorizados `--skip-name-resolve=OFF --no-monitor` con `--validate-config`: **salida 0**. No se llamó initialize/initialize-insecure.
4. Se arrancó un único proceso propio oculto, PID **9380**. El log identifica MySQL **8.0.46**, listo en puerto **33363**; pid-file contiene 9380. Los overrides de log-error y pid-file apuntan a archivos nuevos del mismo directorio aislado.
5. La conexión normal PyMySQL, sin contraseña inicial por corresponder a initialize-insecure, devolvió **OperationalError 1130**. El servidor rechazó el acceso antes de autenticar y ejecutar la primera consulta. No se cambió la credencial ni se ejecutó ALTER USER.
6. Se detuvo el mismo proceso propio. La observación posterior `2026-11-03T17:57:19.4304395Z` confirma PID 9380 ausente y ningún listener en 33363. No hubo otro intento.

El error 1130 corresponde al rechazo del host cliente en el control de conexión, según el [manual oficial de MySQL](https://dev.mysql.com/doc/refman/8.0/en/problems-connecting.html). No se ha determinado por SQL qué cuenta/Host contiene la instancia. No se interpreta como contraseña incorrecta ni se atribuye una causa definitiva al DNS o a una tabla dañada.

La hipótesis de que bastaba desactivar skip-name-resolve **no quedó confirmada**. El segundo intento conserva ese override explícito y el rechazo persiste. El número exacto del error de este intento sí quedó registrado, sin texto de excepción que pudiera contener secretos. Los parámetros se validaron; `@@skip_name_resolve` no llegó a consultarse, por lo que no se presenta como valor SQL verificado.

## Verificación obligatoria: estado por requisito

| Comprobación | Resultado real |
|---|---|
| `@@server_uuid` | PENDIENTE; solo UUID local auto.cnf comprobado |
| `@@datadir` | PENDIENTE; ruta del INI/comando cotejada localmente |
| `@@port` | PENDIENTE por SQL; log del servidor registra 33363 |
| `@@version` | PENDIENTE por SQL; log registra 8.0.46 |
| `@@hostname` | PENDIENTE |
| `@@skip_name_resolve` | PENDIENTE; override OFF aceptado en validación |
| PID | 9380, coincide con pid-file; actualmente terminado |
| Listener final | Ninguno en 33363 |
| Contraseña administrativa configurada/validada | NO: la conexión inicial falló antes de generarla |
| Acceso sin contraseña rechazado tras configurar contraseña | NO EVALUADO; no se configuró contraseña |
| Tablas funcionales vía metadatos SQL | PENDIENTE de consulta; no se emitió SQL funcional |
| Instancia habitual | Sin conexiones del cliente a 3306/33060; sus listeners siguen en PID 20248 |
| Esquema/fixtures/CB-03 | NO EJECUTADOS |

## Credenciales, archivos y cambios previos

La utilidad corrigió el destino previsto de credenciales: DPAPI bajo ACL privada en una carpeta temporal de Windows **fuera del repositorio**. Esa etapa no llegó a ejecutarse: no se generó ni guardó contraseña, y no se copió ningún archivo cifrado o secreto a evidencias.

No se usaron credenciales habituales, `.env`, skip-grant-tables, SQL maestro, migraciones, DROP/TRUNCATE ni servicios Windows. No se creó esquema ni tablas/usuarios funcionales ni fixtures; no hubo escrituras SQL administrativas. El patrón existente tmp/ sigue excluyendo los datos; `.gitignore` no se modificó. No se hicieron commits ni push.

Al comenzar ya existían cambios locales del usuario en diagnóstico y sus pruebas. Se registraron sus hashes y no se modificaron por estas utilidades. El detalle comparativo está en `preservacion-fuentes-previas.json`; cualquier diferencia concurrente debe interpretarse con su autoría, sin atribuirla automáticamente a esta intervención.

## Comandos reales, sin secretos

Desde la raíz:

```powershell
& .\backend\codn_second_start_cb03.ps1 -SecondStartAuthorized
```

Los arrays exactos de validación y arranque están en `segundo-arranque.json`. Incluyen únicamente el binario, INI propio, los dos parámetros autorizados y rutas de nuevos logs/PID. No llevan contraseña. Validación: salida 0. Preparación completa: **salida 1** por error 1130. Consultas SQL de identidad completadas: **0**. Métodos/subcasos de integración CB-03 ejecutados: **0/0**.

## Punto de detención y siguiente diagnóstico propuesto

Se cumplió la instrucción de detenerse ante una verificación fallida. **No se autoriza implícitamente un tercer arranque ni un cambio de transporte.** No corresponde aprobar esquema/fixtures mientras la identidad SQL siga pendiente.

Para un siguiente intento conviene diagnosticar la conexión con el cliente nativo de la instalación y capturar únicamente número de error y origen del cliente, sin intentar cuentas globales ni contraseñas habituales. Una alternativa a revisar es un transporte exclusivamente local de Windows con nombre único —memoria compartida— para autenticar normalmente root@localhost y consultar los metadatos. MySQL documenta esa opción en [protocolos de conexión](https://dev.mysql.com/doc/refman/8.0/en/connecting.html). No se ha activado ni probado, ni se garantiza que resuelva el error.

Ese procedimiento necesitaría autorización específica para un nuevo arranque del mismo datadir y, si se elige, habilitar el transporte local. No usaría skip-grant-tables, no reinicializaría, no crearía cuentas alternativas ni ampliaría grants. El único cambio SQL posterior permitido sería asegurar root@localhost, una vez cotejada la identidad. Ante otro fallo se detendría sin repetir.

## Plan funcional CB-03 conservado, todavía NO AUTORIZADO

Sigue propuesto el esquema `codn_cb03_20261103_a3c5f7f4`, 11 tablas necesarias y 40 filas exclusivamente sintéticas, con los 10 métodos ya preparados. Tablas: tipos_documento, cargos, usuarios, pacientes, visitas_clinicas, tipos_informe, informes, informes_versiones, grados_retinopatia, diagnosticos_retinopatia y diagnosticos_retinopatia_detalle.

La revisión definitiva de DDL create-only, claves/índices/FK, cuenta restringida, matrices y comandos de integración debe presentarse después de confirmar la identidad y antes de ejecutar SQL funcional. No se declara listo ni se ejecuta un script de esquema productivo sin haberlo revisado. La matriz y el procedimiento anteriores permanecen disponibles en `PROCEDIMIENTO_CB03_MYSQL_AISLADO.md` y las evidencias de preparación de CB-03.

## Evidencias de este intento

Carpeta: `evidencias/20261103T175540Z-cb03-start2-06e60db0/`.

- `antes.json`, `despues.json`, `estado-final-detenido.json`.
- `segundo-arranque.json`, `estado-final-consolidado.json`, `ejecucion.log`, `exit.txt`.
- `compatibilidad-stdout.log`, `compatibilidad-stderr.log`, `server-segundo-arranque.err`, `server-segundo-arranque.pid`.
- INI original sin cambios, scripts ejecutados, hashes de fuentes previas y estado Git.
- Se verificaron **140 hashes históricos** sin cambios. Evidencias previas y primer informe se conservan separados; no se reemplazan sus resultados.
- `SHA256SUMS.txt` cubre esta corrida, excluyéndose a sí mismo. No se generaron PNG ni cobertura de una integración inexistente.
