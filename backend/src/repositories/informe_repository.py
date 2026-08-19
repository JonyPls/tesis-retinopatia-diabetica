from database import db
from sqlalchemy import text
from src.models.informe_entities import Informe, TipoInforme
from src.models.diagnosis_entities import Diagnostico
import json

class InformeRepository:
    @staticmethod
    def listar_tipos_informe_activos():
        tipos = TipoInforme.query.filter_by(estado='ACTIVO').order_by(TipoInforme.id).all()
        return [{"id": r.id, "nombre": r.nombre, "descripcion": r.descripcion} for r in tipos]

    @staticmethod
    def obtener_tipo_informe_por_id(tipo_id: int):
        tipo = TipoInforme.query.filter_by(id=tipo_id, estado='ACTIVO').first()
        if tipo:
            return {"id": tipo.id, "nombre": tipo.nombre, "descripcion": tipo.descripcion}
        return None

    @staticmethod
    def crear_informe(diagnostico_id: int, tipo_informe_id: int, datos_estructurados):
        informe = Informe(
            diagnostico_id=diagnostico_id,
            tipo_informe_id=tipo_informe_id,
            datos_estructurados=datos_estructurados
        )
        db.session.add(informe)
        db.session.commit()
        return informe.id

    @staticmethod
    def obtener_informe_por_id(informe_id: int):
        informe = Informe.query.filter_by(id=informe_id, estado='ACTIVO').first()
        if informe:
            return {
                "id": informe.id,
                "diagnostico_id": informe.diagnostico_id,
                "tipo_informe_id": informe.tipo_informe_id,
                "tipo_informe_nombre": informe.tipo_informe.nombre,
                "datos_estructurados": informe.datos_estructurados,
                "estado": informe.estado,
                "fecha_creado": informe.fecha_creado,
                "fecha_actualizado": informe.fecha_actualizado
            }
        return None

    @staticmethod
    def actualizar_informe(informe_id: int, datos_estructurados):
        informe = Informe.query.filter_by(id=informe_id, estado='ACTIVO').first()
        if informe:
            informe.datos_estructurados = datos_estructurados
            db.session.commit()
            return 1
        return 0

    @staticmethod
    def eliminar_informe(informe_id: int):
        informe = Informe.query.get(informe_id)
        if informe:
            informe.estado = 'INACTIVO'
            db.session.commit()
            return 1
        return 0

    @staticmethod
    def listar_informes_por_paciente(paciente_id: int):
        # We need to join Diagnostico to filter by paciente_id
        informes = db.session.query(Informe, TipoInforme).join(
            TipoInforme, Informe.tipo_informe_id == TipoInforme.id
        ).join(
            Diagnostico, Informe.diagnostico_id == Diagnostico.id
        ).filter(
            Diagnostico.paciente_id == paciente_id,
            Informe.estado == 'ACTIVO'
        ).order_by(Informe.fecha_creado.desc()).all()

        return [
            {
                "id": inf.id,
                "diagnostico_id": inf.diagnostico_id,
                "tipo_informe_id": inf.tipo_informe_id,
                "tipo_informe_nombre": ti.nombre,
                "datos_estructurados": inf.datos_estructurados,
                "estado": inf.estado,
                "fecha_creado": inf.fecha_creado,
                "fecha_actualizado": inf.fecha_actualizado
            }
            for inf, ti in informes
        ]

    @staticmethod
    def obtener_informes_por_diagnostico(diagnostico_id: int):
        informes = db.session.query(Informe, TipoInforme).join(
            TipoInforme, Informe.tipo_informe_id == TipoInforme.id
        ).filter(
            Informe.diagnostico_id == diagnostico_id,
            Informe.estado == 'ACTIVO'
        ).order_by(TipoInforme.nombre).all()

        return [
            {
                "id": inf.id,
                "diagnostico_id": inf.diagnostico_id,
                "tipo_informe_id": inf.tipo_informe_id,
                "tipo_informe_nombre": ti.nombre,
                "datos_estructurados": inf.datos_estructurados,
                "estado": inf.estado,
                "fecha_creado": inf.fecha_creado,
                "fecha_actualizado": inf.fecha_actualizado
            }
            for inf, ti in informes
        ]
