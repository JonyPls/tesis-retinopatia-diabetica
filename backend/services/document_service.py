from models.document_model import obtener_tipos_documento_activos

def obtener_lista_documentos():
    try:
        resultados = obtener_tipos_documento_activos()
        return {
            "success": True,
            "data": resultados
        }, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500