import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from routes.auth_routes import auth_bp
from routes.patient_routes import patient_bp
from routes.document_routes import document_bp
from routes.diagnosis_routes import diagnosis_bp
from routes.files_routes import files_bp
from routes.informe_routes import informe_bp

# Cargar variables de entorno desde el archivo .env
load_dotenv()

app = Flask(__name__)

# Habilitar CORS solo para los origenes autorizados del frontend.
frontend_origins = [
    origin.strip()
    for origin in os.getenv('FRONTEND_ORIGIN', 'http://localhost:5173').split(',')
    if origin.strip()
]
CORS(app, resources={r"/*": {"origins": frontend_origins}})
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes', 'on')
private_dir = os.getenv('RETINOGRAPH_PRIVATE_DIR')
if private_dir:
    app.config['RETINOGRAPH_PRIVATE_DIR'] = private_dir

# Configurar SQLAlchemy ORM
from database import init_db
init_db(app)

# Registrar Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(patient_bp)
app.register_blueprint(document_bp)
app.register_blueprint(diagnosis_bp)
app.register_blueprint(files_bp)
app.register_blueprint(informe_bp)

# --- RUTAS BASE ---

@app.route('/', methods=['GET'])
def home():
    return jsonify({"success": True, "message": "API del Centro Oftalmológico en línea."}), 200



# Precargar CLIP para validación semántica (evita demora en primera petición)
with app.app_context():
    from dl_model.validator import _get_clip
    try:
        _get_clip()
        print("[OK] CLIP model loaded successfully")
    except Exception:
        # Puede arrancar el resto del sistema; el validador bloquea el POST.
        print("[WARN] CLIP model unavailable; image validation is disabled")

if __name__ == '__main__':
    app.run(debug=app.config['DEBUG'], port=int(os.getenv('FLASK_PORT', 5000)))
