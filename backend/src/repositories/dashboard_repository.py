from sqlalchemy import case, func

from database import db
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle, GradoRetinopatia
from src.models.patient_entities import Paciente, VisitaClinica


class DashboardRepository:
    @staticmethod
    def counts():
        patients = db.session.query(func.count(Paciente.id)).filter(Paciente.estado == 'ACTIVO').scalar()

        per_diagnosis = (db.session.query(
            Diagnostico.id.label('id'),
            Diagnostico.estado.label('estado'),
            func.sum(case((DiagnosticoDetalle.resultado_ia_id.isnot(None), 1), else_=0)).label('ia'),
            func.sum(case((
                (DiagnosticoDetalle.estado_validacion == 'PENDIENTE') |
                (DiagnosticoDetalle.resultado_final_id.is_(None)), 1), else_=0)).label('incomplete'),
        ).join(VisitaClinica, VisitaClinica.id == Diagnostico.visita_id)
         .join(DiagnosticoDetalle, DiagnosticoDetalle.diagnostico_retinopatia_id == Diagnostico.id)
         .filter(Diagnostico.estado != 'ANULADO', VisitaClinica.estado != 'ANULADA')
         .group_by(Diagnostico.id, Diagnostico.estado).subquery())

        evaluated = per_diagnosis.c.ia > 0
        counts = db.session.query(
            func.count(case((evaluated, 1))),
            func.count(case((evaluated & (per_diagnosis.c.estado == 'VALIDADO') &
                             (per_diagnosis.c.incomplete == 0), 1))),
            func.count(case((evaluated & (per_diagnosis.c.incomplete > 0), 1))),
        ).one()
        return {
            'patients': int(patients or 0),
            'evaluations': int(counts[0] or 0),
            'validated': int(counts[1] or 0),
            'pending': int(counts[2] or 0),
        }

    @staticmethod
    def validated_eyes():
        grades = (db.session.query(GradoRetinopatia.id, GradoRetinopatia.nombre)
                  .filter(GradoRetinopatia.id.in_(range(5)))
                  .order_by(GradoRetinopatia.id).all())
        if [grade.id for grade in grades] != list(range(5)):
            raise ValueError('Catálogo de gravedad incompleto')
        counts = (db.session.query(DiagnosticoDetalle.resultado_final_id,
                                   func.count(DiagnosticoDetalle.id))
                  .join(Diagnostico, Diagnostico.id == DiagnosticoDetalle.diagnostico_retinopatia_id)
                  .join(VisitaClinica, VisitaClinica.id == Diagnostico.visita_id)
                  .filter(Diagnostico.estado != 'ANULADO', VisitaClinica.estado != 'ANULADA',
                          DiagnosticoDetalle.estado_validacion.in_(('APROBADO', 'CORREGIDO')),
                          DiagnosticoDetalle.resultado_final_id.isnot(None))
                  .group_by(DiagnosticoDetalle.resultado_final_id).all())
        by_grade = {level: int(count) for level, count in counts}
        return [{'level': grade.id, 'label': grade.nombre, 'count': by_grade.get(grade.id, 0)}
                for grade in grades]

    @staticmethod
    def recent_patients(limit=6):
        last_visit = (db.session.query(
            VisitaClinica.paciente_id.label('patient_id'),
            func.max(VisitaClinica.fecha_visita).label('last_visit'),
        ).filter(VisitaClinica.estado != 'ANULADA',
                 VisitaClinica.fecha_visita_origen == 'UTC_VERIFICADO')
         .group_by(VisitaClinica.paciente_id).subquery())
        rows = (db.session.query(Paciente.id, Paciente.nro_documento, Paciente.nombres,
                                 Paciente.apellidos, last_visit.c.last_visit)
                .join(last_visit, last_visit.c.patient_id == Paciente.id)
                .filter(Paciente.estado == 'ACTIVO')
                .order_by(last_visit.c.last_visit.desc(), Paciente.id.desc())
                .limit(limit).all())
        return [{'id': row.id, 'nro_documento': row.nro_documento,
                 'nombres': row.nombres, 'apellidos': row.apellidos,
                 'ultima_visita': row.last_visit, 'ultima_visita_origen': 'UTC_VERIFICADO'}
                for row in rows]
