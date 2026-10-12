"""Pruebas de autenticación con Flask aislado, sin app.py, BD ni modelos de IA."""

import datetime
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jwt
from flask import Flask, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash


sys.path.insert(0, str(Path(__file__).resolve().parent))

# El repositorio real se importa, pero su modelo se sustituye ANTES del import:
# no se carga database.py (que lee .env), no hay engine ni consultas externas.
fake_models = types.ModuleType("src.models.auth_entities")


class FakeUsuario:
    query = None


fake_models.Usuario = FakeUsuario
fake_database = types.ModuleType("database")
fake_database.db = SimpleNamespace()
fake_patient_service = types.ModuleType("services.patient_service")
for service_name in (
    "obtener_todos_pacientes", "registrar_nuevo_paciente", "obtener_detalle_paciente",
    "obtener_historial_diagnosticos", "buscar_pacientes_dinamico", "obtener_recientes",
):
    setattr(fake_patient_service, service_name, Mock())

# Importar rutas HTTP reales con sus servicios sustituidos antes de cargar
# cualquier dependencia de IA, PDF o directorio clínico.
fake_diagnosis_service = types.ModuleType("services.diagnosis_service")
fake_diagnosis_service.DIAGNOSIS_NOT_FOUND_MESSAGE = "Diagnóstico no encontrado."
for name in ("procesar_diagnostico", "confirmar_validacion_detalle",
             "consultar_detalles_existentes", "consultar_detalles_por_visita"):
    setattr(fake_diagnosis_service, name, Mock())
fake_retinograph_service = types.ModuleType("services.retinograph_import_service")
for name in ("obtener_archivo_retinografo", "obtener_seleccion_automatica"):
    setattr(fake_retinograph_service, name, Mock())
fake_report_service = types.ModuleType("services.report_service")
fake_report_service.ReportNotFoundError = type("ReportNotFoundError", (Exception,), {})
fake_report_service.ReportTemplateError = type("ReportTemplateError", (Exception,), {})
fake_report_service.generar_reporte_diagnostico_pdf = Mock()
fake_informe_service = types.ModuleType("services.informe_service")
for name in ("obtener_tipos", "crear_nuevo_informe", "obtener_informe",
             "actualizar_informe_existente", "eliminar_informe_existente",
             "obtener_informes_por_paciente", "consultar_informes_por_diagnostico",
             "consultar_informes_por_visita"):
    setattr(fake_informe_service, name, Mock())

with patch.dict(sys.modules, {
    "src.models.auth_entities": fake_models,
    "services.patient_service": fake_patient_service,
    "services.diagnosis_service": fake_diagnosis_service,
    "services.retinograph_import_service": fake_retinograph_service,
    "services.report_service": fake_report_service,
    "services.informe_service": fake_informe_service,
    "database": fake_database,
}):
    from routes.auth_routes import auth_bp
    from routes import patient_routes, files_routes, diagnosis_routes, informe_routes
    from services import auth_service
    from src.repositories.auth_repository import AuthRepository
    from utils import security
    from utils import strict_authorization


TEST_KEY = "isolated-tests-only-signing-key-for-hs256"
TEST_PASSWORD = "synthetic-password-for-tests"


class AuthSecurityTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"SECRET_KEY": TEST_KEY}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.user = SimpleNamespace(
            id=42,
            username="medico_ficticio",
            password_hash=generate_password_hash(TEST_PASSWORD, method="pbkdf2:sha256:1000"),
            nombres="NombreFicticio",
            apellidos="ApellidoFicticio",
            cargo=None,
            roles=["Médico"],
            permisos=["pacientes.ver"],
            estado="ACTIVO",
        )
        self.active = True

        def filter_by(**filters):
            user = (
                self.user
                if self.active
                and filters in (
                    {"username": self.user.username, "estado": "ACTIVO"},
                    {"id": self.user.id, "estado": "ACTIVO"},
                )
                else None
            )
            return SimpleNamespace(first=lambda: user)

        FakeUsuario.query = SimpleNamespace(filter_by=Mock(side_effect=filter_by))
        eager_lookup = patch.object(
            AuthRepository, "get_active_user_with_permissions_by_id",
            side_effect=lambda user_id: FakeUsuario.query.filter_by(
                id=user_id, estado="ACTIVO"
            ).first(),
        )
        eager_lookup.start()
        self.addCleanup(eager_lookup.stop)

        # Incluso cuando se evalúen permisos sin rol, jamás consultar modelos/BD.
        permissions = patch.object(security, "_load_permissions_from_db", return_value=set())
        permissions.start()
        self.addCleanup(permissions.stop)

        app = Flask(__name__)
        app.config.update(TESTING=True, SECRET_KEY=TEST_KEY)
        app.register_blueprint(auth_bp)
        app.register_blueprint(patient_routes.patient_bp)
        app.register_blueprint(files_routes.files_bp)
        app.register_blueprint(diagnosis_routes.diagnosis_bp)
        app.register_blueprint(informe_routes.informe_bp)

        self.search_service = Mock(return_value=({
            "success": True,
            "data": [{"id": 101, "tipo_doc_abrev": "DNI", "tipo_doc_id": 1,
                       "tipo_doc": "DNI", "nro_documento": "90000001",
                       "nombres": "Paciente", "apellidos": "Ficticio",
                       "ultima_visita": "2030-01-01", "antecedentes_clinicos": "dato-sintetico",
                       "alergias": "alergia-sintetica",
                       "diagnostico_ia": {"resultado_ia_id": 4},
                       "informes": [{"conclusion": "conclusion-sintetica"}]}],
            "pagination": {"page": 1, "per_page": 30, "total": 1, "has_more": False},
        }, 200))
        self.recent_service = Mock(return_value=({
            "success": True,
            "data": [{"id": 202, "tipo_doc_abrev": "DNI", "nro_documento": "90000002",
                       "nombres": "Paciente", "apellidos": "Ficticio",
                       "ultima_visita": "2030-01-01", "alergias": "alergia-sintetica",
                       "diagnostico_ia": {"resultado_ia_id": 4}}],
        }, 200))
        self.patient_row = {
            "id": 101, "tipo_doc_abrev": "DNI", "tipo_doc": "DNI",
            "tipo_doc_id": 1, "nro_documento": "90000001",
            "nombres": "Paciente", "apellidos": "Ficticio", "sexo": "F",
            "fecha_nacimiento": "2000-01-01", "telefono": "999999999",
            "correo": "ficticio@example.invalid", "direccion": "Dirección ficticia",
            "consentimiento_informado": 1, "fecha_consentimiento": "2030-01-01",
            "ultima_visita": "2030-02-02", "maxima_gravedad": 4,
            "antecedentes_clinicos": "antecedente secreto", "alergias": "alergia secreta",
            "diagnosticos": [{"resultado_ia": "secreto"}],
            "informes": [{"conclusion": "secreto"}],
            "imagenes": [{"url": "secreto"}],
        }
        self.list_service = Mock(return_value=({"success": True, "data": [self.patient_row]}, 200))
        self.detail_service = Mock(return_value=({"success": True, "data": self.patient_row}, 200))
        self.create_service = Mock(return_value=({
            "success": True, "message": "Paciente registrado correctamente",
            "data": self.patient_row,
        }, 201))
        self.history_service = Mock(return_value=({
            "success": True, "data": [{
                "visita_id": 301, "motivo_consulta": "Motivo sintético",
                "diagnostico_ia": {"detalles": [{"resultado_ia_id": 2,
                    "imagen_original_url": "synthetic-only.jpg"}]},
                "informes": [{"conclusion": "Informe sintético"}],
            }],
        }, 200))
        for name, fake in (("buscar_pacientes_dinamico", self.search_service),
                           ("obtener_recientes", self.recent_service),
                           ("obtener_todos_pacientes", self.list_service),
                           ("obtener_detalle_paciente", self.detail_service),
                           ("obtener_historial_diagnosticos", self.history_service),
                           ("registrar_nuevo_paciente", self.create_service)):
            patched = patch.object(patient_routes, name, fake)
            patched.start()
            self.addCleanup(patched.stop)

        @app.get("/api/_isolated_read")
        @security.token_required
        @security.clinical_access_required("pacientes.ver")
        def isolated_read():
            return jsonify({"success": True, "user_id": request.current_user["user_id"]})

        @app.delete("/api/_isolated_delete")
        @security.token_required
        @security.clinical_access_required("informes.eliminar")
        def isolated_delete():
            return jsonify({"success": True})

        # Sustitutos sin BD de operaciones clínicas; reproducen los decoradores
        # actuales, nunca importan los endpoints ni servicios de producción.
        @app.get("/api/_isolated_patient/<int:patient_id>")
        @security.token_required
        @security.clinical_access_required("pacientes.ver")
        def isolated_patient(patient_id):
            return jsonify({"patient_id": patient_id})

        @app.post("/api/_isolated_patient")
        @security.token_required
        @security.clinical_access_required("pacientes.crear", "pacientes.gestionar")
        def isolated_register_patient():
            return jsonify({"success": True}), 201

        @app.post("/api/_isolated_diagnosis")
        @security.token_required
        @security.clinical_access_required("diagnosticos.crear", "diagnosticos.gestionar")
        def isolated_diagnosis():
            return jsonify({"success": True}), 201

        @app.put("/api/_isolated_validate")
        @security.token_required
        @security.clinical_access_required("diagnosticos.validar", "diagnosticos.gestionar")
        def isolated_validate():
            return jsonify({"success": True})

        @app.get("/api/_isolated_history/<int:patient_id>")
        @security.token_required
        @security.clinical_access_required("pacientes.ver", "visitas.ver")
        def isolated_history(patient_id):
            return jsonify({"patient_id": patient_id})

        @app.get("/api/_isolated_pdf")
        @security.token_required
        @security.clinical_access_required("diagnosticos.ver")
        def isolated_pdf_access():
            return jsonify({"success": True})  # No se genera PDF ni se abren imagenes.

        @app.post("/api/_isolated_report_new_visit")
        @security.token_required
        @security.clinical_access_required("informes.crear", "informes.gestionar")
        def isolated_report_new_visit():
            return jsonify({"success": True}), 201  # No se crea ninguna visita.

        # Las rutas opt-in siguientes ejercitan SOLO el motor nuevo. No existe
        # lectura real de pacientes, informes, retinografias ni modelos IA.
        @app.get("/api/_strict_patient/<int:patient_id>")
        @strict_authorization.strict_authorization_required("patients.read")
        def strict_patient(patient_id):
            return jsonify({"patient_id": patient_id})

        @app.post("/api/_strict_patient")
        @strict_authorization.strict_authorization_required("patients.create")
        def strict_register_patient():
            return jsonify({"success": True}), 201

        @app.post("/api/_strict_diagnosis")
        @strict_authorization.strict_authorization_required("diagnosis.create")
        def strict_diagnosis():
            return jsonify({"success": True}), 201

        @app.put("/api/_strict_validate")
        @strict_authorization.strict_authorization_required("diagnosis.validate")
        def strict_validate():
            return jsonify({"success": True})

        @app.get("/api/_strict_history/<int:patient_id>")
        @strict_authorization.strict_authorization_required("history.full_read")
        def strict_history(patient_id):
            return jsonify({"patient_id": patient_id})

        @app.get("/api/_strict_pdf")
        @strict_authorization.strict_authorization_required("diagnosis.pdf_read")
        def strict_pdf():
            return jsonify({"success": True})  # Sin PDF ni imagenes.

        @app.post("/api/_strict_report")
        @strict_authorization.strict_authorization_required("reports.create")
        def strict_report():
            return jsonify({"success": True}), 201

        @app.post("/api/_strict_report_with_visit")
        @strict_authorization.strict_authorization_required("reports.create_with_visit")
        def strict_report_with_visit():
            return jsonify({"success": True}), 201

        self.report_resource_check = Mock(side_effect=lambda user, report_id: report_id == 123)

        @app.put("/api/_strict_report/<int:report_id>")
        @strict_authorization.strict_authorization_required(
            "reports.edit_own",
            resource_check=lambda user, report_id: self.report_resource_check(user, report_id),
        )
        def strict_edit_own_report(report_id):
            return jsonify({"success": True})

        @app.put("/api/_strict_report_unguarded")
        @strict_authorization.strict_authorization_required("reports.edit_own")
        def strict_unguarded_report():
            return jsonify({"success": True})

        @app.delete("/api/_strict_report/<int:report_id>")
        @strict_authorization.strict_authorization_required(
            "reports.inactivate", resource_check=lambda user, report_id: report_id == 123
        )
        def strict_inactivate_report(report_id):
            return jsonify({"success": True})

        @app.get("/api/_strict_configuration")
        @strict_authorization.strict_authorization_required("configuration.read")
        def strict_configuration():
            return jsonify({"success": True})

        @app.get("/api/_strict_unknown")
        @strict_authorization.strict_authorization_required("unknown.operation")
        def strict_unknown():
            return jsonify({"success": True})

        self.client = app.test_client()
        self.assertFalse("app" in sys.modules)
        self.assertFalse("database" in sys.modules)
        self.assertFalse("dl_model.inference" in sys.modules)
        self.assertFalse("dl_model.validator" in sys.modules)

    def token(self, *, roles=None, expires=True, key=TEST_KEY):
        claims = {"user_id": self.user.id, "username": self.user.username,
                  "roles": self.user.roles if roles is None else roles}
        if expires:
            claims["exp"] = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
        return jwt.encode(claims, key, algorithm="HS256")

    def headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    def set_role_grants(self, role_grants):
        """Relaciones ORM ficticias con procedencia explicita por rol."""
        visible_names = {
            "OFTALMOLOGO": "Oftalmologo",
            "ENFERMERO": "Enfermero",
            "ASISTENTE_ADMINISTRATIVO": "Asistente administrativo",
            "ADMINISTRADOR_SISTEMA": "Administrador del sistema",
            "GERENTE": "Gerente General",
        }
        self.user.roles_rel = []
        self.user.roles = []
        self.user.permisos = []
        roles = {}
        for code, permission_codes in role_grants.items():
            role = SimpleNamespace(
                codigo=code,
                estado="ACTIVO",
                permisos_rel=[SimpleNamespace(permiso=SimpleNamespace(codigo=p, estado="ACTIVO"))
                              for p in permission_codes],
            )
            self.user.roles_rel.append(SimpleNamespace(rol=role))
            self.user.roles.append(visible_names.get(code, code))
            self.user.permisos.extend(permission_codes)
            roles[code] = role
        return roles

    def test_cp_01_valid_credentials(self):
        result = self.client.post("/api/login", json={"username": self.user.username,
                                                        "password": TEST_PASSWORD})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json["success"])
        self.assertEqual(result.json["data"]["user"]["id"], self.user.id)
        self.assertNotIn("password_hash", result.json["data"]["user"])
        FakeUsuario.query.filter_by.assert_called_with(username=self.user.username, estado="ACTIVO")

    def test_cp_02_invalid_credentials(self):
        wrong = self.client.post("/api/login", json={"username": self.user.username,
                                                       "password": "incorrect-synthetic"})
        unknown = self.client.post("/api/login", json={"username": "otro_ficticio",
                                                         "password": TEST_PASSWORD})
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json["message"], unknown.json["message"])
        self.assertNotIn("data", wrong.json)

    def test_cp_03_signed_claims_and_expiration(self):
        result = self.client.post("/api/login", json={"username": self.user.username,
                                                        "password": TEST_PASSWORD})
        token = result.json["data"]["token"]
        claims = jwt.decode(token, TEST_KEY, algorithms=["HS256"])
        self.assertEqual(claims["user_id"], self.user.id)
        self.assertEqual(claims["roles"], self.user.roles)
        remaining = claims["exp"] - datetime.datetime.now(datetime.timezone.utc).timestamp()
        self.assertGreater(remaining, 23 * 3600)
        self.assertLessEqual(remaining, 24 * 3600)
        with self.assertRaises(jwt.InvalidSignatureError):
            jwt.decode(token, "different-synthetic-key-for-isolated-tests", algorithms=["HS256"])

    def test_cp_09_missing_token(self):
        result = self.client.get("/api/_isolated_read")
        self.assertEqual(result.status_code, 401)
        self.assertFalse(result.json["success"])

    def test_cp_10_tampered_token(self):
        original = self.token()
        header, payload, signature = original.split(".")
        tampered = ".".join((header, payload[:-1] + ("A" if payload[-1] != "A" else "B"), signature))
        for kind, token in (("different_key", self.token(key="other-signing-key-for-isolated-tests")),
                            ("modified_payload", tampered)):
            with self.subTest(kind=kind):
                result = self.client.get("/api/_isolated_read", headers=self.headers(token))
                self.assertEqual(result.status_code, 401)
                self.assertEqual(result.json["message"], "Token inválido.")

    def test_cp_11_valid_authorized_token(self):
        result = self.client.get("/api/_isolated_read", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["user_id"], self.user.id)

    def test_cp_12_synthetic_password_hash_verification_only(self):
        self.assertNotEqual(self.user.password_hash, TEST_PASSWORD)
        self.assertTrue(check_password_hash(self.user.password_hash, TEST_PASSWORD))
        self.assertFalse(check_password_hash(self.user.password_hash, "incorrect-synthetic"))
        # No se acredita aquí ningún proceso real de provisión de usuarios.

    def test_a1_inactive_user_cannot_log_in(self):
        self.active = False
        result = self.client.post("/api/login", json={"username": self.user.username,
                                                        "password": TEST_PASSWORD})
        self.assertEqual(result.status_code, 401)

    def test_a1_expired_token(self):
        claims = {"user_id": self.user.id, "roles": self.user.roles,
                  "exp": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)}
        token = jwt.encode(claims, TEST_KEY, algorithm="HS256")
        result = self.client.get("/api/_isolated_read", headers=self.headers(token))
        self.assertEqual(result.status_code, 401)
        self.assertEqual(result.json["message"], "Token expirado.")

    def test_a1_insufficient_authorization(self):
        self.user.roles = []
        self.user.permisos = []
        result = self.client.get("/api/_isolated_read", headers=self.headers(self.token(roles=[])))
        self.assertEqual(result.status_code, 403)

    def test_a1_roles_are_refreshed_after_token_issuance(self):
        old_token = self.token(roles=["Médico"])
        self.user.roles = []
        self.user.permisos = []
        result = self.client.get("/api/_isolated_read", headers=self.headers(old_token))
        self.assertEqual(result.status_code, 403)

    def test_a1_new_active_role_is_respected(self):
        old_token = self.token(roles=[])
        result = self.client.get("/api/_isolated_read", headers=self.headers(old_token))
        self.assertEqual(result.status_code, 200)

    def test_a1_stale_permissions_in_signed_token_are_not_trusted(self):
        self.user.roles = []
        self.user.permisos = []
        claims = {"user_id": self.user.id, "roles": [], "permisos": ["pacientes.ver"],
                  "permissions": ["pacientes.ver"],
                  "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)}
        token = jwt.encode(claims, TEST_KEY, algorithm="HS256")
        result = self.client.get("/api/_isolated_read", headers=self.headers(token))
        self.assertEqual(result.status_code, 403)

    def test_a1_missing_credentials_and_empty_json(self):
        for payload in ({}, {"username": self.user.username}, []):
            with self.subTest(payload=payload):
                result = self.client.post("/api/login", json=payload)
                self.assertEqual(result.status_code, 400)

    def test_a1_revoked_user_token_should_be_rejected(self):
        token = self.token()
        self.active = False
        result = self.client.get("/api/_isolated_read", headers=self.headers(token))
        self.assertEqual(result.status_code, 401)
        self.assertEqual(result.json["message"], "No autorizado.")
        FakeUsuario.query.filter_by.assert_called_with(id=self.user.id, estado="ACTIVO")

    def test_a1_token_without_exp_should_be_rejected(self):
        result = self.client.get("/api/_isolated_read", headers=self.headers(self.token(expires=False)))
        self.assertEqual(result.status_code, 401)
        self.assertEqual(result.json["message"], "Token inválido.")
        FakeUsuario.query.filter_by.assert_not_called()

    @unittest.expectedFailure  # Objetivo sujeto a política: separar lectura y eliminación.
    def test_a1_clinical_read_role_should_not_grant_delete(self):
        result = self.client.delete("/api/_isolated_delete", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)  # Actual: el rol clínico elude permiso específico.
        self.assertEqual(result.status_code, 403)  # Objetivo sujeto a política de permisos.

    def test_a1_query_token_on_clinical_route_should_be_rejected(self):
        token = self.token()
        result = self.client.get("/api/_isolated_read", query_string={"token": token})
        self.assertEqual(result.status_code, 401)
        self.assertFalse(result.json["success"])
        self.assertNotIn(token, result.get_data(as_text=True))
        FakeUsuario.query.filter_by.assert_not_called()

    def test_a1_all_protected_routes_reject_url_credentials_before_auth(self):
        self.set_role_grants({"OFTALMOLOGO": [
            "pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver",
            "informes.ver", "imagenes.ver",
        ]})
        valid = self.token()
        expired = jwt.encode({
            "user_id": self.user.id,
            "exp": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1),
        }, TEST_KEY, algorithm="HS256")
        cases = (
            ("valid", valid), ("expired", expired),
            ("tampered", self.token(key="invalid-query-only-signing-key")),
        )
        paths = (
            "/api/_isolated_read", "/api/_isolated_pdf",
            "/api/pacientes", "/api/pacientes/101/visitas",
            "/api/diagnosticar/visita/301/detalles",
            "/api/diagnosticar/diagnostico/401/detalles",
            "/uploads/retinas/synthetic-only.jpg",
        )
        for path in paths:
            for kind, query_token in cases:
                with self.subTest(path=path, kind=kind):
                    result = self.client.get(path, query_string={"token": query_token})
                    self.assertEqual(result.status_code, 401)
                    self.assertNotIn(query_token, result.get_data(as_text=True))
            for key in ("token", "TOKEN", "access_token", "jwt", "id_token"):
                with self.subTest(path=path, key=key):
                    result = self.client.get(path, query_string={key: expired},
                                             headers=self.headers(valid))
                    self.assertEqual(result.status_code, 401)
                    self.assertNotIn(expired, result.get_data(as_text=True))
            disguised = self.client.get(path, query_string={"q": ["paciente", valid]},
                                        headers=self.headers(valid))
            self.assertEqual(disguised.status_code, 401)
            self.assertNotIn(valid, disguised.get_data(as_text=True))
        FakeUsuario.query.filter_by.assert_not_called()
        self.list_service.assert_not_called()
        self.history_service.assert_not_called()

    def test_a1_bearer_works_for_b1_and_legacy_without_changing_permissions(self):
        roles = self.set_role_grants({"OFTALMOLOGO": [
            "pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver",
            "informes.ver", "imagenes.ver",
        ]})
        headers = self.headers(self.token())
        for path in ("/api/_isolated_read", "/api/_isolated_pdf", "/api/pacientes",
                     "/api/pacientes/101/visitas"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path, headers=headers).status_code, 200)
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/pacientes", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/api/pacientes/101/visitas",
                                         headers=headers).status_code, 403)
        self.active = False
        self.assertEqual(self.client.get("/api/_isolated_read", headers=headers).status_code, 401)

    def test_a1_real_legacy_retinograph_pdf_and_report_transport(self):
        token = self.token()
        headers = self.headers(token)
        approved = Path(r"C:\Users\ricar\AppData\Local\Temp\opencode")
        with tempfile.TemporaryDirectory(prefix="b1-transport-only-", dir=approved) as folder:
            Path(folder, "synthetic.jpg").write_bytes(b"\xff\xd8\xff\xd9")
            image = Mock(return_value=({"success": True, "directory": folder,
                                        "filename": "synthetic.jpg", "mimetype": "image/jpeg"}, 200))
            pdf = Mock(return_value=(b"%PDF-1.4\nsynthetic-only\n", "synthetic.pdf"))
            report = Mock(return_value=({"success": True, "data": {"id": 123}}, 200))
            with (patch.object(diagnosis_routes, "obtener_archivo_retinografo", image),
                  patch.object(diagnosis_routes, "generar_reporte_diagnostico_pdf", pdf),
                  patch.object(informe_routes, "obtener_informe", report)):
                targets = (
                    ("/api/diagnosticar/retinografo/imagen",
                     {"paciente_id": 101, "filename": "synthetic.jpg"}),
                    ("/api/visitas/123/reporte-diagnostico", {}),
                    ("/api/informes/123", {}),
                )
                for path, params in targets:
                    with self.subTest(path=path):
                        response = self.client.get(path, query_string=params, headers=headers)
                        self.assertEqual(response.status_code, 200)
                        if path.endswith("/imagen"):
                            self.assertEqual(response.mimetype, "image/jpeg")
                        elif "reporte-diagnostico" in path:
                            self.assertEqual(response.mimetype, "application/pdf")
                        response.close()
                        for sent_headers in (None, headers):
                            denied = self.client.get(path, query_string={**params, "token": token},
                                                     headers=sent_headers)
                            self.assertEqual(denied.status_code, 401)
                            self.assertNotIn(token, denied.get_data(as_text=True))
                image.assert_called_once_with(101, "synthetic.jpg")
                pdf.assert_called_once_with(123)
                report.assert_called_once_with(123)

    def test_b1_real_image_route_rejects_url_tokens_before_lookup(self):
        self.set_role_grants({"OFTALMOLOGO": ["imagenes.ver"]})
        path = "/uploads/retinas/synthetic-only.jpg"
        with patch.object(files_routes, "_retina_file_is_registered") as registered:
            for headers in (None, self.headers(self.token())):
                response = self.client.get(path, query_string={"token": self.token()}, headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn("synthetic-only.jpg", response.get_data(as_text=True))
            registered.assert_not_called()

    def test_b1_real_diagnosis_read_requires_both_clinical_grants(self):
        payload = {"success": True, "data": {"visita_id": 301, "diagnostico_id": 301,
                   "ojos": [{"ojo": "OD", "resultado_ia": 2, "diagnostico_final": 3,
                             "imagen_url": "synthetic-only.jpg"}]}}
        paths = (("/api/diagnosticar/visita/301/detalles", "consultar_detalles_por_visita"),
                 ("/api/diagnosticar/diagnostico/401/detalles", "consultar_detalles_existentes"))
        token = self.token(roles=["Administrador del sistema"])
        headers = self.headers(token)
        for path, service_name in paths:
            with self.subTest(path=path), patch.object(diagnosis_routes, service_name,
                                                        return_value=payload) as service:
                roles = self.set_role_grants({"OFTALMOLOGO": [
                    "diagnostico_retinopatia.ver", "imagenes.ver",
                ]})
                allowed = self.client.get(path, headers=headers)
                self.assertEqual(allowed.status_code, 200)
                self.assertEqual(allowed.json, payload)
                service.assert_called_once()
                for grants in (
                    {"OFTALMOLOGO": ["imagenes.ver"]},
                    {"OFTALMOLOGO": ["diagnostico_retinopatia.ver"]},
                    {"ADMINISTRADOR_SISTEMA": ["diagnostico_retinopatia.ver", "imagenes.ver"]},
                    {"ASISTENTE_ADMINISTRATIVO": ["diagnostico_retinopatia.ver", "imagenes.ver"]},
                    {"ENFERMERO": ["diagnostico_retinopatia.ver", "imagenes.ver"]},
                    {"ADMINISTRADOR_SISTEMA": ["diagnostico_retinopatia.ver", "imagenes.ver"],
                     "OFTALMOLOGO": []},
                    {"ADMINISTRADOR_SISTEMA": ["imagenes.ver"],
                     "OFTALMOLOGO": ["diagnostico_retinopatia.ver"]},
                ):
                    self.set_role_grants(grants)
                    denied = self.client.get(path, headers=headers)
                    self.assertEqual(denied.status_code, 403)
                    self.assertNotIn("data", denied.json)
                    service.assert_called_once()
                roles = self.set_role_grants({"OFTALMOLOGO": [
                    "diagnostico_retinopatia.ver", "imagenes.ver",
                ]})
                roles["OFTALMOLOGO"].permisos_rel[1].permiso.estado = "INACTIVO"
                self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                roles["OFTALMOLOGO"].permisos_rel[1].permiso.estado = "ACTIVO"
                self.assertEqual(self.client.get(path, headers=headers).status_code, 200)
                roles["OFTALMOLOGO"].estado = "INACTIVO"
                self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                service.assert_called_with(301 if "visita/" in path else 401)

    def test_b1_real_diagnosis_read_auth_errors_not_found_and_service_failure(self):
        self.set_role_grants({"OFTALMOLOGO": [
            "diagnostico_retinopatia.ver", "imagenes.ver",
        ]})
        path = "/api/diagnosticar/visita/301/detalles"
        with patch.object(diagnosis_routes, "consultar_detalles_por_visita") as service:
            for token in (None, self.token(key="invalid-diagnosis-only-signing-key"),
                          self.token(expires=False)):
                denied = self.client.get(path, headers=self.headers(token) if token else None)
                self.assertEqual(denied.status_code, 401)
            self.active = False
            self.assertEqual(self.client.get(path, headers=self.headers(self.token())).status_code, 401)
            self.active = True
            service.assert_not_called()
            service.return_value = {"success": False, "message": "Diagnóstico no encontrado."}
            missing = self.client.get(path, headers=self.headers(self.token()))
            self.assertEqual(missing.status_code, 404)
            self.assertEqual(missing.json["message"], "Diagnóstico no encontrado.")
            service.return_value = {"success": False, "message": "No se pudo procesar la solicitud."}
            self.assertEqual(self.client.get(path, headers=self.headers(self.token())).status_code, 500)

    def test_b1_real_validation_route_authorization_and_payload(self):
        path = "/api/diagnosticar/detalle/431/validar"
        payload = {"diagnostico_final": 3, "motivo_correccion": "Nota sintética"}
        service = Mock(return_value=({"success": True, "data": {"estado_validacion": "CORREGIDO"},
                                      "message": "Diagnóstico validado y guardado exitosamente."}, 200))
        with patch.object(diagnosis_routes, "confirmar_validacion_detalle", service):
            roles = self.set_role_grants({"OFTALMOLOGO": ["diagnostico_retinopatia.validar"]})
            token = self.token()
            for invalid in (None, self.token(key="wrong-only-synthetic-key"),
                            self.token(expires=False)):
                result = self.client.put(path, json=payload,
                                         headers=self.headers(invalid) if invalid else None)
                self.assertEqual(result.status_code, 401)
            self.active = False
            self.assertEqual(self.client.put(path, json=payload, headers=self.headers(token)).status_code, 401)
            self.active = True
            for grants in ({"OFTALMOLOGO": []},
                           {"ADMINISTRADOR_SISTEMA": ["diagnostico_retinopatia.validar"]},
                           {"ENFERMERO": ["diagnostico_retinopatia.validar"]},
                           {"ASISTENTE_ADMINISTRATIVO": ["diagnostico_retinopatia.validar"]},
                           {"ADMINISTRADOR_SISTEMA": ["diagnostico_retinopatia.validar"], "OFTALMOLOGO": []}):
                self.set_role_grants(grants)
                self.assertEqual(self.client.put(path, json=payload, headers=self.headers(token)).status_code, 403)
            roles = self.set_role_grants({"OFTALMOLOGO": ["diagnostico_retinopatia.validar"]})
            for forbidden in ({"resultado_ia_id": 0}, {"validado_por": 42},
                              {"fecha_validacion": "2030-01-01"}, {"ojo_evaluado": "Derecho"}):
                self.assertEqual(self.client.put(path, json={**payload, **forbidden},
                                                 headers=self.headers(token)).status_code, 400)
            for invalid_grade in (-1, 5, "2", True, 1.5):
                self.assertEqual(self.client.put(path, json={"diagnostico_final": invalid_grade},
                                                 headers=self.headers(token)).status_code, 400)
            service.assert_not_called()
            response = self.client.put(path, json=payload, headers=self.headers(token))
            self.assertEqual(response.status_code, 200)
            service.assert_called_once_with(detalle_id=431, diagnostico_final=3,
                                            comentario_medico=None,
                                            motivo_correccion="Nota sintética", usuario_id=self.user.id)
            roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "INACTIVO"
            self.assertEqual(self.client.put(path, json=payload, headers=self.headers(token)).status_code, 403)
            self.set_role_grants({"ADMINISTRADOR_SISTEMA": [],
                                  "OFTALMOLOGO": ["diagnostico_retinopatia.validar"]})
            self.assertEqual(self.client.put(path, json=payload, headers=self.headers(token)).status_code, 200)
            for query in ("?token=" + token, "?access_token=" + token):
                self.assertEqual(self.client.put(path + query, json=payload,
                                                 headers=self.headers(token)).status_code, 401)

    def test_b1_real_image_route_role_and_resource_protection(self):
        approved = Path(r"C:\Users\ricar\AppData\Local\Temp\opencode")
        with tempfile.TemporaryDirectory(prefix="b1-image-isolated-", dir=approved) as folder:
            Path(folder, "synthetic-only.jpg").write_bytes(b"\xff\xd8\xff\xd9")
            with patch.object(files_routes, "RETINAS_FOLDER", folder):
                path = "/uploads/retinas/synthetic-only.jpg"
                self.set_role_grants({"OFTALMOLOGO": ["imagenes.ver"]})
                headers = self.headers(self.token(roles=["Administrador del sistema"]))
                with patch.object(files_routes, "_retina_file_is_registered", return_value=True) as registered:
                    result = self.client.get(path, headers=headers)
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(result.mimetype, "image/jpeg")
                    self.assertEqual(result.headers["Cache-Control"], "private, no-store")
                    self.assertEqual(result.headers["X-Content-Type-Options"], "nosniff")
                    result.close()
                    registered.assert_called_once_with("synthetic-only.jpg")
                    for role_grants in ({"ADMINISTRADOR_SISTEMA": ["imagenes.ver"]},
                                        {"ASISTENTE_ADMINISTRATIVO": ["imagenes.ver"]},
                                        {"ENFERMERO": []},
                                        {"ADMINISTRADOR_SISTEMA": ["imagenes.ver"],
                                         "OFTALMOLOGO": []}):
                        self.set_role_grants(role_grants)
                        self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                    registered.assert_called_once()

                    self.set_role_grants({"OFTALMOLOGO": ["imagenes.ver"]})
                    for token in (None, self.token(key="wrong-synthetic-key"),
                                  self.token(expires=False)):
                        response = self.client.get(path, headers=self.headers(token) if token else None)
                        self.assertEqual(response.status_code, 401)
                    self.active = False
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 401)
                    self.active = True
                    registered.assert_called_once()

                    role = self.user.roles_rel[0].rol
                    role.permisos_rel[0].permiso.estado = "INACTIVO"
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                    role.permisos_rel[0].permiso.estado = "ACTIVO"
                    authorized_again = self.client.get(path, headers=headers)
                    self.assertEqual(authorized_again.status_code, 200)
                    authorized_again.close()

                with patch.object(files_routes, "_retina_file_is_registered", return_value=False):
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 404)
                for name in ("missing.jpg", "synthetic-only.exe", "..%5csynthetic-only.jpg"):
                    self.assertEqual(self.client.get(f"/uploads/retinas/{name}",
                                                     headers=headers).status_code, 404)

    def test_a1_non_object_json_should_be_rejected_as_bad_request(self):
        for payload in (["unexpected"], "unexpected", 1, True, None):
            with self.subTest(type=type(payload).__name__):
                result = self.client.post("/api/login", json=payload)
                self.assertEqual(result.status_code, 400)
                self.assertFalse(result.json["success"])
                self.assertNotIn("data", result.json)

        malformed = self.client.post("/api/login", data="{invalid", content_type="application/json")
        self.assertEqual(malformed.status_code, 400)
        self.assertFalse(malformed.json["success"])

        for payload in ({"username": [self.user.username], "password": TEST_PASSWORD},
                        {"username": self.user.username, "password": {"unexpected": True}}):
            with self.subTest(field_type="invalid_credentials"):
                result = self.client.post("/api/login", json=payload)
                self.assertEqual(result.status_code, 400)
                self.assertFalse(result.json["success"])
        FakeUsuario.query.filter_by.assert_not_called()

    def test_a1_account_lookup_error_fails_closed_without_internal_details(self):
        FakeUsuario.query.filter_by.side_effect = RuntimeError("synthetic lookup failure")
        with patch.object(self.client.application, "logger"):
            result = self.client.get("/api/_isolated_read", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 500)
        self.assertEqual(result.json, {"success": False, "message": "No se pudo procesar la solicitud."})

    # B1: política objetivo documentada en backend/docs/autorizacion-b1-catalogo-y-matriz.md.
    # Los fallos esperados NO implican aceptación del acceso permisivo actual.

    def test_b1_oftalmologist_reads_two_shared_synthetic_patients(self):
        self.user.roles = ["Oftalmologo"]
        for patient_id in (101, 202):
            with self.subTest(patient_id=patient_id):
                result = self.client.get(f"/api/_isolated_patient/{patient_id}",
                                         headers=self.headers(self.token()))
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json["patient_id"], patient_id)

    def test_b1_nurse_with_create_permission_can_register_synthetically(self):
        self.user.roles = ["Enfermero"]
        self.user.permisos = ["pacientes.crear"]
        result = self.client.post("/api/_isolated_patient", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 201)

    def test_b1_nurse_without_create_permission_cannot_register(self):
        self.user.roles = ["Enfermero"]
        self.user.permisos = ["pacientes.ver"]
        result = self.client.post("/api/_isolated_patient", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_nurse_cannot_medically_validate_with_canonical_code(self):
        self.user.roles = ["Enfermero"]
        self.user.permisos = ["diagnostico_retinopatia.validar"]
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_oftalmologist_with_canonical_code_can_create_diagnosis(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["diagnostico_retinopatia.crear"]
        result = self.client.post("/api/_isolated_diagnosis", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 201)

    def test_b1_enabled_ophthalmologist_with_canonical_code_can_validate(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["diagnostico_retinopatia.validar"]
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)

    @unittest.expectedFailure  # Actual: el rol Oftalmologo pasa sin pacientes.ver.
    def test_b1_clinical_role_without_patient_read_permission_is_denied(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = []
        result = self.client.get("/api/_isolated_patient/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: el rol Oftalmologo elude permiso de crear IA.
    def test_b1_oftalmologist_without_diagnosis_create_permission_is_denied(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = []
        result = self.client.post("/api/_isolated_diagnosis", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: Medico es rol clinico, aunque no sea Oftalmologo.
    def test_b1_validation_requires_medically_enabled_ophthalmologist(self):
        self.user.roles = ["Médico"]
        self.user.permisos = ["diagnostico_retinopatia.validar"]
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: administrador elude permisos medicos.
    def test_b1_administrator_has_no_automatic_medical_validation(self):
        self.user.roles = ["Administrador del sistema"]
        self.user.permisos = []
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: Gerente General esta en ADMIN_ROLES.
    def test_b1_manager_has_no_automatic_clinical_access(self):
        self.user.roles = ["Gerente General"]
        self.user.permisos = []
        result = self.client.get("/api/_isolated_patient/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: ambos roles eluden diagnostico_retinopatia.validar.
    def test_b1_multiple_roles_without_medical_validation_permission_are_denied(self):
        self.user.roles = ["Administrador del sistema", "Oftalmologo"]
        self.user.permisos = []
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: clinico.ver coincide con clinico.* requerido.
    def test_b1_general_read_permission_cannot_bypass_delete(self):
        self.user.roles = ["Enfermero"]
        self.user.permisos = ["clinico.ver"]
        result = self.client.delete("/api/_isolated_delete", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: el rol clinico elude informes.inactivar.
    def test_b1_report_read_permission_does_not_authorize_inactivation(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["informes.ver"]
        result = self.client.delete("/api/_isolated_delete", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: permiso retirado no afecta al bypass por rol.
    def test_b1_permission_revocation_with_issued_jwt_is_enforced(self):
        self.user.roles = ["Oftalmologo"]
        issued_token = self.token()
        self.user.permisos = []
        result = self.client.get("/api/_isolated_patient/101", headers=self.headers(issued_token))
        self.assertEqual(result.status_code, 403)

    def test_b1_proposed_migration_has_no_grants_or_destructive_ddl(self):
        sql = (Path(__file__).resolve().parent / "migrations" /
               "b1_catalogo_permisos_propuesta.sql").read_text(encoding="utf-8")
        statements = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
        self.assertEqual(statements.count("INSERT INTO `permisos`"), 3)
        self.assertNotIn("INSERT INTO `rol_permiso`", statements)
        self.assertNotIn("INSERT INTO `usuario_rol`", statements)
        self.assertNotIn("DROP TABLE", statements.upper())
        self.assertNotIn("ALTER TABLE", statements.upper())

    def test_b1_admin_plus_ophthalmologist_retains_clinical_validation(self):
        self.user.roles = ["Administrador del sistema", "Oftalmologo"]
        self.user.permisos = ["diagnostico_retinopatia.validar"]
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)
        # La procedencia desde el rol medico necesita una prueba con grants ORM.

    @unittest.expectedFailure  # Actual: ADMIN_ROLES autoriza crear IA sin habilitacion clinica.
    def test_b1_admin_with_admin_permissions_cannot_create_diagnosis(self):
        self.user.roles = ["Administrador del sistema"]
        self.user.permisos = ["usuarios.crear", "configuracion.ver"]
        result = self.client.post("/api/_isolated_diagnosis", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_assistant_after_grant_removal_can_register_patient_not_report(self):
        self.user.roles = ["Asistente administrativo"]
        self.user.permisos = ["pacientes.ver", "pacientes.crear", "pacientes.editar",
                              "visitas.ver", "informes.ver"]
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/_isolated_patient", headers=headers).status_code, 201)
        self.assertEqual(self.client.post("/api/_isolated_report_new_visit",
                                          headers=headers).status_code, 403)

    @unittest.expectedFailure  # Actual: el permiso solo elude rol asistencial.
    def test_b1_assistant_cannot_create_report_even_if_stale_grant_exists(self):
        self.user.roles = ["Asistente administrativo"]
        self.user.permisos = ["informes.crear"]
        result = self.client.post("/api/_isolated_report_new_visit",
                                  headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: diagnosticos.validar basta sin rol medico.
    def test_b1_assistant_cannot_validate_even_with_legacy_grant(self):
        self.user.roles = ["Asistente administrativo"]
        self.user.permisos = ["diagnosticos.validar"]
        result = self.client.put("/api/_isolated_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_nurse_assistance_does_not_include_creating_ia(self):
        self.user.roles = ["Enfermero"]
        self.user.permisos = ["pacientes.ver", "pacientes.crear", "visitas.crear"]
        result = self.client.post("/api/_isolated_diagnosis", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_ophthalmologist_with_complete_reading_can_open_shared_views(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["pacientes.ver", "visitas.ver", "informes.ver",
                              "diagnostico_retinopatia.ver", "imagenes.ver"]
        headers = self.headers(self.token())
        for patient_id in (101, 202):
            with self.subTest(patient_id=patient_id):
                result = self.client.get(f"/api/_isolated_history/{patient_id}", headers=headers)
                self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get("/api/_isolated_pdf", headers=headers).status_code, 200)

    @unittest.expectedFailure  # Actual: el historial compuesto solo pide uno de los codigos antiguos.
    def test_b1_history_requires_report_reading_for_full_response(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver"]
        result = self.client.get("/api/_isolated_history/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    @unittest.expectedFailure  # Actual: PDF no exige imagenes.ver.
    def test_b1_pdf_with_images_requires_image_reading(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["pacientes.ver", "diagnostico_retinopatia.ver"]
        result = self.client.get("/api/_isolated_pdf", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_indirect_visit_with_visit_creation_permission_keeps_access(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["informes.crear", "visitas.crear"]
        result = self.client.post("/api/_isolated_report_new_visit",
                                  headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 201)

    @unittest.expectedFailure  # Objetivo sujeto a decision: POST informes sin visita crea una visita.
    def test_b1_indirect_visit_without_visit_create_permission_is_denied(self):
        self.user.roles = ["Oftalmologo"]
        self.user.permisos = ["informes.crear"]
        result = self.client.post("/api/_isolated_report_new_visit",
                                  headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_b1_grants_proposal_only_changes_identified_role_links(self):
        sql = (Path(__file__).resolve().parent / "migrations" /
               "b1_grants_roles_propuesta.sql").read_text(encoding="utf-8")
        statements = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
        mutations = statements.split("START TRANSACTION;", 1)[1].split("COMMIT;", 1)[0]
        self.assertEqual(statements.count("DELETE rp FROM `rol_permiso`"), 2)
        self.assertEqual(statements.count("INSERT INTO `rol_permiso`"), 1)
        self.assertIn("@b1_grants_ready = 1", statements)
        self.assertIn("NOT EXISTS", statements)
        self.assertIn("CREATE TEMPORARY TABLE IF NOT EXISTS `_b1_grants_guard`", statements)
        self.assertIn("CHECK (`ready` = 1)", statements)
        for role_code in ("ADMINISTRADOR_SISTEMA", "ASISTENTE_ADMINISTRATIVO", "OFTALMOLOGO"):
            self.assertIn(f"r.`codigo` = '{role_code}'", mutations)
        self.assertNotIn("r.`codigo` = 'ENFERMERO'", mutations)
        self.assertNotIn("r.`codigo` = 'GERENTE'", mutations)
        self.assertNotIn("INSERT INTO `usuario_rol`", statements)
        self.assertNotIn("INSERT INTO `usuarios`", statements)
        self.assertNotIn("DROP TABLE", statements.upper())
        self.assertNotIn("ALTER TABLE", statements.upper())

    # Motor B1 nuevo: estas pruebas NO convierten los expectedFailure anteriores.

    def test_strict_invalid_jwt_or_inactive_account_is_rejected(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        wrong_key = self.client.get("/api/_strict_patient/101",
                                    headers=self.headers(self.token(key="different-synthetic-key-for-isolated-tests")))
        self.assertEqual(wrong_key.status_code, 401)
        issued = self.token()
        self.active = False
        inactive = self.client.get("/api/_strict_patient/101", headers=self.headers(issued))
        self.assertEqual(inactive.status_code, 401)

    def test_strict_active_account_and_role_without_permission_is_denied(self):
        self.set_role_grants({"OFTALMOLOGO": []})
        result = self.client.get("/api/_strict_patient/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_strict_permission_from_unqualified_role_is_denied(self):
        self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["pacientes.ver"]})
        result = self.client.get("/api/_strict_patient/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 403)

    def test_strict_ophthalmologist_with_create_permission_can_process_ia(self):
        self.set_role_grants({"OFTALMOLOGO": ["diagnostico_retinopatia.crear"]})
        result = self.client.post("/api/_strict_diagnosis", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 201)

    def test_strict_reading_does_not_grant_inactivation_or_creation(self):
        self.set_role_grants({"OFTALMOLOGO": ["informes.ver", "diagnostico_retinopatia.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.delete("/api/_strict_report/123", headers=headers).status_code, 403)
        self.assertEqual(self.client.post("/api/_strict_diagnosis", headers=headers).status_code, 403)

    def test_strict_nurse_can_create_patient_but_not_medically_validate(self):
        self.set_role_grants({"ENFERMERO": ["pacientes.crear", "diagnostico_retinopatia.validar"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/_strict_patient", headers=headers).status_code, 201)
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 403)

    def test_strict_assistant_cannot_create_reports_despite_inherited_grant(self):
        self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["informes.crear", "pacientes.crear"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/_strict_patient", headers=headers).status_code, 201)
        self.assertEqual(self.client.post("/api/_strict_report", headers=headers).status_code, 403)

    def test_strict_administrator_not_automatically_clinical(self):
        self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["configuracion.ver",
                                                    "diagnostico_retinopatia.validar"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_configuration", headers=headers).status_code, 200)
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 403)

    def test_strict_manager_without_clinical_role_is_denied(self):
        self.set_role_grants({"GERENTE": ["pacientes.ver", "diagnostico_retinopatia.validar"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 403)
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 403)

    def test_strict_medical_validation_requires_ophthalmologist_role_and_grant(self):
        self.set_role_grants({"OFTALMOLOGO": ["diagnostico_retinopatia.validar"]})
        result = self.client.put("/api/_strict_validate", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)

    def test_strict_admin_plus_ophthalmologist_requires_clinical_grant_source(self):
        roles = self.set_role_grants({
            "ADMINISTRADOR_SISTEMA": ["diagnostico_retinopatia.validar"],
            "OFTALMOLOGO": [],
        })
        headers = self.headers(self.token())
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="diagnostico_retinopatia.validar",
                                                    estado="ACTIVO"))
        )
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 200)

    def test_strict_generic_and_wildcard_permissions_do_not_bypass_policy(self):
        self.set_role_grants({"OFTALMOLOGO": ["clinico.ver", "clinico.*", "clinico.gestionar",
                                              "diagnostico_retinopatia.*"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/_strict_diagnosis", headers=headers).status_code, 403)
        self.assertEqual(self.client.put("/api/_strict_validate", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 403)

    def test_strict_withdrawal_or_inactivation_is_effective_on_next_request(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 200)
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "ACTIVO"
        roles["OFTALMOLOGO"].estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 403)

    def test_strict_full_history_requires_every_reading_permission(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver", "visitas.ver",
                                                     "diagnostico_retinopatia.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_history/101", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="informes.ver", estado="ACTIVO"))
        )
        self.assertEqual(self.client.get("/api/_strict_history/101", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="imagenes.ver", estado="ACTIVO"))
        )
        self.assertEqual(self.client.get("/api/_strict_history/101", headers=headers).status_code, 200)

    def test_strict_pdf_requires_image_reading(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver",
                                                     "diagnostico_retinopatia.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_pdf", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="imagenes.ver", estado="ACTIVO"))
        )
        self.assertEqual(self.client.get("/api/_strict_pdf", headers=headers).status_code, 200)

    def test_strict_ophthalmologist_reads_any_shared_synthetic_patient(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        for patient_id in (101, 202):
            with self.subTest(patient_id=patient_id):
                result = self.client.get(f"/api/_strict_patient/{patient_id}", headers=headers)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json["patient_id"], patient_id)

    def test_strict_report_operations_are_distinct_and_resource_check_required(self):
        self.set_role_grants({"OFTALMOLOGO": ["informes.editar", "informes.anular"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.put("/api/_strict_report_unguarded", headers=headers).status_code, 403)
        self.assertEqual(self.client.put("/api/_strict_report/124", headers=headers).status_code, 403)
        self.assertEqual(self.client.put("/api/_strict_report/123", headers=headers).status_code, 200)
        self.assertEqual(self.client.delete("/api/_strict_report/123", headers=headers).status_code, 403)

    def test_strict_denied_user_does_not_trigger_resource_lookup(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["informes.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.put("/api/_strict_report/123", headers=headers).status_code, 403)
        self.report_resource_check.assert_not_called()
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="informes.editar", estado="ACTIVO"))
        )
        self.assertEqual(self.client.put("/api/_strict_report/123", headers=headers).status_code, 200)
        self.report_resource_check.assert_called_once()

    def test_strict_reuses_one_eager_user_load_per_request(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        eager_lookup = AuthRepository.get_active_user_with_permissions_by_id
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 200)
        self.assertEqual(eager_lookup.call_count, 1)
        self.user.roles_rel[0].rol.permisos_rel[0].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/_strict_patient/101", headers=headers).status_code, 403)
        self.assertEqual(eager_lookup.call_count, 2)

    def test_legacy_token_required_keeps_its_default_loader(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        result = self.client.get("/api/_isolated_patient/101", headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 200)
        AuthRepository.get_active_user_with_permissions_by_id.assert_not_called()

    def test_strict_report_creation_with_visit_requires_both_permissions(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["informes.crear"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/_strict_report_with_visit",
                                          headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="visitas.crear", estado="ACTIVO"))
        )
        self.assertEqual(self.client.post("/api/_strict_report_with_visit",
                                          headers=headers).status_code, 201)

    def test_strict_unconfigured_operation_is_denied(self):
        self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["configuracion.ver", "clinico.*"]})
        self.assertEqual(self.client.get("/api/_strict_unknown",
                                         headers=self.headers(self.token())).status_code, 403)
        self.assertFalse(strict_authorization.evaluate_operation(self.user, "reports.edit_other"))

    def test_strict_explicit_alternatives_never_replace_required_permissions(self):
        self.set_role_grants({"OFTALMOLOGO": ["informes.ver"]})
        rule = strict_authorization.OperationRule(
            domain="assistance", role_codes=frozenset({"OFTALMOLOGO"}),
            all_of=frozenset({"pacientes.ver"}),
            any_of=frozenset({"informes.ver", "imagenes.ver"}),
        )
        self.assertFalse(strict_authorization.evaluate_rule(self.user, rule))
        self.user.roles_rel[0].rol.permisos_rel.append(
            SimpleNamespace(permiso=SimpleNamespace(codigo="pacientes.ver", estado="ACTIVO"))
        )
        self.assertTrue(strict_authorization.evaluate_rule(self.user, rule))

    # Blueprint REAL de pacientes, pero servicios HTTP aislados de toda BD.
    def test_real_patient_search_and_recent_reject_invalid_or_missing_jwt(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        invalid_tokens = (None, self.token(key="different-synthetic-key-for-isolated-tests"),
                          self.token(expires=False),
                          jwt.encode({"user_id": self.user.id, "roles": self.user.roles,
                                      "exp": datetime.datetime.now(datetime.timezone.utc)
                                      - datetime.timedelta(minutes=1)}, TEST_KEY, algorithm="HS256"))
        for path in ("/api/pacientes/buscar?q=Pa", "/api/pacientes/recientes"):
            for token in invalid_tokens:
                with self.subTest(path=path, has_token=token is not None):
                    headers = self.headers(token) if token else None
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 401)
        self.search_service.assert_not_called()
        self.recent_service.assert_not_called()

    def test_real_patient_routes_reject_inactive_account_before_handler(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        token = self.token()
        self.active = False
        for path in ("/api/pacientes/buscar?q=Pa", "/api/pacientes/recientes"):
            self.assertEqual(self.client.get(path, headers=self.headers(token)).status_code, 401)
        self.search_service.assert_not_called()
        self.recent_service.assert_not_called()

    def test_real_patient_routes_accept_only_enabled_roles_with_patient_reading(self):
        for grants in ({"OFTALMOLOGO": ["pacientes.ver"]},
                       {"ENFERMERO": ["pacientes.ver"]},
                       {"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"]},
                       {"ADMINISTRADOR_SISTEMA": ["pacientes.ver"],
                        "OFTALMOLOGO": ["pacientes.ver"]}):
            with self.subTest(roles=tuple(grants)):
                self.set_role_grants(grants)
                headers = self.headers(self.token())
                self.assertEqual(self.client.get("/api/pacientes/buscar?q=Pa",
                                                 headers=headers).status_code, 200)
                self.assertEqual(self.client.get("/api/pacientes/recientes",
                                                 headers=headers).status_code, 200)

    def test_real_patient_routes_deny_role_only_permission_only_admin_and_wildcard(self):
        for grants in ({"OFTALMOLOGO": []},
                       {"ADMINISTRADOR_SISTEMA": ["pacientes.ver"]},
                       {"ADMINISTRADOR_SISTEMA": ["pacientes.ver"], "OFTALMOLOGO": []},
                       {"ENFERMERO": ["clinico.*", "clinico.ver"]},
                       {"GERENTE": ["pacientes.ver"]}):
            with self.subTest(roles=tuple(grants)):
                self.set_role_grants(grants)
                headers = self.headers(self.token())
                self.assertEqual(self.client.get("/api/pacientes/buscar?q=Pa",
                                                 headers=headers).status_code, 403)
                self.assertEqual(self.client.get("/api/pacientes/recientes",
                                                 headers=headers).status_code, 403)
        self.search_service.assert_not_called()
        self.recent_service.assert_not_called()

    def test_real_patient_routes_use_current_role_and_permission_on_next_request(self):
        roles = self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.get("/api/pacientes/recientes", headers=headers).status_code, 200)
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/pacientes/recientes", headers=headers).status_code, 403)
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "ACTIVO"
        roles["OFTALMOLOGO"].estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/pacientes/buscar?q=Pa", headers=headers).status_code, 403)
        self.search_service.assert_not_called()
        self.assertEqual(self.recent_service.call_count, 1)

    def test_real_patient_routes_preserve_search_recent_json_and_query_parameters(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        search = self.client.get("/api/pacientes/buscar?q=Pa&page=0&per_page=99", headers=headers)
        self.assertEqual(search.status_code, 200)
        self.assertEqual(set(search.json), {"success", "data", "pagination"})
        self.assertEqual(search.json["data"][0]["id"], 101)
        self.search_service.assert_called_once_with("Pa", 1, 30, include_last_visit=True)

        short_query = self.client.get("/api/pacientes/buscar?q=P&page=2&per_page=2",
                                      headers=headers)
        self.assertEqual(short_query.status_code, 200)
        self.assertEqual(short_query.json["data"], [])
        self.assertEqual(short_query.json["pagination"]["page"], 2)
        self.assertEqual(short_query.json["pagination"]["per_page"], 2)
        self.search_service.assert_called_once()

        recent = self.client.get("/api/pacientes/recientes?limit=99", headers=headers)
        self.assertEqual(recent.status_code, 200)
        self.assertEqual(set(recent.json), {"success", "data"})
        self.assertEqual(recent.json["data"][0]["id"], 202)
        self.recent_service.assert_called_once_with(30, include_last_visit=True)
        self.assertEqual(AuthRepository.get_active_user_with_permissions_by_id.call_count, 3)

    def test_real_patient_routes_project_each_scope_and_drop_nested_clinical_data(self):
        search_fields = {"id", "tipo_doc_abrev", "tipo_doc_id", "tipo_doc",
                         "nro_documento", "nombres", "apellidos"}
        recent_fields = {"id", "tipo_doc_abrev", "nro_documento", "nombres", "apellidos"}
        for role, scope in (("OFTALMOLOGO", "clinical"), ("ENFERMERO", "assistance"),
                            ("ASISTENTE_ADMINISTRATIVO", "administrative")):
            with self.subTest(role=role):
                self.set_role_grants({role: ["pacientes.ver"]})
                headers = self.headers(self.token(roles=["Admin"]))
                search = self.client.get("/api/pacientes/buscar?q=Pa", headers=headers)
                recent = self.client.get("/api/pacientes/recientes", headers=headers)
                self.assertEqual(search.status_code, 200)
                self.assertEqual(recent.status_code, 200)
                last_visit = {"ultima_visita"} if scope != "administrative" else set()
                self.assertEqual(set(search.json["data"][0]), search_fields | last_visit)
                self.assertEqual(set(recent.json["data"][0]), recent_fields | last_visit)
                self.assertEqual(search.json["pagination"]["total"], 1)
                self.assertNotIn("dato-sintetico", str(search.json))
                self.assertNotIn("alergia-sintetica", str(recent.json))
                self.assertNotIn("diagnostico_ia", str(search.json))
                self.assertNotIn("informes", str(search.json))
                self.search_service.assert_called_with("Pa", 1, 5,
                                                      include_last_visit=scope != "administrative")
                self.recent_service.assert_called_with(6,
                                                      include_last_visit=scope != "administrative")

    def test_real_patient_routes_multirole_scope_requires_clinical_grant_source(self):
        roles = self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"],
                                     "OFTALMOLOGO": []})
        headers = self.headers(self.token(roles=["Oftalmologo", "Admin"]))
        path = "/api/pacientes/recientes"
        assistant = self.client.get(path, headers=headers)
        self.assertEqual(assistant.status_code, 200)
        self.assertNotIn("ultima_visita", assistant.json["data"][0])
        roles["OFTALMOLOGO"].permisos_rel.append(SimpleNamespace(
            permiso=SimpleNamespace(codigo="pacientes.ver", estado="ACTIVO")))
        clinician = self.client.get(path, headers=headers)
        self.assertEqual(clinician.status_code, 200)
        self.assertIn("ultima_visita", clinician.json["data"][0])
        roles["OFTALMOLOGO"].permisos_rel[0].permiso.estado = "INACTIVO"
        again = self.client.get(path, headers=headers)
        self.assertEqual(again.status_code, 200)
        self.assertNotIn("ultima_visita", again.json["data"][0])
        roles["ASISTENTE_ADMINISTRATIVO"].permisos_rel[0].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get(path, headers=headers).status_code, 403)

    def test_real_patient_routes_fail_closed_on_unexpected_lookup_rows(self):
        self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"]})
        self.search_service.return_value = ({"success": True, "data": ["dato-sintetico"]}, 200)
        response = self.client.get("/api/pacientes/buscar?q=Pa",
                                   headers=self.headers(self.token()))
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("dato-sintetico", response.get_data(as_text=True))
        self.assertEqual(response.json, {"success": False,
                                         "message": "No se pudo procesar la solicitud."})

    def test_real_patient_routes_remove_unexpected_top_level_and_nested_fields(self):
        self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"]})
        body, status = self.search_service.return_value
        self.search_service.return_value = ({**body, "diagnostico_ia": {"detalle": "secreto"},
                                             "pagination": {**body["pagination"],
                                                            "datos_clinicos": {"dato": "secreto"}}}, status)
        headers = self.headers(self.token())
        response = self.client.get("/api/pacientes/buscar?q=Pa", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("secreto", response.get_data(as_text=True))
        self.assertEqual(set(response.json), {"success", "data", "pagination"})
        self.assertEqual(set(response.json["pagination"]),
                         {"page", "per_page", "total", "has_more"})
        body["data"][0]["nombres"] = {"diagnostico_ia": "secreto"}
        response = self.client.get("/api/pacientes/buscar?q=Pa", headers=headers)
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("secreto", response.get_data(as_text=True))

    def test_b1_list_detail_reject_before_handler_and_preserve_old_decorators(self):
        for path in ("/api/pacientes", "/api/pacientes/101"):
            for token in (None, self.token(key="invalid"), self.token(expires=False)):
                self.assertEqual(self.client.get(path, headers=self.headers(token) if token else None).status_code, 401)
        self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["pacientes.ver"], "OFTALMOLOGO": []})
        for path in ("/api/pacientes", "/api/pacientes/101"):
            self.assertEqual(self.client.get(path, headers=self.headers(self.token())).status_code, 403)
        self.list_service.assert_not_called()
        self.detail_service.assert_not_called()
        self.assertEqual(patient_routes.register_paciente.__wrapped__.__wrapped__.__name__,
                         "register_paciente")

    def test_b1_list_detail_project_provenance_and_clinical_fields(self):
        roles = self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"],
                                     "OFTALMOLOGO": ["diagnostico_retinopatia.ver"]})
        headers = self.headers(self.token(roles=["Oftalmologo"]))
        paths = ("/api/pacientes", "/api/pacientes/101")
        for path in paths:
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 200)
            row = response.json["data"][0] if isinstance(response.json["data"], list) else response.json["data"]
            self.assertEqual(response.json["scope"], "administrative")
            self.assertEqual(set(row), set(patient_routes.LIST_FIELDS) |
                             ({"tipo_doc"} if path.endswith("101") else set()))
            self.assertNotIn("secreto", response.get_data(as_text=True))
        roles["OFTALMOLOGO"].permisos_rel.append(SimpleNamespace(
            permiso=SimpleNamespace(codigo="pacientes.ver", estado="ACTIVO")))
        detail = self.client.get(paths[1], headers=headers)
        self.assertEqual(detail.json["scope"], "clinical")
        self.assertEqual(detail.json["data"]["antecedentes_clinicos"], "antecedente secreto")
        self.assertNotIn("informes", detail.get_data(as_text=True))
        listing = self.client.get(paths[0], headers=headers)
        self.assertEqual(listing.json["data"][0]["maxima_gravedad"], 4)
        roles["OFTALMOLOGO"].permisos_rel[-1].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get(paths[1], headers=headers).json["scope"], "administrative")

    def test_b1_list_detail_nurse_and_missing_patient(self):
        self.set_role_grants({"ENFERMERO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        detail = self.client.get("/api/pacientes/101", headers=headers)
        self.assertEqual(detail.json["scope"], "assistance")
        self.assertEqual(detail.json["data"]["alergias"], "alergia secreta")
        self.assertNotIn("antecedentes_clinicos", detail.json["data"])
        listing = self.client.get("/api/pacientes", headers=headers)
        self.assertIn("ultima_visita", listing.json["data"][0])
        self.assertNotIn("maxima_gravedad", listing.json["data"][0])
        self.detail_service.return_value = ({"success": False, "message": "Paciente no encontrado"}, 404)
        self.assertEqual(self.client.get("/api/pacientes/999", headers=headers).status_code, 404)

    def test_b1_list_detail_fail_closed_on_nested_allowed_field(self):
        self.set_role_grants({"ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"]})
        self.patient_row["nombres"] = {"diagnosticos": "secreto"}
        headers = self.headers(self.token())
        for path in ("/api/pacientes", "/api/pacientes/101"):
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 500)
            self.assertNotIn("secreto", response.get_data(as_text=True))

    def test_b1_real_post_denies_before_handler_for_invalid_token_or_grant(self):
        path = "/api/pacientes"
        for token in (None, self.token(key="different-synthetic-key"), self.token(expires=False)):
            result = self.client.post(path, headers=self.headers(token) if token else None, json={})
            self.assertEqual(result.status_code, 401)
        self.active = False
        self.assertEqual(self.client.post(path, headers=self.headers(self.token()), json={}).status_code, 401)
        self.active = True
        for grants in ({"OFTALMOLOGO": []}, {"ADMINISTRADOR_SISTEMA": ["pacientes.crear"]},
                       {"ADMINISTRADOR_SISTEMA": ["pacientes.crear"], "OFTALMOLOGO": []},
                       {"ASISTENTE_ADMINISTRATIVO": ["clinico.*"]}):
            with self.subTest(grants=grants):
                self.set_role_grants(grants)
                self.assertEqual(self.client.post(path, headers=self.headers(self.token()),
                                                  json={}).status_code, 403)
        self.create_service.assert_not_called()

    def test_b1_real_post_projects_response_by_independent_read_grant(self):
        for role, create_scope, read_scope in (
            ("OFTALMOLOGO", "clinical", "clinical"),
            ("ENFERMERO", "assistance", "assistance"),
            ("ASISTENTE_ADMINISTRATIVO", "administrative", "administrative"),
        ):
            with self.subTest(role=role):
                self.set_role_grants({role: ["pacientes.crear", "pacientes.ver"]})
                response = self.client.post("/api/pacientes", json={"tipo_doc": "DNI"},
                                            headers=self.headers(self.token(roles=["Admin"])))
                self.assertEqual(response.status_code, 201)
                self.create_service.assert_called_with({"tipo_doc": "DNI"},
                                                       create_scope=create_scope, read_scope=read_scope)
                fields = set(response.json["data"])
                self.assertNotIn("diagnosticos", fields)
                self.assertNotIn("informes", fields)
                self.assertNotIn("imagenes", fields)
                self.assertEqual("antecedentes_clinicos" in fields, role == "OFTALMOLOGO")
                self.assertEqual("alergias" in fields, role != "ASISTENTE_ADMINISTRATIVO")
                self.assertEqual("consentimiento_informado" in fields, role != "ASISTENTE_ADMINISTRATIVO")
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.crear"]})
        response = self.client.post("/api/pacientes", json={},
                                    headers=self.headers(self.token()))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["data"], {"id": 101})
        self.create_service.assert_called_with({}, create_scope="clinical", read_scope=None)

    def test_b1_real_post_multirole_never_merges_create_or_read_grants(self):
        roles = self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["pacientes.crear", "pacientes.ver"],
                                     "OFTALMOLOGO": ["pacientes.ver"]})
        headers = self.headers(self.token())
        self.assertEqual(self.client.post("/api/pacientes", json={}, headers=headers).status_code, 403)
        self.create_service.assert_not_called()
        roles["OFTALMOLOGO"].permisos_rel.append(SimpleNamespace(
            permiso=SimpleNamespace(codigo="pacientes.crear", estado="ACTIVO")))
        self.assertEqual(self.client.post("/api/pacientes", json={}, headers=headers).status_code, 201)
        roles["OFTALMOLOGO"].permisos_rel[-1].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.post("/api/pacientes", json={}, headers=headers).status_code, 403)
        self.assertEqual(self.create_service.call_count, 1)

    def test_b1_real_post_create_grant_never_elevates_read_from_other_role(self):
        self.set_role_grants({"OFTALMOLOGO": ["pacientes.crear"],
                              "ASISTENTE_ADMINISTRATIVO": ["pacientes.ver"]})
        result = self.client.post("/api/pacientes", json={}, headers=self.headers(self.token()))
        self.assertEqual(result.status_code, 201)
        self.create_service.assert_called_once_with({}, create_scope="clinical", read_scope="administrative")
        self.assertNotIn("antecedentes_clinicos", result.json["data"])
        self.assertNotIn("alergias", result.json["data"])
        self.assertNotIn("consentimiento_informado", result.json["data"])

    def test_b1_real_history_requires_five_grants_from_ophthalmologist(self):
        required = {"pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver",
                    "informes.ver", "imagenes.ver"}
        paths = ("/api/diagnosticos/paciente/101", "/api/pacientes/101/visitas")
        headers = self.headers(self.token(roles=["Administrador del sistema"]))
        self.set_role_grants({"OFTALMOLOGO": required})
        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path, headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json["data"][0]["diagnostico_ia"]["detalles"][0]
                                 ["imagen_original_url"], "synthetic-only.jpg")
        self.assertEqual(self.history_service.call_count, 2)
        for missing in required:
            with self.subTest(missing=missing):
                self.set_role_grants({"OFTALMOLOGO": required - {missing}})
                for path in paths:
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
        self.assertEqual(self.history_service.call_count, 2)

    def test_b1_real_history_denies_without_eligible_provenance_or_authentication(self):
        path = "/api/pacientes/101/visitas"
        for token in (None, self.token(key="incorrect-synthetic-key"), self.token(expires=False)):
            response = self.client.get(path, headers=self.headers(token) if token else None)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("data", response.json)
        self.active = False
        self.assertEqual(self.client.get(path, headers=self.headers(self.token())).status_code, 401)
        self.active = True
        required = {"pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver",
                    "informes.ver", "imagenes.ver"}
        for grants in ({"ADMINISTRADOR_SISTEMA": required},
                       {"ASISTENTE_ADMINISTRATIVO": required},
                       {"ENFERMERO": required},
                       {"ADMINISTRADOR_SISTEMA": required, "OFTALMOLOGO": {"pacientes.ver"}},
                       {"ASISTENTE_ADMINISTRATIVO": required - {"imagenes.ver"},
                        "OFTALMOLOGO": {"imagenes.ver"}}):
            with self.subTest(grants=grants):
                self.set_role_grants(grants)
                for endpoint in (path, "/api/diagnosticos/paciente/101"):
                    result = self.client.get(endpoint, headers=self.headers(self.token()))
                    self.assertEqual(result.status_code, 403)
                    self.assertNotIn("data", result.json)
        self.history_service.assert_not_called()

    def test_b1_real_history_revocation_empty_and_not_found(self):
        required = ["pacientes.ver", "visitas.ver", "diagnostico_retinopatia.ver",
                    "informes.ver", "imagenes.ver"]
        roles = self.set_role_grants({"ADMINISTRADOR_SISTEMA": ["dashboard.ver"],
                                      "OFTALMOLOGO": required})
        headers = self.headers(self.token())
        for patient_id in (101, 202):
            self.assertEqual(self.client.get(f"/api/pacientes/{patient_id}/visitas",
                                             headers=headers).status_code, 200)
        roles["OFTALMOLOGO"].permisos_rel[-1].permiso.estado = "INACTIVO"
        self.assertEqual(self.client.get("/api/pacientes/101/visitas", headers=headers).status_code, 403)
        self.assertEqual(self.history_service.call_count, 2)
        roles["OFTALMOLOGO"].permisos_rel[-1].permiso.estado = "ACTIVO"
        self.history_service.return_value = ({"success": True, "data": []}, 200)
        self.assertEqual(self.client.get("/api/pacientes/202/visitas", headers=headers).json["data"], [])
        self.history_service.return_value = ({"success": False,
                                              "message": "Paciente no encontrado"}, 404)
        missing = self.client.get("/api/diagnosticos/paciente/999", headers=headers)
        self.assertEqual(missing.status_code, 404)
        self.assertNotIn("data", missing.json)


if __name__ == "__main__":
    unittest.main()
