"""Retirada acotada de un árbol NUEVO y de handles creados aquí; nunca por PID/puerto."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess

from .safety import inside, no_links, require
from .process_identity import sanitize_startup, sanitize_worker_pid, windows_handle_metadata


class WindowsJob:
    """El worker recibe su pipe DESPUÉS de asignarlo; sus hijos heredan este Job."""
    def __init__(self):
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.TerminateJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        require(bool(self.handle), 'JOB_NO_CREADO')
        class Limits(ctypes.Structure):
            _fields_ = [('times', ctypes.c_longlong * 2), ('flags', wintypes.DWORD),
                ('minimum', ctypes.c_size_t), ('maximum', ctypes.c_size_t),
                ('active', wintypes.DWORD), ('affinity', ctypes.c_size_t),
                ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Limits), ('io', ctypes.c_ulonglong * 6),
                ('memory', ctypes.c_size_t * 4)]
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
            ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.kernel.CloseHandle(self.handle)
            require(False, 'JOB_LIMITES_NO_APLICADOS')

    def assign(self, process):
        require(self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)), 'JOB_NO_ASIGNADO')

    def contains(self, process):
        from ctypes import wintypes
        self.kernel.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        self.kernel.IsProcessInJob.restype = wintypes.BOOL
        member = wintypes.BOOL()
        require(self.kernel.IsProcessInJob(int(process._handle), self.handle, ctypes.byref(member)),
                'JOB_PERTENENCIA_NO_VERIFICADA')
        return bool(member.value)

    def stop(self):
        # Termina solo miembros de ESTE job, incluidos workers descendientes.
        require(self.kernel.TerminateJobObject(self.handle, 1), 'JOB_NO_TERMINADO')

    def empty(self):
        from ctypes import wintypes
        class Accounting(ctypes.Structure):
            _fields_ = [('times', ctypes.c_longlong * 4), ('faults', wintypes.DWORD),
                        ('total', wintypes.DWORD), ('active', wintypes.DWORD), ('terminated', wintypes.DWORD)]
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
            ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.kernel.QueryInformationJobObject.restype = wintypes.BOOL
        info = Accounting()
        require(self.kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(info), ctypes.sizeof(info), None),
                'JOB_NO_VERIFICADO')
        return info.active == 0

    def close(self):
        require(self.kernel.CloseHandle(self.handle), 'JOB_NO_CERRADO')


def identity(path):
    info = path.lstat()
    require(bool(info.st_ino), 'IDENTIDAD_FS_NO_DISPONIBLE')
    return info.st_dev, info.st_ino


def sanitized_json(name, content):
    value = json.loads(content)
    if name == 'startup.json':
        return sanitize_startup(value)
    safe_word = lambda word: isinstance(word, str) and re.fullmatch(r'[A-Za-z0-9_]{1,160}', word)
    if name == 'failure.json':
        require(safe_word(value.get('error_class')), 'EVIDENCIA_INVALIDA')
        code = value.get('mysql_code')
        result = {'error_class': value['error_class'], 'mysql_code': code if type(code) is int else None}
        if 'worker_pid' in value:
            result['worker_pid'] = sanitize_worker_pid(value['worker_pid'])
        return result
    require(name == 'results.json', 'EVIDENCIA_NO_PERMITIDA')
    cases = []
    for item in value['cases']:
        require(safe_word(item['name']) and item['status'] in ('passed', 'failed'), 'EVIDENCIA_INVALIDA')
        row = {'name': item['name'], 'status': item['status']}
        if 'error_class' in item:
            require(safe_word(item['error_class']), 'EVIDENCIA_INVALIDA')
            row['error_class'] = item['error_class']
        cases.append(row)
    trace = []
    for item in value['trace']:
        event = item.get('event')
        require(event in ('checkout', 'db_error', 'lock_wait_observed',
            'overlap_distinct_visits_not_lock_free_claim'), 'EVIDENCIA_INVALIDA')
        row = {'event': event}
        for key in ('connection', 'first', 'second', 'code'):
            if key in item:
                require(item[key] is None or type(item[key]) is int, 'EVIDENCIA_INVALIDA')
                row[key] = item[key]
        trace.append(row)
    return {'cases': cases, 'trace': trace, 'scope': 'synthetic_only_not_activation'}


class OwnedTrial:
    def __init__(self, root, run_id, *, retirement_authorized, job_factory=WindowsJob):
        require(retirement_authorized is True, 'RETIRADA_NO_AUTORIZADA')
        self.root = no_links(root)
        self.root.mkdir(exist_ok=False)
        self._identity = identity(self.root)
        self.run_id = run_id
        self.owner = secrets.token_hex(32)
        self.marker = self.root / 'owner.json'
        try:
            with self.marker.open('x', encoding='utf-8') as stream:
                json.dump({'run_id': run_id, 'owner': self.owner}, stream)
        except Exception:
            # No hay procesos ni secretos de BD todavía. No dejar un fallo de
            # preparación sin tratamiento; si el SO impide retirarlo, informar.
            try:
                require(identity(self.root) == self._identity, 'RAIZ_CAMBIO')
                if self.marker.exists():
                    inside(self.marker, self.root)
                    require(self.marker.is_file() and self.marker.stat().st_nlink == 1, 'MARCADOR_CAMBIO')
                    self.marker.unlink()
                self.root.rmdir()
            except Exception:
                require(False, 'PREPARACION_INCOMPLETA_RAIZ_REQUIERE_REVISION')
            raise
        self._marker_identity = identity(self.marker)
        self._job_factory, self._job = job_factory, None
        self._processes = []
        self._roles = {}
        self._assignments = {}

    def owned(self):
        require(no_links(self.root) == self.root and identity(self.root) == self._identity,
                'RAIZ_NO_PROPIA')
        marker = inside(self.marker, self.root)
        require(identity(marker) == self._marker_identity and marker.stat().st_nlink == 1 and
                json.loads(marker.read_text(encoding='utf-8')) ==
                {'run_id': self.run_id, 'owner': self.owner}, 'PROPIEDAD_NO_ACREDITADA')

    def spawn(self, command, *, role='OTHER', **options):
        require(role in ('OTHER', 'INITIALIZER', 'MYSQL', 'WORKER'), 'PROCESS_ROLE_INVALID')
        self.owned()
        if self._job is None:
            self._job = self._job_factory()
        process = subprocess.Popen(command, **options)
        self._processes.append(process)  # Handle obtenido de nuestra creación, nunca de un PID recibido.
        self._roles[id(process)] = role
        self._assignments[id(process)] = 'FAILED'
        try:
            self._job.assign(process)
            self._assignments[id(process)] = 'ASSIGNED'
        except Exception:
            process.terminate()
            process.wait(timeout=30)
            raise
        return process

    def run(self, command, *, input=None, timeout, role='OTHER', **options):
        process = self.spawn(command, role=role, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
        output, errors = process.communicate(input=input, timeout=timeout)
        return subprocess.CompletedProcess(command, process.returncode, output, errors)

    def latest_process(self, role):
        return next((process for process in reversed(self._processes) if self._roles[id(process)] == role), None)

    def process_identity(self, process, executable):
        registered = any(item is process for item in self._processes)
        result = dict(registered_process=registered, metadata_state='NOT_CHECKED', handle_valid=False,
            handle_pid=None, os_exit_code=None, executable_match=None, metadata_error_code=None,
            job_member=None, job_assignment=self._assignments.get(id(process), 'NOT_RECORDED'))
        if not registered:
            return result  # Nunca consultar un handle ajeno a spawn().
        try:
            result.update(windows_handle_metadata(process, executable))
            if result['handle_valid']:
                result['job_member'] = self._job.contains(process) if self._job is not None else False
        except Exception:
            result['metadata_state'] = 'ERROR'  # No guardar excepciones con argumentos/secretos.
        return result

    def _tree(self, path):
        """Inventario sin seguir enlaces; borrar solo si TODO el candidato es seguro."""
        nodes = []
        def visit(item):
            inside(item, self.root)
            info = item.lstat()
            require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'RECURSO_NO_REGULAR')
            if stat.S_ISDIR(info.st_mode):
                for child in item.iterdir():
                    visit(child)
            nodes.append((item, info))
        visit(path)
        links = {}
        for _item, info in nodes:
            if stat.S_ISREG(info.st_mode):
                key = (info.st_dev, info.st_ino)
                links[key] = links.get(key, 0) + 1
        require(all(not stat.S_ISREG(info.st_mode) or links[(info.st_dev, info.st_ino)] == info.st_nlink
                    for _item, info in nodes), 'HARDLINK_EXTERNO_O_NO_ACREDITADO')
        return nodes

    def _remove(self, path):
        nodes = self._tree(path)
        for item, info in nodes:
            self.owned()
            inside(item, self.root)
            require(identity(item) == (info.st_dev, info.st_ino), 'RECURSO_REEMPLAZADO')
            if stat.S_ISDIR(info.st_mode):
                item.rmdir()
            else:
                item.unlink()

    def retire(self):
        report = {'run_id': self.run_id, 'status': 'INCOMPLETE', 'pending': [], 'evidence_rejected': []}
        stopped = True
        try:
            if self._job is not None:
                self._job.stop()
            for process in self._processes:
                if process.poll() is None:
                    # Solo handles que spawn() creó aquí (también cubre fallo de asignación al job).
                    process.terminate()
                process.wait(timeout=30)
                require(process.poll() is not None, 'PROCESO_NO_TERMINADO')
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream is not None:
                        stream.close()
            if self._job is not None:
                # Esperar confirmación de vaciado de TODOS los descendientes, no solo del padre.
                import time
                deadline = time.monotonic() + 10
                while not self._job.empty():
                    require(time.monotonic() < deadline, 'DESCENDIENTES_ACTIVOS')
                    time.sleep(0.01)
                self._job.close()
                self._job = None
        except Exception:
            stopped = False
            report['pending'].append('owned_processes_and_private_tree')
        try:
            self.owned()
        except Exception:
            report['pending'].append('root_ownership_uncertain')
            return report  # Ni siquiera escribir evidencia en una raíz sustituida.
        if not stopped:
            return report  # No recorrer/borrar mientras pueda existir un escritor vivo.
        evidence = self.root / 'evidence'
        saved = {}
        if evidence.exists():
            try:
                inside(evidence, self.root)
                for path in evidence.iterdir():
                    try:
                        inside(path, self.root)
                        require(path.is_file() and path.stat().st_nlink == 1 and path.stat().st_size <= 10_000_000,
                                'EVIDENCIA_INVALIDA')
                        if path.name in ('results.json', 'failure.json', 'startup.json'):
                            saved[path.name] = sanitized_json(path.name, path.read_text(encoding='utf-8'))
                        elif path.name in ('actual-schema.sql', 'synthetic-schema.sql', 'base-schema.sql'):
                            # No conservar SQL crudo ni posibles literales privados: solo huellas.
                            saved[path.name + '.json'] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                                        'kind': 'schema_ddl_fingerprint'}
                    except Exception:
                        report['evidence_rejected'].append('untrusted_artifact')
            except Exception:
                report['evidence_rejected'].append('untrusted_directory')
        for child in list(self.root.iterdir()):
            if child == self.marker:
                continue
            try:
                self._remove(child)
            except Exception:
                # Nombres solo de primer nivel creados por el arnés, nunca contenido/errores.
                allowed = {'backend', 'data', 'tmp', 'private', 'exports', 'evidence',
                           'bootstrap.sql', 'init.log', 'mysql.log', 'mysql.pid'}
                report['pending'].append(child.name if child.name in allowed else 'unrecognized_owned_entry')
        try:
            # También conservar evidencia saneada si otro candidato no se pudo retirar.
            self.owned()
            if not evidence.exists():
                evidence.mkdir(exist_ok=False)
                for name, data in saved.items():
                    with (evidence / name).open('x', encoding='utf-8') as stream:
                        json.dump(data, stream)
                if not report['pending']:
                    try:
                        self.owned()
                        self.marker.unlink()
                    except Exception:
                        report['pending'].append('owner_marker')
                    else:
                        report['status'] = 'COMPLETED'
                with (evidence / 'retirement.json').open('x', encoding='utf-8') as stream:
                    json.dump(report, stream)
            else:
                report['pending'].append('untrusted_evidence_directory')
        except Exception:
            report['status'] = 'INCOMPLETE'
            report['pending'].append('sanitized_evidence_write')
        return report
