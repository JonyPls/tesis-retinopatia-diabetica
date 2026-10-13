"""Explicit contracts for instants and unverified persisted wall times.

The marker must accompany each field; a naive ORM datetime alone is not proof.
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


def clinical_instant(value, origin):
    """Serialize persisted dates; fail closed for missing or unknown provenance."""
    if value is None:
        return None
    if origin == 'UTC_VERIFICADO':
        return utc_instant(value, naive_origin='UTC')
    return unverified_wall_time(value)


_UNVERIFIED_FIELDS = frozenset({
    'fecha_visita', 'fecha_creado', 'fecha_actualizado',
    'fecha_validacion', 'ultima_visita', 'fecha_consentimiento',
})


def unverified_clinical_fields(value):
    """Project clinical read payloads using their per-field markers, not Flask GMT."""
    if isinstance(value, list):
        return [unverified_clinical_fields(item) for item in value]
    if isinstance(value, dict):
        return {key: (clinical_instant(item, value.get(key + '_origen'))
                      if key in _UNVERIFIED_FIELDS and isinstance(item, datetime)
                      else civil_date(item) if key == 'fecha_nacimiento' and type(item) is date
                      else unverified_clinical_fields(item))
                for key, item in value.items()}
    return value
