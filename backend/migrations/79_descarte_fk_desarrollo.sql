-- Ajuste autorizado expresamente en Prompt 79, SOLO para desarrollo CODN.
-- Aplicado tras respaldo verificado de centro_oftalmologico_db_v2.
-- No ejecutar otra vez: la FK original ya fue sustituida.
-- No borra filas ni cambia columnas, PK, indices o ON UPDATE.
-- Nombre nuevo para sustituir la FK atomicamente sin error MySQL 1826.
-- Despues se aplico 72_descarte_ia_propuesta.sql (solo sus dos CREATE TABLE).

ALTER TABLE diagnosticos_retinopatia_detalle
    DROP FOREIGN KEY fk_detalle_retinopatia_diagnostico,
    ADD CONSTRAINT fk_detalle_retinopatia_diagnostico_restrict
        FOREIGN KEY (diagnostico_retinopatia_id)
        REFERENCES diagnosticos_retinopatia(id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
