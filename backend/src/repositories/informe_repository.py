from database import db
from src.models.informe_entities import Informe, TipoInforme
from src.models.patient_entities import VisitaClinica

class InformeRepository:
    @staticmethod
    def listar_tipos_informe_activos():
        tipos = TipoInforme.query.filter_by(estado='ACTIVO').order_by(TipoInforme.id).all()
        return [
            {
                "id": r.id,
                "nombre": r.nombre,
                "descripcion": r.descripcion,
                "codigo_formulario": r.codigo_formulario,
                "schema_version_actual": r.schema_version_actual,
            }
            for r in tipos
        ]

    @staticmethod
    def obtener_tipo_informe_por_id(tipo_id: int):
        tipo = TipoInforme.query.filter_by(id=tipo_id, estado='ACTIVO').first()
        if tipo:
            return {
                "id": tipo.id,
                "nombre": tipo.nombre,
                "descripcion": tipo.descripcion,
                "schema_version_actual": tipo.schema_version_actual,
            }
        return None

    @staticmethod
    def crear_visita(paciente_id: int, usuario_id: int):
        visita = VisitaClinica(
            paciente_id=paciente_id,
            usuario_id=usuario_id,
            motivo_consulta='Registro de informe clinico',
        )
        db.session.add(visita)
        db.session.flush()
        return visita.id

    @staticmethod
    def validar_visita(visita_id: int, paciente_id: int):
        visita = VisitaClinica.query.filter(
            VisitaClinica.id == visita_id,
            VisitaClinica.estado != 'ANULADA',
        ).first()
        if not visita:
            raise Exception("Visita clinica no encontrada o anulada.")
        if int(visita.paciente_id) != int(paciente_id):
            raise Exception("La visita seleccionada no pertenece al paciente.")
        return visita

    @staticmethod
    def crear_informe(visita_id: int, tipo_informe_id: int, usuario_id: int, datos_estructurados, schema_version: int = 1):
        existente = Informe.query.filter_by(
            visita_id=visita_id,
            tipo_informe_id=tipo_informe_id,
            estado='ACTIVO',
        ).first()
        if existente:
            raise Exception("Ya existe un informe activo de este tipo para la visita seleccionada.")

        informe = Informe(
            visita_id=visita_id,
            tipo_informe_id=tipo_informe_id,
            usuario_id=usuario_id,
            schema_version=schema_version,
            datos_estructurados=datos_estructurados,
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
                "visita_id": informe.visita_id,
                "diagnostico_id": informe.visita_id,
                "tipo_informe_id": informe.tipo_informe_id,
                "tipo_informe_nombre": informe.tipo_informe.nombre,
                "schema_version": informe.schema_version,
                "datos_estructurados": informe.datos_estructurados,
                "conclusion": informe.conclusion,
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
        informes = db.session.query(Informe, TipoInforme).join(
            TipoInforme, Informe.tipo_informe_id == TipoInforme.id
        ).join(
            VisitaClinica, Informe.visita_id == VisitaClinica.id
        ).filter(
            VisitaClinica.paciente_id == paciente_id,
            Informe.estado == 'ACTIVO'
        ).order_by(Informe.fecha_creado.desc()).all()

        return [
            {
                "id": inf.id,
                "visita_id": inf.visita_id,
                "diagnostico_id": inf.visita_id,
                "tipo_informe_id": inf.tipo_informe_id,
                "tipo_informe_nombre": ti.nombre,
                "schema_version": inf.schema_version,
                "datos_estructurados": inf.datos_estructurados,
                "conclusion": inf.conclusion,
                "estado": inf.estado,
                "fecha_creado": inf.fecha_creado,
                "fecha_actualizado": inf.fecha_actualizado
            }
            for inf, ti in informes
        ]

    @staticmethod
    def obtener_informes_por_visita(visita_id: int):
        informes = db.session.query(Informe, TipoInforme).join(
            TipoInforme, Informe.tipo_informe_id == TipoInforme.id
        ).filter(
            Informe.visita_id == visita_id,
            Informe.estado == 'ACTIVO'
        ).order_by(TipoInforme.nombre).all()

        return [
            {
                "id": inf.id,
                "visita_id": inf.visita_id,
                "diagnostico_id": inf.visita_id,
                "tipo_informe_id": inf.tipo_informe_id,
                "tipo_informe_nombre": ti.nombre,
                "schema_version": inf.schema_version,
                "datos_estructurados": inf.datos_estructurados,
                "conclusion": inf.conclusion,
                "estado": inf.estado,
                "fecha_creado": inf.fecha_creado,
                "fecha_actualizado": inf.fecha_actualizado
            }
            for inf, ti in informes
        ]

    @staticmethod
    def obtener_informes_por_diagnostico(diagnostico_id: int):
        return InformeRepository.obtener_informes_por_visita(diagnostico_id)
