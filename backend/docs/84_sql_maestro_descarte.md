# 84 — SQL maestro y recuperación del descarte IA

## Archivo actualizado

El inicializador de v2 es **`backend/db/centro-oftalmologico-db-v2.sql`**. Su
`CREATE DATABASE`/`USE` apuntan a `centro_oftalmologico_db_v2`; el archivo antiguo
`centro-oftalmologico-db.sql` no se modificó. Ambos son archivos locales excluidos
de Git: conservar una copia privada del maestro actualizado para reconstrucciones.
No se cambió `.gitignore` ni se publicó la semilla privada.

El maestro ahora incorpora:

- Las dos tablas técnicas de 72, con PK, índices, JSON, CHECK, UUID ASCII/binario,
  `DATETIME(6)`, InnoDB y FK RESTRICT. Los tipos de sus FK coinciden con
  `visitas_clinicas.id BIGINT UNSIGNED` y `usuarios.id INT UNSIGNED`.
- La FK detalle → diagnóstico con nombre final
  `fk_detalle_retinopatia_diagnostico_restrict`, DELETE RESTRICT / UPDATE CASCADE,
  equivalente al ajuste de 79.
- El permiso activo `diagnostico_retinopatia.descartar_pendiente` y su grant
  exclusivo al rol activo `OFTALMOLOGO`, resueltos por **código**, sin IDs nuevos
  prefijados y con `NOT EXISTS` para evitar duplicados. No se reactiva un permiso
  inactivo preexistente ni se concede a otros roles.
- DROP de las dos tablas técnicas antes de sus padres, únicamente dentro de la
  sección de reconstrucción que ya tenía el maestro. Se crean después de usuarios
  y visitas; el permiso y el grant se agregan después de sus catálogos.

Se conservaron todas las demás tablas, relaciones y sentencias de semilla
originales, incluidos sus IDs aprobados. No se refactorizó la semilla existente.
La regla B1 sigue exigiendo procedencia OFTALMOLOGO y los permisos de lectura de
pacientes, visitas, IA e imágenes además del permiso nuevo; los grants existentes
del rol ya cubren esas lecturas. No se alteró el motor B1 ni el ORM clínico: la FK
de `DiagnosticoDetalle` apunta al mismo padre, y su relación ORM no cambia. Las
tablas técnicas coinciden con `diagnosis_discard_entities.py`.

**No ejecutar el maestro sobre la base actual:** conserva sus `DROP TABLE` de
reconstrucción. No se ejecutó ningún SQL contra MySQL durante este prompt.
Tras una futura reconstrucción con este maestro no se deben reaplicar 72/79:
esas estructuras ya estarán integradas.

## Recuperar «Corregir fotografías» SIN reconstruir

**Pendiente de autorización adicional y respaldo vigente.** No es necesario
reconstruir la base ni modificar pacientes/diagnósticos. El estado leído en 83
tenía ambas tablas ausentes, FK CASCADE con el nombre original y permiso ausente.
Reconfirmarlo antes de aplicar: si existe una instalación parcial, cambió el
nombre/acción de la FK o el permiso está INACTIVO, detenerse y revisar; no ejecutar
una migración a ciegas ni sobrescribir una instalación incompatible.

Consultas previas de solo lectura, seleccionando explícitamente v2:

```sql
USE centro_oftalmologico_db_v2;
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
  ('diagnostico_ia_revision_visita', 'diagnostico_ia_descarte_operaciones');

SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'diagnosticos_retinopatia_detalle'
  AND REFERENCED_TABLE_NAME = 'diagnosticos_retinopatia';

SELECT codigo, estado FROM permisos
WHERE codigo = 'diagnostico_retinopatia.descartar_pendiente';
SELECT codigo, estado FROM roles WHERE codigo = 'OFTALMOLOGO';
```

Solo después de autorizar y confirmar ese estado, en el cliente **mysql** abierto
desde la raíz del repositorio, sin `--force` y deteniéndose ante cualquier error:

```sql
USE centro_oftalmologico_db_v2;
-- ALTER atómico: sustituye solo la FK; conserva filas y ON UPDATE CASCADE.
SOURCE backend/migrations/79_descarte_fk_desarrollo.sql;
-- Solo los dos CREATE TABLE técnicos; sin datos clínicos ni borrados.
SOURCE backend/migrations/72_descarte_ia_propuesta.sql;

START TRANSACTION;
INSERT INTO `permisos` (`codigo`, `nombre`, `descripcion`, `modulo`, `estado`)
SELECT 'diagnostico_retinopatia.descartar_pendiente',
       'Descartar resultados IA pendientes',
       'Permite corregir fotografias con resultados IA pendientes en la misma visita.',
       'diagnostico_retinopatia', 'ACTIVO'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permisos`
  WHERE `codigo` = 'diagnostico_retinopatia.descartar_pendiente'
);

INSERT INTO `rol_permiso` (`rol_id`, `permiso_id`)
SELECT r.`id`, p.`id`
FROM `roles` AS r
JOIN `permisos` AS p ON p.`codigo` = 'diagnostico_retinopatia.descartar_pendiente'
WHERE r.`codigo` = 'OFTALMOLOGO' AND r.`estado` = 'ACTIVO' AND p.`estado` = 'ACTIVO'
  AND NOT EXISTS (
    SELECT 1 FROM `rol_permiso` AS existing
    WHERE existing.`rol_id` = r.`id` AND existing.`permiso_id` = p.`id`
  );
COMMIT;
```

El DDL tiene commit implícito en MySQL: no se revierte mediante ROLLBACK. No
desactivar `FOREIGN_KEY_CHECKS`. El grant alcanza a los miembros actuales y futuros
del rol, no a un ID personal. No se crean usuarios ni se cambian sus roles.

Después, verificar las tablas con `SHOW CREATE TABLE`, repetir la consulta de FK
(ahora RESTRICT/CASCADE) y comprobar el grant por código:

```sql
SELECT r.codigo AS rol, p.codigo AS permiso, p.estado
FROM rol_permiso rp
JOIN roles r ON r.id = rp.rol_id
JOIN permisos p ON p.id = rp.permiso_id
WHERE p.codigo = 'diagnostico_retinopatia.descartar_pendiente';
```

Debe existir solo el grant a OFTALMOLOGO. Reiniciar manualmente la API existente
con su mismo venv y `python run_local.py`, sin duplicarla, para que el chequeo de
83 vuelva a evaluar la instalación. También necesita un oftalmólogo activo con el
grant efectivo. Refrescar el frontend e iniciar sesión nuevamente. La activación
local del frontend de 80 se conserva; no se cambian flags de producción.

Las tablas nuevas empiezan vacías: no restauran operaciones/UUID eliminados al
reconstruir ni acreditan marcadores de la base anterior. No se deben fabricar
marcadores ni borrar bloqueos para forzar una corrección.

## Verificación sin ejecutar el inicializador

- Comparación local de sentencias contra una copia previa privada: solo se agregan
  dos DROP técnicos, dos CREATE técnicos y dos INSERT dinámicos; la única sentencia
  anterior modificada es la FK de detalle. Todas las demás semillas y estructuras
  permanecen iguales.
- Las dos tablas se contrastaron con el DDL de 72; se verificaron el orden de todas
  las referencias FK, los tipos padre/hijo, UNIQUE/PK de permisos y grants, y la
  resolución por código del grant nuevo.
- Se reutilizaron las dos pruebas focalizadas existentes de metadatos MySQL
  compilados y procedencia B1, sin crear un arnés. No conectan a MySQL ni cargan
  modelos IA. `git diff --check` sin errores.

La reconstrucción completa **no se ejecutó**: la revisión es estática, más esas
pruebas existentes. No se modificaron frontend, lógica clínica, inferencia,
permisos reales, datos clínicos ni servidores. Sin commits/push.
