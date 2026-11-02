-- PROPUESTA NO EJECUTADA. MySQL 8 / InnoDB. NO usar sobre habitual sin autorización.
-- Seleccionar explícitamente un esquema aislado antes de ensayar este archivo.
-- Prerrequisitos: verificar DDL real, backups, tipos/signo de visitas_clinicas.id
-- y usuarios.id, FK entrantes, triggers, y ausencia de estas dos tablas.
-- Los tipos abajo son una propuesta: deben coincidir EXACTAMENTE con el DDL
-- autorizado. No usar IF NOT EXISTS para ocultar instalaciones incompatibles.
-- No modifica tablas clínicas, ni inserta permisos/grants, ni activa la función.

CREATE TABLE diagnostico_ia_revision_visita (
    visita_id BIGINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (visita_id),
    CONSTRAINT fk_ia_revision_visita FOREIGN KEY (visita_id)
        REFERENCES visitas_clinicas(id) ON DELETE RESTRICT,
    CONSTRAINT ck_ia_revision_no_negativa CHECK (revision >= 0)
) ENGINE=InnoDB;

CREATE TABLE diagnostico_ia_descarte_operaciones (
    operacion_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    visita_id BIGINT UNSIGNED NOT NULL,
    autor_id INT UNSIGNED NOT NULL,
    solicitud JSON NOT NULL,
    resultado JSON NOT NULL,
    archivos JSON NOT NULL,
    estado_limpieza VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    fecha_utc DATETIME(6) NOT NULL,
    PRIMARY KEY (operacion_id),
    INDEX ix_diagnostico_ia_descarte_operaciones_visita_id (visita_id),
    INDEX ix_diagnostico_ia_descarte_operaciones_estado_limpieza (estado_limpieza),
    CONSTRAINT fk_ia_descarte_visita FOREIGN KEY (visita_id)
        REFERENCES visitas_clinicas(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ia_descarte_autor FOREIGN KEY (autor_id)
        REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT ck_ia_descarte_limpieza CHECK (estado_limpieza IN ('PENDIENTE','COMPLETADA','CONFLICTO'))
) ENGINE=InnoDB;
