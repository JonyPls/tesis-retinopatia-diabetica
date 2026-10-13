-- 29D.5F.1: solo para esquema v2 previamente identificado y respaldado.
-- Ensayado en copia aislada. No ejecutar en habitual sin autorizacion expresa.
-- No es idempotente: las 11 columnas deben estar ausentes antes de comenzar.
-- No ejecutar el maestro (contiene DROP TABLE) ni cambiar fechas historicas.

ALTER TABLE `centro_oftalmologico_db_v2`.`visitas_clinicas`
  ADD COLUMN `fecha_visita_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_visita`,
  ADD COLUMN `fecha_creado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_creado`,
  ADD COLUMN `fecha_actualizado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_actualizado`,
  ADD CONSTRAINT `ck_visitas_fecha_visita_origen` CHECK (`fecha_visita_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_visitas_fecha_creado_origen` CHECK (`fecha_creado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_visitas_fecha_actualizado_origen` CHECK (`fecha_actualizado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO'));

ALTER TABLE `centro_oftalmologico_db_v2`.`diagnosticos_retinopatia`
  ADD COLUMN `fecha_creado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_creado`,
  ADD COLUMN `fecha_actualizado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_actualizado`,
  ADD CONSTRAINT `ck_diagnosticos_fecha_creado_origen` CHECK (`fecha_creado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_diagnosticos_fecha_actualizado_origen` CHECK (`fecha_actualizado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO'));

ALTER TABLE `centro_oftalmologico_db_v2`.`diagnosticos_retinopatia_detalle`
  ADD COLUMN `fecha_validacion_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_validacion`,
  ADD COLUMN `fecha_creado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_creado`,
  ADD COLUMN `fecha_actualizado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_actualizado`,
  ADD CONSTRAINT `ck_detalle_fecha_validacion_origen` CHECK (`fecha_validacion_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_detalle_fecha_creado_origen` CHECK (`fecha_creado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_detalle_fecha_actualizado_origen` CHECK (`fecha_actualizado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO'));

ALTER TABLE `centro_oftalmologico_db_v2`.`informes`
  ADD COLUMN `fecha_creado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_creado`,
  ADD COLUMN `fecha_actualizado_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_actualizado`,
  ADD CONSTRAINT `ck_informes_fecha_creado_origen` CHECK (`fecha_creado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO')),
  ADD CONSTRAINT `ck_informes_fecha_actualizado_origen` CHECK (`fecha_actualizado_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO'));

ALTER TABLE `centro_oftalmologico_db_v2`.`informes_versiones`
  ADD COLUMN `fecha_operacion_origen` VARCHAR(16) NOT NULL DEFAULT 'NO_VERIFICADO' AFTER `fecha_operacion`,
  ADD CONSTRAINT `ck_versiones_fecha_operacion_origen` CHECK (`fecha_operacion_origen` IN ('NO_VERIFICADO','UTC_VERIFICADO'));
