from database import db
from sqlalchemy import text
from src.models.diagnosis_entities import Diagnostico, DiagnosticoDetalle
import json

class DiagnosisRepository:
    @staticmethod
    def crear_diagnostico_y_detalle(datos_bd, diagnostico_id=None):
        if diagnostico_id is None:
            diag = Diagnostico(
                paciente_id=datos_bd['paciente_id'],
                usuario_id=datos_bd['usuario_id']
            )
            db.session.add(diag)
            db.session.flush() # To get the ID
            diagnostico_id = diag.id

        # Upsert equivalent logic for details:
        detalle = DiagnosticoDetalle.query.filter_by(
            diagnostico_id=diagnostico_id,
            ojo_evaluado=datos_bd['ojo_evaluado']
        ).first()

        if not detalle:
            detalle = DiagnosticoDetalle(
                diagnostico_id=diagnostico_id,
                ojo_evaluado=datos_bd['ojo_evaluado']
            )
            db.session.add(detalle)
        
        detalle.imagen_url = datos_bd['imagen_url']
        detalle.resultado_ia = datos_bd['resultado_ia']
        detalle.probabilidad_ia = datos_bd['probabilidad_ia']
        if datos_bd.get('resultado_completo'):
            detalle.resultado_completo = datos_bd['resultado_completo']
        
        detalle.estado_validacion = 'Pendiente'
        detalle.diagnostico_final = None
        detalle.comentario_medico = None

        db.session.commit()
        return diagnostico_id, detalle.id

    @staticmethod
    def obtener_detalles_por_diagnostico(diagnostico_id: int):
        detalles = DiagnosticoDetalle.query.filter_by(diagnostico_id=diagnostico_id).all()
        # Convert to dict to maintain backwards compatibility with the service layer expectations
        return [
            {
                "id": d.id,
                "ojo_evaluado": d.ojo_evaluado,
                "resultado_ia": d.resultado_ia,
                "probabilidad_ia": float(d.probabilidad_ia) if d.probabilidad_ia else None,
                "resultado_completo": d.resultado_completo,
                "diagnostico_final": d.diagnostico_final,
                "estado_validacion": d.estado_validacion,
                "comentario_medico": d.comentario_medico,
                "imagen_url": d.imagen_url
            }
            for d in detalles
        ]

    @staticmethod
    def validar_detalle_diagnostico(detalle_id: int, diagnostico_final: int, comentario_medico: str = None):
        detalle = DiagnosticoDetalle.query.get(detalle_id)
        if not detalle:
            raise Exception("Detalle de diagnóstico no encontrado.")

        resultado_ia = detalle.resultado_ia

        if int(diagnostico_final) == int(resultado_ia):
            estado_validacion = 'Aprobado'
        else:
            estado_validacion = 'Corregido'

        detalle.diagnostico_final = diagnostico_final
        detalle.estado_validacion = estado_validacion
        detalle.comentario_medico = comentario_medico
        
        db.session.commit()
        return estado_validacion

    @staticmethod
    def crear_diagnostico_simple(paciente_id: int, usuario_id: int):
        diag = Diagnostico(paciente_id=paciente_id, usuario_id=usuario_id)
        db.session.add(diag)
        db.session.commit()
        return diag.id
