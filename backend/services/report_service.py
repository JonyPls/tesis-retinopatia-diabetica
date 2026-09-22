import json
import os
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app
from PIL import Image as PILImage
from pypdf import PageObject, PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from src.models.auth_entities import Usuario
from src.models.diagnosis_entities import Diagnostico
from src.models.patient_entities import VisitaClinica

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOAD_FOLDER = os.path.join(BACKEND_DIR, "uploads", "retinas")
PDF_TEMPLATE_PATH = os.path.join(BACKEND_DIR, "assets", "pdf", "plantilla_clinica.pdf")
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "America/Lima")
SCOPE_NOTE = (
    "El resultado generado por el modelo de inteligencia artificial constituye información de apoyo "
    "para la evaluación clínica. La clasificación final corresponde al especialista responsable."
)

try:
    LOCAL_TZ = ZoneInfo(APP_TIMEZONE)
except ZoneInfoNotFoundError:
    LOCAL_TZ = timezone(timedelta(hours=-5), name="America/Lima")

PROBABILITY_LABELS = [
    ("G0_Sin_DR", "Sin RD"),
    ("G1_Leve", "Leve"),
    ("G2_Moderada", "Moderada"),
    ("G3_Severa", "Severa"),
    ("G4_Proliferativa", "Proliferativa"),
]

PRESENTATION_LABELS = {
    "evaluacion de retinopatia diabetica": "Evaluación de retinopatía diabética",
    "retinopatia diabetica leve": "Retinopatía diabética leve",
    "retinopatia diabetica moderada": "Retinopatía diabética moderada",
    "retinopatia diabetica severa": "Retinopatía diabética severa",
    "retinopatia diabetica proliferativa": "Retinopatía diabética proliferativa",
}


class ReportNotFoundError(Exception):
    pass


class ReportTemplateError(Exception):
    pass


def _text(value, fallback="No disponible"):
    if value is None:
        return fallback
    value = str(value).strip()
    return value if value else fallback


def _local_now():
    return datetime.now(LOCAL_TZ)


def _display_datetime(value, naive_source_tz=timezone.utc):
    if value and getattr(value, "tzinfo", None):
        return value.astimezone(LOCAL_TZ).replace(tzinfo=None)
    if isinstance(value, datetime) and naive_source_tz:
        return value.replace(tzinfo=naive_source_tz).astimezone(LOCAL_TZ).replace(tzinfo=None)
    return value


def _format_datetime(value, include_time=True, naive_source_tz=timezone.utc):
    if not value:
        return "No disponible"
    value = _display_datetime(value, naive_source_tz=naive_source_tz)
    if include_time:
        return value.strftime("%d/%m/%Y %H:%M")
    return value.strftime("%d/%m/%Y")


def _presentation_label(value):
    text = _text(value)
    return PRESENTATION_LABELS.get(text.lower(), text)


def _format_percent(value):
    if value is None:
        return "No disponible"
    if isinstance(value, Decimal):
        value = float(value)
    value = float(value)
    if value <= 1:
        value *= 100
    return f"{value:.1f} %"


def _safe_filename(value):
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip())
    return clean.strip("._") or "paciente"


def _full_name(person):
    if not person:
        return "No disponible"
    return f"{_text(getattr(person, 'nombres', ''), '')} {_text(getattr(person, 'apellidos', ''), '')}".strip() or "No disponible"


def _professional_label(user):
    if not user:
        return "No disponible"
    name = _full_name(user)
    extras = []
    if getattr(user, "cmp", None):
        extras.append(f"CMP {user.cmp}")
    if getattr(user, "rne", None):
        extras.append(f"RNE {user.rne}")
    return f"{name} ({', '.join(extras)})" if extras else name


def _parse_resultado_completo(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return {}
    return value if isinstance(value, dict) else {}


def _probabilities_table(probabilities, styles):
    if not probabilities:
        return Paragraph("Probabilidades no disponibles.", styles["Muted"])

    rows = [[Paragraph("<b>Clase</b>", styles["TableHeader"]), Paragraph("<b>Probabilidad</b>", styles["TableHeader"])]]
    has_values = False
    for key, label in PROBABILITY_LABELS:
        if key not in probabilities:
            continue
        has_values = True
        rows.append([label, _format_percent(probabilities.get(key))])

    if not has_values:
        return Paragraph("Probabilidades no disponibles.", styles["Muted"])

    table = Table(rows, colWidths=[8.2 * cm, 3.6 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7F5F3")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#134E4A")),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D6E4E2")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _image_flowable(filename, max_width=5.0 * cm, max_height=3.2 * cm):
    if not filename:
        return None
    safe_name = os.path.basename(filename)
    path = os.path.join(UPLOAD_FOLDER, safe_name)
    if not os.path.isfile(path):
        return None

    try:
        with PILImage.open(path) as image:
            width, height = image.size
        scale = min(max_width / width, max_height / height)
        return Image(path, width=width * scale, height=height * scale)
    except Exception:
        return None


def _key_value_table(rows, styles, col_widths=None):
    data = [
        [
            Paragraph(f"<b>{label}</b>", styles["TableLabel"]),
            Paragraph(_text(value), styles["TableValue"]),
        ]
        for label, value in rows
        if value is not None
    ]
    table = Table(data, colWidths=col_widths or [4.8 * cm, 9.6 * cm])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D6E4E2")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F7F6")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _build_styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="TitleCenter",
            parent=base["Title"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#134E4A"),
            fontSize=13,
            leading=16,
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=base["Heading2"],
            textColor=colors.HexColor("#0F766E"),
            fontSize=11,
            leading=14,
            spaceBefore=6,
            spaceAfter=5,
        )
    )
    base.add(
        ParagraphStyle(
            name="EyeTitle",
            parent=base["Heading3"],
            textColor=colors.HexColor("#111827"),
            fontSize=11,
            leading=14,
            spaceAfter=5,
        )
    )
    base.add(
        ParagraphStyle(
            name="Muted",
            parent=base["BodyText"],
            textColor=colors.HexColor("#6B7280"),
            fontSize=7.8,
            leading=10,
        )
    )
    base.add(
        ParagraphStyle(
            name="TableLabel",
            parent=base["BodyText"],
            textColor=colors.HexColor("#374151"),
            fontSize=7.8,
            leading=9.5,
        )
    )
    base.add(
        ParagraphStyle(
            name="TableValue",
            parent=base["BodyText"],
            textColor=colors.HexColor("#111827"),
            fontSize=7.8,
            leading=9.5,
            alignment=TA_LEFT,
        )
    )
    base.add(
        ParagraphStyle(
            name="TableHeader",
            parent=base["BodyText"],
            textColor=colors.HexColor("#134E4A"),
            fontSize=7.8,
            leading=9.5,
        )
    )
    base.add(
        ParagraphStyle(
            name="FooterNote",
            parent=base["BodyText"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#4B5563"),
            fontSize=6.7,
            leading=8,
        )
    )
    return base


def _draw_scope_note(canvas, doc):
    styles = _build_styles()
    paragraph = Paragraph(SCOPE_NOTE, styles["FooterNote"])
    width = A4[0] - (3.0 * cm)
    _, height = paragraph.wrap(width, 1.2 * cm)
    paragraph.drawOn(canvas, 1.5 * cm, 2.05 * cm + max(0, (1.0 * cm - height) / 2))


def _apply_institutional_template(content_pdf_bytes):
    if not os.path.isfile(PDF_TEMPLATE_PATH):
        current_app.logger.error("Plantilla institucional de reporte PDF no encontrada.")
        raise ReportTemplateError("No se pudo generar el reporte institucional.")

    try:
        template_reader = PdfReader(PDF_TEMPLATE_PATH)
        content_reader = PdfReader(BytesIO(content_pdf_bytes))
        if not template_reader.pages:
            raise ReportTemplateError("No se pudo generar el reporte institucional.")

        writer = PdfWriter()
        for content_page in content_reader.pages:
            merged_page = PageObject.create_blank_page(width=A4[0], height=A4[1])
            merged_page.merge_page(template_reader.pages[0])
            merged_page.merge_page(content_page)
            writer.add_page(merged_page)

        output = BytesIO()
        writer.write(output)
        return output.getvalue()
    except ReportTemplateError:
        raise
    except Exception as exc:
        current_app.logger.exception("Error al aplicar plantilla institucional al reporte PDF.")
        raise ReportTemplateError("No se pudo generar el reporte institucional.") from exc


def _build_eye_section(detail, styles):
    resultado_completo = _parse_resultado_completo(detail.resultado_completo)
    probabilities = resultado_completo.get("probabilidades_detalle")
    ia_name = _presentation_label(detail.resultado_ia.nombre) if detail.resultado_ia else "No disponible"
    final_name = _presentation_label(detail.resultado_final.nombre) if detail.resultado_final else None
    final_display = final_name or "Pendiente de validación por especialista"
    validation_user = Usuario.query.get(detail.validado_por) if detail.validado_por else None
    original_image = _image_flowable(detail.imagen_original_url)
    gradcam_image = _image_flowable(detail.imagen_gradcam_url)

    rows = [
        ("Resultado generado por IA", ia_name),
        ("Grado IA", detail.resultado_ia_id),
        ("Confianza IA", _format_percent(detail.probabilidad_ia)),
        ("Resultado final del especialista", final_display),
        ("Estado de validación", detail.estado_validacion),
    ]

    elements = [
        Paragraph(
            "Ojo derecho (OD)" if detail.ojo_evaluado == "Derecho" else "Ojo izquierdo (OI)",
            styles["EyeTitle"],
        ),
        _key_value_table(rows, styles),
        Spacer(1, 0.15 * cm),
        Paragraph("Probabilidades por clase", styles["SectionTitle"]),
        _probabilities_table(probabilities, styles),
        Spacer(1, 0.15 * cm),
        Paragraph("Validación del especialista", styles["SectionTitle"]),
        _key_value_table(
            [
                ("Estado", detail.estado_validacion),
                ("Resultado final", final_display),
                ("Comentario médico", detail.comentario_medico),
                ("Motivo de corrección", detail.motivo_correccion),
                ("Fecha de validación", _format_datetime(detail.fecha_validacion) if detail.fecha_validacion else None),
                ("Profesional validador", _professional_label(validation_user) if validation_user else None),
            ],
            styles,
        ),
    ]

    image_items = []
    if original_image:
        image_items.append((Paragraph("<b>Retinografía original</b>", styles["TableHeader"]), original_image))
    if gradcam_image:
        image_items.append((Paragraph("<b>Grad-CAM</b>", styles["TableHeader"]), gradcam_image))

    if image_items:
        col_width = 5.6 * cm if len(image_items) > 1 else 8.0 * cm
        elements.extend(
            [
                Spacer(1, 0.15 * cm),
                Paragraph("Imágenes asociadas", styles["SectionTitle"]),
                Table(
                    [
                        [item[0] for item in image_items],
                        [item[1] for item in image_items],
                    ],
                    colWidths=[col_width] * len(image_items),
                    style=TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7F5F3")),
                            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D6E4E2")),
                            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 6),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                            ("TOPPADDING", (0, 0), (-1, -1), 5),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                        ]
                    ),
                ),
            ]
        )

    return KeepTogether(elements)


def generar_reporte_diagnostico_pdf(visita_id: int):
    visita = VisitaClinica.query.filter(
        VisitaClinica.id == visita_id,
        VisitaClinica.estado != "ANULADA",
    ).first()
    if not visita:
        raise ReportNotFoundError("Visita no encontrada.")

    diagnostico = Diagnostico.query.filter(
        Diagnostico.visita_id == visita_id,
        Diagnostico.estado != "ANULADO",
    ).first()
    if not diagnostico or not diagnostico.detalles:
        raise ReportNotFoundError("Diagnóstico de retinopatía no encontrado.")

    paciente = visita.paciente
    profesional = Usuario.query.get(visita.usuario_id)
    styles = _build_styles()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=4.25 * cm,
        bottomMargin=3.45 * cm,
        title="Reporte de evaluación de retinopatía diabética",
    )

    story = [
        Paragraph("REPORTE DE EVALUACIÓN DE RETINOPATÍA DIABÉTICA", styles["TitleCenter"]),
        Paragraph(f"Fecha de generación: {_format_datetime(_local_now(), naive_source_tz=None)}", styles["Muted"]),
        Spacer(1, 0.18 * cm),
        Paragraph("Datos del paciente", styles["SectionTitle"]),
        _key_value_table(
            [
                ("Paciente", _full_name(paciente)),
                (
                    "Documento",
                    f"{_text(paciente.tipo_documento.codigo if paciente.tipo_documento else None)} {_text(paciente.nro_documento)}",
                ),
                ("Sexo", paciente.sexo),
                ("Fecha de nacimiento", _format_datetime(paciente.fecha_nacimiento, include_time=False)),
            ],
            styles,
        ),
        Spacer(1, 0.2 * cm),
        Paragraph("Datos de la visita", styles["SectionTitle"]),
        _key_value_table(
            [
                ("Fecha y hora", _format_datetime(visita.fecha_visita)),
                ("Motivo de consulta", _presentation_label(visita.motivo_consulta)),
                ("Profesional responsable", _professional_label(profesional)),
                ("Estado de la visita", visita.estado),
                ("Modelo IA", diagnostico.modelo_nombre),
                ("Versión del modelo", diagnostico.modelo_version),
                ("Estado del diagnóstico", diagnostico.estado),
            ],
            styles,
        ),
    ]

    for detail in sorted(diagnostico.detalles, key=lambda item: 0 if item.ojo_evaluado == "Derecho" else 1):
        story.extend([Spacer(1, 0.2 * cm), _build_eye_section(detail, styles)])

    doc.build(story, onFirstPage=_draw_scope_note, onLaterPages=_draw_scope_note)
    pdf_bytes = _apply_institutional_template(buffer.getvalue())
    buffer.close()

    date_part = visita.fecha_visita.strftime("%Y-%m-%d") if visita.fecha_visita else _local_now().strftime("%Y-%m-%d")
    filename = f"reporte_RD_{_safe_filename(paciente.nro_documento)}_{date_part}.pdf"
    return pdf_bytes, filename
