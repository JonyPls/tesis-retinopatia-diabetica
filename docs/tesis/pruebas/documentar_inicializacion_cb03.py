"""Document the real stopped initialization attempt. Never starts a server."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RUN = json.loads((HERE / 'instancia_cb03_actual.json').read_text(encoding='utf-8-sig'))
OUT = Path(RUN['evidence'])
INSTANCE = Path(RUN['instance_root'])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    attempted = json.loads((OUT / 'inicializacion-arranque.json').read_text(encoding='utf-8'))
    stopped = json.loads((OUT / 'estado-detenido-verificado.json').read_text(encoding='utf-8-sig'))
    assert attempted['initialization_exit_code'] == 0 and attempted['state'] == 'STOPPED_ON_ERROR'
    assert not stopped['new_process_still_present'] and not stopped['target_listeners']
    uuid = re.search(r'^server-uuid=(.+)$', (INSTANCE / 'data/auto.cnf').read_text(encoding='utf-8-sig'), re.M).group(1)
    verified_files = 0
    for runid in ['20261103T160850Z-421d66ca', '20261103T172031Z-cb03-a3c5f7f4']:
        prior = HERE / 'evidencias' / runid
        for line in (prior / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
            if not line or line.startswith('#'):
                continue
            expected, filename = line.split('  ', 1)
            assert sha(prior / filename) == expected, 'Evidencia previa alterada: ' + filename
            verified_files += 1
    final = dict(run_id=RUN['run_id'], datadir_initialized=True, initialization_exit_code=0,
        current_instance_state='STOPPED_VERIFIED', effective_version_from_server_log='8.0.46',
        host='127.0.0.1', port=33363, datadir=str(INSTANCE / 'data'), local_uuid_from_auto_cnf=uuid,
        remote_server_uuid=None, remote_datadir=None, remote_identity_verified=False,
        launcher_pid=9240, actual_server_pid_from_os=18768, server_pid_file_matches_os=True,
        administrative_password_configured=False,
        protected_credential_file_exists=(INSTANCE / 'private/admin-password.dpapi').exists(),
        account_sql_sent=False, functional_sql_sent=False, schema_created=False, fixtures_inserted=False,
        cb03_status='BLOQUEADO', connection_attempt_endpoints=['127.0.0.1:33363'], connections_to_habitual=0,
        target_listeners_after_stop=[], habitual_listeners_after_stop=stopped['habitual_listeners'],
        historical_evidence_hashes_verified=verified_files,
        raw_client_error_number='not captured; original evidence is insufficient to assert exact server error',
        probable_configuration_cause='skip-name-resolve conflicts with root@localhost over 127.0.0.1; documented hypothesis, not remote SQL confirmation')
    (OUT / 'estado-final-consolidado.json').write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding='utf-8')
    report = f'''# CB-03 — Inicialización y arranque de MySQL aislado

RUN-ID: `{RUN['run_id']}`. Fecha: 3 de noviembre de 2026 (America/Lima).

## Resultado real

**Datadir inicializado correctamente; arranque de preparación detenido por un conflicto de configuración/acceso administrativo. Instancia actualmente DETENIDA y CB-03 BLOQUEADA.**

La inicialización terminó con código 0. El servidor MySQL 8.0.46 llegó a indicar “ready for connections” en su log y el sistema operativo registró un listener exclusivo en 127.0.0.1:33363, propiedad del PID 18768. La primera conexión administrativa produjo un error no transitorio antes de ejecutar la consulta de identidad o configurar la contraseña. La utilidad detuvo el lanzador (PID 9240), pero MySQL había creado un proceso hijo. Se verificaron el PID 18768, su padre 9240, su ejecutable, el argumento defaults-file exacto y la propiedad del listener antes de detener únicamente ese hijo. Una observación posterior confirma que no existe ese proceso ni listener en 33363.

No se reintentó el arranque, no se reinicializó y no se eliminó ningún directorio. Los listeners habituales 3306/33060 permanecen bajo el PID 20248. Ninguna conexión se dirigió a ellos; el registro de auditoría del cliente contiene solo 127.0.0.1:33363.

## Identificadores y certeza

| Dato | Resultado | Evidencia / límite |
|---|---|---|
| Host/puerto | 127.0.0.1:33363 | Listener real durante arranque; actualmente cerrado |
| Versión efectiva de servidor | 8.0.46 | Log del proceso; `SELECT @@version` no se completó |
| Datadir inicializado | `{INSTANCE / 'data'}` | Comando de inicialización y configuración del proceso; `@@datadir` pendiente |
| UUID local | `{uuid}` | `auto.cnf` propio; **@@server_uuid todavía no confirmado por SQL** |
| Lanzador / servidor | 9240 / 18768 | Árbol de proceso y archivo PID, no eran el mismo PID |
| Estado actual | DETENIDA | `estado-detenido-verificado.json` |
| Contraseña administrativa segura | NO CONFIGURADA | El fallo ocurrió antes de generarla/guardar DPAPI/ALTER USER; no se deja servidor escuchando |
| Esquema funcional / fixtures | NO EJECUTADOS | No se emitió SQL funcional; solo inicialización interna de MySQL |
| CB-03 | BLOQUEADA | 0 métodos y 0 subcasos de integración nuevos |

## Configuración y privacidad

Se creó únicamente `my-cb03.ini` dentro de la raíz autorizada, con datos/logs/tmp propios, bind 127.0.0.1, puerto 33363, MySQL X apagado, sin binlog/general log/slow log, sin named pipe/shared memory, sin local_infile y secure_file_priv=NULL. No se modificaron configuración global, `.env`, servicios Windows, código funcional ni `.gitignore`.

La raíz tiene ACL restringida al usuario actual y SYSTEM. Se preparó el mecanismo DPAPI para proteger una credencial futura, pero **no se generó ni guardó contraseña en este intento**. No deben describirse como completadas las etapas posteriores a la conexión fallida.

El patrón existente `tmp/` excluye el datadir y sus claves/certificados de Git. `git check-ignore` confirmó la exclusión y `git ls-files` no encontró archivos rastreados bajo la raíz. No se copiaron archivos de datos, claves TLS ni contenido de private a las evidencias; solo configuración sin secretos, logs de arranque y metadatos. No hubo commits ni push.

## Hallazgos de preparación

1. **Configuración elegida por la utilidad:** incluyó `skip-name-resolve`. MySQL documenta que esta opción impide que el acceso inicial por 127.0.0.1 resuelva la cuenta root@localhost. Es la causa probable del rechazo observado. [Manual oficial de inicialización](https://dev.mysql.com/doc/refman/8.0/en/data-directory-initialization.html).
2. **Supervisión de procesos:** MySQL en Windows puede crear un monitor y un proceso servidor; está documentado y explica el PID hijo observado. `--no-monitor` permite evitar ese monitor para este uso desechable. [Manual oficial para Windows](https://dev.mysql.com/doc/refman/8.0/en/windows-installation.html).
3. **Limitación del diagnóstico:** la utilidad no registró el número del error del cliente y solo conservó un mensaje controlado. No se inventa un 1045/1130 ni se afirma confirmación SQL de la causa. La próxima utilidad debe registrar únicamente clase/número del error, sin mensajes o parámetros que contengan secretos.

## Comandos realmente ejecutados

Desde la raíz del repositorio:

```powershell
& .\\backend\\codn_start_cb03_instance.ps1 -InitializeAuthorizedInstance
```

Los argumentos exactos de initialize/start están en `inicializacion-arranque.json`, sin secretos. Inicialización: salida 0. Preparación completa: salida 1, porque no se completó identidad/credenciales. Se conservan scripts ejecutados y configuración exacta en esta carpeta de evidencia.

## Recuperación propuesta — NO EJECUTADA

Se solicita autorización exclusivamente para **reiniciar el mismo datadir ya inicializado**, mismo host/puerto/UUID local, sin repetir initialize ni borrar/reconstruir nada.

Precondiciones: verificar otra vez puerto libre, proceso propio inexistente, UUID local exacto y hash de configuración. Comando de arranque propuesto (sin modificar el archivo ya registrado):

```powershell
& 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe' '--defaults-file={INSTANCE / 'my-cb03.ini'}' --skip-name-resolve=OFF --no-monitor
```

Debe lanzarse oculto mediante la utilidad revisada, redirigiendo stdout/stderr a archivos NUEVOS. Los overrides afectan solo este proceso y archivo local. Verificar PID real desde pid-file y listener; si difieren o fallan identidad/credenciales, detener únicamente el proceso propio comprobado y documentar, sin retry automático.

Conectar únicamente a 127.0.0.1:33363; comprobar versión/UUID/datadir/bind y cuenta local; generar contraseña aleatoria fuerte, protegerla con DPAPI y ACL propia y ejecutar exactamente una operación administrativa `ALTER USER CURRENT_USER() IDENTIFIED BY <secreto en memoria>`. No incluir el secreto en comando, script, log, respuesta o informe. Verificar reconexión con la credencial y rechazo de contraseña vacía; consultar solo metadatos y ausencia de esquema funcional.

No incluye CREATE DATABASE, CREATE USER funcional/de pruebas, CREATE TABLE, GRANT, fixtures, migraciones, DROP ni TRUNCATE. Tras identidad y credenciales confirmadas, detenerse para presentar y obtener autorización del plan de esquema/fixtures. **No ejecutar de nuevo el inicializador original contra este datadir ya existente.**

## Segunda puerta: aún pendiente

El plan definitivo de esquema/índices/FK, scripts create-only revisados y 40 filas sintéticas en 11 tablas continúa pendiente de una instancia verificada por SQL. La matriz de escenarios de CB-03 y el procedimiento previo se conservan. No se solicita ni se presume aprobación de esa etapa en esta recuperación.

## Evidencias y preservación

`antes.json`, `despues.json`, `proceso-hijo.json`, `contencion-final.json` (observación inmediatamente después de Stop-Process), `estado-detenido-verificado.json` (verificación posterior del cierre), `inicializacion-arranque.json`, `estado-final-consolidado.json`, `preparacion.log`, `exit.txt`, `init.err`, `server.err`, configuración y scripts ejecutados. `SHA256SUMS.txt` identifica cada archivo.

Se verificaron {verified_files} hashes de las dos corridas anteriores sin modificaciones. El informe de caja blanca recibe solo una nota posterior; sus resultados históricos se conservan. No hay nuevas pruebas aprobadas, porcentajes de cobertura o capturas de una ejecución inexistente.
'''
    destination = HERE / 'INFORME_PREPARACION_MYSQL_CB03.md'
    destination.write_text(report, encoding='utf-8')
    (OUT / destination.name).write_bytes(destination.read_bytes())
    (OUT / Path(__file__).name).write_bytes(Path(__file__).read_bytes())
    main_report = HERE / 'INFORME_PRUEBAS_CAJA_BLANCA.md'
    old = main_report.read_bytes()
    (OUT / 'INFORME_CAJA_BLANCA_ANTES_INICIALIZACION.md').write_bytes(old)
    note = f'''\n\n<!-- CODN-CB03-INIT-20261103 -->
## Actualización posterior: inicialización aislada de CB-03

RUN-ID `{RUN['run_id']}`: datadir autorizado inicializado (salida 0); MySQL 8.0.46 llegó a escuchar en 127.0.0.1:33363. La primera conexión administrativa falló; se detuvo el proceso propio y se confirmó puerto cerrado. UUID local auto.cnf `{uuid}`; identidad SQL y credenciales seguras pendientes. No hubo SQL funcional ni fixtures. **CB-03 continúa BLOQUEADA.**

El conflicto se documenta en [Informe de preparación MySQL](INFORME_PREPARACION_MYSQL_CB03.md), con logs, PID real/lanzador y recuperación propuesta sin reinicializar. No se modifica ninguno de los resultados anteriores.
'''
    if b'<!-- CODN-CB03-INIT-20261103 -->' not in old:
        main_report.write_bytes(old + note.encode('utf-8'))
    diff = subprocess.run(['git', 'diff', '--exit-code', '--', '.gitignore', 'backend/src', 'backend/services',
        'backend/utils', 'backend/dl_model', 'frontend'], cwd=REPO, capture_output=True)
    assert diff.returncode == 0
    (OUT / 'verificacion-fuentes.txt').write_text('git diff --exit-code -- .gitignore backend/src backend/services backend/utils backend/dl_model frontend\nexit=0\n', encoding='utf-8')
    (OUT / 'git-status-final.txt').write_text(subprocess.check_output(['git', 'status', '--short'], cwd=REPO, text=True), encoding='utf-8')
    manifest = [sha(p) + '  ' + p.relative_to(OUT).as_posix() for p in sorted(OUT.rglob('*'))
                if p.is_file() and p.name != 'SHA256SUMS.txt']
    (OUT / 'SHA256SUMS.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
    print(json.dumps({'report': str(destination), 'instance_state': 'STOPPED_VERIFIED', 'local_uuid': uuid,
        'remote_identity_verified': False, 'cb03_status': 'BLOQUEADO', 'historical_hashes_verified': verified_files,
        'new_evidence_files_hashed': len(manifest)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
