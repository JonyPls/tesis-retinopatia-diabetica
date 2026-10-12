# B1: transición propuesta de grants (no ejecutada)

> **Histórico (semilla original de 18 permisos):** desde Prompt 21 el maestro
> `backend/db/centro-oftalmologico-db-v2.sql` ya incluye directamente los 21
> permisos y grants B1. Estas propuestas incrementales documentan la transición
> desde la versión anterior; **no son necesarias en instalaciones nuevas**.
> No ejecutar este procedimiento sobre una base existente sin inventariarla y
> autorizar por separado sus cambios. Ver `autorizacion-b1-maestro.md`.

**No cambia la política en este repositorio.** Fuente: catálogo y grants
sembrados en `backend/db/centro-oftalmologico-db-v2.sql`. La instancia MySQL
puede haber cambiado: jamás ejecutar sobre ella sin inventario autorizado.
La transición usa `roles.codigo` y `permisos.codigo`, no IDs de semilla.

## Diferencias propuestas respecto a los grants de la semilla v2

| Rol | Retirar | Añadir | Mantener / restricción |
| --- | --- | --- | --- |
| `ADMINISTRADOR_SISTEMA` | `pacientes.ver`, `pacientes.crear`, `pacientes.editar`, `visitas.ver`, `visitas.crear`, `diagnostico_retinopatia.crear`, `diagnostico_retinopatia.validar`, `informes.ver`, `informes.crear`, `informes.editar`, `informes.anular` | Ninguno | Mantener `dashboard.ver`, `configuracion.ver`, `usuarios.ver`, `usuarios.crear`, `usuarios.editar`, `usuarios.asignar_roles`, `catalogos.gestionar`. Su jerarquia no sustituye una habilitacion medica. |
| `OFTALMOLOGO` | Ninguno | `diagnostico_retinopatia.ver`, `imagenes.ver` **tras migracion de catalogo** | Mantener creacion y validacion medicas como permisos distintos. No agregar `informes.inactivar` automaticamente. |
| `ENFERMERO` | Ninguno | Ninguno | Mantener solo tareas de apoyo previamente aprobadas; nunca validacion medica. |
| `ASISTENTE_ADMINISTRATIVO` | `informes.crear` | Ninguno | Mantener administracion de pacientes del seed; `pacientes.editar` no autoriza editar campos clinicos hasta contar con API/filtrado apropiado. |
| Gerente | Ninguno | Ninguno | No esta sembrado como rol en v2: no crearlo ni delegar privilegios en este script. |

Si los grants de MySQL no coinciden con la semilla, calcular el diff **real** y
detener la aplicacion hasta revisarlo. Desde v2, los totales serian Admin 7,
Oftalmologo 13, Enfermero 6, Asistente 6. Son resultados esperados del **seed**,
no afirmaciones sobre la instancia actual. Una cuenta Admin+Oftalmologo conserva
las facultades clinicas heredadas del rol medico; en la siguiente fase sera
necesario comprobar la procedencia del permiso antes de validar IA.

### Condiciones de aplicacion y rollback

1. Identificar de forma inequivoca la instancia desechable o autorizada. Antes
   de cambios, verificar tablas/FK/UNIQUE de v2 y el estado de los cuatro roles
   y trece permisos involucrados, incluidos los dos nuevos de lectura. Los
   permisos nuevos requieren primero la migracion de catalogo B1.
2. Conservar un respaldo **solo de codigos y vinculos**: resultado del SELECT
   previo en `backend/migrations/b1_grants_roles_propuesta.sql`, mas version
   del catalogo y aprobacion. No extraer cuentas, contrasenas ni pacientes.
3. Confirmar `precondiciones_ok = 1` **antes** de aplicar. Si no vale 1, no
   continuar. Las sentencias de modificacion estan tambien condicionadas a
   esa guarda; nunca corregirla manualmente para eludir precondiciones.
4. Verificar los pares de grants despues de la transaccion; otros roles y los
   grants de Enfermero deben permanecer intactos. Repetir solo en entorno
   desechable para verificar que no aparezcan duplicados.
5. Reversion selectiva, no un `DELETE` general: restaurar unicamente pares
   previamente existentes del respaldo que fueron retirados y retirar las
   nuevas parejas del Oftalmologo solo si fueron creadas en esta aplicacion y
   no hubo asignaciones/decisiones posteriores. Revisar responsable, cambios
   intermedios y efectos de seguridad antes de revertir; no restaurar un
   bypass clinico en produccion como solucion de compatibilidad.

La propuesta de catalogo y la de grants se ejecutarian separadamente, con
aprobaciones distintas. Ninguna de las dos cambia los decoradores actuales.
Por eso **retirar grants del Admin NO elimina aun el bypass por rol** de
`user_is_authorized`. El Asistente si puede perder el acceso actual a POST
informes al retirar `informes.crear`; la regla funcional ahora lo exige.
Antes del corte estricto, adaptar el dashboard de Admin: hoy carga pacientes;
preparar autorizaciones y UX para evitar peticiones 403 no previstas.

### Aplicables antes del cambio de endpoints / dependencias posteriores

- Retirar grants clinicos de Admin y `informes.crear` del Asistente refleja la
  nueva separacion aprobada, una vez constatados los grants reales y revisados
  flujos actuales. No es seguro asumir que el bypass ya quedo corregido.
- Agregar las dos lecturas a Oftalmologo es **preparacion**; requiere catalogo
  nuevo. No produce autorizacion granular hasta cambiar decoradores y servir
  respuestas compuestas segun permisos.
- `informes.inactivar` permanece sin grants hasta definir autor, auditoria,
  motivo y limites de baja logica. `informes.anular` es otro permiso/estado.
- Crear visita indirectamente al POST informes puede exigir `visitas.crear`:
  definir primero el contrato y las pruebas. La edicion administrativa de
  pacientes necesita restringir campos clinicos a nivel de API, no solo grants.
- La autorizacion individual `usuario_permiso` y el rol Gerente se abordaran
  en entregas separadas, con jerarquia, auditoria y prohibicion de autoelevacion.

## Ensayo histórico en instancia MySQL 8 desechable

El procedimiento siguiente se escribió para el v2 **original**; no apunta al
maestro B1 actualizado. El arnés `b1_mysql_disposable_trial.py` conserva el
ensayo histórico solo si se le entrega expresamente `--historical-seed` con un
respaldo verificable pre-B1 fuera de Git. No usar el maestro actual como seed de
18 permisos. Los resultados del ensayo automatizado posterior constan en
`autorizacion-b1-maestro.md`; las notas anteriores sobre falta de ensayo se
conservan debajo como evidencia del momento en que se redactaron.

No hay configuracion de contenedor ni una BD de pruebas explicitamente
separada e identificada en el repositorio. **No se creo ni uso ninguna.**
Para un ensayo futuro autorizado:

Ejemplo de preparacion en PowerShell **para ejecutar solo en esa futura
autorizacion**, si Docker y la imagen MySQL 8 estan disponibles. La variable
`MYSQL_ROOT_PASSWORD` debe contener una clave sintetica exclusiva del ensayo,
configurada de forma privada en la terminal; no procede de `backend/.env`:

```powershell
docker run --detach --rm --name b1-mysql-efimero --publish 127.0.0.1:33317:3306 --env MYSQL_ROOT_PASSWORD mysql:8.0
docker cp "backend/db/centro-oftalmologico-db-v2.sql" b1-mysql-efimero:/tmp/v2.sql
docker cp "backend/migrations/b1_catalogo_permisos_propuesta.sql" b1-mysql-efimero:/tmp/catalogo.sql
docker cp "backend/migrations/b1_grants_roles_propuesta.sql" b1-mysql-efimero:/tmp/grants.sql
docker exec -it b1-mysql-efimero mysql --user=root -p
```

En el cliente MySQL del contenedor, **antes** de cargar v2, identificar el
servidor mediante `SELECT @@version, @@server_uuid;` y verificar ausencia de
la BD mediante `SHOW DATABASES LIKE 'centro_oftalmologico_db_v2';`. Detenerse
si no es la instancia efimera nueva o si ya existe esa BD. En esa instancia
vacia exclusivamente, `source /tmp/v2.sql;`; comprobar roles/grants del seed.
Tras autorizacion del preflight, `source /tmp/catalogo.sql;`. Ejecutar los
SELECT de verificacion y preflight de `/tmp/grants.sql` **antes de cargarlo
completo**, conservar el respaldo de pares y confirmar `precondiciones_ok=1`.
Solo entonces `source /tmp/grants.sql;` en la misma instancia; revisar SELECT
finales. Al terminar el ensayo, salir del cliente y detener el contenedor
efimero para que `--rm` lo elimine. No aplicar ninguno de estos pasos a la BD
actual, ni montar sus volumenes en ese contenedor.

1. Aprovisionar una instancia MySQL 8 NUEVA y efimera (p. ej., contenedor sin
   volumen del proyecto ni de MySQL actual, ligado a `127.0.0.1` en un puerto
   distinto). Usar credenciales **sinteticas exclusivas de ese ensayo**, no
   leer `backend/.env` ni reutilizar el `DB_NAME` del sistema. Registrar host,
   puerto e identificador de instancia y comprobar que la BD v2 NO existe.
2. **Solo en esa instancia vacia**, cargar el SQL v2: contiene `DROP TABLE` y
   no se debe aplicar jamas a la instancia con datos que deban conservarse.
3. Tomar los SELECT de roles, permisos y pares de grants de esta propuesta;
   guardar solo codigos/estados. Aplicar **primero**
   `backend/migrations/b1_catalogo_permisos_propuesta.sql` y verificar tres
   codigos activos y ninguna concesion automatica.
4. Volver a comprobar los trece codigos y cuatro roles activos; capturar el
   respaldo de pares; confirmar `precondiciones_ok = 1`. Aplicar
   `backend/migrations/b1_grants_roles_propuesta.sql` y contrastar los pares
   posteriores con el respaldo y la tabla de diferencias anterior.
5. En ese mismo entorno efimero probar segunda aplicacion e intentar una
   precondicion faltante (solo en copia) para observar ausencia de cambios.
   Comprobar que `informes.inactivar` no se asigno a nadie y que ningun
   paciente/usuario/rol no identificado se altero. Ensayar reversion selectiva
   sobre otra copia limpia del estado previo.
6. Descartar la instancia efimera al finalizar. No apuntar herramientas al
   host, puerto o credenciales del backend actual en ningun paso.

La sintaxis MySQL y la transaccion de DML **no han sido comprobadas en un
servidor**; solo se permitieron verificaciones estaticas del SQL propuesto.
