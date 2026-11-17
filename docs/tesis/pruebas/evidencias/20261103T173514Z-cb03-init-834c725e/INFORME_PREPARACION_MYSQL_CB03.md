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
