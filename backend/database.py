import os
from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event

load_dotenv()

# --- SQLAlchemy ORM ---
db = SQLAlchemy()


def _set_utc_on_checkout(dbapi_connection, _connection_record, _connection_proxy):
    """Normalize every physical MySQL connection, including pooled checkouts."""
    try:
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET SESSION time_zone = '+00:00'")
    except Exception:
        # Never expose a DBAPI exception (which may include connection details).
        raise RuntimeError("No se pudo configurar la sesion MySQL en UTC") from None


def configure_utc_sessions(app):
    """Install the UTC policy on every MySQL engine owned by this Flask app."""
    with app.app_context():
        for engine in db.engines.values():
            if engine.dialect.name == 'mysql' and not event.contains(engine, 'checkout', _set_utc_on_checkout):
                event.listen(engine, 'checkout', _set_utc_on_checkout)

def init_db(app):
    # Configurar SQLAlchemy usando las mismas variables de entorno
    db_user = os.getenv('DB_USER', 'root')
    db_password = os.getenv('DB_PASSWORD', '')
    db_host = os.getenv('DB_HOST', 'localhost')
    db_name = os.getenv('DB_NAME', 'centro_oftalmologico_db')
    
    app.config['SQLALCHEMY_DATABASE_URI'] = f'mysql+pymysql://{db_user}:{db_password}@{db_host}/{db_name}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    db.init_app(app)
    configure_utc_sessions(app)
