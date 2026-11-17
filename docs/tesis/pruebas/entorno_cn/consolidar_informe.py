"""Consolidate authentic test evidence; never imports the application or connects to SQL."""
from pathlib import Path
from collections import Counter
import datetime as dt
import hashlib
import json
import re
import subprocess
from PIL import Image, ImageChops
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path(__file__).resolve().parents[4]
DOCS=ROOT/'docs/tesis/pruebas'
RUN=json.loads((DOCS/'ejecucion_caja_negra_actual.json').read_text(encoding='utf-8-sig'))
OUT=Path(RUN['evidence'])
OLD=DOCS/'evidencias/20261103T160850Z-421d66ca'
events=json.loads((OUT/'resultados-cn.json').read_text(encoding='utf-8'))
counts=Counter(e['status'] for e in events)
retests={'CN-01':('S01','S06'), 'CN-03':('S03','S06'), 'CN-04':('S02','S06')}
for code,(failed,repeated) in retests.items():
    assert any(e['case']==code and e['variant'].startswith(failed+'-') and e['status']=='FALLIDO' for e in events)
    assert any(e['case']==code and e['variant'].startswith(repeated+'-') and e['status']=='APROBADO' for e in events)
attempt_summary=f"{len(events)} comprobaciones: {counts['APROBADO']} aprobadas y {counts['FALLIDO']} fallidas en el registro inicial de comprobación"
distinct_count=len(events)-len(retests)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

# Historical manifests are checked read-only, including nested manifests.
checks=[]
for manifest in sorted((DOCS/'evidencias').glob('*/SHA256SUMS.txt')):
    if manifest.parent==OUT: continue
    for line in manifest.read_text(encoding='utf-8-sig').splitlines():
        match=re.match(r'^([a-fA-F0-9]{64})\s+\*?(.+)$',line)
        if not match: continue
        p=manifest.parent/match[2]
        checks.append(dict(manifest=str(manifest.relative_to(DOCS)),file=match[2],exists=p.is_file(),matches=p.is_file() and sha(p)==match[1].lower()))
assert checks and all(c['matches'] for c in checks), 'Historical evidence mismatch: stop'
(OUT/'verificacion-historica.json').write_text(json.dumps(dict(utc=dt.datetime.now(dt.timezone.utc).isoformat(),checks=checks,records=len(checks),all_match=True),ensure_ascii=False,indent=2),encoding='utf-8')

converted=[]
for p in sorted(OUT.glob('*/*.jpg')):
    with Image.open(p) as original:
        image=original.convert('RGB'); target=p.with_suffix('.png'); image.save(target)
        with Image.open(target) as png:
            assert ImageChops.difference(image,png.convert('RGB')).getbbox() is None
        converted.append(dict(original=str(p.relative_to(OUT)),png=str(target.relative_to(OUT)),width=image.width,height=image.height,decoded_pixels_identical=True,sha256_original=sha(p),sha256_png=sha(target)))
(OUT/'conversion-capturas.json').write_text(json.dumps(converted,ensure_ascii=False,indent=2),encoding='utf-8')
assert len(converted)==len(events)+4
status=subprocess.run(['git','status','--short'],cwd=ROOT,capture_output=True,text=True,check=True).stdout
(OUT/'git-status-final.txt').write_text(status,encoding='utf-8')
tracked=subprocess.run(['git','diff','--name-only'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.splitlines()
(OUT/'fuentes-actuales.json').write_text(json.dumps(dict(head=RUN['head'],dirty_tracked=[dict(path=p,sha256=sha(ROOT/p)) for p in tracked],note='Cambios locales preexistentes conservados; los CB históricos corresponden a sus propias fuentes archivadas.'),ensure_ascii=False,indent=2),encoding='utf-8')

titles={
'CN-01':'Inicio de sesión y control de acceso',
'CN-02':'Registro y validación de pacientes',
'CN-03':'Creación de visita mediante informe clínico',
'CN-04':'Consulta de informes clínicos por visita',
'CN-05':'Validación y procesamiento de fotografías mediante IA',
'CB-01':'Autenticación y autorización estricta',
'CB-02':'Validaciones internas del alta de pacientes',
'CB-03':'Filtrado y asociación interna de informes',
'CB-04':'Validación y compensación del procesamiento fotográfico',
'CB-05':'Control transaccional de creación de informes'}
cn={
'CN-01':dict(objective='Comprobar los mensajes de acceso, el ingreso a módulos permitidos, la restricción de configuración y el cierre de sesión.',data='Actor clínico ficticio y credenciales de prueba sin relación con cuentas habituales.',pending='Firma y expiración reales del JWT, recarga de identidad, roles vigentes y autorización del backend sobre una base aislada.',image='CN-01/CN-01-S02-credenciales-invalidas.png',caption='Rechazo visible de credenciales mediante respuesta 401 del simulador.'),
'CN-02':dict(objective='Comprobar campos obligatorios, alta visible, presentación de duplicado y rechazo de fecha futura.',data='Celia Prueba Sintética, DNI ficticio 90000003, fecha 01/01/2000, sexo femenino y consentimiento; fecha negativa 01/01/2999.',pending='Unicidad y almacenamiento real en MySQL, reglas del servicio y lectura desde una nueva sesión de backend.',image='CN-02/CN-02-S02-alta-simulada.png',caption='Alta de Celia en el listado atendido por la API simulada.'),
'CN-03':dict(objective='Comprobar el flujo Nueva visita a partir del registro de un informe clínico.',data='Ana Prueba Sintética, paquimetría tipo 4. OD/OI 540/542 en la visita 905 con informe 704; 541/543 en la repetición con visita 907 e informe 705, todos simulados.',pending='Creación transaccional real de visita, informe y versión inicial; commit y persistencia relacional.',image='CN-03/CN-03-S06-repeticion-guardado.png',caption='Diálogo previo al guardado en la repetición. El aviso posterior se verificó por lectura del navegador.'),
'CN-04':dict(objective='Comprobar la presentación de informes por visita y el tratamiento de visita vacía y ajena al paciente.',data='Ana 501: visitas 901 y 902 con marcadores CN04 V1 y V2, y 903 vacía; Beatriz 502 con visita 904.',pending='Filtrado SQL, asociaciones y restricciones reales de acceso. La separación de respuestas está predefinida en el simulador.',image='CN-04/CN-04-S06-repeticion-detalle.png',caption='Detalle de paquimetría cargado en la repetición de consulta de la visita V1.'),
'CN-05':dict(objective='Comprobar selección y previsualización de archivo, confirmación de ojo, presentación de rechazo y de respuesta positiva artificial.',data='Archivo TXT y PNG abstracto de 800 por 800 píxeles rotulado como fixture sintética; variante aceptada por nombre en el simulador.',pending='Validación efectiva de tamaño, dimensiones, región ocular y CLIP; inferencia real ResNet50, Grad CAM, almacenamiento, validación médica y reconsulta completa de detalles.',image='CN-05/CN-05-S05-rechazo-api-simulada.png',caption='Rechazo 422 predefinido por la API simulada sin ejecutar inferencia.')}
expected_cn={
'CN-01':'Enviar el formulario con entradas vacías, inválidas y válidas; visitar Configuración y cerrar sesión. Se espera bloqueo o navegación según la sesión y el perfil.',
'CN-02':'Enviar el alta vacía, válida, duplicada y con fecha futura. Se espera que solo el alta válida aparezca en el listado simulado.',
'CN-03':'Elegir Paquimetría y Nueva visita, completar y confirmar. Se espera bloquear un informe incompleto, notificar el alta y mostrar la nueva visita solo para Ana.',
'CN-04':'Abrir Informes en V1, V2, la visita vacía y la ajena. Se espera el detalle correspondiente, un estado vacío o un mensaje de visita no encontrada.',
'CN-05':'Probar archivo ausente, TXT y PNG; confirmar el ojo y enviar. Se espera impedir entradas inválidas y representar el rechazo y el éxito simulados.'}
cb={
'CB-01':dict(objective='Verificar credenciales, JWT, identidad vigente y permisos procedentes del rol habilitante.',inputs='Credenciales ausentes, incorrectas y válidas; grants ausentes o inactivos; JWT inválido o expirado y alcance de recursos.',procedure='Ejecutar la suite unitaria con funciones reales, repositorios e identidad sintéticos; verificar cortocircuitos de operaciones denegadas.',limits='Hash y JWT se procesaron realmente con clave ficticia. Repositorios y cuentas fueron simulados; no se verificó una base SQL.'),
'CB-02':dict(objective='Verificar validaciones y normalización previas al alta, evitando escrituras al rechazar entradas.',inputs='Obligatorios, formatos, duplicados, fecha futura o imposible, edades 120 y 121, límites y normalización de texto.',procedure='Ejecutar el servicio y validadores reales con reloj fijado y repositorios, entidad y sesión simulados; comprobar ausencia de insert y commit ante rechazo.',limits='No demuestra unicidad instalada ni persistencia real; las respuestas de repositorio fueron simuladas.'),
'CB-04':dict(objective='Verificar validación estructural de imagen y compensación ante fallos del procesamiento fotográfico.',inputs='Formatos y dimensiones límite, contenido inválido, errores sintéticos de inferencia, almacenamiento y persistencia.',procedure='Ejecutar validadores y funciones objetivo reales; sustituir IA y repositorios; usar archivos temporales exclusivos y comprobar limpieza y rollback invocados.',limits='CLIP, ResNet50 y Grad CAM no realizaron inferencia real. No mide exactitud clínica ni transacciones físicas.'),
'CB-05':dict(objective='Verificar la coordinación transaccional de visita opcional, informe y versión inicial.',inputs='Visita nueva o existente, asociaciones inválidas, tipo no soportado, duplicados y errores en etapas de escritura.',procedure='Ejecutar crear_nuevo_informe con sesión y repositorios simulados; comprobar orden de llamadas, único commit y rollback cuando corresponde.',limits='Comprueba el control transaccional del servicio por llamadas; no prueba atomicidad ni restricciones físicas en MySQL.')}
results={k:json.loads((OLD/k/'resultado.json').read_text(encoding='utf-8')) for k in cb}

doc=Document(); sec=doc.sections[0]
sec.page_width=Cm(21);sec.page_height=Cm(29.7)
sec.top_margin=Cm(1.8);sec.bottom_margin=Cm(1.8);sec.left_margin=Cm(2);sec.right_margin=Cm(2)
sec.header_distance=Cm(.7);sec.footer_distance=Cm(.7)
normal=doc.styles['Normal'];normal.font.name='Calibri';normal.font.size=Pt(10.5)
normal.paragraph_format.space_after=Pt(5);normal.paragraph_format.line_spacing=1.05
for s,size in [('Title',23),('Subtitle',12),('Heading 1',16),('Heading 2',12),('Heading 3',11)]:
    doc.styles[s].font.name='Calibri';doc.styles[s].font.size=Pt(size);doc.styles[s].font.color.rgb=RGBColor(0,0,0)
    doc.styles[s].paragraph_format.space_before=Pt(9);doc.styles[s].paragraph_format.space_after=Pt(6)
    doc.styles[s].paragraph_format.keep_with_next=True
header=sec.header.paragraphs[0];header.text='CODN   |   Evidencia de pruebas de software   |   3 de noviembre de 2026';header.style='Caption';header.runs[0].font.size=Pt(8);header.runs[0].font.color.rgb=RGBColor(0,0,0)
footer=sec.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT
footer.add_run('Informe consolidado   ·   ')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld)
doc.core_properties.title='Informe consolidado de pruebas del Sistema Web CODN'
doc.core_properties.subject='Pruebas de interfaz con API simulada y resultados unitarios históricos'
doc.core_properties.author='Proyecto CODN'

def p(text,boldlead=None):
    par=doc.add_paragraph()
    if boldlead: par.add_run(boldlead+' ').bold=True
    par.add_run(text);return par
new_page=False
def heading(text,level=1):
    global new_page
    par=doc.add_heading(text,level)
    if new_page:par.paragraph_format.page_break_before=True;new_page=False
def page():
    global new_page
    new_page=True
def table(headers,rows,widths=None):
    t=doc.add_table(rows=1, cols=len(headers));t.autofit=False
    for i,h in enumerate(headers):t.rows[0].cells[i].text=str(h)
    rep=OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(rep)
    for row in rows:
        for c,value in zip(t.add_row().cells,row):c.text=str(value)
    for ri,row in enumerate(t.rows):
        pr=row._tr.get_or_add_trPr();cant=OxmlElement('w:cantSplit');pr.append(cant)
        for i,c in enumerate(row.cells):
            if widths:c.width=Cm(widths[i])
            tcp=c._tc.get_or_add_tcPr();borders=OxmlElement('w:tcBorders')
            for side in ['top','left','bottom','right']:
                el=OxmlElement('w:'+side);el.set(qn('w:val'),'single');el.set(qn('w:sz'),'4');el.set(qn('w:color'),'D9D9D9');borders.append(el)
            tcp.append(borders)
            if ri==0:
                shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'F2F2F2');tcp.append(shade)
            for par in c.paragraphs:
                par.paragraph_format.space_after=Pt(3);par.paragraph_format.space_before=Pt(3);par.paragraph_format.line_spacing=1
                for run in par.runs:run.font.size=Pt(9);run.bold=ri==0
    return t
fig=0
def picture(path,caption,width=15.8):
    global fig
    fig+=1
    par=doc.add_paragraph();par.alignment=WD_ALIGN_PARAGRAPH.CENTER
    par.paragraph_format.space_after=Pt(3)
    par.add_run().add_picture(str(OUT/path),width=Cm(width))
    par=doc.add_paragraph(f'Figura {fig}. {caption}',style='Caption');par.paragraph_format.space_after=Pt(5)
    for run in par.runs:run.font.size=Pt(9);run.font.color.rgb=RGBColor(0,0,0)

doc.add_paragraph('Informe consolidado de pruebas del Sistema Web CODN',style='Title')
doc.add_paragraph('Evidencias para el informe de tesis',style='Subtitle')
p('Fecha de consolidación: 3 de noviembre de 2026. Zona horaria: America/Lima.')
heading('Introducción y objetivos')
p('El Sistema Web CODN apoya la clasificación de la gravedad de retinopatía diabética a partir de fotografías de fondo de ojo. El resultado automatizado es apoyo a la decisión y no sustituye la valoración final del especialista.')
p('Este informe consolida cinco casos de caja negra y cinco de caja blanca, documentando su alcance efectivo y la evidencia disponible. Las pruebas de interfaz se ejecutaron en un navegador real con respuestas de API simuladas para evitar el uso de datos clínicos y de las instancias MySQL habituales o bloqueadas.')
p(f'Se registraron {attempt_summary}. Las tres incidencias se repitieron satisfactoriamente. Los {distinct_count} escenarios distintos de los cinco casos aprueban dentro del alcance ejercitado de interfaz con API simulada. El alcance funcional integral permanece pendiente.')
p('Se incorporan sin reejecutar cuatro casos unitarios históricos aprobados: 41 métodos y 175 subcasos. CB 03 continúa bloqueada con cero pruebas de integración ejecutadas. No se ejecutó inferencia real ni se midió exactitud clínica.')
heading('Criterios de interpretación',2)
table(['Resultado','Significado'],[
['APROBADO en interfaz','Comportamiento observado de React frente al contrato simulado indicado.'],
['APROBADO unitario histórico','Aserciones internas satisfechas en la corrida archivada de caja blanca.'],
['PENDIENTE integral','No existe evidencia nueva de backend, persistencia o IA reales para ese alcance.'],
['BLOQUEADO','CB 03 no pudo ejecutar su integración por falta de acceso administrativo verificado.']], [4.4,12.6])
p('No se calcula una tasa global de aprobación que mezcle estos alcances. Las capturas corroboran lo observado; los logs y resultados estructurados constituyen la evidencia primaria.')

page();heading('Metodología y entorno de ejecución')
p('Caja negra: interacción con los formularios, navegación, mensajes, estados habilitados y consultas visibles de las fuentes React actuales. La API de pruebas aplica respuestas deterministas en memoria; sus respuestas de rechazo y filtrado no acreditan validaciones ni permisos del backend real.')
p('Caja blanca: se conservan las ejecuciones unittest y mock con instrumentación trace de la corrida 20261103T160850Z-421d66ca. Cada suite fue ejecutada originalmente en proceso separado, con guardas de red y acceso a archivos y dependencias sustituidas. No se reejecutaron al preparar este consolidado.')
table(['Elemento','Configuración y alcance'],[
['Interfaz','React, TypeScript, Vite y Tailwind; fuentes existentes, sin alteración funcional.'],
['Navegador','ChatGPT in app browser IAB, navegador real disponible para la captura. No se declara ejecución en Chrome o Edge.'],
['Servidores de pruebas','React en 127.0.0.1:4187 y API Python estándar en 127.0.0.1:4188; procesos propios detenidos al terminar.'],
['Aislamiento','Configuración Vite exclusiva, envDir vacío, sin lectura de .env del proyecto, sin importar Flask ni modelos y sin conexión MySQL.'],
['API y datos','Respuestas sintéticas en memoria y snapshot JSON de preparación; sin durabilidad transaccional real.'],
['Caja blanca histórica','Python 3.12.10; unittest, mock y trace. Versiones y tiempos originales en resultado.json de cada caso.'],
['Tecnologías del sistema','Flask, SQLAlchemy y MySQL; PyTorch, CLIP, ResNet50 y Grad CAM. No arrancados para las pruebas CN.']], [4,13])
heading('Reproducibilidad y control de versión',2)
p('HEAD registrado: '+RUN['head']+'. El árbol actual contiene cambios locales preexistentes, incluidos archivos del módulo de diagnóstico. Sus hashes se registran en fuentes-actuales.json. Los CB conservan sus propias fuentes y hashes; no constituyen una validación automática de esos cambios posteriores.')
p('Corrida CN: '+RUN['run_id']+'. Ventana de capturas: '+events[0]['utc']+' a '+events[-1]['utc']+'. No se midió rendimiento ni duración por escenario.')
p(f'Se verificaron {len(checks)} entradas de los cinco manifiestos históricos superiores mediante SHA 256, sin discrepancias. No se sobrescribieron las evidencias anteriores.')
p(f'Las capturas originales JPEG del navegador se conservan. Se generaron {len(converted)} PNG con igualdad exacta de píxeles decodificados, sin montajes ni retoque; conversion-capturas.json identifica los pares y sus hashes. Los fixtures gráficos abstractos son entradas sintéticas y no capturas de ejecución.')

for code,info in cn.items():
    page();heading(code.replace('-',' ')+' '+titles[code])
    p(info['objective'],'Objetivo.')
    p('Interfaz servida en loopback, API simulada activa y datos sintéticos. '+('Sin sesión al comenzar.' if code=='CN-01' else 'Actor clínico ficticio autenticado en el simulador.'),'Precondiciones.')
    p(info['data'],'Datos utilizados.')
    p(expected_cn[code],'Procedimiento y esperado.')
    ee=[e for e in events if e['case']==code]
    rows=[]
    for e in ee:
        name=(f'S06 repetición de {retests[code][0]}' if e['variant'].startswith('S06-repeticion-') else e['variant'].replace('-',' '))
        obtained=e['obtained'] or 'Comprobación fallida por lectura vacía del mensaje nativo; ver repetición S06.'
        if e['variant']=='S06-repeticion-guardado':obtained='Lectura del navegador: Informes guardados; 1 informe(s) registrado(s) correctamente.'
        rows.append([name,obtained,'FALLIDO' if e['status']=='FALLIDO' else 'APROBADO'])
    table(['Variante','Resultado obtenido','Estado de registro'],rows,[4.2,10.3,2.5])
    p('APROBADO en el alcance ejercitado de interfaz con API simulada; PENDIENTE en el alcance integral. '+('S06 verificó el bloqueo nativo por campos obligatorios que la lectura de S01 no detectó.' if code=='CN-01' else ''),'Estado.')
    if code=='CN-03':p('S03 registró el texto de éxito y POST 201, pero devolvió falso. S06 verificó el aviso, conservado en repeticion-aviso.txt; la captura preservó el diálogo anterior. El log registra POST 201 para la visita 907.')
    if code=='CN-04':p('S02 registró los valores visibles, pero el predicado devolvió falso. S06 esperó el diálogo cargado y verificó el paciente, los dos valores y CN04-V1. El texto se conserva en repeticion-detalle.txt.')
    p(info['pending'],'Dependencias pendientes.')
    picture(info['image'],info['caption']+' Alcance exclusivo de interfaz con API simulada.',width=13.9 if code in ('CN-03','CN-04','CN-05') else 15)
    p(f'Evidencia: carpeta {code}, resultados-cn.json y api-simulada.jsonl de la corrida CN. La tabla registra observaciones; las expectativas detalladas están en el JSON.','Referencia.')

page();heading('CN 05 Presentación de respuesta positiva simulada')
p('La variante S06 comprueba que el frontend representa una respuesta positiva del contrato de diagnóstico. El simulador devuelve de forma deliberada nivel 2 y confianza 87.5 por ciento al recibir el nombre imagen-sintetica-aceptada.png. Estos valores son constantes de prueba, sin significado clínico ni evaluación de un modelo.')
picture('CN-05/CN-05-S06-resultado-api-simulada.png','Pantalla real de resultados frente a valores artificiales definidos por el simulador. El rótulo inferior identifica el entorno. Las dos imágenes son la misma fixture abstracta; no existe mapa Grad CAM generado.',16.5)
p('La etiqueta ResNet50 y el panel Grad CAM pertenecen a la interfaz existente. Su presencia en esta captura no acredita ejecución de esas tecnologías. La validación médica y el guardado de diagnóstico no se ejecutaron.')
p(f'Se exploró la visita simulada 906: su resumen mostró el motivo marcado como SIMULADO, pero el contrato preparado no proporcionó detalles completos en diagnostico_ia.detalles y la pestaña indicó cero ojos. Esta exploración no integra el conteo de {len(events)} comprobaciones ni demuestra un defecto de la aplicación. La reconsulta completa de diagnóstico queda pendiente de un contrato de fixture completo y, para el alcance integral, de persistencia real.')
heading('Incidencia visual observada',2)
p('En el flujo de carga se observó Máx 30 MB en la zona de selección y un texto de recuperación que menciona 20 MB tras el rechazo. Se registra una inconsistencia de mensajes para revisión; no se ensayó el límite efectivo por tamaño ni se modificó código para resolverla.')

for code in ['CB-01','CB-02','CB-03','CB-04','CB-05']:
    page();heading(code.replace('-',' ')+' '+titles[code])
    if code=='CB-03':
        p('Comprobar filtrado, asociación y agrupación interna de informes por paciente y visita con repositorios y MySQL reales.','Objetivo.')
        p('Instancia aislada identificada por consulta SQL, credenciales seguras, esquema y fixtures expresamente autorizados. Ninguna de estas condiciones se da por satisfecha por tener un datadir inicializado.','Precondiciones.')
        p('Diez escenarios preparados de integración; no ejecutados. Datos sintéticos propuestos con pacientes y visitas diferentes, informes diferenciables y visita vacía. No se insertaron durante esta intervención.','Procedimiento y datos previstos.')
        p('Cada consulta y agrupación debe devolver solo los informes asociados y mantener los controles de acceso y relaciones previstos.','Esperado.')
        p('Cero métodos y cero subcasos de integración ejecutados. La preparación previa alcanzó el arranque, pero el acceso administrativo no se verificó; el segundo intento registró error 1130. El diagnóstico posterior es offline.','Obtenido.')
        p('BLOQUEADO. No se realizó tercer arranque, conexión MySQL, DDL ni carga de fixtures en esta consolidación.','Estado.')
        table(['Identificación histórica','Certeza disponible'],[
        ['MySQL 8.0.46 y puerto 33363','Observados en los logs previos; no se conectó en esta intervención.'],
        ['UUID eee45878-d7ac-11f1-bc4f-107c616721bd','Identificador local del archivo auto.cnf; equivalencia con @@server_uuid no confirmada por SQL.'],
        ['Instancia CB 03 detenida','Último estado documentado antes de esta consolidación; no se intentó recuperarla.'],
        ['Cobertura','No medida para esta prueba de integración.']], [6.2,10.8])
        p('INFORME_PREPARACION_MYSQL_CB03.md y DIAGNOSTICO_ACCESO_MYSQL_CB03.md; corridas cb03 de preparación y diagnóstico preservadas. No existe captura que pruebe una integración aprobada.','Evidencias.')
        p('Faltan la autorización independiente de recuperación y esquema, identidad SQL verificada y una corrida de los diez escenarios reales. Las hipótesis sobre 1130 permanecen como hipótesis, sin atribuir una causa definitiva.')
        continue
    info=cb[code];r=results[code]
    p(info['objective'],'Objetivo.')
    p('Dependencias locales, proceso nuevo, guardas y fixtures sintéticas; sin app.py ni conexión SQL.','Precondiciones históricas.')
    p(info['procedure'],'Procedimiento.')
    p(info['inputs'],'Datos y condiciones.')
    p('Cumplir las aserciones de cada variante y evitar operaciones posteriores al rechazo cuando corresponda.','Esperado.')
    p(f"{r['methods']} métodos y {r['subcases']} subcasos; fallos {r['failures']}, errores {r['errors']}, omitidos {r['skipped']}, salida {r['exit_code']}. APROBADO en el alcance unitario histórico.",'Obtenido y estado.')
    p(info['limits'],'Limitación.')
    picture('CB-capturas/'+code+'-reporte.png','Captura nueva del reporte HTML histórico '+code+'. Es una visualización de la corrida archivada, no una reejecución ni una consola en vivo.',15)
    p(f"Ejecución original {r['started_utc']}; duración del proceso instrumentado {r['duration_seconds']} s. Referencia: {code}/resultado.json, ejecucion-04.log, matriz-condiciones.md, reporte.html y archivos de cobertura de la corrida histórica.")

page();heading('Resultados y cobertura medida')
p(f'Los 41 métodos unitarios y 175 subcasos históricos satisfacen sus aserciones con salida cero. Los subcasos están contenidos en los métodos y no deben sumarse a ellos. Las CN registran {attempt_summary}; las tres incidencias tienen repetición satisfactoria. Estos registros no equivalen a métodos unittest.')
table(['Caso','Archivo o función seleccionada','Ejecutadas sobre elegibles','Porcentaje'],[[k,c['file'],f"{c['executed']} / {c['executable']}",f"{c['percent']:.2f} %"] for k,r in results.items() for c in r['coverage']],[1.5,9,3.7,2.8])
p('Medición original con trace.Trace y tablas de líneas ejecutables de CPython, limitada al cuerpo de funciones y cierres explícitamente seleccionados. Excluye imports, otras funciones, tests, mocks, dependencias, frontend y rutas fuera de objetivo. No es cobertura del archivo completo, del repositorio, de ramas, de condiciones independientes ni MC DC.')
heading('Matriz consolidada',2)
table(['Caso','Resultado con alcance','Registro','Alcance pendiente'],[
*[ [k,'APROBADO interfaz simulada',str(len([e for e in events if e['case']==k]))+' registros'+(' con repetición' if k in retests else ''),'Integración real'] for k in cn],
['CB-01','APROBADO unitario histórico','12 métodos / 46 subcasos','Integración SQL'],
['CB-02','APROBADO unitario histórico','10 métodos / 67 subcasos','Persistencia real'],
['CB-03','BLOQUEADO','0 ejecutados de 10 preparados','Acceso y MySQL real'],
['CB-04','APROBADO unitario histórico','9 métodos / 37 subcasos','IA y persistencia reales'],
['CB-05','APROBADO unitario histórico','10 métodos / 25 subcasos','Transacción MySQL real']], [1.6,6.1,5.2,4.1])

page();heading('Hallazgos y limitaciones')
table(['Hallazgo','Interpretación y acción necesaria'],[
['Validación nativa de CN 01','El primer registro falló por leer un mensaje vacío; la repetición confirmó required y valueMissing y la UI mostró Completa este campo. Se preservan ambos registros.'],
['Comprobaciones CN 03 y CN 04','Los predicados de guardado y detalle devolvieron falso al inicio. Las repeticiones esperaron el aviso de éxito y el diálogo cargado y verificaron su contenido. Se preservan los registros originales y las capturas nuevas.'],
['Mensajes de tamaño en CN 05','Se observaron textos de 30 MB y 20 MB. Revisar coherencia y ensayar posteriormente archivos en los límites efectivos.'],
['Contrato de fixture de IA','La presentación positiva funciona con valores artificiales. La reconsulta de ojos necesita completar el contrato del simulador; no atribuir ese vacío al backend real.'],
['Preparación del entorno','Se ajustó únicamente el directorio de trabajo del lanzador Vite para que Tailwind resolviera la configuración existente; no fue un defecto funcional de CODN. Un inicio redundante posterior fue rechazado por puerto ocupado sin sustituir procesos ajenos.'],
['Alcance de la evidencia','No hay persistencia MySQL, autorización real del backend, inferencia real, validación médica ni calidad clínica demostradas por las CN.'],
['Versiones y regresión','Los CB aprobados pertenecen a fuentes históricas archivadas; los cambios locales actuales requieren una corrida independiente si se busca evidencia de regresión actual.']], [4.5,12.5])
heading('Conclusiones',2)
p('La intervención produjo evidencia observable de los cinco recorridos de interfaz en un entorno simulado y aislado, con datos ficticios y capturas auténticas. Los resultados permiten sustentar el comportamiento visual y el tratamiento de respuestas del contrato que se ejercitaron.')
p('Las cuatro pruebas de caja blanca se incorporaron con sus resultados originales y con nuevas capturas de sus reportes. La aprobación sigue limitada a sus funciones y dependencias declaradas. CB 03 permanece bloqueada; sus comprobaciones offline no se convierten en integración aprobada.')
p('Para completar el documento definitivo faltan recorridos con backend y almacenamiento aislados reales, una fixture de imagen sintética apta para el pipeline y ejecución efectiva de validación, inferencia y Grad CAM. CB 03 requiere además una autorización separada y una corrida real de sus diez escenarios. Este informe no certifica rendimiento, seguridad integral ni eficacia clínica.')

page();heading('Referencias y trazabilidad de evidencias')
p('Las rutas de este apartado son relativas a docs/tesis/pruebas dentro del repositorio. El Word es editable y el PDF conserva su representación paginada. Los materiales auxiliares permiten auditar las afirmaciones y reutilizar las figuras originales.')
table(['Ref.','Contenido y ubicación'],[
['R1','AUDITORIA_PLAN_PRUEBAS_CODN.md. Diseño original, viabilidad y alcances propuestos; no contiene ejecución nueva.'],
['R2','INFORME_PRUEBAS_CAJA_BLANCA.md. Fichas, comandos, matrices y límites de la corrida histórica.'],
['R3','INFORME_PREPARACION_MYSQL_CB03.md. Inicialización y dos intentos previos de acceso; no equivale a identidad SQL verificada.'],
['R4','DIAGNOSTICO_ACCESO_MYSQL_CB03.md. Diagnóstico offline e hipótesis, sin tercer arranque ejecutado.'],
['R5','evidencias/20261103T160850Z-421d66ca/. Logs, JSON, HTML, fuentes y cobertura de CB 01, 02, 04 y 05.'],
['R6','evidencias/'+RUN['run_id']+'/. resultados-cn.json, api-simulada.jsonl, capturas por CN y CB-capturas/.'],
['R7','Dentro de R6: conversion-capturas.json, verificacion-historica.json, fuentes-actuales.json, git-status-final.txt y SHA256SUMS.txt.'],
['R8','entorno_cn/vite_test.mjs y mock_api.py. Arnés exclusivo de pruebas, sin conexión a bases. consolidar_informe.py genera este documento.']], [1.4,15.6])
heading('Reproducción de los recorridos',2)
p('Desde la raíz, iniciar en terminales separadas el Python local autorizado con docs/tesis/pruebas/entorno_cn/mock_api.py y el Node local con docs/tesis/pruebas/entorno_cn/vite_test.mjs. Abrir http://127.0.0.1:4187 en navegador real. El archivo ejecucion_caja_negra_actual.json identifica la corrida y puertos. Crear una carpeta de evidencia nueva antes de repetir; no reutilizar ni sobrescribir las capturas ni el JSON final de esta corrida.')
p(f'Las variantes, entradas, expectativas, observaciones, estados y marcas UTC exactas constan en resultados-cn.json. Las figuras impresas son una selección de 10 capturas; se conservan {len(converted)} PNG y sus originales. Abrir los PNG individuales permite examinar las figuras a su resolución original. Los reportes CB se sirven sin modificación desde sus HTML históricos.')
p('Para una captura manual del aviso transitorio de CN 03, repita S06 con datos ficticios en una carpeta nueva, deje visible solo el navegador de pruebas y pulse Windows más Impr Pant al aparecer Informes guardados. Abra el PNG en Imágenes y Capturas de pantalla, confirme que se leen el aviso y el rótulo de simulación, y guarde una copia con el identificador del escenario. La ejecución documentada conserva el texto del aviso y su respuesta 201.')
p('Para detener los servidores de interfaz y simulador, usar Ctrl C en las terminales de esos procesos propios. No iniciar ni detener MySQL para reproducir este alcance de frontend. No se realizaron commits ni push.')

target=DOCS/'INFORME_CONSOLIDADO_PRUEBAS_CODN.docx'
# The bundled empty document may contain a title rule. Remove paragraph borders
# from all styles and paragraphs so the academic title stays plain black.
for element in [doc.styles.element,doc.element]:
    for border in list(element.iter(qn('w:pBdr'))):border.getparent().remove(border)
doc.save(target)
summary=dict(run_id=RUN['run_id'],observations=len(events),states=dict(counts),distinct_scenarios=distinct_count,retests=len(retests),png_count=len(converted),historical_manifest_records=len(checks),historical_all_match=True,figures=fig,docx=str(target))
(OUT/'resumen-consolidacion.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
# This companion preserves each expected/observed pair in a text-friendly index.
md=['# CODN — Resultados de interfaz con API simulada','',f"Corrida: {RUN['run_id']}. {attempt_summary}. CN-01 S06, CN-03 S06 y CN-04 S06 repiten satisfactoriamente S01, S03 y S02, respectivamente. Alcance integral de los cinco CN PENDIENTE; CB-03 BLOQUEADA.",'','No se ejecutó MySQL ni inferencia real. Los resultados CB históricos se conservan sin reejecutar.','']
md.extend(['Nota de verificación visual: el PNG de CN-03 S06 muestra el diálogo previo al guardado. El aviso posterior se conserva por lectura del navegador en `CN-03/repeticion-aviso.txt` y está respaldado por el POST 201 del simulador.',''])
for code in cn:
    md.extend(['## '+code+' — '+titles[code],'',cn[code]['objective'],'','Pendiente: '+cn[code]['pending'],''])
    for e in [e for e in events if e['case']==code]:
        md.extend([f"### {e['variant']} — {e['status']}",'',f"UTC: {e['utc']}",f"Esperado: {e['expected']}",f"Obtenido: {e['obtained'] or 'Lectura de mensaje vacía; incidencia de comprobación conservada.'}",f"Captura PNG: evidencias/{RUN['run_id']}/{Path(e['image']).with_suffix('.png').as_posix()}",''])
(DOCS/'INFORME_PRUEBAS_CAJA_NEGRA_API_SIMULADA.md').write_text('\n'.join(md),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
