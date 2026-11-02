# 74 — Casos MySQL preparados, NO ejecutados

Son especificaciones de integración reproducibles, no resultados ni un arnés
ejecutable autorizado. No se conectó a MySQL ni se arrancó una instancia. Los
arneses B1 existentes y sus ensayos históricos no conceden autorización para este
incremento. Datos ficticios por sí solos no acreditan aislamiento.

## Condiciones previas obligatorias

1. Autorización expresa que identifique instancia/esquema desechables y alcance
   de escrituras, instalación y limpieza. Sin ella detenerse, incluso en localhost.
2. Verificar instancia/UUID/puerto/datadir/socket distintos de habitual, cuenta
   limitada al esquema autorizado, red sin acceso a habitual, sin credenciales
   habituales ni fallback a `.env`. No imprimir credenciales.
3. Raíces sintéticas para fotografías y copias privadas, separadas y sin enlaces
   hacia recursos habituales. Para probar la función real `storage_root`, usar una
   copia desechable de los fuentes con su propia `uploads/retinas` y cwd backend,
   no configurar una raíz que la validación real rechazaría ni desactivar esa
   validación para afirmar una prueba de despliegue.
4. Inspeccionar DDL autorizado: MySQL >=8.0.16, InnoDB, tipos y signo de PK/FK,
   índices, unicidad visita/diagnóstico y diagnóstico/ojo, IDs no reutilizables,
   CHECK/FK entrantes, triggers y permisos de inspección entre esquemas.
5. Instalar exclusivamente en ese esquema la propuesta 72 revisada/adaptada. No
   usar `create_all` como sustituto de validar la migración y las tablas clínicas.
   Flags True solo en aplicaciones Flask de prueba. Nunca importar `app.py` ni
   cargar CLIP/ResNet50; reutilizar el predictor sintético de DiscardTest.
6. Dos procesos/conexiones independientes, isolation REPEATABLE READ y UTC,
   identificadores de conexión registrados. Coordinación por eventos/barriers,
   no por asumir que un sleep implica que el lock ya fue adquirido. Tiempos límite
   y captura de deadlocks/rollbacks sin reintento automático de POST.

## Diseño de ejecución común

Cada caso usa visita V, padre D y detalles A=OD/B=OI nuevos y propios. Guardar
snapshot de todas las columnas de los recursos que deben conservarse, hashes de
archivos sintéticos y revisión inicial R. La conexión observadora verifica el
estado FINAL después de terminar ambas transacciones, no desde un snapshot viejo.

Para cada carrera ensayar ambos órdenes de commit. Inyectar pausa después de
adquirir el primer lock relevante y antes del commit; el segundo proceso debe
iniciar su operación real mientras el primero mantiene el lock. No simular locks
con mocks ni cambiar `with_for_update` por un lock Python para acreditarlos.

| Caso | Intercalado y aserciones finales |
| --- | --- |
| M01 Validación/descarte | P1 valida B y pausa con lock de diagnóstico; P2 descarta B. Tras commit P1, P2 rechaza y B conserva validador/fecha/grado/comentario/motivo. Orden inverso: descarte primero, PUT antiguo de B termina 404 y no toca B2 posterior. |
| M02 Inferencia anterior | Predictor sintético de P1 pausa DESPUÉS de capturar R y liberar la transacción. P2 descarta y confirma R+1. Reanudar P1: 409 INFERENCIA_OBSOLETA, sin detalle ni JPEG publicado referenciado. Una solicitud nueva captura R+1 y sí puede insertar en V, sin nueva visita. |
| M03 Otro ojo | Inicialmente solo A. P1 incorpora B con predictor sintético; P2 descarta A. Si B confirma primero, resultado de descarte conserva B y padre PROCESADO. Si descarte confirma antes, la inferencia capturada en R no persiste. Nunca eliminar B por su ojo. |
| M04 Idempotencia | Dos POST con mismo UUID/autor/payload sobre B: un DELETE, una operación y un incremento; ambos resultados idénticos. UUID distintos sobre B: solo uno confirma. UUID reutilizado con IDs distintos: OPERACION_REUTILIZADA sin tocar B2. |
| M05 Creación de informe | Formulario captura R. Informe obtiene lock V e inserta antes de descarte: descarte rechaza por INFORMES_EXISTENTES. Si descarte confirma primero, informe R recibe CONTEXTO_INFORME_OBSOLETO y no crea informe/versión. La comparación y el INSERT deben compartir transacción hasta commit. |
| M06 Solicitud antigua | Descartar B con U, crear B2 con inferencia nueva; repetir U y enviar otro UUID con IDs de B (también probar revisión actual): ninguno elimina B2. Repetir después de eliminar padre vacío y crear D2 en la misma V. |
| M07 Pérdida de respuesta/recarga | Interrumpir transporte después de commit y con petición todavía bloqueada; recuperar U desde el mecanismo futuro aprobado. NO_CONFIRMADA/404 no habilita nueva escritura. Confirmación solo se adopta en actor/V/IDs correctos; otra sesión/contexto no recibe limpieza local. Actualmente BLOQUEADO por recuperación frontend no implementada. |
| M08 Limpieza | Commit de descarte deja manifiesto PENDIENTE sin borrar JPEG. Caída tras unlink y antes de commit de limpieza: reintento completa por ausencia. Archivo reemplazado, symlink/hardlink o nueva referencia conservan archivo; comprobar copia privada intacta. Repetir sobre el filesystem real del despliegue aislado. |

## Instalación y reversión por ensayar

- Instalación limpia y repetida: la segunda falla explícitamente, no oculta una
  tabla incompatible con `IF NOT EXISTS`. Las FK clínicas deben existir antes.
- Una instalación parcial (primera tabla creada, segunda fallida) mantiene flags
  apagados; no afirmar atomicidad del DDL MySQL ni ejecutar DROP compensatorio.
- Función apagada con ambas tablas ausentes: inferencia/Informes habituales no
  consultan la extensión. Habilitada con esquema incompleto: fallo cerrado.
- Corte coordinado de todos los escritores, drenaje y cambio de flags solo en
  despliegue aprobado; revertir deteniendo escrituras, preservando manifiestos,
  sin recrear diagnósticos descartados ni purgar identidades idempotentes.

**Estado:** pendientes autorización, entorno inequívoco, DDL e implementación del
arnés multiproceso con estas barreras. Ningún resultado SQLite sustituye M01–M08.
