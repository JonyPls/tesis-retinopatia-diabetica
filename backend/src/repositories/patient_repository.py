from database import db
from sqlalchemy import text
from src.models.patient_entities import Paciente
import json


def _extract_report_conclusion(datos_estructurados):
    datos = datos_estructurados
    if isinstance(datos, str):
        try:
            datos = json.loads(datos)
        except (TypeError, json.JSONDecodeError):
            return None
    if not isinstance(datos, dict):
        return None

    conclusion = datos.get("conclusion")
    if isinstance(conclusion, list):
        items = [str(item).strip() for item in conclusion if str(item).strip()]
        return "\n".join(items) if items else None
    if conclusion is None:
        return None
    texto = str(conclusion).strip()
    return texto or None

class PatientRepository:
    @staticmethod
    def obtener_pacientes(*, scope='clinical', include_severity=True):
        if scope not in ('clinical', 'assistance', 'administrative'):
            raise ValueError('Invalid patient scope')
        if include_severity and scope != 'clinical':
            raise ValueError('Severity requires clinical scope')
        visit_column = ', MAX(v.fecha_visita) AS ultima_visita' if scope != 'administrative' else ''
        consent_columns = (', p.consentimiento_informado, p.fecha_consentimiento'
                           if scope != 'administrative' else '')
        consent_group = (', p.consentimiento_informado, p.fecha_consentimiento'
                         if scope != 'administrative' else '')
        severity_column = (', MAX(COALESCE(drd.resultado_final_id, drd.resultado_ia_id)) '
                           'AS maxima_gravedad') if include_severity else ''
        visit_join = ("LEFT JOIN visitas_clinicas v ON p.id = v.paciente_id "
                      "AND v.estado <> 'ANULADA'") if scope != 'administrative' else ''
        diagnosis_join = ("LEFT JOIN diagnosticos_retinopatia dr ON v.id = dr.visita_id "
                          "AND dr.estado <> 'ANULADO' "
                          "LEFT JOIN diagnosticos_retinopatia_detalle drd "
                          "ON dr.id = drd.diagnostico_retinopatia_id") if include_severity else ''
        query = text(f"""
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
                p.direccion
                {consent_columns}
                {visit_column} {severity_column}
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc_id = td.id
            {visit_join}
            {diagnosis_join}
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
                p.direccion
                {consent_group}
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
    def obtener_paciente_por_id(paciente_id: int, *, scope='clinical'):
        if scope not in ('clinical', 'assistance', 'administrative'):
            raise ValueError('Invalid patient scope')
        sensitive_columns = {
            'clinical': ', p.consentimiento_informado, p.fecha_consentimiento, p.antecedentes_clinicos, p.alergias',
            'assistance': ', p.consentimiento_informado, p.fecha_consentimiento, p.alergias',
            'administrative': '',
        }[scope]
        query = text(f"""
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
                p.direccion
                {sensitive_columns}
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc_id = td.id
            WHERE p.id = :paciente_id
              AND p.estado = 'ACTIVO'
        """)
        result = db.session.execute(query, {"paciente_id": paciente_id}).first()
        return dict(result._mapping) if result else None

    @staticmethod
    def obtener_diagnosticos_paciente(paciente_id: int):
        visitas_query = text("""
            SELECT
                v.id AS visita_id,
                v.id AS diagnostico_id,
                dr.id AS diagnostico_retinopatia_id,
                dr.estado AS diagnostico_ia_estado,
                dr.modelo_nombre,
                dr.modelo_version,
                v.fecha_visita AS fecha_visita,
                CONCAT(u.nombres, ' ', u.apellidos) AS medico_tratante,
                v.motivo_consulta,
                v.observaciones,
                v.estado,
                CASE WHEN COUNT(DISTINCT drd.id) > 0 THEN 1 ELSE 0 END AS tiene_diagnostico_ia,
                CASE WHEN COUNT(DISTINCT i.id) > 0 THEN 1 ELSE 0 END AS tiene_informes,
                COUNT(DISTINCT drd.id) AS total_ojos_diagnosticados,
                COUNT(DISTINCT i.id) AS total_informes,
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
                dr.estado,
                dr.modelo_nombre,
                dr.modelo_version,
                v.fecha_visita,
                u.nombres,
                u.apellidos,
                v.motivo_consulta,
                v.observaciones,
                v.estado
            ORDER BY v.fecha_visita DESC
        """)
        visitas_result = db.session.execute(visitas_query, {"paciente_id": paciente_id})
        visitas = [dict(row._mapping) for row in visitas_result]

        if not visitas:
            return []

        detalles_query = text("""
            SELECT
                dr.visita_id,
                drd.id AS detalle_id,
                drd.ojo_evaluado,
                drd.resultado_ia_id,
                gia.nombre AS resultado_ia_nombre,
                drd.resultado_final_id,
                gfinal.nombre AS resultado_final_nombre,
                drd.probabilidad_ia,
                drd.estado_validacion,
                drd.comentario_medico,
                drd.motivo_correccion,
                drd.imagen_original_url,
                drd.imagen_gradcam_url,
                drd.nombre_archivo_original,
                drd.fecha_validacion
            FROM diagnosticos_retinopatia dr
            JOIN visitas_clinicas v ON v.id = dr.visita_id
            JOIN diagnosticos_retinopatia_detalle drd ON drd.diagnostico_retinopatia_id = dr.id
            LEFT JOIN grados_retinopatia gia ON gia.id = drd.resultado_ia_id
            LEFT JOIN grados_retinopatia gfinal ON gfinal.id = drd.resultado_final_id
            WHERE v.paciente_id = :paciente_id
              AND v.estado <> 'ANULADA'
              AND dr.estado <> 'ANULADO'
            ORDER BY dr.visita_id DESC, FIELD(drd.ojo_evaluado, 'Derecho', 'Izquierdo')
        """)
        detalles_result = db.session.execute(detalles_query, {"paciente_id": paciente_id})
        detalles_por_visita = {}
        for row in detalles_result:
            detalle = dict(row._mapping)
            visita_id = detalle.pop("visita_id")
            if detalle.get("probabilidad_ia") is not None:
                detalle["probabilidad_ia"] = float(detalle["probabilidad_ia"])
            detalles_por_visita.setdefault(visita_id, []).append(detalle)

        informes_query = text("""
            SELECT
                i.visita_id,
                i.id,
                i.tipo_informe_id,
                ti.nombre AS tipo_informe_nombre,
                i.conclusion,
                i.datos_estructurados,
                i.estado,
                i.fecha_creado,
                i.fecha_actualizado
            FROM informes i
            JOIN tipos_informe ti ON ti.id = i.tipo_informe_id
            JOIN visitas_clinicas v ON v.id = i.visita_id
            WHERE v.paciente_id = :paciente_id
              AND v.estado <> 'ANULADA'
              AND i.estado = 'ACTIVO'
            ORDER BY i.visita_id DESC, ti.nombre ASC
        """)
        informes_result = db.session.execute(informes_query, {"paciente_id": paciente_id})
        informes_por_visita = {}
        for row in informes_result:
            informe = dict(row._mapping)
            visita_id = informe.pop("visita_id")
            if not informe.get("conclusion"):
                informe["conclusion"] = _extract_report_conclusion(
                    informe.get("datos_estructurados")
                )
            informes_por_visita.setdefault(visita_id, []).append(informe)

        for visita in visitas:
            visita_id = visita["visita_id"]
            detalles = detalles_por_visita.get(visita_id, [])
            visita["informes"] = informes_por_visita.get(visita_id, [])
            visita["diagnostico_ia"] = None

            if visita.get("diagnostico_retinopatia_id"):
                visita["diagnostico_ia"] = {
                    "id": visita["diagnostico_retinopatia_id"],
                    "estado": visita.get("diagnostico_ia_estado"),
                    "modelo_nombre": visita.get("modelo_nombre"),
                    "modelo_version": visita.get("modelo_version"),
                    "detalles": detalles,
                }

        return visitas

    @staticmethod
    def buscar_paciente(query_text: str, page: int = 1, per_page: int = 5,
                        *, include_last_visit: bool = True):
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
        """) if include_last_visit else text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.tipo_doc_id,
                td.codigo AS tipo_doc,
                p.nro_documento,
                p.nombres,
                p.apellidos
            FROM pacientes p
            LEFT JOIN tipos_documento td ON p.tipo_doc_id = td.id
            WHERE p.estado = 'ACTIVO' AND (
                p.nro_documento LIKE :search_pattern
                OR CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :search_pattern
                OR CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :search_pattern
            )
            ORDER BY
                CASE
                    WHEN p.nro_documento LIKE :prefix_pattern THEN 0
                    WHEN CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, '')) LIKE :prefix_pattern THEN 1
                    WHEN CONCAT(COALESCE(p.apellidos, ''), ' ', COALESCE(p.nombres, '')) LIKE :prefix_pattern THEN 2
                    ELSE 3
                END,
                p.fecha_creado DESC, p.id DESC
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
    def obtener_pacientes_recientes(limit: int = 6, *, include_last_visit: bool = True):
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
        """) if include_last_visit else text("""
            SELECT
                p.id,
                td.codigo AS tipo_doc_abrev,
                p.nro_documento,
                p.nombres,
                p.apellidos
            FROM pacientes p
            JOIN tipos_documento td ON p.tipo_doc_id = td.id
            WHERE p.estado = 'ACTIVO'
            ORDER BY p.fecha_creado DESC, p.id DESC
            LIMIT :limit
        """)
        result = db.session.execute(query, {"limit": limit})
        return [dict(row._mapping) for row in result]
