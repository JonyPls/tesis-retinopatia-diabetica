# 78C — Intento autorizado detenido por PID_NO_COINCIDE

## A. Autorización y aislamiento

UUID exclusivo: `bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4`.
Manifiesto: `backend/trial_manifests/78b_bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4.json`.
El responsable autorizó expresamente los seis alcances, incluida retirada.

Se inspeccionó el estado inicial NOT_AUTHORIZED y coincidieron UUID, versión,
recursos y hashes aprobados. Se repitieron 62/62 tests offline, sin skips, ANTES
de registrar la autorización. Después se cambiaron únicamente
`authorization_status` y `authorization` mediante el contrato de `authorize()`;
no se cambiaron UUID, recursos, fecha, scopes, hashes ni fuentes del arnés.
`authorize()` volvió a aprobar los metadatos/hashes y la raíz ausente, sin iniciar
procesos en esa comprobación.

- Versión declarada: `codn-discard-mysql77-78a-manifest-v2`, formato 2.
- SHA-256 de fuentes aprobados y posterior al ensayo:
  `95125f3383eeadebba5502dac530d6189fea7cca167ff36a97afdefbe48497aa`.
- SHA-256 del ejecutable MySQL, también inalterado:
  `1c40b282f3defe814926abb3256790e936b82b62107b1b601eb5b20a5364c366`.

Se invocó UNA VEZ la CLI real con `--config`, `--execute` y `--authorize-run`
correspondientes al manifiesto/UUID aprobados. No hubo bypass, nuevo UUID,
regeneración de manifiesto, adopción de procesos existentes ni reintento.

El resultado del ejecutor fue:

```json
{"status":"BLOCKED","code":"PID_NO_COINCIDE"}
```

El control que falla exige que el PID leído de `mysql.pid` coincida con el PID
del Popen propio (`discard_mysql77/runtime.py:96–102`). El control no se debilitó.
El intento alcanzó esa comprobación tras la inicialización y el lanzamiento del
servidor propios; no se acreditó la identidad requerida para continuar.

**No se acredita aislamiento operativo completo.** No se dispone de versión MySQL
en ejecución, UUID SQL, PID esperado/leído ni prueba final de propiedad del
listener en la evidencia conservada. No se infiere la causa del desacuerdo.
Las operaciones de ACL/Job no emitieron un error anterior; la retirada sí confirmó
terminación de handles propios y Job vacío según el mecanismo existente. Esto
no equivale a una auditoría completa de ACL ni a validación de conexión SQL.

## B. Esquema

No hay evidencia de inventario base/full ni de aprobación de InventoryGate.
No se declara instalación verificada de tablas, restricciones, defaults, índices,
InnoDB, collation, UTC o RR. Solo la compilación/contratos offline pasaron.
El esquema sintético ajustado no acredita el DDL clínico habitual.

La evidencia del padre no conserva el hito concreto de cada llamada a `owned()`;
por ello no se certifica un número de consultas administrativas o sentencias SQL
a partir únicamente de ese código de error. No se afirma ejecución de fixtures,
instalación técnica ni pruebas clínicas por ausencia de evidencia del worker.

## C–H. Casos nativos

| Área | Resultado acreditado en este intento |
| --- | --- |
| OD/OI, reinferencia en misma visita, ambos ojos y padre vacío | No ejecutados/acreditados. |
| OD APROBADO/CORREGIDO conservado; rechazos de seleccionados/lotes | No ejecutados/acreditados. |
| B1: creador, permiso ausente/revocado, admin, rol/usuario inactivo y ajenos | No ejecutados/acreditados con MySQL. |
| Retinógrafo HTTP/B1: hash/ojo, confirmación, copia, consumo y reutilización | No ejecutados/acreditados. |
| Limpieza de JPEG/Grad-CAM, manifiesto, reinicio, referencias, symlink/hardlink | No ejecutados/acreditados. No confundir con retirada del entorno. |
| UUID/payload, detalle reemplazado, ACK perdido, CONFIRMADA/NO_CONFIRMADA | No ejecutados/acreditados con MySQL. |
| Probes SQL 1205 y 1213 | No ejecutados/acreditados. |

Las nueve carreras quedan sin evidencia InnoDB:

1. Validación antes de descarte.
2. Descarte antes de validación.
3. Inferencia antigua tras cambio de revisión.
4. Dos descartes con el mismo UUID.
5. Dos descartes con UUID distintos.
6. Incorporación del otro ojo.
7. Informe antes de descarte.
8. Descarte antes de informe.
9. Visitas diferentes.

No se observaron locks clínicos ni se atribuyen resultados de concurrencia a los
mocks offline. NO_CONFIRMADA continúa sin significado negativo terminal; no se
implementó cierre por UUID ni desbloqueo/retry automático.

## I. Verificación realmente realizada

- Offline previo a autorización: **62 ejecutadas, 62 aprobadas, 0 fallidas,
  0 skips** (`test_discard_mysql_preflight77`, `test_discard_mysql_schema77`,
  `test_discard_mysql78a`, `test_discard_mysql78b`).
- Preflight real del manifiesto y comprobación `authorize()` posterior: aprobados,
  hashes coincidentes, seis scopes exactos y raíz aún ausente antes del intento.
- Ejecutor nativo: **1 intento, detenido**, bloqueo de infraestructura
  PID_NO_COINCIDE. No hay casos funcionales MySQL acreditados ni contadores del worker.
- No se repitió la suite de preparación que presupone NOT_AUTHORIZED después
  de autorizar el manifiesto: los 62 pases corresponden al hito previo indicado.
- Auditoría local posterior solo de lectura: hashes aún coincidentes; raíz contiene
  exclusivamente `evidence/` y este contiene solo `retirement.json`.
- `git diff --check`: sin errores; advertencias LF/CRLF en trabajo previo.

No se modificó código clínico/frontend, `.env`, permisos habituales, fotografías
reales, compuertas o fuentes aprobados del arnés. No se conectó con MySQL habitual,
no se cargó ResNet50, no hubo servidores HTTP, commits ni push.

## J. Retirada

Estado REAL del arnés: **COMPLETED**, no se renombra a CLEAN.
`pending=[]`, `evidence_rejected=[]`.

Evidencia conservada:

```text
C:\Users\ricar\AppData\Local\Temp\opencode\codn77-bde4e98a-0eaa-43dd-a1dc-5f8aae670ec4\evidence\retirement.json
```

Contenido saneado: UUID, estado COMPLETED y listas vacías de pendientes/rechazos.
Se comprobó físicamente la ausencia de datadir, bootstrap, código temporal,
temporales, fotos, exportaciones/copias privadas, logs, PID file y marcador.
No se realizaron limpiezas por puerto/nombre ni nuevos arranques/conexiones para
la auditoría posterior. No quedaron recursos privados pendientes reportados.

## K. Dictamen y siguiente paso

1. Aislamiento operativo completo: **no acreditado**; el control PID detuvo el intento.
2. Integridad del descarte sobre InnoDB: **no demostrada** en este incremento.
3. Defectos clínicos: **ninguno demostrado**, porque no se acreditaron sus pruebas.
   Hay un bloqueo de arranque/identidad del arnés y una limitación diagnóstica:
   no conserva PID esperado/leído ni el hito en que falla.
4. Retirada: **COMPLETED**, corroborada por evidencia y ausencia física de privados.
5. Pendientes: diagnosticar el desacuerdo sin omitir controles; después repetir
   verificación nativa, integridad, B1, retinógrafo, nueve carreras e incertidumbre.
6. Navegador: no pasar todavía a validación integrada como si MySQL hubiera pasado.
7. Activación: no autorizada; faltan MySQL y revisión visual/recuperación/despliegue.

No se reutiliza este UUID/raíz (ahora conserva evidencia). Cualquier nuevo ensayo
requiere manifiesto/recursos identificados y autorización expresa nueva, sin
transferir la autorización actual ni regenerar hashes para continuar.
