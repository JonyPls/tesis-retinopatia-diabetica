from database import db
from datetime import datetime
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle, GradoRetinopatia
from src.models.patient_entities import VisitaClinica

class DiagnosisValidationError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


class DiagnosisRepository:
    @staticmethod
    def crear_diagnostico_y_detalle(datos_bd, visita_id=None):
        if visita_id is None:
            visita = VisitaClinica(
                paciente_id=datos_bd['paciente_id'],
                usuario_id=datos_bd['usuario_id'],
                motivo_consulta=datos_bd.get('motivo_consulta') or 'Evaluacion de retinopatia diabetica',
            )
            db.session.add(visita)
            db.session.flush()
            visita_id = visita.id
        else:
            visita = VisitaClinica.query.filter(
                VisitaClinica.id == visita_id,
                VisitaClinica.estado != 'ANULADA',
            ).first()
            if not visita:
                raise Exception("Visita clinica no encontrada o anulada.")
            if int(visita.paciente_id) != int(datos_bd['paciente_id']):
                raise Exception("La visita seleccionada no pertenece al paciente.")

        diag = Diagnostico.query.filter_by(visita_id=visita_id).first()
        if not diag:
            diag = Diagnostico(
                visita_id=visita_id,
                usuario_id=datos_bd['usuario_id'],
                modelo_nombre=datos_bd.get('modelo_nombre') or 'ResNet50',
                modelo_version=datos_bd.get('modelo_version'),
                estado='PROCESADO',
            )
            db.session.add(diag)
            db.session.flush()

        detalle = DiagnosticoDetalle.query.filter_by(
            diagnostico_retinopatia_id=diag.id,
            ojo_evaluado=datos_bd['ojo_evaluado']
        ).first()

        if not detalle:
            detalle = DiagnosticoDetalle(
                diagnostico_retinopatia_id=diag.id,
                ojo_evaluado=datos_bd['ojo_evaluado']
            )
            db.session.add(detalle)
        
        detalle.imagen_original_url = datos_bd['imagen_original_url']
        detalle.imagen_gradcam_url = datos_bd.get('imagen_gradcam_url')
        detalle.nombre_archivo_original = datos_bd.get('nombre_archivo_original')
        detalle.formato_archivo = datos_bd.get('formato_archivo')
        detalle.ancho_px = datos_bd.get('ancho_px')
        detalle.alto_px = datos_bd.get('alto_px')
        detalle.tamano_bytes = datos_bd.get('tamano_bytes')
        detalle.hash_archivo = datos_bd.get('hash_archivo')
        detalle.probabilidad_ia = datos_bd['probabilidad_ia']
        detalle.resultado_ia_id = datos_bd['resultado_ia']
        if datos_bd.get('resultado_completo'):
            detalle.resultado_completo = datos_bd['resultado_completo']
        
        detalle.estado_validacion = 'PENDIENTE'
        detalle.resultado_final_id = None
        detalle.comentario_medico = None
        detalle.motivo_correccion = None
        detalle.validado_por = None
        detalle.fecha_validacion = None
        diag.estado = 'PROCESADO'

        db.session.commit()
        return visita_id, diag.id, detalle.id

    @staticmethod
    def obtener_detalles_por_visita(visita_id: int):
        diagnostico = Diagnostico.query.filter_by(visita_id=visita_id).first()
        if not diagnostico:
            return None
        return DiagnosisRepository._detalles_to_dict(diagnostico.detalles)

    @staticmethod
    def obtener_detalles_por_diagnostico(diagnostico_id: int):
        diagnostico = Diagnostico.query.get(diagnostico_id)
        if not diagnostico:
            # Alias histórico por ID de visita; el ID real del diagnóstico prevalece.
            diagnostico = Diagnostico.query.filter_by(visita_id=diagnostico_id).first()
        if not diagnostico:
            return None
        return DiagnosisRepository._detalles_to_dict(diagnostico.detalles)

    @staticmethod
    def _detalles_to_dict(detalles):
        return [
            {
                "id": d.id,
                "ojo_evaluado": d.ojo_evaluado,
                "resultado_ia": d.resultado_ia_id,
                "probabilidad_ia": float(d.probabilidad_ia) if d.probabilidad_ia is not None else None,
                "resultado_completo": d.resultado_completo,
                "diagnostico_final": d.resultado_final_id,
                "estado_validacion": d.estado_validacion,
                "comentario_medico": d.comentario_medico,
                "motivo_correccion": d.motivo_correccion,
                "imagen_url": d.imagen_original_url,
                "gradcam_url": d.imagen_gradcam_url,
            }
            for d in detalles
        ]

    @staticmethod
    def validar_detalle_diagnostico(
        detalle_id: int,
        diagnostico_final: int,
        comentario_medico: str = None,
        motivo_correccion: str = None,
        usuario_id: int = None,
    ):
        # Bloquear primero el diagnóstico: dos ojos del mismo diagnóstico se
        # serializan; los demás diagnósticos no comparten bloqueo.
        diagnosis_id = db.session.query(DiagnosticoDetalle.diagnostico_retinopatia_id).filter_by(
            id=detalle_id
        ).scalar()
        if diagnosis_id is None:
            raise DiagnosisValidationError(404, "Detalle de diagnóstico no encontrado.")
        diagnostico = Diagnostico.query.filter_by(id=diagnosis_id).with_for_update().first()
        if diagnostico is None:
            raise DiagnosisValidationError(404, "Detalle de diagnóstico no encontrado.")
        detalle = DiagnosticoDetalle.query.filter_by(
            id=detalle_id, diagnostico_retinopatia_id=diagnosis_id,
        ).with_for_update().populate_existing().first()
        if detalle is None:
            raise DiagnosisValidationError(404, "Detalle de diagnóstico no encontrado.")
        if detalle.estado_validacion != 'PENDIENTE' or detalle.resultado_final_id is not None or detalle.validado_por is not None or detalle.fecha_validacion is not None:
            raise DiagnosisValidationError(409, "El detalle ya fue validado.")
        if diagnostico.estado != 'PROCESADO' or detalle.ojo_evaluado not in ('Derecho', 'Izquierdo') or detalle.resultado_ia_id is None:
            raise DiagnosisValidationError(409, "El detalle no está disponible para validación.")
        if not db.session.query(GradoRetinopatia.id).filter_by(
            id=diagnostico_final, estado='ACTIVO',
        ).first():
            raise DiagnosisValidationError(400, "Grado final no permitido.")

        resultado_ia = detalle.resultado_ia_id
        comentario_medico = comentario_medico.strip() if comentario_medico else None
        motivo_correccion = motivo_correccion.strip() if motivo_correccion else None

        if diagnostico_final == resultado_ia:
            estado_validacion = 'APROBADO'
            motivo_correccion = None
        else:
            estado_validacion = 'CORREGIDO'
            if not motivo_correccion:
                raise DiagnosisValidationError(400, "Debe registrar el motivo de corrección cuando el diagnóstico final cambia el resultado de la IA.")

        detalle.resultado_final_id = diagnostico_final
        detalle.estado_validacion = estado_validacion
        detalle.comentario_medico = comentario_medico
        detalle.motivo_correccion = motivo_correccion
        detalle.validado_por = usuario_id
        detalle.fecha_validacion = datetime.utcnow()

        db.session.flush()
        # Lectura actual (locking read): la autenticación pudo iniciar una
        # snapshot REPEATABLE READ antes de que terminara otra solicitud.
        estados = db.session.query(DiagnosticoDetalle.estado_validacion).filter_by(
            diagnostico_retinopatia_id=diagnosis_id,
        ).with_for_update().all()
        if estados and all(estado != 'PENDIENTE' for (estado,) in estados):
            diagnostico.estado = 'VALIDADO'
        
        db.session.commit()
        return estado_validacion


    @staticmethod
    def crear_visita_simple(paciente_id: int, usuario_id: int, motivo_consulta: str = None):
        visita = VisitaClinica(
            paciente_id=paciente_id,
            usuario_id=usuario_id,
            motivo_consulta=motivo_consulta,
        )
        db.session.add(visita)
        db.session.commit()
        return visita.id

    @staticmethod
    def crear_diagnostico_simple(paciente_id: int, usuario_id: int):
        return DiagnosisRepository.crear_visita_simple(paciente_id, usuario_id)
