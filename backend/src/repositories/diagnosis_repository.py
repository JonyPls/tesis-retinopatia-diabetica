from database import db
from datetime import datetime
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle
from src.models.patient_entities import VisitaClinica

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
                estado='PENDIENTE',
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
        
        detalle.estado_validacion = 'Pendiente'
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
            return []
        return DiagnosisRepository._detalles_to_dict(diagnostico.detalles)

    @staticmethod
    def obtener_detalles_por_diagnostico(diagnostico_id: int):
        diagnostico = Diagnostico.query.get(diagnostico_id)
        if diagnostico:
            detalles = diagnostico.detalles
        else:
            detalles = DiagnosticoDetalle.query.join(Diagnostico).filter(
                Diagnostico.visita_id == diagnostico_id
            ).all()
        return DiagnosisRepository._detalles_to_dict(detalles)

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
                "imagen_url": d.imagen_original_url,
                "gradcam_url": d.imagen_gradcam_url,
            }
            for d in detalles
        ]

    @staticmethod
    def validar_detalle_diagnostico(detalle_id: int, diagnostico_final: int, comentario_medico: str = None, usuario_id: int = None):
        detalle = DiagnosticoDetalle.query.get(detalle_id)
        if not detalle:
            raise Exception("Detalle de diagnóstico no encontrado.")

        resultado_ia = detalle.resultado_ia_id

        if int(diagnostico_final) == int(resultado_ia):
            estado_validacion = 'Aprobado'
        else:
            estado_validacion = 'Corregido'

        detalle.resultado_final_id = diagnostico_final
        detalle.estado_validacion = estado_validacion
        detalle.comentario_medico = comentario_medico
        detalle.validado_por = usuario_id
        detalle.fecha_validacion = datetime.utcnow()

        diagnostico = Diagnostico.query.get(detalle.diagnostico_retinopatia_id)
        if diagnostico and all(d.estado_validacion != 'Pendiente' for d in diagnostico.detalles):
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
