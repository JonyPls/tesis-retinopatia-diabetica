# CB-03 — Procedimiento y solicitud de provisionamiento

**Estado actual: NO AUTORIZADO / NO EJECUTADO.** No existe destino SQL verificado de pruebas.
Esta propuesta no autoriza ejecutarse a sí misma. No se debe cambiar un booleano en el JSON para sustituir la autorización del usuario.

## Inventario real y límite de lo verificado

- Se detectaron procesos mysqld PID 19808/20248; solo se observaron listeners 3306/33060 del PID 20248.
- Sus ExecutablePath no fueron accesibles (null). No se deduce identidad de esas instancias ni se conecta a ellas.
- Binario local presente: `C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe`, versión del archivo 8.0.46.0; no acredita versión de un servidor arrancado.
- Puerto propuesto 33363: sin listener al inventariar; debe comprobarse de nuevo antes del arranque.
- `Temp/opencode`: no se encontraron directorios candidatos mysql/b1/disposable; no se buscó contenido clínico.
- Evidencia: `evidencias/20261103T172031Z-cb03-a3c5f7f4/inventario-entorno.json`. Cero conexiones SQL.

## Etapa 1: aprobación solicitada para inicializar y arrancar una instancia NUEVA

Destino propuesto, todavía no creado:

```text
host: 127.0.0.1
port: 33363
root: D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql
datadir: D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql\data
mysqld: C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe
```

Operaciones a autorizar: comprobar que root/datadir no existen; crear únicamente esa raíz; ejecutar `mysqld --no-defaults --initialize-insecure` para ese datadir nuevo; arrancar un proceso propio oculto con bind a 127.0.0.1, puerto 33363, MySQL X apagado (`--mysqlx=OFF`), binlog apagado y logs bajo esa raíz. No servicios de Windows ni configuración habitual. Si el puerto está ocupado o el datadir existe, detenerse; no borrarlos ni reutilizarlos.

La inicialización escribe tablas internas del nuevo servidor; requiere autorización separada aunque no haya fixtures. No se ejecuta aquí.

Después del arranque, leer solo el `auto.cnf` propio y conectar únicamente al nuevo puerto para consultar `@@version`, `@@port`, `@@server_uuid`, `@@datadir`; cotejar UUID/ruta/puerto con el proceso propio y rechazar UUID habitual histórico. Registrar resultado sin contraseñas. El UUID todavía es **desconocido**, no se inventa ni se presenta como destino ya verificado.

## Etapa 2: esquema exclusivo, cuenta y nueva aprobación concreta

Presentar al usuario el UUID/datadir/puerto obtenidos antes de cualquier DDL del esquema de pruebas o INSERT de fixtures.
Esquema propuesto: `codn_cb03_20261103_a3c5f7f4` (vacío). Cuenta propuesta: `codn_cb03`, solo SELECT e INSERT en ese esquema; ninguna autorización global, sin CREATE/DROP/ALTER/UPDATE/DELETE/TRIGGER/EVENT/FILE. Custodiar contraseña fuera del repositorio y evidencias.

Se necesita DDL saneado y revisado para las tablas requeridas por los modelos/repositorios actuales. **No se adjunta ni inventa un esquema productivo, ni se da por compatible uno no inspeccionado.** La selección/extracción de DDL de una fuente local autorizada y la creación del esquema requieren aprobación expresa. No ejecutar SQL maestro ni semillas con DROP/INSERT; no `db.create_all`, migraciones, reconstrucción, SQLite ni datos copiados de la base habitual.

El arnés B1 existente NO se reutiliza como comando: administra SQL maestro, reconstrucciones, semillas históricas y limpieza. Solo se reutilizan sus ideas de fijar UUID/datadir/puerto, suppress load_dotenv, configurar UTC y usar repositorios reales.

Una vez provisionados esquema/cuenta, crear en la raíz propia un acta `codn-cb03-instance.json` con `purpose=CODN_CB03_DISPOSABLE`, UUID y puerto reales. Copiar el JSON de ejemplo fuera de evidencias, completar UUID real y activar únicamente los permisos de inspección expresamente concedidos. El ejemplo permanece inactivo y sin contraseña.

## Etapa 3: inspección de solo lectura

Desde `backend/`, en una carpeta de evidencia NUEVA:

```powershell
.\venv\Scripts\python.exe -B -u codn_run_cb03_mysql.py inspect --config '<config-autorizada.json>' --output '<nueva-evidencia-inspeccion>'
```

El runner pide la contraseña sin registrarla; no lee `.env`. Verifica identidad fijada y auto.cnf, columnas/tipos lógicos/PK/autoincrement/FK/índices/uniquidad/checks, InnoDB, tablas vacías, ausencia de triggers visibles y privilegios limitados. Conserva metadatos, no filas clínicas. Las diferencias signed/unsigned y las restricciones extra deben revisarse con el DDL: la comprobación automática acredita compatibilidad mínima, no equivalencia con producción. SHOW DATABASES/SHOW TRIGGERS con cuenta restringida no prueban ausencia de objetos ocultos; complementar con el acta del administrador de la instancia nueva.

Si falla una condición, registrar BLOQUEADO sin modificar el esquema. Cuenta, esquema o UUID desconocidos no se sustituyen por defaults.

## Etapa 4: autorización de fixtures y ejecución

Mostrar destino verificado + resultado de inspección + matriz de 40 filas sintéticas. Obtener autorización expresa para los INSERT de esas 11 tablas. Solo entonces reflejarla en `fixture_writes_authorized` y `approval_reference`.

```powershell
.\venv\Scripts\python.exe -B -u codn_run_cb03_mysql.py run --config '<config-autorizada.json>' --output '<nueva-evidencia-CB03>'
```

Se usa SQLAlchemy/MySQL real y una transacción única en InnoDB. Antes de cada INSERT se vuelve a comprobar identidad remota; tras fixtures se cierra la fase de escrituras. Los 10 métodos invocan repositorios reales. Único spy: execute con wraps para contar una consulta real de retorno temprano. Ningún mock sustituye las consultas objetivo.

Limpieza: rollback de la transacción propia; no DELETE, DROP ni TRUNCATE. Después se comparan conteos de todas las tablas desde una conexión independiente con el baseline vacío. Los contadores AUTO_INCREMENT pueden avanzar pese al rollback y no se afirma que los bytes del datadir queden iguales. Si el rollback/consulta final falla, registrar fallo y conservar instancia para conciliación; no repetir automáticamente ni borrar datos.

Mantener proceso/datadir para revisión; apagado del PID propio y eliminación recursiva del datadir no se automatizan ni quedan autorizados en esta propuesta. Requieren alcance acordado y verificación de ruta/PID. No tocar servicios o archivos habituales.

## Evidencias y criterio de salida

Log completo con comando/código de salida, identidad, metadatos, IDs dinámicos, esperado/obtenido, resultados de métodos/subcasos, conteos antes/después, trace de funciones objetivo y fuentes exactas. Cobertura solo de líneas; no ramas ni porcentaje automático de predicados SQL.
Para PNG: después de ejecución real, abrir el HTML en navegador y capturarlo con Recortes; identificarlo como reporte, nunca como consola o interfaz clínica. Actualmente PNG pendiente y ninguna cobertura de CB-03 medida.

Punto exacto de detención actual: **antes de crear/inicializar datadir o arrancar MySQL**, y por tanto antes de cualquier DDL del esquema, INSERT o conexión a un destino no autorizado.
