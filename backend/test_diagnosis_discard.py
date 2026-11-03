"""Solo SQLite :memory:, Flask propio y archivos sintéticos temporales.

No importa app.py, no usa init_db/.env para conectar, no carga modelos DL.
SQLite verifica transacciones/contratos; NO acredita locks MySQL multiproceso.
"""
import os
import sys
from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, call as unittest_call, patch
from uuid import uuid4

from flask import Flask
from PIL import Image
import numpy as np
from werkzeug.datastructures import FileStorage
from sqlalchemy import Column, ForeignKey, Integer, LargeBinary, MetaData, String, Table, event, text
from sqlalchemy.sql.sqltypes import BigInteger, BINARY

from database import db
from routes.diagnosis_discard_routes import diagnosis_discard_bp
from services import diagnosis_discard_service as service
from src.models.auth_entities import Usuario
from src.models.patient_entities import Paciente, VisitaClinica
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle, ConfirmacionExportacionRetinografo, GradoRetinopatia
from src.models.informe_entities import Informe
from src.models.diagnosis_discard_entities import RevisionInferenciaVisita, OperacionDescarteIA
from src.repositories.diagnosis_discard_repository import DiagnosisDiscardRepository as Repo
from src.repositories.diagnosis_repository import DiagnosisRepository
from utils import diagnosis_discard_storage as storage
from utils.diagnosis_discard_gate import DiscardError, require_ready
from utils.strict_authorization import evaluate_operation


GRANTS = ('pacientes.ver', 'visitas.ver', 'diagnostico_retinopatia.ver', 'imagenes.ver',
          'diagnostico_retinopatia.descartar_pendiente')


def user(grants=None, id=1):
    return SimpleNamespace(id=id, estado='ACTIVO', roles=[], permisos=[], roles_rel=[
        SimpleNamespace(rol=SimpleNamespace(codigo=role, estado='ACTIVO', permisos_rel=[
            SimpleNamespace(permiso=SimpleNamespace(codigo=p, estado='ACTIVO')) for p in permissions]))
        for role, permissions in (grants or {'OFTALMOLOGO': GRANTS}).items()])


class DiscardTest(TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite://',
                               SECRET_KEY='synthetic', DIAGNOSIS_DISCARD_ENABLED=True,
                               DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=True,
                               DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=True)
        db.init_app(self.app)
        self.app.register_blueprint(diagnosis_discard_bp)
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.addCleanup(self.ctx.pop)
        self.addCleanup(db.engine.dispose)
        self.addCleanup(db.session.remove)
        # Solo sustituir la comprobación MySQL UTC en esta conexión en memoria.
        utc = patch('utils.temporal_provenance.require_utc_connection')
        utc.start()
        self.addCleanup(utc.stop)
        self.temp = TemporaryDirectory(prefix='codn-discard-synthetic-')
        self.addCleanup(self.temp.cleanup)
        root = patch.object(storage, 'storage_root', return_value=self.temp.name)
        root.start()
        self.addCleanup(root.stop)
        db.session.execute(text('PRAGMA foreign_keys=ON'))
        # Esquema de prueba portable: columnas reales, sin CHECK/temporal MySQL.
        # Los eventos ORM reales siguen ejecutándose (excepto require_utc arriba).
        self.metadata = MetaData()
        models = (Usuario, Paciente, VisitaClinica, Diagnostico, DiagnosticoDetalle,
                  ConfirmacionExportacionRetinografo, GradoRetinopatia, Informe,
                  RevisionInferenciaVisita, OperacionDescarteIA)
        fks = {('diagnosticos_retinopatia', 'visita_id'): 'visitas_clinicas.id',
               ('diagnosticos_retinopatia_detalle', 'diagnostico_retinopatia_id'): 'diagnosticos_retinopatia.id',
               ('confirmaciones_exportacion_retinografo', 'detalle_id'): 'diagnosticos_retinopatia_detalle.id',
               ('diagnostico_ia_revision_visita', 'visita_id'): 'visitas_clinicas.id',
               ('diagnostico_ia_descarte_operaciones', 'visita_id'): 'visitas_clinicas.id',
               ('diagnostico_ia_descarte_operaciones', 'autor_id'): 'usuarios.id'}
        for model in models:
            columns = []
            for col in model.__table__.columns:
                kind = Integer() if isinstance(col.type, (Integer, BigInteger)) else (
                    LargeBinary() if isinstance(col.type, BINARY) else
                    String(col.type.length) if isinstance(col.type, String) else col.type)
                fk = fks.get((model.__tablename__, col.name))
                columns.append(Column(col.name, kind, *([ForeignKey(fk, ondelete='RESTRICT')] if fk else []),
                                      primary_key=col.primary_key, nullable=not col.primary_key))
            Table(model.__tablename__, self.metadata, *columns)
        self.metadata.create_all(db.engine)  # Únicamente :memory:.
        self.insert(Usuario, id=1)
        self.insert(Usuario, id=2)
        self.insert(Paciente, id=7)
        self.insert(VisitaClinica, id=30, paciente_id=7, usuario_id=1, estado='ACTIVA')
        self.insert(Diagnostico, id=9, visita_id=30, usuario_id=1, estado='PROCESADO')
        for grade in range(5):
            self.insert(GradoRetinopatia, id=grade, codigo=str(grade), nombre=str(grade), estado='ACTIVO')
        self.detail(11, 'Derecho')
        self.detail(12, 'Izquierdo')
        db.session.commit()

    def insert(self, model, **data):
        db.session.execute(model.__table__.insert().values(**data))

    def detail(self, id, eye, **data):
        name = f'P7_{eye}_{id:032x}.jpg'
        for filename in (name, name.replace('.jpg', '_gradcam.jpg')):
            (Path(self.temp.name) / filename).write_bytes(b'synthetic jpeg placeholder')
        self.insert(DiagnosticoDetalle, id=id, diagnostico_retinopatia_id=9,
                    ojo_evaluado=eye, imagen_original_url=name,
                    imagen_gradcam_url=name.replace('.jpg', '_gradcam.jpg'),
                    resultado_ia_id=2, estado_validacion='PENDIENTE', **data)

    def update(self, model, id, **data):
        db.session.execute(model.__table__.update().where(model.id == id).values(**data))
        db.session.commit()
        db.session.expire_all()

    def payload(self, ids=None, **extra):
        return {'paciente_id': 7, 'diagnostico_retinopatia_id': 9, 'detalle_ids': ids or [12],
                'revision_esperada': 0, 'operacion_id': str(uuid4()), 'confirmo_descarte': True, **extra}

    def discard(self, data=None, actor=1):
        return service.discard(30, actor, data or self.payload())

    def ids(self):
        return [id for (id,) in db.session.query(DiagnosticoDetalle.id).order_by(DiagnosticoDetalle.id)]

    def validated(self, id=11, corrected=False):
        self.update(DiagnosticoDetalle, id, estado_validacion='CORREGIDO' if corrected else 'APROBADO',
                    resultado_final_id=3 if corrected else 2, validado_por=2,
                    fecha_validacion=datetime(2026, 1, 1), comentario_medico='Conservar comentario',
                    motivo_correccion='Conservar motivo' if corrected else None)

    def inference_service(self):
        """Servicio real cargado sin torch, CLIP ni mkdir sobre uploads habitual."""
        validator = ModuleType('dl_model.validator')
        validator.MAX_IMAGE_BYTES = 20 * 1024 * 1024
        validator.MAX_IMAGE_SIDE = 8192
        validator.MAX_IMAGE_PIXELS = 30_000_000
        for name in ('validar_formato_y_dimensiones', 'validar_region_circular', 'validar_contenido_semantico'):
            setattr(validator, name, Mock(return_value={'valido': True}))
        inference = ModuleType('dl_model.inference')
        inference.predecir_imagen_bytes = Mock(return_value={
            'cam_image_array': np.zeros((350, 350, 3), dtype=np.uint8),
            'confianza_general': 80, 'diagnostico_codigo': 2,
            'diagnostico_texto': 'Sintético', 'probabilidades_detalle': {'2': 80}})
        spec = spec_from_file_location('isolated_discard_inference',
                                       Path(__file__).parent / 'services' / 'diagnosis_service.py')
        module = module_from_spec(spec)
        with patch.dict(sys.modules, {'dl_model.validator': validator, 'dl_model.inference': inference}), \
                patch('os.makedirs'):
            spec.loader.exec_module(module)
        module.UPLOAD_FOLDER = self.temp.name
        return module

    def synthetic_upload(self):
        data = BytesIO()
        Image.new('RGB', (350, 350)).save(data, 'JPEG')
        data.seek(0)
        return FileStorage(stream=data, filename='synthetic.jpg', content_type='image/jpeg')

    def test_validator_unavailable_has_specific_code_and_never_predicts_or_persists(self):
        db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 12))
        db.session.commit()
        inference = self.inference_service()
        inference.validar_contenido_semantico.return_value = {
            'valido': False, 'status': 503, 'error': 'Validación de imagen no disponible.'}
        response, status = inference.procesar_diagnostico(
            self.synthetic_upload(), 7, 1, 'Izquierdo', 30)
        self.assertEqual(status, 503)
        self.assertEqual(response['code'], 'VALIDADOR_IMAGEN_NO_DISPONIBLE')
        inference.predecir_imagen_bytes.assert_not_called()
        self.assertEqual(self.ids(), [11])

    def test_missing_extension_stops_before_clip_and_reports_schema_not_validator(self):
        # Solo el esquema SQLite :memory: de este test; nunca MySQL habitual.
        db.session.execute(text('DROP TABLE diagnostico_ia_descarte_operaciones'))
        db.session.execute(text('DROP TABLE diagnostico_ia_revision_visita'))
        db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 12))
        db.session.commit()
        inference = self.inference_service()
        response, status = inference.procesar_diagnostico(
            self.synthetic_upload(), 7, 1, 'Izquierdo', 30)
        self.assertEqual(status, 503)
        self.assertEqual(response['code'], 'DESCARTE_NO_INSTALADO')
        inference.validar_formato_y_dimensiones.assert_not_called()
        inference.validar_contenido_semantico.assert_not_called()
        inference.predecir_imagen_bytes.assert_not_called()
        self.assertEqual(self.ids(), [11])

    def test_single_eye_preserves_other_and_visit(self):
        before = db.session.get(DiagnosticoDetalle, 11).imagen_original_url
        response, status = self.discard()
        self.assertEqual(status, 200, response)
        self.assertEqual(self.ids(), [11])
        self.assertEqual(db.session.get(DiagnosticoDetalle, 11).imagen_original_url, before)
        self.assertEqual(db.session.get(VisitaClinica, 30).estado, 'ACTIVA')
        self.assertEqual(db.session.get(Diagnostico, 9).estado, 'PROCESADO')
        self.assertEqual(Repo.revision(30), 1)
        self.assertTrue(all(Path(self.temp.name, e['nombre']).exists() for e in
                            Repo.operation(response['data']['operacion_id']).archivos))

    def test_validated_other_eye_preserved_and_aggregate_recomputed(self):
        self.validated(corrected=True)
        before = {c.name: getattr(db.session.get(DiagnosticoDetalle, 11), c.name)
                  for c in DiagnosticoDetalle.__table__.columns}
        response, status = self.discard()
        self.assertEqual(status, 200, response)
        after = db.session.get(DiagnosticoDetalle, 11)
        self.assertEqual({c: getattr(after, c) for c in before}, before)
        self.assertEqual(db.session.get(Diagnostico, 9).estado, 'VALIDADO')

    def test_both_remove_parent_not_visit_and_normal_repository_can_reuse(self):
        response, status = self.discard(self.payload([11, 12]))
        self.assertEqual(status, 200, response)
        self.assertIsNone(db.session.get(Diagnostico, 9))
        self.assertIsNotNone(db.session.get(VisitaClinica, 30))
        self.assertEqual(self.ids(), [])
        revision = Repo.capture_inference(30)
        db.session.rollback()
        visit, diag, detail = DiagnosisRepository.crear_diagnostico_y_detalle(
            {'paciente_id': 7, 'usuario_id': 1, 'ojo_evaluado': 'Izquierdo',
             'imagen_original_url': 'new.jpg', 'probabilidad_ia': .8, 'resultado_ia': 2},
            30, inference_revision=revision)
        db.session.commit()
        self.assertEqual(visit, 30)
        self.assertIsNotNone(db.session.get(DiagnosticoDetalle, detail))

    def test_context_empty_visit_does_not_claim_success_without_operation(self):
        payload = self.payload([11, 12])
        self.assertEqual(self.discard(payload)[1], 200)
        response, status = service.context(30, 1, str(uuid4()))
        self.assertEqual(status, 200)
        self.assertIsNone(response['data']['diagnostico_retinopatia_id'])
        self.assertEqual(response['data']['detalles'], [])
        self.assertEqual(response['data']['conciliacion'], 'NO_CONFIRMADA')
        response, _ = service.context(30, 1, payload['operacion_id'])
        self.assertEqual(response['data']['conciliacion'], 'CONFIRMADA')

    def test_operation_reconciliation_survives_new_parent_owned_by_someone_else(self):
        payload = self.payload([11, 12])
        self.assertEqual(self.discard(payload)[1], 200)
        self.insert(Diagnostico, id=10, visita_id=30, usuario_id=2, estado='PROCESADO')
        db.session.commit()
        self.assertEqual(service.context(30, 1, payload['operacion_id'])[1], 403)
        response, status = service.operation_status(30, 1, payload['operacion_id'])
        self.assertEqual(status, 200)
        self.assertEqual(response['data']['conciliacion'], 'CONFIRMADA')
        self.assertEqual(service.operation_status(30, 2, payload['operacion_id'])[1], 403)

    def test_report_revision_reader_does_not_need_discard_permission(self):
        profile = user({'OFTALMOLOGO': ('informes.crear', 'pacientes.ver', 'visitas.ver')}, id=2)
        self.assertTrue(evaluate_operation(profile, 'reports.inference_context'))
        self.assertFalse(evaluate_operation(profile, 'diagnosis.discard_pending'))
        response, status = service.report_context(30)
        self.assertEqual(status, 200)
        self.assertEqual(response['data'], {'visita_id': 30, 'paciente_id': 7, 'revision_inferencia': 0})

    def test_validated_selected_or_mixed_batch_rejected_atomically(self):
        for corrected in (False, True):
            self.validated(corrected=corrected)
            response, status = self.discard(self.payload([11, 12]))
            self.assertEqual(status, 409, response)
            self.assertEqual(self.ids(), [11, 12])
            self.assertEqual(OperacionDescarteIA.query.count(), 0)

    def test_each_medical_marker_blocks_pending(self):
        for field, value in (('resultado_final_id', 2), ('validado_por', 2),
                             ('fecha_validacion', datetime(2026, 1, 1)),
                             ('comentario_medico', ' '), ('motivo_correccion', 'motivo')):
            self.update(DiagnosticoDetalle, 12, **{field: value})
            self.assertEqual(self.discard()[1], 409, field)
            self.assertEqual(self.ids(), [11, 12])
            self.update(DiagnosticoDetalle, 12, **{field: None})

    def test_retinograph_link_rejected_without_changing_confirmation(self):
        self.insert(ConfirmacionExportacionRetinografo, id=1, token_verificador=b'a' * 32,
                    paciente_id=7, confirmado_por=1, ojo_confirmado='Izquierdo',
                    nombre_exportacion='synthetic', sha256_fuente='a' * 64, clave_copia='b' * 32,
                    estado='CONSUMIDA', detalle_id=12)
        db.session.commit()
        self.assertEqual(self.discard()[0]['code'], 'COMPROBANTE_VINCULADO')
        self.assertEqual(db.session.get(ConfirmacionExportacionRetinografo, 1).detalle_id, 12)

    def test_visit_states_and_annulled_parent_rejected(self):
        for state in ('CERRADA', 'ANULADA'):
            self.update(VisitaClinica, 30, estado=state)
            self.assertEqual(self.discard()[1], 409)
        self.update(VisitaClinica, 30, estado='ACTIVA')
        self.update(Diagnostico, 9, estado='ANULADO')
        self.assertEqual(self.discard()[1], 409)
        self.assertEqual(self.ids(), [11, 12])

    def test_reports_any_state_rejected(self):
        self.insert(Informe, id=1, visita_id=30, usuario_id=1, tipo_informe_id=1, estado='ACTIVO')
        db.session.commit()
        for state in ('ACTIVO', 'INACTIVO', 'ANULADO'):
            self.update(Informe, 1, estado=state)
            self.assertEqual(self.discard()[0]['code'], 'INFORMES_EXISTENTES')

    def test_unknown_cascade_dependency_blocks_before_delete(self):
        db.session.execute(text('CREATE TABLE inesperada (id INTEGER PRIMARY KEY, detalle INTEGER REFERENCES diagnosticos_retinopatia_detalle(id) ON DELETE CASCADE)'))
        db.session.commit()
        self.assertEqual(self.discard()[0]['code'], 'DEPENDENCIA_NO_COMPATIBLE')
        self.assertEqual(self.ids(), [11, 12])

    def test_idempotency_and_new_ids_not_targeted(self):
        payload = self.payload()
        original, status = self.discard(payload)
        self.assertEqual(status, 200)
        self.detail(13, 'Izquierdo')
        db.session.commit()
        repeated, status = self.discard(payload)
        self.assertEqual(status, 200)
        self.assertEqual(repeated['data']['resultado'], original['data']['resultado'])
        self.assertEqual(self.ids(), [11, 13])
        self.assertEqual(OperacionDescarteIA.query.count(), 1)
        self.assertEqual(self.discard({**payload, 'detalle_ids': [13]})[0]['code'], 'OPERACION_REUTILIZADA')
        self.assertEqual(self.discard(self.payload(revision_esperada=1))[1], 409)
        self.assertEqual(self.ids(), [11, 13])

    def test_patient_owner_diagnosis_and_foreign_detail_ids(self):
        self.assertEqual(self.discard(actor=2)[1], 403)
        self.assertEqual(self.discard(self.payload(paciente_id=8))[1], 403)
        self.assertEqual(self.discard(self.payload(diagnostico_retinopatia_id=99))[1], 409)
        self.assertEqual(self.discard(self.payload([99]))[1], 409)
        self.assertEqual(service.context(30, 2)[1], 403)

    def test_inference_captured_before_discard_cannot_persist(self):
        old = Repo.capture_inference(30)
        db.session.rollback()
        self.assertEqual(self.discard()[1], 200)
        Repo.lock_visit(30)
        with self.assertRaises(DiscardError) as caught:
            Repo.check_inference(30, old)
        self.assertEqual(caught.exception.code, 'INFERENCIA_OBSOLETA')
        db.session.rollback()
        self.assertEqual(Repo.capture_inference(30), 1)

    def test_real_inference_service_fences_compute_in_progress_without_models(self):
        db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 12))
        db.session.commit()
        module = self.inference_service()
        prediction = module.predecir_imagen_bytes.return_value
        def compute(_bytes):
            self.assertEqual(self.discard(self.payload([11]))[1], 200)
            return prediction
        module.predecir_imagen_bytes.side_effect = compute
        response, status = module.procesar_diagnostico(self.synthetic_upload(), 7, 1, 'Izquierdo', 30)
        self.assertEqual(status, 409, response)
        self.assertEqual(response['code'], 'INFERENCIA_OBSOLETA')
        self.assertEqual(self.ids(), [])
        self.assertEqual(Repo.revision(30), 1)

    def test_validation_wins_then_discard_rejects(self):
        DiagnosisRepository.validar_detalle_diagnostico(12, 2, usuario_id=2)
        self.assertEqual(self.discard()[1], 409)
        self.assertEqual(db.session.get(DiagnosticoDetalle, 12).estado_validacion, 'APROBADO')

    def test_discard_wins_then_old_validation_cannot_touch_replacement(self):
        self.assertEqual(self.discard()[1], 200)
        self.detail(13, 'Izquierdo')
        db.session.commit()
        with self.assertRaises(Exception) as caught:
            DiagnosisRepository.validar_detalle_diagnostico(12, 2, usuario_id=2)
        self.assertEqual(caught.exception.status_code, 404)
        db.session.rollback()
        self.assertEqual(db.session.get(DiagnosticoDetalle, 13).estado_validacion, 'PENDIENTE')

    def test_unselected_new_other_eye_not_removed(self):
        # Pedido sobre 12, otro ID OD ya presente al adquirir locks: se conserva.
        db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 11))
        self.detail(14, 'Derecho')
        db.session.commit()
        self.assertEqual(self.discard()[1], 200)
        self.assertEqual(self.ids(), [14])

    def test_report_fence_requires_snapshot_and_rejects_old_revision(self):
        with self.assertRaises(DiscardError):
            Repo.check_report(30, None)
        db.session.rollback()
        self.assertEqual(self.discard()[1], 200)
        with self.assertRaises(DiscardError) as caught:
            Repo.check_report(30, 0)
        self.assertEqual(caught.exception.code, 'CONTEXTO_INFORME_OBSOLETO')
        db.session.rollback()
        Repo.check_report(30, 1)
        db.session.rollback()

    def test_real_report_service_rejects_old_form_before_repository_writes(self):
        from services.informe_service import crear_nuevo_informe, InformeRepository
        payload = {'paciente_id': 7, 'tipo_informe_id': 1, 'visita_id': 30,
                   'datos_estructurados': {'nota': 'Sintética'}, 'revision_inferencia_esperada': 0}
        self.assertEqual(self.discard()[1], 200)
        with patch.object(InformeRepository, 'crear_informe') as create:
            response, status = crear_nuevo_informe(payload, 1)
        self.assertEqual(status, 409, response)
        self.assertEqual(response['code'], 'CONTEXTO_INFORME_OBSOLETO')
        create.assert_not_called()

    def test_disabled_real_inference_and_report_service_without_extension_schema(self):
        from services.informe_service import crear_nuevo_informe, InformeRepository
        self.app.config['DIAGNOSIS_DISCARD_ENABLED'] = False
        db.session.execute(text('DROP TABLE diagnostico_ia_descarte_operaciones'))
        db.session.execute(text('DROP TABLE diagnostico_ia_revision_visita'))
        db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 12))
        db.session.commit()
        module = self.inference_service()
        response, status = module.procesar_diagnostico(self.synthetic_upload(), 7, 1, 'Izquierdo', 30)
        self.assertEqual(status, 200, response)
        self.assertEqual(response['data']['visita_id'], 30)
        with patch.object(InformeRepository, 'validar_paciente'), \
                patch.object(InformeRepository, 'obtener_tipo_informe_por_id', return_value={'schema_version_actual': 1}), \
                patch.object(InformeRepository, 'crear_informe', return_value=1), \
                patch.object(InformeRepository, 'crear_version_inicial'):
            response, status = crear_nuevo_informe({'paciente_id': 7, 'tipo_informe_id': 1,
                                                    'visita_id': 30, 'datos_estructurados': {'nota': 'sintética'}}, 1)
        self.assertEqual(status, 201, response)

    def test_rollback_preserves_files_rows_revision_and_manifest(self):
        before = set(os.listdir(self.temp.name))
        with patch.object(db.session, 'commit', side_effect=RuntimeError('synthetic')):
            response, status = self.discard()
        self.assertEqual(status, 503)
        self.assertEqual(response['code'], 'PERSISTENCIA_INCIERTA')
        self.assertEqual(self.ids(), [11, 12])
        self.assertEqual(Repo.revision(30), 0)
        self.assertEqual(OperacionDescarteIA.query.count(), 0)
        self.assertEqual(set(os.listdir(self.temp.name)), before)

    def test_lost_commit_ack_is_reconciled_without_automatic_cleanup(self):
        payload = self.payload()
        real_commit = db.session.commit
        def lost_ack():
            real_commit()
            raise RuntimeError('synthetic lost ack')
        with patch.object(db.session, 'commit', side_effect=lost_ack), patch.object(storage, 'remove_verified') as remove:
            response, status = self.discard(payload)
        self.assertEqual(status, 503)
        self.assertEqual(response['code'], 'PERSISTENCIA_INCIERTA')
        remove.assert_not_called()
        self.assertEqual(self.ids(), [11])
        response, _ = service.context(30, 1, payload['operacion_id'])
        self.assertEqual(response['data']['conciliacion'], 'CONFIRMADA')
        self.assertEqual(response['data']['operacion']['limpieza'], 'PENDIENTE')

    def test_cleanup_is_recoverable_idempotent_and_keeps_new_files(self):
        payload = self.payload()
        self.assertEqual(self.discard(payload)[1], 200)
        self.detail(13, 'Izquierdo')
        db.session.commit()
        new_names = [db.session.get(DiagnosticoDetalle, 13).imagen_original_url,
                     db.session.get(DiagnosticoDetalle, 13).imagen_gradcam_url]
        with patch.object(storage, 'remove_verified', side_effect=OSError('synthetic')):
            self.assertEqual(service.clean_operation(payload['operacion_id'])[0]['data']['limpieza'], 'PENDIENTE')
        self.assertEqual(service.clean_operation(payload['operacion_id'])[0]['data']['limpieza'], 'COMPLETADA')
        self.assertEqual(service.clean_operation(payload['operacion_id'])[1], 200)
        self.assertTrue(all(Path(self.temp.name, name).exists() for name in new_names))

    def test_cleanup_shared_or_changed_identity_keeps_file(self):
        payload = self.payload()
        self.assertEqual(self.discard(payload)[1], 200)
        operation = Repo.operation(payload['operacion_id'])
        name = operation.archivos[0]['nombre']
        self.update(DiagnosticoDetalle, 11, imagen_gradcam_url=name)
        response, _ = service.clean_operation(payload['operacion_id'])
        self.assertEqual(response['data']['limpieza'], 'CONFLICTO')
        self.assertTrue(Path(self.temp.name, name).exists())

    def test_changed_file_and_unsafe_names_rejected(self):
        name = 'P7_Derecho_' + 'a' * 32 + '.jpg'
        path = Path(self.temp.name, name)
        path.write_bytes(b'old')
        entry = storage.snapshot(self.temp.name, name)
        path.write_bytes(b'different size')
        with self.assertRaises(ValueError):
            storage.remove_verified(self.temp.name, entry)
        self.assertTrue(path.exists())
        for unsafe in ('../x.jpg', '..\\x.jpg', '/x.jpg', 'unregistered.jpg'):
            with self.assertRaises(ValueError):
                storage.snapshot(self.temp.name, unsafe)
        absent = storage.snapshot(self.temp.name, 'P7_Derecho_' + 'b' * 32 + '.jpg')
        Path(self.temp.name, absent['nombre']).write_bytes(b'new')
        with self.assertRaises(ValueError):
            storage.remove_verified(self.temp.name, absent)

    def test_shared_file_blocks_discard(self):
        name = db.session.get(DiagnosticoDetalle, 12).imagen_original_url
        self.update(DiagnosticoDetalle, 11, imagen_gradcam_url=name)
        self.assertEqual(self.discard()[0]['code'], 'ARCHIVO_COMPARTIDO')
        self.assertEqual(self.ids(), [11, 12])

    def test_feature_disabled_with_extension_tables_absent_uses_no_extension(self):
        self.app.config['DIAGNOSIS_DISCARD_ENABLED'] = False
        db.session.execute(text('DROP TABLE diagnostico_ia_descarte_operaciones'))
        db.session.execute(text('DROP TABLE diagnostico_ia_revision_visita'))
        db.session.commit()
        queries = []
        def record(_conn, _cursor, statement, *_args):
            queries.append(statement)
        event.listen(db.engine, 'before_cursor_execute', record)
        try:
            self.assertIsNone(Repo.capture_inference(30))
            Repo.check_report(30, None)
            self.assertEqual(self.discard()[1], 403)
            self.assertEqual(service.context(30, 1)[1], 403)
            # Reutilizar procesamiento real sin extensión, tras liberar OI en fixture.
            db.session.execute(DiagnosticoDetalle.__table__.delete().where(DiagnosticoDetalle.id == 12))
            DiagnosisRepository.comprobar_creacion(7, 'Izquierdo', 30)
            DiagnosisRepository.crear_diagnostico_y_detalle(
                {'paciente_id': 7, 'usuario_id': 1, 'ojo_evaluado': 'Izquierdo',
                 'imagen_original_url': 'fixture.jpg', 'probabilidad_ia': .8, 'resultado_ia': 2}, 30)
            db.session.commit()
            self.assertFalse(any('diagnostico_ia_' in q for q in queries))
        finally:
            event.remove(db.engine, 'before_cursor_execute', record)

    def test_enabled_missing_schema_or_readiness_fails_without_writes(self):
        self.app.config['DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY'] = False
        self.assertEqual(self.discard()[1], 503)
        self.app.config['DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY'] = True
        db.session.execute(text('DROP TABLE diagnostico_ia_revision_visita'))
        db.session.commit()
        self.assertEqual(self.discard()[1], 503)
        self.assertEqual(self.ids(), [11, 12])
        with self.assertRaises(DiscardError):
            Repo.capture_inference(30)

    def test_request_strictness_and_context_privacy(self):
        for changed in ({'confirmo_descarte': 1}, {'detalle_ids': [12, 12]},
                        {'revision_esperada': True}, {'operacion_id': 'bad'}, {'path': '../x'}):
            self.assertEqual(self.discard(self.payload(**changed))[1], 400)
        response, status = service.context(30, 1)
        self.assertEqual(status, 200)
        self.assertTrue(all(d['elegible'] for d in response['data']['detalles']))
        for forbidden in ('imagen_original_url', 'gradcam_url', self.temp.name, 'resultado_ia'):
            self.assertNotIn(forbidden, str(response))

    def test_b1_exact_provenance_and_no_inherited_destructive_permission(self):
        for grants in ({'ADMINISTRADOR_SISTEMA': GRANTS},
                       {'OFTALMOLOGO': GRANTS[:-1], 'ADMINISTRADOR_SISTEMA': GRANTS},
                       {'OFTALMOLOGO': ('diagnostico_retinopatia.crear', 'diagnostico_retinopatia.validar')},
                       {'OFTALMOLOGO': ('diagnostico_retinopatia.*',)},
                       {'OFTALMOLOGO': GRANTS[:-1]}):
            self.assertFalse(evaluate_operation(user(grants), 'diagnosis.discard_pending'))
        self.assertTrue(evaluate_operation(user(), 'diagnosis.discard_pending'))
        inactive = user()
        inactive.roles_rel[0].rol.estado = 'INACTIVO'
        self.assertFalse(evaluate_operation(inactive, 'diagnosis.discard_pending'))

    def test_routes_authentication_feature_gate_and_private_transport(self):
        client = self.app.test_client()
        path = '/api/diagnosticar/visita/30/descartar-resultados'
        with patch('utils.security.jwt.decode', return_value={'user_id': 1, 'exp': 9999999999}), \
                patch('utils.security.AuthRepository.get_active_user_with_permissions_by_id', return_value=user()):
            self.assertEqual(client.post(path, json=self.payload()).status_code, 401)
            headers = {'Authorization': 'Bearer synthetic'}
            self.app.config['DIAGNOSIS_DISCARD_ENABLED'] = False
            with patch.object(service, 'discard') as handler:
                self.assertEqual(client.post(path, headers=headers, json=self.payload()).status_code, 403)
                handler.assert_not_called()
            self.app.config['DIAGNOSIS_DISCARD_ENABLED'] = True
            response = client.get('/api/diagnosticar/visita/30/contexto-descarte', headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
            response = client.post(path, json=self.payload(), headers=headers)
            self.assertEqual(response.status_code, 200, response.json)


class DisabledReportCompatibilityTests(TestCase):
    """Contrato anterior: tres compuertas False, solo mocks, sin engine ni archivos."""

    def create_report(self, structured):
        from contextlib import ExitStack
        from services import informe_service as reports

        app = Flask(__name__)
        app.config.update(DIAGNOSIS_DISCARD_ENABLED=False,
                          DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=False,
                          DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=False)
        session = Mock()
        with ExitStack() as stack:
            stack.enter_context(app.app_context())
            stack.enter_context(patch.object(reports, 'db', SimpleNamespace(session=session)))
            stack.enter_context(patch.object(reports, 'require_ready', side_effect=AssertionError('No extension access')))
            stack.enter_context(patch.object(reports.DiagnosisDiscardRepository, 'check_report',
                                             side_effect=AssertionError('No extension access')))
            stack.enter_context(patch.object(reports.InformeRepository, 'validar_paciente'))
            stack.enter_context(patch.object(reports.InformeRepository, 'validar_visita'))
            stack.enter_context(patch.object(reports.InformeRepository, 'obtener_tipo_informe_por_id',
                                             return_value={'schema_version_actual': 1}))
            create = stack.enter_context(patch.object(reports.InformeRepository, 'crear_informe', return_value=99))
            version = stack.enter_context(patch.object(reports.InformeRepository, 'crear_version_inicial'))
            response, status = reports.crear_nuevo_informe({
                'paciente_id': 7, 'visita_id': 30, 'tipo_informe_id': 1,
                'datos_estructurados': structured}, 1)
            self.assertEqual(status, 201, response)
            self.assertEqual(response['data']['visita_id'], 30)
            self.assertEqual(create.call_args.kwargs['datos_estructurados'], structured)
            version.assert_called_once_with(99, 1)
            session.commit.assert_called_once_with()
            self.assertEqual(session.mock_calls, [unittest_call.commit()])

    def test_original_payload_without_revision_remains_valid(self):
        self.create_report({'nota': 'Sintética'})

    def test_previously_valid_structured_revision_key_remains_valid_when_disabled(self):
        self.create_report({'nota': 'Sintética', 'revision_inferencia_esperada': 0})

    def test_previously_valid_nested_revision_key_remains_valid_when_disabled(self):
        self.create_report({'observaciones': [{'revision_inferencia_esperada': 'Texto clínico'}]})

    def test_existing_reserved_keys_are_still_rejected_when_disabled(self):
        from services import informe_service as reports

        app = Flask(__name__)
        app.config.update(DIAGNOSIS_DISCARD_ENABLED=False,
                          DIAGNOSIS_DISCARD_SCHEMA_VERIFIED=False,
                          DIAGNOSIS_DISCARD_REPORT_CONTRACT_READY=False)
        with app.app_context(), self.assertRaises(reports.InvalidReportData):
            reports._validar_datos_estructurados({'estado': 'ACTIVO'})


if __name__ == '__main__':
    main()
