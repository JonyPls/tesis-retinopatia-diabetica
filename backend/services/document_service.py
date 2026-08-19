from src.repositories.document_repository import DocumentRepository

def obtener_lista_documentos():
    try:
        resultados = DocumentRepository.obtener_tipos_documento_activos()
        return {
            "success": True,
            "data": resultados
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500