# 78E — Segundo manifiesto MySQL, pendiente de autorización

## Identificación y estado

Manifiesto nuevo:
[`78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json`](../trial_manifests/78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json).

- UUID: `c88372a4-b7a4-44d3-a42e-40836ad681af`.
- Preparación UTC: `2026-11-02T06:04:36Z`.
- Formato: **2**; arnés: `codn-discard-mysql77-78d-pid-evidence-v2`.
- Estado: **NOT_AUTHORIZED**; `authorization` vacío. Sin token ni contraseñas operativas.
- SHA-256 de los **42 fuentes seleccionados**, incluido lanzador y `process_identity.py`:
  `97042bfe32d789979b4594f5dbd16c16b1428ee533476357c77d01350605797d`.
- Binario previsto: `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe`.
- SHA-256 binario, recalculado leyendo el archivo sin ejecutarlo:
  `1c40b282f3defe814926abb3256790e936b82b62107b1b601eb5b20a5364c366`.

Se usaron `safety.Plan`, `planned_resources`, `validate_metadata`, `load_plan` y
`preflight`, sin añadir un generador ni modificar código. Los hashes se calcularon
contra los archivos actuales, no se copiaron de otro manifiesto. El JSON serializa
el contrato cerrado existente y sus **28 campos de recursos**; no admite overrides.

El manifiesto consumido de 78C no se modificó ni se usó para ejecutar/autorizar.
Su SHA-256 antes/después de la preparación se mantuvo:
`79c691acdc5d396da2ae3fae6d32a0030ff170c27299fd02378e3463b412980a`.
Las referencias NOT_AUTHORIZED de los documentos 77/78B son históricas, no una
descripción del estado actual de aquel manifiesto. Este es un UUID distinto.

## Recursos y perímetro

Raíz propuesta **inexistente**, denominada R:

```text
C:\Users\ricar\AppData\Local\Temp\opencode\codn77-c88372a4-b7a4-44d3-a42e-40836ad681af
```

| Recurso previsto | Destino/política |
| --- | --- |
| Datadir, bootstrap y PID | `R\data`, `R\bootstrap.sql`, `R\mysql.pid`; marcador propio `R\owner.json`. |
| Copia de fuentes | `R\backend`; solo allowlist, digest comprobado antes/después; sin `.env`, maestro privado ni fotografías. |
| Fotografías y Grad-CAM | Solo sintéticos en `R\backend\uploads\retinas`. |
| Retinógrafo sintético | Exportaciones `R\exports`, copias privadas `R\private`. |
| Temporales/logs | `R\tmp`, `R\init.log`, `R\mysql.log`; no conservar logs crudos. |
| Evidencia | `R\evidence`: startup/results/failure saneados, huellas DDL y retirement; nunca credenciales. |
| Esquema | `codn77_c88372a4b7a444d3a42e40836ad681af`, solo en la instancia NUEVA. |
| Cuenta app | `codn77_app@127.0.0.1`, creada solo en esa instancia; SELECT/INSERT/UPDATE/DELETE del esquema propio. El nombre fijo no implica reutilizar una cuenta habitual. |
| Administrador | `root@localhost` exclusivamente de la instancia NUEVA, credencial efímera futura. |
| Procesos | Inicializador/servidor con binario identificado; Python del venv para worker/reinicio, Job propio; helpers whoami/icacls identificados en JSON. Sin servidor HTTP. |
| Red | `127.0.0.1`, puerto efímero solo tras autorizar, nunca 3306. No se reserva ahora ni se acepta un listener existente. |

Las rutas candidatas y sus ancestros actuales pasaron `no_links`/`inside`; todos
los destinos derivados de R están ausentes. Binario, intérprete y helpers existen
en las rutas declaradas. Los helpers Windows son archivos del sistema, no recursos
propios que se puedan retirar; no se ejecutaron ni modificaron.

No se inspeccionaron instancias ajenas. El diseño exige Popen nuevo: no contiene
opción para reutilizar un servidor o seleccionar otro host/esquema. La fábrica
sustituye dotenv/modelos y recibe configuración explícita; `clean_environment`
excluye credenciales heredadas. No se leyó `.env` ni se generó una contraseña.

Retirada prevista: detener únicamente Job/handles propios, confirmar parada/vaciado
e identidad FS, retirar únicamente el árbol privado de R. No borrar por PID leído,
nombre de proceso o puerto; no DROP remoto ni limpieza global. Propiedad incierta,
enlaces inseguros, escritores vivos o error de retirada deben producir `INCOMPLETE`.

## Alcances solicitados, todavía NO concedidos

1. `start_owned_mysql`
2. `create_synthetic_schema`
3. `synthetic_sql_writes`
4. `synthetic_files`
5. `stop_owned_process`
6. `retire_owned_resources`

La existencia/preflight del manifiesto no constituye autorización. Se necesita
una decisión posterior específica para este UUID, recursos y seis alcances, más
el procedimiento de autorización del arnés. No se transfiere consentimiento de 78C.

## Secuencia futura contrastada con el código

1. Repetir tests y validar manifiesto, versión, hashes actuales y autorización
   independiente; un cambio requiere revisión, no regeneración automática para continuar.
2. Verificar raíz/recursos ausentes y rutas seguras; crear raíz propia, ACL privada
   y copia allowlisted con digest verificado. Solo tras autorización elegir puerto.
3. Inicializar datadir nuevo; lanzar servidor con `--no-defaults` primero y
   **`--no-monitor` solo en el servidor**, no en el inicializador.
4. Acreditar igualdad de PID Popen/handle/archivo/listener, vida, imagen y Job exacto.
   Espera máxima 60 s, sondeos 50 ms solo ante PID ausente/vacío o listener ausente.
5. Solo entonces conectar y confirmar UUID SQL propio, datadir/puerto efectivos,
   versión, PID file, InnoDB, UTC y aislamiento; crear esquema/cuenta propios.
6. Instalar las 16 tablas base sintéticas con el overlay documentado, no DDL habitual.
7. Aprobar inventario **base** antes de fixtures apagados; invalidar al instalar las
   dos tablas técnicas; aprobar inventario **full** antes de fixtures habilitados.
   `InventoryGate`, seed y guards DML conservan la barrera.
8. Ejecutar los casos preparados de integridad OD/OI, validaciones/rechazos, B1 y
   retinógrafo HTTP sintético. El orden interno del grupo es el de `run_enabled`.
9. Ejecutar las nueve carreras InnoDB preparadas, con conexiones independientes,
   sincronización determinista y observación de locks; no retries para ocultar fallos.
10. Comprobar incertidumbre/idempotencia, respuesta perdida, 1205/1213 y limpieza,
    reinicio/manifiestos/archivos. NO_CONFIRMADA no es un fracaso terminal.
11. Capturar diagnóstico de arranque antes de borrar sus archivos; cerrar conexiones
    y aplicar la retirada exclusiva de recursos propios, también ante fallo.
12. Conservar solo evidencia saneada y estado real `COMPLETED`/`INCOMPLETE`, con
    pendientes explícitos. No declarar éxito si la retirada queda incompleta.

Si falla el arranque: **detenerse**, conservar `startup.json` cuando la propiedad
y escritura lo permitan y efectuar retirada segura. El worker puede añadir
`failure.json.worker_pid`. No probar otras opciones ni repetir automáticamente B.
La evidencia excluye argv/env, mensajes crudos, DSN, contraseñas, tokens, datos
clínicos y contenido inválido del PID file; la retirada la vuelve a sanear.

## Verificación realmente realizada en 78E

```powershell
# Desde backend, sin MySQL:
.\venv\Scripts\python.exe -B -m unittest test_discard_mysql_preflight77 test_discard_mysql_schema77 test_discard_mysql78a test_discard_mysql78b test_discard_mysql78d -v
.\venv\Scripts\python.exe -B discard_mysql_trial77.py --config "trial_manifests/78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json"
```

- **99/99 pruebas offline aprobadas, 0 fallos, 0 skips**, incluidas 37 de 78D.
- Preflight del JSON nuevo: `A_NO_CONNECTION`, `INSPECTED_NOT_AUTHORIZED`,
  `NOT_AUTHORIZED_BY_PREFLIGHT`, 42 fuentes y todas las dependencias detectadas.
- Auditoría adicional con Popen, subprocess.run, conexión/bind y OwnedTrial
  bloqueados: 28 campos concordantes, hashes recalculados coincidentes, rutas
  propias ausentes y sin enlaces, allowlist sin fotos/secretos, y `--no-monitor`
  estructuralmente limitado al rol MYSQL.
- Dos rechazos CLI simulados sobre el JSON nuevo: sin confirmación,
  `AUTORIZACION_EXPLICITA_REQUERIDA`; con UUID coincidente pero sin autorización,
  `MANIFIESTO_NO_AUTORIZADO`. Ninguno alcanza OwnedTrial/procesos/red/reserva de puerto.
- Sintaxis de **46 archivos Python** en memoria, sin importar código clínico ni
  generar pyc; JSON/whitespace y `git diff --check` comprobados al cierre.
- JSON nuevo inalterado por las comprobaciones y manifiesto histórico intacto.
  No se crearon R, datadir ni cuentas; los tests usan fixtures temporales offline
  independientes y dobles de procesos/Job, nunca la raíz propuesta como ensayo.

En este prompt solo se añadieron este documento y el JSON nuevo. No se modificó
código funcional/arnés, frontend, permisos B1, `.env`, fotos, retinógrafo ni gates.
No hubo MySQL, SQL, DDL/DML, migraciones, inferencia real, commits o push.

## Comando futuro previsto — NO ejecutado

Desde `backend`, únicamente después de nueva autorización y preflight:

```powershell
.\venv\Scripts\python.exe -B discard_mysql_trial77.py --config "trial_manifests/78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json" --execute --authorize-run "<PENDIENTE_DE_AUTORIZACION>"
```

Es un placeholder deliberadamente inválido, no un token/confirmación utilizable.
El UUID correcto tampoco bastaría mientras el manifiesto siga NOT_AUTHORIZED.
La CLI no tiene un flag `--preflight`: sin `--execute` ejecuta A.

## Bloqueos y dictamen

**Listo para solicitar autorización específica, NO autorizado para ejecutar.**
No hay fallos offline pendientes. Faltan consentimiento humano para este manifiesto
y repetir preflight justo antes del ensayo. Solo B autorizada podrá acreditar
compatibilidad nativa de `--no-monitor`, PID/handle/Job/ACL/listener, identidad SQL,
datadir efectivo, inventario, integridad, carreras InnoDB, filesystem y retirada.
Los mocks no acreditan esos resultados ni la causa histórica de 78C.
El overlay sintético no valida el DDL clínico habitual; no se autoriza activación
ni se da por aprobada la validación integrada en navegador.
