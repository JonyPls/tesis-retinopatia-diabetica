# 83 — 503 tras reconstruir MySQL de desarrollo

## Causa acreditada

El frontend mostraba «La validación de imagen no está disponible» ante **cualquier
503** de `POST /api/diagnosticar`, sin distinguir el código del backend. La vista
previa es local y no acredita la validación ni la persistencia.

La ruta conserva autenticación y autorización B1. En `procesar_diagnostico`, el
preflight clínico y `DiagnosisDiscardRepository.capture_inference` preceden a los
validadores: formato/dimensiones → región circular → CLIP. Solo después se ejecutan
ResNet50/Grad-CAM y la persistencia transaccional.

En la base local `centro_oftalmologico_db_v2` (MySQL 8.0.46), las consultas de solo
lectura comprobaron:

| Prerrequisito instalado en 79 | Estado tras reconstrucción |
| --- | --- |
| `diagnostico_ia_revision_visita` | Ausente |
| `diagnostico_ia_descarte_operaciones` | Ausente |
| FK detalle → diagnóstico | `fk_detalle_retinopatia_diagnostico`, DELETE CASCADE / UPDATE CASCADE |
| `diagnostico_retinopatia.descartar_pendiente` | Ausente; ningún grant efectivo |
| `diagnostico_retinopatia.crear` | Activo; un usuario activo con grant efectivo |
| Rol `OFTALMOLOGO` | Activo |

Los tipos siguen siendo `visitas_clinicas.id BIGINT UNSIGNED`, `usuarios.id INT
UNSIGNED` y `diagnosticos_retinopatia_detalle.diagnostico_retinopatia_id BIGINT
UNSIGNED`. No se consultaron ni divulgaron pacientes, credenciales o fotografías.

El proceso activo usa el Python de `backend/venv` y `run_local.py`. El arranque
anterior fijaba las tres compuertas a true sin volver a comprobar la instalación.
La consulta de revisión ausente produjo **PyMySQL ProgrammingError 1146**; el gate
la traduce a **503 / `DESCARTE_NO_INSTALADO`**, antes de llegar a CLIP. Esa traducción
se reprodujo en un contexto Flask aislado de solo lectura, sin importar `app.py`,
servir HTTP ni ejecutar inferencia. El SQL original reconstruye lo que contiene;
no conserva las adiciones posteriores de 79 ni el cambio de FK.

## Validador y entorno

CLIP se inicializa en `app.py` mediante `_get_clip()`, también usado perezosamente
por `validar_contenido_semantico`. Emplea el identificador
`openai/clip-vit-base-patch32` y la caché de Hugging Face, no MySQL ni una ruta
relativa a la fotografía. El arranque local y `app.py` usan el mismo validador;
normalizar cwd no cambia ese identificador.

Si falla la carga de modelo/procesador o su ejecución, el validador devuelve 503;
el servicio ahora lo identifica con `VALIDADOR_IMAGEN_NO_DISPONIBLE`. Las capturas
actuales del validador no exponen la excepción interna al cliente. No se dispone
del traceback de la petición histórica; no se atribuye una excepción CLIP sin
evidencia.

Las versiones instaladas de torch 2.3.0, torchvision 0.18.0, transformers 4.44.2,
OpenCV 4.9.0.80, numpy 1.26.4, Pillow 10.3.0, Flask-SQLAlchemy 3.1.1 y PyMySQL
1.1.2 coinciden con requirements. La caché local contiene configuración,
procesador, tokenizer y `pytorch_model.bin`. Esto acredita presencia, **no una
ejecución correcta de CLIP**. No se descargaron ni cargaron modelos para este
diagnóstico y no se ejecutó inferencia real.

## Corrección aplicada

- `run_local.py`: chequeo previo al servidor, solo de lectura, reutilizando
  `require_ready` y `verify_delete_dependencies`, más la comprobación del grant
  activo de descarte a un oftalmólogo activo. Ante tablas/columnas ausentes,
  CASCADE, permisos ausentes o lectura fallida, apaga las tres compuertas y avisa.
  Hace rollback de las lecturas; no crea estructuras ni concede permisos.
- Diagnóstico IA tradicional funciona con la extensión apagada y no consulta sus
  tablas. Se conserva la validación obligatoria y no se altera B1, ResNet50,
  Grad-CAM, Informes ni el selector de visitas.
- El servicio y el frontend distinguen el 503 de esquema del 503 de validador.
  Un 503 desconocido muestra un mensaje genérico, sin exponer el texto interno.

## SQL pendiente: solo para recuperar «Corregir fotografías»

**NO EJECUTADO. Requiere autorización adicional y respaldo vigente.** No hace
falta instalar esta extensión para procesar fotografías por el flujo tradicional.
Los scripts de 72/79 ya existen: no se creó otra migración ni un arnés.

Tras reconfirmar que el esquema sigue igual al descrito, desde el cliente `mysql`
abierto en la raíz del repositorio, la propuesta concreta es:

```sql
USE centro_oftalmologico_db_v2;
-- DDL con commit implícito: no considerar reversible mediante ROLLBACK.
-- Sustituye atómicamente la FK CASCADE por RESTRICT (mantiene UPDATE CASCADE).
SOURCE backend/migrations/79_descarte_fk_desarrollo.sql;
-- Crea únicamente las dos tablas técnicas vacías, con sus PK/FK/CHECK/índices.
SOURCE backend/migrations/72_descarte_ia_propuesta.sql;

-- Permiso nuevo y grant al rol clínico existente; no GRANT de usuario MySQL.
START TRANSACTION;
INSERT INTO permisos (codigo, nombre, descripcion, modulo, estado)
SELECT 'diagnostico_retinopatia.descartar_pendiente',
       'Descartar resultados IA pendientes',
       'Corrección explícita de fotografías con resultado IA pendiente',
       modulo, 'ACTIVO'
FROM permisos WHERE codigo = 'diagnostico_retinopatia.crear';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p
WHERE r.codigo = 'OFTALMOLOGO' AND r.estado = 'ACTIVO'
  AND p.codigo = 'diagnostico_retinopatia.descartar_pendiente';
COMMIT;
```

Es una propuesta de una sola aplicación: no repetir si ya se restauró algo.
El grant alcanza a los miembros actuales y futuros del rol, no solo a una cuenta.
No autoriza al administrador por herencia. Las tablas nuevas no restauran los UUID
ni el historial de operaciones borrados; no reutilizar marcadores de una base
anterior para forzar acceso a IDs recreados. No se borraron marcadores desde código.

## Uso y verificación

Para el flujo normal, el responsable debe reiniciar **una sola vez** su API actual
desde su propia terminal, con `cd backend` y `python run_local.py`, usando el mismo
venv. No ejecutar otra copia mientras el puerto esté ocupado. El nuevo arranque
avisará que el descarte está apagado; eso no deshabilita el validador. Refrescar el
frontend e iniciar sesión de nuevo para leer los permisos actuales. Luego probar
manualmente una retinografía válida en una visita elegible o Nueva visita.

Si se autoriza y aplica el SQL anterior, volver a verificar los prerrequisitos y
reiniciar manualmente la API para habilitar la corrección. Si persistiera un 503,
comprobar en Network su `code`: `VALIDADOR_IMAGEN_NO_DISPONIBLE` sería un incidente
distinto que requiere revisar la consola de CLIP, no volver a migrar MySQL.

Pruebas: 61 backend aprobadas (`test_run_local`, `test_diagnosis_input`,
`test_diagnosis_discard`, `test_discard_integration74`), con modelos simulados,
SQLite en memoria y archivos sintéticos temporales. Incluyen rechazo antes de
CLIP con esquema ausente, persistencia tradicional con extensión apagada y código
de error específico del validador. Frontend: 42 pruebas focalizadas aprobadas en
`b1DiagnosisRecovery.test.tsx`, incluidas las cuatro variantes de 503. TypeScript y
Vite build aprobados; `git diff --check` sin errores de whitespace. El nuevo guard
también se comprobó contra MySQL **solo en lectura**: devolvió false y dejó las
tres flags apagadas. No se reiniciaron servidores, modificaron fotos, ejecutaron
DDL/DML en MySQL, inferencias reales, commits ni push. La prueba manual tras el
reinicio queda a cargo del responsable.
