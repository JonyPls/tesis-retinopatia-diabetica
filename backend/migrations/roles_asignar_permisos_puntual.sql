-- NO ejecutar sobre MySQL habitual sin aprobación expresa del propietario.
-- Precondiciones externas: confirmar servidor/esquema, respaldo actualizado,
-- catálogo esperado y rol ADMINISTRADOR_SISTEMA ACTIVO. No ejecutar el maestro.
-- Idempotente: inserta como máximo un permiso y un vínculo; no altera grants clínicos.
START TRANSACTION;

INSERT INTO permisos (codigo, nombre, descripcion, modulo, estado)
SELECT 'roles.asignar_permisos', 'Asignar permisos a roles',
       'Permite otorgar y retirar permisos de roles desde configuracion.',
       'configuracion', 'ACTIVO'
WHERE EXISTS (
    SELECT 1 FROM roles WHERE codigo = 'ADMINISTRADOR_SISTEMA' AND estado = 'ACTIVO'
) AND NOT EXISTS (
    SELECT 1 FROM permisos WHERE codigo = 'roles.asignar_permisos'
);

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permisos AS p ON p.codigo = 'roles.asignar_permisos'
WHERE r.codigo = 'ADMINISTRADOR_SISTEMA' AND r.estado = 'ACTIVO'
  AND p.nombre = 'Asignar permisos a roles'
  AND p.descripcion = 'Permite otorgar y retirar permisos de roles desde configuracion.'
  AND p.modulo = 'configuracion' AND p.estado = 'ACTIVO'
  AND NOT EXISTS (
      SELECT 1 FROM rol_permiso AS rp
      WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
  );

COMMIT;
