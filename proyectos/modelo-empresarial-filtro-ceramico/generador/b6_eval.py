from lib import *
from b1_supuestos import ROW
from b2_mercado import year_hdr

def build_evaluacion(B):
    ws = B.sheet('Rentabilidad', 'EVALUACIÓN DEL PROYECTO: FLUJO DE FONDOS, VAN, TIR, PRI, B/C', 'Equivale a "Rentabilidad" de ambos originales. Flujo económico (sin deuda) y flujo del inversionista (con deuda).', tab='C00000')
    P = ROW
    year_hdr(ws, 5, cols=ec, years=range(0, 6), label=lambda y: 'Año 0 (2026)' if y == 0 else str(2026+y))
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{P['ER.'+k]}"
    r = 6
    def A(key, label, fn, y0=None, fmt=FMT_BS, bold=False, fill=None):
        nonlocal r
        put(ws, f'A{r}', label, 'label', bold=bold, fill=fill); put(ws, f'B{r}', 'Bs' if fmt == FMT_BS else '', 'note')
        if y0 is not None: put(ws, f'C{r}', y0, 'calc', fmt, bold=bold, fill=fill)
        for y in range(1, 6):
            v = fn(y)
            put(ws, f'{ec(y)}{r}', v, 'link' if '!' in v else 'calc', fmt, bold=bold, fill=fill)
        P['EV.' + key] = r; r += 1
    put(ws, f'A{r}', 'A. FLUJO DE FONDOS ECONÓMICO (del proyecto, sin financiamiento)', 'sec'); r += 1
    A('vn', 'Ventas netas', lambda y: f"={ER('vn', y)}")
    A('cv', '(-) Costo de ventas', lambda y: f"=-{ER('cv', y)}")
    A('gop', '(-) Gastos operativos sin depreciación ni amortización', lambda y: f"=-({ER('gop', y)}-{ER('dep_fab', y)}-{ER('dep_adm', y)}-{ER('amort', y)})")
    A('da', '(-) Depreciación y amortización', lambda y: f"=-({ER('dep_fab', y)}+{ER('dep_adm', y)}+{ER('amort', y)})")
    A('ebit', 'Utilidad operativa (EBIT)', lambda y: f"=SUM({ec(y)}{P['EV.vn']}:{ec(y)}{P['EV.da']})", bold=True)
    A('tax', '(-) IUE sobre la utilidad operativa', lambda y: f"=-MAX(0,{ec(y)}{P['EV.ebit']})*TASA_IUE")
    A('nopat', 'Utilidad operativa después de impuestos', lambda y: f"={ec(y)}{P['EV.ebit']}+{ec(y)}{P['EV.tax']}", bold=True)
    A('da2', '(+) Depreciación y amortización (no son salida de caja)', lambda y: f"=-{ec(y)}{P['EV.da']}")
    A('af', '(-) Inversión en activos fijos (incluye reposiciones)', lambda y: f"=-SUM('Maqu. y equip.'!{qc(4*y-3)}{P['AF.capex']}:{qc(4*y)}{P['AF.capex']})", y0="=-AF_ANIO0")
    A('dif', '(-) Inversión diferida y puesta en marcha', lambda y: '=0', y0='=-DIF_PAGO')
    A('ivarec', '(+) Recuperación del IVA de las inversiones (vía crédito fiscal)', lambda y: (f"=AF_ANIO0_IVA+DIF_IVA+SUM('Maqu. y equip.'!{qc(1)}{P['AF.capex_iva']}:{qc(4)}{P['AF.capex_iva']})" if y == 1 else f"=SUM('Maqu. y equip.'!{qc(4*y-3)}{P['AF.capex_iva']}:{qc(4*y)}{P['AF.capex_iva']})"), y0='=0')
    ct = lambda y: f"'Inversión'!{L(1+y)}{P['INV.ct_row']}"
    A('ct', '(-) Inversión / (+) recuperación de capital de trabajo', lambda y: (f"=-({ct(y+1)}-{ct(y)})" if y < 5 else f"={ct(5)}"), y0=f"=-{ct(1)}")
    A('vr', '(+) Valor residual', lambda y: '=0' if y < 5 else f"=IF(METODO_VR=1,'Maqu. y equip.'!{yc(5)}{P['AF.vnl']},({ec(5)}{P['EV.nopat']}+{ec(5)}{P['EV.da2']})*(1+G_PERP)/(TRMA-G_PERP))")
    A('fe', 'FLUJO ECONÓMICO NETO', lambda y: f"={ec(y)}{P['EV.nopat']}+SUM({ec(y)}{P['EV.da2']}:{ec(y)}{P['EV.vr']})", y0=f"=SUM(C{P['EV.af']}:C{P['EV.ct']})", bold=True, fill=FILL_KEY)
    A('fd', 'Factor de descuento a la TRMA', lambda y: f'=1/(1+TRMA)^{y}', y0='=1', fmt='0.0000')
    A('fdesc', 'Flujo descontado', lambda y: f"={ec(y)}{P['EV.fe']}*{ec(y)}{P['EV.fd']}", y0=f"=C{P['EV.fe']}*C{P['EV.fd']}")
    A('acum', 'Flujo acumulado', lambda y: f"={ec(y-1)}{r}+{ec(y)}{P['EV.fe']}", y0=f"=C{P['EV.fe']}")
    A('acumd', 'Flujo descontado acumulado', lambda y: f"={ec(y-1)}{r}+{ec(y)}{P['EV.fdesc']}", y0=f"=C{P['EV.fdesc']}")
    A('pri_s', 'Auxiliar PRI simple', lambda y: f"=IF(AND({ec(y-1)}{P['EV.acum']}<0,{ec(y)}{P['EV.acum']}>=0),{y-1}+(-{ec(y-1)}{P['EV.acum']})/{ec(y)}{P['EV.fe']},\"\")", fmt=FMT_BS2)
    A('pri_d', 'Auxiliar PRI descontado', lambda y: f"=IF(AND({ec(y-1)}{P['EV.acumd']}<0,{ec(y)}{P['EV.acumd']}>=0),{y-1}+(-{ec(y-1)}{P['EV.acumd']})/{ec(y)}{P['EV.fdesc']},\"\")", fmt=FMT_BS2)
    r += 1
    put(ws, f'A{r}', 'B. INDICADORES (flujo económico)', 'sec'); r += 1
    fe = P['EV.fe']
    ind = [('VAN', 'Valor Actual Neto (VAN) a la TRMA', f'=NPV(TRMA,D{fe}:H{fe})+C{fe}', FMT_BS),
           ('VAN_CHK', 'Control: suma de flujos descontados', f"=SUM(C{P['EV.fdesc']}:H{P['EV.fdesc']})", FMT_BS),
           ('TIR', 'Tasa Interna de Retorno (TIR)', f'=IFERROR(IRR(C{fe}:H{fe}),"No existe (los flujos no cambian de signo)")', FMT_PCT2),
           ('TRMA_EV', 'TRMA (tasa de descuento)', '=TRMA', FMT_PCT2),
           ('REN_NETA', 'Rentabilidad neta = TIR - TRMA', None, FMT_PCT2),
           ('BC', 'Relación beneficio/costo = (VAN + inversión inicial) / inversión inicial', None, FMT_X),
           ('PRI', 'Período de recuperación simple (años)', f"=IF(COUNT(D{P['EV.pri_s']}:H{P['EV.pri_s']})=0,\"No se recupera en 5 años\",MIN(D{P['EV.pri_s']}:H{P['EV.pri_s']}))", FMT_BS2),
           ('PRI_TXT', 'PRI simple expresado', None, None),
           ('PRID', 'Período de recuperación descontado (años)', f"=IF(COUNT(D{P['EV.pri_d']}:H{P['EV.pri_d']})=0,\"No se recupera en 5 años\",MIN(D{P['EV.pri_d']}:H{P['EV.pri_d']}))", FMT_BS2),
           ('VR', 'Valor residual usado', f"=H{P['EV.vr']}", FMT_BS),
           ('INV0', 'Inversión inicial (año 0)', f'=-C{fe}', FMT_BS)]
    for k, lbl, fml, fm in ind:
        put(ws, f'A{r}', lbl, 'label', bold=k in ('VAN', 'TIR')); P['EV.' + k] = r
        if fml: put(ws, f'C{r}', fml, 'calc', fm, bold=k in ('VAN', 'TIR'), fill=FILL_KEY if k in ('VAN', 'TIR') else None)
        r += 1
    put(ws, f"C{P['EV.REN_NETA']}", f"=IF(ISNUMBER(C{P['EV.TIR']}),C{P['EV.TIR']}-C{P['EV.TRMA_EV']},\"—\")", 'calc', FMT_PCT2)
    put(ws, f"C{P['EV.BC']}", f"=(C{P['EV.VAN']}+C{P['EV.INV0']})/C{P['EV.INV0']}", 'calc', FMT_X)
    pr = P['EV.PRI']
    put(ws, f"C{P['EV.PRI_TXT']}", f'=IF(ISNUMBER(C{pr}),INT(C{pr})&" años, "&INT((C{pr}-INT(C{pr}))*12)&" meses y "&ROUND(((C{pr}-INT(C{pr}))*12-INT((C{pr}-INT(C{pr}))*12))*30,0)&" días",C{pr})', 'calc')
    for nm in ['VAN', 'TIR', 'BC', 'PRI', 'PRID', 'INV0', 'REN_NETA']:
        B.name('EV_' + nm, 'Rentabilidad', f"C{P['EV.'+nm]}")
    put(ws, f'A{r}', 'Decisión', 'label', bold=True)
    put(ws, f'C{r}', f"=IF(AND(C{P['EV.VAN']}>0,ISNUMBER(C{P['EV.TIR']})),IF(C{P['EV.TIR']}>TRMA,\"ACEPTAR: VAN > 0 y TIR > TRMA\",\"REVISAR\"),\"RECHAZAR o reformular: VAN ≤ 0\")", 'calc', bold=True)
    P['EV.decision'] = r; B.name('EV_DECISION', 'Rentabilidad', f'C{r}'); r += 2
    put(ws, f'A{r}', 'C. FLUJO DEL INVERSIONISTA (con préstamo)', 'sec'); r += 1
    year_hdr(ws, r, cols=ec, years=range(0, 6), label=lambda y: 'Año 0' if y == 0 else str(2026+y)); r += 1
    FIN = lambda k, y: f"SUM('Financiamiento'!{qc(4*y-3)}{P[k]}:{qc(4*y)}{P[k]})"
    A('fe2', 'Flujo económico', lambda y: f"={ec(y)}{fe}", y0=f'=C{fe}')
    A('prest', '(+) Préstamo', lambda y: '=0', y0='=PRESTAMO')
    A('int', '(-) Intereses', lambda y: f"=-{FIN('FIN.int', y)}")
    A('esc', '(+) Escudo fiscal de los intereses', lambda y: f"=MIN(-{ec(y)}{P['EV.int']},MAX(0,{ec(y)}{P['EV.ebit']}))*TASA_IUE")
    A('amo', '(-) Amortización del préstamo', lambda y: f"=-{FIN('FIN.amort', y)}")
    A('fi', 'FLUJO DEL INVERSIONISTA', lambda y: f"=SUM({ec(y)}{P['EV.fe2']}:{ec(y)}{P['EV.amo']})", y0=f"=SUM(C{P['EV.fe2']}:C{P['EV.amo']})", bold=True, fill=FILL_KEY)
    fi = P['EV.fi']
    put(ws, f'A{r}', 'VAN del inversionista a la TRMA', 'label', bold=True); put(ws, f'C{r}', f'=NPV(TRMA,D{fi}:H{fi})+C{fi}', 'calc', FMT_BS, bold=True); B.name('EV_VAN_INV', 'Rentabilidad', f'C{r}'); r += 1
    put(ws, f'A{r}', 'TIR del inversionista', 'label', bold=True); put(ws, f'C{r}', f'=IFERROR(IRR(C{fi}:H{fi}),"No existe")', 'calc', FMT_PCT2, bold=True); B.name('EV_TIR_INV', 'Rentabilidad', f'C{r}'); r += 2
    put(ws, f'A{r}', 'Correcciones: Ñapefit calculaba el PRI con signo cambiado (B46+(C33+D46)/C47 = 1,89 años, cuando correspondía 2,11) y Hypotolab escribía "3 años 4 meses" a mano cuando su fórmula daba 3,05 años. Ambos tenían el "valor residual por perpetuidad" sin fórmula completa o con g = 0 sin justificar. Aquí todo sale de fórmulas.', 'note')
    widths(ws, {'A': 62, 'B': 6})
    for y in range(0, 6): ws.column_dimensions[ec(y)].width = 15
    return ws

def build_pe(B):
    ws = B.wb['Rentabilidad']
    P = ROW
    r0 = ws.max_row + 3
    put(ws, f'A{r0}', 'D. PUNTO DE EQUILIBRIO (Hypotolab lo calculaba; Ñapefit lo dejó vacío)', 'sec')
    HR = r0 + 1
    year_hdr(ws, HR)
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{P['ER.'+k]}"
    r = HR + 1
    def A(key, label, fn, fmt=FMT_BS, bold=False, fill=None, unit='Bs'):
        nonlocal r
        arow(ws, r, label, unit, fn, fmt, bold=bold, fill=fill); P['PE.' + key] = r; r += 1
    A('u', 'Unidades vendidas', lambda y: f"={ER('u', y)}", FMT_U, unit='kits')
    A('vn', 'Ventas netas', lambda y: f"={ER('vn', y)}")
    A('p', 'Precio neto por kit', lambda y: f"={ac(y)}{P['PE.vn']}/{ac(y)}{P['PE.u']}", FMT_BS2, unit='Bs/kit')
    A('cvt', 'Costos variables (costo de ventas + entrega + IT)', lambda y: f"={ER('cv', y)}+{ER('ent', y)}+{ER('it', y)}")
    A('cvu', 'Costo variable por kit', lambda y: f"={ac(y)}{P['PE.cvt']}/{ac(y)}{P['PE.u']}", FMT_BS2, unit='Bs/kit')
    A('mcu', 'Margen de contribución por kit', lambda y: f"={ac(y)}{P['PE.p']}-{ac(y)}{P['PE.cvu']}", FMT_BS2, bold=True, unit='Bs/kit')
    A('mcp', 'Razón de contribución', lambda y: f"={ac(y)}{P['PE.mcu']}/{ac(y)}{P['PE.p']}", FMT_PCT, unit='%')
    A('cf', 'Costos fijos operativos', lambda y: f"={ER('gop', y)}-{ER('ent', y)}-{ER('it', y)}")
    A('da', '   de los cuales: depreciación y amortización', lambda y: f"={ER('dep_fab', y)}+{ER('dep_adm', y)}+{ER('amort', y)}")
    A('int', 'Intereses', lambda y: f"={ER('int', y)}")
    A('peu', 'PUNTO DE EQUILIBRIO OPERATIVO', lambda y: f"={ac(y)}{P['PE.cf']}/{ac(y)}{P['PE.mcu']}", FMT_U, bold=True, fill=FILL_KEY, unit='kits')
    A('pebs', 'Punto de equilibrio en Bs (ventas netas)', lambda y: f"={ac(y)}{P['PE.peu']}*{ac(y)}{P['PE.p']}")
    A('pef', 'Punto de equilibrio con intereses', lambda y: f"=({ac(y)}{P['PE.cf']}+{ac(y)}{P['PE.int']})/{ac(y)}{P['PE.mcu']}", FMT_U, unit='kits')
    A('pec', 'Punto de equilibrio de caja (sin depreciación ni amortización)', lambda y: f"=({ac(y)}{P['PE.cf']}-{ac(y)}{P['PE.da']})/{ac(y)}{P['PE.mcu']}", FMT_U, unit='kits')
    A('ms', 'Margen de seguridad = (ventas - equilibrio) / ventas', lambda y: f"=({ac(y)}{P['PE.u']}-{ac(y)}{P['PE.peu']})/{ac(y)}{P['PE.u']}", FMT_PCT, bold=True, unit='%')
    A('cap', 'Capacidad instalada anual', lambda y: '=CAP_ANUAL', FMT_U, unit='kits')
    A('pecap', 'Punto de equilibrio como % de la capacidad', lambda y: f"={ac(y)}{P['PE.peu']}/{ac(y)}{P['PE.cap']}", FMT_PCT, unit='%')
    A('ok', 'Control: equilibrio alcanzable con la capacidad (1 = sí)', lambda y: f"=IF({ac(y)}{P['PE.peu']}<={ac(y)}{P['PE.cap']},1,0)", FMT_INT, unit='')
    put(ws, f'A{r+1}', 'Fórmula: PE = costos fijos / (precio neto - costo variable unitario). Corrección respecto de Hypotolab: allí se mezclaban precio con impuestos y costos fijos que incluían IVA.', 'note')
    from openpyxl.chart import BarChart, LineChart, Reference
    ch = BarChart(); ch.title = 'Ventas vs. punto de equilibrio (kits)'; ch.y_axis.title = 'kits'
    ch.add_data(Reference(ws, min_col=3, max_col=7, min_row=P['PE.u']), from_rows=True, titles_from_data=False)
    ch.add_data(Reference(ws, min_col=3, max_col=7, min_row=P['PE.peu']), from_rows=True, titles_from_data=False)
    ch.series[0].tx = None; ch.set_categories(Reference(ws, min_col=3, max_col=7, min_row=HR))
    from openpyxl.chart.series import SeriesLabel
    ch.series[0].tx = SeriesLabel(v='Ventas'); ch.series[1].tx = SeriesLabel(v='Punto de equilibrio')
    ch.height = 8; ch.width = 18
    ws.add_chart(ch, f'A{r+3}')
    return ws

def build_ratios(B):
    ws = B.sheet('Ratios', 'INDICADORES FINANCIEROS ANUALES', 'Rentabilidad, liquidez, endeudamiento y eficiencia a partir de los estados financieros.', tab='C00000')
    P = ROW
    year_hdr(ws, 5)
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{P['ER.'+k]}"
    BL = lambda k, y: f"'Balance general'!{yc(y)}{P['BAL.'+k]}"
    rows = [('Margen bruto', lambda y: f"={ER('ub', y)}/{ER('vn', y)}", FMT_PCT),
            ('Margen operativo (EBIT / ventas netas)', lambda y: f"={ER('ebit', y)}/{ER('vn', y)}", FMT_PCT),
            ('Margen neto', lambda y: f"={ER('un', y)}/{ER('vn', y)}", FMT_PCT),
            ('Rentabilidad sobre activos (ROA)', lambda y: f"={ER('un', y)}/{BL('at', y)}", FMT_PCT),
            ('Rentabilidad sobre patrimonio (ROE)', lambda y: f"={ER('un', y)}/{BL('pat', y)}", FMT_PCT),
            ('Liquidez corriente (activo corriente / pasivo corriente)', lambda y: f"=IF(({BL('iue', y)}+{BL('pri', y)}+SUM('Financiamiento'!{qc(min(4*y+1,20))}{P['FIN.amort']}:{qc(min(4*y+4,20))}{P['FIN.amort']})*{1 if y<5 else 0})>0,{BL('ac', y)}/({BL('iue', y)}+{BL('pri', y)}+SUM('Financiamiento'!{qc(min(4*y+1,20))}{P['FIN.amort']}:{qc(min(4*y+4,20))}{P['FIN.amort']})*{1 if y<5 else 0}),\"sin pasivo corriente\")", FMT_X),
            ('Endeudamiento (pasivo total / activo total)', lambda y: f"={BL('pt', y)}/{BL('at', y)}", FMT_PCT),
            ('Cobertura de intereses (EBIT / intereses)', lambda y: f"=IF({ER('int', y)}>0,{ER('ebit', y)}/{ER('int', y)},\"sin deuda\")", FMT_X),
            ('Rotación de inventario de producto terminado (veces)', lambda y: f"=IF({BL('ipt', y)}>0,{ER('cv', y)}/{BL('ipt', y)},0)", FMT_BS2),
            ('Utilización de la capacidad instalada', lambda y: f"='Capacidad Inst.'!{yc(y)}{P['CAP.util']}", FMT_PCT),
            ('Caja al cierre del año (Bs)', lambda y: f"={BL('caja', y)}", FMT_BS)]
    r = 6
    for lbl, fn, fm in rows:
        arow(ws, r, lbl, '', fn, fm); r += 1
    put(ws, f'A{r+1}', 'Pasivo corriente = IUE por pagar + prima por pagar + amortizaciones del préstamo de los 4 trimestres siguientes.', 'note')
    return ws
