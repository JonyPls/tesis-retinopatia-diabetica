# 78F — Segundo intento: identidad OS acreditada, fallo antes del esquema

## 1. Autorización y ejecución única

Manifiesto: `backend/trial_manifests/78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json`.
UUID: `c88372a4-b7a4-44d3-a42e-40836ad681af`.

Se repitieron **99/99 pruebas offline**, sin fallos ni skips, antes de autorizar.
Preflight A aprobado: versión vigente, 42 fuentes, dependencias presentes, hashes
coincidentes, 28 campos de recursos concordantes, raíz/derivados inexistentes y
rutas sin enlaces. El manifiesto consumido de 78C permaneció intacto.

Se registró la autorización expresa de 78F solo en `authorization_status` y
`authorization`, según el contrato real de `authorize()`. Se volvió a validar
mediante esa función antes del arranque. No se alteraron hashes, recursos, UUID,
scopes ni código para permitir la ejecución.

SHA-256 de fuentes aprobado y comprobado después:
`97042bfe32d789979b4594f5dbd16c16b1428ee533476357c77d01350605797d`.
SHA-256 del binario, también inalterado:
`1c40b282f3defe814926abb3256790e936b82b62107b1b601eb5b20a5364c366`.

Se ejecutó **una sola vez** desde `backend`:

```powershell
.\venv\Scripts\python.exe -B discard_mysql_trial77.py --config "trial_manifests/78e_c88372a4-b7a4-44d3-a42e-40836ad681af.json" --execute --authorize-run "c88372a4-b7a4-44d3-a42e-40836ad681af"
```

Resultado CLI: `BLOCKED / ENSAYO_INTERRUMPIDO_SIN_REINTENTOS`, exit code 1.
No se reintentó ni se probaron otras opciones de arranque.

## 2. Arranque e identidad observados nativamente

El comando aprobado incluye `--no-monitor` únicamente para el servidor.
`startup.json` conserva estos hitos, con tiempo relativo desde el diagnóstico:

| Hito | ms | Evidencia |
| --- | ---: | --- |
| INITIALIZE | 3484 | Inicializador PID 22732, salida 0, handle válido y Job asignado/miembro. Consulta de imagen posterior a terminar: error Windows 31, imagen no acreditada en ese snapshot. |
| STARTUP_WAIT | 4297 | Servidor PID/handle 5476, vivo, imagen y Job correctos; archivo PID aún ausente. |
| STARTUP_WAIT | 4359 | READY: Popen = handle = PID file = listener = **5476**. |
| PRE_SQL | 4375 | READY: misma igualdad, archivo regular de enlace único, imagen autorizada, Job exacto, raíz/rutas propias. |
| SQL_PROVISION | 4406 | Mismos controles OS válidos; `SQL_OR_WORKER_FAILURE`, `sql_identity_verified=false`. |

La asignación al Job y `IsProcessInJob` del servidor pasaron; no se adoptó un
descendiente ni un listener ajeno. La aplicación de ACL no emitió error previo;
esto no sustituye una auditoría completa de ACL. El error de metadatos del
inicializador ya terminado no se confunde con la identidad válida del servidor ni
se atribuye como causa del fallo posterior.

**Se acredita identidad OS en esos hitos, no aislamiento SQL completo.** Datadir y
PID file configurados se comprobaron como propios; no se acredita su identidad
SQL efectiva, versión consultada, UUID SQL ni funcionamiento InnoDB de los casos.
La metadata PE 8.0.46 documentada en 78D no es una versión SQL obtenida en 78F.

## 3. Pruebas y defecto/limitación encontrados

- Offline: **99 aprobadas, 0 fallidas, 0 skips**.
- Ensayo nativo: **1 intento detenido** en `SQL_PROVISION`, no por PID_NO_COINCIDE.
- Esquema e InventoryGate: no alcanzados. En el código, la bandera de identidad
  SQL se activa antes de CREATE DATABASE/USER/GRANT; permaneció falsa y no se
  alcanzó ese bloque creador. No se afirma que no hubiera ninguna consulta previa:
  la conexión y los SELECT de identidad no tienen hitos separados conservados.
- Integridad OD/OI, visita, APROBADO/CORREGIDO, B1, retinógrafo, nueve carreras,
  idempotencia/incertidumbre, 1205/1213, limpieza/recuperación y modo deshabilitado:
  **no ejecutados**; no hay resultados del worker ni aprobación de inventario.
- Ningún defecto clínico demostrado; tampoco integridad sobre InnoDB demostrada.

La excepción genérica del padre en `runtime.execute()` conserva solo el código
cerrado `ENSAYO_INTERRUMPIDO_SIN_REINTENTOS`; el diagnóstico marca el grupo
`SQL_PROVISION`, pero no guarda clase/código ni subhito exacto. No es posible
distinguir con esta evidencia entre conexión/autenticación, consulta, rechazo de
la utilidad `ensure_own_server()` u otro error anterior a la confirmación SQL.
No se atribuye una causa concreta sin evidencia.

**Corrección mínima necesaria antes de otro intento:** ampliar exclusivamente la
evidencia del padre con clase de excepción saneada, código MySQL numérico si
existe, y subhitos conexión/verificación SQL/aprovisionamiento. Nunca mensajes,
credenciales, DSN, argv ni trazas crudas. Agregar tests offline que garanticen
saneamiento y conservación del error original/retirada. No se implementa aquí ni
se propone alterar autenticación, versiones o controles para conseguir un pase.
El fallo SQL concreto deberá corregirse solo cuando esa evidencia lo identifique.

## 4. Retirada y auditoría posterior de solo lectura

Estado real: **COMPLETED**, `pending=[]`, `evidence_rejected=[]`.
`startup_evidence_written=true`.

Raíz retirada de privados:

```text
C:\Users\ricar\AppData\Local\Temp\opencode\codn77-c88372a4-b7a4-44d3-a42e-40836ad681af
```

Se comprobó que contiene exclusivamente `evidence/`, con:

- `startup.json`: SHA-256 `1478bc7a8c7b0341c878e8da52340d27abe3d03f8c274a1f07ba78d07c011b31`.
- `retirement.json`: SHA-256 `fec9457b981e6a0ef4c3be9cf0111788301b0d9d52e4ecb588e300ab89ce46b8`.

El sanitizador volvió a validar startup; la auditoría verificó ausencia de datadir,
bootstrap, código temporal, fotos/copias privadas, PID file, logs y marcador.
El mecanismo de retirada confirmó parada de handles propios y Job vacío antes de
borrar. No se enumeraron procesos ajenos ni se abrieron nuevas conexiones durante
la auditoría. El manifiesto actual queda como autorización histórica consumida;
no se reutiliza su UUID/raíz ni se genera otro manifiesto en este incremento.

## 5. Dictamen y alcance de cambios

No avanzar todavía a validación visual integrada como si MySQL hubiera aprobado.
Primero hace falta la corrección diagnóstica focalizada indicada y, por separado,
resolver el fallo identificado y completar las pruebas nativas pendientes bajo
una autorización posterior válida. No se autoriza activación.

En 78F solo se cambiaron los dos campos de autorización del manifiesto nuevo y
se añadió este informe. Los fuentes aprobados/binario y el manifiesto 78C siguen
inalterados. Sin cambios clínicos, frontend, `.env`, compuertas, permisos habituales,
fotografías reales o recursos del MySQL habitual; sin ResNet50, commits ni push.
