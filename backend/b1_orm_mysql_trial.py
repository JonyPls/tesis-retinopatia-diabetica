"""Integración B1 real contra el MySQL temporal verificado por el arnés.

No es una suite descubierta automáticamente: run_orm_integration se invoca
solo tras inicializar y comprobar la instancia desechable. No importa app.py.
"""

from contextlib import contextmanager
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import partial
from io import BytesIO
import hashlib
import importlib.util
import inspect as python_inspect
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time
from threading import Barrier, Event
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask, jsonify, request
import jwt
from sqlalchemy import event, inspect, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from pymysql.err import IntegrityError as MySQLIntegrityError
from werkzeug.security import generate_password_hash
from PIL import Image
from utils.utc_clock import utc_now_naive

# database.py llama load_dotenv al importarse: impedir incluso su lectura.
with patch("dotenv.load_dotenv", return_value=False):
    from database import db, configure_utc_sessions, _set_utc_on_checkout
    from routes.auth_routes import auth_bp
    from routes.patient_routes import patient_bp
    from routes import patient_routes, files_routes, informe_routes
    from src.models.auth_entities import (Cargo, Permiso, Rol, RolPermiso,
                                          TipoDocumento, Usuario, UsuarioRol)
    from src.models.patient_entities import Paciente, VisitaClinica
    from src.repositories.patient_repository import PatientRepository
    from src.repositories.diagnosis_repository import DiagnosisRepository
    from src.repositories.informe_repository import InformeRepository
    from test_diagnosis_input import validator as real_validator, image_bytes
    from utils import diagnosis_storage  # Mantener clase única tras patch.dict(sys.modules).
    import numpy as np
    from src.models import diagnosis_entities, informe_entities  # Registrar metadatos ORM.
    from src.repositories.auth_repository import AuthRepository
    from utils.security import clinical_access_required, token_required
    from utils.strict_authorization import evaluate_operation, strict_authorization_required

    # Importar rutas reales sin cargar CLIP/ResNet50.
    # La generación PDF no participa en esta prueba de diagnóstico.
    fake_validator = ModuleType("dl_model.validator")
    fake_validator.MAX_IMAGE_BYTES = 20 * 1024 * 1024
    fake_validator.MAX_IMAGE_SIDE = 8192
    fake_validator.MAX_IMAGE_PIXELS = 30_000_000
    for name in ("validar_formato_y_dimensiones", "validar_region_circular",
                 "validar_contenido_semantico"):
        setattr(fake_validator, name, lambda *_, **__: None)
    fake_inference = ModuleType("dl_model.inference")
    fake_inference.predecir_imagen_bytes = lambda *_: None
    fake_pdf = ModuleType("services.report_service")
    fake_pdf.ReportNotFoundError = type("ReportNotFoundError", (Exception,), {})
    fake_pdf.ReportTemplateError = type("ReportTemplateError", (Exception,), {})
    fake_pdf.generar_reporte_diagnostico_pdf = lambda *_: None
    with patch.dict(sys.modules, {
        "dl_model.validator": fake_validator,
        "dl_model.inference": fake_inference,
        "services.report_service": fake_pdf,
    }):
        from routes import diagnosis_routes
        from services import diagnosis_service
        from services import retinograph_import_service
        from services import retinograph_confirmation_service


TEST_KEY = "b1-only-disposable-orm-integration-signing-key"
TEST_PASSWORD = "synthetic-only-orm-test-password"


class RealORMStrictIntegrationTests(unittest.TestCase):
    config = None  # Se establece solo desde run_orm_integration.

    @classmethod
    def setUpClass(cls):
        port, password = cls.config
        cls.environment = patch.dict(os.environ, {"SECRET_KEY": TEST_KEY})
        cls.environment.start()
        cls.addClassCleanup(cls.environment.stop)
        cls.app = Flask("b1_disposable_orm")
        cls.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI=URL.create(
                "mysql+pymysql", username="root", password=password,
                host="127.0.0.1", port=port, database="centro_oftalmologico_db_v2",
            ),
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(cls.app)  # Nunca init_db(app) ni db.create_all().
        configure_utc_sessions(cls.app)  # Misma politica que init_db, sin .env.
        cls.context = cls.app.app_context()
        cls.context.push()
        cls.addClassCleanup(cls.context.pop)
        cls.addClassCleanup(db.session.remove)
        cls.app.register_blueprint(auth_bp)
        cls.app.register_blueprint(patient_bp)
        cls.app.register_blueprint(files_routes.files_bp)
        cls.app.register_blueprint(diagnosis_routes.diagnosis_bp)
        cls.app.register_blueprint(informe_routes.informe_bp)
        cls.image_directory = tempfile.TemporaryDirectory(
            prefix="b1-orm-images-", dir=r"C:\Users\ricar\AppData\Local\Temp\opencode")
        cls.addClassCleanup(cls.image_directory.cleanup)
        cls.image_directory_patch = patch.object(
            files_routes, "RETINAS_FOLDER", cls.image_directory.name)
        cls.image_directory_patch.start()
        cls.addClassCleanup(cls.image_directory_patch.stop)
        cls.retino_directory = tempfile.TemporaryDirectory(
            prefix="b1-orm-retinograph-", dir=r"C:\Users\ricar\AppData\Local\Temp\opencode")
        cls.addClassCleanup(cls.retino_directory.cleanup)
        cls.retino_directory_patch = patch.object(
            retinograph_import_service, "RETINOGRAPH_EXPORT_DIR", cls.retino_directory.name)
        cls.retino_directory_patch.start()
        cls.addClassCleanup(cls.retino_directory_patch.stop)
        cls.private_directory = tempfile.TemporaryDirectory(
            prefix='b1-orm-private-', dir=r'C:\Users\ricar\AppData\Local\Temp\opencode')
        cls.addClassCleanup(cls.private_directory.cleanup)
        cls.app.config['RETINOGRAPH_PRIVATE_DIR'] = cls.private_directory.name
        for name in ("synthetic-only.jpg", "synthetic-gradcam.jpg", "unregistered.jpg"):
            Path(cls.image_directory.name, name).write_bytes(b"\xff\xd8\xff\xd9")

        # El mismo handler real, temporalmente protegido con el esquema antiguo,
        # permite comparar contratos sin modificar rutas de producción.
        raw_search = python_inspect.unwrap(patient_routes.buscar_pacientes)
        raw_recent = python_inspect.unwrap(patient_routes.get_pacientes_recientes)

        @cls.app.get("/api/_orm_baseline_search")
        @partial(token_required, eager_permissions=True)
        @clinical_access_required("pacientes.ver")
        def baseline_search():
            return raw_search()

        @cls.app.get("/api/_orm_baseline_recent")
        @partial(token_required, eager_permissions=True)
        @clinical_access_required("pacientes.ver")
        def baseline_recent():
            return raw_recent()

        @cls.app.get("/api/_orm_patient/<int:patient_id>")
        @strict_authorization_required("patients.read")
        def patient(patient_id):
            row = db.session.get(Paciente, patient_id)
            return (jsonify({"success": bool(row), "id": patient_id}),
                    200 if row else 404)

        @cls.app.get("/api/_orm_legacy_patient/<int:patient_id>")
        @token_required
        @clinical_access_required("pacientes.ver")
        def legacy_patient(patient_id):
            row = db.session.get(Paciente, patient_id)
            return (jsonify({"success": bool(row), "id": patient_id}),
                    200 if row else 404)

        @cls.app.get("/api/_orm_baseline_patient/<int:patient_id>")
        @token_required
        def baseline_patient(patient_id):
            # Replica exclusivamente el segundo SELECT del motor B1 anterior.
            user = AuthRepository.get_active_user_by_id(request.current_user["user_id"])
            if not evaluate_operation(user, "patients.read"):
                return jsonify({"success": False}), 403
            row = db.session.get(Paciente, patient_id)
            return (jsonify({"success": bool(row), "id": patient_id}),
                    200 if row else 404)

        @cls.app.post("/api/_orm_register")
        @strict_authorization_required("patients.create")
        def register():
            return jsonify({"success": True}), 201  # No registra pacientes.

        @cls.app.post("/api/_orm_diagnose")
        @strict_authorization_required("diagnosis.create")
        def diagnose():
            return jsonify({"success": True}), 201  # No ejecuta inferencia.

        @cls.app.put("/api/_orm_validate")
        @strict_authorization_required("diagnosis.validate")
        def validate():
            return jsonify({"success": True})

        @cls.app.get("/api/_orm_history/<int:patient_id>")
        @strict_authorization_required("history.full_read")
        def history(patient_id):
            return jsonify({"success": db.session.get(Paciente, patient_id) is not None})

        @cls.app.get("/api/_orm_pdf")
        @strict_authorization_required("diagnosis.pdf_read")
        def pdf():
            return jsonify({"success": True})  # No genera PDF ni lee imágenes.

        @cls.app.delete("/api/_orm_report")
        @strict_authorization_required("reports.inactivate")
        def delete_report():
            return jsonify({"success": True})

        @cls.app.get("/api/_orm_configuration")
        @strict_authorization_required("configuration.read")
        def configuration():
            return jsonify({"success": True})

        @cls.app.get("/api/_orm_unknown")
        @strict_authorization_required("unknown.operation")
        def unknown():
            return jsonify({"success": True})

        cls.client = cls.app.test_client()
        cls.user_ids = {}
        cls.patient_ids = []
        cls.patient_documents = []
        cls.visit_ids = []
        cls.diagnosis_ids = []
        cls.report_ids = []
        cls.addClassCleanup(cls.cleanup_fixtures)
        try:
            cls.make_fixtures()
        except Exception:
            raise RuntimeError("No se pudieron crear fixtures ORM sintéticas temporales.") from None
        cls.retino_files = {}
        for eye, format_name, extension in (("R", "JPEG", "jpg"), ("L", "PNG", "png")):
            filename = f"{cls.patient_documents[0]}_01012026_101010_fundus_{eye}_1.{extension}"
            buffer = BytesIO()
            Image.new("RGB", (350, 350), (35, 60, 90)).save(buffer, format=format_name)
            cls.retino_files[eye] = (filename, buffer.getvalue())
            Path(cls.retino_directory.name, filename).write_bytes(buffer.getvalue())
        assert "app" not in sys.modules
        assert "dl_model.inference" not in sys.modules
        assert "dl_model.validator" not in sys.modules

    @classmethod
    def make_fixtures(cls):
        document = TipoDocumento.query.filter_by(codigo="DNI").one()
        cargo = Cargo.query.filter_by(nombre="Medico Oftalmologo").one()
        roles = {role.codigo: role for role in Rol.query.all()}
        stamp = secrets.token_hex(5)
        for index, (profile, role_codes) in enumerate((
            ("ophthalmologist", ("OFTALMOLOGO",)),
            ("colleague", ("OFTALMOLOGO",)),
            ("nurse", ("ENFERMERO",)),
            ("assistant", ("ASISTENTE_ADMINISTRATIVO",)),
            ("administrator", ("ADMINISTRADOR_SISTEMA",)),
            ("dual", ("ADMINISTRADOR_SISTEMA", "OFTALMOLOGO")),
            ("assistant_dual", ("ASISTENTE_ADMINISTRATIVO", "OFTALMOLOGO")),
        ), 1):
            user = Usuario(
                username=f"b1_{stamp}_{index}",
                password_hash=generate_password_hash(TEST_PASSWORD, method="pbkdf2:sha256:1000"),
                nombres="Persona", apellidos="Sintetica",
                correo=f"b1_{stamp}_{index}@example.invalid",
                tipo_doc_id=document.id, cargo_id=cargo.id,
                nro_documento=str(91000000 + index), estado="ACTIVO",
            )
            user.roles_rel = [UsuarioRol(rol=roles[code]) for code in role_codes]
            db.session.add(user)
            db.session.flush()
            cls.user_ids[profile] = user.id
        for index in (1, 2):
            patient = Paciente(
                tipo_doc_id=document.id, nro_documento=str(92000000 + index),
                nombres="Paciente", apellidos="Ficticio", sexo="Masculino",
                fecha_nacimiento=date(2000, 1, 1), consentimiento_informado=True,
                telefono="900000000", correo="paciente@example.invalid",
                direccion="Direccion ficticia", antecedentes_clinicos="Antecedente sintetico",
                alergias="Alergia sintetica", estado="ACTIVO",
            )
            db.session.add(patient)
            db.session.flush()
            cls.patient_ids.append(patient.id)
            cls.patient_documents.append(patient.nro_documento)
        visit = VisitaClinica(
            paciente_id=cls.patient_ids[0], usuario_id=cls.user_ids["ophthalmologist"],
            fecha_visita=datetime(2030, 1, 1), motivo_consulta="Motivo sintetico",
            observaciones="Observacion sintetica", estado="ACTIVA",
        )
        db.session.add(visit)
        db.session.flush()
        cls.visit_ids.append(visit.id)
        diagnosis = diagnosis_entities.Diagnostico(
            visita_id=visit.id, usuario_id=cls.user_ids["ophthalmologist"],
            modelo_nombre="Modelo sintetico", estado="PROCESADO",
        )
        diagnosis.detalles.append(diagnosis_entities.DiagnosticoDetalle(
            ojo_evaluado="Derecho", imagen_original_url="synthetic-only.jpg",
            imagen_gradcam_url="synthetic-gradcam.jpg", resultado_ia_id=2,
            resultado_final_id=3, probabilidad_ia=0.8,
            resultado_completo={"diagnostico_texto": "RD Moderado",
                                "probabilidades_detalle": {"grado_2": 80}},
            estado_validacion="CORREGIDO",
            comentario_medico="Conclusion sintetica",
        ))
        diagnosis.detalles.append(diagnosis_entities.DiagnosticoDetalle(
            ojo_evaluado="Izquierdo", imagen_original_url="synthetic-left.jpg",
            imagen_gradcam_url="synthetic-left-gradcam.jpg", resultado_ia_id=1,
            resultado_final_id=1, probabilidad_ia=0.65,
            resultado_completo={"diagnostico_texto": "RD Leve",
                                "probabilidades_detalle": {"grado_1": 65}},
            estado_validacion="APROBADO",
        ))
        db.session.add(diagnosis)
        db.session.flush()
        cls.diagnosis_ids.append(diagnosis.id)
        report = informe_entities.Informe(
            visita_id=visit.id, tipo_informe_id=1,
            usuario_id=cls.user_ids["ophthalmologist"],
            conclusion="Informe sintetico", datos_estructurados={"nota": "Sintetica"},
            estado="ACTIVO",
        )
        db.session.add(report)
        db.session.flush()
        cls.report_ids.append(report.id)
        visit_without_diagnosis = VisitaClinica(
            paciente_id=cls.patient_ids[0], usuario_id=cls.user_ids["ophthalmologist"],
            fecha_visita=datetime(2030, 2, 1), motivo_consulta="Control sintetico",
            estado="ACTIVA",
        )
        db.session.add(visit_without_diagnosis)
        db.session.flush()
        cls.visit_ids.append(visit_without_diagnosis.id)
        db.session.commit()
        db.session.remove()

    @classmethod
    def cleanup_fixtures(cls):
        db.session.remove()
        for report_id in cls.report_ids:
            report = db.session.get(informe_entities.Informe, report_id)
            if report:
                db.session.delete(report)
        db.session.flush()
        for diagnosis_id in cls.diagnosis_ids:
            diagnosis = db.session.get(diagnosis_entities.Diagnostico, diagnosis_id)
            if diagnosis:
                db.session.delete(diagnosis)
        db.session.flush()
        for visit_id in cls.visit_ids:
            visit = db.session.get(VisitaClinica, visit_id)
            if visit:
                db.session.delete(visit)
        db.session.flush()
        for patient_id in cls.patient_ids:
            patient = db.session.get(Paciente, patient_id)
            if patient:
                db.session.delete(patient)
        for user_id in cls.user_ids.values():
            user = db.session.get(Usuario, user_id)
            if user:
                db.session.delete(user)
        db.session.commit()
        db.session.remove()

    def setUp(self):
        db.session.remove()
        self.created_documents = []

    def tearDown(self):
        db.session.rollback()
        if self.created_documents:
            for patient in Paciente.query.filter(Paciente.nro_documento.in_(self.created_documents)).all():
                db.session.delete(patient)
            db.session.commit()
        db.session.remove()

    def registration(self, **extra):
        document = str(10000000 + secrets.randbelow(89999999))
        self.created_documents.append(document)
        return {
            "tipo_doc": "DNI", "nro_documento": document,
            "nombres": "Persona", "apellidos": "Ficticia", "sexo": "Femenino",
            "fecha_nacimiento": "2000-01-01", "telefono": "900000000",
            "correo": "registro@example.invalid", "direccion": "Direccion ficticia",
            "consentimiento_informado": True, **extra,
        }

    def test_28c_confirmation_orm_matches_master_and_relates_to_detail(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        actual = inspect(db.engine).get_columns(model.__tablename__)
        self.assertEqual({column['name'] for column in actual},
                         {column.name for column in model.__table__.columns})
        for column in actual:
            self.assertEqual(column['nullable'], model.__table__.c[column['name']].nullable)
        for name in ('id', 'paciente_id', 'confirmado_por', 'detalle_id', 'revocada_por'):
            self.assertTrue(model.__table__.c[name].type.unsigned)
            self.assertTrue(next(col for col in actual if col['name'] == name)['type'].unsigned)
        for name in ('fecha_confirmacion', 'fecha_expiracion', 'fecha_consumo', 'fecha_revocacion'):
            self.assertEqual(model.__table__.c[name].type.fsp, 6)
            self.assertEqual(next(col for col in actual if col['name'] == name)['type'].fsp, 6)
        self.assertEqual(model.__table__.c.token_verificador.type.length, 32)
        for name, length in (('nombre_exportacion', 255), ('sha256_fuente', 64),
                             ('clave_copia', 32)):
            self.assertEqual(model.__table__.c[name].type.length, length)
            self.assertEqual(next(col for col in actual if col['name'] == name)['type'].length,
                             length)
        self.assertEqual(model.__table__.c.estado.type.enums,
                         ['CONFIRMADA', 'CONSUMIDA', 'REVOCADA'])
        self.assertEqual({constraint.name for constraint in model.__table__.constraints
                          if isinstance(constraint, db.CheckConstraint)},
                         {check['name'] for check in inspect(db.engine).get_check_constraints(
                             model.__tablename__)})
        self.assertEqual({fk.name for fk in model.__table__.foreign_key_constraints},
                         {'fk_confirmacion_paciente', 'fk_confirmacion_profesional',
                          'fk_confirmacion_revocador', 'fk_confirmacion_detalle'})
        detail = diagnosis_entities.DiagnosticoDetalle.query.filter_by(
            diagnostico_retinopatia_id=self.diagnosis_ids[0], ojo_evaluado='Derecho').one()
        detail_id = detail.id
        confirmed_at = datetime(2030, 1, 1, 12, 0, 0, 123456)
        entry = model(token_verificador=b'\x28' * 32, paciente_id=self.patient_ids[0],
                      confirmado_por=self.user_ids['ophthalmologist'],
                      ojo_confirmado='Derecho', nombre_exportacion='synthetic_R_1.jpg',
                      sha256_fuente='a' * 64, clave_copia='b' * 32,
                      fecha_confirmacion=confirmed_at,
                      fecha_expiracion=confirmed_at + timedelta(minutes=60),
                      estado='CONSUMIDA', detalle_id=detail_id, fecha_consumo=confirmed_at)
        try:
            db.session.add(entry)
            db.session.commit()
            identifier = entry.id
            db.session.remove()
            restored = db.session.get(model, identifier)
            self.assertEqual(restored.detalle.id, detail_id)
            self.assertEqual(restored.detalle.diagnostico.visita_id, self.visit_ids[0])
            self.assertEqual(restored.paciente.id, self.patient_ids[0])
            self.assertEqual(restored.confirmador.id, self.user_ids['ophthalmologist'])
            self.assertIsNone(restored.revocador)
            self.assertEqual(restored.fecha_confirmacion, confirmed_at)
        finally:
            db.session.rollback()
            if entry.id is not None:
                db.session.query(model).filter_by(id=entry.id).delete()
                db.session.commit()
            db.session.remove()

    def test_28c_http_confirmation_private_copy_status_and_revoke(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        base = '/api/diagnosticar/retinografo/confirmaciones'
        patient_id = self.patient_ids[0]
        professional = self.user_ids['ophthalmologist']
        name, image = self.retino_files['R']
        payload = {'paciente_id': patient_id, 'nombre_exportacion': name,
                   'ojo_confirmado': 'Derecho', 'sha256_previsualizacion': hashlib.sha256(image).hexdigest(),
                   'confirmo_asociacion': True}
        token = self.token()
        before = set(Path(self.private_directory.name).iterdir())
        stored_ids = []
        try:
            with patch.object(retinograph_confirmation_service, 'read_export') as denied_open:
                for profile in ('administrator', 'nurse', 'assistant'):
                    denied, sql = self.call(base, method='POST', token=self.token(profile),
                                            json_data=payload, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(sum(q.lstrip().lower().startswith('select') for q in sql), 3)
                    self.assertFalse(any('from pacientes' in q.lower().replace('`', '') or
                                         'confirmaciones_exportacion' in q.lower() for q in sql))
                denied, sql = self.call(base, method='POST', json_data=payload, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
                denied_open.assert_not_called()
                self.assertEqual(set(Path(self.private_directory.name).iterdir()), before)
            with patch.object(retinograph_confirmation_service, 'read_export',
                              wraps=retinograph_confirmation_service.read_export) as read:
                created, statements = self.call(base, method='POST', token=token,
                                                json_data=payload, measure=True)
                self.assertEqual(created.status_code, 201, created.json)
                self.assertEqual(read.call_count, 1)
            secret = created.json['confirmacion']['identificador']
            self.assertEqual(len(secret), 64)
            self.assertEqual(created.headers['Cache-Control'], 'private, no-store')
            self.assertNotIn(name, created.get_data(as_text=True))
            self.assertEqual(sum('insert into confirmaciones_exportacion_retinografo'
                                 in q.lower().replace('`', '') for q in statements), 1)
            self.assertEqual(sum(q.lstrip().lower().startswith('select') for q in statements), 4)
            self.assertEqual(sum('from pacientes' in q.lower().replace('`', '')
                                 for q in statements), 1)
            digest = hashlib.sha256(bytes.fromhex(secret)).digest()
            db.session.remove()
            row = model.query.filter_by(token_verificador=digest).one()
            stored_ids.append(row.id)
            self.assertEqual(row.confirmado_por, professional)
            self.assertEqual(row.paciente_id, patient_id)
            self.assertEqual(row.sha256_fuente, hashlib.sha256(image).hexdigest())
            self.assertEqual(row.fecha_expiracion - row.fecha_confirmacion, timedelta(minutes=60))
            self.assertEqual(len(row.clave_copia), 32)
            self.assertNotEqual(row.clave_copia, secret)
            self.assertEqual(Path(self.private_directory.name, row.clave_copia).read_bytes(), image)
            self.assertEqual(len(list(Path(self.private_directory.name).iterdir())), len(before) + 1)
            status, status_sql = self.call(base + '/estado', method='POST', token=token,
                                           json_data={'identificador': secret}, measure=True)
            self.assertEqual(status.status_code, 200)
            self.assertEqual(sum(q.lstrip().lower().startswith('select') for q in status_sql), 4)
            self.assertTrue(status.json['confirmacion']['vigente'])
            self.assertNotIn('clave_copia', status.get_data(as_text=True))
            for path in (base + '/estado', base + '/revocar'):
                inaccessible, _ = self.call(path, method='POST', token=self.token('colleague'),
                                             json_data={'identificador': secret})
                self.assertEqual(inaccessible.status_code, 404)
                missing, _ = self.call(path, method='POST', token=token,
                                        json_data={'identificador': '0' * 64})
                self.assertEqual(missing.status_code, 404)
            revoked, revoke_sql = self.call(base + '/revocar', method='POST', token=token,
                                            json_data={'identificador': secret}, measure=True)
            self.assertEqual(revoked.status_code, 200)
            self.assertEqual(sum('update confirmaciones_exportacion_retinografo'
                                 in q.lower().replace('`', '') for q in revoke_sql), 1)
            again, _ = self.call(base + '/revocar', method='POST', token=token,
                                 json_data={'identificador': secret})
            self.assertEqual(again.status_code, 409)
            db.session.remove()
            row = model.query.filter_by(token_verificador=digest).one()
            self.assertEqual((row.estado, row.revocada_por), ('REVOCADA', professional))
            self.assertIsNotNone(row.fecha_revocacion)
            self.assertEqual(Path(self.private_directory.name, row.clave_copia).read_bytes(), image)
            print('ORM confirmación: creación=4 SELECT (3 autorización+1 paciente), '
                  '1 apertura y 1 INSERT/copia; consulta=4 SELECT; revocación=1 UPDATE; '
                  '401/403 sin SELECT clínicos.')
        finally:
            db.session.rollback()
            for identifier in stored_ids:
                db.session.query(model).filter_by(id=identifier).delete()
            db.session.commit()
            db.session.remove()
            # Solo recursos sintéticos de esta prueba; la limpieza real no es automática.
            for path in set(Path(self.private_directory.name).iterdir()) - before:
                path.unlink()

    def test_28c_confirmation_conflicts_expiry_and_compensation(self):
        from sqlalchemy.exc import IntegrityError

        base = '/api/diagnosticar/retinografo/confirmaciones'
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        name, image = self.retino_files['L']
        payload = {'paciente_id': self.patient_ids[0], 'nombre_exportacion': name,
                   'ojo_confirmado': 'Izquierdo',
                   'sha256_previsualizacion': hashlib.sha256(image).hexdigest(),
                   'confirmo_asociacion': True}
        before = set(Path(self.private_directory.name).iterdir())
        token = self.token()
        stored_ids = []
        try:
            for changes, expected in (({'paciente_id': 987654321}, 404),
                                      ({'nombre_exportacion': '../x.jpg'}, 400),
                                      ({'nombre_exportacion': '99999999_01012026_101010_fundus_L_1.png'}, 404),
                                      ({'ojo_confirmado': 'Derecho'}, 409),
                                      ({'sha256_previsualizacion': '0' * 64}, 409)):
                response, _ = self.call(base, method='POST', token=token,
                                        json_data={**payload, **changes})
                self.assertEqual(response.status_code, expected)
            original = Path(self.retino_directory.name, name)
            other = original.read_bytes()
            try:
                changed = BytesIO()
                Image.new('RGB', (350, 350), (90, 35, 60)).save(changed, 'PNG')
                original.write_bytes(changed.getvalue())
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 409)
                original.unlink()
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 404)
                original.write_bytes(b'not-an-image')
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 422)
            finally:
                original.write_bytes(other)
            self.assertEqual(set(Path(self.private_directory.name).iterdir()), before)

            with patch.dict(self.app.config, {'RETINOGRAPH_PRIVATE_DIR': 'relative/private'}):
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 503)
            self.assertEqual(set(Path(self.private_directory.name).iterdir()), before)

            # El error de flush es anterior al commit: compensar solo archivos propios.
            with patch.object(retinograph_confirmation_service.db.session, 'flush',
                              side_effect=IntegrityError('synthetic', {}, Exception())):
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 500)
            self.assertEqual(set(Path(self.private_directory.name).iterdir()), before)
            db.session.remove()
            self.assertEqual(model.query.filter_by(confirmado_por=self.user_ids['ophthalmologist']).count(), 0)

            # El resultado de commit puede ser incierto: jamás retirar la copia.
            with patch.object(retinograph_confirmation_service.db.session, 'commit',
                              side_effect=IntegrityError('synthetic', {}, Exception())):
                response, _ = self.call(base, method='POST', token=token, json_data=payload)
                self.assertEqual(response.status_code, 500)
            uncertain = set(Path(self.private_directory.name).iterdir()) - before
            self.assertEqual(len(uncertain), 1)
            self.assertNotIn('identificador', response.get_data(as_text=True))
            db.session.remove()
            self.assertEqual(model.query.filter_by(confirmado_por=self.user_ids['ophthalmologist']).count(), 0)

            created, _ = self.call(base, method='POST', token=token, json_data=payload)
            self.assertEqual(created.status_code, 201)
            secret = created.json['confirmacion']['identificador']
            db.session.remove()
            record = model.query.filter_by(
                token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
            record_id = record.id
            stored_ids.append(record_id)
            record.fecha_confirmacion -= timedelta(hours=2)
            record.fecha_expiracion -= timedelta(hours=2)
            db.session.commit()
            db.session.remove()
            status, _ = self.call(base + '/estado', method='POST', token=token,
                                  json_data={'identificador': secret})
            self.assertEqual(status.status_code, 200)
            self.assertTrue(status.json['confirmacion']['expirada'])
            self.assertFalse(status.json['confirmacion']['vigente'])
            response, _ = self.call(base + '/revocar', method='POST', token=token,
                                    json_data={'identificador': secret})
            self.assertEqual(response.status_code, 409)
            db.session.remove()
            self.assertEqual(db.session.get(model, record_id).estado, 'CONFIRMADA')
            print('ORM confirmación: 400/404/409/422/503, rollback y commit incierto; '
                  'expiración derivada y revocación expirada=409.')
        finally:
            db.session.rollback()
            for identifier in stored_ids:
                db.session.query(model).filter_by(id=identifier).delete()
            db.session.commit()
            db.session.remove()
            # Solo directorio sintético temporal; el servicio no borra huérfanos ambiguos.
            for path in set(Path(self.private_directory.name).iterdir()) - before:
                path.unlink()

    def test_28c_concurrent_revocation_and_consumed_rejection(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        base = '/api/diagnosticar/retinografo/confirmaciones'
        name, image = self.retino_files['L']
        body = {'paciente_id': self.patient_ids[0], 'nombre_exportacion': name,
                'ojo_confirmado': 'Izquierdo',
                'sha256_previsualizacion': hashlib.sha256(image).hexdigest(),
                'confirmo_asociacion': True}
        before = set(Path(self.private_directory.name).iterdir())
        identifiers = []
        try:
            for attempt in (1, 2):
                created, _ = self.call(base, method='POST', token=self.token(), json_data=body)
                self.assertEqual(created.status_code, 201)
                secret = created.json['confirmacion']['identificador']
                db.session.remove()
                record = model.query.filter_by(
                    token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
                identifiers.append(record.id)
                if attempt == 1:
                    barrier = Barrier(3)

                    def worker():
                        with self.app.app_context():
                            barrier.wait(timeout=10)
                            client = self.app.test_client()
                            response = client.post(base + '/revocar',
                                headers={'Authorization': f'Bearer {self.token()}'},
                                json={'identificador': secret})
                            db.session.remove()
                            return response.status_code

                    db.session.remove()
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        first = pool.submit(worker)
                        second = pool.submit(worker)
                        barrier.wait(timeout=10)
                        self.assertEqual(sorted((first.result(timeout=15), second.result(timeout=15))),
                                         [200, 409])
                else:
                    detail = diagnosis_entities.DiagnosticoDetalle.query.filter_by(
                        diagnostico_retinopatia_id=self.diagnosis_ids[0],
                        ojo_evaluado='Izquierdo').one()
                    record.estado = 'CONSUMIDA'
                    record.detalle_id = detail.id
                    record.fecha_consumo = record.fecha_confirmacion
                    db.session.commit()
                    response, _ = self.call(base + '/revocar', method='POST', token=self.token(),
                                            json_data={'identificador': secret})
                    self.assertEqual(response.status_code, 409)
                    status, _ = self.call(base + '/estado', method='POST', token=self.token(),
                                          json_data={'identificador': secret})
                    self.assertEqual(status.json['confirmacion']['estado'], 'CONSUMIDA')
            print('ORM revocación: dos solicitudes concurrentes 200/409; consumida=409.')
        finally:
            db.session.rollback()
            for identifier in identifiers:
                db.session.query(model).filter_by(id=identifier).delete()
            db.session.commit()
            db.session.remove()
            for path in set(Path(self.private_directory.name).iterdir()) - before:
                path.unlink()

    def token(self, profile="ophthalmologist", *, expires=True, expired=False, claims_roles=None):
        claims = {
            "user_id": self.user_ids[profile], "roles": claims_roles or ["Admin"],
        }
        if expires:
            offset = -1 if expired else 1
            claims["exp"] = datetime.now(timezone.utc) + timedelta(hours=offset)
        return jwt.encode(claims, TEST_KEY, algorithm="HS256")

    def call(self, path, *, method="GET", token=None, measure=False, json_data=None):
        db.session.remove()  # Simula una solicitud real nueva sin cache entre requests.
        statements = []
        engine = db.engine

        def count_sql(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)  # Solo en memoria; nunca imprimir parámetros o SQL.

        if measure:
            event.listen(engine, "before_cursor_execute", count_sql)
        try:
            headers = {"Authorization": f"Bearer {token}"} if token else None
            response = self.client.open(path, method=method, headers=headers,
                                        **({"json": json_data} if json_data is not None else {}))
        finally:
            if measure:
                event.remove(engine, "before_cursor_execute", count_sql)
            db.session.remove()
        return response, statements

    @contextmanager
    def temporary_grant(self, role_code, permission_code, *, present):
        role = Rol.query.filter_by(codigo=role_code).one()
        permission = Permiso.query.filter_by(codigo=permission_code).one()
        identifiers = (role.id, permission.id)
        previous = RolPermiso.query.get(identifiers)
        previous_created_at = previous.fecha_creado if previous else None
        if bool(previous) != present:
            if present:
                db.session.add(RolPermiso(rol_id=identifiers[0], permiso_id=identifiers[1]))
            else:
                db.session.delete(previous)
            db.session.commit()
        db.session.remove()
        try:
            yield
        finally:
            existing = RolPermiso.query.get(identifiers)
            if bool(existing) != bool(previous):
                if previous:
                    db.session.add(RolPermiso(
                        rol_id=identifiers[0], permiso_id=identifiers[1],
                        fecha_creado=previous_created_at,
                    ))
                else:
                    db.session.delete(existing)
                db.session.commit()
            db.session.remove()

    @contextmanager
    def temporary_state(self, model, identifier, state):
        row = db.session.get(model, identifier)
        original = row.estado
        row.estado = state
        db.session.commit()
        db.session.remove()
        try:
            yield
        finally:
            row = db.session.get(model, identifier)
            row.estado = original
            db.session.commit()
            db.session.remove()

    @contextmanager
    def pending_validation(self):
        visit = VisitaClinica(paciente_id=self.patient_ids[1],
                             usuario_id=self.user_ids["ophthalmologist"], estado="ACTIVA")
        db.session.add(visit)
        db.session.flush()
        diagnosis = diagnosis_entities.Diagnostico(
            visita_id=visit.id, usuario_id=self.user_ids["ophthalmologist"],
            modelo_nombre="Modelo sintetico", estado="PROCESADO",
        )
        diagnosis.detalles = [diagnosis_entities.DiagnosticoDetalle(
            ojo_evaluado=eye, imagen_original_url="synthetic-only.jpg", resultado_ia_id=grade,
            estado_validacion="PENDIENTE",
        ) for eye, grade in (("Derecho", 2), ("Izquierdo", 1))]
        db.session.add(diagnosis)
        db.session.commit()
        ids = [detail.id for detail in diagnosis.detalles]
        diagnosis_id = diagnosis.id
        visit_id = visit.id
        db.session.remove()
        try:
            yield ids, diagnosis_id
        finally:
            db.session.remove()
            diagnosis = db.session.get(diagnosis_entities.Diagnostico, diagnosis_id)
            if diagnosis:
                db.session.delete(diagnosis)
                db.session.flush()
            visit = db.session.get(VisitaClinica, visit_id)
            if visit:
                db.session.delete(visit)
            db.session.commit()
            db.session.remove()

    @contextmanager
    def empty_diagnosis_visit(self):
        visit = VisitaClinica(paciente_id=self.patient_ids[1],
                             usuario_id=self.user_ids["ophthalmologist"], estado="ACTIVA")
        db.session.add(visit)
        db.session.commit()
        visit_id = visit.id
        db.session.remove()
        try:
            yield visit_id
        finally:
            db.session.remove()
            diag = diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first()
            if diag:
                db.session.delete(diag)
                db.session.flush()
            visit = db.session.get(VisitaClinica, visit_id)
            db.session.delete(visit)
            db.session.commit()
            db.session.remove()

    @contextmanager
    def stubbed_creation(self, *, semantic=None):
        with tempfile.TemporaryDirectory(prefix="b1-create-images-",
                                         dir=r"C:\Users\ricar\AppData\Local\Temp\opencode") as folder:
            infer = lambda *_: {
                "diagnostico_codigo": 2, "diagnostico_texto": "Moderada",
                "confianza_general": 85.0, "probabilidades_detalle": {"G2_Moderada": 85.0},
                "cam_image_array": np.zeros((400, 400, 3), dtype=np.uint8),
            }
            with patch.object(diagnosis_service, 'UPLOAD_FOLDER', folder), \
                 patch.object(diagnosis_service, 'validar_formato_y_dimensiones',
                              real_validator.validar_formato_y_dimensiones), \
                 patch.object(diagnosis_service, 'validar_region_circular',
                              return_value={"valido": True}), \
                 patch.object(diagnosis_service, 'validar_contenido_semantico',
                              side_effect=semantic or (lambda *_: {"valido": True})), \
                 patch.object(diagnosis_service, 'predecir_imagen_bytes', side_effect=infer) as model:
                yield folder, model

    def create_image(self, *, eye="Derecho", patient=None, visit=None, alias=None,
                     raw=None, filename="synthetic.jpg", mimetype="image/jpeg", token=None):
        from io import BytesIO
        data = {"paciente_id": str(patient or self.patient_ids[1]), "ojo_evaluado": eye,
                "imagen": (BytesIO(raw if raw is not None else image_bytes('JPEG')),
                           filename, mimetype)}
        if visit is not None:
            data["visita_id"] = str(visit)
        if alias is not None:
            data["diagnostico_id"] = str(alias)
        db.session.remove()
        response = self.client.post('/api/diagnosticar', data=data,
            content_type='multipart/form-data',
            headers={"Authorization": "Bearer " + (token or self.token())})
        db.session.remove()
        return response

    @contextmanager
    def confirmed_export(self, *, eye='R', patient=None, profile='ophthalmologist'):
        patient_id = patient or self.patient_ids[1]
        index = self.patient_ids.index(patient_id)
        document = self.patient_documents[index]
        name = f'{document}_01012026_101010_fundus_{eye}_{secrets.randbelow(10**9)}.png'
        data = image_bytes('PNG')
        path = Path(self.retino_directory.name, name)
        path.write_bytes(data)
        try:
            response, _ = self.call('/api/diagnosticar/retinografo/confirmaciones',
                                    method='POST', token=self.token(profile), json_data={
                'paciente_id': patient_id, 'nombre_exportacion': name,
                'ojo_confirmado': 'Derecho' if eye == 'R' else 'Izquierdo',
                'sha256_previsualizacion': hashlib.sha256(data).hexdigest(),
                'confirmo_asociacion': True,
            })
            self.assertEqual(response.status_code, 201, response.json)
            yield response.json['confirmacion']['identificador'], data, name
        finally:
            path.unlink(missing_ok=True)

    def consume_export(self, token, *, patient=None, eye='Derecho', visit=None,
                       profile='ophthalmologist', image=None, extra=None):
        data = {'paciente_id': str(patient or self.patient_ids[1]),
                'ojo_evaluado': eye, 'confirmacion_exportacion': token,
                **(extra or {})}
        if visit is not None:
            data['visita_id'] = str(visit)
        if image is not None:
            data['imagen'] = (BytesIO(image), 'manual.jpg', 'image/jpeg')
        db.session.remove()
        response = self.app.test_client().post('/api/diagnosticar', data=data,
            content_type='multipart/form-data',
            headers={'Authorization': 'Bearer ' + self.token(profile)})
        db.session.remove()
        return response

    def test_28d_confirmed_export_consumes_two_eyes_transactionally(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        patient_id = self.patient_ids[1]
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        tokens = []
        visit_id = None
        try:
            with self.stubbed_creation() as (folder, infer):
                with self.confirmed_export(eye='R') as (right, right_bytes, right_name), \
                     self.confirmed_export(eye='L') as (left, left_bytes, left_name):
                    tokens.extend((right, left))
                    with patch.object(diagnosis_service, 'predecir_imagen_bytes',
                                      wraps=diagnosis_service.predecir_imagen_bytes) as model_call:
                        observed = []

                        def record_sql(conn, cursor, statement, parameters, context, executemany):
                            observed.append((statement, time.perf_counter()))

                        with patch.object(retinograph_confirmation_service, 'read_export',
                                          wraps=retinograph_confirmation_service.read_export) as source_read, \
                             patch.object(retinograph_confirmation_service, 'read_private_copy',
                                          wraps=retinograph_confirmation_service.read_private_copy) as copy_read:
                            event.listen(db.engine, 'before_cursor_execute', record_sql)
                            try:
                                first = self.consume_export(right)
                                elapsed = time.perf_counter()
                            finally:
                                event.remove(db.engine, 'before_cursor_execute', record_sql)
                            self.assertEqual((source_read.call_count, copy_read.call_count), (2, 2))
                        statements = [sql.lower().replace('`', '') for sql, _ in observed]
                        self.assertEqual(sum('update confirmaciones_exportacion_retinografo'
                                             in sql for sql in statements), 1)
                        self.assertEqual(sum('insert into diagnosticos_retinopatia_detalle'
                                             in sql for sql in statements), 1)
                        locked_at = next(stamp for sql, stamp in observed if 'for update' in sql.lower())
                        self.assertLess(elapsed - locked_at, 5)
                        self.assertEqual(first.status_code, 200, first.json)
                        visit_id = first.json['data']['visita_id']
                        self.assertEqual(model_call.call_args.args[0], right_bytes)
                        second = self.consume_export(left, eye='Izquierdo', visit=visit_id)
                        self.assertEqual(second.status_code, 200, second.json)
                        self.assertEqual(model_call.call_args.args[0], left_bytes)
                        self.assertEqual(model_call.call_count, 2)
                    for secret, original, name, response, eye in (
                            (right, right_bytes, right_name, first, 'Derecho'),
                            (left, left_bytes, left_name, second, 'Izquierdo')):
                        db.session.remove()
                        stored = model.query.filter_by(
                            token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
                        detail = db.session.get(diagnosis_entities.DiagnosticoDetalle,
                                                response.json['data']['detalle_id'])
                        self.assertEqual((stored.estado, stored.detalle_id, stored.ojo_confirmado),
                                         ('CONSUMIDA', detail.id, eye))
                        self.assertIsNotNone(stored.fecha_consumo)
                        self.assertEqual((detail.hash_archivo, detail.ojo_evaluado,
                                          detail.nombre_archivo_original),
                                         (hashlib.sha256(original).hexdigest(), eye, name))
                        self.assertEqual(db.session.get(VisitaClinica,
                            detail.diagnostico.visita_id).paciente_id, patient_id)
                        with Image.open(Path(folder, detail.imagen_original_url)) as saved:
                            self.assertEqual(saved.format, 'JPEG')
                            self.assertEqual(saved.size, (400, 400))
                        self.assertTrue(Path(folder, detail.imagen_gradcam_url).is_file())
                        self.assertEqual(root.joinpath(stored.clave_copia).read_bytes(), original)
                        status, _ = self.call('/api/diagnosticar/retinografo/confirmaciones/estado',
                                              method='POST', token=self.token(),
                                              json_data={'identificador': secret})
                        self.assertEqual(status.json['confirmacion']['estado'], 'CONSUMIDA')
                        self.assertFalse(status.json['confirmacion']['vigente'])
                        self.assertEqual(self.consume_export(secret, visit=visit_id,
                            eye=eye).status_code, 409)
                        revoked, _ = self.call('/api/diagnosticar/retinografo/confirmaciones/revocar',
                                               method='POST', token=self.token(),
                                               json_data={'identificador': secret})
                        self.assertEqual(revoked.status_code, 409)
                    self.assertEqual(len(set(root.iterdir()) - before), 2)
                    print('ORM consumo: 2 ojos, 2 bytes IA iguales a copias, 2 detalles ligados; '
                          f'fuente=2 lecturas, copia=2, 1 INSERT detalle+1 UPDATE consumo; '
                          f'primer FOR UPDATE a respuesta={elapsed - locked_at:.3f}s; '
                          'reutilización y revocación=409.')
        finally:
            db.session.rollback()
            for secret in tokens:
                digest = hashlib.sha256(bytes.fromhex(secret)).digest()
                db.session.query(model).filter_by(token_verificador=digest).delete()
            db.session.flush()
            if visit_id is not None:
                visit = db.session.get(VisitaClinica, visit_id)
                if visit is not None:
                    diagnosis = diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first()
                    if diagnosis:
                        db.session.delete(diagnosis)
                        db.session.flush()
                    db.session.delete(visit)
            db.session.commit()
            db.session.remove()
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_two_posts_compete_for_same_confirmation(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        secret = None
        try:
            with self.empty_diagnosis_visit() as first_visit, \
                 self.empty_diagnosis_visit() as second_visit, \
                 self.stubbed_creation() as (folder, infer), \
                 self.confirmed_export() as (secret, image, name):
                barrier = Barrier(3)
                original_infer = diagnosis_service.predecir_imagen_bytes

                def gated_infer(data):
                    barrier.wait(timeout=15)  # Ambas peticiones terminan CLIP antes del lock.
                    return original_infer(data)

                def worker(visit):
                    with self.app.app_context():
                        return self.consume_export(secret, visit=visit).status_code

                try:
                    with patch.object(diagnosis_service, 'predecir_imagen_bytes',
                                      side_effect=gated_infer):
                        with ThreadPoolExecutor(max_workers=2) as pool:
                            first = pool.submit(worker, first_visit)
                            second = pool.submit(worker, second_visit)
                            barrier.wait(timeout=15)
                            outcomes = sorted((first.result(timeout=30), second.result(timeout=30)))
                            self.assertEqual(outcomes, [200, 409], outcomes)
                    db.session.remove()
                    record = model.query.filter_by(
                        token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
                    self.assertEqual(record.estado, 'CONSUMIDA')
                    self.assertEqual(db.session.query(diagnosis_entities.DiagnosticoDetalle)
                                     .join(diagnosis_entities.Diagnostico)
                                     .filter(diagnosis_entities.Diagnostico.visita_id.in_(
                                         (first_visit, second_visit))).count(), 1)
                    self.assertEqual(record.detalle_id,
                        db.session.query(diagnosis_entities.DiagnosticoDetalle.id)
                        .join(diagnosis_entities.Diagnostico)
                        .filter(diagnosis_entities.Diagnostico.visita_id.in_(
                            (first_visit, second_visit))).scalar())
                    print('ORM consumo simultáneo: 2 conexiones, barrera pre-IA, '
                          'un solo commit y 1 detalle (200/409).')
                finally:
                    db.session.rollback()
                    db.session.query(model).filter_by(
                        token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).delete()
                    db.session.commit()
                    db.session.remove()
        finally:
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_two_confirmations_same_visit_and_eye_preserve_loser(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        secrets_used = []
        try:
            with self.empty_diagnosis_visit() as visit_id, \
                 self.stubbed_creation() as (folder, infer), \
                 self.confirmed_export() as (first_token, first_bytes, first_name), \
                 self.confirmed_export() as (second_token, second_bytes, second_name):
                secrets_used.extend((first_token, second_token))
                barrier = Barrier(3)
                original_infer = diagnosis_service.predecir_imagen_bytes

                def gated_infer(data):
                    barrier.wait(timeout=15)
                    return original_infer(data)

                def worker(secret):
                    with self.app.app_context():
                        return self.consume_export(secret, visit=visit_id).status_code

                try:
                    with patch.object(diagnosis_service, 'predecir_imagen_bytes',
                                      side_effect=gated_infer):
                        with ThreadPoolExecutor(max_workers=2) as pool:
                            first = pool.submit(worker, first_token)
                            second = pool.submit(worker, second_token)
                            barrier.wait(timeout=15)
                            outcomes = sorted((first.result(timeout=30), second.result(timeout=30)))
                            self.assertEqual(outcomes, [200, 409], outcomes)
                    db.session.remove()
                    stored = [model.query.filter_by(
                        token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
                        for secret in secrets_used]
                    self.assertEqual(sorted(row.estado for row in stored), ['CONFIRMADA', 'CONSUMIDA'])
                    diagnosis = diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).one()
                    self.assertEqual(len(diagnosis.detalles), 1)
                    self.assertEqual(next(row.detalle_id for row in stored if row.estado == 'CONSUMIDA'),
                                     diagnosis.detalles[0].id)
                    self.assertEqual(len(list(Path(folder).glob('*.jpg'))), 2)
                    print('ORM mismo ojo/visita: 2 conexiones, un detalle y un consumo; '
                          'confirmación perdedora permanece CONFIRMADA.')
                finally:
                    db.session.rollback()
                    for secret in secrets_used:
                        db.session.query(model).filter_by(token_verificador=
                            hashlib.sha256(bytes.fromhex(secret)).digest()).delete()
                    db.session.commit()
                    db.session.remove()
        finally:
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_revocation_during_inference_prevents_consumption(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        try:
            with self.empty_diagnosis_visit() as visit_id, \
                 self.stubbed_creation() as (folder, infer), \
                 self.confirmed_export() as (secret, image, name):
                entered, resume = Event(), Event()
                original_infer = diagnosis_service.predecir_imagen_bytes

                def gated_infer(data):
                    entered.set()
                    if not resume.wait(timeout=15):
                        raise RuntimeError('Inferencia sintética no reanudada')
                    return original_infer(data)

                def worker():
                    with self.app.app_context():
                        return self.consume_export(secret, visit=visit_id).status_code

                try:
                    with patch.object(diagnosis_service, 'predecir_imagen_bytes',
                                      side_effect=gated_infer):
                        with ThreadPoolExecutor(max_workers=1) as pool:
                            future = pool.submit(worker)
                            self.assertTrue(entered.wait(timeout=15))
                            revoked, _ = self.call(
                                '/api/diagnosticar/retinografo/confirmaciones/revocar',
                                method='POST', token=self.token(),
                                json_data={'identificador': secret})
                            self.assertEqual(revoked.status_code, 200)
                            resume.set()
                            self.assertEqual(future.result(timeout=30), 409)
                    db.session.remove()
                    record = model.query.filter_by(
                        token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).one()
                    self.assertEqual(record.estado, 'REVOCADA')
                    self.assertIsNone(record.detalle_id)
                    self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(
                        visita_id=visit_id).first())
                    self.assertEqual(list(Path(folder).glob('*.jpg')), [])
                    self.assertTrue(root.joinpath(record.clave_copia).is_file())
                    print('ORM revocación durante IA: revocación 200 antes del lock; '
                          'inferencia 409 sin detalle ni JPEG.')
                finally:
                    resume.set()
                    db.session.rollback()
                    db.session.query(model).filter_by(
                        token_verificador=hashlib.sha256(bytes.fromhex(secret)).digest()).delete()
                    db.session.commit()
                    db.session.remove()
        finally:
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_preflight_and_final_check_reject_changes_without_inference(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        try:
            with self.empty_diagnosis_visit() as visit_id, \
                 self.stubbed_creation() as (folder, infer), \
                 self.confirmed_export() as (secret, original, name):
                digest = hashlib.sha256(bytes.fromhex(secret)).digest()
                source = Path(self.retino_directory.name, name)
                db.session.remove()
                record = model.query.filter_by(token_verificador=digest).one()
                copy_path = root / record.clave_copia
                record_id = record.id
                try:
                    attempts = ((secret, self.patient_ids[0], 'Derecho', 'ophthalmologist', 409),
                                (secret, self.patient_ids[1], 'Izquierdo', 'ophthalmologist', 409),
                                (secret, self.patient_ids[1], 'Derecho', 'colleague', 404),
                                ('0' * 64, self.patient_ids[1], 'Derecho', 'ophthalmologist', 404))
                    for value, patient, eye, profile, expected in attempts:
                        response = self.consume_export(value, patient=patient, eye=eye,
                                                       visit=visit_id, profile=profile)
                        self.assertEqual(response.status_code, expected, response.json)
                        infer.assert_not_called()
                    # Expirada conforme al límite exacto, sin estado adicional.
                    record = db.session.get(model, record_id)
                    original_dates = record.fecha_confirmacion, record.fecha_expiracion
                    record.fecha_confirmacion -= timedelta(hours=2)
                    record.fecha_expiracion -= timedelta(hours=2)
                    db.session.commit()
                    self.assertEqual(self.consume_export(secret, visit=visit_id).status_code, 409)
                    record = db.session.get(model, record_id)
                    record.fecha_confirmacion, record.fecha_expiracion = original_dates
                    db.session.commit()
                    infer.assert_not_called()

                    copy_path.write_bytes(b'altered')
                    self.assertEqual(self.consume_export(secret, visit=visit_id).status_code, 409)
                    copy_path.write_bytes(original)
                    copy_path.unlink()
                    self.assertEqual(self.consume_export(secret, visit=visit_id).status_code, 503)
                    copy_path.write_bytes(original)
                    source.unlink()
                    self.assertEqual(self.consume_export(secret, visit=visit_id).status_code, 409)
                    source.write_bytes(image_bytes('PNG', (400, 401)))
                    self.assertEqual(self.consume_export(secret, visit=visit_id).status_code, 409)
                    source.write_bytes(original)
                    infer.assert_not_called()

                    db.session.remove()
                    before_diagnoses = db.session.query(diagnosis_entities.Diagnostico).count()
                    before_details = db.session.query(diagnosis_entities.DiagnosticoDetalle).count()
                    before_jpegs = set(Path(folder).glob('*.jpg'))
                    with patch.object(diagnosis_service, 'validar_contenido_semantico',
                                       return_value={'valido': False, 'status': 503}):
                        unavailable = self.consume_export(secret, visit=visit_id)
                    self.assertEqual(unavailable.status_code, 503)
                    infer.assert_not_called()  # CLIP fail-closed también para bytes confirmados.
                    db.session.remove()
                    retained = db.session.get(model, record_id)
                    self.assertEqual(retained.estado, 'CONFIRMADA')
                    self.assertIsNone(retained.detalle_id)
                    self.assertIsNone(retained.fecha_consumo)
                    self.assertEqual(db.session.query(diagnosis_entities.Diagnostico).count(), before_diagnoses)
                    self.assertEqual(db.session.query(diagnosis_entities.DiagnosticoDetalle).count(), before_details)
                    self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())
                    self.assertEqual(set(Path(folder).glob('*.jpg')), before_jpegs)
                    self.assertEqual(copy_path.read_bytes(), original)
                    self.assertEqual(unavailable.json.get('success'), False)
                    self.assertNotIn(secret, unavailable.get_data(as_text=True))
                    for sensitive in (name, retained.clave_copia, str(copy_path),
                                      self.patient_documents[1]):
                        self.assertNotIn(sensitive, unavailable.get_data(as_text=True))

                    # Cambio después de CLIP/IA: rechazo definitivo bajo lock.
                    def altered_source(data):
                        source.write_bytes(image_bytes('PNG', (400, 401)))
                        return diagnosis_service_result(data)

                    diagnosis_service_result = diagnosis_service.predecir_imagen_bytes
                    with patch.object(diagnosis_service, 'predecir_imagen_bytes',
                                      side_effect=altered_source):
                        rejected = self.consume_export(secret, visit=visit_id)
                    self.assertEqual(rejected.status_code, 409, rejected.json)
                    source.write_bytes(original)
                    db.session.remove()
                    self.assertEqual(db.session.get(model, record_id).estado, 'CONFIRMADA')
                    self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(
                        visita_id=visit_id).first())
                    self.assertEqual(list(Path(folder).glob('*.jpg')), [])
                    self.assertEqual(copy_path.read_bytes(), original)
                    print('ORM preflight/final: paciente/ojo/profesional, caducidad, '
                          'copia/fuente y cambio tras IA rechazados sin consumo.')
                finally:
                    source.write_bytes(original)
                    db.session.rollback()
                    db.session.query(model).filter_by(id=record_id).delete()
                    db.session.commit()
                    db.session.remove()
        finally:
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_jpeg_failure_and_commit_uncertainty_keep_consistency(self):
        from sqlalchemy.exc import OperationalError

        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        try:
            with self.empty_diagnosis_visit() as visit_id, \
                 self.stubbed_creation() as (folder, infer), \
                 self.confirmed_export() as (secret, original, name):
                digest = hashlib.sha256(bytes.fromhex(secret)).digest()
                db.session.remove()
                record = model.query.filter_by(token_verificador=digest).one()
                record_id = record.id
                copy_path = root / record.clave_copia
                try:
                    real_publish = diagnosis_service.DiagnosisFiles.publish

                    def fail_after_first(files, temporary, filename):
                        if filename.endswith('_gradcam.jpg'):
                            raise OSError('Fallo sintético al publicar JPEG')
                        return real_publish(files, temporary, filename)

                    with patch.object(diagnosis_service.DiagnosisFiles, 'publish',
                                      new=fail_after_first):
                        rejected = self.consume_export(secret, visit=visit_id)
                    self.assertEqual(rejected.status_code, 500)
                    db.session.remove()
                    self.assertEqual(db.session.get(model, record_id).estado, 'CONFIRMADA')
                    self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(
                        visita_id=visit_id).first())
                    self.assertEqual(list(Path(folder).glob('*.jpg')), [])
                    self.assertEqual(copy_path.read_bytes(), original)

                    # La base confirma, pero el cliente no recibe certeza del commit.
                    real_commit = db.session.commit

                    def committed_but_unacknowledged():
                        real_commit()
                        raise OperationalError('commit sintético', {}, Exception())

                    with patch.object(db.session, 'commit', side_effect=committed_but_unacknowledged):
                        uncertain = self.consume_export(secret, visit=visit_id)
                    self.assertEqual(uncertain.status_code, 500)
                    db.session.remove()
                    record = db.session.get(model, record_id)
                    self.assertEqual(record.estado, 'CONSUMIDA')
                    self.assertIsNotNone(record.detalle_id)
                    detail = db.session.get(diagnosis_entities.DiagnosticoDetalle,
                                            record.detalle_id)
                    self.assertEqual(detail.hash_archivo, hashlib.sha256(original).hexdigest())
                    self.assertTrue(Path(folder, detail.imagen_original_url).is_file())
                    self.assertTrue(Path(folder, detail.imagen_gradcam_url).is_file())
                    self.assertEqual(copy_path.read_bytes(), original)
                    status, _ = self.call('/api/diagnosticar/retinografo/confirmaciones/estado',
                                          method='POST', token=self.token(),
                                          json_data={'identificador': secret})
                    self.assertEqual(status.json['confirmacion']['estado'], 'CONSUMIDA')
                    print('ORM persistencia: JPEG fallido revierte detalle/consumo/archivos; '
                          'commit ambiguo conserva detalle, consumo, JPEG y copia.')
                finally:
                    db.session.rollback()
                    db.session.query(model).filter_by(id=record_id).delete()
                    db.session.commit()
                    db.session.remove()
        finally:
            for file in set(root.iterdir()) - before:
                file.unlink()

    def test_28d_confirmed_export_cannot_overwrite_medical_decision(self):
        model = diagnosis_entities.ConfirmacionExportacionRetinografo
        root = Path(self.private_directory.name)
        before = set(root.iterdir())
        with self.stubbed_creation() as (folder, infer), \
             self.confirmed_export(patient=self.patient_ids[0]) as (secret, image, name):
            digest = hashlib.sha256(bytes.fromhex(secret)).digest()
            db.session.remove()
            detail = diagnosis_entities.DiagnosticoDetalle.query.filter_by(
                diagnostico_retinopatia_id=self.diagnosis_ids[0], ojo_evaluado='Derecho').one()
            detail_id = detail.id
            original_validation = (detail.validado_por, detail.fecha_validacion,
                                   detail.motivo_correccion)
            detail.validado_por = self.user_ids['colleague']
            detail.fecha_validacion = datetime(2030, 1, 2, 12, 34, 56)
            detail.motivo_correccion = 'Motivo sintético'
            db.session.commit()
            db.session.remove()
            detail_table = diagnosis_entities.DiagnosticoDetalle.__table__
            parent_table = diagnosis_entities.Diagnostico.__table__

            def snapshot(table, identifier):
                return dict(db.session.execute(
                    select(table).where(table.c.id == identifier)).mappings().one())

            initial_detail = snapshot(detail_table, detail_id)
            initial_parent = snapshot(parent_table, self.diagnosis_ids[0])
            initial_counts = (db.session.query(diagnosis_entities.Diagnostico).count(),
                              db.session.query(diagnosis_entities.DiagnosticoDetalle).count())
            originals = {filename: Path(self.image_directory.name, filename).read_bytes()
                         for filename in (initial_detail['imagen_original_url'],
                                          initial_detail['imagen_gradcam_url'])}
            self.assertEqual((initial_detail['estado_validacion'], initial_detail['resultado_ia_id'],
                              initial_detail['resultado_final_id'], initial_detail['validado_por'],
                              initial_detail['fecha_validacion'], initial_detail['comentario_medico'],
                              initial_detail['motivo_correccion']),
                             ('CORREGIDO', 2, 3, self.user_ids['colleague'],
                              datetime(2030, 1, 2, 12, 34, 56), 'Conclusion sintetica',
                              'Motivo sintético'))
            try:
                rejected = self.consume_export(secret, patient=self.patient_ids[0],
                                               visit=self.visit_ids[0])
                self.assertEqual(rejected.status_code, 409)
                infer.assert_not_called()
                db.session.remove()
                record = model.query.filter_by(token_verificador=digest).one()
                self.assertEqual(record.estado, 'CONFIRMADA')
                self.assertIsNone(record.detalle_id)
                self.assertIsNone(record.fecha_consumo)
                self.assertEqual(snapshot(detail_table, detail_id), initial_detail)
                self.assertEqual(snapshot(parent_table, self.diagnosis_ids[0]), initial_parent)
                self.assertEqual((db.session.query(diagnosis_entities.Diagnostico).count(),
                                  db.session.query(diagnosis_entities.DiagnosticoDetalle).count()),
                                 initial_counts)
                for filename, content in originals.items():
                    self.assertEqual(Path(self.image_directory.name, filename).read_bytes(), content)
                self.assertEqual(list(Path(folder).glob('*.jpg')), [])
            finally:
                db.session.rollback()
                detail = db.session.get(diagnosis_entities.DiagnosticoDetalle, detail_id)
                detail.validado_por, detail.fecha_validacion, detail.motivo_correccion = original_validation
                db.session.query(model).filter_by(token_verificador=digest).delete()
                db.session.commit()
                db.session.remove()
                for file in set(root.iterdir()) - before:
                    file.unlink()

    def measured_creation(self, **kwargs):
        db.session.remove()
        statements = []
        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)
        event.listen(db.engine, 'before_cursor_execute', record)
        try:
            response = self.create_image(**kwargs)
        finally:
            event.remove(db.engine, 'before_cursor_execute', record)
        counts = Counter(sql.lstrip().split(None, 1)[0].upper() for sql in statements)
        return response, statements, counts

    @staticmethod
    def published_files(folder):
        return list(Path(folder).glob('*.jpg'))

    def retinograph_paths(self, *, patient_id=None):
        patient_id = patient_id or self.patient_ids[0]
        name = self.retino_files["R"][0]
        return (f"/api/diagnosticar/retinografo/auto-seleccion/{patient_id}",
                f"/api/diagnosticar/retinografo/imagen?paciente_id={patient_id}&filename={name}")

    def test_real_retinograph_authorized_contract_and_denial_before_resources(self):
        select_path, download_path = self.retinograph_paths()
        original_patient = PatientRepository.obtener_paciente_por_id
        original_list = retinograph_import_service.list_export_names
        original_read = retinograph_import_service.read_export
        with (patch.object(PatientRepository, "obtener_paciente_por_id", wraps=original_patient) as patient,
              patch.object(retinograph_import_service, "list_export_names", wraps=original_list) as listing,
              patch.object(retinograph_import_service, "read_export", wraps=original_read) as opening):
            for path, expected_opens in ((select_path, 2), (download_path, 1)):
                with self.subTest(path=path):
                    patient.reset_mock()
                    listing.reset_mock()
                    opening.reset_mock()
                    response, sql = self.call(path, token=self.token(), measure=True)
                    self.assertEqual(response.status_code, 200, response.json if response.is_json else None)
                    self.assertEqual(patient.call_count, 1)
                    self.assertEqual(listing.call_count, int(path == select_path))
                    self.assertEqual(opening.call_count, expected_opens)
                    self.assertEqual(len(sql), 4)  # 3 auth + 1 paciente, independiente de candidatas.
                    self.assertEqual(sum("from pacientes" in s.lower().replace("`", "") for s in sql), 1)
                    self.assertEqual(sum("from usuarios" in s.lower().replace("`", "") for s in sql), 1)
                    if path == select_path:
                        self.assertEqual(response.json["data"]["encontradas"], 2)
                        self.assertEqual(response.json["data"]["imagenes"]["OD"]["filename"], self.retino_files["R"][0])
                        self.assertEqual(response.json["data"]["imagenes"]["OI"]["filename"], self.retino_files["L"][0])
                    else:
                        self.assertEqual(response.get_data(), self.retino_files["R"][1])
                        self.assertEqual(response.mimetype, "image/jpeg")
                    self.assertNotIn(self.retino_directory.name, response.get_data(as_text=True) if response.is_json else str(response.headers))
                    self.assertEqual(response.headers["Cache-Control"], "private, no-store")
                    print(f"ORM retinógrafo {'selección' if path == select_path else 'descarga'}: "
                          f"SELECT={len(sql)}, clínicos=1, "
                          f"aperturas={opening.call_count}, candidatos={2 if path == select_path else 0}.")
                    response.close()
                for profile in ("administrator", "nurse", "assistant"):
                    patient.reset_mock()
                    listing.reset_mock()
                    opening.reset_mock()
                    response, denied_sql = self.call(path, token=self.token(profile), measure=True)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(len(denied_sql), 3)
                    self.assertNotIn(self.retino_directory.name, response.get_data(as_text=True))
                    self.assertFalse(any("from pacientes" in s.lower().replace("`", "") for s in denied_sql))
                    patient.assert_not_called(); listing.assert_not_called(); opening.assert_not_called()
                    response.close()
                print(f"ORM retinógrafo denegaciones {'selección' if path == select_path else 'descarga'}: "
                      "SELECT clínicos=0, aperturas=0.")
            for path in self.retinograph_paths(patient_id=self.patient_ids[1]):
                response, _ = self.call(path, token=self.token("colleague"))
                self.assertEqual(response.status_code, 200 if "auto-seleccion" in path else 403)
                if "auto-seleccion" in path:
                    self.assertEqual(response.json["data"]["encontradas"], 0)
                response.close()
            for path in self.retinograph_paths(patient_id=max(self.patient_ids) + 1000000):
                self.assertEqual(self.call(path, token=self.token())[0].status_code, 404)

    def test_real_retinograph_grant_source_freshness_and_authentication(self):
        valid = self.token("dual", claims_roles=["Administrador del sistema"])
        for path in self.retinograph_paths():
            with self.subTest(path=path):
                for profile in ("ophthalmologist", "dual", "assistant_dual"):
                    response, sql = self.call(path, token=self.token(profile), measure=True)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(len(sql), 4)  # Multirrol no aumenta consultas por grant.
                    response.close()
                self.assertEqual(self.call(path, token=valid)[0].status_code, 200)
                for grant in ("pacientes.ver", "imagenes.ver"):
                    with self.temporary_grant("OFTALMOLOGO", grant, present=False):
                        with self.temporary_grant("ADMINISTRADOR_SISTEMA", grant, present=True):
                            with (patch.object(PatientRepository, "obtener_paciente_por_id") as patient,
                                  patch.object(retinograph_import_service, "list_export_names") as listing,
                                  patch.object(retinograph_import_service, "read_export") as opening):
                                response, sql = self.call(path, token=valid, measure=True)
                                self.assertEqual(response.status_code, 403)
                                self.assertFalse(any("from pacientes" in s.lower().replace("`", "") for s in sql))
                                patient.assert_not_called(); listing.assert_not_called(); opening.assert_not_called()
                        self.assertEqual(self.call(path, token=self.token())[0].status_code, 403)
                    self.assertEqual(self.call(path, token=valid)[0].status_code, 200)
                role = Rol.query.filter_by(codigo="OFTALMOLOGO").one()
                with self.temporary_state(Rol, role.id, "INACTIVO"):
                    self.assertEqual(self.call(path, token=valid)[0].status_code, 403)
                user = self.user_ids["ophthalmologist"]
                with self.temporary_state(Usuario, user, "INACTIVO"):
                    self.assertEqual(self.call(path, token=self.token())[0].status_code, 401)
                invalid = jwt.encode({"user_id": self.user_ids["ophthalmologist"],
                                      "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                                     "invalid-orm-retinograph-signing-key", algorithm="HS256")
                for bearer in (None, invalid, self.token(expired=True), self.token(expires=False)):
                    denied, statements = self.call(path, token=bearer, measure=True)
                    self.assertEqual(denied.status_code, 401)
                    self.assertEqual(statements, [])
                for bearer in (None, valid):
                    denied, statements = self.call(f"{path}{'&' if '?' in path else '?'}token={valid}",
                                                   token=bearer, measure=True)
                    self.assertEqual(denied.status_code, 401)
                    self.assertEqual(statements, [])

    def test_orm_columns_and_relationship_provenance(self):
        inspector = inspect(db.engine)
        for model in (Usuario, UsuarioRol, Rol, RolPermiso, Permiso):
            sql_columns = {column["name"] for column in inspector.get_columns(model.__tablename__)}
            self.assertEqual({column.name for column in model.__table__.columns}, sql_columns)
        user = db.session.get(Usuario, self.user_ids["dual"])
        self.assertIsInstance(user.id, int)
        self.assertEqual({link.rol.codigo for link in user.roles_rel},
                         {"ADMINISTRADOR_SISTEMA", "OFTALMOLOGO"})
        sources = {
            link.rol.codigo: {grant.permiso.codigo for grant in link.rol.permisos_rel}
            for link in user.roles_rel
        }
        self.assertIn("diagnostico_retinopatia.validar", sources["OFTALMOLOGO"])
        self.assertNotIn("diagnostico_retinopatia.validar", sources["ADMINISTRADOR_SISTEMA"])
        self.assertIn("Oftalmologo", user.roles)  # Contrato antiguo de nombres.

    def test_active_login_and_valid_jwt_with_current_identity(self):
        result = self.client.post("/api/login", json={
            "username": Usuario.query.get(self.user_ids["ophthalmologist"]).username,
            "password": TEST_PASSWORD,
        })
        self.assertEqual(result.status_code, 200)
        token = result.json["data"]["token"]
        jwt.decode(token, TEST_KEY, algorithms=["HS256"])
        response, _ = self.call(f"/api/_orm_patient/{self.patient_ids[0]}", token=token)
        self.assertEqual(response.status_code, 200)

    def test_expired_missing_exp_and_invalid_signature_rejected_before_orm(self):
        path = f"/api/_orm_patient/{self.patient_ids[0]}"
        for token in (self.token(expired=True), self.token(expires=False),
                      jwt.encode({"user_id": self.user_ids["ophthalmologist"],
                                  "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                                 "different-only-synthetic-signing-key", algorithm="HS256")):
            with self.subTest(kind="invalid_signed_claims"):
                result, statements = self.call(path, token=token, measure=True)
                self.assertEqual(result.status_code, 401)
                self.assertEqual(len(statements), 0)

    def test_account_deactivation_rejects_previously_issued_token(self):
        token = self.token()
        path = f"/api/_orm_patient/{self.patient_ids[0]}"
        self.assertEqual(self.call(path, token=token)[0].status_code, 200)
        with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
            self.assertEqual(self.call(path, token=token)[0].status_code, 401)

    def test_url_jwt_is_rejected_before_orm_on_b1_and_legacy_routes(self):
        bearer = self.token()
        expired = self.token(expired=True)
        invalid = jwt.encode({
            "user_id": self.user_ids["ophthalmologist"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }, "different-only-synthetic-signing-key", algorithm="HS256")
        paths = (
            f"/api/pacientes/{self.patient_ids[0]}",
            f"/api/pacientes/{self.patient_ids[0]}/visitas",
            "/uploads/retinas/synthetic-only.jpg",
            f"/api/_orm_legacy_patient/{self.patient_ids[0]}",
        )
        for path in paths:
            response, _ = self.call(path, token=bearer)
            self.assertEqual(response.status_code, 200)
            response.close()
            for query_token in (bearer, expired, invalid):
                for header_token in (None, bearer):
                    with self.subTest(path=path, bearer=bool(header_token),
                                      query_valid=query_token == bearer):
                        denied, statements = self.call(
                            f"{path}?token={query_token}", token=header_token,
                            measure=True)
                        self.assertEqual(denied.status_code, 401)
                        self.assertEqual(statements, [])
                        self.assertNotIn(query_token, denied.get_data(as_text=True))

    def test_active_role_and_permission_states_are_respected(self):
        token = self.token()
        path = f"/api/_orm_patient/{self.patient_ids[0]}"
        role = Rol.query.filter_by(codigo="OFTALMOLOGO").one()
        permission = Permiso.query.filter_by(codigo="pacientes.ver").one()
        role_id, permission_id = role.id, permission.id
        with self.temporary_state(Rol, role_id, "INACTIVO"):
            self.assertEqual(self.call(path, token=token)[0].status_code, 403)
        with self.temporary_state(Permiso, permission_id, "INACTIVO"):
            self.assertEqual(self.call(path, token=token)[0].status_code, 403)

    def test_role_permission_matrix_and_shared_patients(self):
        for patient_id in self.patient_ids:
            result, _ = self.call(f"/api/_orm_patient/{patient_id}", token=self.token())
            self.assertEqual(result.status_code, 200)
        self.assertEqual(self.call("/api/_orm_register", method="POST",
                                   token=self.token("nurse"))[0].status_code, 201)
        self.assertEqual(self.call("/api/_orm_register", method="POST",
                                   token=self.token("assistant"))[0].status_code, 201)
        self.assertEqual(self.call("/api/_orm_diagnose", method="POST",
                                   token=self.token())[0].status_code, 201)
        self.assertEqual(self.call("/api/_orm_validate", method="PUT",
                                   token=self.token("nurse"))[0].status_code, 403)
        self.assertEqual(self.call("/api/_orm_validate", method="PUT",
                                   token=self.token("administrator"))[0].status_code, 403)
        self.assertEqual(self.call("/api/_orm_report", method="DELETE",
                                   token=self.token())[0].status_code, 403)
        self.assertEqual(self.call("/api/_orm_unknown", token=self.token())[0].status_code, 403)
        self.assertEqual(self.call("/api/_orm_configuration",
                                   token=self.token("administrator"))[0].status_code, 200)
        self.assertEqual(self.call("/api/_orm_configuration", token=self.token())[0].status_code, 403)
        self.assertEqual(self.call("/api/_orm_report", method="DELETE",
                                   token=self.token("assistant"))[0].status_code, 403)

    def test_multi_role_validation_requires_ophthalmologist_grant_source(self):
        token = self.token("dual", claims_roles=["Administrador del sistema"])
        self.assertEqual(self.call("/api/_orm_validate", method="PUT", token=token)[0].status_code, 200)
        with self.temporary_grant("OFTALMOLOGO", "diagnostico_retinopatia.validar", present=False):
            with self.temporary_grant("ADMINISTRADOR_SISTEMA", "diagnostico_retinopatia.validar", present=True):
                self.assertEqual(self.call("/api/_orm_validate", method="PUT",
                                           token=token)[0].status_code, 403)
                # La unión del usuario contiene el permiso, pero NO proviene
                # de un rol médico habilitante.
                user = db.session.get(Usuario, self.user_ids["dual"])
                self.assertIn("diagnostico_retinopatia.validar", user.permisos)
        self.assertEqual(self.call("/api/_orm_validate", method="PUT", token=token)[0].status_code, 200)

    def test_revoking_grant_is_effective_with_same_jwt(self):
        token = self.token()
        path = f"/api/_orm_patient/{self.patient_ids[0]}"
        self.assertEqual(self.call(path, token=token)[0].status_code, 200)
        with self.temporary_grant("OFTALMOLOGO", "pacientes.ver", present=False):
            self.assertEqual(self.call(path, token=token)[0].status_code, 403)

    def test_composite_reading_and_report_resource_requirements(self):
        token = self.token()
        self.assertEqual(self.call(f"/api/_orm_history/{self.patient_ids[1]}",
                                   token=token)[0].status_code, 200)
        self.assertEqual(self.call("/api/_orm_pdf", token=token)[0].status_code, 200)
        with self.temporary_grant("OFTALMOLOGO", "informes.ver", present=False):
            self.assertEqual(self.call(f"/api/_orm_history/{self.patient_ids[1]}",
                                       token=token)[0].status_code, 403)
        with self.temporary_grant("OFTALMOLOGO", "imagenes.ver", present=False):
            self.assertEqual(self.call("/api/_orm_pdf", token=token)[0].status_code, 403)
        with self.temporary_grant("OFTALMOLOGO", "informes.inactivar", present=True):
            self.assertEqual(self.call("/api/_orm_report", method="DELETE",
                                       token=token)[0].status_code, 403)

    def test_invalid_orm_query_is_controlled(self):
        with patch.object(AuthRepository, "get_active_user_with_permissions_by_id",
                          side_effect=OperationalError("SELECT sintético", (),
                                                       RuntimeError("fallo sintético"))) as lookup:
            with patch.object(self.app.logger, "exception"):
                result, _ = self.call(f"/api/_orm_patient/{self.patient_ids[0]}",
                                      token=self.token())
        lookup.assert_called_once()
        self.assertEqual(result.status_code, 500)
        self.assertEqual(result.json, {"success": False, "message": "No se pudo procesar la solicitud."})

    def test_count_queries_per_request_without_cross_request_cache(self):
        path = f"/api/_orm_patient/{self.patient_ids[0]}"
        old_path = f"/api/_orm_baseline_patient/{self.patient_ids[0]}"
        legacy_path = f"/api/_orm_legacy_patient/{self.patient_ids[0]}"
        old_single, old_single_sql = self.call(old_path, token=self.token(), measure=True)
        old_multiple, old_multi_sql = self.call(old_path, token=self.token("dual"), measure=True)
        legacy, legacy_sql = self.call(legacy_path, token=self.token(), measure=True)
        single, single_sql = self.call(path, token=self.token(), measure=True)
        multiple, multi_sql = self.call(path, token=self.token("dual"), measure=True)
        repeated, repeated_sql = self.call(path, token=self.token(), measure=True)
        self.assertEqual(old_single.status_code, 200)
        self.assertEqual(old_multiple.status_code, 200)
        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(single.status_code, 200)
        self.assertEqual(multiple.status_code, 200)
        self.assertEqual(repeated.status_code, 200)

        def user_selects(statements):
            return sum("from usuarios" in query.lower().replace("`", "")
                       for query in statements)

        self.assertEqual(user_selects(old_single_sql), 2)
        self.assertEqual(user_selects(old_multi_sql), 2)
        self.assertEqual(user_selects(legacy_sql), 1)
        self.assertEqual(user_selects(single_sql), 1)
        self.assertEqual(user_selects(multi_sql), 1)
        self.assertEqual(user_selects(repeated_sql), 1)
        self.assertLess(len(single_sql), len(old_single_sql))
        self.assertLess(len(multi_sql), len(old_multi_sql))
        self.assertLessEqual(len(multi_sql), len(single_sql) + 1)

        def source_tables(statements):
            table_names = ("usuarios", "usuario_rol", "roles", "rol_permiso",
                           "permisos", "pacientes")
            sources = Counter()
            for statement in statements:
                text = statement.lower().replace("`", "")
                sources[next((name for name in table_names if f"from {name}" in text),
                             "otros")] += 1
            return sources

        for kind, earlier, current in (("un rol", old_single_sql, single_sql),
                                       ("dos roles", old_multi_sql, multi_sql)):
            percent = (len(earlier) - len(current)) * 100 / len(earlier)
            print(f"ORM {kind}: anterior={len(earlier)}, nuevo={len(current)}, "
                  f"reduccion={percent:.1f}%; "
                  f"antes={dict(source_tables(earlier))}, "
                  f"despues={dict(source_tables(current))}.")
        print(f"ORM nueva peticion sin cache persistente: SELECT={len(repeated_sql)}, "
              f"usuarios={user_selects(repeated_sql)}.")
        print(f"ORM decorador clinico antiguo intacto: SELECT={len(legacy_sql)}, "
              f"usuarios={user_selects(legacy_sql)}.")

    def test_real_patient_routes_preserve_contract_and_shared_lookup(self):
        token = self.token()
        query = "9200000"
        search = f"/api/pacientes/buscar?q={query}&page=1&per_page=1"
        baseline = f"/api/_orm_baseline_search?q={query}&page=1&per_page=1"
        first, _ = self.call(search, token=token)
        old, _ = self.call(baseline, token=token)
        self.assertEqual(first.status_code, old.status_code)
        self.assertEqual(first.json, old.json)
        self.assertEqual(first.json["pagination"]["per_page"], 1)
        self.assertTrue(first.json["pagination"]["has_more"])

        second, _ = self.call(f"/api/pacientes/buscar?q={query}&page=2&per_page=1", token=token)
        found = {row["nro_documento"] for row in first.json["data"] + second.json["data"]}
        self.assertEqual(found, set(self.patient_documents))
        self.assertEqual(set(first.json["data"][0]), {
            "id", "tipo_doc_abrev", "tipo_doc_id", "tipo_doc", "nro_documento",
            "nombres", "apellidos", "ultima_visita", "ultima_visita_origen",
            "visitas_sin_fecha_verificada",
        })
        empty, _ = self.call("/api/pacientes/buscar?q=P&page=2&per_page=2", token=token)
        self.assertEqual(empty.json["data"], [])
        self.assertEqual(empty.json["pagination"]["page"], 2)

        recent, _ = self.call("/api/pacientes/recientes?limit=30", token=token)
        previous, _ = self.call("/api/_orm_baseline_recent?limit=30", token=token)
        self.assertEqual(recent.status_code, previous.status_code)
        self.assertEqual(recent.json, previous.json)
        self.assertTrue(set(self.patient_documents) <=
                        {row["nro_documento"] for row in recent.json["data"]})
        self.assertEqual(set(recent.json["data"][0]), {
            "id", "tipo_doc_abrev", "nro_documento", "nombres", "apellidos", "ultima_visita", "ultima_visita_origen",
            "visitas_sin_fecha_verificada",
        })

    def test_real_patient_routes_roles_and_denied_handler_queries(self):
        search = f"/api/pacientes/buscar?q={self.patient_documents[0]}"
        recent = "/api/pacientes/recientes?limit=30"
        for profile in ("ophthalmologist", "nurse", "assistant", "dual"):
            with self.subTest(profile=profile):
                self.assertEqual(self.call(search, token=self.token(profile))[0].status_code, 200)
                self.assertEqual(self.call(recent, token=self.token(profile))[0].status_code, 200)
        for path in (search, recent):
            denied, statements = self.call(path, token=self.token("administrator"), measure=True)
            self.assertEqual(denied.status_code, 403)
            self.assertFalse(any("from pacientes" in sql.lower().replace("`", "")
                                 for sql in statements))
        for path in (search, recent):
            missing, statements = self.call(path, measure=True)
            self.assertEqual(missing.status_code, 401)
            self.assertEqual(len(statements), 0)

    def test_real_patient_routes_minimize_synthetic_clinical_fields_per_profile(self):
        search = "/api/pacientes/buscar?q=9200000&page=1&per_page=1"
        recent = "/api/pacientes/recientes?limit=30"
        identifiers = {"id", "tipo_doc_abrev", "nro_documento", "nombres", "apellidos"}
        for profile in ("ophthalmologist", "nurse", "assistant", "dual"):
            with self.subTest(profile=profile):
                for path in (search, recent):
                    response, _ = self.call(path, token=self.token(profile))
                    self.assertEqual(response.status_code, 200)
                    if path == search:
                        self.assertEqual(len(response.json["data"]), 1)
                    else:
                        self.assertTrue(set(self.patient_documents) <=
                                        {row["nro_documento"] for row in response.json["data"]})
                    expected = identifiers | ({"tipo_doc_id", "tipo_doc"} if path == search else set())
                    if profile != "assistant":
                        expected.add("ultima_visita")
                        expected.add("ultima_visita_origen")
                        expected.add("visitas_sin_fecha_verificada")
                    self.assertEqual(set(response.json["data"][0]), expected)
                    for forbidden in ("Antecedente sintetico", "Alergia sintetica",
                                      "Conclusion sintetica", "Modelo sintetico", "synthetic-only.jpg",
                                      "Motivo sintetico", "Observacion sintetica"):
                        self.assertNotIn(forbidden, response.get_data(as_text=True))
                    if profile == "assistant":
                        self.assertNotIn("ultima_visita", response.get_data(as_text=True))
        # Ambas visitas de fixture se asignaron sin acreditar UTC: orden
        # operativo por ID, nunca por sus valores de calendario artificiales.
        clinician, _ = self.call(recent, token=self.token())
        assistant, _ = self.call(recent, token=self.token("assistant"))
        self.assertEqual(clinician.json["data"][0]["id"], self.patient_ids[1])
        self.assertEqual(assistant.json["data"][0]["id"], self.patient_ids[1])
        historical = next(row for row in clinician.json['data']
                          if row['id'] == self.patient_ids[0])
        self.assertIsNone(historical['ultima_visita'])
        self.assertEqual(historical['visitas_sin_fecha_verificada'], 1)

    def test_real_patient_routes_scope_follows_eligible_grant_source_between_requests(self):
        path = "/api/pacientes/recientes?limit=30"
        token = self.token("assistant_dual", claims_roles=["Admin"])
        self.assertIn("ultima_visita", self.call(path, token=token)[0].json["data"][0])
        with self.temporary_grant("OFTALMOLOGO", "pacientes.ver", present=False):
            assistant, _ = self.call(path, token=token)
            self.assertEqual(assistant.status_code, 200)
            self.assertNotIn("ultima_visita", assistant.json["data"][0])
            with self.temporary_grant("ASISTENTE_ADMINISTRATIVO", "pacientes.ver", present=False):
                self.assertEqual(self.call(path, token=token)[0].status_code, 403)
        self.assertIn("ultima_visita", self.call(path, token=token)[0].json["data"][0])

    def test_real_patient_routes_reject_invalid_and_expired_jwt(self):
        wrong_key = jwt.encode({
            "user_id": self.user_ids["ophthalmologist"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }, "different-only-synthetic-signing-key", algorithm="HS256")
        for path in ("/api/pacientes/buscar?q=Pa", "/api/pacientes/recientes"):
            for token in (wrong_key, self.token(expired=True), self.token(expires=False)):
                with self.subTest(path=path):
                    result, statements = self.call(path, token=token, measure=True)
                    self.assertEqual(result.status_code, 401)
                    self.assertEqual(statements, [])

    def test_real_patient_routes_revoke_account_role_and_permission(self):
        path = "/api/pacientes/recientes?limit=30"
        token = self.token()
        self.assertEqual(self.call(path, token=token)[0].status_code, 200)
        with self.temporary_grant("OFTALMOLOGO", "pacientes.ver", present=False):
            self.assertEqual(self.call(path, token=token)[0].status_code, 403)
        role_id = Rol.query.filter_by(codigo="OFTALMOLOGO").one().id
        with self.temporary_state(Rol, role_id, "INACTIVO"):
            self.assertEqual(self.call(path, token=token)[0].status_code, 403)
        with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
            self.assertEqual(self.call(path, token=token)[0].status_code, 401)

    def test_real_patient_routes_query_counts_and_pagination_bounds(self):
        token = self.token()
        search, queries = self.call(f"/api/pacientes/buscar?q={self.patient_documents[0]}&page=0&per_page=99",
                                    token=token, measure=True)
        recent, recent_queries = self.call("/api/pacientes/recientes?limit=99", token=token,
                                           measure=True)
        assistant_search, assistant_queries = self.call(
            f"/api/pacientes/buscar?q={self.patient_documents[0]}&page=0&per_page=99",
            token=self.token("assistant"), measure=True)
        assistant_recent, assistant_recent_queries = self.call(
            "/api/pacientes/recientes?limit=99", token=self.token("assistant"), measure=True)
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json["pagination"]["page"], 1)
        self.assertEqual(search.json["pagination"]["per_page"], 30)
        self.assertEqual(recent.status_code, 200)
        self.assertLessEqual(len(recent.json["data"]), 30)
        self.assertEqual(len(queries), 5)  # Identidad + roles + grants + COUNT + busqueda.
        self.assertEqual(len(recent_queries), 4)  # Identidad + roles + grants + recientes.
        self.assertEqual(assistant_search.status_code, 200)
        self.assertEqual(assistant_recent.status_code, 200)
        self.assertEqual(assistant_search.json["pagination"]["per_page"], 30)
        self.assertLessEqual(len(assistant_recent.json["data"]), 30)
        self.assertEqual(len(assistant_queries), 5)
        self.assertEqual(len(assistant_recent_queries), 4)
        self.assertFalse(any("visitas_clinicas" in sql.lower() for sql in
                             assistant_queries + assistant_recent_queries))
        print("ORM rutas reales de pacientes: buscar=5 SELECT, recientes=4 SELECT, "
              "también para alcance administrativo sin leer visitas.")

    def test_b1_list_detail_real_json_all_profiles_and_query_cost(self):
        expected = {"ophthalmologist": "clinical", "nurse": "assistance",
                    "assistant": "administrative", "dual": "clinical"}
        for profile, scope in expected.items():
            with self.subTest(profile=profile):
                listing, list_sql = self.call("/api/pacientes", token=self.token(profile), measure=True)
                detail, detail_sql = self.call(
                    f"/api/pacientes/{self.patient_ids[0]}", token=self.token(profile), measure=True)
                self.assertEqual(listing.status_code, 200)
                self.assertEqual(detail.status_code, 200)
                self.assertEqual(listing.json["scope"], scope)
                self.assertEqual(detail.json["scope"], scope)
                self.assertTrue(set(self.patient_documents) <=
                                {row["nro_documento"] for row in listing.json["data"]})
                self.assertEqual(detail.json["data"]["nro_documento"], self.patient_documents[0])
                self.assertEqual(len(list_sql), 4)  # autenticación+roles+grants+lista
                self.assertEqual(len(detail_sql), 4)  # autenticación+roles+grants+detalle
                self.assertEqual(sum("from pacientes" in sql.lower() for sql in list_sql), 1)
                self.assertEqual(sum("from pacientes" in sql.lower() for sql in detail_sql), 1)
                if scope == "administrative":
                    self.assertFalse(any("visitas_clinicas" in sql.lower() or
                                         "diagnosticos_retinopatia" in sql.lower() for sql in list_sql + detail_sql))
                    for field in ("antecedentes_clinicos", "alergias", "consentimiento_informado",
                                  "ultima_visita", "maxima_gravedad"):
                        self.assertNotIn(field, listing.get_data(as_text=True))
                        self.assertNotIn(field, detail.get_data(as_text=True))
                elif scope == "assistance":
                    self.assertIn("alergias", detail.json["data"])
                    self.assertNotIn("antecedentes_clinicos", detail.json["data"])
                    self.assertNotIn("maxima_gravedad", listing.json["data"][0])
                else:
                    self.assertEqual(detail.json["data"]["antecedentes_clinicos"], "Antecedente sintetico")
                    self.assertIn("ultima_visita", listing.json["data"][0])
                for response in (listing, detail):
                    for forbidden in ("Motivo sintetico", "Observacion sintetica",
                                      "Conclusion sintetica", "synthetic-only.jpg"):
                        self.assertNotIn(forbidden, response.get_data(as_text=True))
        print("ORM listado/detalle real: 4 SELECT cada uno (3 autenticación/autorización + 1 handler); "
              "administrativo sin joins clínicos.")

    def test_b1_list_detail_denial_revocation_and_not_found(self):
        paths = ("/api/pacientes", f"/api/pacientes/{self.patient_ids[0]}")
        for path in paths:
            for token, status in ((None, 401), (self.token("administrator"), 403)):
                response, statements = self.call(path, token=token, measure=True)
                self.assertEqual(response.status_code, status)
                self.assertFalse(any("from pacientes" in sql.lower() for sql in statements))
            self.assertEqual(self.call(path, token=self.token("dual"))[0].status_code, 200)
            with self.temporary_grant("OFTALMOLOGO", "pacientes.ver", present=False):
                self.assertEqual(self.call(path, token=self.token("ophthalmologist"))[0].status_code, 403)
                assistant, _ = self.call(path, token=self.token("assistant_dual"))
                self.assertEqual(assistant.status_code, 200)
                self.assertEqual(assistant.json["scope"], "administrative")
        missing, _ = self.call("/api/pacientes/2147483647", token=self.token())
        self.assertEqual(missing.status_code, 404)

    def test_b1_list_detail_jwt_account_and_grant_freshness(self):
        wrong_key = jwt.encode({"user_id": self.user_ids["ophthalmologist"],
                                "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                               "different-only-synthetic-signing-key", algorithm="HS256")
        for path in ("/api/pacientes", f"/api/pacientes/{self.patient_ids[0]}"):
            for token in (wrong_key, self.token(expired=True), self.token(expires=False)):
                result, sql = self.call(path, token=token, measure=True)
                self.assertEqual(result.status_code, 401)
                self.assertEqual(sql, [])
            with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
                self.assertEqual(self.call(path, token=self.token())[0].status_code, 401)

    def test_b1_real_history_contract_content_and_constant_query_cost(self):
        paths = (f"/api/pacientes/{self.patient_ids[0]}/visitas",
                 f"/api/diagnosticos/paciente/{self.patient_ids[0]}")
        for path in paths:
            with self.subTest(path=path):
                response, sql = self.call(path, token=self.token(), measure=True)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(set(response.json), {"success", "data"})
                visits = response.json["data"]
                self.assertEqual([row["visita_id"] for row in visits], self.visit_ids[::-1])
                self.assertIsNone(visits[0]["diagnostico_ia"])
                self.assertEqual(visits[0]["informes"], [])
                self.assertEqual(visits[1]["diagnostico_ia"]["detalles"][0]["resultado_ia_id"], 2)
                self.assertEqual(visits[1]["diagnostico_ia"]["detalles"][0]["resultado_final_id"], 3)
                self.assertEqual(visits[1]["diagnostico_ia"]["detalles"][0]["imagen_original_url"],
                                 "synthetic-only.jpg")
                self.assertEqual(visits[1]["diagnostico_ia"]["detalles"][0]["imagen_gradcam_url"],
                                 "synthetic-gradcam.jpg")
                self.assertEqual(visits[1]["informes"][0]["conclusion"], "Informe sintetico")
                self.assertEqual(visits[1]["medico_tratante"], "Persona Sintetica")
                self.assertEqual(len([q for q in sql if q.lstrip().lower().startswith("select")]), 7)
                self.assertFalse(any("join pacientes" in q.lower() for q in sql))
        other, queries = self.call(f"/api/pacientes/{self.patient_ids[1]}/visitas",
                                   token=self.token("dual"), measure=True)
        self.assertEqual(other.status_code, 200)
        self.assertEqual(other.json["data"], [])
        self.assertEqual(len([q for q in queries if q.lstrip().lower().startswith("select")]), 5)
        missing, sql = self.call("/api/diagnosticos/paciente/2147483647",
                                 token=self.token(), measure=True)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json, {"success": False, "message": "Paciente no encontrado"})
        self.assertEqual(len([q for q in sql if q.lstrip().lower().startswith("select")]), 4)
        print("ORM historial real: con visitas=7 SELECT; sin visitas=5; paciente inexistente=4; "
              "consultas fijas sin N+1.")

    def test_b1_real_history_deny_before_clinical_sql_and_fresh_revocation(self):
        paths = (f"/api/pacientes/{self.patient_ids[0]}/visitas",
                 f"/api/diagnosticos/paciente/{self.patient_ids[0]}")
        wrong_key = jwt.encode({"user_id": self.user_ids["ophthalmologist"],
                                "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                               "wrong-synthetic-signing-key", algorithm="HS256")
        for path in paths:
            for token in (None, wrong_key, self.token(expired=True)):
                response, sql = self.call(path, token=token, measure=True)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(sql, [])
            with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
                self.assertEqual(self.call(path, token=self.token())[0].status_code, 401)
            for profile in ("administrator", "assistant", "nurse"):
                denied, sql = self.call(path, token=self.token(profile), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertNotIn("data", denied.json)
                self.assertFalse(any("from pacientes" in q.lower() or
                                     "visitas_clinicas" in q.lower() for q in sql))
            self.assertEqual(self.call(path, token=self.token("dual"))[0].status_code, 200)
            for permission in ("diagnostico_retinopatia.ver", "informes.ver", "imagenes.ver",
                               "pacientes.ver", "visitas.ver"):
                with self.subTest(path=path, permission=permission):
                    with self.temporary_grant("OFTALMOLOGO", permission, present=False):
                        for profile in ("ophthalmologist", "assistant_dual", "dual"):
                            denied, sql = self.call(path, token=self.token(profile), measure=True)
                            self.assertEqual(denied.status_code, 403)
                            self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
                            self.assertNotIn("data", denied.json)
                            self.assertNotIn("synthetic-only.jpg", denied.get_data(as_text=True))
                    self.assertEqual(self.call(path, token=self.token())[0].status_code, 200)

    def test_b1_real_history_error_does_not_log_clinical_values(self):
        with patch.object(PatientRepository, "obtener_diagnosticos_paciente",
                          side_effect=RuntimeError("synthetic-only.jpg")):
            with patch.object(self.app.logger, "error") as logged:
                result, _ = self.call(f"/api/pacientes/{self.patient_ids[0]}/visitas",
                                      token=self.token())
        self.assertEqual(result.status_code, 500)
        self.assertNotIn("synthetic-only.jpg", result.get_data(as_text=True))
        logged.assert_called_once_with("Error al obtener historial de diagnosticos")

    def test_b1_real_diagnosis_details_contract_and_fixed_queries(self):
        paths = (
            f"/api/diagnosticar/visita/{self.visit_ids[0]}/detalles",
            f"/api/diagnosticar/diagnostico/{self.diagnosis_ids[0]}/detalles",
        )
        for path in paths:
            for profile in ("ophthalmologist", "colleague", "dual", "assistant_dual"):
                with self.subTest(path=path, profile=profile):
                    response, sql = self.call(path, token=self.token(profile), measure=True)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(set(response.json), {"success", "data"})
                    self.assertEqual(set(response.json["data"]),
                                     {"visita_id", "diagnostico_id", "ojos"})
                    by_eye = {row["ojo"]: row for row in response.json["data"]["ojos"]}
                    self.assertEqual(set(by_eye), {"OD", "OI"})
                    self.assertEqual((by_eye["OD"]["resultado_ia"],
                                      by_eye["OD"]["diagnostico_final"],
                                      by_eye["OD"]["estado_validacion"]), (2, 3, "CORREGIDO"))
                    self.assertEqual((by_eye["OI"]["resultado_ia"],
                                      by_eye["OI"]["diagnostico_final"],
                                      by_eye["OI"]["estado_validacion"]), (1, 1, "APROBADO"))
                    self.assertEqual(by_eye["OD"]["imagen_url"], "synthetic-only.jpg")
                    self.assertEqual(by_eye["OD"]["gradcam_url"], "synthetic-gradcam.jpg")
                    self.assertEqual(by_eye["OD"]["probabilidades_detalle"], {"grado_2": 80})
                    for forbidden in ("antecedentes_clinicos", "nro_documento", "motivo_consulta",
                                      "informes", "validado_por", "token"):
                        self.assertNotIn(forbidden, response.get_data(as_text=True))
                    selects = [q for q in sql if q.lstrip().lower().startswith("select")]
                    self.assertEqual(len(selects), 5)  # Tres de auth, diagnóstico y detalles agrupados.
                    self.assertFalse(any("from pacientes" in q.lower() or
                                         "from informes" in q.lower() for q in selects))

        for path in (f"/api/diagnosticar/visita/{self.visit_ids[1]}/detalles",
                     "/api/diagnosticar/diagnostico/2147483647/detalles"):
            response, sql = self.call(path, token=self.token(), measure=True)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json, {"success": False,
                                             "message": "Diagnóstico no encontrado."})
            self.assertLessEqual(len([q for q in sql if q.lstrip().lower().startswith("select")]), 5)
        print("ORM detalles IA: dos ojos=5 SELECT; sin diagnóstico=4-5; "
              "sin N+1 ni datos de otros dominios.")

    def test_b1_real_diagnosis_details_denials_and_grant_provenance(self):
        paths = (
            f"/api/diagnosticar/visita/{self.visit_ids[0]}/detalles",
            f"/api/diagnosticar/diagnostico/{self.diagnosis_ids[0]}/detalles",
        )
        wrong = jwt.encode({"user_id": self.user_ids["ophthalmologist"],
                            "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                           "invalid-diagnosis-only-signing-key", algorithm="HS256")
        for path in paths:
            for token in (None, wrong, self.token(expired=True), self.token(expires=False)):
                denied, sql = self.call(path, token=token, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
            with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
                self.assertEqual(self.call(path, token=self.token())[0].status_code, 401)
            for profile in ("administrator", "assistant", "nurse"):
                denied, sql = self.call(path, token=self.token(profile), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
                self.assertNotIn("data", denied.json)
            for permission in ("diagnostico_retinopatia.ver", "imagenes.ver"):
                with self.temporary_grant("OFTALMOLOGO", permission, present=False):
                    for profile in ("ophthalmologist", "dual", "assistant_dual"):
                        denied, sql = self.call(path, token=self.token(profile), measure=True)
                        self.assertEqual(denied.status_code, 403)
                        self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
                self.assertEqual(self.call(path, token=self.token())[0].status_code, 200)
            with self.temporary_grant("ADMINISTRADOR_SISTEMA", "imagenes.ver", present=True):
                with self.temporary_grant("OFTALMOLOGO", "imagenes.ver", present=False):
                    self.assertEqual(self.call(path, token=self.token("dual"))[0].status_code, 403)
            with self.temporary_grant("ADMINISTRADOR_SISTEMA", "diagnostico_retinopatia.ver",
                                      present=True):
                with self.temporary_grant("OFTALMOLOGO", "diagnostico_retinopatia.ver",
                                          present=False):
                    self.assertEqual(self.call(path, token=self.token("dual"))[0].status_code, 403)

    def test_b1_real_diagnosis_details_failure_is_500_without_clinical_log(self):
        path = f"/api/diagnosticar/visita/{self.visit_ids[0]}/detalles"
        with patch.object(DiagnosisRepository, "obtener_detalles_por_visita",
                          side_effect=RuntimeError("synthetic-only.jpg")):
            with patch.object(self.app.logger, "error") as logged:
                result, _ = self.call(path, token=self.token())
        self.assertEqual(result.status_code, 500)
        self.assertEqual(result.json, {"success": False,
                                       "message": "No se pudo procesar la solicitud."})
        logged.assert_called_once_with("Error al consultar detalles de diagnostico")
        self.assertNotIn("synthetic-only.jpg", result.get_data(as_text=True))

    def test_b1_real_validation_first_eyes_revalidation_and_sql_cost(self):
        with self.pending_validation() as ((od, oi), diagnosis_id):
            path = lambda identifier: f"/api/diagnosticar/detalle/{identifier}/validar"
            payload = {"diagnostico_final": 3, "motivo_correccion": "Justificación sintética",
                       "comentario_medico": "Nota sintética"}
            response, sql = self.call(path(od), method="PUT", token=self.token("colleague"),
                                      json_data=payload, measure=True)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["data"], {"estado_validacion": "CORREGIDO"})
            self.assertEqual(response.json["message"], "Diagnóstico validado y guardado exitosamente.")
            print("ORM primera validación: SELECT=%d, UPDATE=%d, INSERT=%d" % (
                sum(q.lstrip().lower().startswith("select") for q in sql),
                sum(q.lstrip().lower().startswith("update") for q in sql),
                sum(q.lstrip().lower().startswith("insert") for q in sql)))
            first = db.session.get(diagnosis_entities.DiagnosticoDetalle, od)
            snapshot = (first.resultado_ia_id, first.resultado_final_id, first.estado_validacion,
                        first.validado_por, first.fecha_validacion, first.comentario_medico,
                        first.motivo_correccion, first.ojo_evaluado)
            self.assertEqual(snapshot[:4], (2, 3, "CORREGIDO", self.user_ids["colleague"]))
            self.assertIsInstance(first.fecha_validacion, datetime)
            self.assertLess(abs(first.fecha_validacion - utc_now_naive()), timedelta(minutes=2))
            self.assertLess(abs(first.fecha_validacion - first.fecha_actualizado),
                            timedelta(seconds=3))
            self.assertEqual(snapshot[5:], ("Nota sintética", "Justificación sintética", "Derecho"))
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, oi).estado_validacion,
                             "PENDIENTE")
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado,
                             "PROCESADO")
            db.session.remove()
            for grade in (3, 0):
                rejected, sql = self.call(path(od), method="PUT", token=self.token(),
                                          json_data={"diagnostico_final": grade}, measure=True)
                self.assertEqual(rejected.status_code, 409)
                self.assertFalse(any(q.lstrip().lower().startswith("update") for q in sql))
                db.session.remove()
                first = db.session.get(diagnosis_entities.DiagnosticoDetalle, od)
                self.assertEqual((first.resultado_ia_id, first.resultado_final_id,
                                  first.estado_validacion, first.validado_por, first.fecha_validacion,
                                  first.comentario_medico, first.motivo_correccion, first.ojo_evaluado), snapshot)
            db.session.remove()
            approved, final_sql = self.call(path(oi), method="PUT", token=self.token(),
                                            json_data={"diagnostico_final": 1}, measure=True)
            self.assertEqual(approved.status_code, 200)
            self.assertEqual(approved.json["data"]["estado_validacion"], "APROBADO")
            self.assertEqual(sum(q.lstrip().lower().startswith("update") for q in final_sql), 2)
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado, "VALIDADO")
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, od).resultado_final_id, 3)

    def test_b1_real_validation_rejects_before_write_and_rolls_back(self):
        with self.pending_validation() as ((od, oi), diagnosis_id):
            path = f"/api/diagnosticar/detalle/{od}/validar"
            token = self.token("dual")
            payload = {"diagnostico_final": 2}
            invalid_signature = jwt.encode({"user_id": self.user_ids["dual"],
                "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                "invalid-only-synthetic-validation-key", algorithm="HS256")
            for invalid in (None, invalid_signature, self.token(expired=True), self.token(expires=False)):
                rejected, sql = self.call(path, method="PUT", token=invalid,
                                          json_data=payload, measure=True)
                self.assertEqual(rejected.status_code, 401)
                self.assertEqual(sql, [])
            with self.temporary_state(Usuario, self.user_ids["dual"], "INACTIVO"):
                self.assertEqual(self.call(path, method="PUT", token=token, json_data=payload)[0].status_code, 401)
            for profile in ("administrator", "nurse", "assistant"):
                rejected, sql = self.call(path, method="PUT", token=self.token(profile),
                                          json_data=payload, measure=True)
                self.assertEqual(rejected.status_code, 403)
                self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
            with self.temporary_state(Rol, Rol.query.filter_by(codigo="OFTALMOLOGO").one().id,
                                      "INACTIVO"):
                self.assertEqual(self.call(path, method="PUT", token=token,
                                           json_data=payload)[0].status_code, 403)
            with self.temporary_state(Permiso, Permiso.query.filter_by(
                codigo="diagnostico_retinopatia.validar").one().id, "INACTIVO"):
                self.assertEqual(self.call(path, method="PUT", token=token,
                                           json_data=payload)[0].status_code, 403)
            with self.temporary_grant("OFTALMOLOGO", "diagnostico_retinopatia.validar", present=False):
                with self.temporary_grant("ADMINISTRADOR_SISTEMA", "diagnostico_retinopatia.validar", present=True):
                    denied, sql = self.call(path, method="PUT", token=token,
                                            json_data=payload, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
            for payload_error in ({**payload, "resultado_ia_id": 4}, {**payload, "validado_por": 2},
                                  {"diagnostico_final": 5}, {"diagnostico_final": 3}):
                denied, sql = self.call(path, method="PUT", token=token,
                                        json_data=payload_error, measure=True)
                self.assertEqual(denied.status_code, 400)
                self.assertFalse(any(q.lstrip().lower().startswith("update") for q in sql))
            with self.temporary_state(diagnosis_entities.GradoRetinopatia, 2, "INACTIVO"):
                self.assertEqual(self.call(path, method="PUT", token=token,
                                           json_data=payload)[0].status_code, 400)
            with self.temporary_state(diagnosis_entities.Diagnostico, diagnosis_id, "ANULADO"):
                self.assertEqual(self.call(path, method="PUT", token=token,
                                           json_data=payload)[0].status_code, 409)
            self.assertEqual(self.call(path + "?token=" + token, method="PUT", token=token,
                                       json_data=payload)[0].status_code, 401)
            self.assertEqual(self.call("/api/diagnosticar/detalle/2147483647/validar", method="PUT",
                                       token=token, json_data=payload)[0].status_code, 404)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, od).estado_validacion,
                             "PENDIENTE")
            # Error de flush después de asignar campos: ninguna escritura persiste.
            original_flush = db.session.flush
            with patch.object(db.session, "flush", side_effect=RuntimeError("Synthetic flush failure")):
                with patch.object(self.app.logger, "error") as logged:
                    failed, _ = self.call(path, method="PUT", token=token, json_data=payload)
                logged.assert_called_once_with("Error al confirmar validacion de diagnostico")
            self.assertEqual(failed.status_code, 500)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, od).estado_validacion,
                             "PENDIENTE")
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, oi).estado_validacion,
                             "PENDIENTE")
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado, "PROCESADO")
            self.assertEqual(self.call(path, method="PUT", token=token, json_data=payload)[0].status_code, 200)

    def test_b1_real_validation_oi_first_and_failed_commit_rolls_back(self):
        with self.pending_validation() as ((od, oi), diagnosis_id):
            path = lambda identifier: f"/api/diagnosticar/detalle/{identifier}/validar"
            db.session.remove()
            with patch.object(db.session, "commit", side_effect=RuntimeError("Synthetic commit failure")):
                failed, sql = self.call(path(oi), method="PUT", token=self.token(),
                                        json_data={"diagnostico_final": 1}, measure=True)
            self.assertEqual(failed.status_code, 500)
            self.assertGreaterEqual(sum(q.lstrip().lower().startswith("update") for q in sql), 1)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, oi).estado_validacion,
                             "PENDIENTE")
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado,
                             "PROCESADO")
            response, _ = self.call(path(oi), method="PUT", token=self.token("colleague"),
                                    json_data={"diagnostico_final": 1})
            self.assertEqual(response.status_code, 200)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, od).estado_validacion,
                             "PENDIENTE")
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado,
                             "PROCESADO")
            response, _ = self.call(path(od), method="PUT", token=self.token(),
                                    json_data={"diagnostico_final": 2})
            self.assertEqual(response.status_code, 200)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado,
                             "VALIDADO")

    def test_b1_real_validation_concurrent_requests_single_winner(self):
        with self.pending_validation() as ((od, oi), diagnosis_id):
            barrier = Barrier(2, timeout=12)
            connection_ids = set()
            path = f"/api/diagnosticar/detalle/{od}/validar"
            def synchronize(conn, cursor, statement, parameters, context, executemany):
                if "FOR UPDATE" in statement.upper() and "diagnosticos_retinopatia" in statement and "detalle" not in statement:
                    connection_ids.add(conn.connection.driver_connection.thread_id())
                    barrier.wait()

            def submit(grade):
                with self.app.app_context():
                    try:
                        with self.app.test_client() as client:
                            response = client.put(path, json={"diagnostico_final": grade,
                                "motivo_correccion": "Justificación sintética"},
                                headers={"Authorization": "Bearer " + self.token("colleague")})
                            return grade, response.status_code
                    finally:
                        db.session.remove()

            db.session.remove()
            event.listen(db.engine, "before_cursor_execute", synchronize)
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(submit, 2)
                    second = pool.submit(submit, 3)
                    outcomes = [first.result(timeout=20), second.result(timeout=20)]
            finally:
                event.remove(db.engine, "before_cursor_execute", synchronize)
            self.assertEqual(len(connection_ids), 2)
            self.assertEqual(sorted(code for _, code in outcomes), [200, 409])
            winner_grade = next(grade for grade, code in outcomes if code == 200)
            db.session.remove()
            detail = db.session.get(diagnosis_entities.DiagnosticoDetalle, od)
            self.assertEqual(detail.resultado_final_id, winner_grade)
            self.assertEqual(detail.resultado_ia_id, 2)
            self.assertEqual(detail.validado_por, self.user_ids["colleague"])
            self.assertIsNotNone(detail.fecha_validacion)
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, oi).estado_validacion,
                             "PENDIENTE")

    def test_real_creation_first_both_eyes_retries_and_validated_preserved(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            statements = []
            lock_started = []
            def count_sql(conn, cursor, statement, parameters, context, executemany):
                statements.append(statement)  # No parámetros ni información clínica.
                if 'FOR UPDATE' in statement.upper() and not lock_started:
                    lock_started.append(time.perf_counter())
            event.listen(db.engine, 'before_cursor_execute', count_sql)
            try:
                first = self.create_image(visit=visit_id)
                elapsed_lock = time.perf_counter() - lock_started[0]
            finally:
                event.remove(db.engine, 'before_cursor_execute', count_sql)
            self.assertEqual(first.status_code, 200, first.json)
            counts = Counter(sql.lstrip().split(None, 1)[0].upper() for sql in statements)
            print('ORM POST diagnóstico B1 (visita existente, primer ojo): '
                  f'SELECT={counts["SELECT"]}, INSERT={counts["INSERT"]}, UPDATE={counts["UPDATE"]}; '
                  f'primer FOR UPDATE a respuesta={elapsed_lock:.3f}s')
            od_id = first.json['data']['detalle_id']
            self.assertEqual(first.json['data']['visita_id'], visit_id)
            self.assertEqual(len(self.published_files(folder)), 2)
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])
            db.session.remove()
            od = db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id)
            self.assertEqual((od.ojo_evaluado, od.resultado_ia_id, od.estado_validacion),
                             ('Derecho', 2, 'PENDIENTE'))
            original = (od.imagen_original_url, od.imagen_gradcam_url, od.resultado_completo)
            db.session.remove()
            statements = []
            event.listen(db.engine, 'before_cursor_execute', count_sql)
            try:
                same = self.create_image(visit=visit_id)
            finally:
                event.remove(db.engine, 'before_cursor_execute', count_sql)
            self.assertEqual(same.status_code, 409)
            retry_counts = Counter(sql.lstrip().split(None, 1)[0].upper() for sql in statements)
            print('ORM POST B1 reintento mismo ojo: '
                  f'SELECT={retry_counts["SELECT"]}, INSERT={retry_counts["INSERT"]}, '
                  f'UPDATE={retry_counts["UPDATE"]}')
            self.assertFalse(any(sql.lstrip().upper().startswith(('INSERT', 'UPDATE'))
                                 for sql in statements))
            self.assertEqual(model.call_count, 1)
            self.assertEqual(len(self.published_files(folder)), 2)
            other = self.create_image(eye='Izquierdo', alias=visit_id)
            self.assertEqual(other.status_code, 200, other.json)
            self.assertEqual(model.call_count, 2)
            diagnosis_id = first.json['data']['diagnostico_retinopatia_id']
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico, diagnosis_id).estado,
                             'PROCESADO')
            checked, _ = self.call(f'/api/diagnosticar/detalle/{od_id}/validar',
                                   method='PUT', token=self.token('colleague'),
                                   json_data={'diagnostico_final': 3,
                                              'motivo_correccion': 'Justificación sintética'})
            self.assertEqual(checked.status_code, 200)
            db.session.remove()
            od = db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id)
            medical = (od.resultado_ia_id, od.resultado_final_id, od.estado_validacion,
                       od.validado_por, od.fecha_validacion, od.comentario_medico,
                       od.motivo_correccion, od.imagen_original_url,
                       od.imagen_gradcam_url, od.resultado_completo)
            db.session.remove()
            repeated = self.create_image(visit=visit_id)
            self.assertEqual(repeated.status_code, 409)
            self.assertEqual(model.call_count, 2)
            db.session.remove()
            od = db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id)
            self.assertEqual((od.resultado_ia_id, od.resultado_final_id, od.estado_validacion,
                              od.validado_por, od.fecha_validacion, od.comentario_medico,
                              od.motivo_correccion, od.imagen_original_url,
                              od.imagen_gradcam_url, od.resultado_completo), medical)
            self.assertEqual((od.imagen_original_url, od.imagen_gradcam_url, od.resultado_completo), original)
            self.assertEqual(len(self.published_files(folder)), 4)
            details, _ = self.call(f'/api/diagnosticar/visita/{visit_id}/detalles', token=self.token())
            self.assertEqual(details.status_code, 200)
            self.assertEqual({d['ojo'] for d in details.json['data']['ojos']}, {'OD', 'OI'})

    def test_real_creation_validated_first_eye_allows_other_without_erasing_it(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation():
            first = self.create_image(visit=visit_id)
            self.assertEqual(first.status_code, 200, first.json)
            od_id = first.json['data']['detalle_id']
            checked, _ = self.call(f'/api/diagnosticar/detalle/{od_id}/validar',
                                   method='PUT', token=self.token(),
                                   json_data={'diagnostico_final': 2})
            self.assertEqual(checked.status_code, 200)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico,
                                            first.json['data']['diagnostico_retinopatia_id']).estado,
                             'VALIDADO')
            opposite = self.create_image(eye='Izquierdo', visit=visit_id)
            self.assertEqual(opposite.status_code, 200, opposite.json)
            db.session.remove()
            self.assertEqual(db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id).estado_validacion,
                             'APROBADO')
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico,
                                            first.json['data']['diagnostico_retinopatia_id']).estado,
                             'PROCESADO')  # Nuevo ojo pendiente; anterior aprobado permanece.

    def test_real_creation_early_denials_semantic_and_limits_do_not_infer(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            for kwargs, code in (({'eye': 'Otro', 'visit': visit_id}, 400),
                                 ({'visit': 2147483647}, 404),
                                 ({'visit': visit_id, 'patient': self.patient_ids[0]}, 409),
                                 ({'visit': visit_id, 'alias': visit_id + 1}, 400),
                                 ({'alias': visit_id}, 404),
                                 ({'visit': visit_id, 'raw': b'not image'}, 400),
                                 ({'visit': visit_id, 'filename': '../image.jpg'}, 400),
                                 ({'visit': visit_id, 'mimetype': 'application/octet-stream'}, 400),
                                 ({'visit': visit_id, 'raw': b'0' * (20 * 1024 * 1024 + 1)}, 413)):
                with self.subTest(kwargs={key: value for key, value in kwargs.items() if key != 'raw'}):
                    response = self.create_image(**kwargs)
                    self.assertEqual(response.status_code, code, response.json)
            with self.temporary_state(VisitaClinica, visit_id, 'CERRADA'):
                self.assertEqual(self.create_image(visit=visit_id).status_code, 409)
            with self.temporary_state(VisitaClinica, visit_id, 'ANULADA'):
                self.assertEqual(self.create_image(visit=visit_id).status_code, 409)
            bearer = self.token()
            url_token = self.client.post('/api/diagnosticar?token=' + bearer,
                data={'paciente_id': str(self.patient_ids[1]),
                      'visita_id': str(visit_id), 'ojo_evaluado': 'Derecho'},
                headers={'Authorization': 'Bearer ' + bearer})
            self.assertEqual(url_token.status_code, 401)
            self.assertEqual(model.call_count, 0)
            self.assertEqual(self.published_files(folder), [])
            db.session.remove()
            self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation(
                semantic=lambda *_: {'valido': False, 'error': 'Imagen no retiniana.'}) as (folder, model):
            self.assertEqual(self.create_image(visit=visit_id).status_code, 422)
            model.assert_not_called()
            self.assertEqual(self.published_files(folder), [])
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation(
                semantic=lambda *_: {'valido': False, 'status': 503,
                                      'error': 'Synthetic private error'}) as (folder, model):
            rejected = self.create_image(visit=visit_id)
            self.assertEqual(rejected.status_code, 503)
            self.assertNotIn('Synthetic private error', rejected.get_data(as_text=True))
            model.assert_not_called()
            self.assertEqual(self.published_files(folder), [])
        with patch.object(real_validator, '_get_clip', side_effect=RuntimeError('synthetic model path')):
            with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation(
                    semantic=real_validator.validar_contenido_semantico) as (folder, model):
                rejected = self.create_image(visit=visit_id)
                self.assertEqual(rejected.status_code, 503)
                self.assertNotIn('synthetic model path', rejected.get_data(as_text=True))
                model.assert_not_called()
                self.assertEqual(self.published_files(folder), [])

    def test_real_creation_supported_formats_and_concurrent_same_eye(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            barrier = Barrier(2, timeout=15)
            connections = set()
            def synchronize(conn, cursor, statement, parameters, context, executemany):
                if ('FOR UPDATE' in statement.upper() and
                        'FROM visitas_clinicas' in statement and
                        'diagnosticos_retinopatia' not in statement):
                    connections.add(conn.connection.driver_connection.thread_id())
                    barrier.wait()

            def submit():
                from io import BytesIO
                with self.app.app_context():
                    try:
                        with self.app.test_client() as client:
                            response = client.post('/api/diagnosticar',
                                data={'paciente_id': str(self.patient_ids[1]),
                                      'visita_id': str(visit_id), 'ojo_evaluado': 'Derecho',
                                      'imagen': (BytesIO(image_bytes('JPEG')),
                                                 'synthetic.jpg', 'image/jpeg')},
                                content_type='multipart/form-data',
                                headers={'Authorization': 'Bearer ' + self.token()})
                            return response.status_code
                    finally:
                        db.session.remove()

            db.session.remove()
            event.listen(db.engine, 'before_cursor_execute', synchronize)
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(submit)
                    second = pool.submit(submit)
                    outcomes = sorted([first.result(timeout=25), second.result(timeout=25)])
            finally:
                event.remove(db.engine, 'before_cursor_execute', synchronize)
            self.assertEqual(len(connections), 2)
            self.assertEqual(outcomes, [200, 409])
            db.session.remove()
            diagnosis = diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).one()
            self.assertEqual(len(diagnosis.detalles), 1)
            self.assertEqual(diagnosis.detalles[0].estado_validacion, 'PENDIENTE')
            self.assertEqual(len(self.published_files(folder)), 2)
            self.assertEqual(model.call_count, 2)  # Prechequeos pueden cruzarse; INSERT solo uno.
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])

        for fmt, filename, mime in (('PNG', 'synthetic.png', 'image/png'),
                                    ('TIFF', 'synthetic.tif', 'image/tiff')):
            with self.subTest(fmt=fmt), self.empty_diagnosis_visit() as visit_id, self.stubbed_creation():
                result = self.create_image(visit=visit_id, raw=image_bytes(fmt),
                                           filename=filename, mimetype=mime)
                self.assertEqual(result.status_code, 200, result.json)

    def test_real_creation_filename_collision_never_overwrites_prior_files(self):
        from types import SimpleNamespace
        with self.empty_diagnosis_visit() as first_visit, \
             self.empty_diagnosis_visit() as second_visit, \
             self.stubbed_creation() as (folder, model), \
             patch.object(diagnosis_service.uuid, 'uuid4',
                          return_value=SimpleNamespace(hex='f' * 32)):
            first = self.create_image(visit=first_visit)
            self.assertEqual(first.status_code, 200, first.json)
            snapshots = {file.name: file.read_bytes() for file in self.published_files(folder)}
            self.assertEqual(len(snapshots), 2)
            with patch.object(self.app.logger, 'error'):
                second = self.create_image(visit=second_visit)
            self.assertEqual(second.status_code, 500)
            self.assertEqual({file.name: file.read_bytes() for file in self.published_files(folder)},
                             snapshots)
            db.session.remove()
            self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=second_visit).first())

    def test_real_creation_new_visit_single_commit_and_readable_jpegs(self):
        from PIL import Image
        with self.stubbed_creation() as (folder, model):
            prepared = []
            original_prepare = diagnosis_service.DiagnosisFiles.prepare
            original_publish = diagnosis_service.DiagnosisFiles.publish
            published = []
            def prepare(files, image):
                prepared.append(True)
                return original_prepare(files, image)
            def publish(files, temporary, name):
                published.append(name)
                return original_publish(files, temporary, name)
            commits = []
            original_commit = db.session.commit
            def commit():
                commits.append(True)
                return original_commit()
            with patch.object(diagnosis_service.DiagnosisFiles, 'prepare', prepare), \
                 patch.object(diagnosis_service.DiagnosisFiles, 'publish', publish), \
                 patch.object(db.session, 'commit', commit):
                response = self.create_image()
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual((len(prepared), len(published), len(commits)), (2, 2, 1))
            self.assertEqual(len(self.published_files(folder)), 2)
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])
            for file in self.published_files(folder):
                with Image.open(file) as image:
                    self.assertEqual(image.format, 'JPEG')
                    image.load()
            db.session.remove()
            detail = db.session.get(diagnosis_entities.DiagnosticoDetalle,
                                    response.json['data']['detalle_id'])
            self.assertEqual({detail.imagen_original_url, detail.imagen_gradcam_url}, set(published))
            self.assertEqual(db.session.get(diagnosis_entities.Diagnostico,
                                            detail.diagnostico_retinopatia_id).visita_id,
                             response.json['data']['visita_id'])
            visit = db.session.get(VisitaClinica, response.json['data']['visita_id'])
            self.assertEqual(visit.paciente_id, self.patient_ids[1])
            db.session.delete(detail.diagnostico)
            db.session.flush()
            db.session.delete(visit)
            db.session.commit()
            db.session.remove()

    def test_real_creation_faults_roll_back_and_clean_only_owned_files(self):
        from utils import diagnosis_storage
        original_prepare = diagnosis_storage.DiagnosisFiles.prepare
        original_verify = diagnosis_storage.DiagnosisFiles.verify
        original_publish = diagnosis_storage.DiagnosisFiles.publish
        for stage in ('prepare_original', 'prepare_gradcam', 'verify', 'flush',
                      'publish_original', 'publish_gradcam', 'commit'):
            with self.subTest(stage=stage), self.empty_diagnosis_visit() as visit_id, \
                 self.stubbed_creation() as (folder, model):
                counters = Counter()
                def prepare(files, image):
                    counters['prepare'] += 1
                    if stage == 'prepare_original' and counters['prepare'] == 1:
                        raise OSError('synthetic disk error')
                    if stage == 'prepare_gradcam' and counters['prepare'] == 2:
                        raise OSError('synthetic disk error')
                    return original_prepare(files, image)
                def verify(path):
                    if stage == 'verify':
                        raise ValueError('synthetic invalid jpeg')
                    return original_verify(path)
                def publish(files, temporary, name):
                    counters['publish'] += 1
                    if stage == 'publish_original' and counters['publish'] == 1:
                        raise OSError('synthetic publish error')
                    if stage == 'publish_gradcam' and counters['publish'] == 2:
                        raise OSError('synthetic publish error')
                    return original_publish(files, temporary, name)
                def inject_flush(conn, cursor, statement, parameters, context, executemany):
                    if stage == 'flush' and 'INSERT INTO diagnosticos_retinopatia_detalle' in statement:
                        raise RuntimeError('synthetic insert error')
                original_commit = db.session.commit
                def commit():
                    if stage == 'commit':
                        raise RuntimeError('synthetic commit error')
                    return original_commit()
                db.session.remove()
                event.listen(db.engine, 'before_cursor_execute', inject_flush)
                try:
                    with patch.object(diagnosis_storage.DiagnosisFiles, 'prepare', prepare), \
                         patch.object(diagnosis_storage.DiagnosisFiles, 'verify', verify), \
                         patch.object(diagnosis_storage.DiagnosisFiles, 'publish', publish), \
                         patch.object(db.session, 'commit', commit), \
                         patch.object(self.app.logger, 'error'):
                        response = self.create_image(visit=visit_id)
                finally:
                    event.remove(db.engine, 'before_cursor_execute', inject_flush)
                self.assertEqual(response.status_code, 500, response.json)
                self.assertEqual(self.published_files(folder), [])
                pending = Path(folder) / '.pending'
                if pending.exists():
                    self.assertEqual(list(pending.iterdir()), [])
                db.session.remove()
                self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())

    def test_real_creation_commit_ambiguous_keeps_confirmed_images(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            original_commit = db.session.commit
            def commit_then_raise():
                original_commit()
                raise OSError('synthetic lost acknowledgement')
            with patch.object(db.session, 'commit', commit_then_raise), \
                 patch.object(self.app.logger, 'error'):
                response = self.create_image(visit=visit_id)
            self.assertEqual(response.status_code, 500)
            db.session.remove()
            diagnosis = diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).one()
            detail = diagnosis.detalles[0]
            self.assertEqual({file.name for file in self.published_files(folder)},
                             {detail.imagen_original_url, detail.imagen_gradcam_url})
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])

    def test_real_creation_rollback_preserves_validated_other_eye_and_files(self):
        from utils import diagnosis_storage
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            first = self.create_image(visit=visit_id)
            self.assertEqual(first.status_code, 200)
            od_id = first.json['data']['detalle_id']
            checked, _ = self.call(f'/api/diagnosticar/detalle/{od_id}/validar',
                                   method='PUT', token=self.token(),
                                   json_data={'diagnostico_final': 3,
                                              'motivo_correccion': 'Justificación sintética'})
            self.assertEqual(checked.status_code, 200)
            db.session.remove()
            od = db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id)
            prior = (od.resultado_ia_id, od.resultado_final_id, od.estado_validacion,
                     od.validado_por, od.fecha_validacion, od.motivo_correccion)
            snapshot = {file.name: file.read_bytes() for file in self.published_files(folder)}
            db.session.remove()
            original_publish = diagnosis_storage.DiagnosisFiles.publish
            def publish(files, temporary, name):
                if name.endswith('_gradcam.jpg'):
                    raise OSError('synthetic disk error')
                return original_publish(files, temporary, name)
            with patch.object(diagnosis_storage.DiagnosisFiles, 'publish', publish), \
                 patch.object(self.app.logger, 'error'):
                rejected = self.create_image(eye='Izquierdo', visit=visit_id)
                self.assertEqual(rejected.status_code, 500, rejected.json)
            db.session.remove()
            od = db.session.get(diagnosis_entities.DiagnosticoDetalle, od_id)
            self.assertEqual((od.resultado_ia_id, od.resultado_final_id, od.estado_validacion,
                              od.validado_por, od.fecha_validacion, od.motivo_correccion), prior)
            self.assertEqual(od.diagnostico.estado, 'VALIDADO')
            self.assertEqual(len(od.diagnostico.detalles), 1)
            self.assertEqual({file.name: file.read_bytes() for file in self.published_files(folder)}, snapshot)
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])

    def test_real_creation_new_visit_failure_does_not_leave_visit(self):
        from utils import diagnosis_storage
        db.session.remove()
        before = (db.session.query(VisitaClinica).count(),
                  db.session.query(diagnosis_entities.Diagnostico).count(),
                  db.session.query(diagnosis_entities.DiagnosticoDetalle).count())
        db.session.remove()
        with self.stubbed_creation() as (folder, model):
            def fail_second(files, temporary, name):
                if name.endswith('_gradcam.jpg'):
                    raise OSError('synthetic disk failure')
                return original_publish(files, temporary, name)
            original_publish = diagnosis_storage.DiagnosisFiles.publish
            with patch.object(diagnosis_storage.DiagnosisFiles, 'publish', fail_second), \
                 patch.object(self.app.logger, 'error'):
                response = self.create_image()
            self.assertEqual(response.status_code, 500)
            self.assertEqual(self.published_files(folder), [])
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])
        db.session.remove()
        self.assertEqual((db.session.query(VisitaClinica).count(),
                          db.session.query(diagnosis_entities.Diagnostico).count(),
                          db.session.query(diagnosis_entities.DiagnosticoDetalle).count()), before)

    def test_real_creation_reconciliation_inspects_database_without_deleting(self):
        from utils.diagnosis_storage import inspect_database_candidates
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            response = self.create_image(visit=visit_id)
            self.assertEqual(response.status_code, 200, response.json)
            stray = Path(folder) / ('P7_Derecho_' + 'e' * 32 + '.jpg')
            stray.write_bytes(b'synthetic orphan candidate')
            old = time.time() - 90000
            os.utime(stray, (old, old))
            db.session.remove()
            candidates = inspect_database_candidates(folder)
            self.assertEqual(candidates['unreferenced_candidates'], [stray.name])
            self.assertEqual(candidates['temporary_candidates'], [])
            db.session.remove()
            detail = db.session.get(diagnosis_entities.DiagnosticoDetalle,
                                    response.json['data']['detalle_id'])
            self.assertNotIn(detail.imagen_original_url, candidates['missing_referenced'])
            self.assertNotIn(detail.imagen_gradcam_url, candidates['missing_referenced'])
            self.assertEqual(len(self.published_files(folder)), 3)

    def test_real_post_b1_conditional_visit_grant_and_multirole_provenance(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            with self.temporary_grant('OFTALMOLOGO', 'visitas.crear', present=False):
                denied, statements, counts = self.measured_creation(raw=b'not-image')
                self.assertEqual(denied.status_code, 403)
                self.assertEqual(counts['SELECT'], 3)
                self.assertEqual(counts['INSERT'], 0)
                self.assertFalse(any('pacientes' in sql.lower() or 'visitas_clinicas' in sql.lower()
                                     or 'diagnosticos_retinopatia' in sql.lower() for sql in statements))
                model.assert_not_called()
                self.assertEqual(self.published_files(folder), [])
                self.assertFalse((Path(folder) / '.pending').exists())

                with self.temporary_grant('OFTALMOLOGO', 'pacientes.ver', present=False):
                    existing, sql, counts = self.measured_creation(visit=visit_id)
                self.assertEqual(existing.status_code, 200, existing.json)
                print('ORM POST B1 sin visitas.crear (visita existente): '
                      f'SELECT={counts["SELECT"]}, INSERT={counts["INSERT"]}, UPDATE={counts["UPDATE"]}; '
                      'denegación de nueva visita: SELECT=3, INSERT=0')
                self.assertEqual(len(self.published_files(folder)), 2)
                alias = self.create_image(alias=visit_id)
                self.assertEqual(alias.status_code, 409)  # Mismo ojo, misma autorización.
                model.assert_called_once()
                bad = self.create_image(eye='Izquierdo', alias='0', raw=b'not-image')
                self.assertEqual(bad.status_code, 400)
                model.assert_called_once()
                # El rol administrativo no puede aportar visitas.crear al rol O.
                with self.temporary_grant('ADMINISTRADOR_SISTEMA', 'visitas.crear', present=True):
                    denied = self.create_image(token=self.token('dual'), raw=b'not-image')
                    self.assertEqual(denied.status_code, 403)
                    model.assert_called_once()

            for role, permission in (('OFTALMOLOGO', 'diagnostico_retinopatia.crear'),
                                     ('OFTALMOLOGO', 'imagenes.ver')):
                with self.subTest(revoked=permission), self.temporary_grant(role, permission, present=False):
                    for profile in ('ophthalmologist', 'dual'):
                        denied, statements, counts = self.measured_creation(
                            eye='Izquierdo', visit=visit_id, token=self.token(profile), raw=b'invalid')
                        self.assertEqual(denied.status_code, 403)
                        self.assertEqual(counts['SELECT'], 3)
                        self.assertEqual(counts['INSERT'], 0)
                        self.assertFalse(any('visitas_clinicas' in sql.lower() for sql in statements))
                        model.assert_called_once()
            permission_id = Permiso.query.filter_by(codigo='imagenes.ver').one().id
            with self.temporary_state(Permiso, permission_id, 'INACTIVO'):
                self.assertEqual(self.create_image(eye='Izquierdo', visit=visit_id,
                                                   raw=b'invalid').status_code, 403)
                model.assert_called_once()
            with self.temporary_grant('OFTALMOLOGO', 'imagenes.ver', present=False), \
                 self.temporary_grant('ADMINISTRADOR_SISTEMA', 'imagenes.ver', present=True):
                self.assertEqual(self.create_image(eye='Izquierdo', visit=visit_id,
                                                   token=self.token('dual'), raw=b'invalid').status_code, 403)
            # El multirrol solo funciona si O mantiene sus propios grants.
            authorized = self.create_image(eye='Izquierdo', visit=visit_id,
                                           token=self.token('dual'))
            self.assertEqual(authorized.status_code, 200, authorized.json)

    def test_real_post_b1_role_state_revocations_and_auth_fail_closed(self):
        with self.empty_diagnosis_visit() as visit_id, self.stubbed_creation() as (folder, model):
            for profile in ('administrator', 'nurse', 'assistant'):
                with self.subTest(profile=profile):
                    denied, statements, counts = self.measured_creation(
                        visit=visit_id, token=self.token(profile), raw=b'invalid')
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(counts['SELECT'], 3)
                    self.assertEqual(counts['INSERT'], 0)
                    self.assertFalse(any('pacientes' in sql.lower() or 'visitas_clinicas' in sql.lower()
                                         for sql in statements))
            role_id = Rol.query.filter_by(codigo='OFTALMOLOGO').one().id
            with self.temporary_state(Rol, role_id, 'INACTIVO'):
                self.assertEqual(self.create_image(visit=visit_id, raw=b'invalid').status_code, 403)
            user_id = self.user_ids['ophthalmologist']
            link = UsuarioRol.query.filter_by(usuario_id=user_id, rol_id=role_id).one()
            created_at = link.fecha_creado
            db.session.delete(link)
            db.session.commit()
            db.session.remove()
            try:
                self.assertEqual(self.create_image(visit=visit_id, raw=b'invalid').status_code, 403)
            finally:
                db.session.add(UsuarioRol(usuario_id=user_id, rol_id=role_id,
                                          fecha_creado=created_at))
                db.session.commit()
                db.session.remove()
            with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                self.assertEqual(self.create_image(visit=visit_id, raw=b'invalid').status_code, 401)
            for token, path in ((None, '/api/diagnosticar'),
                                (self.token(expired=True), '/api/diagnosticar'),
                                (self.token(), '/api/diagnosticar?token=' + self.token())):
                from io import BytesIO
                response = self.client.post(path, data={
                    'paciente_id': str(self.patient_ids[1]), 'visita_id': str(visit_id),
                    'ojo_evaluado': 'Derecho', 'imagen': (BytesIO(b'invalid'), 'a.jpg', 'image/jpeg')},
                    headers={'Authorization': 'Bearer ' + token} if token else None)
                self.assertEqual(response.status_code, 401)
            model.assert_not_called()
            self.assertEqual(self.published_files(folder), [])

    def test_real_post_b1_new_visit_authorized_files_and_contract(self):
        from PIL import Image
        with self.stubbed_creation() as (folder, model):
            response, statements, counts = self.measured_creation()
            self.assertEqual(response.status_code, 200, response.json)
            print('ORM POST B1 (visita nueva): '
                  f'SELECT={counts["SELECT"]}, INSERT={counts["INSERT"]}, UPDATE={counts["UPDATE"]}')
            self.assertEqual(counts['INSERT'], 3)
            self.assertEqual(len(self.published_files(folder)), 2)
            self.assertEqual(list((Path(folder) / '.pending').iterdir()), [])
            for file in self.published_files(folder):
                with Image.open(file) as image:
                    self.assertEqual(image.format, 'JPEG')
                    image.load()
            db.session.remove()
            result = response.json['data']
            detail = db.session.get(diagnosis_entities.DiagnosticoDetalle, result['detalle_id'])
            self.assertEqual({detail.imagen_original_url, detail.imagen_gradcam_url},
                             {file.name for file in self.published_files(folder)})
            visit = db.session.get(VisitaClinica, result['visita_id'])
            self.assertEqual(visit.paciente_id, self.patient_ids[1])
            self.assertEqual(result['gradcam_url'], detail.imagen_gradcam_url)
            with patch.object(files_routes, 'RETINAS_FOLDER', folder):
                for name in (detail.imagen_original_url, detail.imagen_gradcam_url):
                    served, _ = self.call('/uploads/retinas/' + name, token=self.token())
                    self.assertEqual(served.status_code, 200)
                    from io import BytesIO
                    with Image.open(BytesIO(served.get_data())) as decoded:
                        self.assertEqual(decoded.format, 'JPEG')
                        decoded.load()
                    served.close()
            db.session.remove()
            db.session.delete(db.session.get(diagnosis_entities.Diagnostico,
                                             result['diagnostico_retinopatia_id']))
            db.session.flush()
            db.session.delete(db.session.get(VisitaClinica, result['visita_id']))
            db.session.commit()
            db.session.remove()

    def test_b1_real_retina_file_requires_bearer_and_registered_resource(self):
        for name in ("synthetic-only.jpg", "synthetic-gradcam.jpg"):
            path = f"/uploads/retinas/{name}"
            response, sql = self.call(path, token=self.token(), measure=True)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, "image/jpeg")
            self.assertEqual(response.headers["Cache-Control"], "private, no-store")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 4)
            self.assertFalse(any("select *" in q.lower() for q in sql))
            response.close()

        path = "/uploads/retinas/synthetic-only.jpg"
        for token in (None, self.token(expired=True)):
            denied, sql = self.call(path, token=token, measure=True)
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(sql, [])
        for token in (None, self.token()):
            db.session.remove()
            headers = {"Authorization": f"Bearer {token}"} if token else None
            denied = self.client.get(path, query_string={"token": self.token()}, headers=headers)
            self.assertEqual(denied.status_code, 401)
            self.assertNotIn("synthetic-only.jpg", denied.get_data(as_text=True))
        with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
            self.assertEqual(self.call(path, token=self.token())[0].status_code, 401)
        for profile in ("administrator", "assistant", "nurse"):
            denied, sql = self.call(path, token=self.token(profile), measure=True)
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
        dual_response, _ = self.call(path, token=self.token("dual"))
        self.assertEqual(dual_response.status_code, 200)
        dual_response.close()
        with self.temporary_grant("ADMINISTRADOR_SISTEMA", "imagenes.ver", present=True):
            with self.temporary_grant("OFTALMOLOGO", "imagenes.ver", present=False):
                for profile in ("ophthalmologist", "dual", "assistant_dual"):
                    denied, sql = self.call(path, token=self.token(profile), measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(sum(q.lstrip().lower().startswith("select") for q in sql), 3)
        response, _ = self.call(path, token=self.token())
        self.assertEqual(response.status_code, 200)
        response.close()

        for name in ("unregistered.jpg", "missing.jpg", "synthetic-only.exe",
                     "..%5csynthetic-only.jpg"):
            response, _ = self.call(f"/uploads/retinas/{name}", token=self.token())
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("synthetic-only.jpg", response.get_data(as_text=True))
        print("ORM imagen registrada: 4 SELECT (3 autenticación + 1 vínculo); "
              "denegación: 3 SELECT sin consultar recursos; token en URL: 401.")

    def test_b1_real_post_creates_by_role_without_leaking_fields(self):
        payloads = {
            "ophthalmologist": ("clinical", {"antecedentes_clinicos": "Antecedente ficticio",
                                             "alergias": "Alergia ficticia"}),
            "nurse": ("assistance", {"alergias": "Alergia ficticia"}),
            "assistant": ("administrative", {}),
            "dual": ("clinical", {"antecedentes_clinicos": "Antecedente ficticio"}),
        }
        for profile, (scope, extra) in payloads.items():
            with self.subTest(profile=profile):
                payload = self.registration(**extra)
                response, sql = self.call("/api/pacientes", method="POST", token=self.token(profile),
                                          json_data=payload, measure=True)
                self.assertEqual(response.status_code, 201)
                self.assertIsInstance(response.json["data"]["id"], int)
                self.assertEqual(response.json["data"]["nro_documento"], payload["nro_documento"])
                self.assertEqual(db.session.get(Paciente, response.json["data"]["id"]).nro_documento,
                                 payload["nro_documento"])
                self.assertEqual("antecedentes_clinicos" in response.json["data"], scope == "clinical")
                self.assertEqual("alergias" in response.json["data"], scope != "administrative")
                for field in ("diagnosticos", "informes", "imagenes", "ultima_visita", "maxima_gravedad"):
                    self.assertNotIn(field, response.json["data"])
                if scope == "administrative":
                    self.assertNotIn("consentimiento_informado", response.json["data"])
                    self.assertNotIn("antecedentes_clinicos", response.json["data"])
                self.assertEqual(sum("insert into pacientes" in item.lower().replace("`", "")
                                     for item in sql), 1)
                selects = [item for item in sql if item.lstrip().lower().startswith("select")]
                self.assertLessEqual(len(selects), 7)
                self.assertFalse(any("visitas_clinicas" in item.lower() or
                                     "diagnosticos_retinopatia" in item.lower() for item in sql))
                print(f"ORM POST {profile}: SELECT={len(selects)}, INSERT pacientes=1")

    def test_b1_real_post_rejects_forbidden_input_before_any_write(self):
        attempts = (
            ("assistant", {"antecedentes_clinicos": "Antecedente ficticio"}),
            ("assistant", {"alergias": None}),
            ("assistant", {"diagnosticos": [{"resultado_ia": 4}]}),
            ("assistant", {"ultima_visita": "2030-01-01"}),
            ("assistant", {"nombre_clinico": "extra"}),
            ("assistant", {"nombres": {"alergias": "dato"}}),
            ("nurse", {"antecedentes_clinicos": "Antecedente ficticio"}),
            ("ophthalmologist", {"resultado_ia_id": 4}),
            ("ophthalmologist", {"fecha_consentimiento": "2030-01-01"}),
        )
        for profile, extra in attempts:
            with self.subTest(profile=profile, fields=tuple(extra)):
                payload = self.registration(**extra)
                rejected, sql = self.call("/api/pacientes", method="POST", token=self.token(profile),
                                          json_data=payload, measure=True)
                self.assertEqual(rejected.status_code, 400)
                self.assertEqual(sum(item.lstrip().lower().startswith("select") for item in sql), 3)
                self.assertFalse(any("insert into pacientes" in item.lower().replace("`", "")
                                     for item in sql))
                self.assertFalse(any("from pacientes" in item.lower().replace("`", "")
                                     for item in sql))
                self.assertIsNone(Paciente.query.filter_by(nro_documento=payload["nro_documento"]).first())

    def test_b1_real_post_authorization_revocation_read_independence_and_validation(self):
        payload = self.registration()
        for profile, status in (("administrator", 403),):
            response, sql = self.call("/api/pacientes", method="POST", token=self.token(profile),
                                      json_data=payload, measure=True)
            self.assertEqual(response.status_code, status)
            self.assertFalse(any("from pacientes" in item.lower() for item in sql))
        self.assertEqual(self.call("/api/pacientes", method="POST", json_data=payload)[0].status_code, 401)
        self.assertEqual(self.call("/api/pacientes", method="POST", token=self.token(expired=True),
                                   json_data=payload)[0].status_code, 401)
        with self.temporary_state(Usuario, self.user_ids["ophthalmologist"], "INACTIVO"):
            self.assertEqual(self.call("/api/pacientes", method="POST", token=self.token(),
                                       json_data=payload)[0].status_code, 401)
        with self.temporary_grant("OFTALMOLOGO", "pacientes.crear", present=False):
            self.assertEqual(self.call("/api/pacientes", method="POST", token=self.token(),
                                       json_data=payload)[0].status_code, 403)
            self.assertEqual(self.call("/api/pacientes", method="POST", token=self.token("dual"),
                                       json_data=payload)[0].status_code, 403)
        with self.temporary_grant("OFTALMOLOGO", "pacientes.ver", present=False):
            created, sql = self.call("/api/pacientes", method="POST", token=self.token(),
                                     json_data=payload, measure=True)
            self.assertEqual(created.status_code, 201)
            self.assertEqual(set(created.json["data"]), {"id"})
            self.assertEqual(sum("from pacientes" in item.lower().replace("`", "")
                                 for item in sql), 1)  # Solo comprobación de duplicado.
            self.assertEqual(sum(item.lstrip().lower().startswith("select") for item in sql), 5)
            with self.temporary_grant("ASISTENTE_ADMINISTRATIVO", "pacientes.ver", present=False):
                assistant_payload = self.registration()
                assistant_created, assistant_sql = self.call(
                    "/api/pacientes", method="POST", token=self.token("assistant"),
                    json_data=assistant_payload, measure=True)
                self.assertEqual(assistant_created.status_code, 201)
                self.assertEqual(set(assistant_created.json["data"]), {"id"})
                self.assertEqual(sum(item.lstrip().lower().startswith("select") for item in assistant_sql), 5)
                self.assertFalse(any("antecedentes_clinicos" in item.lower() or "alergias" in item.lower()
                                     for item in assistant_sql if item.lstrip().lower().startswith("select")))
        duplicate, sql = self.call("/api/pacientes", method="POST", token=self.token(),
                                   json_data=payload, measure=True)
        self.assertEqual(duplicate.status_code, 409)
        self.assertFalse(any("insert into pacientes" in item.lower().replace("`", "") for item in sql))
        incomplete = self.registration(nombres="")
        result, sql = self.call("/api/pacientes", method="POST", token=self.token(),
                                json_data=incomplete, measure=True)
        self.assertEqual(result.status_code, 400)
        self.assertFalse(any("insert into pacientes" in item.lower().replace("`", "") for item in sql))

    def test_b1_real_post_rolls_back_when_response_lookup_fails(self):
        payload = self.registration(antecedentes_clinicos="Sintético privado")
        with patch.object(PatientRepository, "obtener_paciente_por_id",
                          side_effect=RuntimeError("synthetic lookup failure")):
            with patch.object(self.app.logger, "error") as logged:
                response, _ = self.call("/api/pacientes", method="POST", token=self.token(),
                                        json_data=payload)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json, {"success": False,
                                         "message": "No se pudo procesar la solicitud."})
        logged.assert_called_once_with("Error al registrar paciente")
        self.assertIsNone(Paciente.query.filter_by(nro_documento=payload["nro_documento"]).first())

    def test_29a_real_report_reads_catalog_and_pdf(self):
        # Segundo paciente, autor diferente: lectura institucional compartida.
        colleague_visit = VisitaClinica(paciente_id=self.patient_ids[1],
                                       usuario_id=self.user_ids['colleague'], estado='ACTIVA')
        db.session.add(colleague_visit)
        db.session.flush()
        colleague_report = informe_entities.Informe(
            visita_id=colleague_visit.id, tipo_informe_id=2,
            usuario_id=self.user_ids['colleague'], estado='ACTIVO',
            datos_estructurados={'nota': 'Sintetica'}, conclusion='Sintetica')
        db.session.add(colleague_report)
        db.session.commit()
        colleague_visit_id, colleague_report_id = colleague_visit.id, colleague_report.id
        db.session.remove()

        def cleanup_colleague_report():
            db.session.remove()
            db.session.query(informe_entities.Informe).filter_by(id=colleague_report_id).delete()
            db.session.query(VisitaClinica).filter_by(id=colleague_visit_id).delete()
            db.session.commit()
            db.session.remove()

        self.addCleanup(cleanup_colleague_report)

        reads = (f'/api/informes/{self.report_ids[0]}',
                 f'/api/informes/{colleague_report_id}',
                 f'/api/informes/paciente/{self.patient_ids[0]}',
                 f'/api/informes/paciente/{self.patient_ids[1]}',
                 f'/api/informes/visita/{self.visit_ids[0]}',
                 f'/api/informes/visita/{colleague_visit_id}',
                 f'/api/informes/diagnostico/{colleague_visit_id}')
        token = self.token()
        for path in reads:
            result, _ = self.call(path, token=token)
            self.assertEqual(result.status_code, 200, (path, result.json))
            self.assertTrue(result.json['data'])
        detail, _ = self.call(reads[1], token=token)
        self.assertEqual(detail.json['data']['profesional']['id'], self.user_ids['colleague'])
        self.assertEqual(detail.json['data']['paciente']['id'], self.patient_ids[1])
        empty, _ = self.call(f'/api/informes/visita/{self.visit_ids[1]}', token=token)
        self.assertEqual(empty.json, {'success': True, 'data': []})
        for profile in ('dual', 'assistant_dual'):
            for path in reads:
                self.assertEqual(self.call(path, token=self.token(profile))[0].status_code, 200)
        catalog = '/api/tipos-informe'
        for profile in ('ophthalmologist', 'nurse', 'assistant'):
            result, _ = self.call(catalog, token=self.token(profile))
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.json['data']), 6)
            self.assertEqual(set(result.json['data'][0]),
                             {'id', 'nombre', 'descripcion', 'codigo_formulario', 'schema_version_actual'})
        self.assertEqual(self.call(catalog, token=self.token('administrator'))[0].status_code, 403)
        for profile, role_code in (('nurse', 'ENFERMERO'),
                                   ('assistant', 'ASISTENTE_ADMINISTRATIVO')):
            with self.temporary_grant(role_code, 'informes.ver', present=False):
                self.assertEqual(self.call(catalog, token=self.token(profile))[0].status_code, 403)

        for path in (*reads, catalog):
            for bearer in (None, self.token(expired=True), 'invalid'):
                denied, sql = self.call(path, token=bearer, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
            denied, sql = self.call(f'{path}?token={token}', token=token, measure=True)
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(sql, [])
        for path in reads:
            for profile in ('administrator', 'nurse', 'assistant'):
                denied, sql = self.call(path, token=self.token(profile), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from informes' in q.lower().replace('`', '')
                                     for q in sql))
            with self.temporary_grant('OFTALMOLOGO', 'informes.ver', present=False):
                denied, sql = self.call(path, token=token, measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from informes' in q.lower().replace('`', '')
                                     for q in sql))
                self.assertEqual(self.call(catalog, token=self.token('nurse'))[0].status_code, 200)
                for profile in ('dual', 'assistant_dual'):
                    self.assertEqual(self.call(path, token=self.token(profile))[0].status_code, 403)
        with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
            self.assertEqual(self.call(reads[0], token=token)[0].status_code, 401)
        with self.temporary_state(Rol, Rol.query.filter_by(codigo='OFTALMOLOGO').one().id, 'INACTIVO'):
            self.assertEqual(self.call(reads[0], token=token)[0].status_code, 403)

        pdf_path = f'/api/visitas/{self.visit_ids[0]}/reporte-diagnostico'
        missing_pdf = f'/api/visitas/{self.visit_ids[1]}/reporte-diagnostico'
        spec = importlib.util.spec_from_file_location(
            'b1_real_pdf_generator', Path(__file__).resolve().parent / 'services' / 'report_service.py')
        real_pdf = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(real_pdf)
        with (patch.object(diagnosis_routes, 'generar_reporte_diagnostico_pdf',
                           real_pdf.generar_reporte_diagnostico_pdf),
              patch.object(diagnosis_routes, 'ReportNotFoundError', real_pdf.ReportNotFoundError),
              patch.object(diagnosis_routes, 'ReportTemplateError', real_pdf.ReportTemplateError)):
            for profile in ('ophthalmologist', 'colleague', 'dual'):
                result, _ = self.call(pdf_path, token=self.token(profile))
                self.assertEqual(result.status_code, 200)
                self.assertTrue(result.data.startswith(b'%PDF-'))
                self.assertEqual(result.mimetype, 'application/pdf')
                self.assertIn('attachment;', result.headers['Content-Disposition'])
                self.assertEqual(result.headers['Cache-Control'], 'private, no-store')
                self.assertEqual(result.headers['Access-Control-Expose-Headers'], 'Content-Disposition')
                result.close()
            self.assertEqual(self.call(missing_pdf, token=token)[0].status_code, 404)
        with patch.object(diagnosis_routes, 'generar_reporte_diagnostico_pdf') as generator:
            for bearer in (None, 'invalid', self.token(expired=True)):
                denied, sql = self.call(pdf_path, token=bearer, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
            denied, sql = self.call(f'{pdf_path}?token={token}', token=token, measure=True)
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(sql, [])
            for profile in ('administrator', 'nurse', 'assistant'):
                denied, sql = self.call(pdf_path, token=self.token(profile), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from visitas_clinicas' in q.lower().replace('`', '') for q in sql))
            for permission in ('pacientes.ver', 'diagnostico_retinopatia.ver', 'imagenes.ver'):
                with self.temporary_grant('OFTALMOLOGO', permission, present=False):
                    denied, sql = self.call(pdf_path, token=token, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertFalse(any('from visitas_clinicas' in q.lower().replace('`', '') for q in sql))
            with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                self.assertEqual(self.call(pdf_path, token=token)[0].status_code, 401)
            generator.assert_not_called()

    def test_29a_disabled_report_writes_leave_every_column_unchanged(self):
        report_id = self.report_ids[0]
        db.session.remove()
        original = db.session.get(informe_entities.Informe, report_id)
        before = {column.name: getattr(original, column.name)
                  for column in informe_entities.Informe.__table__.columns}
        db.session.remove()
        for method in ('PUT', 'DELETE'):
            for identifier in (report_id, 999999999):
                path = f'/api/informes/{identifier}'
                denied, sql = self.call(path, method=method, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
                for profile in ('ophthalmologist', 'administrator', 'nurse', 'assistant',
                                'dual', 'assistant_dual'):
                    denied, sql = self.call(path, method=method, token=self.token(profile),
                                            json_data={'datos_estructurados': {'nota': 'insegura'}}, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(denied.json, {'success': False, 'message': 'No autorizado.'})
                    self.assertFalse(any('informes' in q.lower() for q in sql))
                    self.assertFalse(any(q.lstrip().lower().startswith(('update ', 'delete ', 'insert '))
                                         for q in sql))
        db.session.remove()
        after = db.session.get(informe_entities.Informe, report_id)
        self.assertEqual({column.name: getattr(after, column.name)
                          for column in informe_entities.Informe.__table__.columns}, before)

    def test_29c2_orm_version_snapshot_and_restricted_parent(self):
        report_id = self.report_ids[0]
        db.session.remove()
        report = db.session.get(informe_entities.Informe, report_id)
        self.assertEqual(report.revision_actual, 1)
        self.assertEqual(report.schema_version, 1)
        self.assertEqual(report.versiones, [])  # 29C.3 aún no registra la inicial.
        self.assertEqual(str(informe_entities.InformeVersion.__table__.c.informe_id.type
                             .compile(dialect=db.engine.dialect)).upper(), 'BIGINT UNSIGNED')
        try:
            for number, operation, reason in ((1, 'MIGRACION_INICIAL', None),
                                              (2, 'CORRECCION', 'Motivo sintético')):
                snapshot = informe_entities.InformeVersion(
                    informe_id=report_id, numero_version=number, operacion=operation,
                    schema_version=report.schema_version, datos_estructurados={'nota': 'sintetica'},
                    conclusion='Solo prueba', estado=report.estado,
                    autor_operacion_id=None if number == 1 else self.user_ids['ophthalmologist'],
                    motivo=reason)
                db.session.add(snapshot)
            db.session.commit()
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual([item.numero_version for item in report.versiones], [1, 2])
            self.assertEqual([item.operacion for item in report.versiones],
                             ['MIGRACION_INICIAL', 'CORRECCION'])
            self.assertEqual(report.versiones[1].informe.id, report_id)
            self.assertEqual(report.versiones[1].autor_operacion.id,
                             self.user_ids['ophthalmologist'])
            self.assertIsNotNone(report.versiones[0].fecha_operacion)
            self.assertEqual(report.versiones[0].datos_estructurados, {'nota': 'sintetica'})
            self.assertEqual(report.versiones[1].conclusion, 'Solo prueba')
            with self.assertRaises(IntegrityError):
                db.session.delete(report)
                db.session.flush()
            db.session.rollback()
            self.assertIsNotNone(db.session.get(informe_entities.Informe, report_id))
        finally:
            db.session.rollback()
            db.session.remove()
            db.session.query(informe_entities.InformeVersion).filter_by(informe_id=report_id).delete()
            db.session.commit()
            db.session.remove()

    @contextmanager
    def report_visit(self, *, patient_index=1, state='ACTIVA'):
        visit = VisitaClinica(paciente_id=self.patient_ids[patient_index],
                             usuario_id=self.user_ids['colleague'], estado=state)
        db.session.add(visit)
        db.session.commit()
        identifier = visit.id
        db.session.remove()
        try:
            yield identifier
        finally:
            db.session.remove()
            report_ids = [row.id for row in db.session.query(informe_entities.Informe.id)
                          .filter_by(visita_id=identifier).all()]
            if report_ids:
                db.session.query(informe_entities.InformeVersion).filter(
                    informe_entities.InformeVersion.informe_id.in_(report_ids)).delete(synchronize_session=False)
            db.session.query(informe_entities.Informe).filter_by(visita_id=identifier).delete()
            db.session.query(VisitaClinica).filter_by(id=identifier).delete()
            db.session.commit()
            db.session.remove()

    def report_payload(self, *, visit_id=None, type_id=2, patient_index=1):
        payload = {'paciente_id': self.patient_ids[patient_index], 'tipo_informe_id': type_id,
                   'datos_estructurados': {'nota': 'Resultado sintético',
                                            'conclusion': ['Conclusión sintética']}}
        if visit_id is not None:
            payload['visita_id'] = visit_id
        return payload

    def test_29b_real_post_authorization_provenance_and_shared_visit(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            payload = self.report_payload(visit_id=visit_id)
            for bearer in (None, 'invalid', self.token(expired=True)):
                denied, sql = self.call(path, method='POST', token=bearer,
                                        json_data=payload, measure=True)
                self.assertEqual(denied.status_code, 401)
                self.assertEqual(sql, [])
            denied, sql = self.call(path + '?token=' + self.token(), method='POST',
                                    token=self.token(), json_data=payload, measure=True)
            self.assertEqual(denied.status_code, 401)
            self.assertEqual(sql, [])
            for profile in ('administrator', 'nurse', 'assistant'):
                denied, sql = self.call(path, method='POST', token=self.token(profile),
                                        json_data=payload, measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from pacientes' in q.lower().replace('`', '') or
                                     'from visitas_clinicas' in q.lower().replace('`', '') or
                                     'from informes' in q.lower().replace('`', '') for q in sql))
            token = self.token()
            with self.temporary_grant('OFTALMOLOGO', 'informes.crear', present=False):
                denied, sql = self.call(path, method='POST', token=token,
                                        json_data=payload, measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                for profile in ('dual', 'assistant_dual'):
                    self.assertEqual(self.call(path, method='POST', token=self.token(profile),
                                               json_data=payload)[0].status_code, 403)
            with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                self.assertEqual(self.call(path, method='POST', token=token,
                                           json_data=payload)[0].status_code, 401)
            response, _ = self.call(path, method='POST', token=self.token('dual'), json_data=payload)
            self.assertEqual(response.status_code, 201, response.json)
            self.assertEqual(response.json['data']['visita_id'], visit_id)
            self.assertEqual(response.json['data']['diagnostico_id'], visit_id)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, response.json['data']['id'])
            self.assertEqual(report.usuario_id, self.user_ids['dual'])
            self.assertEqual(report.estado, 'ACTIVO')
            self.assertEqual(report.conclusion, 'Conclusión sintética')
            self.assertEqual(db.session.get(VisitaClinica, visit_id).usuario_id,
                             self.user_ids['colleague'])
            self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())

    def test_29b_real_post_existing_vs_new_visit_grant_and_rollback(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            with self.temporary_grant('OFTALMOLOGO', 'visitas.crear', present=False):
                existing = self.report_payload(visit_id=visit_id, type_id=3)
                response, _ = self.call(path, method='POST', token=self.token(), json_data=existing)
                self.assertEqual(response.status_code, 201, response.json)
                denied, sql = self.call(path, method='POST', token=self.token(),
                                        json_data=self.report_payload(type_id=4), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from pacientes' in q.lower().replace('`', '') or
                                     'from visitas_clinicas' in q.lower().replace('`', '') or
                                     'insert into ' in q.lower() for q in sql))
            # Dos tipos pueden coexistir en la misma visita sin diagnóstico IA.
            response, _ = self.call(path, method='POST', token=self.token('colleague'),
                                    json_data=self.report_payload(visit_id=visit_id, type_id=4))
            self.assertEqual(response.status_code, 201, response.json)

        payload = self.report_payload(type_id=2)
        before = VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                                               motivo_consulta='Registro de informe clinico').count()
        response, sql = self.call(path, method='POST', token=self.token(),
                                  json_data=payload, measure=True)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(sum('insert into visitas_clinicas' in q.lower().replace('`', '')
                             for q in sql), 1)
        self.assertEqual(sum(bool(re.search(r'\binsert into informes\s*\(', q.lower().replace('`', '')))
                             for q in sql), 1)
        self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                             for q in sql), 1)
        new_visit, new_report = response.json['data']['visita_id'], response.json['data']['id']
        db.session.remove()
        self.assertEqual(VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                              motivo_consulta='Registro de informe clinico').count(), before + 1)
        self.assertEqual(db.session.get(VisitaClinica, new_visit).usuario_id,
                         self.user_ids['ophthalmologist'])
        self.assertEqual(db.session.get(informe_entities.Informe, new_report).visita_id, new_visit)
        db.session.remove()
        db.session.query(informe_entities.InformeVersion).filter_by(informe_id=new_report).delete()
        db.session.query(informe_entities.Informe).filter_by(id=new_report).delete()
        db.session.query(VisitaClinica).filter_by(id=new_visit).delete()
        db.session.commit()
        db.session.remove()

        # El flush de visita no es commit: falla el informe y desaparece la visita.
        with patch.object(InformeRepository, 'crear_informe', side_effect=RuntimeError('synthetic')):
            failed, _ = self.call(path, method='POST', token=self.token(), json_data=payload)
        self.assertEqual(failed.status_code, 500)
        db.session.remove()
        self.assertEqual(VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                              motivo_consulta='Registro de informe clinico').count(), before)
        self.assertEqual(informe_entities.InformeVersion.query.count(), 0)
        with patch.object(db.session, 'commit', side_effect=RuntimeError('synthetic before commit')):
            failed, _ = self.call(path, method='POST', token=self.token(), json_data=payload)
        self.assertEqual(failed.status_code, 500)
        db.session.remove()
        self.assertEqual(VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                              motivo_consulta='Registro de informe clinico').count(), before)

    def test_29b_real_post_validation_alias_and_no_mutation_on_errors(self):
        path = '/api/informes'
        with self.report_visit() as visit_id, self.report_visit(state='ANULADA') as annulled:
            valid = self.report_payload(visit_id=visit_id)
            bad = (
                ({**valid, 'paciente_id': self.patient_ids[0]}, 404),
                ({**valid, 'paciente_id': 999999999}, 404),
                ({**valid, 'visita_id': 999999999}, 404),
                ({**valid, 'visita_id': annulled}, 404),
                ({**valid, 'tipo_informe_id': 9999}, 404),
                ({**valid, 'visita_id': False}, 400),
                ({**valid, 'visita_id': 0}, 400),
                ({**valid, 'visita_id': -1}, 400),
                ({**valid, 'visita_id': 'malformado'}, 400),
                ({**valid, 'paciente_id': True}, 400),
                ({**valid, 'tipo_informe_id': '2'}, 400),
                ({**valid, 'diagnostico_id': visit_id + 1}, 400),
                ({**valid, 'usuario_id': self.user_ids['administrator']}, 400),
                ({**valid, 'estado': 'INACTIVO'}, 400),
                ({**valid, 'datos_estructurados': []}, 422),
                ({**valid, 'datos_estructurados': {}}, 422),
                ({**valid, 'datos_estructurados': {'usuario_id': 1}}, 422),
                ({**valid, 'datos_estructurados': {'nota': {'estado': 'ANULADO'}}}, 422),
                ({**valid, 'datos_estructurados': {'conclusion': [{'a': 1}]}}, 422),
                ({**valid, 'datos_estructurados': {'ojos': 'OD'}}, 422),
                ({**valid, 'datos_estructurados': {'nota': 'x' * 9000}}, 422),
                ({**valid, 'datos_estructurados': {'a': {'b': {'c': {'d': {'e': {
                    'f': {'g': {'h': {'i': 1}}}}}}}}}}, 422),
            )
            for data, expected in bad:
                with self.subTest(data=data):
                    result, sql = self.call(path, method='POST', token=self.token(),
                                            json_data=data, measure=True)
                    self.assertEqual(result.status_code, expected, result.json)
                    self.assertFalse(any(q.lstrip().lower().startswith(('insert ', 'update '))
                                         for q in sql))
            with self.temporary_state(Paciente, self.patient_ids[1], 'INACTIVO'):
                self.assertEqual(self.call(path, method='POST', token=self.token(),
                                           json_data=valid)[0].status_code, 404)
            with self.temporary_state(informe_entities.TipoInforme, 2, 'INACTIVO'):
                self.assertEqual(self.call(path, method='POST', token=self.token(),
                                           json_data=valid)[0].status_code, 404)
            db.session.remove()
            self.assertEqual(informe_entities.Informe.query.filter_by(visita_id=visit_id).count(), 0)
            alias = self.report_payload(type_id=2)
            alias['diagnostico_id'] = visit_id
            result, _ = self.call(path, method='POST', token=self.token(), json_data=alias)
            self.assertEqual(result.status_code, 201, result.json)
            self.assertEqual(result.json['data']['visita_id'], visit_id)
            both = {**self.report_payload(visit_id=visit_id, type_id=3), 'diagnostico_id': visit_id}
            self.assertEqual(self.call(path, method='POST', token=self.token(),
                                       json_data=both)[0].status_code, 201)
            # Una visita cerrada no estaba prohibida por el flujo anterior.
        with self.report_visit(state='CERRADA') as closed:
            self.assertEqual(self.call(path, method='POST', token=self.token(),
                                       json_data=self.report_payload(visit_id=closed))[0].status_code, 201)
        with self.report_visit() as independent:
            for type_id in (1, 5, 6):
                response, _ = self.call(path, method='POST', token=self.token(),
                                        json_data=self.report_payload(visit_id=independent,
                                                                      type_id=type_id))
                self.assertEqual(response.status_code, 201, response.json)

    def test_29b_real_post_duplicate_inactive_and_unexpected_integrity(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            payload = self.report_payload(visit_id=visit_id)
            first, _ = self.call(path, method='POST', token=self.token(), json_data=payload)
            self.assertEqual(first.status_code, 201)
            identifier = first.json['data']['id']
            db.session.remove()
            report = db.session.get(informe_entities.Informe, identifier)
            original = {column.name: getattr(report, column.name)
                        for column in informe_entities.Informe.__table__.columns}
            duplicate, _ = self.call(path, method='POST', token=self.token('colleague'),
                                     json_data={**payload, 'datos_estructurados': {'nota': 'OTRA'}})
            self.assertEqual(duplicate.status_code, 409)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, identifier)
            self.assertEqual({column.name: getattr(report, column.name)
                              for column in informe_entities.Informe.__table__.columns}, original)
            self.assertEqual(len(report.versiones), 1)
            report.estado = 'INACTIVO'
            db.session.commit()  # Fixture sintética; DELETE HTTP continúa bloqueado.
            db.session.remove()
            self.assertEqual(self.call(path, method='POST', token=self.token(),
                                       json_data=payload)[0].status_code, 409)
            self.assertEqual(informe_entities.Informe.query.filter_by(visita_id=visit_id).count(), 1)
            self.assertEqual(db.session.get(informe_entities.Informe, identifier).estado, 'INACTIVO')
        with self.report_visit() as visit_id:
            with patch.object(InformeRepository, 'crear_informe', side_effect=IntegrityError(
                    'INSERT', {}, MySQLIntegrityError(1452, 'synthetic FK error'))):
                response, _ = self.call(path, method='POST', token=self.token(),
                                        json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(response.status_code, 500)
            self.assertNotIn('synthetic', response.get_data(as_text=True))

    def test_29b_real_post_commit_uncertain_no_retry(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            payload = self.report_payload(visit_id=visit_id)
            actual_commit = db.session.commit
            calls = []

            def acknowledged_late():
                calls.append(1)
                actual_commit()
                raise OperationalError('COMMIT', {}, RuntimeError('synthetic lost ACK'),
                                       connection_invalidated=True)

            with patch.object(db.session, 'commit', side_effect=acknowledged_late):
                result, _ = self.call(path, method='POST', token=self.token(), json_data=payload)
            self.assertEqual(result.status_code, 500)
            self.assertEqual(len(calls), 1)
            self.assertNotIn('synthetic', result.get_data(as_text=True))
            db.session.remove()
            reports = informe_entities.Informe.query.filter_by(visita_id=visit_id).all()
            self.assertEqual(len(reports), 1)
            self.assertEqual(len(reports[0].versiones), 1)
            self.assertEqual(reports[0].versiones[0].datos_estructurados,
                             reports[0].datos_estructurados)

    def test_29b_real_post_concurrent_duplicate_unique_wins(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            barrier = Barrier(2, timeout=15)
            connections = set()

            def synchronize(conn, cursor, statement, parameters, context, executemany):
                sql = statement.lower().replace('`', '')
                if ('from informes ' in sql and 'where informes.visita_id' in sql and
                        'informes.tipo_informe_id' in sql and 'select ' in sql):
                    connections.add(conn.connection.driver_connection.thread_id())
                    barrier.wait()

            def submit(profile):
                with self.app.app_context():
                    try:
                        payload = self.report_payload(visit_id=visit_id)
                        payload['datos_estructurados']['nota'] = profile
                        with self.app.test_client() as client:
                            result = client.post(path, json=payload,
                                                 headers={'Authorization': 'Bearer ' + self.token(profile)})
                            return profile, result.status_code
                    finally:
                        db.session.remove()

            db.session.remove()
            event.listen(db.engine, 'before_cursor_execute', synchronize)
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(submit, 'ophthalmologist')
                    second = pool.submit(submit, 'colleague')
                    results = [first.result(timeout=25), second.result(timeout=25)]
            finally:
                event.remove(db.engine, 'before_cursor_execute', synchronize)
            self.assertEqual(len(connections), 2)
            self.assertEqual(sorted(code for _, code in results), [201, 409])
            winner = next(profile for profile, code in results if code == 201)
            db.session.remove()
            reports = informe_entities.Informe.query.filter_by(visita_id=visit_id).all()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0].usuario_id, self.user_ids[winner])
            self.assertEqual(reports[0].datos_estructurados['nota'], winner)
            self.assertEqual(len(reports[0].versiones), 1)
            self.assertEqual(reports[0].versiones[0].datos_estructurados['nota'], winner)

    def test_29c3_post_initial_snapshot_and_atomic_failures(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            response, sql = self.call(path, method='POST', token=self.token(),
                                      json_data=self.report_payload(visit_id=visit_id), measure=True)
            self.assertEqual(response.status_code, 201, response.json)
            self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                                 for q in sql), 1)
            report_id = response.json['data']['id']
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual(report.revision_actual, 1)
            self.assertEqual(len(report.versiones), 1)
            initial = report.versiones[0]
            self.assertEqual((initial.numero_version, initial.operacion, initial.autor_operacion_id),
                             (1, 'CREACION', self.user_ids['ophthalmologist']))
            self.assertEqual((initial.datos_estructurados, initial.conclusion, initial.estado,
                              initial.schema_version),
                             (report.datos_estructurados, report.conclusion, report.estado,
                              report.schema_version))
            self.assertIsNotNone(initial.fecha_operacion)
            detail, _ = self.call(f'{path}/{report_id}', token=self.token('colleague'))
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json['data']['revision_actual'], 1)
            self.assertEqual(detail.json['data']['schema_version'], report.schema_version)

        payload = self.report_payload()
        for failure in (RuntimeError('synthetic version failure'),
                        IntegrityError('INSERT', {}, MySQLIntegrityError(1452, 'synthetic FK error'))):
            db.session.remove()
            before = VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                          motivo_consulta='Registro de informe clinico').count()
            with patch.object(InformeRepository, 'crear_version_inicial', side_effect=failure):
                result, sql = self.call(path, method='POST', token=self.token(),
                                        json_data=payload, measure=True)
            self.assertEqual(result.status_code, 500)
            self.assertNotIn('synthetic', result.get_data(as_text=True))
            self.assertTrue(any('insert into informes' in q.lower().replace('`', '') for q in sql))
            db.session.remove()
            self.assertEqual(VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                              motivo_consulta='Registro de informe clinico').count(), before)
            self.assertEqual(informe_entities.InformeVersion.query.count(), 0)

        before = VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                                               motivo_consulta='Registro de informe clinico').count()
        result, sql = self.call(path, method='POST', token=self.token(),
                                json_data=payload, measure=True)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(sum('insert into visitas_clinicas' in q.lower().replace('`', '')
                             for q in sql), 1)
        self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                             for q in sql), 1)
        visit_id, report_id = result.json['data']['visita_id'], result.json['data']['id']
        db.session.remove()
        self.assertEqual(db.session.get(informe_entities.Informe, report_id).versiones[0].operacion,
                         'CREACION')
        self.assertEqual(VisitaClinica.query.filter_by(paciente_id=self.patient_ids[1],
                         motivo_consulta='Registro de informe clinico').count(), before + 1)
        db.session.remove()
        db.session.query(informe_entities.InformeVersion).filter_by(informe_id=report_id).delete()
        db.session.query(informe_entities.Informe).filter_by(id=report_id).delete()
        db.session.query(VisitaClinica).filter_by(id=visit_id).delete()
        db.session.commit()
        db.session.remove()

    def test_29c3_edit_opt_in_ownership_and_payload(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            created, _ = self.call(path, method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            target = f'{path}/{report_id}'
            payload = {'datos_estructurados': {'nota': 'Corrección sintética'},
                       'motivo': 'Aclaración posterior', 'revision_esperada': 1}
            denied, sql = self.call(target, method='PUT', token=self.token(),
                                    json_data=payload, measure=True)
            self.assertEqual(denied.status_code, 403)
            self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True}):
                for bearer in (None, 'invalid', self.token(expired=True)):
                    denied, sql = self.call(target, method='PUT', token=bearer,
                                            json_data=payload, measure=True)
                    self.assertEqual(denied.status_code, 401)
                    self.assertEqual(sql, [])
                self.assertEqual(self.call(target + '?token=' + self.token(), method='PUT',
                                           token=self.token(), json_data=payload)[0].status_code, 401)
                for profile in ('administrator', 'nurse', 'assistant', 'colleague'):
                    denied, sql = self.call(target, method='PUT', token=self.token(profile),
                                            json_data=payload, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    if profile != 'colleague':
                        self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                with self.temporary_grant('OFTALMOLOGO', 'informes.editar', present=False):
                    for profile in ('ophthalmologist', 'dual', 'assistant_dual'):
                        denied, sql = self.call(target, method='PUT', token=self.token(profile),
                                                json_data=payload, measure=True)
                        self.assertEqual(denied.status_code, 403)
                        self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                    self.assertEqual(self.call(target, method='PUT', token=self.token(),
                                               json_data=payload)[0].status_code, 401)
                bad = (
                    ({'datos_estructurados': {'nota': 'x'}, 'motivo': 'x'}, 400),
                    ({**payload, 'revision_esperada': False}, 400),
                    ({**payload, 'revision_esperada': 0}, 400),
                    ({**payload, 'revision_esperada': '1'}, 400),
                    ({**payload, 'revision_esperada': -1}, 400),
                    ({**payload, 'motivo': ''}, 400),
                    ({**payload, 'motivo': '  \t '}, 400),
                    ({**payload, 'motivo': 'x' * 1001}, 400),
                    ({**payload, 'usuario_id': self.user_ids['colleague']}, 400),
                    ({**payload, 'autor_operacion_id': self.user_ids['colleague']}, 400),
                    ({**payload, 'schema_version': 99}, 400),
                    ({**payload, 'estado': 'ANULADO'}, 400),
                    ({**payload, 'revision_actual': 9}, 400),
                    ({**payload, 'datos_estructurados': {'estado': 'ANULADO'}}, 422),
                    ({**payload, 'datos_estructurados': []}, 422),
                )
                for body, expected in bad:
                    with self.subTest(body=body):
                        denied, sql = self.call(target, method='PUT', token=self.token(),
                                                json_data=body, measure=True)
                        self.assertEqual(denied.status_code, expected, denied.json)
                        self.assertFalse(any(q.lstrip().lower().startswith(('update ', 'insert '))
                                             for q in sql))
                self.assertEqual(self.call(f'{path}/999999999', method='PUT',
                                           token=self.token(), json_data=payload)[0].status_code, 404)
                self.assertEqual(self.call(target, method='DELETE', token=self.token(),
                                           json_data=payload)[0].status_code, 403)
            db.session.remove()
            self.assertEqual(db.session.get(informe_entities.Informe, report_id).revision_actual, 1)
            multi, _ = self.call(path, method='POST', token=self.token('dual'),
                                 json_data=self.report_payload(visit_id=visit_id, type_id=3))
            self.assertEqual(multi.status_code, 201)
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True}):
                edited, _ = self.call(f"{path}/{multi.json['data']['id']}", method='PUT',
                                      token=self.token('dual'), json_data=payload)
                self.assertEqual(edited.status_code, 200, edited.json)
            db.session.remove()
            self.assertEqual(db.session.get(informe_entities.Informe,
                                            multi.json['data']['id']).versiones[1].autor_operacion_id,
                             self.user_ids['dual'])

    def test_29c3_edit_revisions_closed_visit_and_stale_conflict(self):
        path = '/api/informes'
        for visit_state in ('ACTIVA', 'CERRADA'):
            with self.subTest(visit_state=visit_state), self.report_visit(state=visit_state) as visit_id:
                created, _ = self.call(path, method='POST', token=self.token(),
                                       json_data=self.report_payload(visit_id=visit_id))
                self.assertEqual(created.status_code, 201)
                report_id = created.json['data']['id']
                db.session.remove()
                original_visit = db.session.get(VisitaClinica, visit_id)
                visit_columns = {column.name: getattr(original_visit, column.name)
                                 for column in VisitaClinica.__table__.columns}
                db.session.remove()
                target = f'{path}/{report_id}'
                with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True}):
                    for revision in (1, 2):
                        payload = {'datos_estructurados': {'nota': f'Corrección {revision}',
                                                          'conclusion': [f'Conclusión {revision}']},
                                   'motivo': f'Corrección documentada {revision}',
                                   'revision_esperada': revision}
                        response, sql = self.call(target, method='PUT', token=self.token(),
                                                  json_data=payload, measure=True)
                        self.assertEqual(response.status_code, 200, response.json)
                        self.assertEqual(response.json['data']['revision_actual'], revision + 1)
                        self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                                             for q in sql), 1)
                        stale, _ = self.call(target, method='PUT', token=self.token(),
                                             json_data=payload)
                        self.assertEqual(stale.status_code, 409)
                    detail, _ = self.call(target, token=self.token('colleague'))
                    self.assertEqual(detail.json['data']['revision_actual'], 3)
                    self.assertEqual(detail.json['data']['schema_version'], 1)
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual(report.usuario_id, self.user_ids['ophthalmologist'])
                self.assertEqual(report.estado, 'ACTIVO')
                self.assertEqual(report.revision_actual, 3)
                self.assertEqual([v.numero_version for v in report.versiones], [1, 2, 3])
                self.assertEqual([v.operacion for v in report.versiones],
                                 ['CREACION', 'CORRECCION', 'CORRECCION'])
                self.assertEqual(report.versiones[0].datos_estructurados,
                                 self.report_payload(visit_id=visit_id)['datos_estructurados'])
                self.assertEqual(report.versiones[1].datos_estructurados['nota'], 'Corrección 1')
                self.assertEqual(report.versiones[2].datos_estructurados, report.datos_estructurados)
                self.assertEqual(report.versiones[2].conclusion, report.conclusion)
                self.assertEqual(report.versiones[2].schema_version, report.schema_version)
                self.assertEqual(report.versiones[2].estado, report.estado)
                self.assertEqual({v.autor_operacion_id for v in report.versiones},
                                 {self.user_ids['ophthalmologist']})
                self.assertEqual([v.motivo for v in report.versiones],
                                 [None, 'Corrección documentada 1', 'Corrección documentada 2'])
                visit = db.session.get(VisitaClinica, visit_id)
                self.assertEqual({column.name: getattr(visit, column.name)
                                  for column in VisitaClinica.__table__.columns}, visit_columns)
                self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())

    def test_29c3_edit_inconsistent_history_states_and_rollbacks(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            created, _ = self.call(path, method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            target = f'{path}/{report_id}'
            payload = {'datos_estructurados': {'nota': 'Nuevo resultado sintético'},
                       'revision_esperada': 1, 'motivo': 'Corrección explicada'}
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True}):
                with self.temporary_state(VisitaClinica, visit_id, 'ANULADA'):
                    self.assertEqual(self.call(target, method='PUT', token=self.token(),
                                               json_data=payload)[0].status_code, 409)
                for estado in ('INACTIVO', 'ANULADO'):
                    with self.temporary_state(informe_entities.Informe, report_id, estado):
                        self.assertEqual(self.call(target, method='PUT', token=self.token(),
                                                   json_data=payload)[0].status_code, 409)
                db.session.remove()
                initial = informe_entities.InformeVersion.query.filter_by(informe_id=report_id).one()
                initial_id = initial.id
                db.session.delete(initial)  # Solo fixture; nunca a través de HTTP.
                db.session.commit()
                db.session.remove()
                self.assertEqual(self.call(target, method='PUT', token=self.token(),
                                           json_data=payload)[0].status_code, 409)
                db.session.add(informe_entities.InformeVersion(
                    id=initial_id, informe_id=report_id, numero_version=1, operacion='CREACION',
                    schema_version=1, datos_estructurados=self.report_payload()['datos_estructurados'],
                    conclusion='Conclusión sintética', estado='ACTIVO',
                    autor_operacion_id=self.user_ids['ophthalmologist']))
                db.session.commit()
                db.session.remove()

                with patch.object(InformeRepository, 'corregir_informe',
                                  side_effect=RuntimeError('synthetic before flush')):
                    response, _ = self.call(target, method='PUT', token=self.token(), json_data=payload)
                self.assertEqual(response.status_code, 500)
                with patch.object(db.session, 'commit', side_effect=RuntimeError('synthetic before commit')):
                    response, _ = self.call(target, method='PUT', token=self.token(), json_data=payload)
                self.assertEqual(response.status_code, 500)
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual((report.revision_actual, len(report.versiones),
                                  report.datos_estructurados['nota']),
                                 (1, 1, 'Resultado sintético'))

                actual_commit = db.session.commit
                attempts = []

                def acknowledged_late():
                    attempts.append(1)
                    actual_commit()
                    raise OperationalError('COMMIT', {}, RuntimeError('synthetic lost ACK'),
                                           connection_invalidated=True)

                with patch.object(db.session, 'commit', side_effect=acknowledged_late):
                    response, _ = self.call(target, method='PUT', token=self.token(), json_data=payload)
                self.assertEqual(response.status_code, 500)
                self.assertNotIn('synthetic', response.get_data(as_text=True))
                self.assertEqual(attempts, [1])
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual((report.revision_actual, len(report.versiones)), (2, 2))
                self.assertEqual(report.versiones[1].datos_estructurados, report.datos_estructurados)
                self.assertEqual(self.call(target, method='PUT', token=self.token(),
                                           json_data=payload)[0].status_code, 409)

    def test_29c3_two_puts_compete_on_independent_connections(self):
        path = '/api/informes'
        with self.report_visit() as visit_id:
            created, _ = self.call(path, method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            barrier = Barrier(2, timeout=15)
            connections = set()

            def synchronize(conn, cursor, statement, parameters, context, executemany):
                sql = statement.lower().replace('`', '')
                if 'from informes ' in sql and 'for update' in sql:
                    connections.add(conn.connection.driver_connection.thread_id())
                    barrier.wait()

            def submit(note):
                with self.app.app_context():
                    try:
                        with self.app.test_client() as client:
                            response = client.put(f'{path}/{report_id}', json={
                                'datos_estructurados': {'nota': note},
                                'motivo': 'Competencia sintética', 'revision_esperada': 1,
                            }, headers={'Authorization': 'Bearer ' + self.token()})
                            return note, response.status_code
                    finally:
                        db.session.remove()

            db.session.remove()
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True}):
                event.listen(db.engine, 'before_cursor_execute', synchronize)
                try:
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        first = pool.submit(submit, 'primero')
                        second = pool.submit(submit, 'segundo')
                        results = [first.result(timeout=25), second.result(timeout=25)]
                finally:
                    event.remove(db.engine, 'before_cursor_execute', synchronize)
            self.assertEqual(len(connections), 2)
            self.assertEqual(sorted(code for _, code in results), [200, 409])
            winner = next(note for note, code in results if code == 200)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual(report.revision_actual, 2)
            self.assertEqual(len(report.versiones), 2)
            self.assertEqual(report.versiones[0].datos_estructurados['nota'], 'Resultado sintético')
            self.assertEqual(report.versiones[1].datos_estructurados['nota'], winner)
            self.assertEqual(report.datos_estructurados['nota'], winner)

    def test_29c4_annul_lifecycle_and_closed_visit(self):
        for state in ('ACTIVA', 'CERRADA'):
            with self.subTest(state=state), self.report_visit(state=state) as visit_id:
                created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                       json_data=self.report_payload(visit_id=visit_id))
                self.assertEqual(created.status_code, 201)
                report_id = created.json['data']['id']
                target = f'/api/informes/{report_id}'
                annul = target + '/anulacion'
                body = {'motivo': '  Error documental confirmado  ', 'revision_esperada': 2}
                db.session.remove()
                visit = db.session.get(VisitaClinica, visit_id)
                before = {column.name: getattr(visit, column.name)
                          for column in VisitaClinica.__table__.columns}
                db.session.remove()
                with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                                  'REPORTS_ANNUL_ENABLED': True}):
                    corrected, _ = self.call(target, method='PUT', token=self.token(), json_data={
                        'datos_estructurados': {'nota': 'Aclaración sintética'},
                        'motivo': 'Corrección sintética', 'revision_esperada': 1,
                    })
                    self.assertEqual(corrected.status_code, 200, corrected.json)
                    result, sql = self.call(annul, method='POST', token=self.token(),
                                            json_data=body, measure=True)
                    self.assertEqual(result.status_code, 200, result.json)
                    self.assertEqual(result.json['data'], {'id': report_id, 'estado': 'ANULADO',
                                                            'revision_actual': 3})
                    self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                                         for q in sql), 1)
                    self.assertEqual(self.call(annul, method='POST', token=self.token(),
                                               json_data=body)[0].status_code, 409)
                    self.assertEqual(self.call(target, method='PUT', token=self.token(), json_data={
                        'datos_estructurados': {'nota': 'No admitido'}, 'motivo': 'x',
                        'revision_esperada': 3})[0].status_code, 409)
                    self.assertEqual(self.call(target, method='DELETE', token=self.token())[0].status_code, 403)
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual((report.usuario_id, report.estado, report.revision_actual),
                                 (self.user_ids['ophthalmologist'], 'ANULADO', 3))
                versions = report.versiones
                self.assertEqual([(v.numero_version, v.operacion, v.estado) for v in versions],
                                 [(1, 'CREACION', 'ACTIVO'), (2, 'CORRECCION', 'ACTIVO'),
                                  (3, 'ANULACION', 'ANULADO')])
                self.assertEqual(versions[0].datos_estructurados,
                                 self.report_payload(visit_id=visit_id)['datos_estructurados'])
                self.assertEqual(versions[1].datos_estructurados, {'nota': 'Aclaración sintética'})
                self.assertEqual(versions[1].motivo, 'Corrección sintética')
                self.assertEqual((versions[2].datos_estructurados, versions[2].conclusion,
                                  versions[2].schema_version),
                                 (report.datos_estructurados, report.conclusion, report.schema_version))
                self.assertEqual(versions[2].motivo, 'Error documental confirmado')
                self.assertEqual(versions[2].autor_operacion_id, self.user_ids['ophthalmologist'])
                self.assertIsNotNone(versions[2].fecha_operacion)
                self.assertEqual({column.name: getattr(db.session.get(VisitaClinica, visit_id),
                                                       column.name)
                                  for column in VisitaClinica.__table__.columns}, before)
                for path in (target, f'/api/informes/visita/{visit_id}',
                             f'/api/informes/paciente/{self.patient_ids[1]}'):
                    response, _ = self.call(path, token=self.token())
                    self.assertEqual(response.status_code, 404 if path == target else 200)
                    if path != target:
                        self.assertNotIn(report_id, [r['id'] for r in response.json['data']])

    def test_29c4_annul_authorization_states_and_validation(self):
        with self.report_visit() as visit_id:
            created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            target = f'/api/informes/{report_id}/anulacion'
            body = {'motivo': 'Motivo sintético', 'revision_esperada': 1}
            denied, sql = self.call(target, method='POST', token=self.token(), json_data=body,
                                    measure=True)
            self.assertEqual(denied.status_code, 403)
            self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
            with patch.dict(self.app.config, {'REPORTS_ANNUL_ENABLED': 1}):
                self.assertEqual(self.call(target, method='POST', token=self.token(),
                                           json_data=body)[0].status_code, 403)
            with patch.dict(self.app.config, {'REPORTS_ANNUL_ENABLED': True}):
                for bearer in (None, 'invalid', self.token(expired=True)):
                    denied, sql = self.call(target, method='POST', token=bearer,
                                            json_data=body, measure=True)
                    self.assertEqual(denied.status_code, 401)
                    self.assertEqual(sql, [])
                self.assertEqual(self.call(target + '?token=' + self.token(), method='POST',
                                           token=self.token(), json_data=body)[0].status_code, 401)
                for profile in ('administrator', 'nurse', 'assistant', 'colleague'):
                    denied, sql = self.call(target, method='POST', token=self.token(profile),
                                            json_data=body, measure=True)
                    self.assertEqual(denied.status_code, 403)
                    if profile != 'colleague':
                        self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                with self.temporary_grant('OFTALMOLOGO', 'informes.anular', present=False):
                    for profile in ('ophthalmologist', 'dual', 'assistant_dual'):
                        denied, sql = self.call(target, method='POST', token=self.token(profile),
                                                json_data=body, measure=True)
                        self.assertEqual(denied.status_code, 403)
                        self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                    with self.temporary_grant('ADMINISTRADOR_SISTEMA', 'informes.anular', present=True):
                        self.assertEqual(self.call(target, method='POST', token=self.token('dual'),
                                                   json_data=body)[0].status_code, 403)
                role_id = Rol.query.filter_by(codigo='OFTALMOLOGO').one().id
                with self.temporary_state(Rol, role_id, 'INACTIVO'):
                    self.assertEqual(self.call(target, method='POST', token=self.token(),
                                               json_data=body)[0].status_code, 403)
                permission_id = Permiso.query.filter_by(codigo='informes.anular').one().id
                with self.temporary_state(Permiso, permission_id, 'INACTIVO'):
                    self.assertEqual(self.call(target, method='POST', token=self.token(),
                                               json_data=body)[0].status_code, 403)
                with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                    self.assertEqual(self.call(target, method='POST', token=self.token(),
                                               json_data=body)[0].status_code, 401)
                with self.temporary_state(VisitaClinica, visit_id, 'ANULADA'):
                    self.assertEqual(self.call(target, method='POST', token=self.token(),
                                               json_data=body)[0].status_code, 409)
                for state in ('INACTIVO', 'ANULADO'):
                    with self.temporary_state(informe_entities.Informe, report_id, state):
                        self.assertEqual(self.call(target, method='POST', token=self.token(),
                                                   json_data=body)[0].status_code, 409)
                invalid = (
                    ({'motivo': 'x'}, 400), ({'revision_esperada': 1}, 400),
                    ({**body, 'motivo': ''}, 400), ({**body, 'motivo': ' \t '}, 400),
                    ({**body, 'motivo': 'x' * 1001}, 400), ({**body, 'motivo': 2}, 400),
                    ({**body, 'revision_esperada': False}, 400),
                    ({**body, 'revision_esperada': '1'}, 400),
                    ({**body, 'revision_esperada': 0}, 400),
                    ({**body, 'revision_esperada': -1}, 400),
                    ({**body, 'revision_esperada': 2}, 409),
                ) + tuple(({**body, field: 'falsificado'}, 400) for field in (
                    'usuario_id', 'autor_operacion_id', 'estado', 'numero_version',
                    'revision_actual', 'fecha_operacion', 'datos_estructurados',
                    'conclusion', 'visita_id', 'paciente_id'))
                for payload, expected in invalid:
                    with self.subTest(payload=payload):
                        denied, _ = self.call(target, method='POST', token=self.token(),
                                              json_data=payload)
                        self.assertEqual(denied.status_code, expected, denied.json)
                self.assertEqual(self.call('/api/informes/99999999/anulacion', method='POST',
                                           token=self.token(), json_data=body)[0].status_code, 404)
                db.session.remove()
                initial = informe_entities.InformeVersion.query.filter_by(informe_id=report_id).one()
                initial.operacion = 'CORRECCION'
                initial.motivo = 'alteración sintética del historial'
                db.session.commit()
                self.assertEqual(self.call(target, method='POST', token=self.token(),
                                           json_data=body)[0].status_code, 409)
                db.session.remove()
                initial = informe_entities.InformeVersion.query.filter_by(informe_id=report_id).one()
                initial.operacion = 'CREACION'
                initial.motivo = None
                db.session.commit()
                db.session.delete(initial)  # Fixture sintético aislado; no es ruta HTTP.
                db.session.commit()
                self.assertEqual(self.call(target, method='POST', token=self.token(),
                                           json_data=body)[0].status_code, 409)
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual((report.estado, report.revision_actual, len(report.versiones)),
                                 ('ACTIVO', 1, 0))
                # No reparar implicitamente; fixture se elimina al salir de report_visit.
            dual, _ = self.call('/api/informes', method='POST', token=self.token('dual'),
                                json_data=self.report_payload(visit_id=visit_id, type_id=3))
            self.assertEqual(dual.status_code, 201, dual.json)
            with patch.dict(self.app.config, {'REPORTS_ANNUL_ENABLED': True}):
                response, _ = self.call(f"/api/informes/{dual.json['data']['id']}/anulacion",
                                        method='POST', token=self.token('dual'), json_data=body)
                self.assertEqual(response.status_code, 200, response.json)
            db.session.remove()
            self.assertEqual(db.session.get(informe_entities.Informe,
                                            dual.json['data']['id']).versiones[1].autor_operacion_id,
                             self.user_ids['dual'])

    def test_29c4_annul_rollback_and_lost_commit_ack(self):
        with self.report_visit() as visit_id:
            created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            target = f'/api/informes/{report_id}/anulacion'
            body = {'motivo': 'Anulación sintética', 'revision_esperada': 1}
            real_write = InformeRepository.anular_informe

            def after_flush(*args):
                real_write(*args)
                raise RuntimeError('synthetic after flush')

            with patch.dict(self.app.config, {'REPORTS_ANNUL_ENABLED': True}):
                for failure in (RuntimeError('synthetic before flush'), after_flush):
                    with patch.object(InformeRepository, 'anular_informe', side_effect=failure):
                        result, _ = self.call(target, method='POST', token=self.token(),
                                              json_data=body)
                    self.assertEqual(result.status_code, 500)
                    self.assertNotIn('synthetic', result.get_data(as_text=True))
                    db.session.remove()
                    report = db.session.get(informe_entities.Informe, report_id)
                    self.assertEqual((report.estado, report.revision_actual, len(report.versiones)),
                                     ('ACTIVO', 1, 1))
                actual_commit = db.session.commit
                calls = []

                def acknowledged_late():
                    calls.append(1)
                    actual_commit()
                    raise OperationalError('COMMIT', {}, RuntimeError('synthetic lost ACK'),
                                           connection_invalidated=True)

                with patch.object(db.session, 'commit', side_effect=acknowledged_late):
                    result, _ = self.call(target, method='POST', token=self.token(),
                                          json_data=body)
                self.assertEqual(result.status_code, 500)
                self.assertEqual(calls, [1])
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual((report.estado, report.revision_actual, len(report.versiones)),
                                 ('ANULADO', 2, 2))
                self.assertEqual(report.versiones[1].operacion, 'ANULACION')
                self.assertEqual(self.call(target, method='POST', token=self.token(),
                                           json_data=body)[0].status_code, 409)

    def test_29c4_concurrent_annul_and_competing_edit(self):
        for competitor in ('anulacion', 'edicion'):
            with self.subTest(competitor=competitor), self.report_visit() as visit_id:
                created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                       json_data=self.report_payload(visit_id=visit_id))
                self.assertEqual(created.status_code, 201)
                report_id = created.json['data']['id']
                barrier = Barrier(2, timeout=15)
                connections = set()

                def synchronize(conn, cursor, statement, parameters, context, executemany):
                    sql = statement.lower().replace('`', '')
                    if 'from informes ' in sql and 'for update' in sql:
                        connections.add(conn.connection.driver_connection.thread_id())
                        barrier.wait()

                def submit(kind):
                    with self.app.app_context():
                        try:
                            with self.app.test_client() as client:
                                target = f'/api/informes/{report_id}'
                                body = {'motivo': 'Competencia sintética', 'revision_esperada': 1}
                                if kind == 'anulacion':
                                    target += '/anulacion'
                                    method = 'POST'
                                else:
                                    method = 'PUT'
                                    body['datos_estructurados'] = {'nota': 'Corrección competidora'}
                                response = client.open(target, method=method, json=body,
                                    headers={'Authorization': 'Bearer ' + self.token()})
                                return kind, response.status_code
                        finally:
                            db.session.remove()

                db.session.remove()
                with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                                  'REPORTS_ANNUL_ENABLED': True}):
                    event.listen(db.engine, 'before_cursor_execute', synchronize)
                    try:
                        with ThreadPoolExecutor(max_workers=2) as pool:
                            futures = [pool.submit(submit, kind)
                                       for kind in ('anulacion', competitor)]
                            results = [future.result(timeout=25) for future in futures]
                    finally:
                        event.remove(db.engine, 'before_cursor_execute', synchronize)
                self.assertEqual(len(connections), 2)
                self.assertEqual(sorted(code for _, code in results), [200, 409])
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                self.assertEqual(report.revision_actual, 2)
                self.assertEqual(len(report.versiones), 2)
                self.assertEqual(report.versiones[0].datos_estructurados,
                                 self.report_payload(visit_id=visit_id)['datos_estructurados'])
                winner = next(kind for kind, code in results if code == 200)
                self.assertEqual(report.versiones[1].operacion,
                                 'ANULACION' if winner == 'anulacion' else 'CORRECCION')
                self.assertEqual(report.versiones[1].estado, report.estado)
                self.assertEqual(report.versiones[1].datos_estructurados, report.datos_estructurados)

    def test_29c5_history_catalog_and_snapshots_read_only(self):
        with self.report_visit() as visit_id:
            created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201)
            report_id = created.json['data']['id']
            other, _ = self.call('/api/informes', method='POST', token=self.token('colleague'),
                                 json_data=self.report_payload(visit_id=visit_id, type_id=3))
            self.assertEqual(other.status_code, 201)
            other_id = other.json['data']['id']
            path = f'/api/informes/{report_id}'
            catalog = f'/api/informes/historial/paciente/{self.patient_ids[1]}'
            with patch.dict(self.app.config, {'REPORTS_HISTORY_ENABLED': True,
                                              'REPORTS_EDIT_ENABLED': True,
                                              'REPORTS_ANNUL_ENABLED': True}):
                corrected, _ = self.call(path, method='PUT', token=self.token(), json_data={
                    'datos_estructurados': {'nota': 'Corrección reservada'},
                    'motivo': 'Corrección registrada', 'revision_esperada': 1})
                self.assertEqual(corrected.status_code, 200, corrected.json)
                annulled, _ = self.call(path + '/anulacion', method='POST', token=self.token(),
                                         json_data={'motivo': 'Anulación registrada', 'revision_esperada': 2})
                self.assertEqual(annulled.status_code, 200, annulled.json)
            db.session.remove()
            other_report = db.session.get(informe_entities.Informe, other_id)
            other_report.estado = 'INACTIVO'
            other_report.revision_actual = 2
            db.session.flush()
            db.session.add(informe_entities.InformeVersion(
                informe_id=other_id, numero_version=2, operacion='INACTIVACION',
                schema_version=other_report.schema_version,
                datos_estructurados=other_report.datos_estructurados,
                conclusion=other_report.conclusion, estado='INACTIVO',
                autor_operacion_id=self.user_ids['colleague'], motivo='Fixture sintético'))
            db.session.commit()
            db.session.remove()
            with patch.dict(self.app.config, {'REPORTS_HISTORY_ENABLED': True}):
                before = [(r.id, r.revision_actual, r.estado, len(r.versiones))
                          for r in informe_entities.Informe.query.filter_by(visita_id=visit_id).all()]
                db.session.remove()
                response, sql = self.call(catalog + '?per_page=1&page=1',
                                          token=self.token('colleague'), measure=True)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
                self.assertEqual(response.json['pagination']['total'], 2)
                self.assertTrue(response.json['pagination']['has_more'])
                self.assertEqual(len(response.json['data']), 1)
                self.assertNotIn('datos_estructurados', str(response.json))
                self.assertNotIn('conclusion', str(response.json))
                self.assertEqual(sum('from informes ' in q.lower().replace('`', '')
                                     for q in sql), 2)  # COUNT + JOIN paginado.
                second, _ = self.call(catalog + '?per_page=1&page=2', token=self.token())
                self.assertEqual(second.status_code, 200)
                self.assertFalse(second.json['pagination']['has_more'])
                rows = response.json['data'] + second.json['data']
                self.assertEqual({r['id']: r['estado'] for r in rows},
                                 {report_id: 'ANULADO', other_id: 'INACTIVO'})
                self.assertEqual({r['id']: r['revision_actual'] for r in rows},
                                 {report_id: 3, other_id: 2})
                self.assertTrue(all(r['visita_id'] == visit_id for r in rows))
                regular, _ = self.call(f'/api/informes/paciente/{self.patient_ids[1]}',
                                       token=self.token())
                self.assertEqual(regular.status_code, 200)
                self.assertFalse(any(r['id'] in (report_id, other_id) for r in regular.json['data']))
                report, statements = self.call(path + '/versiones?per_page=2&page=1',
                                               token=self.token('colleague'), measure=True)
                self.assertEqual(report.status_code, 200, report.json)
                self.assertEqual(report.headers['Cache-Control'], 'private, no-store')
                self.assertEqual(report.json['data']['informe']['estado'], 'ANULADO')
                self.assertEqual(report.json['data']['informe']['revision_actual'], 3)
                self.assertEqual(report.json['pagination']['total'], 3)
                self.assertEqual([(v['numero_version'], v['operacion'], v['es_actual'])
                                  for v in report.json['data']['versiones']],
                                 [(1, 'CREACION', False), (2, 'CORRECCION', False)])
                self.assertEqual(report.json['data']['versiones'][0]['datos_estructurados'],
                                 self.report_payload(visit_id=visit_id)['datos_estructurados'])
                self.assertEqual(report.json['data']['versiones'][1]['datos_estructurados'],
                                 {'nota': 'Corrección reservada'})
                self.assertEqual(report.json['data']['versiones'][1]['motivo'],
                                 'Corrección registrada')
                final, _ = self.call(path + '/versiones?per_page=2&page=2', token=self.token())
                self.assertEqual(final.status_code, 200, final.json)
                final_version = final.json['data']['versiones'][0]
                self.assertEqual((final_version['numero_version'], final_version['operacion'],
                                  final_version['estado'], final_version['es_actual']),
                                 (3, 'ANULACION', 'ANULADO', True))
                self.assertEqual(final_version['datos_estructurados'],
                                 report.json['data']['versiones'][1]['datos_estructurados'])
                self.assertEqual(final_version['motivo'], 'Anulación registrada')
                self.assertIsNotNone(final_version['fecha_operacion'])
                self.assertEqual(final_version['autor_operacion_id'],
                                 self.user_ids['ophthalmologist'])
                self.assertEqual(report.json['data']['versiones'][0]['schema_version'], 1)
                self.assertFalse(any(q.lstrip().lower().startswith(('insert ', 'update ', 'delete '))
                                     for q in statements))
                inactive, _ = self.call(f'/api/informes/{other_id}/versiones',
                                        token=self.token())
                self.assertEqual(inactive.status_code, 200, inactive.json)
                self.assertEqual(inactive.json['data']['informe']['estado'], 'INACTIVO')
                db.session.remove()
                after = [(r.id, r.revision_actual, r.estado, len(r.versiones))
                         for r in informe_entities.Informe.query.filter_by(visita_id=visit_id).all()]
                self.assertEqual(after, before)

    def test_29c6_three_flags_independent_on_real_http(self):
        with self.report_visit() as visit_id:
            created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201, created.json)
            report_id = created.json['data']['id']
            paths = (
                (f'/api/informes/{report_id}', 'PUT',
                 {'datos_estructurados': {'nota': 'Sin escribir'},
                  'motivo': 'Prueba de guardia', 'revision_esperada': 0}),
                (f'/api/informes/{report_id}/anulacion', 'POST',
                 {'motivo': 'Prueba de guardia', 'revision_esperada': 0}),
                (f'/api/informes/{report_id}/versiones', 'GET', None),
                (f'/api/informes/historial/paciente/{self.patient_ids[1]}', 'GET', None),
            )
            keys = ('REPORTS_EDIT_ENABLED', 'REPORTS_ANNUL_ENABLED', 'REPORTS_HISTORY_ENABLED')
            self.assertTrue(all(self.app.config.get(key) is not True for key in keys))
            for mask in range(8):
                flags = {key: bool(mask & (1 << index)) for index, key in enumerate(keys)}
                with self.subTest(flags=flags), patch.dict(self.app.config, flags):
                    for index, (path, method, body) in enumerate(paths):
                        enabled = flags[keys[min(index, 2)]]
                        response, sql = self.call(path, method=method, token=self.token(),
                                                  json_data=body, measure=True)
                        self.assertEqual(response.status_code,
                                         (400 if index < 2 else 200) if enabled else 403,
                                         (flags, path, response.json))
                        if not enabled:
                            self.assertFalse(any('from informes' in statement.lower().replace('`', '')
                                                 or 'informes_versiones' in statement.lower().replace('`', '')
                                                 for statement in sql))
                            self.assertFalse(any(statement.lstrip().lower().startswith(
                                ('insert ', 'update ', 'delete ')) for statement in sql))
                        if index >= 2:
                            self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
                    self.assertEqual(self.call(f'/api/informes/{report_id}', method='DELETE',
                                               token=self.token())[0].status_code, 403)
                    denied, sql = self.call(paths[2][0], token=self.token('administrator'), measure=True)
                    self.assertEqual(denied.status_code, 403)
                    self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
                    for bearer in (None, 'invalid'):
                        for path, method, body in paths:
                            denied, sql = self.call(path, method=method, token=bearer,
                                                    json_data=body, measure=True)
                            self.assertEqual(denied.status_code, 401)
                            self.assertEqual(sql, [])
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual((report.revision_actual, report.estado, len(report.versiones)),
                             (1, 'ACTIVO', 1))
            self.assertTrue(all(self.app.config.get(key) is not True for key in keys))

    def test_29c6_full_cycle_create_two_edits_annul_history(self):
        with self.report_visit(state='CERRADA') as visit_id:
            path = '/api/informes'
            created, sql = self.call(path, method='POST', token=self.token(),
                                     json_data=self.report_payload(visit_id=visit_id), measure=True)
            self.assertEqual(created.status_code, 201, created.json)
            self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                                 for q in sql), 1)
            report_id = created.json['data']['id']
            target = f'{path}/{report_id}'
            db.session.remove()
            visit = db.session.get(VisitaClinica, visit_id)
            before_visit = {column.name: getattr(visit, column.name)
                            for column in VisitaClinica.__table__.columns}
            initial = db.session.get(informe_entities.Informe, report_id).versiones[0]
            before_initial = (initial.id, initial.fecha_operacion, initial.datos_estructurados,
                              initial.conclusion, initial.operacion, initial.autor_operacion_id)
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                              'REPORTS_ANNUL_ENABLED': True,
                                              'REPORTS_HISTORY_ENABLED': True}):
                for expected in (1, 2):
                    corrected, sql = self.call(target, method='PUT', token=self.token(),
                                               json_data={
                                                   'revision_esperada': expected,
                                                   'motivo': f'Motivo sintético {expected}',
                                                   'datos_estructurados': {
                                                       'nota': f'Contenido sintético {expected}',
                                                       'conclusion': f'Conclusión sintética {expected}',
                                                   },
                                               }, measure=True)
                    self.assertEqual(corrected.status_code, 200, corrected.json)
                    self.assertEqual(corrected.json['data']['revision_actual'], expected + 1)
                    self.assertEqual(sum('insert into informes_versiones' in q.lower().replace('`', '')
                                         for q in sql), 1)
                annulled, _ = self.call(target + '/anulacion', method='POST', token=self.token(),
                                         json_data={'revision_esperada': 3,
                                                    'motivo': 'Anulación sintética final'})
                self.assertEqual(annulled.status_code, 200, annulled.json)
                self.assertEqual(annulled.json['data']['revision_actual'], 4)
                catalog, catalog_sql = self.call(
                    f'{path}/historial/paciente/{self.patient_ids[1]}',
                    token=self.token('colleague'), measure=True)
                self.assertEqual(catalog.status_code, 200, catalog.json)
                self.assertEqual(catalog.headers['Cache-Control'], 'private, no-store')
                self.assertTrue(any(row['id'] == report_id and row['estado'] == 'ANULADO'
                                    for row in catalog.json['data']))
                history, history_sql = self.call(target + '/versiones?per_page=2&page=1',
                                                 token=self.token('colleague'), measure=True)
                second, second_sql = self.call(target + '/versiones?per_page=2&page=2',
                                               token=self.token('colleague'), measure=True)
                self.assertEqual((history.status_code, second.status_code), (200, 200))
                self.assertEqual(history.headers['Cache-Control'], 'private, no-store')
                self.assertEqual(history.json['pagination']['total'], 4)
                self.assertTrue(history.json['pagination']['has_more'])
                self.assertFalse(second.json['pagination']['has_more'])
                versions = history.json['data']['versiones'] + second.json['data']['versiones']
                self.assertEqual([(v['numero_version'], v['operacion'], v['es_actual']) for v in versions],
                                 [(1, 'CREACION', False), (2, 'CORRECCION', False),
                                  (3, 'CORRECCION', False), (4, 'ANULACION', True)])
                self.assertEqual([v['motivo'] for v in versions],
                                 [None, 'Motivo sintético 1', 'Motivo sintético 2',
                                  'Anulación sintética final'])
                self.assertEqual([v['datos_estructurados']['nota'] for v in versions],
                                 ['Resultado sintético', 'Contenido sintético 1',
                                  'Contenido sintético 2', 'Contenido sintético 2'])
                self.assertEqual([v['schema_version'] for v in versions], [1] * 4)
                self.assertEqual({v['autor_operacion_id'] for v in versions},
                                 {self.user_ids['ophthalmologist']})
                self.assertTrue(all(v['fecha_operacion'] for v in versions))
                self.assertEqual(history.json['data']['informe']['revision_actual'], 4)
                self.assertEqual(second.json['data']['informe']['estado'], 'ANULADO')
                self.assertFalse(any(q.lstrip().lower().startswith(('insert ', 'update ', 'delete '))
                                     for q in catalog_sql + history_sql + second_sql))
                regular, _ = self.call(f'{path}/visita/{visit_id}', token=self.token())
                self.assertNotIn(report_id, [row['id'] for row in regular.json['data']])
                self.assertEqual(self.call(target, token=self.token())[0].status_code, 404)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual((report.usuario_id, report.revision_actual, report.estado),
                             (self.user_ids['ophthalmologist'], 4, 'ANULADO'))
            self.assertEqual((report.versiones[0].id, report.versiones[0].fecha_operacion,
                              report.versiones[0].datos_estructurados,
                              report.versiones[0].conclusion, report.versiones[0].operacion,
                              report.versiones[0].autor_operacion_id), before_initial)
            self.assertEqual([(v.numero_version, v.operacion) for v in report.versiones],
                             [(1, 'CREACION'), (2, 'CORRECCION'),
                              (3, 'CORRECCION'), (4, 'ANULACION')])
            self.assertEqual((report.datos_estructurados, report.conclusion, report.schema_version,
                              report.estado),
                             (report.versiones[-1].datos_estructurados,
                              report.versiones[-1].conclusion, report.versiones[-1].schema_version,
                              report.versiones[-1].estado))
            self.assertEqual({column.name: getattr(db.session.get(VisitaClinica, visit_id),
                                                   column.name) for column in VisitaClinica.__table__.columns},
                             before_visit)
            self.assertIsNone(diagnosis_entities.Diagnostico.query.filter_by(visita_id=visit_id).first())

    def test_29c5_history_denials_inactive_patient_and_inconsistency(self):
        with self.report_visit(state='ANULADA') as visit_id:
            # Solo fixtures SQL sintéticos; el POST ordinario prohíbe visita anulada.
            db.session.add(informe_entities.Informe(
                visita_id=visit_id, tipo_informe_id=2,
                usuario_id=self.user_ids['ophthalmologist'], revision_actual=1,
                schema_version=1, datos_estructurados={'nota': 'Estado conocido'},
                conclusion=None, estado='INACTIVO'))
            db.session.flush()
            report_id = informe_entities.Informe.query.filter_by(visita_id=visit_id).one().id
            db.session.add(informe_entities.InformeVersion(
                informe_id=report_id, numero_version=1, operacion='MIGRACION_INICIAL',
                schema_version=1, datos_estructurados={'nota': 'Estado conocido'},
                conclusion=None, estado='INACTIVO', autor_operacion_id=None))
            db.session.commit()
            db.session.remove()
            path = f'/api/informes/{report_id}/versiones'
            catalog = f'/api/informes/historial/paciente/{self.patient_ids[1]}'
            for target in (path, catalog):
                denied, sql = self.call(target, token=self.token(), measure=True)
                self.assertEqual(denied.status_code, 403)
                self.assertFalse(any('from informes' in q.lower().replace('`', '') for q in sql))
            with patch.dict(self.app.config, {'REPORTS_HISTORY_ENABLED': True}):
                for target in (path, catalog):
                    for bearer in (None, 'invalid', self.token(expired=True)):
                        denied, sql = self.call(target, token=bearer, measure=True)
                        self.assertEqual(denied.status_code, 401)
                        self.assertEqual(sql, [])
                    self.assertEqual(self.call(target + '?token=' + self.token(),
                                               token=self.token())[0].status_code, 401)
                    for profile in ('administrator', 'nurse', 'assistant'):
                        denied, sql = self.call(target, token=self.token(profile), measure=True)
                        self.assertEqual(denied.status_code, 403)
                        self.assertFalse(any('from informes' in q.lower().replace('`', '')
                                             for q in sql))
                    with self.temporary_grant('OFTALMOLOGO', 'informes.ver', present=False):
                        for profile in ('ophthalmologist', 'dual'):
                            self.assertEqual(self.call(target, token=self.token(profile))[0].status_code, 403)
                        with self.temporary_grant('ADMINISTRADOR_SISTEMA', 'informes.ver', present=True):
                            self.assertEqual(self.call(target, token=self.token('dual'))[0].status_code, 403)
                    with self.temporary_state(Usuario, self.user_ids['ophthalmologist'], 'INACTIVO'):
                        self.assertEqual(self.call(target, token=self.token())[0].status_code, 401)
                result, _ = self.call(path, token=self.token('colleague'))
                self.assertEqual(result.status_code, 200, result.json)
                initial = result.json['data']['versiones'][0]
                self.assertEqual((initial['operacion'], initial['autor_operacion_id'],
                                  initial['autor_operacion'], initial['es_actual']),
                                 ('MIGRACION_INICIAL', None, None, True))
                history, _ = self.call(catalog, token=self.token('colleague'))
                self.assertEqual(history.status_code, 200)
                self.assertTrue(any(r['id'] == report_id and r['estado_visita'] == 'ANULADA'
                                    for r in history.json['data']))
                with self.temporary_state(Paciente, self.patient_ids[1], 'INACTIVO'):
                    inactive_patient, _ = self.call(catalog, token=self.token('colleague'))
                    self.assertEqual(inactive_patient.status_code, 200)
                    self.assertTrue(any(r['id'] == report_id for r in inactive_patient.json['data']))
                    self.assertEqual(self.call(path, token=self.token('colleague'))[0].status_code, 200)
                self.assertEqual(self.call('/api/informes/99999999/versiones',
                                           token=self.token())[0].status_code, 404)
                self.assertEqual(self.call('/api/informes/historial/paciente/99999999',
                                           token=self.token())[0].status_code, 404)
                db.session.remove()
                report = db.session.get(informe_entities.Informe, report_id)
                report.datos_estructurados = {'nota': 'Principal inconsistente'}
                db.session.commit()
                mismatch, _ = self.call(path, token=self.token())
                self.assertEqual(mismatch.status_code, 409)
                self.assertNotIn('Principal inconsistente', mismatch.get_data(as_text=True))
                db.session.remove()
                self.assertEqual(informe_entities.InformeVersion.query.filter_by(
                    informe_id=report_id).one().datos_estructurados['nota'], 'Estado conocido')


    def test_29d5a_utc_checkout_pool_and_failure_closed(self):
        from b1_mysql_disposable_trial import connect

        port, password = self.config
        with connect(port, password, 'centro_oftalmologico_db_v2') as raw:
            with raw.cursor() as cursor:
                cursor.execute('SELECT @@session.time_zone')
                initial_zone = cursor.fetchone()[0]
                cursor.execute("SET SESSION time_zone = 'SYSTEM'")
                cursor.execute('SELECT @@session.time_zone')
                self.assertEqual(cursor.fetchone()[0], 'SYSTEM')
                # Simulate the historical five-hour offset without changing the server.
                cursor.execute("SET SESSION time_zone = '-05:00'")
                cursor.execute('SELECT TIMEDIFF(NOW(6), UTC_TIMESTAMP(6))')
                self.assertEqual(cursor.fetchone()[0], timedelta(hours=-5))
            # No changes to global timezone or any clinical row.
        self.assertIn(initial_zone, ('SYSTEM', '+00:00'))

        db.session.remove()
        engine = db.engine
        engine.dispose()  # Force a new physical connection with UTC checkout.
        with engine.connect() as connection:
            self.assertEqual(connection.exec_driver_sql('SELECT @@session.time_zone').scalar(), '+00:00')
            self.assertLess(abs(connection.exec_driver_sql(
                'SELECT TIMESTAMPDIFF(SECOND, NOW(6), UTC_TIMESTAMP(6))').scalar()), 2)
            # Tamper with a pooled connection in the *disposable* server only.
            connection.exec_driver_sql("SET SESSION time_zone = '-05:00'")
        with engine.connect() as connection:
            self.assertEqual(connection.exec_driver_sql('SELECT @@session.time_zone').scalar(), '+00:00')
            first_id = connection.exec_driver_sql('SELECT CONNECTION_ID()').scalar()
        with engine.connect() as connection:
            self.assertEqual(connection.exec_driver_sql('SELECT @@session.time_zone').scalar(), '+00:00')
            self.assertEqual(connection.exec_driver_sql('SELECT CONNECTION_ID()').scalar(), first_id)
        db.session.remove()
        self.assertEqual(db.session.execute(text('SELECT @@session.time_zone')).scalar(), '+00:00')
        db.session.remove()

        class BrokenConnection:
            def cursor(self):
                raise ValueError('private connection data')

        with self.assertRaisesRegex(RuntimeError, 'No se pudo configurar la sesion MySQL en UTC') as failure:
            _set_utc_on_checkout(BrokenConnection(), None, None)
        self.assertNotIn('private', str(failure.exception))

        before = db.session.query(informe_entities.InformeVersion).count()
        db.session.remove()
        event.remove(engine, 'checkout', _set_utc_on_checkout)

        def reject_checkout(*_):
            raise RuntimeError('No se pudo configurar la sesion MySQL en UTC')

        event.listen(engine, 'checkout', reject_checkout)
        try:
            with patch.object(self.app.logger, 'exception'):
                blocked, _ = self.call('/api/informes', method='POST', token=self.token(),
                                       json_data=self.report_payload())
            self.assertEqual(blocked.status_code, 500)
            self.assertNotIn('UTC', blocked.get_data(as_text=True))
        finally:
            db.session.remove()
            event.remove(engine, 'checkout', reject_checkout)
            event.listen(engine, 'checkout', _set_utc_on_checkout)
        self.assertEqual(db.session.query(informe_entities.InformeVersion).count(), before)
        db.session.remove()

    def test_29d5a_retinograph_expiration_boundary_utc(self):
        expiry = datetime(2030, 1, 2, 3, 4, 5, 123456)
        record = SimpleNamespace(
            estado='CONFIRMADA', detalle_id=None, fecha_expiracion=expiry,
            paciente_id=self.patient_ids[0], ojo_confirmado='Izquierdo',
            nombre_exportacion=self.retino_files['L'][0],
        )
        for instant, available in ((expiry - timedelta(microseconds=1), True),
                                   (expiry, False),
                                   (expiry + timedelta(microseconds=1), False)):
            with self.subTest(instant=instant), patch.object(
                    retinograph_confirmation_service, 'utc_now_naive', return_value=instant):
                if available:
                    self.assertIsNotNone(retinograph_confirmation_service._available(
                        record, self.patient_ids[0], 'Izquierdo'))
                else:
                    with self.assertRaises(retinograph_confirmation_service.ConfirmationUseError):
                        retinograph_confirmation_service._available(
                            record, self.patient_ids[0], 'Izquierdo')

    def test_29d5d_read_contract_with_persisted_origin(self):
        with self.report_visit() as visit_id:
            payload = self.report_payload(visit_id=visit_id)
            for injected in ({**payload, 'fecha_creado_origen': 'UTC_VERIFICADO'},
                             {**payload, 'datos_estructurados': {'fecha_visita_origen': 'UTC_VERIFICADO'}}):
                rejected, sql = self.call('/api/informes', method='POST', token=self.token(),
                                          json_data=injected, measure=True)
                self.assertIn(rejected.status_code, (400, 422))
                self.assertFalse(any(q.strip().lower().startswith('insert') for q in sql))
            response, _ = self.call('/api/informes', method='POST', token=self.token(),
                                    json_data=payload)
            self.assertEqual(response.status_code, 201)
            report_id = response.json['data']['id']
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                              'REPORTS_ANNUL_ENABLED': True}):
                corrected, _ = self.call(f'/api/informes/{report_id}', method='PUT',
                                         token=self.token(), json_data={
                    'datos_estructurados': {'nota': 'Sintetico'},
                    'motivo': 'Sintetico', 'revision_esperada': 1,
                })
                self.assertEqual(corrected.status_code, 200)
                annulled, _ = self.call(f'/api/informes/{report_id}/anulacion', method='POST',
                                        token=self.token(), json_data={
                    'motivo': 'Sintetico', 'revision_esperada': 2,
                })
                self.assertEqual(annulled.status_code, 200)
            db.session.remove()
            before = [(row.numero_version, row.fecha_operacion, row.fecha_operacion_origen)
                      for row in informe_entities.InformeVersion.query.filter_by(
                          informe_id=report_id).order_by(informe_entities.InformeVersion.numero_version)]
            visit = db.session.get(VisitaClinica, visit_id)
            expected_visit = visit.fecha_visita.isoformat() + 'Z'
            self.assertEqual(visit.fecha_visita_origen, 'UTC_VERIFICADO')
            db.session.remove()
            visits, _ = self.call(f'/api/pacientes/{self.patient_ids[1]}/visitas',
                                  token=self.token())
            self.assertEqual(visits.status_code, 200)
            verified_visit = next(item for item in visits.json['data']
                                  if item['visita_id'] == visit_id)
            self.assertEqual(verified_visit['fecha_visita'], expected_visit)
            self.assertEqual(verified_visit['fecha_visita_origen'], 'UTC_VERIFICADO')
            with patch.dict(self.app.config, {'REPORTS_HISTORY_ENABLED': True}):
                versions, sql = self.call(f'/api/informes/{report_id}/versiones',
                                          token=self.token(), measure=True)
                self.assertEqual(versions.status_code, 200)
                self.assertEqual(versions.headers['Cache-Control'], 'private, no-store')
                self.assertFalse(any(q.strip().lower().startswith(('insert', 'update', 'delete')) for q in sql))
                rows = versions.json['data']['versiones']
                self.assertEqual([row['operacion'] for row in rows],
                                 ['CREACION', 'CORRECCION', 'ANULACION'])
                self.assertEqual([row['numero_version'] for row in rows], [1, 2, 3])
                for row in rows:
                    self.assertEqual(row['fecha_operacion'],
                                     before[row['numero_version'] - 1][1].isoformat() + 'Z')
                    self.assertEqual(row['fecha_operacion_origen'], 'UTC_VERIFICADO')
                    self.assertNotIn('GMT', row['fecha_operacion'])
                    self.assertTrue(row['fecha_operacion'].endswith('Z'))
                catalog, _ = self.call('/api/informes/historial/paciente/' +
                                       str(self.patient_ids[1]), token=self.token())
                self.assertEqual(catalog.status_code, 200)
                self.assertEqual(catalog.headers['Cache-Control'], 'private, no-store')
                row = next(item for item in catalog.json['data'] if item['id'] == report_id)
                self.assertEqual(row['fecha_visita'], expected_visit)
                self.assertEqual(row['fecha_visita_origen'], 'UTC_VERIFICADO')
                self.assertEqual(row['fecha_creado_origen'], 'UTC_VERIFICADO')
                self.assertNotIn('GMT', row['fecha_creado'])
            db.session.remove()
            after = [(row.numero_version, row.fecha_operacion, row.fecha_operacion_origen)
                     for row in informe_entities.InformeVersion.query.filter_by(
                         informe_id=report_id).order_by(informe_entities.InformeVersion.numero_version)]
            self.assertEqual(after, before)
            db.session.remove()

    def test_29d5d_history_update_and_utc_checkout_guard(self):
        from utils.temporal_provenance import require_utc_connection
        with self.report_visit() as visit_id:
            visit = db.session.get(VisitaClinica, visit_id)
            self.assertEqual(visit.fecha_creado_origen, 'UTC_VERIFICADO')
            self.assertEqual(visit.fecha_actualizado_origen, 'UTC_VERIFICADO')
            self.assertEqual(visit.fecha_visita_origen, 'UTC_VERIFICADO')
            db.session.remove()

            response, _ = self.call('/api/informes', method='POST', token=self.token(),
                                    json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(response.status_code, 201)
            report_id = response.json['data']['id']
            report = db.session.get(informe_entities.Informe, report_id)
            first = report.versiones[0]
            self.assertEqual((report.fecha_creado_origen, report.fecha_actualizado_origen,
                              first.fecha_operacion_origen), ('UTC_VERIFICADO',) * 3)
            # Emulate the pre-cutover row: preserve its stored values and mark
            # only their provenance unknown; a later revision must not relabel it.
            db.session.execute(text('UPDATE informes SET fecha_creado_origen = :u, '
                                    'fecha_actualizado_origen = :u WHERE id = :id'),
                               {'u': 'NO_VERIFICADO', 'id': report_id})
            db.session.execute(text('UPDATE informes_versiones SET fecha_operacion_origen = :u '
                                    'WHERE id = :id'), {'u': 'NO_VERIFICADO', 'id': first.id})
            db.session.commit()
            db.session.remove()
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                              'REPORTS_ANNUL_ENABLED': True}):
                fixed, _ = self.call(f'/api/informes/{report_id}', method='PUT',
                                     token=self.token(), json_data={
                    'datos_estructurados': {'nota': 'Cambio sintetico'},
                    'motivo': 'Correccion sintetica', 'revision_esperada': 1})
                self.assertEqual(fixed.status_code, 200, fixed.json)
                annulled, _ = self.call(f'/api/informes/{report_id}/anulacion', method='POST',
                                        token=self.token(), json_data={
                    'motivo': 'Anulacion sintetica', 'revision_esperada': 2})
                self.assertEqual(annulled.status_code, 200, annulled.json)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            self.assertEqual(report.fecha_creado_origen, 'NO_VERIFICADO')
            self.assertEqual(report.fecha_actualizado_origen, 'UTC_VERIFICADO')
            self.assertEqual([v.fecha_operacion_origen for v in report.versiones],
                             ['NO_VERIFICADO', 'UTC_VERIFICADO', 'UTC_VERIFICADO'])
            db.session.remove()
            with patch.dict(self.app.config, {'REPORTS_HISTORY_ENABLED': True}):
                result, _ = self.call(f'/api/informes/{report_id}/versiones', token=self.token())
                self.assertEqual(result.status_code, 200)
                self.assertFalse(result.json['data']['versiones'][0]['fecha_operacion'].endswith('Z'))
                self.assertTrue(result.json['data']['versiones'][1]['fecha_operacion'].endswith('Z'))
            db.session.remove()
            visit = db.session.get(VisitaClinica, visit_id)
            visit.motivo_consulta = 'Cambio sintetico'
            db.session.commit()
            self.assertEqual(visit.fecha_actualizado_origen, 'UTC_VERIFICADO')
            db.session.remove()
            with self.assertRaises(DBAPIError):
                db.session.execute(text('UPDATE visitas_clinicas SET fecha_visita_origen = :bad '
                                        'WHERE id = :id'), {'bad': 'FALSO', 'id': visit_id})
                db.session.commit()
            db.session.rollback()
            db.session.execute(text("SET SESSION time_zone = '-05:00'"))
            with self.assertRaises(RuntimeError):
                visit = db.session.get(VisitaClinica, visit_id)
                visit.motivo_consulta = 'No permitido'
                db.session.flush()
            db.session.rollback()
            db.session.remove()
            with db.engine.connect() as connection:
                require_utc_connection(connection)
                self.assertEqual(connection.exec_driver_sql('SELECT @@session.time_zone').scalar(), '+00:00')
            # A direct SQL writer bypasses mapper hooks: demonstrate the risk
            # in a rollback-only transaction, never leave a falsely marked row.
            with db.engine.connect() as connection:
                trans = connection.begin()
                try:
                    connection.exec_driver_sql(
                        "UPDATE visitas_clinicas SET fecha_visita = '2030-01-01 00:00:00' WHERE id = %s",
                        (visit_id,))
                    changed = connection.exec_driver_sql(
                        'SELECT fecha_visita_origen FROM visitas_clinicas WHERE id = %s',
                        (visit_id,)).scalar()
                    self.assertEqual(changed, 'UTC_VERIFICADO')
                finally:
                    trans.rollback()
            db.session.remove()

    def test_29d5e2_verified_authorization_is_not_reusable(self):
        from utils.temporal_provenance import set_verified_utc
        with self.report_visit() as visit_id:
            visit = db.session.get(VisitaClinica, visit_id)
            set_verified_utc(visit, 'fecha_visita')
            db.session.flush()
            self.assertEqual(visit.fecha_visita_origen, 'UTC_VERIFICADO')
            visit.fecha_visita = datetime(2030, 1, 2, 0, 30)
            db.session.commit()
            db.session.remove()
            reloaded = db.session.get(VisitaClinica, visit_id)
            self.assertEqual(reloaded.fecha_visita_origen, 'NO_VERIFICADO')
            self.assertEqual(reloaded.fecha_visita, datetime(2030, 1, 2, 0, 30))
            db.session.remove()

    def test_29d5e2_approval_lifecycle_and_independent_fields(self):
        from utils.temporal_provenance import set_verified_utc
        with self.report_visit() as visit_id:
            visit = db.session.get(VisitaClinica, visit_id)
            visit.fecha_creado = datetime(2030, 1, 1)
            db.session.flush()
            self.assertEqual(visit.fecha_creado_origen, 'NO_VERIFICADO')
            set_verified_utc(visit, 'fecha_visita')
            visit.fecha_visita = datetime(2030, 2, 1)  # overwrite before the first flush
            db.session.flush()
            self.assertEqual(visit.fecha_visita_origen, 'NO_VERIFICADO')
            set_verified_utc(visit, 'fecha_visita')
            db.session.flush()
            self.assertEqual(visit.fecha_visita_origen, 'UTC_VERIFICADO')
            self.assertEqual(visit.fecha_creado_origen, 'NO_VERIFICADO')
            visit.motivo_consulta = 'Actualizacion parcial sintetica'
            db.session.commit()
            self.assertEqual(visit.fecha_actualizado_origen, 'UTC_VERIFICADO')
            self.assertEqual(visit.fecha_creado_origen, 'NO_VERIFICADO')
            visit.fecha_visita = datetime(2030, 2, 2)
            db.session.commit()  # same Python instance after commit/expiry
            self.assertEqual(visit.fecha_visita_origen, 'NO_VERIFICADO')
            set_verified_utc(visit, 'fecha_visita')
            db.session.flush()
            db.session.rollback()
            db.session.remove()
            visit = db.session.get(VisitaClinica, visit_id)
            self.assertEqual(visit.fecha_visita_origen, 'NO_VERIFICADO')
            set_verified_utc(visit, 'fecha_visita')  # new approval after rollback
            db.session.commit()
            db.session.remove()
            self.assertEqual(db.session.get(VisitaClinica, visit_id).fecha_visita_origen,
                             'UTC_VERIFICADO')
            db.session.remove()

    def test_29d5e2_marker_promotion_without_new_instant_is_rejected(self):
        with self.report_visit() as visit_id:
            visit = db.session.get(VisitaClinica, visit_id)
            visit.fecha_visita = datetime(2030, 2, 3)
            db.session.commit()
            visit.fecha_visita_origen = 'UTC_VERIFICADO'
            with self.assertRaisesRegex(ValueError, 'No se puede acreditar'):
                db.session.flush()
            db.session.rollback()
            db.session.remove()
            visit = db.session.get(VisitaClinica, visit_id)
            self.assertEqual(visit.fecha_visita_origen, 'NO_VERIFICADO')
            visit.fecha_visita_origen = 'MARCA_INVALIDA'
            with self.assertRaises(Exception):
                db.session.flush()  # MySQL CHECK, no promotion through the mapper
            db.session.rollback()
            db.session.remove()

    def test_29d5e2_sql_writers_are_not_mapper_writers(self):
        from sqlalchemy import update
        from b1_mysql_disposable_trial import connect, ensure_own_server
        with self.report_visit() as visit_id:
            with db.engine.connect() as connection:
                trans = connection.begin()
                try:
                    current = connection.exec_driver_sql(
                        'SELECT fecha_visita, fecha_actualizado FROM visitas_clinicas WHERE id = %s',
                        (visit_id,)).first()
                    connection.exec_driver_sql(
                        'UPDATE visitas_clinicas SET fecha_visita = fecha_visita WHERE id = %s',
                        (visit_id,))
                    unchanged = connection.exec_driver_sql(
                        'SELECT fecha_visita, fecha_actualizado FROM visitas_clinicas WHERE id = %s',
                        (visit_id,)).first()
                    self.assertEqual(unchanged, current)
                    connection.execute(update(VisitaClinica).where(VisitaClinica.id == visit_id)
                                       .values(fecha_visita=datetime(2030, 3, 1)))
                    origin = connection.exec_driver_sql(
                        'SELECT fecha_visita_origen FROM visitas_clinicas WHERE id = %s',
                        (visit_id,)).scalar()
                    self.assertEqual(origin, 'UTC_VERIFICADO')  # documented unsafe bypass
                    connection.exec_driver_sql(
                        "UPDATE visitas_clinicas SET fecha_actualizado = '2020-01-01 00:00:00' WHERE id = %s",
                        (visit_id,))
                    connection.exec_driver_sql(
                        "UPDATE visitas_clinicas SET motivo_consulta = 'Cambio externo' WHERE id = %s",
                        (visit_id,))
                    updated = connection.exec_driver_sql(
                        'SELECT fecha_actualizado, fecha_actualizado_origen FROM visitas_clinicas WHERE id = %s',
                        (visit_id,)).first()
                    self.assertNotEqual(updated[0], datetime(2020, 1, 1))
                    self.assertEqual(updated[1], 'UTC_VERIFICADO')  # MySQL ON UPDATE bypass
                finally:
                    trans.rollback()
            db.session.remove()
            db.session.query(VisitaClinica).filter_by(id=visit_id).update(
                {'fecha_visita': datetime(2030, 4, 1)}, synchronize_session=False)
            self.assertEqual(db.session.get(VisitaClinica, visit_id).fecha_visita_origen,
                             'UTC_VERIFICADO')
            db.session.rollback()
            db.session.remove()
            db.session.execute(update(VisitaClinica).where(VisitaClinica.id == visit_id)
                               .values(fecha_visita=datetime(2030, 5, 1)))
            self.assertEqual(db.session.get(VisitaClinica, visit_id).fecha_visita_origen,
                             'UTC_VERIFICADO')
            db.session.rollback()
            db.session.remove()
            port, password = self.config
            with connect(port, password, 'centro_oftalmologico_db_v2') as external:
                self.assertEqual(ensure_own_server(external, self.own_datadir, port),
                                 self.own_server_uuid)
                external.begin()
                try:
                    with external.cursor() as cursor:
                        cursor.execute("SET SESSION time_zone = '-05:00'")
                        cursor.execute('UPDATE visitas_clinicas SET fecha_visita = %s WHERE id = %s',
                                       (datetime(2030, 6, 1), visit_id))
                        cursor.execute('SELECT fecha_visita_origen FROM visitas_clinicas WHERE id = %s',
                                       (visit_id,))
                        self.assertEqual(cursor.fetchone()[0], 'UTC_VERIFICADO')
                finally:
                    external.rollback()

    def test_29d5e2_verified_first_historical_group_is_consultable(self):
        from src.repositories.patient_repository import PatientRepository
        with self.report_visit() as verified_id, self.report_visit() as historic_id:
            db.session.execute(text('UPDATE visitas_clinicas SET fecha_visita_origen = :origin, '
                                    'fecha_visita = :date WHERE id = :id'),
                               {'origin': 'NO_VERIFICADO', 'date': datetime(2099, 1, 1),
                                'id': historic_id})
            db.session.commit()
            db.session.remove()
            rows = PatientRepository.obtener_diagnosticos_paciente(self.patient_ids[1])
            ids = [row['visita_id'] for row in rows]
            self.assertLess(ids.index(verified_id), ids.index(historic_id))
            self.assertEqual(rows[ids.index(historic_id)]['fecha_visita_origen'], 'NO_VERIFICADO')
            lookup, total = PatientRepository.buscar_paciente(self.patient_documents[1])
            self.assertEqual(total, 1)
            self.assertEqual(lookup[0]['visitas_sin_fecha_verificada'], 1)
            self.assertIsNotNone(lookup[0]['ultima_visita'])
            plan = db.session.execute(text("""EXPLAIN SELECT id FROM visitas_clinicas
                WHERE paciente_id = :patient AND estado <> 'ANULADA'
                ORDER BY CASE WHEN fecha_visita_origen = 'UTC_VERIFICADO' THEN 0 ELSE 1 END,
                         CASE WHEN fecha_visita_origen = 'UTC_VERIFICADO' THEN fecha_visita END DESC,
                         id DESC"""), {'patient': self.patient_ids[1]}).all()
            self.assertTrue(plan)
            db.session.remove()

    def test_29d5e2_report_history_pages_are_stable_across_origins(self):
        from src.repositories.informe_repository import InformeRepository
        with (self.report_visit() as one, self.report_visit() as two,
              self.report_visit() as three):
            ids = []
            for visit_id in (one, two, three):
                report = informe_entities.Informe(
                    visita_id=visit_id, tipo_informe_id=2,
                    usuario_id=self.user_ids['ophthalmologist'],
                    datos_estructurados={'nota': 'Sintetico'}, schema_version=1)
                db.session.add(report)
                db.session.flush()
                ids.append(report.id)
            db.session.commit()
            db.session.execute(text('UPDATE informes SET fecha_creado = :date, '
                                    'fecha_creado_origen = :origin WHERE id = :id'),
                               {'date': datetime(2037, 1, 1), 'origin': 'NO_VERIFICADO',
                                'id': ids[2]})
            db.session.commit()
            db.session.remove()
            total, first = InformeRepository.listar_historial_paciente(self.patient_ids[1], 1, 2)
            _, second = InformeRepository.listar_historial_paciente(self.patient_ids[1], 2, 2)
            # Other fixtures for the same patient may exist; compare the three
            # synthetic rows on their actual pages rather than assuming total=3.
            self.assertGreaterEqual(total, 3)
            _, all_rows = InformeRepository.listar_historial_paciente(self.patient_ids[1], 1, total)
            matching = [report for report, *_ in all_rows if report.id in ids]
            ordered = [report.id for report in matching]
            verified = sorted((report for report in matching if report.id != ids[2]),
                              key=lambda report: (report.fecha_creado, report.id), reverse=True)
            self.assertEqual(ordered, [report.id for report in verified] + [ids[2]])
            self.assertTrue(set(report.id for report, *_ in first).isdisjoint(
                report.id for report, *_ in second))
            db.session.remove()

    def test_29d5a_report_instants_new_visit_revisions_and_closed_visit(self):
        # Requests include password hashing and SQL I/O; still far below a timezone offset.
        tolerance = timedelta(minutes=2)

        def check_utc(*values):
            with db.engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql('SELECT @@session.time_zone').scalar(), '+00:00')
                sql_now = connection.exec_driver_sql('SELECT UTC_TIMESTAMP(6)').scalar()
            for value in values:
                self.assertIsNone(value.tzinfo)
                self.assertLess(abs(value - sql_now), tolerance)

        def run_revision_chain(report_id):
            path = f'/api/informes/{report_id}'
            with patch.dict(self.app.config, {'REPORTS_EDIT_ENABLED': True,
                                              'REPORTS_ANNUL_ENABLED': True}):
                corrected, _ = self.call(path, method='PUT', token=self.token(), json_data={
                    'datos_estructurados': {'nota': 'Cambio sintetico'},
                    'motivo': 'Aclaracion sintetica', 'revision_esperada': 1,
                })
                self.assertEqual(corrected.status_code, 200, corrected.json)
                annulled, _ = self.call(path + '/anulacion', method='POST', token=self.token(),
                                         json_data={'motivo': 'Anulacion sintetica', 'revision_esperada': 2})
                self.assertEqual(annulled.status_code, 200, annulled.json)
            db.session.remove()
            report = db.session.get(informe_entities.Informe, report_id)
            versions = report.versiones
            self.assertEqual([v.operacion for v in versions], ['CREACION', 'CORRECCION', 'ANULACION'])
            self.assertEqual([v.numero_version for v in versions], [1, 2, 3])
            self.assertEqual(report.usuario_id, self.user_ids['ophthalmologist'])
            self.assertEqual(report.estado, 'ANULADO')
            self.assertEqual(versions[0].datos_estructurados,
                             self.report_payload()['datos_estructurados'])
            self.assertEqual(versions[1].datos_estructurados, {'nota': 'Cambio sintetico'})
            self.assertTrue(versions[0].fecha_operacion <= versions[1].fecha_operacion
                            <= versions[2].fecha_operacion)
            check_utc(report.fecha_creado, report.fecha_actualizado,
                      *(v.fecha_operacion for v in versions))
            self.assertLess(abs(report.fecha_actualizado - versions[2].fecha_operacion), tolerance)
            db.session.remove()

        started = utc_now_naive()
        created, sql = self.call('/api/informes', method='POST', token=self.token(),
                                 json_data=self.report_payload(), measure=True)
        self.assertEqual(created.status_code, 201, created.json)
        self.assertEqual(sum('insert into ' in statement.lower() for statement in sql), 3)
        visit_id, report_id = created.json['data']['visita_id'], created.json['data']['id']
        try:
            db.session.remove()
            visit = db.session.get(VisitaClinica, visit_id)
            report = db.session.get(informe_entities.Informe, report_id)
            initial = report.versiones[0]
            check_utc(visit.fecha_visita, visit.fecha_creado, visit.fecha_actualizado,
                      report.fecha_creado, report.fecha_actualizado, initial.fecha_operacion)
            self.assertLess(abs(visit.fecha_visita - initial.fecha_operacion), tolerance)
            self.assertLess(abs(report.fecha_creado - initial.fecha_operacion), tolerance)
            self.assertLess(abs(visit.fecha_creado - started), tolerance)
            from b1_mysql_disposable_trial import connect
            with connect(*self.config, 'centro_oftalmologico_db_v2') as raw:
                with raw.cursor() as cursor:
                    cursor.execute("SET SESSION time_zone = '-05:00'")
                    cursor.execute('SELECT fecha_visita, fecha_creado FROM visitas_clinicas WHERE id = %s',
                                   (visit_id,))
                    local_date, local_timestamp = cursor.fetchone()
                    self.assertEqual(local_date, visit.fecha_visita)  # DATETIME is unchanged.
                    self.assertEqual(local_timestamp, visit.fecha_creado - timedelta(hours=5))
                    cursor.execute('SELECT UNIX_TIMESTAMP(fecha_creado) FROM visitas_clinicas WHERE id = %s',
                                   (visit_id,))
                    local_epoch = cursor.fetchone()[0]
            with db.engine.connect() as connection:
                utc_epoch = connection.exec_driver_sql(
                    'SELECT UNIX_TIMESTAMP(fecha_creado) FROM visitas_clinicas WHERE id = %s',
                    (visit_id,)).scalar()
            self.assertEqual(local_epoch, utc_epoch)  # TIMESTAMP stores one UTC instant.
            db.session.remove()
            run_revision_chain(report_id)
        finally:
            db.session.remove()
            db.session.query(informe_entities.InformeVersion).filter_by(informe_id=report_id).delete()
            db.session.query(informe_entities.Informe).filter_by(id=report_id).delete()
            db.session.query(VisitaClinica).filter_by(id=visit_id).delete()
            db.session.commit()
            db.session.remove()

        with self.report_visit(state='CERRADA') as visit_id:
            created, _ = self.call('/api/informes', method='POST', token=self.token(),
                                   json_data=self.report_payload(visit_id=visit_id))
            self.assertEqual(created.status_code, 201, created.json)
            run_revision_chain(created.json['data']['id'])


def run_orm_integration(port, password, datadir, server_uuid, *, confirmations_available=True):
    from b1_mysql_disposable_trial import connect, ensure_own_server

    with connect(port, password, "centro_oftalmologico_db_v2") as connection:
        if ensure_own_server(connection, datadir, port) != server_uuid:
            raise RuntimeError("La instancia ORM no coincide con la instancia temporal verificada.")
    RealORMStrictIntegrationTests.config = (port, password)
    RealORMStrictIntegrationTests.own_datadir = datadir
    RealORMStrictIntegrationTests.own_server_uuid = server_uuid
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RealORMStrictIntegrationTests)
    if not confirmations_available:  # Ensayo histórico de 14 tablas, anterior a 28C.2.
        suite = unittest.TestSuite(test for test in suite
                                   if not test._testMethodName.startswith('test_28c_'))
    result = unittest.TestResult()  # No imprimir SQL, credenciales ni trazas con datos.
    suite.run(result)
    print(f"ORM/MySQL aislado: {result.testsRun} pruebas; "
          f"fallos={len(result.failures)}, errores={len(result.errors)}.")
    if not result.wasSuccessful():
        for test, traceback_text in result.failures + result.errors:
            lines = re.findall(r'b1_orm_mysql_trial\.py", line (\d+)', traceback_text)
            print(f"Falló caso de integración: {test.id()}; "
                  f"última línea del arnés={lines[-1] if lines else 'no disponible'}.")
        raise RuntimeError("La integración ORM/MySQL temporal detectó un fallo; no se activa B1.")
