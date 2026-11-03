"""Identidad estricta y evidencia acotada. No inicia procesos ni abre SQL."""
import json
import os
import re
import stat
from threading import Event
import time

from .safety import SafetyError, inside, no_links, require


STAGES = {'PREPARATION', 'INITIALIZE', 'MYSQL_SPAWN', 'STARTUP_WAIT', 'PRE_SQL',
          'SQL_PROVISION', 'SQL_IDENTITY_VERIFIED', 'POST_PROVISION', 'WORKER', 'POST_WORKER', 'FINISHED'}
REASONS = {'PENDING', 'READY', 'INITIALIZED', 'PIDFILE_MISSING', 'PIDFILE_EMPTY', 'PIDFILE_INVALID',
    'PIDFILE_UNSAFE', 'PIDFILE_READ_ERROR', 'PIDFILE_CHANGED', 'PID_NO_COINCIDE',
    'OWN_PROCESS_EXITED', 'OWN_HANDLE_INVALID', 'PROCESS_METADATA_ERROR', 'HANDLE_PID_MISMATCH',
    'EXECUTABLE_MISMATCH', 'JOB_ASSIGNMENT_FAILED', 'JOB_MEMBERSHIP_FAILED',
    'LISTENER_NOT_READY', 'LISTENER_MISMATCH', 'LISTENER_METADATA_ERROR',
    'ROOT_IDENTITY_ERROR', 'CONFIGURED_PATH_MISMATCH', 'STARTUP_TIMEOUT',
    'SPAWN_FAILED', 'INITIALIZE_FAILED', 'SQL_OR_WORKER_FAILURE'}
FILE_STATES = {'NOT_CHECKED', 'MISSING', 'EMPTY', 'VALID', 'INVALID', 'UNSAFE', 'READ_ERROR', 'CHANGED'}
BOOL_FIELDS = {'root_verified', 'configured_paths_verified', 'registered_process', 'handle_valid',
    'job_member', 'executable_match', 'sql_identity_verified', 'pid_file_exists', 'pid_file_regular',
    'pid_file_single_link'}
NUMBER_FIELDS = {'expected_pid', 'handle_pid', 'returncode', 'os_exit_code', 'metadata_error_code',
                 'listener_pid', 'pid_file_pid', 'pid_file_size', 'pid_file_mtime_ns', 'elapsed_ms'}
EVENT_KEYS = BOOL_FIELDS | NUMBER_FIELDS | {'stage', 'reason', 'pid_file_state', 'job_assignment', 'metadata_state'}
PID_FIELDS = {'pid_file_exists', 'pid_file_state', 'pid_file_pid', 'pid_file_size',
              'pid_file_mtime_ns', 'pid_file_regular', 'pid_file_single_link'}


def sanitize_startup(value):
    """Allowlist cerrada: nunca mensajes, contenido PID crudo, argv, env, DSN o tokens."""
    require(type(value) is dict and set(value) == {'version', 'events', 'outcome', 'reason'} and
            value['version'] == 1 and value['outcome'] in ('PENDING', 'VERIFIED', 'REJECTED') and
            value['reason'] in REASONS and type(value['events']) is list and len(value['events']) <= 64,
            'STARTUP_EVIDENCE_INVALID')
    events = []
    for event in value['events']:
        require(type(event) is dict and set(event) == EVENT_KEYS, 'STARTUP_EVIDENCE_INVALID')
        require(event['stage'] in STAGES and event['reason'] in REASONS and
                event['pid_file_state'] in FILE_STATES and
                event['job_assignment'] in ('NOT_RECORDED', 'ASSIGNED', 'FAILED') and
                event['metadata_state'] in ('NOT_CHECKED', 'OK', 'ERROR'), 'STARTUP_EVIDENCE_INVALID')
        for key in BOOL_FIELDS:
            require(event[key] is None or type(event[key]) is bool, 'STARTUP_EVIDENCE_INVALID')
        for key in NUMBER_FIELDS:
            require(event[key] is None or type(event[key]) is int, 'STARTUP_EVIDENCE_INVALID')
        events.append(dict(event))
    return {'version': 1, 'events': events, 'outcome': value['outcome'], 'reason': value['reason']}


def pid_snapshot(path, root):
    result = {'pid_file_exists': None, 'pid_file_state': 'MISSING', 'pid_file_pid': None,
              'pid_file_size': None, 'pid_file_mtime_ns': None,
              'pid_file_regular': None, 'pid_file_single_link': None}
    try:
        inside(path, root)  # Rechaza symlinks/reparse points antes de abrir.
        info = path.lstat()
        result.update(pid_file_exists=True, pid_file_size=info.st_size,
            pid_file_mtime_ns=info.st_mtime_ns, pid_file_regular=stat.S_ISREG(info.st_mode),
            pid_file_single_link=info.st_nlink == 1)
        if not result['pid_file_regular'] or not result['pid_file_single_link']:
            result['pid_file_state'] = 'UNSAFE'
            return result
        if info.st_size > 64:
            result['pid_file_state'] = 'INVALID'
            return result
        with path.open('rb') as stream:
            before = os.fstat(stream.fileno())
            raw = stream.read(65)
            after = os.fstat(stream.fileno())
        final = path.lstat()
        stamp = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)
        if not (stamp(info) == stamp(before) == stamp(after) == stamp(final)):
            result['pid_file_state'] = 'CHANGED'
            return result
        stripped = raw.strip()
        if not stripped:
            result['pid_file_state'] = 'EMPTY'
        elif re.fullmatch(rb'[1-9][0-9]{0,9}', stripped) and int(stripped) <= 0xffffffff:
            result.update(pid_file_state='VALID', pid_file_pid=int(stripped))
        else:
            result['pid_file_state'] = 'INVALID'
    except FileNotFoundError:
        result.update(pid_file_state='MISSING', pid_file_exists=False)
    except SafetyError:
        result['pid_file_state'] = 'UNSAFE'
    except OSError:
        result['pid_file_state'] = 'READ_ERROR'
    return result


def windows_handle_metadata(process, executable):
    """Consulta SOLO el handle devuelto por nuestro Popen. Nunca OpenProcess(PIDfile)."""
    import ctypes
    from ctypes import wintypes
    result = dict(handle_valid=False, handle_pid=None, os_exit_code=None, metadata_state='OK',
                  executable_match=None, metadata_error_code=None)
    handle = getattr(process, '_handle', None)
    if not handle:
        return result
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetProcessId.argtypes = [wintypes.HANDLE]
    kernel.GetProcessId.restype = wintypes.DWORD
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetExitCodeProcess.restype = wintypes.BOOL
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                 ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    identifier = kernel.GetProcessId(int(handle))
    exit_code = wintypes.DWORD()
    if not identifier or not kernel.GetExitCodeProcess(int(handle), ctypes.byref(exit_code)):
        result['metadata_error_code'] = ctypes.get_last_error()
        if result['metadata_error_code'] != 6:  # ERROR_INVALID_HANDLE no es un error de consulta genérico.
            result['metadata_state'] = 'ERROR'
        return result
    result.update(handle_valid=True, handle_pid=int(identifier), os_exit_code=int(exit_code.value))
    size = wintypes.DWORD(32768)
    image = ctypes.create_unicode_buffer(size.value)
    if not kernel.QueryFullProcessImageNameW(int(handle), 0, image, ctypes.byref(size)):
        result['metadata_error_code'] = ctypes.get_last_error()
        result['metadata_state'] = 'ERROR'
        return result
    # No registrar ni abrir una imagen alternativa: solo comparar con la autorizada.
    normalize = lambda path: os.path.normcase(os.path.normpath(str(path)))
    result['executable_match'] = normalize(image.value) == normalize(executable)
    return result


class StartupIdentity:
    def __init__(self, resources, executable, datadir, pidfile, port, listener, *, clock=time.monotonic):
        self.resources, self.executable, self.datadir = resources, executable, datadir
        self.pidfile, self.port, self.listener = pidfile, port, listener
        self.clock, self.started = clock, clock()
        self.events = []
        self.outcome, self.reason = 'PENDING', 'PENDING'
        self.sql_identity_verified = False

    def _event(self, stage, process):
        require(stage in STAGES, 'STARTUP_STAGE_INVALID')
        event = {key: None for key in EVENT_KEYS}
        event.update(stage=stage, reason='PENDING', elapsed_ms=max(0, int((self.clock() - self.started) * 1000)),
            expected_pid=process.pid if process is not None else None,
            pid_file_state='NOT_CHECKED', job_assignment='NOT_RECORDED', metadata_state='NOT_CHECKED',
            sql_identity_verified=self.sql_identity_verified)
        return event

    def record(self, event):
        # Coalescer sondeos iguales; mantener siempre el primer y el último hito.
        comparable = lambda item: {k: v for k, v in item.items() if k != 'elapsed_ms'}
        if len(self.events) > 1 and comparable(self.events[-1]) == comparable(event):
            self.events[-1] = event
        else:
            if len(self.events) == 64:
                del self.events[1]
            self.events.append(event)

    def observe(self, process, stage):
        event = self._event(stage, process)
        try:
            self.resources.owned()
            event['root_verified'] = True
        except Exception:
            event.update(root_verified=False, reason='ROOT_IDENTITY_ERROR')
            return event
        try:
            require(self.pidfile == self.resources.root / 'mysql.pid' and
                    self.datadir == self.resources.root / 'data', 'PATH')
            no_links(self.executable)
            inside(self.datadir, self.resources.root)
            event['configured_paths_verified'] = True
        except Exception:
            event.update(configured_paths_verified=False, reason='CONFIGURED_PATH_MISMATCH')
            return event
        if process is None:
            event['reason'] = 'SPAWN_FAILED'
            return event
        event.update(pid_snapshot(self.pidfile, self.resources.root))
        try:
            event['returncode'] = process.poll()
            metadata = self.resources.process_identity(process, self.executable)
            event.update({key: value for key, value in metadata.items() if key in EVENT_KEYS})
        except Exception:
            event.update(metadata_state='ERROR', reason='PROCESS_METADATA_ERROR')
            return event
        try:
            event['listener_pid'] = self.listener(self.port)
        except Exception:
            event['reason'] = 'LISTENER_METADATA_ERROR'
            return event
        if not event['registered_process']: event['reason'] = 'OWN_HANDLE_INVALID'
        elif event['metadata_state'] != 'OK': event['reason'] = 'PROCESS_METADATA_ERROR'
        elif not event['handle_valid']: event['reason'] = 'OWN_HANDLE_INVALID'
        elif event['handle_pid'] != process.pid: event['reason'] = 'HANDLE_PID_MISMATCH'
        elif event['job_assignment'] != 'ASSIGNED': event['reason'] = 'JOB_ASSIGNMENT_FAILED'
        elif event['returncode'] is not None or event['os_exit_code'] != 259: event['reason'] = 'OWN_PROCESS_EXITED'
        elif not event['job_member']: event['reason'] = 'JOB_MEMBERSHIP_FAILED'
        elif not event['executable_match']: event['reason'] = 'EXECUTABLE_MISMATCH'
        elif event['listener_pid'] is not None and event['listener_pid'] != process.pid:
            event['reason'] = 'LISTENER_MISMATCH'
        elif event['pid_file_state'] != 'VALID':
            event['reason'] = {'MISSING': 'PIDFILE_MISSING', 'EMPTY': 'PIDFILE_EMPTY', 'INVALID': 'PIDFILE_INVALID',
                'UNSAFE': 'PIDFILE_UNSAFE', 'READ_ERROR': 'PIDFILE_READ_ERROR', 'CHANGED': 'PIDFILE_CHANGED'}[event['pid_file_state']]
        elif event['pid_file_pid'] != process.pid: event['reason'] = 'PID_NO_COINCIDE'
        elif event['listener_pid'] is None: event['reason'] = 'LISTENER_NOT_READY'
        else: event['reason'] = 'READY'
        return event

    def check(self, process, stage):
        event = self.observe(process, stage)
        self.record(event)
        self.reason = event['reason']
        self.outcome = 'VERIFIED' if self.reason == 'READY' else 'REJECTED'
        require(self.reason == 'READY', self.reason)

    def wait_ready(self, process, *, timeout=60, interval=0.05, wait=None):
        deadline = self.clock() + timeout
        wait = Event().wait if wait is None else wait
        while True:
            event = self.observe(process, 'STARTUP_WAIT')
            self.record(event)
            self.reason = event['reason']
            if self.reason == 'READY' and self.clock() <= deadline:
                self.outcome = 'VERIFIED'
                return
            if self.reason == 'READY':
                event = dict(event, reason='STARTUP_TIMEOUT')
                self.record(event)
                self.outcome, self.reason = 'REJECTED', 'STARTUP_TIMEOUT'
                raise SafetyError(self.reason)
            # No esperar a que un PID diferente/handle/Job inválido "se arregle".
            if self.reason not in ('PIDFILE_MISSING', 'PIDFILE_EMPTY', 'LISTENER_NOT_READY'):
                self.outcome = 'REJECTED'
                raise SafetyError(self.reason)
            remaining = deadline - self.clock()
            if remaining <= 0:
                event = dict(event, reason='STARTUP_TIMEOUT')
                self.record(event)
                self.outcome, self.reason = 'REJECTED', 'STARTUP_TIMEOUT'
                raise SafetyError(self.reason)
            wait(min(interval, remaining))

    def failure(self, process, stage, reason):
        if self.outcome == 'REJECTED':
            return  # Conservar la observación original previa a retirada.
        event = self.observe(process, stage)
        if stage == 'MYSQL_SPAWN' and event['job_assignment'] == 'FAILED':
            event['reason'] = 'JOB_ASSIGNMENT_FAILED'
        else:
            event['reason'] = reason if reason in REASONS else 'SQL_OR_WORKER_FAILURE'
        self.record(event)
        self.outcome, self.reason = 'REJECTED', event['reason']

    def write(self):
        self.resources.owned()
        target = inside(self.resources.root / 'evidence/startup.json', self.resources.root)
        value = sanitize_startup({'version': 1, 'events': self.events, 'outcome': self.outcome, 'reason': self.reason})
        with target.open('x', encoding='utf-8') as stream:
            json.dump(value, stream)


def sanitize_worker_pid(value):
    keys = {'expected_pid', 'reason', 'elapsed_ms'} | PID_FIELDS
    require(type(value) is dict and set(value) == keys and value['reason'] in REASONS and
            value['pid_file_state'] in FILE_STATES, 'PID_EVIDENCE_INVALID')
    for key in keys - {'reason', 'pid_file_state'}:
        item = value[key]
        require(item is None or (type(item) is bool if key in BOOL_FIELDS else type(item) is int),
                'PID_EVIDENCE_INVALID')
    return dict(value)


class WorkerPidError(SafetyError):
    def __init__(self, evidence):
        self.pid_evidence = sanitize_worker_pid(evidence)
        super().__init__(evidence['reason'])


def check_worker_pid(pidfile, root, expected, started):
    snapshot = pid_snapshot(pidfile, root)
    state = snapshot['pid_file_state']
    reason = ('READY' if state == 'VALID' and snapshot['pid_file_pid'] == expected else
              'PID_NO_COINCIDE' if state == 'VALID' else 'PIDFILE_' + state)
    if reason != 'READY':
        raise WorkerPidError(dict(snapshot, expected_pid=expected, reason=reason,
            elapsed_ms=max(0, int((time.monotonic() - started) * 1000))))
