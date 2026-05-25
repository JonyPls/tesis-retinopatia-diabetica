import os
import pymysql
from dotenv import load_dotenv

load_dotenv()

def obtener_conexion_bd():
    try:
        connection = pymysql.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            user=os.getenv('DB_USER', 'root'),
            password=os.getenv('DB_PASSWORD', ''),
            database=os.getenv('DB_NAME', 'centro_oftalmologico_db'),
            cursorclass=pymysql.cursors.DictCursor 
        )
        return connection
    
    except Exception as e:
        print(f"Error conectando a la base de datos: {e}")
        return None
