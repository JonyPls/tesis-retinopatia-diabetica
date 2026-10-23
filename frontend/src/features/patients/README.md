# Pendiente: atención de pacientes menores de edad

El registro actual admite fechas de nacimiento de menores, pero solo registra
la declaración de que el consentimiento informado físico está archivado. No
gestiona representantes legales ni verifica documentos o facultades de
representación. Antes de usar este flujo como soporte completo para menores se
requieren una definición funcional, revisión normativa y una implementación
específica. No se presume cumplimiento legal con el estado actual.

La fecha de nacimiento de hoy es válida y puede corresponder a un recién
nacido (edad 0). Bloquearla por decisión académica sería una regla funcional
nueva que requiere aprobación; no es una exigencia legal aquí.

## Unicidad pendiente en la base habitual

El documento ya tiene un índice único por `(tipo_doc_id, nro_documento)`.
Para el correo opcional se comprueba `LOWER(TRIM(correo))` antes del alta;
la base habitual todavía no tiene índice único de correo, así que dos altas
concurrentes podrían superar la comprobación del servicio. La migración
`backend/migrations/pacientes_correo_unico_pendiente.sql` fue preparada y
ensayada solo en MySQL desechable. **No aplicarla** a la base habitual sin
revisión de duplicados/respaldos y autorización específica. El teléfono
puede compartirse entre pacientes y no debe tener índice único.
