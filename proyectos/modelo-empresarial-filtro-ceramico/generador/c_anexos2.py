from lib import *
from b1_supuestos import ROW
from b2_mercado import year_hdr
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import SeriesLabel

def allq(key): return ','.join(Q(key, q) for q in range(1, NQ+1))
def sumq(key): return f'SUM({allq(key)})'

def build_estrategia(B):
    ws = B.sheet('Estrategia comercial', 'ESTRATEGIA COMERCIAL: MEZCLA DE MARKETING, CANALES Y GASTOS COMERCIALES')
    widths(ws, {'A': 34, 'B': 16, 'C': 16, 'D': 16, 'E': 16, 'F': 16, 'G': 16})
    mix = [('Producto', 'Filtro 2.0 con capa de carbón, indicador de cambio, QR del lote, garantía de 6 meses y aviso de cambio por WhatsApp.'),
           ('Precio', 'Bs 420 en 2027: entre los filtros simples y los purificadores del mercado; se recupera en menos de 4 meses de botellones; se ajusta cada año por inflación.'),
           ('Plaza', 'Canal directo (planta, redes sociales con entrega, ferias) y canal indirecto (ferreterías, supermercados, farmacias).'),
           ('Promoción', 'Demostraciones con prueba de agua, redes sociales, ferias barriales, alianzas con juntas vecinales y material en punto de venta.')]
    r = 5
    for a, b in mix:
        put(ws, f'A{r}', a, 'label', bold=True); put(ws, f'B{r}', b, 'label', wrap=True); ws.merge_cells(f'B{r}:G{r}'); ws.row_dimensions[r].height = 30; r += 1
    r += 1
    put(ws, f'A{r}', 'Canales', 'sec'); r += 1
    put(ws, f'A{r}', 'Ventas por canal directo', 'label'); put(ws, f'B{r}', '=MIX_DIRECTO', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'Ventas por canal indirecto', 'label'); put(ws, f'B{r}', '=1-MIX_DIRECTO', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'Margen del canal indirecto', 'label'); put(ws, f'B{r}', '=MARGEN_CANAL', 'calc', FMT_PCT); r += 2
    put(ws, f'A{r}', 'Distribución del presupuesto de publicidad', 'sec'); r += 1
    put(ws, f'A{r}', 'Medio', 'hdr'); put(ws, f'B{r}', '% del presupuesto', 'hdr'); put(ws, f'C{r}', 'Bs 2027', 'hdr'); put(ws, f'D{r}', '$us 2027', 'hdr'); r += 1
    med = [('Redes sociales y pauta digital', 0.35), ('Demostraciones y ferias', 0.25), ('Material en punto de venta', 0.15), ('Alianzas comunitarias', 0.10), ('Radio y TV local', 0.15)]
    m0 = r
    for a, p in med:
        put(ws, f'A{r}', a, 'label'); put(ws, f'B{r}', p, 'input', FMT_PCT); put(ws, f'C{r}', f'=B{r}*PUBLICIDAD_MES*12*M_FIJOS', 'calc', FMT_BS)
        put(ws, f'D{r}', f'=C{r}/TIPO_CAMBIO', 'calc', FMT_BS2); r += 1
    put(ws, f'A{r}', 'Total', 'label', bold=True); put(ws, f'B{r}', f'=SUM(B{m0}:B{r-1})', 'calc', FMT_PCT, bold=True); put(ws, f'C{r}', f'=SUM(C{m0}:C{r-1})', 'calc', FMT_BS, bold=True)
    put(ws, f'D{r}', f'=SUM(D{m0}:D{r-1})', 'calc', FMT_BS2, bold=True); r += 2
    put(ws, f'A{r}', 'Gastos comerciales y cobertura por año', 'sec'); r += 1
    year_hdr(ws, r); r += 1
    arow(ws, r, 'Cobertura de distribución', '%', lambda y: f"={Y('DEM.cob', y)}", FMT_PCT); r += 1
    arow(ws, r, 'Gastos de comercialización (ER)', '$us', lambda y: f"={Y('ER.tcom', y)}", FMT_BS2); r += 1
    arow(ws, r, 'Gasto comercial / ventas netas', '%', lambda y: f"={Y('ER.tcom', y)}/{Y('ER.vn', y)}", FMT_PCT); r += 1
    arow(ws, r, 'Costo comercial por filtro vendido', '$us/filtro', lambda y: f"={Y('ER.tcom', y)}/{Y('ER.u', y)}", FMT_BS2); r += 1
    return ws

def build_controles(B):
    ws = B.sheet('Controles', 'CONTROLES Y ALERTAS DE CONSISTENCIA')
    P = ROW
    widths(ws, {'A': 6, 'B': 70, 'C': 18, 'D': 14})
    for j, h in enumerate(['N°', 'Control', 'Valor', 'Estado']): put(ws, f'{L(1+j)}5', h, 'hdr')
    pr = ROW
    sc = lambda k: f"'Pronostico'!$F${pr['PRO.'+k+'.f0']}:$F${pr['PRO.'+k+'.f0']+4}"
    u0 = pr['PRO.u0']
    lab = '+'.join(f"{QR('PER.'+k, 1, 20)}" for k in ('MOD', 'MOI', 'ADM', 'COM'))
    checks = [
        ('El balance cuadra en los 21 cierres (suma de diferencias absolutas, $us)', f"=SUMPRODUCT(ABS({A0('BAL.chk')}:{Q('BAL.chk', 20).split('!')[1]}))", 'abs<0.1'),
        ('Inventario de producto terminado nunca negativo', f"=MIN({allq('INV.ok')})", 'eq1'),
        ('Inventario de materiales nunca negativo', f"=MIN({allq('COM.ok')})", 'eq1'),
        ('La producción cabe en la capacidad en todos los trimestres', f"=MIN({allq('CAP.ok')})", 'eq1'),
        ('Caja ≥ caja mínima en todos los cierres', f"=MIN({A0('FC.ok')},{QR('FC.ok', 1, 20)})", 'eq1'),
        ('Flujo de caja: operación + inversión + financiamiento = saldo del período', "=SUMPRODUCT(ABS('Flujo de caja'!B21:V21+'Flujo de caja'!B24:V24+'Flujo de caja'!B25:V25+'Flujo de caja'!B33:V33-'Flujo de caja'!B34:V34))", 'abs<0.1'),
        ('Suma de saldos del período = caja final 2031', f"=SUM({A0('FC.neto')}:{Q('FC.neto', 20).split('!')[1]})-{Q('FC.sfin', 20)}", 'abs<0.1'),
        ('Utilidades del Estado de resultado = resultados acumulados del balance', f"=SUM({','.join(Y('ER.un', y) for y in range(1, 6))})-{Q('BAL.res', 20)}", 'abs<0.1'),
        ('La estacionalidad suma 100%', '=SUMA_EST-1', 'abs<0.0001'),
        ('Ventas anuales del escenario = suma de los trimestres', f"=(ESCENARIO=1)*SUM({sc('PES')})+(ESCENARIO=2)*SUM({sc('BASE')})+(ESCENARIO=3)*SUM({sc('OPT')})-SUM('Pronostico'!$C${u0}:$F${u0+4})", 'abs<0.01'),
        ('Compras de materiales: pago = costo sin IVA + IVA', f"={sumq('COM.pago')}-{sumq('COM.neto')}-{sumq('COM.iva')}", 'abs<0.1'),
        ('Costo laboral por áreas = total', f"=SUMPRODUCT(ABS({lab}-{QR('PER.tot', 1, 20)}))", 'abs<0.1'),
        ('Préstamo totalmente pagado al final', f"={Q('FIN.saldo', 20)}", 'abs<0.1'),
        ('VAN por fórmula VNA = suma de flujos descontados', '=EV_VAN-EV_VAN_CHK', 'abs<0.1'),
        ('Punto de equilibrio alcanzable con la capacidad (todos los años)', f"=MIN('Rentabilidad'!C{P['PE.ok']}:G{P['PE.ok']})", 'eq1'),
        ('Sin errores de cálculo en Estado de resultado, Flujo de caja y Balance', f"=SUMPRODUCT(ISERROR('Estado de resultado'!D4:W29)*1)+SUMPRODUCT(ISERROR('Estado de resultado'!D34:H57)*1)+SUMPRODUCT(ISERROR('Flujo de caja'!B5:V77)*1)+SUMPRODUCT(ISERROR('Balance general'!C6:AC{P['BAL.chk']})*1)", 'eq0'),
        ('Encuesta: muestra mínima calculada', '=N_MUESTRA', 'info'),
        ('VAN económico positivo', '=EV_VAN', 'gt0'),
        ('TIR mayor que la TRMA', '=IF(ISNUMBER(EV_TIR),EV_TIR-TRMA,-1)', 'gt0'),
        ('Utilidad neta del último año positiva', f"={Y('ER.un', 5)}", 'gt0'),
    ]
    r = 6
    for i, (d, f, kind) in enumerate(checks):
        put(ws, f'A{r}', i+1, 'label', FMT_INT); put(ws, f'B{r}', d, 'label')
        put(ws, f'C{r}', f, 'calc', FMT_BS2)
        cond = {'abs<0.1': f'ABS(C{r})<0.1', 'eq1': f'C{r}=1', 'abs<0.0001': f'ABS(C{r})<0.0001', 'abs<0.01': f'ABS(C{r})<0.01', 'eq0': f'C{r}=0', 'gt0': f'C{r}>0'}.get(kind)
        put(ws, f'D{r}', f'=IF({cond},"OK","REVISAR")' if cond else '="INFO"', 'calc', bold=True)
        r += 1
    put(ws, f'B{r+1}', 'Controles en OK', 'label', bold=True); put(ws, f'C{r+1}', f'=COUNTIF(D6:D{r-1},"OK")', 'calc', FMT_INT, bold=True)
    put(ws, f'B{r+2}', 'Controles evaluados', 'label', bold=True); put(ws, f'C{r+2}', f'=COUNTIF(D6:D{r-1},"OK")+COUNTIF(D6:D{r-1},"REVISAR")', 'calc', FMT_INT, bold=True)
    B.name('CTRL_OK', 'Controles', f'C{r+1}'); B.name('CTRL_TOT', 'Controles', f'C{r+2}')
    return ws

def build_sensibilidad(B):
    ws = B.sheet('Sensibilidad', 'ANÁLISIS DE SENSIBILIDAD Y PRUEBAS DE ESTRÉS')
    widths(ws, {'A': 40, 'B': 16, 'C': 16, 'D': 16, 'E': 16, 'F': 16, 'G': 30})
    put(ws, 'A5', 'Valores en vivo con los supuestos actuales', 'sec')
    put(ws, 'A6', 'VAN actual ($us)', 'label'); put(ws, 'B6', '=EV_VAN', 'calc', FMT_BS2)
    put(ws, 'A7', 'TIR actual', 'label'); put(ws, 'B7', '=EV_TIR', 'calc', FMT_PCT2)
    put(ws, 'A8', 'Escenario activo', 'label'); put(ws, 'B8', '=NOMBRE_ESCENARIO', 'calc')
    ROW['SEN.start'] = 10
    return ws

def build_dashboard(B):
    ws = B.sheet('Dashboard', 'TABLERO EJECUTIVO ($us; el VAN también en Bs)')
    P = ROW
    widths(ws, {'A': 34, 'B': 30, 'C': 15, 'D': 34, 'E': 18, 'F': 15})
    ER = lambda k, y: Y('ER.' + k, y)
    left = [('Escenario activo', '=NOMBRE_ESCENARIO', None), ('VAN económico ($us)', '=EV_VAN', FMT_BS2), ('VAN económico (Bs)', '=EV_VAN_BS', FMT_BS),
            ('TIR económica', '=EV_TIR', FMT_PCT2), ('TRMA', '=TRMA', FMT_PCT2), ('Relación beneficio/costo', '=EV_BC', FMT_X),
            ('Período de recuperación', '=EV_PRI_TXT', None), ('VAN del inversionista ($us)', '=EV_VAN_INV', FMT_BS2), ('TIR del inversionista', '=EV_TIR_INV', FMT_PCT2),
            ('Decisión', '=EV_DECISION', None), ('Inversión total ($us)', '=INVERSION_TOTAL', FMT_BS2), ('Préstamo ($us)', '=PRESTAMO', FMT_BS2),
            ('Aporte de socios ($us)', '=APORTE_SOCIOS', FMT_BS2), ('Tipo de cambio usado (Bs por $us)', '=TIPO_CAMBIO', FMT_BS2)]
    right = [('Ventas 2027 (filtros)', f"={ER('u',1)}", FMT_U), ('Ventas 2031 (filtros)', f"={ER('u',5)}", FMT_U), ('Ventas netas 2027 ($us)', f"={ER('vn',1)}", FMT_BS2),
             ('Ventas netas 2031 ($us)', f"={ER('vn',5)}", FMT_BS2), ('Utilidad neta 2027 ($us)', f"={ER('un',1)}", FMT_BS2), ('Utilidad neta 2031 ($us)', f"={ER('un',5)}", FMT_BS2),
             ('Punto de equilibrio 2027 (filtros)', f"={Y('PE.peu', 1)}", FMT_U), ('Margen de seguridad 2027', f"={Y('PE.ms', 1)}", FMT_PCT),
             ('Utilización de capacidad 2027', f"={Y('CAP.util', 1)}", FMT_PCT), ('Utilización de capacidad 2031', f"={Y('CAP.util', 5)}", FMT_PCT),
             ('Caja mínima trimestral ($us)', f"=MIN({A0('FC.sfin')},{QR('FC.sfin', 1, 20)})", FMT_BS2), ('Controles en OK', '=CTRL_OK&" de "&CTRL_TOT', None)]
    put(ws, 'A5', 'Rentabilidad e inversión', 'sec'); put(ws, 'D5', 'Operación y liquidez', 'sec')
    c = put(ws, 'D3', 'Cambiar el tipo de cambio (clic acá)', 'label'); c.hyperlink = "#'Supuestos'!B3"
    c.font = Font(name=FONT, size=12, bold=True, color='0563C1', underline='single')
    for i, (l, f, fm) in enumerate(left):
        put(ws, f'A{6+i}', l, 'label'); put(ws, f'B{6+i}', f, 'calc', fm, bold=True)
    for i, (l, f, fm) in enumerate(right):
        put(ws, f'D{6+i}', l, 'label'); put(ws, f'E{6+i}', f, 'calc', fm, bold=True)
    r = 6 + max(len(left), len(right)) + 1
    put(ws, f'A{r}', 'Datos para gráficos ($us)', 'sec'); r += 1
    put(ws, f'A{r}', 'Año', 'hdr')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', str(2026+y), 'hdr')
    hr = r; r += 1
    for lbl, k in [('Ventas netas', 'vn'), ('Utilidad neta', 'un'), ('Utilidad operativa', 'ebit')]:
        put(ws, f'A{r}', lbl, 'label')
        for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"={ER(k,y)}", 'link', FMT_BS)
        r += 1
    put(ws, f'A{r}', 'Flujo económico', 'label')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"={Y('EV.fe', y)}", 'link', FMT_BS)
    rfe = r; r += 1
    put(ws, f'A{r}', 'Caja al cierre del año', 'label')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"={Y('FC.sfin_y', y)}", 'link', FMT_BS)
    rcj = r; r += 2
    ch = BarChart(); ch.title = 'Ventas netas, utilidad operativa y utilidad neta ($us)'; ch.height = 8; ch.width = 15
    ch.add_data(Reference(ws, min_col=1, max_col=6, min_row=hr+1, max_row=hr+3), from_rows=True, titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, max_col=6, min_row=hr))
    ws.add_chart(ch, f'A{r}')
    ch3 = LineChart(); ch3.title = 'Saldo de caja al cierre de cada trimestre ($us)'; ch3.height = 8; ch3.width = 30
    fcws = B.wb['Flujo de caja']
    ch3.add_data(Reference(fcws, min_col=3, max_col=22, min_row=35), from_rows=True, titles_from_data=False)
    ch3.set_categories(Reference(B.wb['Calendario'], min_col=4, max_col=23, min_row=16))
    ch3.series[0].tx = SeriesLabel(v='Caja final'); ch3.legend = None
    ch2 = BarChart(); ch2.title = 'Flujo económico y caja al cierre ($us)'; ch2.height = 8; ch2.width = 15
    ch2.add_data(Reference(ws, min_col=1, max_col=6, min_row=rfe, max_row=rcj), from_rows=True, titles_from_data=True)
    ch2.set_categories(Reference(ws, min_col=2, max_col=6, min_row=hr))
    ws.add_chart(ch2, f'D{r}')
    ws.add_chart(ch3, f'A{r+18}')
    return ws
