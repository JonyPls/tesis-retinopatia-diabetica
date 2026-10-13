# 29D.2 — Equivalencia del esquema habitual sin reconstrucción

**Dictamen: EQUIVALENTE** para el esquema y catálogos inspeccionados. **No
ejecutar el maestro ni reconstruir por HeidiSQL**: el MySQL habitual ya tiene
la estructura aprobada. Esta comprobación no autoriza un POST de prueba ni
activa funcionalidades; esperar autorización específica del propietario.

## Identidad, referencia y aislamiento

Antes de consultar tablas se reconfirmó por `SELECT`: MySQL `8.0.46`, UUID
`1b48ef4a-4e14-11f1-acd7-107c616721bd`, puerto `3306`, datadir
`C:\ProgramData\MySQL\MySQL Server 8.0\Data\`, base
`centro_oftalmologico_db_v2`, conexión SQL `root@localhost`. La comparación
volvió a comprobar versión, UUID, puerto, datadir y esquema. No se inició
Flask ni se ejecutó SQL de escritura en este servidor.

El SHA-256 del maestro `backend/db/centro-oftalmologico-db-v2.sql` es
`76CC327785A5F08667BAA1041B8E2703F2CFC10EF39D2910010055C2B6F27EDD`.
Las copias privadas de 29D.1 siguen accesibles, sin sobreescritura:

| Archivo privado, bajo `C:\Users\ricar\.opencode\backups\tesis-retinopatia-diabetica\29d1-20261012-200524-e31ce840\` | Bytes | SHA-256 revalidado |
|---|---:|---|
| `habitual.pre-reconstruccion.sql` | 40439 | `0618367F73D27B885863D2BBB959FBC43DFD0CFC712E5B7C339631C2059B4BD9` |
| `maestro-16-tablas.aprobado.sql` | 29348 | `76CC327785A5F08667BAA1041B8E2703F2CFC10EF39D2910010055C2B6F27EDD` |

**RESPALDO RESTAURABLE: SÍ**, conforme al ensayo aislado de 29D.1; en
29D.2 se verificaron de nuevo existencia, tamaño y hashes, **no se hizo
una nueva restauración del respaldo**. Una escritura posterior al punto de
corte de 29D.1 no quedaría respaldada por ese ejemplar.

Se creó una instancia MySQL 8 totalmente nueva en datadir temporal propio,
con puerto diferente de 3306 y UUID diferente del habitual. Se verificó
la ausencia inicial del esquema, se estableció una contraseña efímera en la
instancia temporal y **solo allí** se ejecutó el maestro completo. Se
revalidó datadir, puerto y UUID antes de compararla. La instancia se detuvo
y retiró tras el ensayo; ni el maestro ni el respaldo se importaron al
servidor habitual.

## Comparación estructural y de semillas

Las consultas `information_schema`, `SHOW CREATE TABLE` y `SELECT` de ambos
servidores devolvieron exactamente los mismos registros estructurales:

| Componente | Habitual y referencia temporal | Diferencias |
|---|---:|---:|
| Nombres de tablas, motor, collation, row format y opciones | 16 | 0 |
| Columnas: orden, tipo exacto (incluido UNSIGNED/ENUM/JSON/DATETIME(6)), nulos, default, extra/autoincremento, charset/collation y precisión | 157 | 0 |
| Entradas de índices: PK, UNIQUE, columnas y orden, subparte, método, visibilidad, expresión | 74 | 0 |
| Restricciones por nombre/tipo y estado de aplicación | 76 | 0 |
| CHECK por nombre, cláusula y estado | 14 | 0 |
| Columnas de claves PK, UNIQUE y FK por nombre/orden/referencia | 69 | 0 |
| FK por nombre, destino y reglas ON UPDATE/DELETE | 24 | 0 |
| Vistas / triggers / rutinas / eventos | 0 / 0 / 0 / 0 | 0 |
| `SHOW CREATE TABLE` de todas las tablas | 16 | 0 |

Para comparar `SHOW CREATE TABLE` se normalizó **solo** el siguiente
contador `AUTO_INCREMENT=N`, que puede cambiar tras inserciones y no
afecta al diseño; las propiedades de las columnas autoincrementales sí
se compararon. No se descartaron diferencias de nombres de constraints,
acciones de FK, CHECK, índices o columnas. La comparación entre servidores
de la misma versión MySQL evita divergencias inocuas de presentación entre
versiones. No se compararon variables globales ni privilegios SQL del
servidor, que no forman parte del SQL maestro.

Se cotejaron, por todas las columnas de semilla salvo marcas de tiempo de
creación/actualización, las filas de `tipos_documento`, `roles`, `cargos`,
`permisos`, `grados_retinopatia` y `tipos_informe` contra el resultado de
ejecutar el maestro temporalmente: **sin diferencias**. Los pares
`rol_codigo`–`permiso_codigo` se compararon exactamente, no solo por
cantidad: **33** pares, **21** permisos, **4** roles, grants
`ADMINISTRADOR_SISTEMA=7`, `OFTALMOLOGO=14`, `ENFERMERO=6`,
`ASISTENTE_ADMINISTRATIVO=6`. `informes.anular` solo pertenece al
oftalmólogo; `informes.inactivar` no tiene grants. `usuario_rol` tiene
3 filas en ambos, pero deliberadamente no se cotejaron cuentas o datos
personales con semillas. Los grants descritos son **relaciones de dominio
en `rol_permiso`**, no privilegios SQL del servidor.

## Informes, retinógrafo y backend

En ambas bases `informes.revision_actual` es `BIGINT UNSIGNED NOT NULL
DEFAULT 1` con CHECK positivo; `schema_version` y
`uq_informes_visita_tipo` son iguales. `informes_versiones` comparte
operaciones `CREACION`, `MIGRACION_INICIAL`, `CORRECCION`, `ANULACION` e
`INACTIVACION`, estados `ACTIVO`, `INACTIVO`, `ANULADO`, JSON, tiempo
`DATETIME(6)`, UNIQUE `(informe_id,numero_version)`, CHECK de número,
operación inicial, autor y motivo, y FK de informe/autor con
`ON DELETE/UPDATE RESTRICT`. El `ON DELETE CASCADE` de
`informes.visita_id` **también figura en el maestro**: con una versión
existente su FK restrictiva protege el historial, pero la base **no exige
por sí sola** que todo informe tenga una versión; un informe creado al
margen del backend podría quedar sin instantánea. Esto es un límite
compartido del diseño, no una diferencia nueva entre bases.

`confirmaciones_exportacion_retinografo` tiene el mismo token opaco
`BINARY(32)`, `sha256_fuente CHAR(64)`, `clave_copia CHAR(32)`,
`DATETIME(6)` para vigencia, estados, CHECK, UNIQUE, índices y reglas FK.
Además de la comparación completa, los validadores de **solo lectura**
`check_report_version_schema` y `check_confirmation_schema` pasaron sobre
el servidor habitual (después de revalidar identidad). No se invocaron
sus ensayos de integridad con DML ni se usaron imágenes reales.

Los modelos `backend/src/models/informe_entities.py` usan las claves,
tipos relevantes, JSON, revisión y relaciones esperadas. El POST en
`backend/routes/informe_routes.py` aplica `reports.create` y el permiso
condicional de crear visita. `crear_nuevo_informe` en
`backend/services/informe_service.py` llama a
`InformeRepository.crear_informe`, luego a `crear_version_inicial` y
finalmente hace **un único** `db.session.commit()`: se almacena la
instantánea `CREACION` n.º 1 con autor y datos persistidos, o se hace
rollback previo al commit. Un fallo del acuse de commit no prueba
ausencia de escritura: no reintentar automáticamente. Las políticas B1
exigen rol y permisos del mismo rol; PUT/anulación además exigen autoría.
Esto comprueba **compatibilidad estática del ORM**, no un POST funcional
en MySQL habitual.

`REPORTS_EDIT_ENABLED`, `REPORTS_ANNUL_ENABLED` y
`REPORTS_HISTORY_ENABLED` no aparecen configuradas en `backend/app.py`,
entorno o `.env` consultados; `strict_authorization_required` exige
`current_app.config.get(flag) is True` para cada una. Por tanto, la
**configuración disponible para el arranque estándar** las deja
desactivadas. No se importó `app.py`, ni se inició Flask, ni se verificó
la configuración interna de un proceso de despliegue ajeno: cualquier
modificación en memoria por otro lanzador debe comprobarse antes de
exponerlo. DELETE usa `disabled_authenticated_operation` y continúa
bloqueado. El frontend de informes solo hace POST y GET; el panel de
historial es de solo lectura y no hay llamadas PUT/DELETE/anulación en
`frontend/src/features/reports`.

## Datos actuales, archivos y decisión

Recuento actual por `SELECT`: **0 visitas**, **0 diagnósticos**, **0 detalles**,
**0 informes**, **0 versiones** y **0 confirmaciones**; no se detectaron
filas clínicas nuevas respecto a 29D.1. No hace falta backfill de
informes anteriores **en este punto de observación**. Si aparece
cualquier fila nueva, volver a conciliar el estado y respaldarlo antes
de una operación posterior que pudiera afectarla.

Archivos externos, no incluidos en el dump ni en la equivalencia SQL:
`backend/uploads/retinas` existe con **257** archivos (ruta usada también
por las lecturas; la escritura de diagnóstico depende del cwd);
`C:\DATA\data_clinica` existe con **14** exportaciones. No hay
`RETINOGRAPH_PRIVATE_DIR` en la configuración local disponible y
`app.py` no lo fija: **no está identificado un directorio privado de
confirmaciones**, lo que no demuestra que no exista en otro despliegue.
No se leyeron, movieron ni borraron archivos. El propietario debe
inventariar y custodiar de forma privada sus rutas externas y verificar
los vínculos autorizados antes de considerar huérfano cualquier archivo.

**Riesgos/limitaciones:** no se probó un POST contra MySQL habitual, no se
verificó la configuración efectiva de un backend externo ni datos clínicos
futuros; el respaldo 29D.1 representa su punto de corte y no archivos
externos. La estructura SQL no impone existencia de versión inicial para
escrituras fuera del backend. No se conocen cuentas/grants SQL globales a
partir de la comparación del esquema.

**Decisión:** evitar HeidiSQL y cualquier reconstrucción redundante; conservar
el respaldo restaurable de 29D.1. Proponer en un prompt posterior una
prueba funcional controlada del POST con datos **sintéticos**, en la base
habitual ya confirmada, solo tras autorización separada del propietario,
verificación previa de banderas y una nueva conciliación de identidad y
conteos. Si hay escrituras posteriores al respaldo, obtener un nuevo
punto de corte y respaldo antes de cualquier acción destructiva. No se
crearon registros de prueba ni se activó ninguna funcionalidad en 29D.2.
