"""Fixtures exclusively for CODN white-box tests; never import the real DB/app."""
from contextlib import ExitStack, nullcontext
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace as NS
from unittest.mock import MagicMock, Mock, patch
import os
import sys

ROOT = Path(__file__).resolve().parent


def module(name, **attributes):
    result = ModuleType(name)
    result.__dict__.update(attributes)
    return result


def load(name, relative, stubs=None, suppress_mkdir=False):
    with ExitStack() as stack:
        stack.enter_context(patch.dict(sys.modules, stubs or {}))
        if suppress_mkdir:
            mkdir = stack.enter_context(patch('os.makedirs'))
        spec = spec_from_file_location(name, ROOT / relative)
        result = module_from_spec(spec)
        # dataclasses resolves the defining module during class construction.
        sys.modules[name] = result
        spec.loader.exec_module(result)
        if suppress_mkdir:
            mkdir.assert_called_once()
        return result


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class DiagnosisValidationError(Exception):
    def __init__(self, message='Entrada sintética rechazada', status_code=404):
        super().__init__(message)
        self.status_code = status_code


class ConfirmationUseError(DiagnosisValidationError):
    pass


def db_stub():
    return module('database', db=MagicMock(name='isolated_database'))


def auth_targets():
    repository = Mock(name='AuthRepository')
    stubs = {'src.repositories.auth_repository': module(
        'src.repositories.auth_repository', AuthRepository=repository)}
    auth = load('codn_auth_target', 'services/auth_service.py', stubs)
    security = load('codn_security_target', 'utils/security.py', stubs)
    policy = load('codn_policy_target', 'utils/strict_authorization.py',
                  {'utils.security': security})
    return auth, security, policy, repository


def patient_target():
    stubs = {
        'database': db_stub(),
        'src.repositories.patient_repository': module(
            'src.repositories.patient_repository', PatientRepository=Mock()),
        'src.repositories.document_repository': module(
            'src.repositories.document_repository', DocumentRepository=Mock()),
        'src.models.patient_entities': module('src.models.patient_entities', Paciente=Mock()),
    }
    return load('codn_patient_target', 'services/patient_service.py', stubs)


def report_target():
    repository = Mock(name='InformeRepository')
    repository.NotFound, repository.Conflict = NotFound, Conflict
    stubs = {
        'database': db_stub(),
        'src.repositories.informe_repository': module(
            'src.repositories.informe_repository', InformeRepository=repository),
        'src.repositories.diagnosis_discard_repository': module(
            'src.repositories.diagnosis_discard_repository', DiagnosisDiscardRepository=Mock()),
    }
    # Real gate is safe because database is already replaced before its import.
    gate = load('codn_report_gate', 'utils/diagnosis_discard_gate.py', stubs)
    stubs['utils.diagnosis_discard_gate'] = gate
    return load('codn_report_target', 'services/informe_service.py', stubs)


def photo_targets():
    # Import actual light image libraries before patch.dict restores sys.modules.
    import cv2
    import numpy
    import PIL.Image
    validator = load('codn_validator_target', 'dl_model/validator.py', {
        'torch': module('torch', no_grad=nullcontext),
        'transformers': module('transformers', CLIPModel=Mock(), CLIPProcessor=Mock()),
    })
    stubs = {
        'database': db_stub(),
        'dl_model.validator': validator,
        'dl_model.inference': module('dl_model.inference', predecir_imagen_bytes=Mock()),
        'src.repositories.diagnosis_repository': module(
            'src.repositories.diagnosis_repository', DiagnosisRepository=Mock(),
            DiagnosisValidationError=DiagnosisValidationError),
        'src.repositories.diagnosis_discard_repository': module(
            'src.repositories.diagnosis_discard_repository', DiagnosisDiscardRepository=Mock()),
        'services.retinograph_confirmation_service': module(
            'services.retinograph_confirmation_service', ConfirmationUseError=ConfirmationUseError),
    }
    gate = load('codn_photo_gate', 'utils/diagnosis_discard_gate.py', stubs)
    stubs['utils.diagnosis_discard_gate'] = gate
    service = load('codn_photo_target', 'services/diagnosis_service.py', stubs, True)
    return validator, service


def actor(*roles, active=True):
    """roles: (policy code, iterable of permission codes). No real identities."""
    return NS(id=42, username='actor_sintetico', nombres='Actor', apellidos='Prueba',
              estado='ACTIVO' if active else 'INACTIVO', cargo=None,
              roles=[code for code, _ in roles], permisos=[],
              roles_rel=[NS(rol=NS(codigo=code, estado='ACTIVO', permisos_rel=[
                  NS(permiso=NS(codigo=permission, estado='ACTIVO'))
                  for permission in permissions])) for code, permissions in roles])
