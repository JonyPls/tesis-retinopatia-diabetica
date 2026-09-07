from database import db
from sqlalchemy import text
from src.models.patient_entities import Paciente

class PatientRepository:
    @staticmethod
    def obtener_pacientes():
        query = text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.tipo_doc_id,
                p.nro_documento, 
                p.nombres,
                p.apellidos,
                p.sexo,
                p.fecha_nacimiento,
                p.telefono,
                p.correo,
                p.direccion,
                p.antecedentes_clinicos,
                p.alergias,
                p.consentimiento_informado,
                p.fecha_consentimiento,
                MAX(v.fecha_visita) AS ultima_visita,
                MAX(COALESCE(drd.resultado_final_id, drd.resultado_ia_id)) AS maxima_gravedad
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc_id = td.id
            LEFT JOIN visitas_clinicas v ON p.id = v.paciente_id AND v.estado <> 'ANULADA'
            LEFT JOIN diagnosticos_retinopatia dr ON v.id = dr.visita_id AND dr.estado <> 'ANULADO'
            LEFT JOIN diagnosticos_retinopatia_detalle drd ON dr.id = drd.diagnostico_retinopatia_id
            WHERE p.estado = 'ACTIVO'
            GROUP BY
                p.id,
                td.codigo,
                p.tipo_doc_id,
                p.nro_documento,
                p.nombres,
                p.apellidos,
                p.sexo,
                p.fecha_nacimiento,
                p.telefono,
                p.correo,
                p.direccion,
                p.antecedentes_clinicos,
                p.alergias,
                p.consentimiento_informado,
                p.fecha_consentimiento
            ORDER BY p.id DESC
        """)
        result = db.session.execute(query)
        return [dict(row._mapping) for row in result]

    @staticmethod
    def obtener_paciente_por_documento(tipo_doc_id: int, nro_documento: str) -> Paciente:
        return Paciente.query.filter_by(
            tipo_doc_id=tipo_doc_id,
            nro_documento=nro_documento
        ).first()

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
                p.tipo_doc_id,
                td.codigo AS tipo_doc,
                p.nro_documento, 
                p.nombres, 
                p.apellidos, 
                p.sexo, 
                p.fecha_nacimiento, 
                p.telefono,
                p.correo,
                p.direccion,
                p.antecedentes_clinicos,
                p.alergias,
                p.consentimiento_informado,
                p.fecha_consentimiento
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc_id = td.id
            WHERE p.id = :paciente_id
              AND p.estado = 'ACTIVO'
        """)
        result = db.session.execute(query, {"paciente_id": paciente_id}).first()
        return dict(result._mapping) if result else None

    @staticmethod
    def obtener_diagnosticos_paciente(paciente_id: int):
        query = text("""
            SELECT
                v.id AS visita_id,
                v.id AS diagnostico_id,
                dr.id AS diagnostico_retinopatia_id,
                v.fecha_visita AS fecha_visita,
                CONCAT(u.nombres, ' ', u.apellidos) AS medico_tratante,
                v.motivo_consulta,
                v.observaciones,
                v.estado,
                CASE WHEN COUNT(DISTINCT drd.id) > 0 THEN 1 ELSE 0 END AS tiene_diagnostico_ia,
                CASE WHEN COUNT(DISTINCT i.id) > 0 THEN 1 ELSE 0 END AS tiene_informes,
                MAX(COALESCE(drd.resultado_final_id, drd.resultado_ia_id)) AS maxima_gravedad
            FROM visitas_clinicas v
            JOIN usuarios u ON v.usuario_id = u.id
            LEFT JOIN diagnosticos_retinopatia dr ON dr.visita_id = v.id AND dr.estado <> 'ANULADO'
            LEFT JOIN diagnosticos_retinopatia_detalle drd ON drd.diagnostico_retinopatia_id = dr.id
            LEFT JOIN informes i ON i.visita_id = v.id AND i.estado = 'ACTIVO'
            WHERE v.paciente_id = :paciente_id
              AND v.estado <> 'ANULADA'
            GROUP BY
                v.id,
                dr.id,
                v.fecha_visita,
                u.nombres,
                u.apellidos,
                v.motivo_consulta,
                v.observaciones,
                v.estado
            ORDER BY v.fecha_visita DESC
        """)
        result = db.session.execute(query, {"paciente_id": paciente_id})
        return [dict(row._mapping) for row in result]

    @staticmethod
    def buscar_paciente(query_text: str, page: int = 1, per_page: int = 5):
        search_pattern = f"%{query_text}%"
        prefix_pattern = f"{query_text}%"
        offset = (page - 1) * per_page

        count_query = text("""
            SELECT COUNT(*) AS total
            FROM pacientes p
            WHERE p.estado = 'ACTIVO' AND (
                p.nro_documento LIKE :search_pattern
                OR CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :search_pattern
                OR CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :search_pattern
            )
        """)

        query = text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.tipo_doc_id,
                td.codigo AS tipo_doc,
                p.nro_documento,
                p.nombres,
                p.apellidos,
                MAX(v.fecha_visita) AS ultima_visita
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc_id = td.id
            LEFT JOIN visitas_clinicas v ON p.id = v.paciente_id AND v.estado <> 'ANULADA'
            WHERE p.estado = 'ACTIVO' AND (
                p.nro_documento LIKE :search_pattern 
                OR CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :search_pattern 
                OR CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :search_pattern
            )
            GROUP BY
                p.id,
                td.codigo,
                p.tipo_doc_id,
                p.nro_documento,
                p.nombres,
                p.apellidos
            ORDER BY
                CASE
                    WHEN p.nro_documento LIKE :prefix_pattern THEN 0
                    WHEN CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :prefix_pattern THEN 1
                    WHEN CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :prefix_pattern THEN 2
                    ELSE 3
                END,
                COALESCE(MAX(v.fecha_visita), p.fecha_creado) DESC
            LIMIT :per_page OFFSET :offset
        """)
        params = {
            "search_pattern": search_pattern,
            "prefix_pattern": prefix_pattern,
            "per_page": per_page,
            "offset": offset,
        }
        total_result = db.session.execute(count_query, params).first()
        result = db.session.execute(query, params)
        total = int(total_result._mapping["total"]) if total_result else 0
        return [dict(row._mapping) for row in result], total

    @staticmethod
    def obtener_pacientes_recientes(limit: int = 6):
        query = text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.nro_documento,
                p.nombres,
                p.apellidos,
                MAX(v.fecha_visita) AS ultima_visita
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc_id = td.id
            LEFT JOIN visitas_clinicas v ON p.id = v.paciente_id AND v.estado <> 'ANULADA'
            WHERE p.estado = 'ACTIVO'
            GROUP BY p.id, td.codigo, p.nro_documento, p.nombres, p.apellidos
            ORDER BY COALESCE(MAX(v.fecha_visita), p.fecha_creado) DESC
            LIMIT :limit
        """)
        result = db.session.execute(query, {"limit": limit})
        return [dict(row._mapping) for row in result]
