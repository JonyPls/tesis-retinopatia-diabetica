from database import db
from src.models.patient_entities import VisitaClinica
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle, ConfirmacionExportacionRetinografo
from src.models.informe_entities import Informe
from src.models.diagnosis_discard_entities import RevisionInferenciaVisita, OperacionDescarteIA
from utils.diagnosis_discard_gate import DiscardError, enabled, require_ready


class DiagnosisDiscardRepository:
    @staticmethod
    def lock_visit(visit_id):
        return (VisitaClinica.query.filter_by(id=visit_id).with_for_update()
                .populate_existing().first())

    @staticmethod
    def revision(visit_id, *, lock=False):
        query = RevisionInferenciaVisita.query.filter_by(visita_id=visit_id)
        row = (query.with_for_update().populate_existing().first() if lock else query.first())
        return row.revision if row is not None else 0

    @staticmethod
    def capture_inference(visit_id):
        if not enabled():
            return None
        require_ready()
        if visit_id is None:
            return 0  # Visita nueva: todavía no es un recurso descartable.
        if DiagnosisDiscardRepository.lock_visit(visit_id) is None:
            raise DiscardError(404, 'VISITA_NO_ENCONTRADA')
        return DiagnosisDiscardRepository.revision(visit_id, lock=True)

    @staticmethod
    def check_inference(visit_id, captured):
        if not enabled():
            if captured is not None:
                raise DiscardError(409, 'CONFIGURACION_CAMBIADA')
            return
        require_ready()
        # Las solicitudes que arrancaron sin la barrera no pueden confirmarse
        # después de activarla. Visitas nuevas se comprueban antes de su INSERT.
        if type(captured) is not int:
            raise DiscardError(409, 'REVISION_INFERENCIA_REQUERIDA')
        if visit_id is not None and DiagnosisDiscardRepository.revision(visit_id, lock=True) != captured:
            raise DiscardError(409, 'INFERENCIA_OBSOLETA')

    @staticmethod
    def increment(visit_id):
        row = (RevisionInferenciaVisita.query.filter_by(visita_id=visit_id)
               .with_for_update().populate_existing().first())
        if row is None:
            row = RevisionInferenciaVisita(visita_id=visit_id, revision=0)
            db.session.add(row)
        if row.revision >= 2**63 - 1:
            raise DiscardError(409, 'REVISION_AGOTADA')
        row.revision += 1
        return row.revision

    @staticmethod
    def diagnosis(visit_id):
        return (Diagnostico.query.filter_by(visita_id=visit_id).with_for_update()
                .populate_existing().first())

    @staticmethod
    def details(diagnosis_id):
        return (DiagnosticoDetalle.query.filter_by(diagnostico_retinopatia_id=diagnosis_id)
                .order_by(DiagnosticoDetalle.id).with_for_update().populate_existing().all())

    @staticmethod
    def has_reports(visit_id):
        return db.session.query(Informe.id).filter_by(visita_id=visit_id).with_for_update().first() is not None

    @staticmethod
    def confirmation_ids(ids):
        if not ids:
            return set()
        # No adquirir locks de confirmación después de visita/diagnóstico.
        # Los escritores de consumo necesitan primero el mismo lock de visita;
        # las FK RESTRICT constituyen además una última defensa.
        return {id for (id,) in db.session.query(ConfirmacionExportacionRetinografo.detalle_id)
                .filter(ConfirmacionExportacionRetinografo.detalle_id.in_(ids)).all()}

    @staticmethod
    def operation(operation_id, *, lock=False):
        query = OperacionDescarteIA.query.filter_by(operacion_id=operation_id)
        return (query.with_for_update().populate_existing().first() if lock else query.first())

    @staticmethod
    def file_referenced(name, excluding=()):
        query = db.session.query(DiagnosticoDetalle.id).filter(
            (DiagnosticoDetalle.imagen_original_url == name) |
            (DiagnosticoDetalle.imagen_gradcam_url == name))
        if excluding:
            query = query.filter(~DiagnosticoDetalle.id.in_(excluding))
        return query.with_for_update().first() is not None

    @staticmethod
    def check_report(visit_id, expected):
        if not enabled():
            return
        require_ready()
        visit = DiagnosisDiscardRepository.lock_visit(visit_id)
        if visit is None or visit.estado == 'ANULADA':
            raise DiscardError(409, 'VISITA_NO_COMPATIBLE')
        if type(expected) is not int or expected < 0:
            raise DiscardError(409, 'REVISION_INFORME_REQUERIDA')
        if DiagnosisDiscardRepository.revision(visit_id, lock=True) != expected:
            raise DiscardError(409, 'CONTEXTO_INFORME_OBSOLETO')
