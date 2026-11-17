"""Test-only API contracts; in-memory fixtures, no database, app.py or models."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import base64
import copy
import datetime as dt
import json
import re
import threading
import time

ROOT=Path(__file__).resolve().parents[4]
RUN=json.loads((ROOT/'docs/tesis/pruebas/ejecucion_caja_negra_actual.json').read_text(encoding='utf-8-sig'))
OUT=Path(RUN['evidence'])
STAMP='2026-11-03T15:00:00Z'
LOCK=threading.RLock()
def patient(i,n,doc):
    return dict(id=i,tipo_doc_id=1,tipo_doc='DNI',tipo_doc_abrev='DNI',nro_documento=doc,nombres=n,
        apellidos='Prueba Sintética',nombres_apellidos=n+' Prueba Sintética',sexo='Femenino',fecha_nacimiento='2000-01-01',
        telefono='',correo=None,direccion='',antecedentes_clinicos='',alergias='',consentimiento_informado=True,
        ultima_visita=STAMP,ultima_visita_origen='UTC_VERIFICADO',visitas_sin_fecha_verificada=0,maxima_gravedad=None)
def visit(i,p,m):
    return dict(visita_id=i,diagnostico_id=i,diagnostico_retinopatia_id=None,paciente_id=p,fecha_visita=STAMP,
        fecha_visita_origen='UTC_VERIFICADO',medico_tratante='Actor Simulado',motivo_consulta=m,estado='ACTIVA',
        tiene_diagnostico_ia=0,tiene_informes=1,total_informes=1,total_ojos_diagnosticados=0,maxima_gravedad=None,
        diagnostico_ia=None,informes=[])
PATIENTS=[patient(501,'Ana','90000001'),patient(502,'Beatriz','90000002')]
VISITS=[visit(901,501,'CN04 V1 informe sintético'),visit(902,501,'CN04 V2 informe sintético'),visit(903,501,'CN04 V0 sin informes'),visit(904,502,'CN04 VB control')]
VISITS[2].update(tiene_informes=0,total_informes=0)
TYPES=[dict(id=4,nombre='Paquimetría',descripcion='Medición de grosor corneal',codigo_formulario='paquimetria',schema_version_actual=1),
       dict(id=3,nombre='Gonioscopía',descripcion='Evaluación de ángulo',codigo_formulario='gonioscopia',schema_version_actual=1),
       dict(id=2,nombre='Campo visual',descripcion='Campo visual',codigo_formulario='campo_visual',schema_version_actual=1)]
def report(i,v,marker,value):
    return dict(id=i,visita_id=v,diagnostico_id=v,tipo_informe_id=4,tipo_informe_nombre='Paquimetría',
        schema_version=1,revision_actual=1,datos_estructurados={'ojos':['OD','OI'],'valores':{'od':value,'oi':value+2}},
        conclusion=marker,estado='ACTIVO',fecha_creado=STAMP,fecha_actualizado=STAMP,
        fecha_creado_origen='UTC_VERIFICADO',fecha_actualizado_origen='UTC_VERIFICADO')
REPORTS=[report(701,901,'CN04-V1',540),report(702,902,'CN04-V2',550),report(703,904,'CN04-VB',560)]
DETAILS={}
if (OUT/'estado-simulador.json').exists():
    saved=json.loads((OUT/'estado-simulador.json').read_text(encoding='utf-8'))
    PATIENTS,VISITS,REPORTS=saved['patients'],saved['visits'],saved['reports']
    DETAILS=saved['details']
PERMISSIONS=['pacientes.ver','pacientes.crear','visitas.ver','visitas.crear','informes.ver','informes.crear',
             'imagenes.ver','diagnostico_retinopatia.ver','diagnostico_retinopatia.crear']
def log(method,path,status,extra=None):
    # Never persist Authorization, passwords, cookies or multipart image bytes.
    event=dict(utc=dt.datetime.now(dt.timezone.utc).isoformat(),method=method,path=path,status=status,
               scope='API_SIMULADA_EN_MEMORIA')
    if extra:event.update(extra)
    with LOCK:
        with (OUT/'api-simulada.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(event,ensure_ascii=False)+'\n')
def decorated_reports(visit_id):return [copy.deepcopy(r) for r in REPORTS if r['visita_id']==visit_id]
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data,path,extra=None,ctype='application/json'):
        raw=json.dumps(data,ensure_ascii=False).encode() if ctype=='application/json' else data
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)))
        self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:4187');self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
        log(self.command,path,status,extra)
    def do_OPTIONS(self):self.reply(200,{},self.path)
    def do_GET(self):
        parsed=urlparse(self.path);p=parsed.path;q=parse_qs(parsed.query)
        ok=lambda data,**kw:self.reply(200,dict(success=True,data=data,**kw),p)
        if p.startswith('/evidencias/CB-'):
            code=p.rsplit('/',1)[-1]
            if code not in ['CB-01','CB-02','CB-04','CB-05']:return self.reply(404,{},p)
            file=ROOT/'docs/tesis/pruebas/evidencias/20261103T160850Z-421d66ca'/code/'reporte.html'
            return self.reply(200,file.read_bytes(),p,ctype='text/html; charset=utf-8')
        if p.startswith('/uploads/') or p=='/fixture.png':
            return self.reply(200,(OUT/'fixtures/imagen-sintetica.png').read_bytes(),p,ctype='image/png')
        if p=='/api/configuracion/catalogo':return self.reply(403,{'success':False,'message':'No autorizado.'},p)
        if p=='/api/dashboard/clinico':return ok(dict(kpis=dict(patients=len(PATIENTS),evaluations=0,validated=0,pending=0),severity=[],recent_patients=PATIENTS,actions=dict(patients=True,diagnosis=True,reports=True)))
        if p=='/api/tipos-informe':return ok(TYPES)
        if p in ['/api/pacientes','/api/pacientes/recientes','/api/pacientes/buscar']:
            text=q.get('q',[''])[0].lower();data=[x for x in PATIENTS if text in (x['nombres']+' '+x['apellidos']+' '+x['nro_documento']).lower()]
            return ok(data,scope='clinical',pagination=dict(page=1,per_page=10,total=len(data),has_more=False))
        if re.fullmatch(r'/api/pacientes/\d+/visitas',p):
            pid=int(p.split('/')[-2])
            if pid==0:return self.reply(404,dict(success=False,message='Paciente no encontrado'),p)
            data=copy.deepcopy([v for v in VISITS if v['paciente_id']==pid])
            for v in data:v['informes']=decorated_reports(v['visita_id'])
            return ok(data)
        if re.fullmatch(r'/api/pacientes/\d+',p):
            obj=next((x for x in PATIENTS if x['id']==int(p.split('/')[-1])),None)
            return ok(obj,scope='clinical',history_available=True) if obj else self.reply(404,dict(success=False,message='Paciente no encontrado'),p)
        if re.fullmatch(r'/api/informes/(visita|paciente)/\d+',p):
            id=int(p.split('/')[-1]);kind=p.split('/')[-2]
            return ok([r for r in REPORTS if r['visita_id']==id] if kind=='visita' else [r for r in REPORTS if any(v['visita_id']==r['visita_id'] and v['paciente_id']==id for v in VISITS)])
        if re.fullmatch(r'/api/informes/\d+',p):
            obj=copy.deepcopy(next((r for r in REPORTS if r['id']==int(p.split('/')[-1])),None))
            if obj:
                v=next(v for v in VISITS if v['visita_id']==obj['visita_id']);pa=next(x for x in PATIENTS if x['id']==v['paciente_id'])
                obj.update(visita=dict(id=v['visita_id'],**v),paciente=pa,profesional=dict(id=42,nombres='Actor',apellidos='Simulado',cmp=None,rne=None))
                return ok(obj)
        if re.fullmatch(r'/api/diagnosticar/visita/\d+/detalles',p):
            vid=int(p.split('/')[-2])
            if vid==0:return self.reply(404,dict(success=False,message='Diagnóstico no encontrado.'),p)
            return ok(dict(visita_id=vid,ojos=DETAILS.get(vid,[])))
        if '/retinografo/auto-seleccion/' in p:return ok(dict(encontradas=0,imagenes={}))
        return self.reply(404,dict(success=False,message='Ruta no simulada'),p)
    def do_POST(self):
        p=urlparse(self.path).path;raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
        data=json.loads(raw) if 'application/json' in self.headers.get('Content-Type','') else {}
        if p=='/api/login':
            if data.get('password')!='prueba-cn' or data.get('username') not in ['oftalmo_cn','asistente_cn']:
                return self.reply(401,dict(success=False,message='Usuario o contraseña incorrectos.'),p)
            role='Oftalmólogo' if data['username']=='oftalmo_cn' else 'Asistente administrativo'
            permissions=PERMISSIONS if role=='Oftalmólogo' else ['pacientes.ver','pacientes.crear']
            token='eyJhbGciOiJub25lIn0.'+base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())+3600,'user_id':42}).encode()).decode().rstrip('=')+'.simulado'
            return self.reply(200,dict(success=True,data=dict(token=token,user=dict(id=42,username=data['username'],nombres='Actor',apellidos='Sintético',cargo='Pruebas CN',roles=[role],permisos=permissions))),p)
        if p=='/api/pacientes':
            if any(x['nro_documento']==data.get('nro_documento') for x in PATIENTS):
                return self.reply(409,dict(success=False,message='Revisa los campos señalados.',errors={'nro_documento':'El documento ya se encuentra registrado en el sistema.'}),p)
            obj=patient(500+len(PATIENTS)+1,data['nombres'],data['nro_documento']);obj.update(data);obj['nombres_apellidos']=obj['nombres']+' '+obj['apellidos'];PATIENTS.append(obj)
            return self.reply(201,dict(success=True,message='Paciente registrado correctamente',data=obj),p,{'synthetic_id':obj['id']})
        if p=='/api/informes':
            vid=data.get('visita_id') or data.get('diagnostico_id')
            if vid is None:
                vid=max(v['visita_id'] for v in VISITS)+1;VISITS.append(visit(vid,data['paciente_id'],'CN03 visita mediante informe'))
            obj=report(max(r['id'] for r in REPORTS)+1,vid,'CN03 NUEVO SIMULADO',540);obj.update(datos_estructurados=data['datos_estructurados'],tipo_informe_id=data['tipo_informe_id']);REPORTS.append(obj)
            return self.reply(201,dict(success=True,data=dict(id=obj['id'],visita_id=vid,diagnostico_id=vid)),p,{'synthetic_visit':vid,'synthetic_report':obj['id']})
        if p=='/api/diagnosticar':
            if b'imagen-sintetica-aceptada.png' in raw:
                vid=max(v['visita_id'] for v in VISITS)+1
                v=visit(vid,501,'CN05 resultado SIMULADO sin inferencia');v.update(tiene_diagnostico_ia=1,tiene_informes=0,total_informes=0,diagnostico_retinopatia_id=1801)
                detail=dict(detalle_id=1701,ojo='OD',resultado_ia=2,diagnostico_texto='RESULTADO SIMULADO RD Moderado',confianza_general=87.5,
                    probabilidades_detalle={'No DR':2,'Leve':3,'Moderado':87.5,'Severo':5,'Proliferativo':2.5},diagnostico_final=None,
                    estado_validacion='PENDIENTE',comentario_medico=None,motivo_correccion=None,
                    imagen_url='fixture-simulada.png',gradcam_url='fixture-SIN-GRADCAM.png')
                DETAILS[vid]=[detail];v['diagnostico_ia']=dict(id=1801,estado='PROCESADO',modelo_nombre='SIMULADO',detalles=[]);VISITS.append(v)
                response=dict(visita_id=vid,diagnostico_id=vid,diagnostico_retinopatia_id=1801,detalle_id=1701,
                    diagnostico_codigo=2,diagnostico_texto=detail['diagnostico_texto'],confianza_general=87.5,
                    probabilidades_detalle=detail['probabilidades_detalle'],gradcam_url=detail['gradcam_url'],imagen_url=detail['imagen_url'],
                    mensaje='RESPUESTA SIMULADA. No se ejecutó CLIP, ResNet50 ni Grad-CAM.')
                return self.reply(200,dict(success=True,data=response),p,{'simulated_result':True,'synthetic_visit':vid})
            # Deliberate mock denial; neither validator nor model is executed.
            return self.reply(422,dict(success=False,message='Imagen rechazada por API SIMULADA de pruebas. No se ejecutó inferencia.'),p)
        return self.reply(404,dict(success=False,message='Ruta no simulada'),p)

if __name__=='__main__':
    print('API SIMULADA CN listening ONLY http://127.0.0.1:4188; in-memory, NO DATABASE, NO MODELS',flush=True)
    ThreadingHTTPServer(('127.0.0.1',4188),Handler).serve_forever()
