# 79 — Corrección de fotografías en MySQL de desarrollo

## Resultado y alcance

Estructura instalada y **12 comprobaciones funcionales aprobadas sobre MySQL
real**, con JWT/B1, rutas, servicios y repositorios reales. Solo validación de
imágenes/predictor/PDF se sustituyeron en el proceso de pruebas: no se cargaron
ResNet50/CLIP ni se ejecutó inferencia real. No se desarrolló ni reutilizó el
arnés experimental 76–78F, ni se creó un framework nuevo de pruebas.

**La activación en los servidores actuales queda manual por decisión expresa del
responsable.** Hay servicios en 5000 y 8080; no se detuvieron ni duplicaron.
Las compuertas se activaron únicamente en el proceso Python de comprobación,
sin servidor HTTP nuevo; ese proceso ya terminó. La revisión visual sigue pendiente.

## 1. Respaldo e identificación

Destino confirmado desde la configuración local y mediante consulta de solo lectura:

- `localhost:3306`, base `centro_oftalmologico_db_v2`, MySQL **8.0.46**, InnoDB.
- UUID servidor: `1b48ef4a-4e14-11f1-acd7-107c616721bd`.
- Es la base habitual local de desarrollo con datos ficticios autorizada en 79,
  no la instancia desechable. No se detectó configuración declarada de producción;
  la clasificación de los datos como ficticios procede de la confirmación del responsable.

Respaldo NUEVO, fuera del repositorio, uploads y directorios de limpieza:

```text
D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\respaldos-codn\79_20261102T064147Z_6a24721e
```

- `centro_oftalmologico_db_v2.sql`: **71 324 bytes**, 16 tablas, 164 filas.
- `fotografias-retinas.zip`: **349 archivos** de uploads/retinas.
- `verificacion-respaldo.json`: comprobaciones, conteos y hashes privados.
- `79_resultados-funcionales.json`: resumen de los casos e IDs nuevos.

`mysqldump` terminó con código 0, snapshot transaccional InnoDB, estructura y datos,
incluidos metadatos de rutinas/eventos/triggers. Se verificaron cabecera/final de
dump, las 16 sentencias CREATE TABLE y cantidad de INSERT de cada tabla contra
conteos iguales antes/después. ZIP: CRC y SHA-256 de cada archivo contrastados con
los originales. Directorio de respaldo con ACL privada; configuración temporal
de cliente eliminada. No se imprimieron credenciales ni se sobrescribió otro respaldo.

SHA-256 SQL: `2a447f3444b16c5c3f1d62261af121e6eb3b90ef366e7ca9f44cd35fa570947e`.
SHA-256 ZIP: `f1b8feec58381b3d0a34e50c66266622c55761b703a49a2d905a8243fc914d19`.

Es un dump SQL estándar con estructura/datos comprobados. **No se ensayó una
restauración** ni se restauró sobre desarrollo; no se afirma una restauración
práctica acreditada. Conservar estos archivos privados: el dump contiene datos de
cuentas. Una restauración futura requiere decisión separada para no sobrescribir
cambios posteriores. No usar el SQL maestro ni restaurar automáticamente.

## 2. Estructura y autorización B1

Las dos tablas técnicas no existían. Los tipos reales coincidían con la propuesta:
`visitas_clinicas.id BIGINT UNSIGNED` y `usuarios.id INT UNSIGNED`.

Se encontró una incompatibilidad real: la FK detalle → diagnóstico tenía
`ON DELETE CASCADE`. Se detuvieron las escrituras hasta obtener autorización
adicional expresa del responsable para cambiar únicamente esa acción a RESTRICT,
conservando ON UPDATE CASCADE y las filas.

El primer ALTER fue rechazado con **1826**, al reutilizar el nombre de la FK en la
misma sentencia. Una lectura confirmó que no cambió nada. Se realizó después la
sustitución **atómica**, con nombre `fk_detalle_retinopatia_diagnostico_restrict`,
sin ventana entre DROP y ADD ni desactivar foreign_key_checks. No hay otro borrado
de diagnósticos en los servicios/repositorios normales; el ORM ya conserva su
relación delete-orphan, que no se modificó. SQL aplicado registrado en
`backend/migrations/79_descarte_fk_desarrollo.sql`; no volver a ejecutarlo.

Después se aplicaron únicamente los dos CREATE TABLE de
`backend/migrations/72_descarte_ia_propuesta.sql`:

- `diagnostico_ia_revision_visita`.
- `diagnostico_ia_descarte_operaciones`.

Comprobados InnoDB, FK RESTRICT, CHECK ENFORCED, UUID ASCII/binario y microsegundos.
Las PK, índices y defaults corresponden al DDL aplicado, sin IF NOT EXISTS ni
alteraciones de columnas clínicas. Los conteos originales permanecieron iguales
tras el cambio de FK y la instalación. Las tablas se ejercitaron en los casos reales.
La comprobación final consultó también los índices nativos: PK de ambas tablas e
índices de visita/estado presentes; las **cinco operaciones** creadas en las pruebas
quedaron con limpieza **COMPLETADA**.

Faltaba `diagnostico_retinopatia.descartar_pendiente`. Se creó ese único permiso y
su grant a OFTALMOLOGO. Antes de concederlo se verificó bajo bloqueo que el rol
solo tenía **el usuario de prueba ID 2**, activo; **ninguna otra cuenta actual**
recibió privilegios. Se conservó el motor B1 y el rechazo del administrador.
Es un grant del rol, no una ACL personal: futuros usuarios asignados a ese rol
heredarán el permiso; las compuertas siguen siendo obligatorias.

## 3. Compuertas y dependencias

| Configuración | Estado de los servidores actuales | Proceso de pruebas ya terminado |
| --- | --- | --- |
| VITE_DIAGNOSIS_DISCARD_ENABLED | Sin valor en modo development; false efectivo | Tests frontend con mocks de capacidad |
| DIAGNOSIS_DISCARD_ENABLED | Default de app.py sigue false; no se cambió el proceso activo | true; también se probó false |
| DIAGNOSIS_DISCARD_SCHEMA_VERIFIED | Default false, sin modificar | true después de verificar estructura real |
| DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY | Default false, sin modificar | true; contrato frontend/backend verificado por tests |

No se cambió `.env`, producción ni el hardcoded opt-in seguro de `app.py`.
Además de las cuatro flags, es indispensable configurar en el proceso de desarrollo:
`DIAGNOSIS_DISCARD_STORAGE_ROOT=<backend absoluto>\uploads\retinas`. El escritor,
lector y limpiador deben coincidir; el código rechaza otra raíz. Se verificó su
funcionamiento con los archivos nuevos y la eliminación por identidad en Windows.

Informes conserva la captura y el envío de `revision_inferencia_esperada`; backend
comprueba la revisión con el bloqueo de visita y el guardado transaccional. No se
alteraron informes previos, ni la recuperación 75: UUID en la misma pestaña,
consulta de estado y bloqueo conservador mientras no haya conciliación.

## 4. Casos funcionales comprobados

Paciente ficticio nuevo **21**, nombre identificable **PRUEBA79 CORRECCION
FOTOGRAFIAS**, especialista de prueba **2**. Se conservaron los fixtures para la
revisión manual; no se borraron pacientes/visitas previos ni se restauró la base.

| Caso | Visita | Resultado MySQL |
| --- | ---: | --- |
| A, OD/OI y descarte solo OI | 15 | OD intacto en todas sus columnas/bytes, misma visita; limpieza de OI y nueva inferencia simulada OI con ID nuevo. |
| B, OD APROBADO/OI pendiente | 16 | Descarte OI, OD médico íntegro. Descarte de OD rechazado con RESULTADO_VALIDADO. |
| B, OD CORREGIDO/OI pendiente | 17 | Ídem, conservando también motivo/comentario/validador/fechas. CORREGIDO rechazado. |
| C, ambos pendientes | 18 | Eliminados detalles y padre vacío, visita intacta; recreados ambos ojos en la misma visita. |
| D, informe registrado | 19 | INFORMES_EXISTENTES; ambos detalles intactos. |
| D, retinógrafo consumido | 20 | COMPROBANTE_VINCULADO en lote mixto; ambos intactos, sin tocar copias privadas. Asociación sintética de prueba, no prueba de exportación real. |
| D, B1 | 19 | Administrador sin autorización clínica: 403, sin alteraciones. |
| E, estados de operación | 21 | NO_CONFIRMADA y CONFIRMADA desde endpoints reales, sin reenviar operaciones inciertas. |
| Modo apagado | 21 | Descarte denegado; se pudo incorporar el ojo ausente por el flujo normal, con predictor simulado. |

Son **12 comprobaciones** contando las dos validaciones/rechazos por separado y la
comprobación final de conservación. No son doce carreras ni pruebas visuales.
Después se contrastó que todas las filas anteriores a los fixtures siguen
idénticas y que los 349 archivos respaldados conservan sus SHA-256.

La limpieza física se ejecutó explícitamente con `clean_operation` solo para UUID
CONFIRMADOS generados aquí; se comprobó COMPLETADA y ausencia de sus JPEG/Grad-CAM.
**La UI actual no ejecuta automáticamente esa tarea de mantenimiento:** el POST
confirma el descarte lógico y deja un manifiesto PENDIENTE. No confundir regreso
al Paso 2 con eliminación física ya completada. El comando explícito está abajo.
No se cambió ese contrato ni se agregó un sistema de tareas nuevo.

## 5. Pruebas automatizadas y build

Desde `backend`:

```powershell
.\venv\Scripts\python.exe -B -m unittest test_diagnosis_discard test_discard_integration74 -v
```

**49/49 aprobadas**: OD/OI, validaciones, visita, B1, rollback, incertidumbre,
retinógrafo, archivos, contrato HTTP y compatibilidad apagada. SQLite en memoria,
no equivalente a las pruebas MySQL arriba. Mensajes de commit incierto son parte
de los casos simulados esperados, no fallos del ensayo real.

Desde `frontend`:

```powershell
npx vitest run src/test/diagnosisCorrection.test.tsx src/test/diagnosisDiscardContract74.test.ts src/test/diagnosisRecovery75.test.tsx
npx vitest run src/test/reportsInferenceRevision.test.tsx src/test/diagnosisReload74.test.tsx src/test/diagnosisNavigation.test.tsx src/test/diagnosisClinicalIntegrity.test.tsx
npm run build
```

**135/135 tests frontend aprobados**, incluidos 39 de recuperación 75 y 12 de
revisión de Informes. TypeScript (`tsc -b`) y Vite build aprobados. Solo avisos
de React Router, deprecación datetime.utcnow y chunk >500 kB, observados sin cambios
de código funcional en este incremento; no errores nuevos. No se repitió el arnés
MySQL experimental ni todas las carreras de incrementos anteriores.

## 6. Activación manual solo en desarrollo (elección del responsable)

No hay navegador automatizado seguro disponible en esta sesión. No se verificaron
visualmente responsive, foco o teclado. Para hacerlo:

1. Cerrar API 5000 y Vite 8080 desde sus terminales. **No parar MySQL**. No iniciar
   otra copia mientras sigan ocupados. El PID de la API no permitió identificar
   con seguridad su origen desde esta sesión; por eso no se terminó a la fuerza.
2. En `backend`, con el mismo Python/entorno ML que usa normalmente para `app.py`,
   ejecutar este comando explícito de desarrollo. No altera `.env` ni producción:

```powershell
python -B -c "import os; os.environ['FRONTEND_ORIGIN']='http://localhost:8080,http://127.0.0.1:8080'; from pathlib import Path; from app import app; app.config.update(DIAGNOSIS_DISCARD_ENABLED=True, DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=True, DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=True, DIAGNOSIS_DISCARD_STORAGE_ROOT=str(Path.cwd()/'uploads'/'retinas')); app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)"
```

3. En otra terminal, desde `frontend`:

```powershell
$env:VITE_DIAGNOSIS_DISCARD_ENABLED='true'
npm run dev -- --host 127.0.0.1 --strictPort
```

El valor solo afecta esa terminal/proceso. Al terminar, cerrar esa terminal o
ejecutar `Remove-Item Env:VITE_DIAGNOSIS_DISCARD_ENABLED`. No usar esa configuración
para construir/desplegar producción. Para apagar backend, cerrarlo y arrancar
normalmente `app.py`; sus tres defaults siguen false.

4. Abrir `http://localhost:8080`, cerrar una sesión anterior e iniciar sesión con
   la cuenta conocida del usuario 2 OFTALMOLOGO para refrescar sus permisos,
   buscar paciente PRUEBA79 (ID 21) y adoptar visita **15**.
5. En Paso 3, comprobar botón, paciente/visita/ojos y confirmación explícita.
   Seleccionar solo OI, confirmar, verificar vuelta al Paso 2, OD conservado y
   visita 15. Cargar otra fotografía ficticia correcta y analizar OI. Esta inferencia
   real es manual y no se ejecutó aquí; las imágenes de los fixtures automatizados
   son JPEG de color, no retinas aptas para los validadores reales.
6. Para ambos ojos usar visita **18**. No usar diagnósticos previos ni cambiar los
   fixtures con informe/retinógrafo salvo para comprobar el rechazo. Visitas **16**
   y **17** conservan OD validado y tienen OI libre para una carga manual nueva.
7. Comprobar Tab/Shift+Tab, Space en casillas, Esc/cancelación, foco y viewport
   estrecho; nunca deben poder seleccionarse resultados bloqueados. Confirmación
   desmarcada o selección vacía debe impedir el envío.
8. Recuperación de incertidumbre/recarga se verificó con mocks, no en navegador real.
   No provocar fallos de MySQL. Si ocurre una incertidumbre genuina: misma pestaña,
   conservar UUID/sessionStorage y consultar estado; no reenviar POST ni borrar el
   bloqueo para forzar el análisis. NO_CONFIRMADA no es fracaso terminal.

### Limpieza física explícita de UNA corrección de estas pruebas

Después de comprobar por GET que un UUID de una operación del paciente 21 está
CONFIRMADO, se puede ejecutar el CLI existente desde `backend`, con las mismas
compuertas solo en ese proceso (sustituir el placeholder por ESE UUID):

```powershell
python -B -c "from pathlib import Path; from app import app; app.config.update(DIAGNOSIS_DISCARD_ENABLED=True, DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=True, DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=True, DIAGNOSIS_DISCARD_STORAGE_ROOT=str(Path.cwd()/'uploads'/'retinas')); app.app_context().push(); app.cli.main(args=['diagnosis_discard','limpiar','--operacion-id','<UUID_CONFIRMADO_DE_PRUEBA79>','--confirmar'])"
```

Nunca ejecutar por patrones, recorrer tareas antiguas ni limpiar una operación de
otra visita/paciente. Si devuelve conflicto/pendiente, conservar los archivos y
revisar esa tarea, sin borrado manual global ni restauración de toda la base.

## 7. Cambios y límites restantes

Archivos añadidos: este informe y `migrations/79_descarte_fk_desarrollo.sql`.
Cambios SQL: acción/nombre de una FK autorizada, dos tablas técnicas, un permiso y
un grant para el único oftalmólogo existente, más los fixtures nuevos descritos.
No se modificaron código clínico/frontend, B1, `.env`, modelos DL, copias privadas,
configuración de producción ni fotografías previas. Sin commits/push.

Pendientes: reinicio/activación manual elegido por el responsable, revisión UI
real y, opcionalmente, inferencia real manual con retinas ficticias apropiadas.
La eliminación física requiere el mantenimiento explícito descrito; no se acredita
borrado inmediato automático desde UI. No se probaron todas las carreras InnoDB ni
se hizo un ensayo de restauración. **Sí puede avanzar a la revisión funcional
visual de desarrollo con estos límites; no se afirma activación global.**
