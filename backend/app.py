import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from database import obtener_conexion_bd
from routes.auth_routes import auth_bp
from routes.patient_routes import patient_bp
from routes.document_routes import document_bp
from routes.diagnosis_routes import diagnosis_bp
from routes.files_routes import files_bp

# Cargar variables de entorno desde el archivo .env
load_dotenv()

app = Flask(__name__)

# Habilitar CORS para permitir peticiones desde el puerto de React (5173)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')

# Registrar Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(patient_bp)
app.register_blueprint(document_bp)
app.register_blueprint(diagnosis_bp)
app.register_blueprint(files_bp) 

# --- RUTAS BASE ---

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "success", "message": "API del Centro Oftalmológico en línea."}), 200



if __name__ == '__main__':
    app.run(debug=True, port=5000)