"""Provenance of instants written through the controlled Flask ORM.

SQL defaults remain NO_VERIFICADO for other writers. This is not a security
boundary against direct SQL or a user with write access to marker columns.
"""

from sqlalchemy import CheckConstraint, event, inspect

from database import _set_utc_on_checkout
from utils.utc_clock import utc_now_naive

UNVERIFIED = 'NO_VERIFICADO'
VERIFIED = 'UTC_VERIFICADO'


def provenance_checks(prefix, fields):
    return tuple(CheckConstraint(
        f"{field}_origen IN ('NO_VERIFICADO','UTC_VERIFICADO')",
        name=f'ck_{prefix}_{field}_origen') for field in fields)


def require_utc_connection(connection):
    if (connection.dialect.name != 'mysql' or
            not event.contains(connection.engine, 'checkout', _set_utc_on_checkout) or
            connection.exec_driver_sql('SELECT @@session.time_zone').scalar() != '+00:00'):
        raise RuntimeError('La escritura temporal requiere una sesion ORM MySQL UTC')


def set_verified_utc(instance, field):
    """Only trusted services call this after generating the timestamp themselves."""
    value = utc_now_naive()
    setattr(instance, field, value)
    setattr(instance, field + '_origen', VERIFIED)
    instance._verified_utc_fields = {**getattr(instance, '_verified_utc_fields', {}), field: value}


def install_provenance(model, *, fields, updated=False, server_fields=(), nullable_fields=()):
    """Pair ORM-generated instants and markers in one INSERT/UPDATE statement."""
    for field in fields:
        @event.listens_for(getattr(model, field), 'set')
        def invalidate_approval(target, _value, _oldvalue, _initiator, field=field):
            # Any later assignment, even one with the same value, ends approval.
            getattr(target, '_verified_utc_fields', {}).pop(field, None)

    @event.listens_for(model, 'before_insert')
    def before_insert(_mapper, connection, target):
        require_utc_connection(connection)
        approved = target.__dict__.pop('_verified_utc_fields', {})
        for field in fields:
            origin = field + '_origen'
            value = getattr(target, field)
            if value is None and field in nullable_fields:
                setattr(target, origin, UNVERIFIED)
            elif value is None and field not in server_fields:
                setattr(target, field, utc_now_naive())
                setattr(target, origin, VERIFIED)
            elif value is None:
                setattr(target, origin, VERIFIED)  # SQL CURRENT_TIMESTAMP(6), UTC session
            elif approved.get(field) != value:
                setattr(target, origin, UNVERIFIED)
            elif getattr(target, origin) != VERIFIED:
                raise ValueError('Marca temporal inconsistente')

    @event.listens_for(model, 'before_update')
    def before_update(_mapper, connection, target):
        state = inspect(target)
        changed = any(state.attrs[field].history.has_changes() or
                      state.attrs[field + '_origen'].history.has_changes() for field in fields)
        if not changed and not any(attr.history.has_changes() for attr in state.attrs):
            return
        require_utc_connection(connection)
        approved = target.__dict__.pop('_verified_utc_fields', {})
        for field in fields:
            if field == 'fecha_actualizado' and updated and not state.attrs[field].history.has_changes():
                setattr(target, field, utc_now_naive())
                setattr(target, field + '_origen', VERIFIED)
            elif state.attrs[field].history.has_changes():
                value = getattr(target, field)
                if value is not None and approved.get(field) == value:
                    if getattr(target, field + '_origen') != VERIFIED:
                        raise ValueError('Marca temporal inconsistente')
                    setattr(target, field + '_origen', VERIFIED)
                else:
                    setattr(target, field + '_origen', UNVERIFIED)
            elif state.attrs[field + '_origen'].history.has_changes():
                # A marker cannot be promoted without a newly generated instant.
                if getattr(target, field + '_origen') == VERIFIED:
                    raise ValueError('No se puede acreditar una fecha no modificada')
