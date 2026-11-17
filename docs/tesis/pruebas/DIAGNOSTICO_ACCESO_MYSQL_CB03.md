# CB-03 — Diagnóstico de acceso y propuesta de tercer arranque

**Fecha:** 3 de noviembre de 2026, America/Lima. **Estado:** diagnóstico offline terminado; tercer arranque NO AUTORIZADO NI EJECUTADO; CB-03 BLOQUEADA.

Evidencias nuevas: `evidencias/20261103T180530Z-cb03-diag-3badfe39/`. Se revisó `INFORME_PREPARACION_MYSQL_CB03.md`, configuración, logs y utilidades de ambos intentos. En esta intervención solo se ejecutó ayuda/versión del cliente y comprobaciones de archivos/procesos/puertos. Cero conexiones MySQL y cero ejecuciones de mysqld. No se modificó el datadir, INI, código funcional ni evidencias históricas.

## 1. Qué se sabe

- El binario de servidor y ambos logs identifican MySQL 8.0.46; los procesos llegaron a estar listos en el puerto 33363.
- Inicialización: `--initialize-insecure`, salida 0; el log registra explícitamente la creación de `root@localhost` con contraseña vacía. Por ello la conexión inicial normal propuesta utiliza `--user=root --skip-password`. No hay evidencia de una contraseña temporal ni de un ALTER USER posterior exitoso. Este comportamiento coincide con el [manual de inicialización](https://dev.mysql.com/doc/refman/8.0/en/data-directory-initialization.html).
- Primer intento: no se conservó el número del error del cliente; no se puede etiquetar retrospectivamente como 1130.
- Segundo intento: OperationalError **1130**, antes de ejecutar SQL, aun con `--skip-name-resolve=OFF --no-monitor` aceptados por la validación del binario. El valor de `@@skip_name_resolve` no fue consultado; los argumentos son evidencia de intención/configuración, no confirmación SQL.
- `my-cb03.ini` conserva SHA-256 `6dee5fa065178c2971d8271d9d6a11302306db9f4a6e06deb5ebcfe0078834e6`. Contiene `shared_memory=OFF`, `named_pipe=OFF`, bind 127.0.0.1, puerto 33363 y MySQL X apagado. MEMORY necesita habilitarse mediante un override local en un arranque nuevo autorizado.
- UUID de `auto.cnf`: `eee45878-d7ac-11f1-bc4f-107c616721bd`. Su equivalencia con `@@server_uuid` sigue pendiente. La instancia está detenida; la comprobación offline final no encontró listener en 33363 ni los procesos anteriores.

## 2. Significado del error e hipótesis

1130 es `ER_HOST_NOT_PRIVILEGED` (HY000): rechazo del host cliente. Se diferencia del 1129 de host bloqueado por repetidos errores y del rechazo de contraseña; no justifica aplicar flush-hosts, restablecer claves o abrir grants globales sin diagnóstico. [Referencia oficial de errores](https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html#error_er_host_not_privileged).

| Hipótesis | Evidencia favorable | Evidencia que falta / valoración |
|---|---|---|
| El origen TCP no coincide con un Host admitido en las cuentas cargadas | El segundo cliente TCP recibe 1130; el log de inicialización anuncia root@localhost | Es la línea principal de investigación. Se desconoce el host que percibe el servidor y el estado actual de las cuentas; no se conservaron esos datos del error |
| Resolución de loopback/localhost o selección de cuenta diferente de la esperada | El primer INI tenía skip-name-resolve; TCP aplica coincidencia de origen | OFF fue pasado en el segundo intento y persistió 1130. No hay consulta de configuración ni diagnóstico de resolución del servidor. No atribuir la causa solo a DNS/skip-name-resolve |
| Las filas administrativas actuales no coinciden con las creadas inicialmente | El error es compatible con ausencia de un Host admisible | El log confirma creación inicial; no hay evidencia de que otra intervención las cambiara. Requiere lectura limitada de User/Host después de acceder normalmente; hipótesis de menor respaldo |
| El cliente llega a un servidor/configuración distintos de los pretendidos | La identidad nunca se pudo consultar por SQL | Puerto libre antes, PID propio, INI explícito, pid-file y logs reducen esta posibilidad. Sigue siendo obligatorio cotejar UUID/datadir/puerto al conectar; no se declara aislamiento SQL ya probado |
| Diferencia entre el cliente Python y la biblioteca del cliente nativo | Los fallos anteriores proceden de PyMySQL; no hubo comparación nativa | Aún no evaluado. El número procede del servidor y no demuestra un defecto de PyMySQL. Comparar clientes manteniendo el mismo servidor y endpoint |

No hay evidencia suficiente para afirmar corrupción del datadir, fallo de TLS/plugin, contraseña errónea o inexistencia definitiva de root@localhost. Cambiar de transporte es una prueba diagnóstica de la selección de cuenta, no una demostración de causa ni una reparación de grants.

## 3. Comprobación offline del cliente instalado

Ejecutable: `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`.

Resultado real de `--no-defaults --version`: **8.0.46, Win64/x86_64**, salida 0. Se ejecutaron también `--help` y ayudas con opciones TCP/MEMORY; todas las variantes compatibles terminaron con salida 0, sin conexiones. Los argumentos y resultados íntegros están en la carpeta de evidencia.

La primera comprobación con `--no-login-paths` terminó con salida 2: **opción desconocida en este mysql.exe**. No incluirla en el tercer intento. Ese hallazgo no explica los fallos previos, que usaban PyMySQL y no esa opción.

La ayuda final confirmó: `host localhost`, `user root`, `reconnect FALSE`, `binary-mode TRUE`, `connect-timeout 5` y el nombre MEMORY exclusivo. `--skip-reconnect` desactiva la reconexión que la ayuda muestra activada por defecto.

### Aislamiento de opciones y credenciales del cliente

`--no-defaults` irá primero, pero por sí solo no excluye `.mylogin.cnf`. MySQL 8.0 permite seleccionar otro archivo de login con `MYSQL_TEST_LOGIN_FILE`. Usar una ruta propia **comprobada inexistente**, eliminar variables MYSQL heredadas del entorno del proceso hijo y fijar usuario/protocolo/endpoint explícitamente. No usar `--print-defaults`, mysql_config_editor ni inspeccionar el archivo de login habitual. [Opciones del cliente](https://dev.mysql.com/doc/refman/8.0/en/mysql-command-options.html#option_mysql_no-defaults), [archivo alternativo de login](https://dev.mysql.com/doc/refman/8.0/en/mysql-config-editor.html).

Las comprobaciones reales de ayuda ya se ejecutaron con ese aislamiento. La ruta ausente no se creó. No se leyó `.env` ni se utilizó MYSQL_PWD.

## 4. TCP frente a MEMORY

| Aspecto | TCP propuesto como control | MEMORY recomendado primero |
|---|---|---|
| Selección | `--protocol=TCP --host=127.0.0.1 --port=33363` | `--protocol=MEMORY --host=localhost --shared-memory-base-name=...` |
| Endpoint real | Dirección y puerto | Nombre local de memoria compartida; el puerto no selecciona la instancia |
| Origen para cuentas | Reglas de Host para IP/nombre del cliente | Conexión local que puede coincidir con una cuenta localhost |
| Disponibilidad actual | Servidor detenido | Deshabilitado en INI; requiere override de arranque |
| Autenticación | Usuario/credencial y permisos normales | También exige usuario/credencial y permisos normales |
| Alcance | Puede ser remoto; aquí se limita a loopback | Solo local en Windows |

El [manual de control de conexión](https://dev.mysql.com/doc/refman/8.0/en/connection-access.html) describe que las conexiones no TCP se tratan como locales y pueden coincidir con cuentas localhost. El [manual de transportes](https://dev.mysql.com/doc/refman/8.0/en/transport-protocols.html) considera MEMORY un transporte local seguro por defecto; no usa TLS. Esto respalda probarlo para la cuenta inicial documentada. **No garantiza éxito, no evita contraseñas ni amplía permisos.**

Nombre exclusivo exacto, sensible a mayúsculas:

```text
CODN_CB03_eee45878_d7ac_11f1_bc4f_107c616721bd
```

Se usa el mismo nombre en servidor y cliente. Nunca `MYSQL`, nombre predeterminado. La variable `shared_memory_base_name` existe para diferenciar instancias locales y solo aplica con shared_memory habilitado. [Variables del servidor](https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html#sysvar_shared_memory_base_name).

## 5. Procedimiento recomendado — pendiente de nueva autorización

Un único tercer arranque, MEMORY como acceso inicial. Si MEMORY falla, cerrar el intento sin probar otros protocolos/cuentas. Si funciona y se coteja la identidad, permitir como máximo un control TCP con mysql.exe durante ese mismo arranque. Un fallo de ese control se registra y cierra el intento; no se reinicia el servidor ni se cambian grants para hacerlo pasar.

La propuesta mínima es **solo diagnóstico de lectura y cierre del proceso propio al finalizar**: dado que root todavía tendría la contraseña inicial vacía, no dejar el servidor encendido sin asegurar antes la credencial. Configurar esa contraseña y verificarla requeriría incluir expresamente esa operación en una autorización futura; no forma parte de los comandos de lectura siguientes.

### A. Precondiciones verificables

1. Comprobar puerto 33363 libre y ausencia de un proceso previo de esta instancia; conservar inventario de listeners habituales sin conectar a ellos.
2. Resolver la ruta exacta del datadir y comprobar `auto.cnf`, `ibdata1` y directorio mysql. Leer únicamente auto.cnf/configuración/logs; no extraer tablas de privilegios del archivo de datos.
3. Exigir UUID local y hash del INI indicados arriba. Si cambiaron, detenerse; no reparar ni inicializar.
4. Exigir que los nuevos logs/PID no existan y crear una carpeta de evidencia nueva. No sobrescribir logs anteriores.
5. Conservar hashes de evidencias previas y cambios locales del usuario; comprobar que tmp/ continúa ignorado. No cambiar .gitignore.

### B. Comando exacto del posible tercer arranque

**BLOQUE PARA REVISIÓN, NO EJECUTADO.** Solo después de autorización expresa; no lanzar desde una shell improvisada ni cambiar ruta/puerto.

```powershell
$cb03Root = 'D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql'
$cb03Server = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe'
$cb03Client = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$cb03Memory = 'CODN_CB03_eee45878_d7ac_11f1_bc4f_107c616721bd'
$cb03Ini = Join-Path $cb03Root 'my-cb03.ini'
$cb03Error = Join-Path $cb03Root 'logs/cb03-third-eee45878-01.err'
$cb03Pid = Join-Path $cb03Root 'logs/cb03-third-eee45878-01.pid'
$cb03Stdout = Join-Path $cb03Root 'logs/cb03-third-eee45878-01-stdout.log'
$cb03Stderr = Join-Path $cb03Root 'logs/cb03-third-eee45878-01-stderr.log'
foreach ($cb03File in @($cb03Error,$cb03Pid,$cb03Stdout,$cb03Stderr)) {
    if (Test-Path -LiteralPath $cb03File) { throw 'Log/PID preexistente: detener.' }
}
$cb03Args = @(
    ('--defaults-file="{0}"' -f $cb03Ini),
    '--skip-name-resolve=OFF', '--no-monitor',
    '--shared-memory=ON', ('--shared-memory-base-name={0}' -f $cb03Memory),
    '--bind-address=127.0.0.1', '--port=33363', '--mysqlx=OFF', '--named-pipe=OFF',
    ('--log-error="{0}"' -f $cb03Error), ('--pid-file="{0}"' -f $cb03Pid)
)
$cb03Process = Start-Process -FilePath $cb03Server -ArgumentList $cb03Args `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $cb03Stdout `
    -RedirectStandardError $cb03Stderr
```

Primero se podrá ejecutar la misma lista de argumentos con `--validate-config`, después de autorizar el intento, y exigir salida 0 antes del único arranque. No se ha hecho esa validación del servidor en esta intervención. Comprobar luego PID propio, binario, CommandLine del INI exacto, pid-file y listener 127.0.0.1:33363. Con no-monitor se espera un solo servidor; una discrepancia detiene el procedimiento. Tiempo máximo de preparación: 30 s, sin relanzar.

No se modifica el INI: los parámetros finales anulan shared_memory=OFF y skip-name-resolve de ese archivo únicamente para este proceso. No se invocan initialize, install/service, skip-grant-tables, init-file ni comandos funcionales.

### C. Entorno privado del cliente

Preparar un proceso hijo con `ProcessStartInfo`, `UseShellExecute=false`, `CreateNoWindow=true` y stdout/stderr capturados. En **su Environment**, eliminar MYSQL_PWD, MYSQL_HOST, MYSQL_TCP_PORT, MYSQL_UNIX_PORT, MYSQL_HOME y MYSQL_GROUP_SUFFIX. Fijar MYSQL_TEST_LOGIN_FILE a una ruta nueva inexistente de la carpeta de este intento y comprobar que no aparece después. No modificar el entorno global ni los archivos de login.

Los comandos D/E siguientes se ejecutarán solo dentro de ese entorno limpio. El supervisor impondrá **10 s de tiempo total por cliente**, leyendo stdout/stderr de forma asíncrona; al agotarse, terminará solo ese proceso cliente recién creado y cerrará el intento. connect-timeout=5 no sustituye ese límite externo, especialmente para MEMORY. No usar --force, reconexión automática ni init-command.

### D. Cliente MEMORY y primera consulta de identidad

```powershell
$cb03IdentitySql = @'
SELECT @@server_uuid AS server_uuid,
       @@datadir AS datadir,
       @@port AS port,
       @@version AS version,
       @@hostname AS hostname,
       @@bind_address AS bind_address,
       @@skip_name_resolve AS skip_name_resolve,
       @@shared_memory AS shared_memory,
       @@shared_memory_base_name AS shared_memory_base_name,
       CURRENT_USER() AS authenticated_account,
       USER() AS presented_identity,
       DATABASE() AS selected_database,
       CONNECTION_ID() AS connection_id;
'@
& $cb03Client --no-defaults --protocol=MEMORY --host=localhost `
    "--shared-memory-base-name=$cb03Memory" --user=root --skip-password `
    --connect-timeout=5 --skip-reconnect --no-auto-rehash --batch --raw `
    --skip-column-names --binary-mode --default-character-set=utf8mb4 `
    --local-infile=0 "--execute=$cb03IdentitySql"
```

`--execute` contiene solo SQL sin secretos. MEMORY no utiliza 33363 para localizar el servidor: la protección es el nombre exclusivo + identidad devuelta + proceso propio. Exigir UUID `eee45878-d7ac-11f1-bc4f-107c616721bd`, datadir normalizado exacto, puerto 33363, versión 8.0.46, bind 127.0.0.1, skip_name_resolve=0, shared_memory=1, nombre exclusivo y CURRENT_USER()=`root@localhost`. DATABASE() debe ser NULL. Si algo falla, no ejecutar más consultas ni escrituras.

Solo después de ese cotejo se proponen estas lecturas limitadas, mediante el mismo protocolo/endpoint:

```sql
SELECT User, Host, plugin, account_locked, password_expired
FROM mysql.user WHERE User = 'root' ORDER BY Host;

SELECT CONNECTION_TYPE
FROM performance_schema.threads
WHERE PROCESSLIST_ID = CONNECTION_ID();

SHOW DATABASES;

SELECT COUNT(*) AS functional_tables
FROM information_schema.tables
WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys');
```

Nunca seleccionar authentication_string ni volcar mysql.user completo. Los campos listados son metadatos diagnósticos, no hashes de contraseña. Capturar el tipo de conexión real: [tabla threads](https://dev.mysql.com/doc/refman/8.0/en/performance-schema-threads-table.html). Las lecturas adicionales pueden formar una segunda invocación MEMORY acotada; no un bucle de reintentos.

### E. Control TCP nativo, únicamente si MEMORY pasó

Durante el mismo arranque ya identificado, como máximo una invocación de comparación:

```powershell
& $cb03Client --no-defaults --protocol=TCP --host=127.0.0.1 --port=33363 `
    --user=root --skip-password --connect-timeout=5 --skip-reconnect `
    --no-auto-rehash --batch --raw --skip-column-names --binary-mode `
    --default-character-set=utf8mb4 --local-infile=0 "--execute=$cb03IdentitySql"
```

No sustituir 127.0.0.1 por un host habitual ni omitir el puerto. Si da 1130, registrar código/SQLSTATE y, si aparece, únicamente el host del mensaje, sin credenciales. MEMORY exitoso con TCP rechazado respaldaría una diferencia de selección de origen/cuenta; no demostraría por sí solo el mecanismo DNS exacto. Si TCP pasa mientras PyMySQL falló en una ejecución anterior, tampoco prueba un defecto del driver: las ejecuciones y condiciones temporales son distintas.

### F. Cierre limitado al proceso propio

Detener ante error del cliente, timeout, identidad inesperada, PID/listener discrepantes o lectura de cuenta inesperada; también al terminar el diagnóstico mínimo, para no dejar una instancia con credencial inicial vacía.

Conservar el objeto `$cb03Process` retornado por este Start-Process y cotejar su Id, StartTime, ejecutable, CommandLine con el INI exacto, pid-file y listener. Revalidar inmediatamente antes de actuar para evitar reutilización de PID. Terminar únicamente ese objeto comprobado:

```powershell
# Solo después de los cotejos anteriores, nunca por nombre genérico "mysqld".
Stop-Process -InputObject $cb03Process -ErrorAction Stop
if (-not $cb03Process.WaitForExit(10000)) { throw 'Cierre no confirmado; no ampliar acciones.' }
```

Verificar ausencia del proceso propio y listener 33363. No matar descendientes o PIDs ajenos, no parar servicios, no borrar archivos ni directorios. Si el proceso no puede identificarse inequívocamente o persiste tras el plazo, detener la automatización y reportarlo sin ampliar el alcance.

Stop-Process fuerza el cierre y puede provocar recuperación InnoDB en un arranque posterior; no equivale a un apagado SQL ordenado. Se limita a esta instancia sin datos funcionales y se conservan datadir/logs. Un apagado administrativo ordenado sería preferible si existe una sesión autenticada inequívoca, pero su comando debe incluirse expresamente en la autorización futura; no se añade aquí una operación SQL implícita.

## 6. Interpretación y autorizaciones pendientes

| Resultado futuro | Conclusión permitida / acción |
|---|---|
| MEMORY autentica e identidad coincide | Acceso administrativo local e identidad confirmados para ese protocolo; leer metadatos acordados |
| MEMORY rechaza cuenta o falla IPC | Registrar error y cerrar proceso propio; no crear usuarios ni eludir autenticación |
| MEMORY pasa y TCP da 1130 | Diferencia de acceso por transporte/origen, pendiente de interpretar cuentas/Host; cerrar sin modificar grants |
| Ambos pasan | Comparación nativa satisfactoria en ese arranque; no atribuir automáticamente el fallo previo a PyMySQL |
| UUID/datadir/puerto no coinciden | Conflicto de identidad; no ejecutar más SQL, detener únicamente proceso propio comprobado |

La nueva autorización necesaria debe cubrir explícitamente: **un tercer arranque del mismo datadir, activar MEMORY con el nombre exclusivo, conexiones y consultas limitadas anteriores, y cierre del proceso propio**. Esto no está concedido por la petición actual, que autoriza diagnóstico offline y exige detenerse tras presentarlo.

Asegurar y probar la contraseña de root requerirá autorización explícita de esa escritura administrativa y un mecanismo secreto en memoria/DPAPI fuera del repositorio. Ningún comando de esta propuesta contiene contraseña. No se proponen CREATE USER alternativos, cambios de Host, grants %, reseteos ni bypass de autenticación.

Crear esquema/índices/FK, cuenta restringida e insertar las 40 filas sintéticas, ejecutar CB-03 y decidir limpieza de datos permanecen en una puerta posterior independiente. **Estado de CB-03: BLOQUEADA.**

## 7. Respaldo y límite de ejecución

Las ayudas prueban que el cliente instalado acepta las opciones; no prueban conectividad ni autentican root. El servidor no se ejecutó en esta intervención, por lo que las opciones MEMORY de mysqld están contrastadas con el manual, pendientes de validación local durante el intento autorizado.

Logs: versión/ayuda compatibles, ayuda de MEMORY/TCP y ayuda con opciones finales; se conserva también el rechazo de --no-login-paths. JSON: argumentos/códigos de salida, archivo de login alternativo ausente y estado sin arrancar. Hashes y verificación de evidencias previas acompañan la corrida. Las rutas de diagnóstico no incluyen secretos ni archivos de datos MySQL.
