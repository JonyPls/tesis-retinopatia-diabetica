-- PENDIENTE DE AUTORIZACIÓN. NO ejecutar en MySQL habitual.
-- Solo después de respaldo, revisión del esquema y confirmación de 0 grupos
-- duplicados bajo la misma expresión; no modificar correos históricos.
-- SELECT COUNT(*) FROM (
--   SELECT NULLIF(LOWER(TRIM(correo)), '') AS correo_normalizado
--   FROM pacientes GROUP BY correo_normalizado
--   HAVING correo_normalizado IS NOT NULL AND COUNT(*) > 1
-- ) AS grupos_duplicados;
-- En MySQL 8, NULLIF permite múltiples NULL y correos vacíos opcionales.
ALTER TABLE pacientes
  ADD UNIQUE KEY uq_pacientes_correo_normalizado ((NULLIF(LOWER(TRIM(correo)), '')));
