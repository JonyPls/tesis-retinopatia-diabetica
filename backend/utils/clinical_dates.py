"""Explicit contracts for instants and unverified persisted wall times.

Without a per-row provenance marker an ORM datetime cannot distinguish rows
written under SYSTEM from rows written under the UTC session policy.
"""

from datetime import date, datetime, timezone


def utc_instant(value, *, naive_origin=None):
    """ISO 8601 UTC for an aware instant or an explicitly verified UTC naive one."""
    if not isinstance(value, datetime):
        raise TypeError('Se requiere un instante datetime')
    if value.tzinfo is None or value.utcoffset() is None:
        if naive_origin != 'UTC':
            raise ValueError('Procedencia temporal no verificada')
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def unverified_wall_time(value):
    """Preserve components, not an assumed instant. No GMT/Z or conversion."""
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo is not None:
        raise ValueError('Se esperaba datetime naive sin procedencia acreditada')
    return value.isoformat()


def civil_date(value):
    if not isinstance(value, date) or isinstance(value, datetime):
        raise TypeError('Se esperaba una fecha civil')
    return value.isoformat()


_UNVERIFIED_FIELDS = frozenset({
    'fecha_visita', 'fecha_creado', 'fecha_actualizado',
    'fecha_validacion', 'ultima_visita', 'fecha_consentimiento',
})


def unverified_clinical_fields(value):
    """Project existing clinical read payloads without Flask's false GMT suffix."""
    if isinstance(value, list):
        return [unverified_clinical_fields(item) for item in value]
    if isinstance(value, dict):
        return {key: (unverified_wall_time(item)
                      if key in _UNVERIFIED_FIELDS and isinstance(item, datetime)
                      else civil_date(item) if key == 'fecha_nacimiento' and type(item) is date
                      else unverified_clinical_fields(item))
                for key, item in value.items()}
    return value
