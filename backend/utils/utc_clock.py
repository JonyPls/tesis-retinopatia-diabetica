"""UTC instants stored in MySQL DATETIME/TIMESTAMP via PyMySQL.

MySQL/PyMySQL returns naive datetimes; store a UTC naive value deliberately,
with MySQL SQLAlchemy sessions fixed at +00:00 for TIMESTAMP conversion.
"""

from datetime import datetime, timezone


def utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)
