# 29D.1 — Respaldo restaurado; reconstrucción habitual NO ejecutada

## Identidad, alcance y hallazgo que exige revisión

Al 12/10/2026, el propietario identificó y confirmó como MySQL habitual de
desarrollo: conexión local, puerto `3306`, esquema
`centro_oftalmologico_db_v2`, MySQL `8.0.46`, UUID
`1b48ef4a-4e14-11f1-acd7-107c616721bd`, datadir
`C:\ProgramData\MySQL\MySQL Server 8.0\Data\`, identidad SQL
`root@localhost`. La identificación se obtuvo exclusivamente mediante
`SELECT` y se revalidó antes de exportar y después de ensayar la restauración.
No registrar contraseña, URI SQLAlchemy ni datos de personas en esta guía.

**Diferencia con el supuesto de 29C.6:** el servidor confirmado **ya
contiene 16 tablas, `informes.revision_actual`, `informes_versiones`,
`confirmaciones_exportacion_retinografo`, 21 permisos y grants 7/14/6/6**.
No hay informes ni versiones registrados. No se sabe quién, cómo ni cuándo
actualizó este servidor; no deducirlo de la semilla ni de este inventario.
Antes de autorizar un `DROP TABLE` nuevo, el propietario deberá revisar esta
discrepancia y decidir si una reconstrucción adicional sigue teniendo sentido.
La aprobación de la **opción A** (aceptar la pérdida de registros fuera de
semillas) NO fue autorización para ejecutar el maestro durante 29D.1.

Inventario SQL de solo lectura, revalidado respecto del respaldo:

| Tabla | Filas |
|---|---:|
| `cargos` | 4 |
| `confirmaciones_exportacion_retinografo` | 0 |
| `diagnosticos_retinopatia` | 0 |
| `diagnosticos_retinopatia_detalle` | 0 |
| `grados_retinopatia` | 5 |
| `informes` | 0 |
| `informes_versiones` | 0 |
| `pacientes` | 20 |
| `permisos` | 21 |
| `rol_permiso` | 33 |
| `roles` | 4 |
| `tipos_documento` | 3 |
| `tipos_informe` | 6 |
| `usuario_rol` | 3 |
| `usuarios` | 2 |
| `visitas_clinicas` | 0 |

Los informes por estado (`ACTIVO`, `INACTIVO`, `ANULADO`) son 0, 0 y 0;
0 vistas, 0 triggers, 0 rutinas y 0 eventos. Hay 101 filas en total. La
semilla del maestro tiene los mismos recuentos; **esto no equivale a haber
identificado todos los bytes externos, configuración del servidor o historia
del entorno**. `@@event_scheduler` está ON, pero no hay eventos definidos en
este esquema. El propietario afirmó haber suspendido todos los escritores;
en el instante previo a la exportación no había transacciones InnoDB ni
otras consultas activas. HeidiSQL permanecía abierto y `@@read_only` era
FALSE: esto no demuestra que el servidor permanezca sin escritores tras el
respaldo; una ejecución destructiva futura requiere **nuevo punto de corte**.

## Copias privadas y ensayo de recuperación

Se utilizó `mysqldump` local de MySQL 8 con `--no-defaults`, TCP al servidor
confirmado, `--single-transaction --quick --routines --events --triggers
--hex-blob --column-statistics=0 --set-gtid-purged=OFF --databases
centro_oftalmologico_db_v2`; contraseña únicamente mediante entorno del
subproceso (nunca como argumento, documentación o log). Archivo creado con
nombre único en la carpeta privada aprobada bajo
`C:\Users\ricar\.opencode\backups\tesis-retinopatia-diabetica\29d1-<fecha>-<sufijo>\`,
**fuera del repositorio, Flask y directorios temporales**. Guardar allí el
dump y una copia independiente del maestro aprobado; no incorporar dump,
manifiestos de contenido ni credenciales a Git. ACL inspeccionada: propietario,
SYSTEM y administradores; no acceso general. Los hashes y la ruta completa
del ejemplar generado figuran en el informe del ensayo, no en un script
versionado. El dump incluye `CREATE DATABASE` y un único `USE` del esquema
esperado, además de `DROP TABLE` de 16 tablas; **no contiene `DROP DATABASE`**.

Se volvió a calcular SHA-256 antes de restaurar. Se creó una instancia MySQL
8 desechable en el directorio temporal aprobado, con datadir propio, puerto
distinto de 3306, UUID diferente al habitual y esquema inicialmente ausente.
Se importó **el dump del servidor habitual, no el maestro**, exclusivamente
en esa instancia. El cliente importó sin errores; se comprobó identidad al
final y se detuvo y retiró solo la instancia temporal creada por el ensayo.
Comparación origen/restauración: mismas **16 tablas, 157 columnas, 74 entradas
de índices, 76 restricciones y 24 FK**, mismos DDL `SHOW CREATE TABLE`
(ignorando únicamente el valor de contador `AUTO_INCREMENT`), recuento igual
por tabla y SHA-256 agregado de filas ordenadas por clave primaria igual
en las 16 tablas; vistas/triggers/rutinas/eventos 0 en ambos lados. No se
mostraron ni copiaron a la conversación filas ni identificadores personales.

**RESPALDO RESTAURABLE: SÍ** para el estado exportado del esquema. No es
respaldo de las cuentas globales del servidor, configuración MySQL, archivos
físicos de imágenes ni cambios ocurridos **después** del punto de corte. Si
se reanudan escritores antes de la reconstrucción, producir y volver a ensayar
un respaldo **nuevo** bajo otra ventana sin escrituras.

## Maestro y archivos externos

SHA-256 del maestro vigente y de su copia privada:
`76CC327785A5F08667BAA1041B8E2703F2CFC10EF39D2910010055C2B6F27EDD`.
El arnés SQL lo ejecutó **dos veces solo en MySQL desechable**, corroborando
16 tablas, `revision_actual`, versiones, confirmaciones, 21 permisos, cuatro
roles, grants 7/14/6/6, `informes.anular` exclusivo del oftalmólogo,
`informes.inactivar` sin grants, semillas, unicidades y FK/CHECK restrictivas.
El maestro declara `CREATE DATABASE IF NOT EXISTS`, `USE` y los 16 `DROP
TABLE`; elimina hijos antes que padres y crea padres antes que hijos. **No
aplicar después** las migraciones incrementales B1 ya incorporadas al seed.

El dump lógico **no** incluye `backend/uploads/retinas` (JPEG original y
Grad-CAM; 257 archivos observados) ni `C:\DATA\data_clinica` (exportaciones
del retinógrafo; 14 archivos observados). `diagnosis_service.py` usa
`uploads/retinas` relativo al cwd, `files_routes.py` y `report_service.py`
usan la ruta bajo `backend`; verificar el cwd real antes de cambiar de
servidor. La ruta privada `RETINOGRAPH_PRIVATE_DIR` se obtiene de
`app.config` en despliegue y **no está configurada en `app.py`**: su existencia
y contenido requieren inventario del operador; no suponer que están vacíos.
Preservar y proteger estas ubicaciones por separado si el propietario lo
requiere; no borrar, mover ni sincronizar datos clínicos automáticamente.
Una reconstrucción puede dejar archivos huérfanos aunque el SQL vuelva a
semillas. Se recomienda copia privada y conciliación de vínculos autorizada
antes de cualquier limpieza de archivos; no se hizo copia de ellos en 29D.1.

## Instrucciones para HeidiSQL — para autorización posterior, NO ejecutarlas ahora

1. Decidir por escrito si todavía se requiere reconstrucción a pesar de que
   el esquema actual ya tiene 16 tablas. Aceptar explícitamente que el
   maestro **descarta toda fila no incluida en sus semillas** y confirmar la
   custodia de archivos externos. Programar otra ventana con todos los
   escritores suspendidos, incluidas aplicaciones, tareas, integraciones y
   operaciones manuales desde HeidiSQL. Registrar el punto de corte.
2. Generar un respaldo **nuevo** si hubo cualquier escritura tras el actual;
   verificar SHA-256 y restaurarlo en un servidor aislado como se hizo en
   29D.1. Mantener accesible un respaldo restaurable del estado a reemplazar,
   con su información de identidad, tamaño y fecha; no basta el SQL maestro.
3. En HeidiSQL seleccionar la sesión de desarrollo aprobada, NO una conexión
   por el mero hecho de llamarse «local». En una pestaña de consulta ejecutar
   **solo** `SELECT @@server_uuid, @@port, @@datadir, DATABASE(), @@version;`
   y contrastar con los valores que el propietario vuelva a aprobar para el
   momento del corte. Confirmar esquema `centro_oftalmologico_db_v2` y que
   el servidor no se confundió con uno de prueba. Si cambia identidad, parar.
4. Comprobar de nuevo el hash SHA-256 del archivo maestro **local** y leer las
   cabeceras `CREATE DATABASE` / `USE` y la secuencia de los 16 `DROP TABLE`.
   Usar la función de HeidiSQL **Archivo → Ejecutar archivo SQL...** (el
   nombre puede variar con el idioma/versión); elegir **exclusivamente** el
   maestro completo aprobado, en la conexión confirmada. Nunca elegir el dump
   del respaldo como sustituto del maestro ni seleccionar otro servidor.
   Ejecutarlo **solo** tras autorización destructiva separada. Registrar el
   resultado y abortar ante cualquier error de SQL/FK/CHECK; MySQL DDL tiene
   commits implícitos: un `ROLLBACK` no revierte una ejecución parcial.
5. Antes de reanudar POST, ejecutar los controles de solo lectura de abajo;
   cotejar semillas, grants y filas de informes/versiones, y desplegar
   conjuntamente el backend que inserta `CREACION` n.º 1 en el mismo commit.
   El backend nuevo no debe funcionar sobre un esquema viejo ni debe escribir
   el backend antiguo contra el nuevo. Verificar las **24 rutas B1** previas,
   GET vigentes y error controlado; PUT, anulación e historial deben seguir
   **desactivados** (`app.config` no contiene booleano `True`) y DELETE
   bloqueado. No basar activación en variables de entorno ambiguas.
6. Si el propietario autoriza una prueba sintética sobre el esquema ya
   reconstruido, usar un paciente ficticio autorizado y crear visita e informe
   por POST real; exigir exactamente una versión `CREACION` n.º 1 con mismo
   estado/datos/conclusión/schema y autor JWT, sin duplicado. La creación de
   prueba persistirá hasta que se apruebe su tratamiento: no borrarla a mano
   ni asumir que una FK permitirá eliminarla. Si NO autoriza escrituras de
   prueba, reproducir exactamente este chequeo en copia aislada de la misma
   versión **antes** de permitir POST habitual. Sólo reanudar escritores tras
   conciliación y permiso del propietario.

### Consultas de inventario previo: esquema antiguo o desconocido

No referenciar `revision_actual` ni `informes_versiones` hasta comprobar su
existencia en `information_schema`. Estas consultas **solo leen**:

```sql
SELECT @@server_uuid, @@port, @@datadir, DATABASE(), @@version;
SELECT table_name FROM information_schema.tables
 WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name;
SELECT table_name,column_name FROM information_schema.columns
 WHERE table_schema=DATABASE() AND
 ((table_name='informes' AND column_name='revision_actual')
  OR table_name='informes_versiones');
SELECT COUNT(*) AS total_pacientes FROM pacientes;
SELECT COUNT(*) AS total_usuarios FROM usuarios;
SELECT COUNT(*) AS total_visitas FROM visitas_clinicas;
SELECT COUNT(*) AS total_diagnosticos FROM diagnosticos_retinopatia;
SELECT COUNT(*) AS total_detalles FROM diagnosticos_retinopatia_detalle;
SELECT estado, COUNT(*) AS total FROM informes GROUP BY estado;
```

Los objetos opcionales (confirmaciones, versiones) deben verificarse primero
en `information_schema`; no emitir `SELECT` contra una tabla inexistente.

### Consultas posteriores: SOLO después de verificar el esquema de 16 tablas

```sql
SELECT COUNT(*) AS tablas FROM information_schema.tables
 WHERE table_schema=DATABASE() AND table_type='BASE TABLE';
SELECT table_name FROM information_schema.tables
 WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name;
SELECT COUNT(*) AS permisos FROM permisos;
SELECT COUNT(*) AS roles FROM roles;
SELECT r.codigo, COUNT(*) AS grants FROM rol_permiso rp
 JOIN roles r ON r.id=rp.rol_id GROUP BY r.codigo ORDER BY r.codigo;
SELECT r.codigo,p.codigo FROM rol_permiso rp
 JOIN roles r ON r.id=rp.rol_id JOIN permisos p ON p.id=rp.permiso_id
 WHERE p.codigo IN ('informes.anular','informes.inactivar')
 ORDER BY p.codigo,r.codigo;
SELECT table_name,column_name FROM information_schema.columns
 WHERE table_schema=DATABASE() AND table_name='informes'
 AND column_name IN ('schema_version','revision_actual');
SELECT table_name,index_name,column_name,non_unique FROM information_schema.statistics
 WHERE table_schema=DATABASE() AND
 ((table_name='informes' AND index_name='uq_informes_visita_tipo') OR
  (table_name='informes_versiones' AND index_name='uq_informes_versiones_informe_numero'))
 ORDER BY table_name,index_name,seq_in_index;
SELECT table_name,constraint_name,constraint_type,enforced
 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE()
 AND table_name IN ('informes','informes_versiones','confirmaciones_exportacion_retinografo')
 ORDER BY table_name,constraint_name;
SELECT table_name,constraint_name,delete_rule,update_rule
 FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE()
 AND table_name IN ('informes','informes_versiones','confirmaciones_exportacion_retinografo')
 ORDER BY table_name,constraint_name;
SELECT COUNT(*) AS informes FROM informes;
SELECT COUNT(*) AS versiones FROM informes_versiones;
SELECT COUNT(*) AS confirmaciones FROM confirmaciones_exportacion_retinografo;
SELECT COUNT(*) AS sin_inicial FROM informes i LEFT JOIN informes_versiones v
 ON v.informe_id=i.id AND v.numero_version=1
 WHERE v.id IS NULL OR v.operacion NOT IN ('CREACION','MIGRACION_INICIAL');
SELECT COUNT(*) AS secuencias_invalidas FROM informes i LEFT JOIN
 (SELECT informe_id,COUNT(*) AS n,MIN(numero_version) AS minimo,
 MAX(numero_version) AS maximo FROM informes_versiones GROUP BY informe_id) x
 ON x.informe_id=i.id WHERE x.n IS NULL OR x.n<>i.revision_actual OR
 x.minimo<>1 OR x.maximo<>i.revision_actual;
SELECT COUNT(*) AS ultimo_no_coincide FROM informes i LEFT JOIN informes_versiones v
 ON v.informe_id=i.id AND v.numero_version=i.revision_actual
 WHERE v.id IS NULL OR NOT(v.estado <=> i.estado) OR
 NOT(v.schema_version <=> i.schema_version) OR
 NOT(v.conclusion <=> i.conclusion) OR
 NOT(v.datos_estructurados <=> i.datos_estructurados);
SELECT COUNT(*) AS versiones_huerfanas FROM informes_versiones v
 LEFT JOIN informes i ON i.id=v.informe_id WHERE i.id IS NULL;
SELECT informe_id,numero_version,COUNT(*) AS duplicados FROM informes_versiones
 GROUP BY informe_id,numero_version HAVING COUNT(*)>1;
```

Esperar 16 tablas, 21 permisos, 4 roles, grants por código
`ADMINISTRADOR_SISTEMA=7`, `OFTALMOLOGO=14`, `ENFERMERO=6`,
`ASISTENTE_ADMINISTRATIVO=6`, `informes.anular` solo del oftalmólogo y
`informes.inactivar` sin filas. En reconstrucción limpia deben empezar en
cero informes, versiones y confirmaciones; las cinco comprobaciones de
inconsistencias también deben dar cero. Los índices y restricciones deben
corresponder a los nombres/reglas del maestro, no solo a un recuento.
Si el esquema no coincide, existen versiones huérfanas o aparece un informe
sin versión 1: **no reanudar POST; no fabricar versiones**. Preservar
evidencias y decidir restauración supervisada del respaldo previo.

## Puertas de decisión (29D.1)

| Requisito | Resultado y evidencia |
|---|---|
| Identidad habitual | SÍ: UUID/puerto/datadir/esquema confirmados por propietario y SELECT. |
| Inventario | SÍ: 16 tablas, recuentos anteriores; contradice supuesto de 15 tablas. |
| Escritores suspendidos para el respaldo | SÍ para el punto de corte: confirmado por propietario; 0 transacciones/consultas externas activas. No es garantía permanente. |
| Respaldo lógico completo disponible | SÍ: dump de base con datos/DDL y objetos opcionales; no incluye archivos externos ni cuentas globales MySQL. |
| Hash respaldo comprobado | SÍ: antes y justo antes de importación aislada. |
| Restauración aislada | SÍ: datadir/puerto/UUID independientes; importación sin errores. |
| Estructura y filas conciliadas | SÍ: 16 tablas, metadatos/DDL, 101 filas y huellas agregadas por tabla iguales. |
| Maestro nuevo validado | SÍ: SHA esperado y ensayo SQL aislado de dos reconstrucciones. |
| Semillas/grants confirmados | SÍ: maestro aislado y conteos/grants observados en el habitual. |
| Archivos externos considerados | PARCIAL: inventariados sin nombres; aún no respaldados/conciliados y raíz privada no confirmada. |
| Procedimiento HeidiSQL | PREPARADO, **no ejecutado**. |
| Comprobaciones posteriores y backend | PREPARADAS, **no ejecutadas sobre habitual**. |

**Puertas pendientes para autorizar un futuro DROP:** resolver por qué el
esquema habitual ya parece actualizado; decidir custodia de archivos externos;
confirmar de nuevo identidad, hash y punto de corte sin escritores; repetir
respaldo/restauración si hubo cambios; recibir **autorización destructiva
separada**. Hasta entonces: **PENDIENTE** para reconstrucción limpia
supervisada. No activar `REPORTS_EDIT_ENABLED`, `REPORTS_ANNUL_ENABLED` ni
`REPORTS_HISTORY_ENABLED`; DELETE continúa bloqueado. No hubo migración ni
ejecución del maestro en MySQL habitual durante 29D.1.
