-- PROPUESTA B1 (MySQL 8). NO ejecutada. Solo rol_permiso; no cambia usuarios.
-- Ejecutar UNICAMENTE despues de b1_catalogo_permisos_propuesta.sql,
-- en la base expresamente identificada y despues de guardar una copia de
-- pares (roles.codigo, permisos.codigo) de los cuatro roles afectados.
-- No usar este archivo como mecanismo de arranque ni sobre una BD desconocida.
-- Detalles de preflight, alcance y reversion:
-- backend/docs/autorizacion-b1-transicion-grants.md

-- Preflight de solo lectura: comprobar codigo/estado y UNIQUE del esquema v2
-- antes de considerar los DML. Se esperan cuatro roles activos y 13 permisos
-- activos (once clinicos heredados por Admin y dos lecturas nuevas).
SELECT `codigo`, `estado`
FROM `roles`
WHERE `codigo` IN (
  'ADMINISTRADOR_SISTEMA', 'OFTALMOLOGO', 'ENFERMERO',
  'ASISTENTE_ADMINISTRATIVO'
)
ORDER BY `codigo`;

SELECT `codigo`, `modulo`, `estado`
FROM `permisos`
WHERE `codigo` IN (
  'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
  'visitas.ver', 'visitas.crear',
  'diagnostico_retinopatia.crear', 'diagnostico_retinopatia.validar',
  'diagnostico_retinopatia.ver', 'imagenes.ver',
  'informes.ver', 'informes.crear', 'informes.editar', 'informes.anular'
)
ORDER BY `codigo`;

-- Guardar la salida de este SELECT en un respaldo controlado antes de aplicar.
-- Contiene solo codigos de catalogo y fecha del vinculo, no datos de usuarios.
SELECT r.`codigo` AS `rol_codigo`, p.`codigo` AS `permiso_codigo`,
       rp.`fecha_creado`
FROM `rol_permiso` AS rp
JOIN `roles` AS r ON r.`id` = rp.`rol_id`
JOIN `permisos` AS p ON p.`id` = rp.`permiso_id`
WHERE r.`codigo` IN ('ADMINISTRADOR_SISTEMA', 'OFTALMOLOGO',
                     'ENFERMERO', 'ASISTENTE_ADMINISTRATIVO')
ORDER BY r.`codigo`, p.`codigo`;

-- Guardas de sesion para impedir modificaciones parciales cuando falte un
-- rol/permiso esperado. Si precondiciones_ok <> 1: DETENERSE y no aplicar.
SET @b1_grants_ready = 0;
SET @b1_grants_ready = IF(
  (SELECT COUNT(*) FROM `roles`
   WHERE `estado` = 'ACTIVO' AND `codigo` IN (
     'ADMINISTRADOR_SISTEMA', 'OFTALMOLOGO', 'ENFERMERO',
     'ASISTENTE_ADMINISTRATIVO'
   )) = 4
  AND
  (SELECT COUNT(*) FROM `permisos`
   WHERE `estado` = 'ACTIVO' AND `codigo` IN (
     'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
     'visitas.ver', 'visitas.crear',
     'diagnostico_retinopatia.crear', 'diagnostico_retinopatia.validar',
     'diagnostico_retinopatia.ver', 'imagenes.ver',
     'informes.ver', 'informes.crear', 'informes.editar', 'informes.anular'
   )) = 13,
  1, 0
);
SELECT @b1_grants_ready AS `precondiciones_ok`;

-- MySQL 8 exige CHECK: si falta una precondicion se genera un error SQL real.
-- La tabla es TEMPORAL y desaparece al cerrar la conexion; no cambia v2.
-- No ejecutar con --force: detenerse al primer error y no entrar al DML.
CREATE TEMPORARY TABLE IF NOT EXISTS `_b1_grants_guard` (
  `ready` TINYINT NOT NULL,
  CONSTRAINT `ck_b1_grants_ready` CHECK (`ready` = 1)
) ENGINE=MEMORY;
DELETE FROM `_b1_grants_guard`;
INSERT INTO `_b1_grants_guard` (`ready`) VALUES (@b1_grants_ready);

-- Aplicar solo tras confirmar manualmente precondiciones_ok = 1 y revisar
-- los pares respaldados. Cada DML tambien esta condicionada a esa guarda.
START TRANSACTION;

-- Administrador: retirar solo herencia clinica. Conservar dashboard.ver,
-- configuracion.ver, usuarios.ver/crear/editar/asignar_roles (codigos
-- concretos) y catalogos.gestionar.
-- Si la cuenta tambien es OFTALMOLOGO, conserva grants de su rol medico.
DELETE rp FROM `rol_permiso` AS rp
JOIN `roles` AS r ON r.`id` = rp.`rol_id`
JOIN `permisos` AS p ON p.`id` = rp.`permiso_id`
WHERE @b1_grants_ready = 1
  AND r.`codigo` = 'ADMINISTRADOR_SISTEMA'
  AND p.`codigo` IN (
    'pacientes.ver', 'pacientes.crear', 'pacientes.editar',
    'visitas.ver', 'visitas.crear',
    'diagnostico_retinopatia.crear', 'diagnostico_retinopatia.validar',
    'informes.ver', 'informes.crear', 'informes.editar', 'informes.anular'
  );

-- Asistente: no crear informes clinicos por cuenta propia.
DELETE rp FROM `rol_permiso` AS rp
JOIN `roles` AS r ON r.`id` = rp.`rol_id`
JOIN `permisos` AS p ON p.`id` = rp.`permiso_id`
WHERE @b1_grants_ready = 1
  AND r.`codigo` = 'ASISTENTE_ADMINISTRATIVO'
  AND p.`codigo` = 'informes.crear';

-- Oftalmologo: exclusivamente lectura IA e imagenes de catalogo B1.
-- No conceder informes.inactivar a ningun rol ni agregar rol Gerente.
INSERT INTO `rol_permiso` (`rol_id`, `permiso_id`)
SELECT r.`id`, p.`id`
FROM `roles` AS r
JOIN `permisos` AS p ON p.`codigo` IN (
  'diagnostico_retinopatia.ver', 'imagenes.ver'
)
WHERE @b1_grants_ready = 1
  AND r.`codigo` = 'OFTALMOLOGO'
  AND r.`estado` = 'ACTIVO'
  AND p.`estado` = 'ACTIVO'
  AND NOT EXISTS (
    SELECT 1 FROM `rol_permiso` AS existing
    WHERE existing.`rol_id` = r.`id` AND existing.`permiso_id` = p.`id`
  );

COMMIT;

-- Verificacion de solo lectura: comparar con el respaldo previo; Enfermero
-- permanece intacto. Solo (OFTALMOLOGO, las dos lecturas) puede agregarse.
SELECT r.`codigo` AS `rol_codigo`, p.`codigo` AS `permiso_codigo`
FROM `rol_permiso` AS rp
JOIN `roles` AS r ON r.`id` = rp.`rol_id`
JOIN `permisos` AS p ON p.`id` = rp.`permiso_id`
WHERE r.`codigo` IN ('ADMINISTRADOR_SISTEMA', 'OFTALMOLOGO',
                     'ENFERMERO', 'ASISTENTE_ADMINISTRATIVO')
ORDER BY r.`codigo`, p.`codigo`;

SELECT p.`codigo`, COUNT(rp.`rol_id`) AS `roles_asignados`
FROM `permisos` AS p
LEFT JOIN `rol_permiso` AS rp ON rp.`permiso_id` = p.`id`
WHERE p.`codigo` IN ('diagnostico_retinopatia.ver', 'imagenes.ver',
                     'informes.inactivar')
GROUP BY p.`codigo`;

-- NO ejecutar reversión ciega: restaurar exclusivamente los pares retirados
-- que consten en el respaldo; quitar los dos grants de lectura Oftalmologo
-- solo si fueron agregados aqui y siguen sin depender de otras decisiones.
