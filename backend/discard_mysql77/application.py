"""Fábrica y metadatos sintéticos; los imports funcionales son solo dentro de B."""
from contextlib import ExitStack
from datetime import date, timedelta
from io import BytesIO
import os
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from .safety import inside, require
from .schema import InventoryGate


GRANTS = ('pacientes.ver', 'visitas.ver', 'diagnostico_retinopatia.ver', 'imagenes.ver',
          'diagnostico_retinopatia.descartar_pendiente', 'diagnostico_retinopatia.crear',
          'diagnostico_retinopatia.validar', 'visitas.crear', 'informes.crear')


class Predictor:
    """La barrera vive fuera de SQL; cada llamada devuelve un dict nuevo."""
    def __init__(self):
        self.pause = lambda: None

    def __call__(self, _data):
        import numpy as np
        self.pause()
        return {'cam_image_array': np.zeros((350, 350, 3), dtype=np.uint8),
                'confianza_general': 80, 'diagnostico_codigo': 2,
                'diagnostico_texto': 'Sintético', 'probabilidades_detalle': {'2': 80}}


def load_application(payload, stack):
    """Se invoca desde el worker nuevo, con cwd y sys.path en la copia verificada."""
    from flask import Flask
    from sqlalchemy.engine import URL
    root = Path(payload['root'])
    backend = inside(root / 'backend', root)
    require(Path.cwd() == backend and Path(__file__).resolve().parent == backend / 'discard_mysql77',
            'NO_IMPORTAR_DESDE_HABITUAL')
    require('app' not in sys.modules and 'database' not in sys.modules, 'PROCESO_NO_LIMPIO')
    predictor = Predictor()
    validator = ModuleType('dl_model.validator')
    validator.MAX_IMAGE_BYTES, validator.MAX_IMAGE_SIDE, validator.MAX_IMAGE_PIXELS = 20_000_000, 8192, 30_000_000
    for name in ('validar_formato_y_dimensiones', 'validar_region_circular', 'validar_contenido_semantico'):
        setattr(validator, name, lambda *a, **kw: {'valido': True})
    inference = ModuleType('dl_model.inference')
    inference.predecir_imagen_bytes = predictor
    pdf = ModuleType('services.report_service')
    pdf.ReportNotFoundError = type('ReportNotFoundError', (Exception,), {})
    pdf.ReportTemplateError = type('ReportTemplateError', (Exception,), {})
    def forbidden_pdf(*_a, **_kw):
        raise AssertionError('PDF fuera del ensayo')
    pdf.generar_reporte_diagnostico_pdf = forbidden_pdf
    stack.enter_context(patch('dotenv.load_dotenv', return_value=False))
    stack.enter_context(patch.dict(os.environ, {'SECRET_KEY': payload['jwt_key'],
        'RETINOGRAPH_EXPORT_DIR': str(root / 'exports')}))
    stack.enter_context(patch.dict(sys.modules, {'dl_model.validator': validator,
        'dl_model.inference': inference, 'services.report_service': pdf}))
    from database import db, configure_utc_sessions
    from routes.diagnosis_routes import diagnosis_bp
    from routes.diagnosis_discard_routes import diagnosis_discard_bp
    from routes.informe_routes import informe_bp
    from routes.files_routes import files_bp, RETINAS_FOLDER
    from services.diagnosis_service import UPLOAD_FOLDER
    from src.models import auth_entities as auth, patient_entities as patients
    from src.models import diagnosis_entities as diagnosis, informe_entities as reports
    from src.models import diagnosis_discard_entities as technical
    from utils import diagnosis_discard_storage as storage
    app = Flask('codn77_synthetic')
    app.config.update(TESTING=True, SECRET_KEY=payload['jwt_key'],
        SQLALCHEMY_DATABASE_URI=URL.create('mysql+pymysql', username='codn77_app',
            password=payload['app_password'], host='127.0.0.1', port=payload['port'], database=payload['schema']),
        SQLALCHEMY_ENGINE_OPTIONS={'isolation_level': 'REPEATABLE READ', 'pool_size': 8,
                                   'max_overflow': 0, 'hide_parameters': True,
                                   'connect_args': {'connect_timeout': 3,
                                   'read_timeout': 15, 'write_timeout': 15, 'local_infile': False}},
        SQLALCHEMY_TRACK_MODIFICATIONS=False, DIAGNOSIS_DISCARD_ENABLED=False,
        DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=False, DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=False,
        DIAGNOSIS_DISCARD_STORAGE_ROOT=str(backend / 'uploads/retinas'),
        RETINOGRAPH_PRIVATE_DIR=str(root / 'private'))
    db.init_app(app)
    configure_utc_sessions(app)
    for blueprint in (diagnosis_bp, diagnosis_discard_bp, informe_bp, files_bp):
        app.register_blueprint(blueprint)
    with app.app_context():
        expected = inside(backend / 'uploads/retinas', root)
        require(Path(storage.storage_root()) == expected == Path(UPLOAD_FOLDER) == Path(RETINAS_FOLDER),
                'RAICES_NO_COINCIDEN')
    return SimpleNamespace(app=app, db=db, predictor=predictor, auth=auth, patients=patients, gate=InventoryGate(),
                           diagnosis=diagnosis, reports=reports, technical=technical,
                           payload=payload, root=root, storage=storage)


def synthetic_metadata(h):
    """Copia de tablas reales, no muta ORM. Único overlay: tipos PK/FK compatibles."""
    from sqlalchemy import MetaData, BigInteger, Integer
    from sqlalchemy.dialects.mysql import BIGINT, INTEGER
    metadata = MetaData()
    for table in h.db.metadata.sorted_tables:
        if table.name.startswith('diagnostico_ia_'):
            continue  # Se instala la propuesta 72 exacta, no create_all técnico.
        table.to_metadata(metadata)
    # Las extensiones ya requieren usuarios/pacientes INT U y visita/detalle BIGINT U.
    # Propagar exclusivamente esos dominios a todas sus FK, sin inventar UNIQUE.
    targets = {('usuarios', 'id'), ('pacientes', 'id'), ('visitas_clinicas', 'id'),
               ('diagnosticos_retinopatia_detalle', 'id')}
    for table in metadata.tables.values():
        table.dialect_options['mysql']['engine'] = 'InnoDB'
        table.dialect_options['mysql']['charset'] = 'utf8mb4'
        for column in table.columns:
            domain = (table.name, column.name)
            linked = {(fk.column.table.name, fk.column.name) for fk in column.foreign_keys}
            if domain in targets or linked & targets:
                column.type = BIGINT(unsigned=True) if isinstance(column.type, BigInteger) else INTEGER(unsigned=True)
    return metadata


def jpeg():
    from PIL import Image
    stream = BytesIO()
    Image.new('RGB', (350, 350), (12, 24, 36)).save(stream, 'JPEG')
    return stream.getvalue()


def seed(h, *, eyes=('Derecho', 'Izquierdo')):
    """Fixture nuevo por caso: todos los IDs proceden de flush, sin limpiar tablas."""
    h.gate.ready(full=h.app.config['DIAGNOSIS_DISCARD_ENABLED'])
    db, a, p, d, r = h.db, h.auth, h.patients, h.diagnosis, h.reports
    suffix = uuid4().hex
    def add(model, **values):
        row = model(**values)
        db.session.add(row)
        db.session.flush()
        return row
    document = add(a.TipoDocumento, codigo=suffix[:10], nombre='Sintético')
    cargo = add(a.Cargo, nombre='Sintético ' + suffix)
    roles = {}
    # El motor exige código exacto: roles se comparten por catálogo, no por fixture.
    for key, code in (('clinical', 'OFTALMOLOGO'), ('admin', 'ADMINISTRADOR_SISTEMA')):
        existing = a.Rol.query.filter_by(codigo=code).first()
        roles[key] = existing or add(a.Rol, codigo=code, nombre=code)
    permissions = {}
    for code in GRANTS:
        permissions[code] = a.Permiso.query.filter_by(codigo=code).first() or add(
            a.Permiso, codigo=code, nombre=code, modulo='synthetic77')
        if not db.session.get(a.RolPermiso, (roles['clinical'].id, permissions[code].id)):
            add(a.RolPermiso, rol_id=roles['clinical'].id, permiso_id=permissions[code].id)
    users = []
    for index in range(3):
        user = add(a.Usuario, username=f'{suffix}{index}', password_hash='SYNTHETIC_NO_LOGIN',
            nombres='Sintético', apellidos='Ensayo', correo=f'{suffix}{index}@example.invalid',
            tipo_doc_id=document.id, cargo_id=cargo.id, nro_documento=f'{suffix[:12]}{index}')
        add(a.UsuarioRol, usuario_id=user.id, rol_id=roles['admin' if index == 2 else 'clinical'].id)
        users.append(user)
    patient = add(p.Paciente, tipo_doc_id=document.id, nro_documento=suffix[:20],
        nombres='Paciente sintético', apellidos='Ensayo', sexo='Masculino', fecha_nacimiento=date(2000, 1, 1))
    grades = {}
    for code in range(5):
        grades[code] = d.GradoRetinopatia.query.filter_by(codigo=str(code)).first() or add(
            d.GradoRetinopatia, codigo=str(code), nombre=f'Sintético {code}')
    visit = add(p.VisitaClinica, paciente_id=patient.id, usuario_id=users[0].id)
    diagnosis = add(d.Diagnostico, visita_id=visit.id, usuario_id=users[0].id, estado='PROCESADO')
    details = {}
    for eye in eyes:
        name = f'P{patient.id}_{eye}_{uuid4().hex}.jpg'
        for filename in (name, name.replace('.jpg', '_gradcam.jpg')):
            inside(Path(h.app.config['DIAGNOSIS_DISCARD_STORAGE_ROOT']) / filename, h.root).write_bytes(jpeg())
        details[eye] = add(d.DiagnosticoDetalle, diagnostico_retinopatia_id=diagnosis.id,
            ojo_evaluado=eye, imagen_original_url=name, imagen_gradcam_url=name.replace('.jpg', '_gradcam.jpg'),
            resultado_ia_id=grades[2].id, probabilidad_ia=0.8, nombre_archivo_original='synthetic.jpg',
            hash_archivo='a' * 64)
    report_type = add(r.TipoInforme, nombre='Sintético', codigo_formulario='synthetic77')
    db.session.commit()
    fixture = SimpleNamespace(patient=patient.id, visit=visit.id, diagnosis=diagnosis.id,
        users=[u.id for u in users], details={eye: detail.id for eye, detail in details.items()},
        grades={code: row.id for code, row in grades.items()}, report_type=report_type.id,
        roles={key: value.id for key, value in roles.items()}, permissions={key: row.id for key, row in permissions.items()})
    db.session.remove()
    return fixture


def request(h, f, method, path, *, actor=None, body=None, data=None):
    import jwt
    import time
    token = jwt.encode({'user_id': actor or f.users[0], 'exp': int(time.time()) + 300},
                       h.payload['jwt_key'], algorithm='HS256')
    with h.app.test_client() as client:
        response = client.open(path, method=method, json=body, data=data,
                               headers={'Authorization': 'Bearer ' + token})
        return response.status_code, response.get_json()


def discard_body(f, ids=None, **overrides):
    return {**dict(paciente_id=f.patient, diagnostico_retinopatia_id=f.diagnosis,
        detalle_ids=ids or [f.details['Izquierdo']], revision_esperada=0,
        operacion_id=str(uuid4()), confirmo_descarte=True), **overrides}


def confirmation(h, f, detail_id=None):
    from utils.utc_clock import utc_now_naive
    import hashlib
    from utils.retinograph_private_storage import PrivateCopy
    private = PrivateCopy()
    data = jpeg()
    private.publish(data)
    now = utc_now_naive()
    row = h.diagnosis.ConfirmacionExportacionRetinografo(
        token_verificador=os.urandom(32), paciente_id=f.patient, confirmado_por=f.users[0],
        ojo_confirmado='Derecho' if detail_id == f.details.get('Derecho') else 'Izquierdo',
        nombre_exportacion='synthetic77.jpg',
        sha256_fuente=hashlib.sha256(data).hexdigest(), clave_copia=private.key,
        fecha_confirmacion=now, fecha_expiracion=now + timedelta(minutes=60),
        estado='CONSUMIDA' if detail_id else 'CONFIRMADA', detalle_id=detail_id,
        fecha_consumo=now if detail_id else None)
    h.db.session.add(row)
    h.db.session.commit()
    return row.id
