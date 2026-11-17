# CODN — Informe de pruebas de caja blanca

## Alcance y resultado

RUN-ID: **20261103T160850Z-421d66ca**. Ejecución nueva del **3 de noviembre de 2026 (America/Lima)**.
Cuatro casos unitarios, **41 métodos y 175 subcasos**. Los subcasos están dentro de los métodos: no se suman como pruebas independientes. CB-03 y las cinco CN permanecen **PENDIENTES**.

| Caso | Métodos | Subcasos | Estado | Salida |
|---|---:|---:|---|---:|
| CB-01 | 12 | 46 | APROBADO | 0 |
| CB-02 | 10 | 67 | APROBADO | 0 |
| CB-04 | 9 | 37 | APROBADO | 0 |
| CB-05 | 10 | 25 | APROBADO | 0 |

## Reproducibilidad y aislamiento

- Git: `7e2440d4775ab8af0918c435390bfa312b162b13`. Árbol limpio antes de esta intervención; no persistían los dos cambios locales mencionados en la auditoría anterior. No se revierten cambios. [Estado final](evidencias/20261103T160850Z-421d66ca/git-status-final.txt).
- Auditoría copiada byte por byte; SHA-256 `3CCFA99A930AB1F3DED77C5B463E8C48F35266915FFFCC500A03BD4DF69AE487`. Se conserva su contexto histórico (modo Plan, herramientas disponibles entonces); no describe restricciones actuales.
- Python 3.12.10 local, unittest/mock/trace de biblioteca estándar. Versiones por metadatos: Flask=3.1.3, SQLAlchemy=2.0.30, PyJWT=2.12.1, Pillow=10.3.0, numpy=1.26.4, opencv-python=4.11.0.86, coverage=not installed, pytest=not installed. No se instaló nada.
- Cada suite se ejecutó en un proceso separado, sin discovery, `app.py`, `database.init_db`, DDL, servicios ni MySQL.
- Imports de base/repositorios/modelos sustituídos antes de cargar fuentes objetivo. Lectura de `.env`/pesos, conexiones, resolución de red, procesos secundarios y escrituras fuera de raíces de evidencia/temporales rechazadas por el runner.
- Variables heredadas eliminadas; las pruebas auth usan solo una clave ficticia. El mkdir de importación de diagnosis_service se suprime y se comprueba una vez. UPLOAD_FOLDER se redirige después a TemporaryDirectory propio; DiagnosisFiles real trabaja solo allí.
- Consulta auxiliar `platform._syscmd_ver` simulada para que dependencias de JWT no lancen `ver`. No se altera autenticación productiva. Descargas deshabilitadas y librerías de IA sustituidas antes de importar.
- [Verificación de fuentes sin cambios](evidencias/20261103T160850Z-421d66ca/verificacion-fuentes.txt). Sin commits ni push.

## Incidencias de preparación conservadas

1. CB-01, `ejecucion-01.log`: Python de Microsoft Store no pudo iniciar bajo el acceso restringido; no ejecutó tests. Se resolvió con la ejecución autorizada del Python local.
2. CB-01, `ejecucion-02.log` y `ejecucion-03.log`: aserciones pasaron pero la guarda marcó FALLIDO por tres intentos de la biblioteca platform de abrir NUL para lanzar una consulta de versión. Se bloquearon; no hubo escritura clínica. La traza diagnóstica está en `resultado-previo-CB-01.json`.
3. Se corrigió exclusivamente la utilidad de pruebas para simular esa consulta de SO y preservar UTF-8 en los logs; ejecución final `ejecucion-04.log`, cero intentos prohibidos. Las demás suites se repitieron para usar la misma versión final del runner. Los resultados previos no se borraron.

## Criterio de cobertura

Medición real con `trace.Trace(count=True, trace=False)`. Denominador: líneas ejecutables según tablas de líneas de CPython (`trace._find_executable_linenos`) dentro de cuerpos de las funciones explícitas y sus cierres anidados. Incluye validación estructural y helpers seleccionados; excluye imports, definiciones, otras funciones del archivo, tests, mocks, dependencias, frontend y rutas no objetivo. Algunas líneas de docstring/multilínea son eventos elegibles de CPython; no se equiparan a sentencias lógicas.

Cada `.cover.txt` conserva conteos por línea y `>>>>>>` para faltantes. `resultado.json` incluye funciones, líneas ejecutadas/faltantes, denominador y SHA-256 de la fuente. **No es cobertura de todo el archivo/repositorio, de ramas, de condiciones independientes ni MC/DC.** No hay proveedor de ramas instalado. Las matrices detallan condiciones/aserciones ensayadas sin convertirlas en un porcentaje de ramas.

## Evidencia visual y trazabilidad

Los HTML se generan exclusivamente de logs y contadores reales, con rótulo de reporte derivado; no imitan una consola. Los PNG, cuando figuran por caso, son capturas originales del visor nativo mediante Windows.Graphics.Capture (habilidad computer-use), sin montaje ni edición. No son capturas de la aplicación clínica ni de una consola en vivo. El log íntegro y las fuentes acompañan cada captura y prevalecen para auditoría.

Si falta un PNG: abrir `evidencias/20261103T160850Z-421d66ca/CB-XX/reporte.html` en navegador local; maximizar, mostrar encabezado/cobertura/métodos; usar Recortes de Windows y guardar `CB-XX-reporte.png` dentro de su carpeta. Para consola en vivo: desde `backend`, ejecutar el comando de `comando.txt` en una carpeta de evidencia **nueva**, esperar el resumen/código de salida y capturar sin tokens ni otros archivos en pantalla. No sobrescribir esta corrida.

Cada carpeta contiene copia de la suite ejecutada; `soporte/` conserva runner, fixtures y generador exactos. `SHA256SUMS.txt` registra todos los archivos de la corrida salvo el propio manifiesto; PNG/HTML son evidencia auxiliar, logs/JSON/archivos ejecutados son respaldo primario.

# CB-01 — Autenticación y autorización estricta

## Identificación

- Objetivo: Verificar credenciales, JWT, identidad vigente, grants por rol habilitante y bloqueo de operaciones protegidas.
- Tipo: caja blanca unitaria, funciones reales con dependencias aisladas.
- Componentes/funciones: ver tabla de cobertura, `.cover.txt` y fuentes numeradas; funciones exactas en `resultado.json`.

## Diseño

- Precondiciones: dependencias locales, proceso nuevo, guardas activas, ninguna base ni servicio compartido, fixtures sintéticas.
- Entradas y condiciones: Credenciales ausentes/incorrectas/válidas, cuenta inactiva filtrada, cada grant faltante, procedencia de roles, reglas vacías/comodines/any_of, alcance de pacientes, recurso denegado, JWT inválido/expirado, recarga de identidad y cortocircuito de handler/recurso.
- Esperado: cada variante cumple su aserción; rechazos negativos correctos son éxitos. Ningún handler/insert/commit posterior al rechazo cuando corresponde.
- Sustituciones: AuthRepository; entidades de roles/grants sintéticas. En una variante se invoca get_user_by_username real con query simulada para verificar estado=ACTIVO. Hash y JWT reales con clave ficticia, nunca impresa.

## Ejecución

- Archivo: [`test_codn_cb01_authorization.py`](../../../backend/test_codn_cb01_authorization.py). Copia exacta bajo la carpeta del caso.
- Fecha local: 2026-11-03T11:12:34.639259-05:00; UTC: 2026-11-03T16:12:34.639259+00:00 → 2026-11-03T16:12:59.093724+00:00.
- Duración del proceso instrumentado antes de inventariar versiones/cerrar artefactos: 24.454 s.
- Comando (desde `backend/`):

```powershell
.\venv\Scripts\python.exe -B -u codn_run_whitebox.py test_codn_cb01_authorization "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T160850Z-421d66ca\CB-01"
```

- Métodos: **12**; subcasos `subTest`: **46**; fallos: 0; errores: 0; omitidos: 0.
- Aserciones: no se instrumentó un conteo exacto. No se confunde métodos, subcasos ni llamadas `assert` estáticas con número de aserciones ejecutadas.
- Obtenido: **APROBADO**; código de salida **0**; intentos prohibidos detectados por la guarda: **0**.

## Evidencias

- [Log íntegro final](evidencias/20261103T160850Z-421d66ca/CB-01/ejecucion-04.log), [salida del proceso](evidencias/20261103T160850Z-421d66ca/CB-01/exit-04.txt), [resultado estructurado](evidencias/20261103T160850Z-421d66ca/CB-01/resultado.json), [comando exacto](evidencias/20261103T160850Z-421d66ca/CB-01/comando.txt).
- [Matriz condición/entrada/aserción/resultado](evidencias/20261103T160850Z-421d66ca/CB-01/matriz-condiciones.md).
- [Reporte HTML auténtico derivado de logs/trace](evidencias/20261103T160850Z-421d66ca/CB-01/reporte.html). Es un reporte, no una consola ni captura de CODN.
- PNG: **PENDIENTE** de captura auténtica del reporte; ver instrucciones manuales.
- Fuentes numeradas `.fuente.txt` y contadores `.cover.txt` conservados en la misma carpeta; hashes en el manifiesto.

| Archivo funcional / alcance de funciones | Líneas ejecutadas/elegibles | Cobertura de líneas |
|---|---:|---:|
| `services/auth_service.py` | 31/31 | 100.00% |
| `utils/security.py` | 44/46 | 95.65% |
| `utils/strict_authorization.py` | 62/77 | 80.52% |
| `src/repositories/auth_repository.py` | 1/1 | 100.00% |

## Análisis

- Interpretación: todas las variantes obligatorias previstas para este alcance se evaluaron con aserciones internas. Las rutas negativas generan mensajes ERROR/WARNING deliberados en el log; el veredicto depende de las aserciones y la salida final.
- Defectos funcionales detectados: ninguno en estos escenarios. No se modificó código funcional para conseguir el resultado.
- Límites: No verifica SQL ni asignaciones reales de la base. Usuario inactivo se representa por la exclusión en el repositorio; el servicio delega allí esa condición. No cubre todas las modalidades condicionales del decorador ni helpers heredados.
- Conclusión: **APROBADO** dentro del alcance unitario descrito; ninguna conclusión adicional de integración, rendimiento o calidad clínica.

# CB-02 — Validaciones internas del alta de pacientes

## Identificación

- Objetivo: Verificar validaciones y normalización previas a escritura, límites reproducibles y ausencia de insert/commit al rechazar datos.
- Tipo: caja blanca unitaria, funciones reales con dependencias aisladas.
- Componentes/funciones: ver tabla de cobertura, `.cover.txt` y fuentes numeradas; funciones exactas en `resultado.json`.

## Diseño

- Precondiciones: dependencias locales, proceso nuevo, guardas activas, ninguna base ni servicio compartido, fixtures sintéticas.
- Entradas y condiciones: Datos válidos, cada obligatorio ausente, acumulación de errores, formatos de nombre/documento/correo, edades 120/121, fechas imposibles/futuras, límites de nombres/dirección/antecedentes/alergias, opcionales, duplicados y normalización NFC/espacios/mayúsculas.
- Esperado: cada variante cumple su aserción; rechazos negativos correctos son éxitos. Ningún handler/insert/commit posterior al rechazo cuando corresponde.
- Sustituciones: PatientRepository, DocumentRepository, constructor Paciente y db.session; reloj datetime del servicio fijado al 03/11/2026. valid_email y funciones objetivo reales.

## Ejecución

- Archivo: [`test_codn_cb02_patient_validation.py`](../../../backend/test_codn_cb02_patient_validation.py). Copia exacta bajo la carpeta del caso.
- Fecha local: 2026-11-03T11:12:59.755453-05:00; UTC: 2026-11-03T16:12:59.755453+00:00 → 2026-11-03T16:13:15.104213+00:00.
- Duración del proceso instrumentado antes de inventariar versiones/cerrar artefactos: 15.349 s.
- Comando (desde `backend/`):

```powershell
.\venv\Scripts\python.exe -B -u codn_run_whitebox.py test_codn_cb02_patient_validation "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T160850Z-421d66ca\CB-02"
```

- Métodos: **10**; subcasos `subTest`: **67**; fallos: 0; errores: 0; omitidos: 0.
- Aserciones: no se instrumentó un conteo exacto. No se confunde métodos, subcasos ni llamadas `assert` estáticas con número de aserciones ejecutadas.
- Obtenido: **APROBADO**; código de salida **0**; intentos prohibidos detectados por la guarda: **0**.

## Evidencias

- [Log íntegro final](evidencias/20261103T160850Z-421d66ca/CB-02/ejecucion-04.log), [salida del proceso](evidencias/20261103T160850Z-421d66ca/CB-02/exit-04.txt), [resultado estructurado](evidencias/20261103T160850Z-421d66ca/CB-02/resultado.json), [comando exacto](evidencias/20261103T160850Z-421d66ca/CB-02/comando.txt).
- [Matriz condición/entrada/aserción/resultado](evidencias/20261103T160850Z-421d66ca/CB-02/matriz-condiciones.md).
- [Reporte HTML auténtico derivado de logs/trace](evidencias/20261103T160850Z-421d66ca/CB-02/reporte.html). Es un reporte, no una consola ni captura de CODN.
- PNG: **PENDIENTE** de captura auténtica del reporte; ver instrucciones manuales.
- Fuentes numeradas `.fuente.txt` y contadores `.cover.txt` conservados en la misma carpeta; hashes en el manifiesto.

| Archivo funcional / alcance de funciones | Líneas ejecutadas/elegibles | Cobertura de líneas |
|---|---:|---:|
| `services/patient_service.py` | 152/171 | 88.89% |
| `utils/identity_validation.py` | 13/13 | 100.00% |

## Análisis

- Interpretación: todas las variantes obligatorias previstas para este alcance se evaluaron con aserciones internas. Las rutas negativas generan mensajes ERROR/WARNING deliberados en el log; el veredicto depende de las aserciones y la salida final.
- Defectos funcionales detectados: ninguno en estos escenarios. No se modificó código funcional para conseguir el resultado.
- Límites: No prueba índices, concurrencia ni integridad física MySQL. No se inyectan errores de persistencia de pacientes; están fuera de este objetivo previo a escritura. Los límites de longitud de nombres se evalúan directamente en el validador.
- Conclusión: **APROBADO** dentro del alcance unitario descrito; ninguna conclusión adicional de integración, rendimiento o calidad clínica.

# CB-04 — Validación y compensación del procesamiento fotográfico

## Identificación

- Objetivo: Verificar validadores, cortocircuitos, interpretación de predicción simulada y limpieza segura ante fallos y commit incierto.
- Tipo: caja blanca unitaria, funciones reales con dependencias aisladas.
- Componentes/funciones: ver tabla de cobertura, `.cover.txt` y fuentes numeradas; funciones exactas en `resultado.json`.

## Diseño

- Precondiciones: dependencias locales, proceso nuevo, guardas activas, ninguna base ni servicio compartido, fixtures sintéticas.
- Entradas y condiciones: JPEG/PNG/TIFF válidos, 349/350 px, caps superiores configurados reducidos, bytes corruptos/GIF/MIME/nombre inválidos; región dominante/negra/pequeña; semántica aceptada/rechazada/503/500; preflight/límite de bytes; éxito simulado, preparación/inserción/publicación fallidas; consulta independiente simulada tras commit incierto; rollback fallido; colisión con archivo ajeno.
- Esperado: cada variante cumple su aserción; rechazos negativos correctos son éxitos. Ningún handler/insert/commit posterior al rechazo cuando corresponde.
- Sustituciones: CLIP (modelo/procesador/tensores), torch.no_grad, predecir_imagen_bytes (sustituye ResNet50/Grad-CAM), repositorios, confirmaciones del retinógrafo y db.session/engine. Pillow, NumPy, OpenCV, validadores, servicio y DiagnosisFiles reales. Fallos de preparación/publicación inyectados sobre almacenamiento real temporal.

## Ejecución

- Archivo: [`test_codn_cb04_diagnosis_logic.py`](../../../backend/test_codn_cb04_diagnosis_logic.py). Copia exacta bajo la carpeta del caso.
- Fecha local: 2026-11-03T11:13:15.583158-05:00; UTC: 2026-11-03T16:13:15.583158+00:00 → 2026-11-03T16:13:39.777287+00:00.
- Duración del proceso instrumentado antes de inventariar versiones/cerrar artefactos: 24.194 s.
- Comando (desde `backend/`):

```powershell
.\venv\Scripts\python.exe -B -u codn_run_whitebox.py test_codn_cb04_diagnosis_logic "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T160850Z-421d66ca\CB-04"
```

- Métodos: **9**; subcasos `subTest`: **37**; fallos: 0; errores: 0; omitidos: 0.
- Aserciones: no se instrumentó un conteo exacto. No se confunde métodos, subcasos ni llamadas `assert` estáticas con número de aserciones ejecutadas.
- Obtenido: **APROBADO**; código de salida **0**; intentos prohibidos detectados por la guarda: **0**.

## Evidencias

- [Log íntegro final](evidencias/20261103T160850Z-421d66ca/CB-04/ejecucion-04.log), [salida del proceso](evidencias/20261103T160850Z-421d66ca/CB-04/exit-04.txt), [resultado estructurado](evidencias/20261103T160850Z-421d66ca/CB-04/resultado.json), [comando exacto](evidencias/20261103T160850Z-421d66ca/CB-04/comando.txt).
- [Matriz condición/entrada/aserción/resultado](evidencias/20261103T160850Z-421d66ca/CB-04/matriz-condiciones.md).
- [Reporte HTML auténtico derivado de logs/trace](evidencias/20261103T160850Z-421d66ca/CB-04/reporte.html). Es un reporte, no una consola ni captura de CODN.
- PNG: **PENDIENTE** de captura auténtica del reporte; ver instrucciones manuales.
- Fuentes numeradas `.fuente.txt` y contadores `.cover.txt` conservados en la misma carpeta; hashes en el manifiesto.

| Archivo funcional / alcance de funciones | Líneas ejecutadas/elegibles | Cobertura de líneas |
|---|---:|---:|
| `dl_model/validator.py` | 90/90 | 100.00% |
| `services/diagnosis_service.py` | 115/138 | 83.33% |
| `utils/diagnosis_storage.py` | 55/70 | 78.57% |

## Análisis

- Interpretación: todas las variantes obligatorias previstas para este alcance se evaluaron con aserciones internas. Las rutas negativas generan mensajes ERROR/WARNING deliberados en el log; el veredicto depende de las aserciones y la salida final.
- Defectos funcionales detectados: ninguno en estos escenarios. No se modificó código funcional para conseguir el resultado.
- Límites: No ejecuta inferencia real ni acredita exactitud clínica. Las formas geométricas sintéticas son fixtures declaradas, no retinografías aptas para CN-05. Los límites superiores se ensayan con caps configurados menores para evitar grandes asignaciones. La consulta tras commit es simulada; no acredita estado del motor. No evalúa consumo de confirmaciones de retinógrafo ni descarte.
- Conclusión: **APROBADO** dentro del alcance unitario descrito; ninguna conclusión adicional de integración, rendimiento o calidad clínica.

# CB-05 — Control transaccional de creación de informes

## Identificación

- Objetivo: Verificar orden visita→informe→versión→commit, IDs, errores, rollback y ausencia de reintentos inseguros.
- Tipo: caja blanca unitaria, funciones reales con dependencias aisladas.
- Componentes/funciones: ver tabla de cobertura, `.cover.txt` y fuentes numeradas; funciones exactas en `resultado.json`.

## Diseño

- Precondiciones: dependencias locales, proceso nuevo, guardas activas, ninguna base ni servicio compartido, fixtures sintéticas.
- Entradas y condiciones: Nueva visita/existente, paciente/tipo/visita inexistentes o ajenos, duplicado Conflict/1062 del índice conocido, fallo en cada escritura, integridad desconocida, DBAPI antes de commit, errores durante commit incluidos duplicados, rollback que falla y envelopes inválidos.
- Esperado: cada variante cumple su aserción; rechazos negativos correctos son éxitos. Ningún handler/insert/commit posterior al rechazo cuando corresponde.
- Sustituciones: InformeRepository (incluidas excepciones de frontera NotFound/Conflict), DiagnosisDiscardRepository y db.session. Servicio, validación estructural, clasificación de IntegrityError y gate con descarte apagado reales. DBAPIError/IntegrityError son clases reales de SQLAlchemy con causas sintéticas.

## Ejecución

- Archivo: [`test_codn_cb05_report_transaction.py`](../../../backend/test_codn_cb05_report_transaction.py). Copia exacta bajo la carpeta del caso.
- Fecha local: 2026-11-03T11:13:40.298229-05:00; UTC: 2026-11-03T16:13:40.298229+00:00 → 2026-11-03T16:13:56.076973+00:00.
- Duración del proceso instrumentado antes de inventariar versiones/cerrar artefactos: 15.779 s.
- Comando (desde `backend/`):

```powershell
.\venv\Scripts\python.exe -B -u codn_run_whitebox.py test_codn_cb05_report_transaction "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T160850Z-421d66ca\CB-05"
```

- Métodos: **10**; subcasos `subTest`: **25**; fallos: 0; errores: 0; omitidos: 0.
- Aserciones: no se instrumentó un conteo exacto. No se confunde métodos, subcasos ni llamadas `assert` estáticas con número de aserciones ejecutadas.
- Obtenido: **APROBADO**; código de salida **0**; intentos prohibidos detectados por la guarda: **0**.

## Evidencias

- [Log íntegro final](evidencias/20261103T160850Z-421d66ca/CB-05/ejecucion-04.log), [salida del proceso](evidencias/20261103T160850Z-421d66ca/CB-05/exit-04.txt), [resultado estructurado](evidencias/20261103T160850Z-421d66ca/CB-05/resultado.json), [comando exacto](evidencias/20261103T160850Z-421d66ca/CB-05/comando.txt).
- [Matriz condición/entrada/aserción/resultado](evidencias/20261103T160850Z-421d66ca/CB-05/matriz-condiciones.md).
- [Reporte HTML auténtico derivado de logs/trace](evidencias/20261103T160850Z-421d66ca/CB-05/reporte.html). Es un reporte, no una consola ni captura de CODN.
- PNG: **PENDIENTE** de captura auténtica del reporte; ver instrucciones manuales.
- Fuentes numeradas `.fuente.txt` y contadores `.cover.txt` conservados en la misma carpeta; hashes en el manifiesto.

| Archivo funcional / alcance de funciones | Líneas ejecutadas/elegibles | Cobertura de líneas |
|---|---:|---:|
| `services/informe_service.py` | 116/145 | 80.00% |

## Análisis

- Interpretación: todas las variantes obligatorias previstas para este alcance se evaluaron con aserciones internas. Las rutas negativas generan mensajes ERROR/WARNING deliberados en el log; el veredicto depende de las aserciones y la salida final.
- Defectos funcionales detectados: ninguno en estos escenarios. No se modificó código funcional para conseguir el resultado.
- Límites: Comprueba llamadas/orden y tratamiento público, no atomicidad física. Asociación ajena se simula mediante NotFound del repositorio; validar_visita SQL real no se ejecuta. La ausencia de residuos y el acuse perdido real requieren integración MySQL aislada (CB-03/ampliación CB-05).
- Conclusión: **APROBADO** dentro del alcance unitario descrito; ninguna conclusión adicional de integración, rendimiento o calidad clínica.

## Continuación y limitaciones académicas

No se detectaron defectos funcionales en las variantes ejecutadas. Los errores inyectados esperados no son defectos observados del producto. La divergencia histórica entre filtros de informes no fue ensayada aquí y sigue pendiente de CB-03.

Para CB-03: provisionar y autorizar una instancia MySQL aislada sin datos reales; verificar host/puerto/datadir/UUID/versión y esquema/índices efectivos; revisar semillas sintéticas y cuenta restringida. Crear runner focalizado de repositorios reales para A/B, V1/V2/V0/visita anulada, estados de informe y multiplicación por ojos/versiones. Comparar conjuntos exactos y conteos con una tabla independiente. No usar SQLite como equivalencia ni ejecutar arneses masivos/DDL sobre la instancia habitual.

La ampliación física de CB-05 requiere sesiones MySQL independientes para comprobar residuos tras fallo y persistencia tras acuse perdido; una llamada a rollback simulada no la demuestra. CN-05 exige imagen sintética apta e inferencia real, sin presentar estos mocks como evidencia de clasificación clínica. Las cinco CN y CB-03 siguen pendientes, no aprobadas por estas suites.


<!-- CODN-CB03-START -->
# CB-03 — Filtrado y asociación interna de informes (preparación posterior)

## Identificación

- RUN-ID nuevo: **20261103T172031Z-cb03-a3c5f7f4**; Git `7e2440d4775ab8af0918c435390bfa312b162b13`.
- Estado actual: **BLOQUEADO** por falta de instancia MySQL exclusiva identificada y autorizada.
- Objetivo: verificar filtrado, vigencia, asociaciones, conteos, agrupación, vacíos y NotFound en repositorios SQL reales.
- Tipo previsto: integración de caja blanca SQLAlchemy/MySQL 8.0, sin mocks de repositorios.
- Funciones: `InformeRepository.obtener_informes_por_visita`, `validar_visita`, `obtener_informe_por_id`, `_to_dict`; `PatientRepository.obtener_diagnosticos_paciente` y `_extract_report_conclusion` (serialización/fallback necesarios para comprobar resultados).

## Diseño

- Precondiciones pendientes: UUID/host/puerto/datadir/esquema/cuenta de instancia exclusiva, DDL compatible saneado, autorización de INSERT, tablas vacías InnoDB y cuenta SELECT/INSERT.
- [Diez escenarios y aserciones previas](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/matriz-escenarios.md); [oráculo simbólico independiente](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/fixtures-esperados.json).
- A/B, V1/V2/V0/VB y VA anulada; I inactivo/VI y E sin visitas; 8 informes/9 versiones, 2 ojos y diagnóstico con ID distinto de visita. 40 filas sintéticas previstas; **ninguna insertada**.
- Esperados derivados de matriz previa, con diferencia de filtros explícita: lista por visita aplica ACTIVO de informe; detalle exige también visita no anulada y paciente activo; historial excluye visita anulada. Esto caracteriza contratos distintos; no aprueba una regla uniforme no acordada.
- Guardas: configuración explícita sin `.env`, identidad local/remota fijada, revalidación antes de cada INSERT, commits/DDL/UPDATE/DELETE prohibidos; rollback y comprobación independiente de conteos previstos.

## Ejecución

- Archivo implementado: [`test_codn_cb03_report_queries.py`](../../../backend/test_codn_cb03_report_queries.py), 10 métodos. [Runner](../../../backend/codn_run_cb03_mysql.py) y [utilidad de aislamiento](../../../backend/codn_cb03_mysql.py).
- **Métodos de integración ejecutados: 0; subcasos ejecutados: 0; fallos de aserción de integración: 0; resultado SQL: no obtenido.** No hay aprobación ni omisiones que sustituyan la ejecución.
- Preparación real UTC: 2026-11-03T17:22:24.187340+00:00 → 2026-11-03T17:22:24.595338+00:00 (America/Lima UTC−05).
- Se ejecutaron **12 comprobaciones de infraestructura offline**: sintaxis de tres archivos, rechazo de configuraciones ausentes/no autorizadas/puerto habitual, compilación de SELECT MySQL para cinco entidades reales y descubrimiento de 10 métodos. No son pruebas CB-03 aprobadas.
- También se ejecutó el runner en modo run sin --config para demostrar rechazo previo a conexión: salida 3, 0 métodos/0 conexiones/0 INSERT. Log independiente.
- Comandos desde `backend/`:

```powershell
.\venv\Scripts\python.exe -B -u codn_run_cb03_mysql.py prepare --output "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T172031Z-cb03-a3c5f7f4\CB-03"
.\venv\Scripts\python.exe -B -u codn_run_cb03_mysql.py run --output "D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\docs\tesis\pruebas\evidencias\20261103T172031Z-cb03-a3c5f7f4\CB-03\guarda-sin-config"
```

- Código de salida de ambos: **3**, diseñado para estado bloqueado; proceso de preparación correcto, integración no ejecutada. No es código 0 de aprobación de CB-03.
- Versiones por metadatos: Python 3.12.10; Flask 3.1.3; Flask-SQLAlchemy 3.1.1; SQLAlchemy 2.0.30; PyMySQL 1.1.2. Sin instalaciones nuevas.
- Inventario nativo: listeners observados solo 3306/33060, sin prueba de aislamiento. No se consultó su DB, UUID, datadir, permisos, esquema o registros. La versión del archivo mysqld es 8.0.46.0, distinta de verificar versión de servidor en ejecución.

## Evidencias

- [Preparación íntegra](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/preparacion-02.log), [salida](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/exit-preparacion-02.txt), [JSON real](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/resultado.json), [rechazo sin configuración](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/guarda-sin-config/rechazo.log).
- [Inventario de procesos/puertos](evidencias/20261103T172031Z-cb03-a3c5f7f4/inventario-entorno.json), [HTML del estado real](evidencias/20261103T172031Z-cb03-a3c5f7f4/CB-03/reporte.html), fuentes numeradas y copias de suite/utilidades en la carpeta del caso.
- [Procedimiento de provisionamiento y autorización](PROCEDIMIENTO_CB03_MYSQL_AISLADO.md), [destino propuesto inactivo](CB03_DESTINO_PROPUESTO.example.json).
- [Hashes de esta corrida](evidencias/20261103T172031Z-cb03-a3c5f7f4/SHA256SUMS.txt). El informe anterior se conserva byte por byte en `INFORME_ANTES_CB03.md`; su SHA-256 es `66BC67381C8E00164A402DDC385FD3398C148729D8127EFB19D3A167D4EBE025`.
- PNG: **PENDIENTE**. Capturar el reporte después de ejecución real; ninguna imagen fabricada. Las restricciones del control de navegador de la intervención anterior no se eludieron.
- Cobertura: **no obtenida**. El runner contiene instrumentación trace para una ejecución futura; compilar/discover no ejecuta las consultas ni genera porcentaje válido de CB-03.

## Análisis

- Hallazgo estático confirmado por lectura: el listado por visita no filtra visita anulada/paciente inactivo, mientras el detalle sí lo hace; el historial tiene sus propios filtros. No es un hallazgo experimental nuevo ni un fallo declarado contra una política uniforme aprobada. S06/S09 lo comprobarán realmente cuando exista entorno.
- No se acreditó compatibilidad del esquema instalado, atomicidad, ausencia de datos reales en una instancia ni resultados de consultas. No se leyó `.env`, SQL maestro, dumps ni contenido clínico.
- Las condiciones de la petición obligan a detenerse antes de escribir fixtures sin destino aislado autorizado. La propuesta concreta inicializa y arranca solo un datadir nuevo; UUID y operaciones de esquema/fixtures deben presentarse y aprobarse después.
- **Conclusión: BLOQUEADO; diez escenarios implementados pero ninguno ejecutado contra MySQL.** Se conservan sin cambios los resultados históricos CB-01/02/04/05 (41 métodos/175 subcasos). Las cinco CN continúan pendientes.
<!-- CODN-CB03-END -->


<!-- CODN-CB03-INIT-20261103 -->
## Actualización posterior: inicialización aislada de CB-03

RUN-ID `20261103T173514Z-cb03-init-834c725e`: datadir autorizado inicializado (salida 0); MySQL 8.0.46 llegó a escuchar en 127.0.0.1:33363. La primera conexión administrativa falló; se detuvo el proceso propio y se confirmó puerto cerrado. UUID local auto.cnf `eee45878-d7ac-11f1-bc4f-107c616721bd`; identidad SQL y credenciales seguras pendientes. No hubo SQL funcional ni fixtures. **CB-03 continúa BLOQUEADA.**

El conflicto se documenta en [Informe de preparación MySQL](INFORME_PREPARACION_MYSQL_CB03.md), con logs, PID real/lanzador y recuperación propuesta sin reinicializar. No se modifica ninguno de los resultados anteriores.


<!-- CODN-CB03-SECOND-START-STATUS -->
## Actualización: segundo arranque MySQL de CB-03

RUN `20261103T175540Z-cb03-start2-06e60db0`: configuración autorizada validada (salida 0), proceso 9380 arrancado sin reinicializar. Conexión administrativa rechazada con error MySQL 1130; proceso detenido y puerto 33363 cerrado. Identidad SQL y credenciales pendientes; ningún SQL funcional ni ejecución de integración. **CB-03 continúa BLOQUEADA.** Ver [informe de preparación actualizado](INFORME_PREPARACION_MYSQL_CB03.md). Los resultados históricos no cambian.
