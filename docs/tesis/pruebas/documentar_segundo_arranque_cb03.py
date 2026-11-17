"""Document second-start evidence without restarting MySQL or changing app code."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RUN = json.loads((HERE / 'segundo_arranque_cb03_actual.json').read_text(encoding='utf-8-sig'))
OUT = Path(RUN['evidence'])
INSTANCE = Path(RUN['instance_root'])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    result = json.loads((OUT / 'segundo-arranque.json').read_text(encoding='utf-8'))
    stopped = json.loads((OUT / 'estado-final-detenido.json').read_text(encoding='utf-8-sig'))
    assert result['state'] == 'STOPPED_ON_ERROR' and result['client_error_number'] == 1130
    assert result['configuration_validation_exit_code'] == 0 and not result['initialization_executed']
    assert result['queries'] == [] and not stopped['target_listeners'] and not stopped['process9380_present']
    assert all(e['host'] == '127.0.0.1' and e['port'] == 33363 for e in result['network_events'])
    uuid = re.search(r'^server-uuid=(.+)$', (INSTANCE / 'data/auto.cnf').read_text(), re.M).group(1)
    assert uuid == 'eee45878-d7ac-11f1-bc4f-107c616721bd'
    prior_count = 0
    for runid in ['20261103T160850Z-421d66ca', '20261103T172031Z-cb03-a3c5f7f4', '20261103T173514Z-cb03-init-834c725e']:
        folder = HERE / 'evidencias' / runid
        for line in (folder / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
            if not line or line.startswith('#'):
                continue
            expected, filename = line.split('  ', 1)
            assert sha(folder / filename) == expected, 'Evidencia histórica cambió: ' + filename
            prior_count += 1
    previous = json.loads((OUT / 'fuentes-previas.json').read_text(encoding='utf-8-sig'))
    checks = [{'file': item['file'], 'before': item['sha256'], 'after': sha(REPO / item['file']).upper(),
               'unchanged': sha(REPO / item['file']).upper() == item['sha256']} for item in previous]
    (OUT / 'preservacion-fuentes-previas.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
    final = dict(state='STOPPED_VERIFIED', server_pid=9380, local_uuid=uuid, sql_uuid=None, sql_datadir=None,
        sql_hostname=None, sql_skip_name_resolve=None, remote_identity_verified=False,
        configuration_validation_exit_code=0, preparation_exit_code=1, mysql_client_error_number=1130,
        normal_administrative_connection_completed=False, root_password_changed=False,
        new_password_generated=False, encrypted_password_file_created=False,
        network_endpoints=['127.0.0.1:33363'], connections_to_habitual=0,
        functional_sql_sent=False, new_cb03_methods_executed=0, new_cb03_subcases_executed=0,
        cb03_status='BLOQUEADO', historical_evidence_hashes_verified=prior_count)
    (OUT / 'estado-final-consolidado.json').write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding='utf-8')
    section = f'''

<!-- CODN-CB03-SECOND-START -->
# Segundo arranque autorizado — resultado posterior

RUN-ID: **{RUN['run_id']}**. Ejecución: {result['started_utc']} → {result['ended_utc']} (UTC; America/Lima UTC−05).

**Estado actual: instancia DETENIDA; acceso administrativo no recuperado; identidad SQL sin confirmar; CB-03 BLOQUEADA.**

## Operaciones y resultado real

1. Se comprobó puerto 33363 libre, proceso anterior ausente y presencia de `auto.cnf`, `ibdata1` y directorio `mysql` en el mismo datadir.
2. Se comprobó el UUID local `{uuid}` y el hash del INI original `{result['config_sha256']}`. No se modificó ese archivo.
3. Se validaron los argumentos autorizados `--skip-name-resolve=OFF --no-monitor` con `--validate-config`: **salida 0**. No se llamó initialize/initialize-insecure.
4. Se arrancó un único proceso propio oculto, PID **9380**. El log identifica MySQL **8.0.46**, listo en puerto **33363**; pid-file contiene 9380. Los overrides de log-error y pid-file apuntan a archivos nuevos del mismo directorio aislado.
5. La conexión normal PyMySQL, sin contraseña inicial por corresponder a initialize-insecure, devolvió **OperationalError 1130**. El servidor rechazó el acceso antes de autenticar y ejecutar la primera consulta. No se cambió la credencial ni se ejecutó ALTER USER.
6. Se detuvo el mismo proceso propio. La observación posterior `{stopped['checked_utc']}` confirma PID 9380 ausente y ningún listener en 33363. No hubo otro intento.

El error 1130 corresponde al rechazo del host cliente en el control de conexión, según el [manual oficial de MySQL](https://dev.mysql.com/doc/refman/8.0/en/problems-connecting.html). No se ha determinado por SQL qué cuenta/Host contiene la instancia. No se interpreta como contraseña incorrecta ni se atribuye una causa definitiva al DNS o a una tabla dañada.

La hipótesis de que bastaba desactivar skip-name-resolve **no quedó confirmada**. El segundo intento conserva ese override explícito y el rechazo persiste. El número exacto del error de este intento sí quedó registrado, sin texto de excepción que pudiera contener secretos. Los parámetros se validaron; `@@skip_name_resolve` no llegó a consultarse, por lo que no se presenta como valor SQL verificado.

## Verificación obligatoria: estado por requisito

| Comprobación | Resultado real |
|---|---|
| `@@server_uuid` | PENDIENTE; solo UUID local auto.cnf comprobado |
| `@@datadir` | PENDIENTE; ruta del INI/comando cotejada localmente |
| `@@port` | PENDIENTE por SQL; log del servidor registra 33363 |
| `@@version` | PENDIENTE por SQL; log registra 8.0.46 |
| `@@hostname` | PENDIENTE |
| `@@skip_name_resolve` | PENDIENTE; override OFF aceptado en validación |
| PID | 9380, coincide con pid-file; actualmente terminado |
| Listener final | Ninguno en 33363 |
| Contraseña administrativa configurada/validada | NO: la conexión inicial falló antes de generarla |
| Acceso sin contraseña rechazado tras configurar contraseña | NO EVALUADO; no se configuró contraseña |
| Tablas funcionales vía metadatos SQL | PENDIENTE de consulta; no se emitió SQL funcional |
| Instancia habitual | Sin conexiones del cliente a 3306/33060; sus listeners siguen en PID 20248 |
| Esquema/fixtures/CB-03 | NO EJECUTADOS |

## Credenciales, archivos y cambios previos

La utilidad corrigió el destino previsto de credenciales: DPAPI bajo ACL privada en una carpeta temporal de Windows **fuera del repositorio**. Esa etapa no llegó a ejecutarse: no se generó ni guardó contraseña, y no se copió ningún archivo cifrado o secreto a evidencias.

No se usaron credenciales habituales, `.env`, skip-grant-tables, SQL maestro, migraciones, DROP/TRUNCATE ni servicios Windows. No se creó esquema ni tablas/usuarios funcionales ni fixtures; no hubo escrituras SQL administrativas. El patrón existente tmp/ sigue excluyendo los datos; `.gitignore` no se modificó. No se hicieron commits ni push.

Al comenzar ya existían cambios locales del usuario en diagnóstico y sus pruebas. Se registraron sus hashes y no se modificaron por estas utilidades. El detalle comparativo está en `preservacion-fuentes-previas.json`; cualquier diferencia concurrente debe interpretarse con su autoría, sin atribuirla automáticamente a esta intervención.

## Comandos reales, sin secretos

Desde la raíz:

```powershell
& .\\backend\\codn_second_start_cb03.ps1 -SecondStartAuthorized
```

Los arrays exactos de validación y arranque están en `segundo-arranque.json`. Incluyen únicamente el binario, INI propio, los dos parámetros autorizados y rutas de nuevos logs/PID. No llevan contraseña. Validación: salida 0. Preparación completa: **salida 1** por error 1130. Consultas SQL de identidad completadas: **0**. Métodos/subcasos de integración CB-03 ejecutados: **0/0**.

## Punto de detención y siguiente diagnóstico propuesto

Se cumplió la instrucción de detenerse ante una verificación fallida. **No se autoriza implícitamente un tercer arranque ni un cambio de transporte.** No corresponde aprobar esquema/fixtures mientras la identidad SQL siga pendiente.

Para un siguiente intento conviene diagnosticar la conexión con el cliente nativo de la instalación y capturar únicamente número de error y origen del cliente, sin intentar cuentas globales ni contraseñas habituales. Una alternativa a revisar es un transporte exclusivamente local de Windows con nombre único —memoria compartida— para autenticar normalmente root@localhost y consultar los metadatos. MySQL documenta esa opción en [protocolos de conexión](https://dev.mysql.com/doc/refman/8.0/en/connecting.html). No se ha activado ni probado, ni se garantiza que resuelva el error.

Ese procedimiento necesitaría autorización específica para un nuevo arranque del mismo datadir y, si se elige, habilitar el transporte local. No usaría skip-grant-tables, no reinicializaría, no crearía cuentas alternativas ni ampliaría grants. El único cambio SQL posterior permitido sería asegurar root@localhost, una vez cotejada la identidad. Ante otro fallo se detendría sin repetir.

## Plan funcional CB-03 conservado, todavía NO AUTORIZADO

Sigue propuesto el esquema `codn_cb03_20261103_a3c5f7f4`, 11 tablas necesarias y 40 filas exclusivamente sintéticas, con los 10 métodos ya preparados. Tablas: tipos_documento, cargos, usuarios, pacientes, visitas_clinicas, tipos_informe, informes, informes_versiones, grados_retinopatia, diagnosticos_retinopatia y diagnosticos_retinopatia_detalle.

La revisión definitiva de DDL create-only, claves/índices/FK, cuenta restringida, matrices y comandos de integración debe presentarse después de confirmar la identidad y antes de ejecutar SQL funcional. No se declara listo ni se ejecuta un script de esquema productivo sin haberlo revisado. La matriz y el procedimiento anteriores permanecen disponibles en `PROCEDIMIENTO_CB03_MYSQL_AISLADO.md` y las evidencias de preparación de CB-03.

## Evidencias de este intento

Carpeta: `evidencias/{RUN['run_id']}/`.

- `antes.json`, `despues.json`, `estado-final-detenido.json`.
- `segundo-arranque.json`, `estado-final-consolidado.json`, `ejecucion.log`, `exit.txt`.
- `compatibilidad-stdout.log`, `compatibilidad-stderr.log`, `server-segundo-arranque.err`, `server-segundo-arranque.pid`.
- INI original sin cambios, scripts ejecutados, hashes de fuentes previas y estado Git.
- Se verificaron **{prior_count} hashes históricos** sin cambios. Evidencias previas y primer informe se conservan separados; no se reemplazan sus resultados.
- `SHA256SUMS.txt` cubre esta corrida, excluyéndose a sí mismo. No se generaron PNG ni cobertura de una integración inexistente.
'''
    report = HERE / 'INFORME_PREPARACION_MYSQL_CB03.md'
    old = (OUT / 'INFORME_PREPARACION_ANTES_SEGUNDO_ARRANQUE.md').read_bytes()
    current = report.read_bytes()
    if b'<!-- CODN-CB03-SECOND-START -->' not in current:
        assert current == old
    else:
        assert current.startswith(old)
    report.write_bytes(old + section.encode('utf-8'))
    assert report.read_bytes().startswith(old)
    main_report = HERE / 'INFORME_PRUEBAS_CAJA_BLANCA.md'
    main_old = main_report.read_bytes()
    marker = b'<!-- CODN-CB03-SECOND-START-STATUS -->'
    if marker not in main_old:
        (OUT / 'INFORME_CAJA_BLANCA_ANTES_SEGUNDO_ARRANQUE.md').write_bytes(main_old)
        main_report.write_bytes(main_old + f'''\n\n<!-- CODN-CB03-SECOND-START-STATUS -->
## Actualización: segundo arranque MySQL de CB-03

RUN `{RUN['run_id']}`: configuración autorizada validada (salida 0), proceso 9380 arrancado sin reinicializar. Conexión administrativa rechazada con error MySQL 1130; proceso detenido y puerto 33363 cerrado. Identidad SQL y credenciales pendientes; ningún SQL funcional ni ejecución de integración. **CB-03 continúa BLOQUEADA.** Ver [informe de preparación actualizado](INFORME_PREPARACION_MYSQL_CB03.md). Los resultados históricos no cambian.
'''.encode('utf-8'))
    (OUT / 'INFORME_PREPARACION_MYSQL_CB03_actualizado.md').write_bytes(report.read_bytes())
    for source in [Path(__file__), REPO / 'backend/codn_provision_cb03_instance.py']:
        (OUT / source.name).write_bytes(source.read_bytes())
    subprocess.run(['git', 'diff', '--exit-code', '--', '.gitignore'], cwd=REPO, check=True, capture_output=True)
    (OUT / 'git-status-final.txt').write_text(subprocess.check_output(['git', 'status', '--short'], cwd=REPO, text=True), encoding='utf-8')
    manifest = [sha(path) + '  ' + path.relative_to(OUT).as_posix() for path in sorted(OUT.rglob('*'))
                if path.is_file() and path.name != 'SHA256SUMS.txt']
    (OUT / 'SHA256SUMS.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
    print(json.dumps({'state': final['state'], 'client_error': 1130, 'cb03_status': 'BLOQUEADO',
        'historical_hashes_verified': prior_count, 'new_files_hashed': len(manifest),
        'preexisting_tracked_files': len(checks), 'preexisting_hash_changes': sum(not c['unchanged'] for c in checks),
        'report': str(report)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
