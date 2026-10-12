# Maestro SQL B1 y transición histórica

`backend/db/centro-oftalmologico-db-v2.sql` está excluido de Git y desde Prompt
21 incluye **directamente** los 21 códigos de permisos y los grants aprobados:
Administrador 7 administrativos, Oftalmólogo 13, Enfermero 6 y Asistente 6.
`informes.inactivar` existe en catálogo, sin concesiones. No hay permisos
comodín, rol Gerente ni concesiones individuales.

La instalación **nueva** requiere únicamente ejecutar el maestro completo en
MySQL 8 desde HeidiSQL, cuando el propietario decida reconstruir su BD. El
script crea/selecciona `centro_oftalmologico_db_v2`, desactiva temporalmente FK
y hace `DROP TABLE IF EXISTS` de las 14 tablas: **elimina** registros manuales
que no estén en sus INSERT. Respaldar previamente la BD habitual si hay datos
que conservar, confirmar servidor/esquema de destino, ejecutar el archivo
completo y verificar los cuatro roles, 21 permisos y grants 7/13/6/6. No se
deben ejecutar las dos migraciones incrementales después.

`backend/migrations/b1_catalogo_permisos_propuesta.sql` y
`backend/migrations/b1_grants_roles_propuesta.sql` permanecen como evidencia de
la **transición histórica** de 18 → 21 permisos y 18/11/6/7 → 7/13/6/6 grants.
En un ensayo desechable, aplicarlas al maestro B1 ya actualizado fue inocuo:
no alteraron catálogo, grants ni semilla. Eso **no** autoriza su ejecución
sobre la BD habitual o sobre instancias de procedencia desconocida. El arnés
acepta `--historical-seed` solo con un respaldo pre-B1 externo a Git en el
directorio temporal aprobado; el modo predeterminado comprueba directamente
la semilla B1 actual y su reconstrucción repetida en MySQL desechable, **sin
ejecutar migraciones incrementales**. El ensayo de su idempotencia en una
instalación B1 es optativo (`--check-historical-idempotence`) y separado.

Los grants habilitan las operaciones estrictas ya activadas, incluida
`diagnostico_retinopatia.ver` para que Oftalmólogo pueda leer
`maxima_gravedad` cuando la BD habitual sea reconstruida. `imagenes.ver` queda
disponible para futuras lecturas autorizadas. Tener un permiso en la BD **no
convierte** rutas heredadas que usan `clinical_access_required` en rutas B1:
los dos endpoints de historial compuesto de pacientes ya se protegieron en
Prompt 22; los endpoints independientes de diagnóstico, informes, PDF e
imágenes siguen pendientes de revisión individual.

El maestro incluye usuarios de desarrollo, hashes y pacientes semilla. Nunca
registrar ni publicar su contenido o respaldos. La copia privada pre-B1 de
este bloque se guardó fuera del repositorio y se comprobó con SHA-256; Git no
protege `backend/db/` ni ese respaldo.
