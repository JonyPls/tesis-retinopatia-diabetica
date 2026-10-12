"""Ensayo B1 manual: solo MySQL 8 nuevo en datadir temporal propio.

No importa app.py, no usa .env y no conecta a la instancia de la aplicación.
Ejecutar exclusivamente con --run-disposable tras comprobar el aislamiento.
"""

import argparse
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import pymysql


BACKEND = Path(__file__).resolve().parent
SERVER = Path(r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe")
CLIENT = SERVER.with_name("mysql.exe")
ADMIN = SERVER.with_name("mysqladmin.exe")
APPROVED_TEMP = Path(r"C:\Users\ricar\AppData\Local\Temp\opencode")
SCHEMA = "centro_oftalmologico_db_v2"

ROLES = {
    "ADMINISTRADOR_SISTEMA", "OFTALMOLOGO", "ENFERMERO", "ASISTENTE_ADMINISTRATIVO"
}
NEW_PERMISSIONS = {"diagnostico_retinopatia.ver", "imagenes.ver", "informes.inactivar"}
ADMIN_REMOVALS = {
    "pacientes.ver", "pacientes.crear", "pacientes.editar", "visitas.ver",
    "visitas.crear", "diagnostico_retinopatia.crear",
    "diagnostico_retinopatia.validar", "informes.ver", "informes.crear",
    "informes.editar", "informes.anular",
}
EXPECTED_INITIAL_COUNTS = {
    "ADMINISTRADOR_SISTEMA": 18, "OFTALMOLOGO": 11,
    "ENFERMERO": 6, "ASISTENTE_ADMINISTRATIVO": 7,
}
EXPECTED_FINAL_COUNTS = {
    "ADMINISTRADOR_SISTEMA": 7, "OFTALMOLOGO": 13,
    "ENFERMERO": 6, "ASISTENTE_ADMINISTRATIVO": 6,
}
UNAFFECTED_TABLES = (
    "usuarios", "usuario_rol", "pacientes", "visitas_clinicas",
    "diagnosticos_retinopatia", "diagnosticos_retinopatia_detalle", "informes",
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def free_loopback_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def connect(port, password="", database=None):
    return pymysql.connect(
        host="127.0.0.1", port=port, user="root", password=password,
        database=database, charset="utf8mb4", autocommit=True,
        connect_timeout=1, read_timeout=5, write_timeout=5,
    )


def rows(connection, query, params=None):
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return cursor.fetchall()


def ensure_own_server(connection, datadir, port):
    version, server_port, server_datadir, server_uuid = rows(
        connection, "SELECT @@version, @@port, @@datadir, @@server_uuid"
    )[0]
    own_path = str(datadir.resolve()).replace("/", "\\").rstrip("\\").casefold()
    db_path = str(server_datadir).replace("/", "\\").rstrip("\\").casefold()
    require(db_path == own_path and int(server_port) == port and version.startswith("8.0."),
            "El servidor no coincide con el datadir/puerto temporal creado; se aborta sin SQL.")
    return server_uuid


def client_script(port, password, path, database=None):
    command = [
        str(CLIENT), "--no-defaults", "--protocol=tcp", "--host=127.0.0.1",
        f"--port={port}", "--user=root", "--default-character-set=utf8mb4",
        "--batch", "--raw", "--silent",
    ]
    if database:
        command.append(f"--database={database}")
    environment = {**os.environ, "MYSQL_PWD": password}
    result = subprocess.run(
        command, input=path.read_text(encoding="utf-8"), text=True,
        encoding="utf-8", capture_output=True, timeout=90, env=environment,
    )
    # Nunca imprimir stdout/stderr: un error del seed podria incluir datos.
    require(result.returncode == 0, f"Falló la etapa {path.name}; código de cliente {result.returncode}.")


def catalog(connection):
    return set(rows(connection, "SELECT codigo FROM permisos"))


def grants(connection):
    return set(rows(connection, """
        SELECT r.codigo, p.codigo FROM rol_permiso rp
        JOIN roles r ON r.id = rp.rol_id
        JOIN permisos p ON p.id = rp.permiso_id
    """))


def grant_history(connection):
    return {
        (role_code, permission_code): created
        for role_code, permission_code, created in rows(connection, """
            SELECT r.codigo, p.codigo, rp.fecha_creado FROM rol_permiso rp
            JOIN roles r ON r.id = rp.rol_id
            JOIN permisos p ON p.id = rp.permiso_id
        """)
    }


def counts(links):
    return {role: sum(role_code == role for role_code, _ in links) for role in ROLES}


def fingerprints(connection):
    result = {}
    for table in UNAFFECTED_TABLES:
        count = rows(connection, f"SELECT COUNT(*) FROM `{table}`")[0][0]
        checksum = rows(connection, f"CHECKSUM TABLE `{table}` EXTENDED")[0][1]
        require(checksum is not None, "No se pudo obtener un checksum de una tabla no objetivo.")
        result[table] = (count, checksum)
    return result


def verify_seed(connection):
    tables = set(rows(connection, """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = %s AND table_type = 'BASE TABLE'
    """, (SCHEMA,)))
    require(len(tables) == 14, "El seed no creó exactamente 14 tablas.")
    require(set(rows(connection, "SELECT codigo FROM roles")) == {(r,) for r in ROLES},
            "Los cuatro roles no coinciden con la semilla v2.")
    require(len(catalog(connection)) == 18, "La semilla no contiene 18 permisos.")
    require(counts(grants(connection)) == EXPECTED_INITIAL_COUNTS,
            "Las asignaciones de rol originales difieren de v2.")
    for table, index in (("roles", "uq_roles_codigo"), ("permisos", "uq_permisos_codigo"),
                         ("usuarios", "uq_usuarios_username"),
                         ("rol_permiso", "PRIMARY"), ("rol_permiso", "idx_rol_permiso_permiso"),
                         ("usuario_rol", "PRIMARY"), ("usuario_rol", "idx_usuario_rol_rol")):
        require(rows(connection, """
            SELECT COUNT(*) FROM information_schema.statistics
            WHERE table_schema=%s AND table_name=%s AND index_name=%s
        """, (SCHEMA, table, index))[0][0] > 0, f"Falta índice {table}.{index}.")
    for table in ("rol_permiso", "usuario_rol"):
        require(rows(connection, """
            SELECT COUNT(*) FROM information_schema.referential_constraints
            WHERE constraint_schema=%s AND table_name=%s
        """, (SCHEMA, table))[0][0] == 2, f"Faltan FK de {table}.")


def verify_after_grants(before, after):
    removed = {("ADMINISTRADOR_SISTEMA", code) for code in ADMIN_REMOVALS}
    removed.add(("ASISTENTE_ADMINISTRATIVO", "informes.crear"))
    added = {("OFTALMOLOGO", "diagnostico_retinopatia.ver"),
             ("OFTALMOLOGO", "imagenes.ver")}
    require(removed <= before, "Faltaba algún grant original del seed v2.")
    require(after == (before - removed) | added, "El delta de grants no es el aprobado.")
    require(counts(after) == EXPECTED_FINAL_COUNTS, "Los totales posteriores no coinciden.")
    require(not any(code == "informes.inactivar" for _, code in after),
            "informes.inactivar recibió concesión no autorizada.")


def check_failed_precondition(connection, port, password, grants_script, expected):
    with connection.cursor() as cursor:
        cursor.execute("UPDATE permisos SET estado='INACTIVO' WHERE codigo='imagenes.ver'")
    require(connection.affected_rows() == 1, "No pudo simularse una precondición faltante.")
    try:
        try:
            client_script(port, password, grants_script, SCHEMA)
        except RuntimeError:
            pass  # El SQL debe fallar explicitamente, no finalizar en silencio.
        else:
            raise RuntimeError("Precondición faltante terminó sin error SQL.")
        require(grants(connection) == expected, "La guarda permitió cambiar grants con permiso inactivo.")
    finally:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE permisos SET estado='ACTIVO' WHERE codigo='imagenes.ver'")


def check_partial_failure_rollback(connection, expected):
    connection.begin()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                DELETE rp FROM rol_permiso rp
                JOIN roles r ON r.id=rp.rol_id
                JOIN permisos p ON p.id=rp.permiso_id
                WHERE r.codigo='OFTALMOLOGO' AND p.codigo='imagenes.ver'
            """)
            require(cursor.rowcount == 1, "No se pudo simular una operación parcial.")
            try:
                cursor.execute("INSERT INTO rol_permiso (rol_id, permiso_id) VALUES (NULL, NULL)")
            except pymysql.IntegrityError:
                pass
            else:
                raise RuntimeError("No se produjo el error de integridad simulado.")
    finally:
        connection.rollback()
    require(grants(connection) == expected, "ROLLBACK no restauró el grant parcial.")


def revert_selectively(connection, original_catalog, original_links):
    current = grants(connection)
    connection.begin()
    try:
        with connection.cursor() as cursor:
            for role_code, permission_code in sorted(current - set(original_links)):
                cursor.execute("""
                    DELETE rp FROM rol_permiso rp
                    JOIN roles r ON r.id=rp.rol_id
                    JOIN permisos p ON p.id=rp.permiso_id
                    WHERE r.codigo=%s AND p.codigo=%s
                """, (role_code, permission_code))
                require(cursor.rowcount == 1, "No se retiró exactamente un grant agregado.")
            for role_code, permission_code in sorted(set(original_links) - current):
                cursor.execute("""
                    INSERT INTO rol_permiso (rol_id, permiso_id, fecha_creado)
                    SELECT r.id, p.id, %s FROM roles r JOIN permisos p ON p.codigo=%s
                    WHERE r.codigo=%s AND NOT EXISTS (
                      SELECT 1 FROM rol_permiso rp
                      WHERE rp.rol_id=r.id AND rp.permiso_id=p.id
                    )
                """, (original_links[(role_code, permission_code)], permission_code, role_code))
                require(cursor.rowcount == 1, "No se restauró exactamente un grant previo.")
            for (permission_code,) in sorted(catalog(connection) - original_catalog):
                require(permission_code in NEW_PERMISSIONS,
                        "Se encontró un código nuevo ajeno a B1; no se elimina.")
                cursor.execute("""
                    DELETE p FROM permisos p LEFT JOIN rol_permiso rp ON rp.permiso_id=p.id
                    WHERE p.codigo=%s AND rp.permiso_id IS NULL
                """, (permission_code,))
                require(cursor.rowcount == 1, "El permiso nuevo sigue referenciado; no se elimina.")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    require(grants(connection) == set(original_links), "La reversión de vínculos no coincide.")
    require(catalog(connection) == original_catalog, "La reversión de catálogo no coincide.")
    require(grant_history(connection) == original_links, "La fecha original de los vínculos difiere.")


def check_preexisting_permission_preserved(connection, port, password,
                                           catalog_script, grants_script,
                                           original_catalog, original_links):
    # Variante temporal: este codigo ya existia ANTES de las migraciones.
    with connection.cursor() as cursor:
        cursor.execute("""
            INSERT INTO permisos (codigo, nombre, descripcion, modulo)
            VALUES ('imagenes.ver', 'Lectura preexistente de prueba',
                    'Solo para comprobar reversion selectiva', 'imagenes')
        """)
    preexisting_catalog = catalog(connection)
    require(len(preexisting_catalog) == 19, "No se pudo preparar el codigo preexistente.")
    client_script(port, password, catalog_script, SCHEMA)
    require(len(catalog(connection)) == 21, "El catalogo duplicó un codigo preexistente.")
    client_script(port, password, grants_script, SCHEMA)
    verify_after_grants(set(original_links), grants(connection))

    revert_selectively(connection, preexisting_catalog, original_links)
    require(("imagenes.ver",) in catalog(connection),
            "La reversion eliminó un permiso existente antes de la migración.")
    # Retirar exclusivamente la fila sintética creada arriba en este datadir.
    with connection.cursor() as cursor:
        cursor.execute("""
            DELETE p FROM permisos p LEFT JOIN rol_permiso rp ON rp.permiso_id=p.id
            WHERE p.codigo='imagenes.ver' AND rp.permiso_id IS NULL
        """)
        require(cursor.rowcount == 1, "La fila sintética preexistente sigue referenciada.")
    require(catalog(connection) == original_catalog, "El ensayo no volvió al catalogo seed.")
    require(grant_history(connection) == original_links, "El ensayo no volvió a los grants seed.")


def run_trial(temp_root, port, password, orm_integration=False):
    with connect(port) as initial:
        instance_uuid = ensure_own_server(initial, temp_root / "data", port)
        require(not rows(initial, "SHOW DATABASES LIKE %s", (SCHEMA,)),
                "El esquema v2 ya existía: se aborta antes de ejecutar DROP del seed.")
        with initial.cursor() as cursor:
            cursor.execute("ALTER USER CURRENT_USER() IDENTIFIED BY %s", (password,))
    with connect(port, password) as verified:
        require(ensure_own_server(verified, temp_root / "data", port) == instance_uuid,
                "Cambió la identidad del servidor antes de cargar el esquema.")

    v2 = BACKEND / "db" / "centro-oftalmologico-db-v2.sql"
    catalog_script = BACKEND / "migrations" / "b1_catalogo_permisos_propuesta.sql"
    grants_script = BACKEND / "migrations" / "b1_grants_roles_propuesta.sql"
    require(all(path.is_file() for path in (v2, catalog_script, grants_script)),
            "Falta un script requerido; no se ejecuta SQL.")
    client_script(port, password, v2)
    with connect(port, password, SCHEMA) as connection:
        require(ensure_own_server(connection, temp_root / "data", port) == instance_uuid,
                "La conexión no es a la instancia temporal propia.")
        verify_seed(connection)
        before_catalog = catalog(connection)
        before_links = grant_history(connection)
        before_fingerprints = fingerprints(connection)
        print("V2 AISLADO: 14 tablas, 4 roles, 18 permisos; grants 18/11/6/7; índices y FK verificados.")

        client_script(port, password, catalog_script, SCHEMA)
        require(catalog(connection) == before_catalog | {(p,) for p in NEW_PERMISSIONS},
                "El catálogo no agregó exactamente los tres códigos B1.")
        require(grants(connection) == set(before_links), "El catálogo alteró grants.")
        client_script(port, password, catalog_script, SCHEMA)
        require(len(catalog(connection)) == 21, "Repetir catálogo generó códigos duplicados.")
        print("CATALOGO: tres códigos nuevos, 21 en total; grants intactos; repetición idéntica.")

        client_script(port, password, grants_script, SCHEMA)
        after = grants(connection)
        verify_after_grants(set(before_links), after)
        client_script(port, password, grants_script, SCHEMA)
        require(grants(connection) == after, "Repetir grants modificó las concesiones.")
        require(fingerprints(connection) == before_fingerprints,
                "Se modificó una tabla de cuentas o recursos clínicos.")
        print("GRANTS: Admin 7, Oftalmologo 13, Enfermero 6, Asistente 6; delta exacto.")
        print("IDEMPOTENCIA: catálogo y grants repetidos sin duplicados ni cambios extra.")

        if orm_integration:
            # Se importa solo DESPUES de identificar datadir, UUID y grants.
            from b1_orm_mysql_trial import run_orm_integration

            run_orm_integration(port, password, temp_root / "data", instance_uuid)
            require(fingerprints(connection) == before_fingerprints,
                    "Las pruebas ORM dejaron datos en las tablas clínicas/usuarios.")

        check_failed_precondition(connection, port, password, grants_script, after)
        check_partial_failure_rollback(connection, after)
        print("FALLOS: precondición ausente no altera grants; error parcial revierte transacción.")

        revert_selectively(connection, before_catalog, before_links)
        require(fingerprints(connection) == before_fingerprints,
                "La reversión afectó cuentas o recursos clínicos.")
        print("REVERSIÓN: catálogo y pares rol-permiso (incluidas fechas) iguales al seed.")

        check_preexisting_permission_preserved(connection, port, password,
                                               catalog_script, grants_script,
                                               before_catalog, before_links)
        require(fingerprints(connection) == before_fingerprints,
                "La variante con permiso preexistente afectó recursos no objetivo.")
        print("REVERSIÓN PREEXISTENTE: permiso ya existente conservado; seed final intacto.")


def main():
    parser = argparse.ArgumentParser(description="Ensayo aislado MySQL B1")
    parser.add_argument("--run-disposable", action="store_true", help="Autoriza crear y limpiar solo la instancia propia")
    parser.add_argument("--orm-integration", action="store_true",
                        help="Ejecuta tambien pruebas ORM/Flask reales en esa instancia")
    args = parser.parse_args()
    if args.orm_integration and not args.run_disposable:
        parser.error("--orm-integration exige --run-disposable.")
    if not args.run_disposable:
        parser.error("Se exige --run-disposable; no se iniciaron procesos ni SQL.")
    require(APPROVED_TEMP.is_dir(), "No existe el directorio temporal aprobado.")
    require(all(path.is_file() for path in (SERVER, CLIENT, ADMIN)), "Faltan binarios MySQL locales.")
    require("Ver 8.0." in subprocess.run([str(SERVER), "--version"],
                                          capture_output=True, text=True, timeout=5).stdout,
            "Se requiere MySQL Server 8.0 local.")

    port = free_loopback_port()
    root = Path(tempfile.mkdtemp(prefix="b1-mysql-", dir=APPROVED_TEMP))
    server = None
    password = secrets.token_urlsafe(36)  # Sintética, solo en memoria; jamás imprimir.
    try:
        data = root / "data"  # No existe antes de --initialize-insecure.
        require(not data.exists(), "El datadir temporal ya existe; se aborta.")
        init = subprocess.run([
            str(SERVER), "--no-defaults", f"--basedir={SERVER.parent.parent}",
            f"--datadir={data}", "--initialize-insecure", f"--log-error={root / 'init.err'}",
        ], capture_output=True, text=True, timeout=120)
        require(init.returncode == 0, "MySQL no inicializó el datadir nuevo; no se ejecutó SQL.")

        server = subprocess.Popen([
            str(SERVER), "--no-defaults", f"--basedir={SERVER.parent.parent}",
            f"--datadir={data}", f"--port={port}", "--bind-address=127.0.0.1",
            "--skip-log-bin", f"--log-error={root / 'server.err'}",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            require(server.poll() is None, "MySQL temporal se cerró antes de iniciar.")
            try:
                with connect(port) as candidate:
                    ensure_own_server(candidate, data, port)
                break
            except pymysql.OperationalError:
                time.sleep(0.25)
        else:
            raise RuntimeError("MySQL temporal no aceptó conexiones en 60 segundos.")

        run_trial(root, port, password, orm_integration=args.orm_integration)
        print("AISLAMIENTO: instancia nueva verificada por datadir, puerto y UUID; sin acceso a BD habitual.")
    finally:
        if server is not None and server.poll() is None:
            try:
                subprocess.run([
                    str(ADMIN), "--no-defaults", "--protocol=tcp", "--host=127.0.0.1",
                    f"--port={port}", "--user=root", "shutdown",
                ], env={**os.environ, "MYSQL_PWD": password},
                    capture_output=True, timeout=15)
            except subprocess.TimeoutExpired:
                pass
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.terminate()  # Solo el PID creado por este ensayo.
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()  # Nunca seleccionar PID ajenos.
                    server.wait(timeout=10)
        if server is None or server.poll() is not None:
            shutil.rmtree(root)  # Unicamente el directorio UUID creado arriba.


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No imprimir excepciones de PyMySQL/CLI: podrian incluir SQL o secretos.
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"ENSAYO DETENIDO: {message}", file=sys.stderr)
        sys.exit(1)
