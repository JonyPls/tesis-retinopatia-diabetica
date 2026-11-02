"""Inventario nativo y barrera de escrituras. Importar no consulta ningún motor."""
import re

from .safety import require


class InventoryGate:
    def __init__(self):
        self.phase = None

    def invalidate(self):
        self.phase = None

    def approve(self, phase):
        require(phase in ('base', 'full'), 'FASE_ESQUEMA_INVALIDA')
        self.phase = phase

    def ready(self, *, full=False):
        require(self.phase == 'full' if full else self.phase in ('base', 'full'),
                'FIXTURES_ANTES_DE_INVENTARIO')

    def guard_sql(self, _connection, _cursor, statement, _parameters, _context, _many):
        # Defensa adicional a seed(): también cubre DML directo y servicios reales.
        sql = re.sub(r'/\*.*?\*/|--[^\n]*', '', statement, flags=re.S).lstrip()
        if re.match(r'(INSERT|UPDATE|DELETE|REPLACE|LOAD|CALL)\b', sql, re.I) or (
                re.match(r'WITH\b', sql, re.I) and re.search(r'\b(INSERT|UPDATE|DELETE|REPLACE)\b', sql, re.I)):
            self.ready()


def checked_sequence(gate, install_base, validate_base, disabled,
                     install_extension, validate_full, enabled):
    gate.invalidate()
    install_base()
    validate_base()
    gate.ready()
    disabled()
    gate.invalidate()  # DDL parcial NO conserva la aprobación anterior.
    install_extension()
    validate_full()
    gate.ready(full=True)
    enabled()


def check_expression(sql):
    """Árbol conservador para CHECK conocidos; ignora solo formato, no precedencia."""
    pattern = r"(?:_[a-zA-Z0-9]+)?'(?:''|[^'])*'|`[^`]+`|[a-zA-Z_][a-zA-Z_0-9]*|\d+|>=|<=|<>|!=|[(),=<>+\-]"
    matches = list(re.finditer(pattern, sql))
    position = 0
    tokens = []
    for match in matches:
        require(not sql[position:match.start()].strip(), 'CHECK_NO_RECONOCIDO')
        token = match.group()
        if "'" in token:
            token = token[token.index("'"):]
        else:
            token = token.strip('`').lower()
        tokens.append(token)
        position = match.end()
    require(not sql[position:].strip(), 'CHECK_NO_RECONOCIDO')
    precedence = {'or': 1, 'and': 2, '=': 3, '<>': 3, '!=': 3, '<': 3, '>': 3,
                  '<=': 3, '>=': 3, 'in': 3, 'not in': 3, 'is': 3, 'is not': 3, '+': 4, '-': 4}
    index = 0
    def expression(minimum=0):
        nonlocal index
        require(index < len(tokens), 'CHECK_INCOMPLETO')
        token = tokens[index]
        index += 1
        if token == '(':
            values = [expression()]
            while index < len(tokens) and tokens[index] == ',':
                index += 1
                values.append(expression())
            require(index < len(tokens) and tokens[index] == ')', 'CHECK_PARENTESIS')
            index += 1
            left = values[0] if len(values) == 1 else ('list', *values)
        elif token == 'interval':
            require(index + 1 < len(tokens), 'CHECK_INTERVAL')
            left = ('interval', tokens[index], tokens[index + 1])
            index += 2
        else:
            require(token not in (')', ','), 'CHECK_OPERANDO')
            left = ('atom', token)
            if index < len(tokens) and tokens[index] == '(':
                index += 1
                values = [expression()]
                while index < len(tokens) and tokens[index] == ',':
                    index += 1
                    values.append(expression())
                require(index < len(tokens) and tokens[index] == ')', 'CHECK_FUNCION')
                index += 1
                left = ('call', token, *values)
        while index < len(tokens):
            operation = tokens[index]
            width = 1
            if index + 1 < len(tokens) and (operation, tokens[index + 1]) in (('not', 'in'), ('is', 'not')):
                operation += ' ' + tokens[index + 1]
                width = 2
            priority = precedence.get(operation, -1)
            if priority < minimum:
                break
            index += width
            right = expression(priority + 1)
            operation = '<>' if operation == '!=' else operation
            if operation in ('and', 'or'):
                operands = []
                for child in (left, right):
                    operands.extend(child[1:] if child[0] == operation else (child,))
                left = (operation, *operands)
            else:
                left = (operation, left, right)
        return left
    tree = expression()
    require(index == len(tokens), 'CHECK_SOBRANTE')
    return tree


def column_type(kind, dialect):
    value = kind.compile(dialect=dialect).lower()
    value = re.sub(r'\s+(character set|collate)\s+\w+', '', value)
    value = re.sub(r'\b(bool|boolean)\b', 'tinyint', value)
    value = re.sub(r'\bnumeric\b', 'decimal', value)
    value = re.sub(r'\b(integer|int)\b', 'int', value)
    return re.sub(r'\b(tinyint|smallint|int|bigint)\(\d+\)', r'\1', value)


def verify_inventory(h, metadata, *, full):
    """Solo aprueba después de comparar TODAS las tablas efectivas con lo autorizado."""
    from sqlalchemy import CheckConstraint, UniqueConstraint, inspect, text
    from sqlalchemy.dialects import mysql
    h.gate.invalidate()
    dialect = mysql.dialect()
    expected = dict(metadata.tables)
    if full:
        expected.update({name: table for name, table in h.db.metadata.tables.items()
                         if name.startswith('diagnostico_ia_')})
    with h.admin.connect() as connection:
        inspector = inspect(connection)
        require(set(inspector.get_table_names()) == set(expected), 'INVENTARIO_TABLAS')
        engines = dict(connection.execute(text('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES '
            'WHERE TABLE_SCHEMA=DATABASE()')).all())
        require(set(engines) == set(expected) and all(engine == 'InnoDB' for engine in engines.values()),
                'INVENTARIO_ENGINE')
        enforced = dict(connection.execute(text("SELECT CONSTRAINT_NAME, ENFORCED FROM information_schema.TABLE_CONSTRAINTS "
            "WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK'")).all())
        characters = {(row[0], row[1]): (row[2], row[3]) for row in connection.execute(text(
            'SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME '
            'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')).all()}
        require(not connection.execute(text('SELECT COUNT(*) FROM information_schema.TRIGGERS '
            'WHERE TRIGGER_SCHEMA=DATABASE()')).scalar(), 'INVENTARIO_TRIGGERS')
        for name, table in expected.items():
            actual = {column['name']: column for column in inspector.get_columns(name)}
            require(set(actual) == set(table.columns.keys()), 'INVENTARIO_COLUMNAS')
            for column in table.columns:
                reflected = actual[column.name]
                require(column_type(column.type, dialect) == column_type(reflected['type'], dialect) and
                        column.nullable == reflected['nullable'], 'INVENTARIO_TIPO_O_NULL')
                implementation = column.type.dialect_impl(dialect)
                if hasattr(implementation, 'enums'):
                    require(implementation.enums == getattr(reflected['type'], 'enums', None), 'INVENTARIO_ENUM')
                charset, collation = characters[(name, column.name)]
                require((not getattr(implementation, 'charset', None) or implementation.charset == charset) and
                        (not getattr(implementation, 'collation', None) or implementation.collation == collation),
                        'INVENTARIO_COLLATION')
                default = str(column.server_default.arg) if column.server_default is not None else None
                received = reflected.get('default')
                # SHOW puede envolver defaults literales en comillas/paréntesis.
                normalize = lambda value: None if value is None else str(value).strip("'").lower()
                require(normalize(default) == normalize(received), 'INVENTARIO_DEFAULT')
            require(inspector.get_pk_constraint(name)['constrained_columns'] ==
                    [column.name for column in table.primary_key], 'INVENTARIO_PK')
            unique = {tuple(item['column_names']) for item in inspector.get_unique_constraints(name)}
            required_unique = {tuple(column.name for column in item.columns)
                               for item in table.constraints if isinstance(item, UniqueConstraint)}
            require(unique == required_unique, 'INVENTARIO_UNIQUE')
            def fk_key(columns, parent, referred, delete=None, update=None):
                return (tuple(columns), parent, tuple(referred), (delete or 'RESTRICT').upper(),
                        (update or 'RESTRICT').upper())
            foreign = {fk_key(fk['constrained_columns'], fk['referred_table'], fk['referred_columns'],
                        fk.get('options', {}).get('ondelete'), fk.get('options', {}).get('onupdate'))
                       for fk in inspector.get_foreign_keys(name)}
            required_fk = {fk_key([e.parent.name for e in fk.elements], fk.referred_table.name,
                           [e.column.name for e in fk.elements], fk.ondelete, fk.onupdate)
                           for fk in table.foreign_key_constraints}
            require(foreign == required_fk, 'INVENTARIO_FK')
            indexes = {tuple(index['column_names']): index for index in inspector.get_indexes(name)}
            for index in table.indexes:
                columns = tuple(column.name for column in index.columns)
                require(columns in indexes and bool(indexes[columns]['unique']) == bool(index.unique),
                        'INVENTARIO_INDICE')
            checks = {item['name']: check_expression(item['sqltext'])
                      for item in inspector.get_check_constraints(name)}
            required_checks = {item.name: check_expression(str(item.sqltext))
                               for item in table.constraints if isinstance(item, CheckConstraint)}
            require(checks == required_checks and all(enforced.get(key) == 'YES' for key in checks),
                    'INVENTARIO_CHECK')
        if full:
            charset, collation = connection.execute(text("SELECT CHARACTER_SET_NAME, COLLATION_NAME "
                "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() "
                "AND TABLE_NAME='diagnostico_ia_descarte_operaciones' AND COLUMN_NAME='operacion_id'" )).one()
            require((charset, collation) == ('ascii', 'ascii_bin'), 'INVENTARIO_UUID')
    h.gate.approve('full' if full else 'base')
