from database import db
from sqlalchemy import text
from src.models.patient_entities import Paciente

class PatientRepository:
    @staticmethod
    def obtener_pacientes():
        # Usa raw SQL para uniones complejas con tablas aún no migradas (Diagnostico)
        query = text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.nro_documento, 
                p.nombres,
                p.apellidos,
                p.sexo,
                p.fecha_nacimiento,
                p.telefono,
                MAX(d.fecha_registro) AS ultima_visita,
                MAX(dd.diagnostico_final) AS maxima_gravedad
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc = td.id
            LEFT JOIN diagnosticos d ON p.id = d.paciente_id 
            LEFT JOIN diagnosticos_detalle dd ON d.id = dd.diagnostico_id
            WHERE p.estado = 'ACTIVO'
            GROUP BY p.id, td.codigo
            ORDER BY p.id DESC
        """)
        result = db.session.execute(query)
        # Convert to list of dicts to match previous pymysql behavior
        return [dict(row._mapping) for row in result]

    @staticmethod
    def obtener_paciente_por_nrodocumento(nro_documento: str) -> Paciente:
        return Paciente.query.filter_by(nro_documento=nro_documento).first()

    @staticmethod
    def insertar_paciente(paciente: Paciente):
        db.session.add(paciente)
        db.session.commit()

    @staticmethod
    def obtener_paciente_por_id(paciente_id: int):
        # We can use ORM and return a dict
        query = text("""
            SELECT 
                p.id, 
                td.codigo AS tipo_doc_abrev,
                p.tipo_doc,
                p.nro_documento, 
                p.nombres, 
                p.apellidos, 
                p.sexo, 
                p.fecha_nacimiento, 
                p.telefono 
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc = td.id
            WHERE p.id = :paciente_id
        """)
        result = db.session.execute(query, {"paciente_id": paciente_id}).first()
        return dict(result._mapping) if result else None

    @staticmethod
    def obtener_diagnosticos_paciente(paciente_id: int):
        query = text("""
            SELECT
                d.id AS diagnostico_id,
                d.fecha_registro AS fecha_visita,
                CONCAT(u.nombres, ' ', u.apellidos) AS medico_tratante,
                CASE WHEN COUNT(DISTINCT dd.id) > 0 THEN 1 ELSE 0 END AS tiene_diagnostico_ia,
                CASE WHEN COUNT(DISTINCT i.id) > 0 THEN 1 ELSE 0 END AS tiene_informes
            FROM diagnosticos d
            JOIN usuarios u ON d.usuario_id = u.id
            LEFT JOIN diagnosticos_detalle dd ON dd.diagnostico_id = d.id
            LEFT JOIN informes i ON i.diagnostico_id = d.id AND i.estado = 'ACTIVO'
            WHERE d.paciente_id = :paciente_id
            GROUP BY d.id, d.fecha_registro, u.nombres, u.apellidos
            ORDER BY d.fecha_registro DESC
        """)
        result = db.session.execute(query, {"paciente_id": paciente_id})
        return [dict(row._mapping) for row in result]

    @staticmethod
    def buscar_paciente(query_text: str):
        search_pattern = f"%{query_text}%"
        query = text("""
            SELECT p.id, td.codigo AS tipo_doc_abrev, p.tipo_doc, p.nro_documento, p.nombres, p.apellidos 
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc = td.id
            WHERE p.estado = 'ACTIVO' AND (
                p.nro_documento LIKE :search_pattern 
                OR CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :search_pattern 
                OR CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :search_pattern
            )
            LIMIT 5
        """)
        result = db.session.execute(query, {"search_pattern": search_pattern})
        return [dict(row._mapping) for row in result]

    @staticmethod
    def obtener_pacientes_recientes(limit: int = 6):
        query = text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.nro_documento,
                p.nombres,
                p.apellidos
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc = td.id
            JOIN diagnosticos d ON p.id = d.paciente_id
            WHERE p.estado = 'ACTIVO'
            GROUP BY p.id, td.codigo
            ORDER BY MAX(d.fecha_registro) DESC
            LIMIT :limit
        """)
        result = db.session.execute(query, {"limit": limit})
        return [dict(row._mapping) for row in result]
