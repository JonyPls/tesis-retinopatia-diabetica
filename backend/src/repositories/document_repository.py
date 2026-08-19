from src.models.auth_entities import TipoDocumento

class DocumentRepository:
    @staticmethod
    def obtener_tipo_documento_por_codigo(codigo: str):
        td = TipoDocumento.query.filter_by(codigo=codigo).first()
        if td:
            return {"id": td.id, "nombre": td.nombre, "codigo": td.codigo}
        return None

    @staticmethod
    def obtener_tipos_documento_activos():
        tipos = TipoDocumento.query.filter_by(estado='A').order_by(TipoDocumento.id).all()
        return [{"id": t.id, "nombre": t.nombre, "codigo": t.codigo} for t in tipos]
