from flask import current_app
from src.repositories.document_repository import DocumentRepository

def obtener_lista_documentos():
    try:
        resultados = DocumentRepository.obtener_tipos_documento_activos()
        return {
            "success": True,
            "data": resultados
        }, 200
    except Exception:
        current_app.logger.exception("Error al obtener documentos")
        return {"success": False, "message": "No se pudo procesar la solicitud."}, 500
