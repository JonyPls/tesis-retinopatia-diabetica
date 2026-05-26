from models.document_model import obtener_tipos_documento_activos

def obtener_lista_documentos():
    try:
        resultados = obtener_tipos_documento_activos()
        return {
            "status": "success",
            "data": resultados
        }, 200
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500