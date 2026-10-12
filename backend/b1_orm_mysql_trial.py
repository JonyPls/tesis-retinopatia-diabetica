"""Integración B1 real contra el MySQL temporal verificado por el arnés.

No es una suite descubierta automáticamente: run_orm_integration se invoca
solo tras inicializar y comprobar la instancia desechable. No importa app.py.
"""

from contextlib import contextmanager
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from functools import partial
import inspect as python_inspect
import os
import re
import secrets
import sys
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
    from routes import patient_routes
    from src.models.auth_entities import (Cargo, Permiso, Rol, RolPermiso,
                                          TipoDocumento, Usuario, UsuarioRol)
    from src.models.patient_entities import Paciente, VisitaClinica
    from src.models import diagnosis_entities, informe_entities  # Registrar metadatos ORM.
    from src.repositories.auth_repository import AuthRepository
    from utils.security import clinical_access_required, token_required
    from utils.strict_authorization import evaluate_operation, strict_authorization_required


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
            comentario_medico="Conclusion sintetica",
        ))
        db.session.add(diagnosis)
        db.session.flush()
        cls.diagnosis_ids.append(diagnosis.id)
        db.session.commit()
        db.session.remove()

    @classmethod
    def cleanup_fixtures(cls):
        db.session.remove()
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

    def tearDown(self):
        db.session.rollback()
        db.session.remove()

    def token(self, profile="ophthalmologist", *, expires=True, expired=False, claims_roles=None):
        claims = {
            "user_id": self.user_ids[profile], "roles": claims_roles or ["Admin"],
        }
        if expires:
            offset = -1 if expired else 1
            claims["exp"] = datetime.now(timezone.utc) + timedelta(hours=offset)
        return jwt.encode(claims, TEST_KEY, algorithm="HS256")

    def call(self, path, *, method="GET", token=None, measure=False):
        db.session.remove()  # Simula una solicitud real nueva sin cache entre requests.
        statements = []
        engine = db.engine

        def count_sql(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)  # Solo en memoria; nunca imprimir parámetros o SQL.

        if measure:
            event.listen(engine, "before_cursor_execute", count_sql)
        try:
            headers = {"Authorization": f"Bearer {token}"} if token else None
            response = self.client.open(path, method=method, headers=headers)
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
