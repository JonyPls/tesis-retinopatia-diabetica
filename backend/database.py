import os
import queue
from functools import wraps
from dotenv import load_dotenv
import pymysql

load_dotenv()

_pool = None

def _create_connection():
    return pymysql.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', ''),
        database=os.getenv('DB_NAME', 'centro_oftalmologico_db'),
        cursorclass=pymysql.cursors.DictCursor,
    )

def _get_pool():
    global _pool
    if _pool is None:
        max_connections = 5
        _pool = queue.Queue(maxsize=max_connections)
        for _ in range(max_connections):
            _pool.put(_create_connection())
    return _pool

def use_db(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        pool = _get_pool()
        conn = pool.get()
        cursor = conn.cursor()
        try:
            result = func(cursor, *args, **kwargs)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()
            pool.put(conn)
    return wrapper
