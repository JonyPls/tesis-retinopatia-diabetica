-- PROPUESTA B1 (MySQL 8): NO ejecutada ni integrada en el arranque.
-- Referencia: backend/db/centro-oftalmologico-db-v2.sql (excluido de Git).
-- Este archivo solo incorpora tres codigos aprobados en el catalogo permisos.
-- No modifica rol_permiso, usuario_rol, usuarios ni recursos clinicos.
--
-- Antes de una ejecucion futura, con autorizacion expresa:
-- 1. Confirmar que la instancia corresponde a v2 y que permisos.codigo es UNIQUE.
-- 2. Revisar los tres codigos: si alguno ya existe, comprobar modulo/estado;
--    no activar automaticamente un permiso INACTIVO ni sobrescribir metadatos.
-- 3. Registrar cuales codigos NO existian, para una posible reversion selectiva.
-- 4. Ejecutar una sola vez por instancia con un procedimiento controlado.
--    Las inserciones son repetibles en ejecucion secuencial; el UNIQUE sigue
--    protegiendo de duplicados si hubiera una ejecucion concurrente.

START TRANSACTION;

INSERT INTO `permisos` (`codigo`, `nombre`, `descripcion`, `modulo`)
SELECT 'diagnostico_retinopatia.ver', 'Ver diagnostico IA',
       'Permite consultar resultados y detalles de retinopatia diabetica.',
       'diagnostico_retinopatia'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permisos` WHERE `codigo` = 'diagnostico_retinopatia.ver'
);

INSERT INTO `permisos` (`codigo`, `nombre`, `descripcion`, `modulo`)
SELECT 'imagenes.ver', 'Ver imagenes clinicas',
       'Permite consultar retinografias y sus imagenes asociadas.', 'imagenes'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permisos` WHERE `codigo` = 'imagenes.ver'
);

INSERT INTO `permisos` (`codigo`, `nombre`, `descripcion`, `modulo`)
SELECT 'informes.inactivar', 'Inactivar informe',
       'Permite la baja logica INACTIVO; no equivale a anular un informe.',
       'informes'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permisos` WHERE `codigo` = 'informes.inactivar'
);

COMMIT;

-- Verificaciones de solo lectura para la ejecucion futura: los tres codigos
-- deben existir y conservar sus modulos/estado aprobados. No se crean grants.
SELECT `codigo`, `modulo`, `estado`
FROM `permisos`
WHERE `codigo` IN (
  'diagnostico_retinopatia.ver', 'imagenes.ver', 'informes.inactivar'
)
ORDER BY `codigo`;

SELECT p.`codigo`, COUNT(rp.`rol_id`) AS `asignaciones_por_rol`
FROM `permisos` AS p
LEFT JOIN `rol_permiso` AS rp ON rp.`permiso_id` = p.`id`
WHERE p.`codigo` IN (
  'diagnostico_retinopatia.ver', 'imagenes.ver', 'informes.inactivar'
)
GROUP BY p.`codigo`;

-- Reversion: no hacer DELETE indiscriminado por codigo. Solo despues de
-- constatar cuales filas creo esta propuesta y que siguen sin referencias en
-- rol_permiso u otras relaciones, retirar esas filas por sus IDs registrados
-- mediante una operacion auditada. Si ya hay grants, conservar y planificar
-- una reversion separada; nunca borrar concesiones o datos de usuarios aqui.
