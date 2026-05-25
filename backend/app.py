import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from database import obtener_conexion_bd
from routes.auth_routes import auth_bp
from routes.patient_routes import patient_bp

# Cargar variables de entorno desde el archivo .env
load_dotenv()

app = Flask(__name__)

# Habilitar CORS para permitir peticiones desde el puerto de React (5173)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')

# Registrar Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(patient_bp)

# --- RUTAS BASE ---

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "success", "message": "API del Centro Oftalmológico en línea."}), 200

@app.route('/api/test-db', methods=['GET'])
def test_db():
    """Endpoint de depuración para verificar la conexión a MySQL."""
    conn = obtener_conexion_bd()
    if conn:
        conn.close()
        return jsonify({"status": "success", "message": "¡Conexión a MySQL exitosa y lista para transacciones!"}), 200
    else:
        return jsonify({"status": "error", "message": "Fallo al conectar con la base de datos. Revisa tus credenciales en el archivo .env"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)