from lib import *
from b1_supuestos import ROW

def year_hdr(ws, r, first='Concepto', unit='Unidad', cols=ac, years=range(1, 6), label=lambda y: str(2026+y)):
    put(ws, f'A{r}', first, 'hdr'); put(ws, f'B{r}', unit, 'hdr')
    for y in years:
        put(ws, f'{cols(y)}{r}', label(y), 'hdr'); ws.column_dimensions[cols(y)].width = 14

def build_precio_tabla(B):
    ws = B.sheet('Precio', 'FIJACIÓN TÉCNICA DEL PRECIO', 'Precio de mercado elegido, precios por canal, método de costo (de los originales) y margen de contribución.', tab='ED7D31')
    put(ws, 'A5', 'A. PRECIO DE VENTA POR AÑO Y CANAL (Bs con factura, salvo indicación)', 'sec')
    year_hdr(ws, 6)
    rows = [
        ('idx', 'Índice de ajuste de precio', 'índice', lambda y: f"='Calendario'!{yc(y)}10", '0.0000'),
        ('pvp', 'Precio de venta al público (PVP)', 'Bs/kit', lambda y: f'=PVP*{ac(y)}7*M_PRECIO', FMT_BS2),
        ('dir', 'Canal directo: la empresa recibe el PVP', 'Bs/kit', lambda y: f'={ac(y)}8', FMT_BS2),
        ('ind', 'Canal indirecto: la empresa recibe PVP x (1 - margen del canal)', 'Bs/kit', lambda y: f'={ac(y)}8*(1-MARGEN_CANAL)', FMT_BS2),
        ('prom', 'Precio promedio que factura la empresa (mezcla de canales)', 'Bs/kit', lambda y: f'=MIX_DIRECTO*{ac(y)}9+(1-MIX_DIRECTO)*{ac(y)}10', FMT_BS2),
        ('neto', 'Precio promedio neto de IVA', 'Bs/kit', lambda y: f'={ac(y)}11*(1-TASA_IVA)', FMT_BS2),
        ('it', 'IT por kit', 'Bs/kit', lambda y: f'={ac(y)}11*TASA_IT', FMT_BS2),
        ('usd', 'Precio promedio de la empresa en USD (referencia)', 'USD/kit', lambda y: f'={ac(y)}11/TIPO_CAMBIO', FMT_BS2),
    ]
    r = 7
    for key, lbl, u, f, fm in rows:
        arow(ws, r, lbl, u, f, fm, kind=None)
        ROW['PRE.' + key] = r
        r += 1
    return ws

def build_muestra(B):
    ws = B.sheet('Muestra y encuesta', 'TAMAÑO DE MUESTRA, CUESTIONARIO Y TABULACIÓN',
                 'No se realizó trabajo de campo: las celdas de respuestas están vacías a propósito. No se inventan encuestas.', tab='70AD47')
    widths(ws, {'A': 50, 'B': 16, 'C': 16, 'D': 16, 'E': 50})
    put(ws, 'A5', 'A. TAMAÑO DE MUESTRA (población finita)', 'sec')
    put(ws, 'A6', 'Población (N): hogares objetivo 2027', 'label'); put(ws, 'B6', "='Demanda'!C13", 'link', FMT_U)
    put(ws, 'A7', 'Nivel de confianza', 'label'); put(ws, 'B7', 0.95, 'input', FMT_PCT)
    put(ws, 'A8', 'Valor Z', 'label'); put(ws, 'B8', '=NORMSINV(1-(1-B7)/2)', 'calc', '0.00')
    put(ws, 'A9', 'Proporción esperada (p)', 'label'); put(ws, 'B9', 0.5, 'input', FMT_PCT)
    put(ws, 'A10', 'q = 1 - p', 'label'); put(ws, 'B10', '=1-B9', 'calc', FMT_PCT)
    put(ws, 'A11', 'Error máximo admitido (e)', 'label'); put(ws, 'B11', 0.05, 'input', FMT_PCT)
    put(ws, 'A12', 'n = Z²·p·q·N / (e²·(N-1) + Z²·p·q)', 'label', bold=True)
    put(ws, 'B12', '=ROUNDUP((B8^2*B9*B10*B6)/(B11^2*(B6-1)+B8^2*B9*B10),0)', 'calc', FMT_U, bold=True)
    B.name('N_MUESTRA', 'Muestra y encuesta', 'B12')
    put(ws, 'E6', 'Muestreo sugerido: estratificado por distrito municipal, proporcional a la población; entrevistas a la persona que decide las compras del hogar.', 'note')
    put(ws, 'A14', 'B. CUESTIONARIO PROPUESTO (para validar los supuestos)', 'sec')
    qs = ['P1. ¿En su hogar compran agua embotellada (botellón) o tratan el agua para beber? (valida PCT_OBJETIVO)',
          'P2. ¿Cuántos litros de agua para beber y cocinar consumen por día? (valida LITROS_DIA)',
          'P3. ¿Cuánto pagan por un botellón de 20 L? (valida PRECIO_BOTELLON)',
          'P4. Luego de ver el filtro y su demostración, ¿lo compraría? (Definitivamente sí / Probablemente sí / No sé / Probablemente no / Definitivamente no) (valida ACEPTACIÓN)',
          'P5. ¿Cuánto pagaría por el kit? (Bs 350 / 390 / 420 / 450 / más)',
          'P6. ¿Dónde preferiría comprarlo? (ferretería, supermercado, farmacia, redes sociales, feria) (valida MIX_DIRECTO)',
          'P7. ¿Cada cuánto cambiaría el elemento filtrante? (valida CONSUMO_Q)']
    for i, q in enumerate(qs):
        put(ws, f'A{15+i}', q, 'label', wrap=True); ws.merge_cells(f'A{15+i}:E{15+i}')
    put(ws, 'A23', 'C. TABULACIÓN DE LA PREGUNTA P4 (cargar respuestas reales)', 'sec')
    for j, h in enumerate(['Respuesta', 'Frecuencia', '% del total']):
        put(ws, f'{L(1+j)}24', h, 'hdr')
    resp = ['Definitivamente sí', 'Probablemente sí', 'No sé', 'Probablemente no', 'Definitivamente no']
    for i, t in enumerate(resp):
        put(ws, f'A{25+i}', t, 'label'); put(ws, f'B{25+i}', None, 'input', FMT_U)
        put(ws, f'C{25+i}', f'=IF($B$30>0,B{25+i}/$B$30,0)', 'calc', FMT_PCT)
    put(ws, 'A30', 'Total de encuestas cargadas', 'label', bold=True); put(ws, 'B30', '=SUM(B25:B29)', 'calc', FMT_U, bold=True)
    put(ws, 'A31', 'Aceptación medida = (Definitivamente sí + Probablemente sí) / total', 'label')
    put(ws, 'B31', '=IF(B30>0,(B25+B26)/B30,0)', 'calc', FMT_PCT)
    put(ws, 'A32', '¿La muestra cargada alcanza el tamaño n?', 'label')
    put(ws, 'B32', '=IF(B30>=N_MUESTRA,"SÍ: se usa la aceptación medida","NO: se usa el supuesto ACEP_SUPUESTA")', 'calc')
    put(ws, 'A33', 'ACEPTACIÓN USADA EN EL MODELO', 'label', bold=True)
    put(ws, 'B33', '=IF(B30>=N_MUESTRA,B31,ACEP_SUPUESTA)', 'calc', FMT_PCT, bold=True, fill=FILL_KEY)
    B.name('ACEPTACION', 'Muestra y encuesta', 'B33')
    put(ws, 'A35', 'D. TABULACIÓN DE LA PREGUNTA P5 (precio aceptable)', 'sec')
    for j, h in enumerate(['Precio (Bs)', 'Frecuencia', '% acumulado que acepta ese precio o más']):
        put(ws, f'{L(1+j)}36', h, 'hdr')
    precios = [350, 390, 420, 450, 500]
    for i, pr in enumerate(precios):
        put(ws, f'A{37+i}', pr, 'input', FMT_BS); put(ws, f'B{37+i}', None, 'input', FMT_U)
        put(ws, f'C{37+i}', f'=IF(SUM($B$37:$B$41)>0,SUM(B{37+i}:$B$41)/SUM($B$37:$B$41),0)', 'calc', FMT_PCT)
    put(ws, 'A43', 'Nota: la "aceptación medida" suele sobrestimar la compra real. Al cargar datos, conviene ajustar "Probablemente sí" (por ejemplo, contarlo a la mitad) y documentarlo.', 'note')
    return ws

def build_demanda(B):
    ws = B.sheet('Demanda', 'DEMANDA POTENCIAL Y EFECTIVA', 'Cadena: población → hogares → cobertura → hogares objetivo → consumo → demanda potencial → aceptación → demanda efectiva.', tab='70AD47')
    year_hdr(ws, 5)
    pc = lambda y: L(ROW['POB.c2024'] + 2 + y)  # 2027..2031 en 'Santa Cruz'
    rows = [
        ('pobdep', 'Población departamental total', 'personas', lambda y: f"='Santa Cruz'!{pc(y)}{ROW['POB.s0']}", FMT_U),
        ('poburb', 'Población urbana departamental', 'personas', lambda y: f"='Santa Cruz'!{pc(y)}{ROW['POB.s1']}", FMT_U),
        ('tam', 'Tamaño medio del hogar', 'pers/hogar', lambda y: '=TAM_HOGAR', FMT_BS2),
        ('hog', 'Hogares urbanos del departamento', 'hogares', lambda y: f'={ac(y)}7/{ac(y)}8', FMT_U),
        ('cob', 'Cobertura de distribución', '%', lambda y: f'=CHOOSE({y},COB_2027,COB_2028,COB_2029,COB_2030,COB_2031)', FMT_PCT),
        ('alc', 'Hogares urbanos alcanzables', 'hogares', lambda y: f'={ac(y)}9*{ac(y)}10', FMT_U),
        ('pobj', '% de hogares objetivo (compran o tratan agua)', '%', lambda y: '=PCT_OBJETIVO', FMT_PCT),
        ('hobj', 'Hogares objetivo (mercado potencial)', 'hogares', lambda y: f'={ac(y)}11*{ac(y)}12', FMT_U),
        ('q', 'Compra promedio (q)', 'kits/hogar/año', lambda y: '=CONSUMO_Q', FMT_BS2),
        ('dpot', 'DEMANDA POTENCIAL', 'kits/año', lambda y: f'={ac(y)}13*{ac(y)}14', FMT_U),
        ('pvp', 'Precio de venta al público', 'Bs/kit', lambda y: f"='Precio'!{ac(y)}{ROW['PRE.pvp']}", FMT_BS2),
        ('dpotbs', 'Demanda potencial en Bs', 'Bs', lambda y: f'={ac(y)}15*{ac(y)}16', FMT_BS),
        ('dpotusd', 'Demanda potencial en USD', 'USD', lambda y: f'={ac(y)}17/TIPO_CAMBIO', FMT_BS),
        ('acep', 'Aceptación del producto', '%', lambda y: '=ACEPTACION', FMT_PCT),
        ('def', 'DEMANDA EFECTIVA', 'kits/año', lambda y: f'={ac(y)}15*{ac(y)}19', FMT_U),
        ('defbs', 'Demanda efectiva en Bs', 'Bs', lambda y: f'={ac(y)}20*{ac(y)}16', FMT_BS),
    ]
    r = 6
    for key, lbl, u, f, fm in rows:
        arow(ws, r, lbl, u, f, fm, bold=key in ('dpot', 'def'))
        ROW['DEM.' + key] = r
        r += 1
    assert ROW['DEM.hobj'] == 13 and ROW['DEM.dpot'] == 15 and ROW['DEM.def'] == 20
    notas = ['• Ñapefit usaba en 2026 "D30*0,3" y "x0,2" aunque el rótulo decía 70%, y en 2027 un valor fijo del censo: la serie no era homogénea. Aquí toda la serie usa la misma fórmula.',
             '• Hypotolab aplicaba 54% y 5% fijos sin fuente. Aquí cada porcentaje está en Supuestos con su tipo y forma de validarlo.',
             '• La demanda insatisfecha no se calcula: no hay datos de oferta local de filtros (pendiente de relevamiento en Competencia).']
    for i, t in enumerate(notas):
        put(ws, f'A{25+i}', t, 'note'); ws.merge_cells(f'A{25+i}:G{25+i}')
    return ws

def build_pronostico(B):
    ws = B.sheet('Pronostico', 'PRONÓSTICO DE VENTAS', 'Método de los originales: demanda x aceptación x participación. El escenario activo (Supuestos) alimenta todo el modelo.')
    widths(ws, {'A': 30, 'B': 13, 'C': 15, 'D': 13, 'E': 14, 'F': 14, 'G': 12, 'H': 16, 'I': 10, 'J': 16})
    def bar(r, t):
        put(ws, f'B{r}', t, 'bar'); ws.merge_cells(f'B{r}:J{r}')
    bar(5, 'PRONÓSTICO DE VENTAS')
    put(ws, 'B7', 'ESCENARIOS', 'hdr'); ws.merge_cells('B7:D7')
    for j, (t, n) in enumerate([('Pesimista', 'PART_PES'), ('Esperado', 'PART_BASE'), ('Optimista', 'PART_OPT')]):
        put(ws, f'{L(2+j)}8', t, 'hdr'); put(ws, f'{L(2+j)}9', f'={n}', 'calc', FMT_PCT)
    put(ws, 'F7', 'Crecimiento anual de la participación', 'hdr'); ws.merge_cells('F7:G7'); put(ws, 'H7', '=CRECE_PART', 'calc', FMT_PCT)
    put(ws, 'F9', 'Escenario activo', 'hdr'); ws.merge_cells('F9:G9'); put(ws, 'H9', '=NOMBRE_ESCENARIO', 'calc', bold=True)
    hd = ['Año', 'Demanda del mercado (unid)', 'Aceptación del producto', 'Participación estimada (%)', 'Ventas proyectadas (unid)', 'Precio (Bs)', 'Ventas proyectadas (Bs)', 'Tipo de cambio', 'Ventas proyectadas ($)']
    r = 11
    for key, title, part in [('PES', 'ESCENARIO PESIMISTA', 'PART_PES'), ('BASE', 'ESCENARIO ESPERADO (BASE)', 'PART_BASE'), ('OPT', 'ESCENARIO OPTIMISTA', 'PART_OPT')]:
        bar(r, title); r += 1
        for j, h in enumerate(hd): put(ws, f'{L(2+j)}{r}', h, 'hdr')
        ws.row_dimensions[r].height = 45; r += 1
        f0 = r
        for y in range(1, 6):
            put(ws, f'B{r}', str(2026+y), 'calc')
            put(ws, f'C{r}', f"='Demanda'!{ac(y)}{ROW['DEM.dpot']}", 'link', FMT_U, bold=True)
            put(ws, f'D{r}', f"='Demanda'!{ac(y)}{ROW['DEM.acep']}", 'link', FMT_PCT)
            put(ws, f'E{r}', f'={part}' if y == 1 else f'=E{r-1}*(1+CRECE_PART)', 'calc', FMT_PCT2)
            put(ws, f'F{r}', f'=C{r}*D{r}*E{r}*M_DEMANDA', 'calc', FMT_U, bold=True)
            put(ws, f'G{r}', f"='Precio'!{ac(y)}{ROW['PRE.pvp']}", 'link', FMT_BS2)
            put(ws, f'H{r}', f'=F{r}*G{r}', 'calc', FMT_BS2)
            put(ws, f'I{r}', '=TIPO_CAMBIO', 'calc', FMT_BS2)
            put(ws, f'J{r}', f'=H{r}/I{r}', 'calc', FMT_BS2)
            r += 1
        ROW[f'PRO.{key}.f0'] = f0
        r += 1
    bar(r, 'ESCENARIO ACTIVO (alimenta producción, costos y estados financieros)'); r += 1
    year_hdr(ws, r, first='Concepto', unit=''); r += 1
    ra = r
    arow(ws, r, 'Ventas anuales del escenario activo (kits)', '', lambda y: f"=CHOOSE(ESCENARIO,F{ROW['PRO.PES.f0']+y-1},F{ROW['PRO.BASE.f0']+y-1},F{ROW['PRO.OPT.f0']+y-1})", FMT_U, bold=True); r += 1
    arow(ws, r, 'Participación del escenario activo', '', lambda y: f"=CHOOSE(ESCENARIO,E{ROW['PRO.PES.f0']+y-1},E{ROW['PRO.BASE.f0']+y-1},E{ROW['PRO.OPT.f0']+y-1})", FMT_PCT2); r += 1
    arow(ws, r, 'Precio promedio facturado por la empresa (Bs/kit)', '', lambda y: f"='Precio'!{ac(y)}{ROW['PRE.prom']}", FMT_BS2); r += 1
    arow(ws, r, 'Ventas facturadas por la empresa (Bs)', '', lambda y: f'={ac(y)}{ra}*{ac(y)}{ra+2}', FMT_BS); r += 1
    ROW['PRO.act.units'] = ra; ROW['PRO.act.part'] = ra + 1
    r += 1
    bar(r, 'PRONÓSTICO DE VENTAS TRIMESTRAL (ESCENARIO ACTIVO)'); r += 2
    for tit, src, fm in [('PROYECCIÓN DE VENTAS EN CANTIDAD (kits)', ra, FMT_U), ('PROYECCIÓN DE VENTAS FACTURADAS (Bs)', ra + 3, FMT_BS)]:
        put(ws, f'B{r}', tit, 'hdr'); ws.merge_cells(f'B{r}:G{r}'); r += 1
        put(ws, f'B{r}', 'AÑOS / TRIMESTRES', 'hdr'); ws.merge_cells(f'B{r}:B{r+1}')
        for j in range(4): put(ws, f'{L(3+j)}{r}', f'=EST_T{j+1}', 'hdr', FMT_PCT)
        put(ws, f'G{r}', '=SUM(C{0}:F{0})'.format(r), 'hdr', FMT_PCT); r += 1
        for j, t in enumerate(['1ER', '2DO', '3ER', '4TO', 'TOTAL']): put(ws, f'{L(3+j)}{r}', t, 'hdr')
        r += 1
        for y in range(1, 6):
            put(ws, f'B{r}', str(2026+y), 'calc')
            for j in range(4): put(ws, f'{L(3+j)}{r}', f'=${ac(y)}${src}*{L(3+j)}${r-1-y}', 'calc', fm)
            put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', fm, bold=True)
            r += 1
        r += 1
    put(ws, f'A{r}', 'DISTRIBUCIÓN TRIMESTRAL EN LÍNEA DE TIEMPO (alimenta Inventario y los estados financieros)', 'sec'); r += 1
    hdr_time(ws, r, year0=False); ws.freeze_panes = None
    r += 1
    rq = r
    qrow(ws, r, 'Ventas del trimestre', 'kits', lambda q: f"=INDEX($C${ra}:$G${ra},'Calendario'!{qc(q)}7)*'Calendario'!{qc(q)}13", FMT_U); r += 1
    qrow(ws, r, 'Ventas del trimestre siguiente', 'kits',
         lambda q: f'={qc(q+1)}{rq}' if q < NQ else f'=$G${ra}*($G${ra}/$F${ra})*EST_T1', FMT_U, annual=None); r += 1
    qrow(ws, r, 'Precio promedio facturado', 'Bs/kit', lambda q: f"=INDEX($C${ra+2}:$G${ra+2},'Calendario'!{qc(q)}7)", FMT_BS2, annual=None); r += 1
    qrow(ws, r, 'Ventas facturadas (con IVA)', 'Bs', lambda q: f'={qc(q)}{rq}*{qc(q)}{rq+2}', FMT_BS, bold=True); r += 1
    qrow(ws, r, 'Ventas facturadas en USD (referencia)', 'USD', lambda q: f'={qc(q)}{rq+3}/TIPO_CAMBIO', FMT_BS); r += 1
    ROW['PRO.q.units'] = rq; ROW['PRO.q.next'] = rq + 1; ROW['PRO.q.price'] = rq + 2; ROW['PRO.q.fact'] = rq + 3
    put(ws, f'A{r+1}', 'Correcciones: Hypotolab omitía la aceptación en el escenario esperado (F18 = C18*E18); Ñapefit tenía la fila 2028 en USD con el mismo % en los 4 trimestres (C47:F47 = $C$44) y precios escritos a mano. Aquí todas las filas usan la misma fórmula.', 'note')
    return ws

def build_producto(B):
    ws = B.sheet('Producto', 'PRODUCTO: FILTRO DE AGUA 2.0', '')
    widths(ws, {'A': 34, 'B': 90})
    items = [
        ('Producto', 'Filtro de agua 2.0 para el hogar: maceta de barro cocido con poros muy finos y plata coloidal, más una capa de carbón activado hecho con cáscara de castaña. Va en un balde de 20 L con tapa y grifo. No usa electricidad.'),
        ('Nombre', 'AQUATIERRA 2.0 (provisional, falta revisar en SENAPI).'),
        ('Problema', 'Muchas familias de Santa Cruz compran botellones o hierven el agua para tomar. Es un gasto de todos los meses y hay que cargar bidones o gastar gas.'),
        ('Qué necesita el cliente', 'Agua segura y con buen sabor, barata, sin electricidad y fácil de mantener.'),
        ('Qué tiene de nuevo (2.0)', '1) Capa de carbón activado de cáscara de castaña (residuo de Bolivia) para mejorar olor y sabor. 2) Indicador en la tapa que cambia de color cuando toca cambiar el filtro. 3) QR en cada filtro con el análisis de laboratorio de su lote. 4) Aviso por WhatsApp cuando toca el cambio.'),
        ('Por qué cuesta copiarlo', 'Receta propia de barro + carbón probada en laboratorio, contrato por la cáscara de castaña, control de calidad por lote, marca y clientes registrados que reciben el aviso de cambio.'),
        ('Antes de vender', 'Análisis en laboratorio acreditado (bacterias y capa de carbón). Sin ese resultado no se promete ningún porcentaje de eliminación.'),
        ('Segmento', 'Hogares urbanos de Santa Cruz que compran botellones o hierven el agua. Primero el municipio; desde 2029 el área metropolitana.'),
        ('Propuesta de valor', 'Agua filtrada por unos Bs 18 al mes, contra unos Bs 72 en botellones.'),
    ]
    r = 5
    for k, v in items:
        put(ws, f'A{r}', k, 'label', bold=True, wrap=True); put(ws, f'B{r}', v, 'label', wrap=True)
        ws.row_dimensions[r].height = 45
        r += 1
    r += 1
    put(ws, f'A{r}', 'CUÁNTO AHORRA UNA FAMILIA', 'sec'); r += 1
    rows = [('Agua para beber y cocinar por día (L)', '=LITROS_DIA', FMT_BS2),
            ('Litros por año', f'=B{r}*365', FMT_U),
            ('Botellones de 20 L por año', f'=B{r+1}/20', FMT_BS2),
            ('Gasto anual en botellones (Bs)', f'=B{r+2}*PRECIO_BOTELLON', FMT_BS),
            ('Costo anual del kit (PVP x compras por año)', f"='Precio'!C{ROW['PRE.pvp']}*CONSUMO_Q", FMT_BS),
            ('Ahorro anual estimado del hogar (Bs)', f'=B{r+3}-B{r+4}', FMT_BS),
            ('Meses para recuperar la compra del kit', f"=IF(B{r+3}>0,'Precio'!C{ROW['PRE.pvp']}/(B{r+3}/12),0)", FMT_BS2)]
    for lbl, f, fm in rows:
        put(ws, f'A{r}', lbl, 'label'); put(ws, f'B{r}', f, 'link' if '!' in f else 'calc', fm); r += 1
    ROW['PM.ahorro'] = r - 2; ROW['PM.meses'] = r - 1
    put(ws, f'A{r+1}', 'Lectura: si el ahorro es positivo y la recuperación es de pocos meses, el precio es defendible frente al botellón. Validar PRECIO_BOTELLON y LITROS_DIA con la encuesta.', 'note')
    return ws
