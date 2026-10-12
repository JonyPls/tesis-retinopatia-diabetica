"""Integración B1 real contra el MySQL temporal verificado por el arnés.

No es una suite descubierta automáticamente: run_orm_integration se invoca
solo tras inicializar y comprobar la instancia desechable. No importa app.py.
"""

from contextlib import contextmanager
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import partial
import inspect as python_inspect
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time
from threading import Barrier
from types import ModuleType
import unittest
from unittest.mock import patch

from flask import Flask, jsonify, request
import jwt
from sqlalchemy import event, inspect
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError
from werkzeug.security import generate_password_hash

# database.py llama load_dotenv al importarse: impedir incluso su lectura.
with patch("dotenv.load_dotenv", return_value=False):
    from database import db
    from routes.auth_routes import auth_bp
    from routes.patient_routes import patient_bp
    from routes import patient_routes, files_routes
    from src.models.auth_entities import (Cargo, Permiso, Rol, RolPermiso,
                                          TipoDocumento, Usuario, UsuarioRol)
    from src.models.patient_entities import Paciente, VisitaClinica
    from src.repositories.patient_repository import PatientRepository
    from src.repositories.diagnosis_repository import DiagnosisRepository
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
        cls.context = cls.app.app_context()
        cls.context.push()
        cls.addClassCleanup(cls.context.pop)
        cls.addClassCleanup(db.session.remove)
        cls.app.register_blueprint(auth_bp)
        cls.app.register_blueprint(patient_bp)
        cls.app.register_blueprint(files_routes.files_bp)
        cls.app.register_blueprint(diagnosis_routes.diagnosis_bp)
        cls.image_directory = tempfile.TemporaryDirectory(
            prefix="b1-orm-images-", dir=r"C:\Users\ricar\AppData\Local\Temp\opencode")
        cls.addClassCleanup(cls.image_directory.cleanup)
        cls.image_directory_patch = patch.object(
            files_routes, "RETINAS_FOLDER", cls.image_directory.name)
        cls.image_directory_patch.start()
        cls.addClassCleanup(cls.image_directory_patch.stop)
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
            "nombres", "apellidos", "ultima_visita",
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
            "id", "tipo_doc_abrev", "nro_documento", "nombres", "apellidos", "ultima_visita",
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
                    self.assertEqual(set(response.json["data"][0]), expected)
                    for forbidden in ("Antecedente sintetico", "Alergia sintetica",
                                      "Conclusion sintetica", "Modelo sintetico", "synthetic-only.jpg",
                                      "Motivo sintetico", "Observacion sintetica"):
                        self.assertNotIn(forbidden, response.get_data(as_text=True))
                    if profile == "assistant":
                        self.assertNotIn("ultima_visita", response.get_data(as_text=True))
        # Orden clínico: visita sintética reciente. Orden administrativo: alta,
        # sin deducir cuándo hubo una visita.
        clinician, _ = self.call(recent, token=self.token())
        assistant, _ = self.call(recent, token=self.token("assistant"))
        self.assertEqual(clinician.json["data"][0]["id"], self.patient_ids[0])
        self.assertEqual(assistant.json["data"][0]["id"], self.patient_ids[1])
        self.assertIsNotNone(clinician.json["data"][0]["ultima_visita"])

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


def run_orm_integration(port, password, datadir, server_uuid):
    from b1_mysql_disposable_trial import connect, ensure_own_server

    with connect(port, password, "centro_oftalmologico_db_v2") as connection:
        if ensure_own_server(connection, datadir, port) != server_uuid:
            raise RuntimeError("La instancia ORM no coincide con la instancia temporal verificada.")
    RealORMStrictIntegrationTests.config = (port, password)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RealORMStrictIntegrationTests)
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
