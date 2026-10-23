"""Formatos compartidos entre el registro de pacientes y el alta de usuarios."""
import re
import unicodedata


DOCUMENT_PATTERNS = {
    'DNI': (re.compile(r'^[0-9]{8}$'), 'El DNI debe tener exactamente 8 digitos.'),
    'CE': (re.compile(r'^[A-Z0-9]{8,12}$'), 'El CE debe tener entre 8 y 12 caracteres alfanumericos.'),
    'PAS': (re.compile(r'^[A-Z0-9]{3,9}$'), 'El Pasaporte debe tener entre 3 y 9 caracteres alfanumericos.'),
}


def valid_email(value):
    if not value or any(char.isspace() or unicodedata.category(char) in ('Cc', 'Cf') for char in value):
        return False
    parts = value.split('@')
    if len(parts) != 2:
        return False
    local, domain = parts
    if (not local or local.startswith('.') or local.endswith('.') or '..' in local
            or not all(char.isalnum() or char in "!#$%&'*+/=?^_`{|}~.-" for char in local)):
        return False
    labels = domain.split('.')
    return (len(labels) >= 2 and all(label and label[0].isalnum() and label[-1].isalnum()
            and all(char.isalnum() or char == '-' for char in label) for label in labels)
            and len(labels[-1]) >= 2 and labels[-1].isalpha())
