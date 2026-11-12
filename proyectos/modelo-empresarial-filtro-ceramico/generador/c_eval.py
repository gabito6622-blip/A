from lib import *
from b1_supuestos import ROW

def build_rentabilidad(B):
    ws = B.wb.create_sheet('Rentabilidad')
    widths(ws, {'A': 4, 'B': 52, 'C': 16.5, 'D': 15.5, 'E': 14, 'F': 14.5, 'G': 16.5, 'H': 16, 'I': 4})
    P = ROW
    def bar(r, t, c1='B', c2='I'):
        put(ws, f'{c1}{r}', t, 'bar'); ws.merge_cells(f'{c1}{r}:{c2}{r}')
    def yhdr(r, first='Cuentas', c0='Año 0'):
        put(ws, f'B{r}', first, 'hdr'); put(ws, f'C{r}', c0, 'hdr')
        for y in range(1, 6): put(ws, f'{ec(y)}{r}', 2026 + y, 'hdr')
    # ---------- detalle del flujo económico (abajo, alimenta la parte de arriba) ----------
    D0 = 100
    bar(D0, 'DETALLE DEL FLUJO DE FONDOS ECONÓMICO ($us): de dónde sale la fila "Inversion" de arriba')
    yhdr(D0 + 2)
    r = D0 + 3
    def A(key, label, fn, y0=None, fmt=FMT_BS2, bold=False, fill=None):
        nonlocal r
        put(ws, f'B{r}', label, 'label', bold=bold, border=True)
        if y0 is not None: put(ws, f'C{r}', y0, 'calc', fmt, bold=bold, fill=fill)
        for y in range(1, 6):
            v = fn(y); put(ws, f'{ec(y)}{r}', v, 'link' if '!' in v else 'calc', fmt, bold=bold, fill=fill)
        P['EV.' + key] = r; r += 1
    capex_y = lambda y: f"SUM({QR('AF.capex', 4*y-3, 4*y)})"
    capiva_y = lambda y: f"SUM({QR('AF.capex_iva', 4*y-3, 4*y)})"
    A('vn', 'Ventas netas', lambda y: f"={Y('ER.vn', y)}")
    A('cv', '(-) Costo de ventas', lambda y: f"=-{Y('ER.cv', y)}")
    A('gop', '(-) Gastos operativos sin depreciación ni amortización', lambda y: f"=-({Y('ER.gop', y)}-{Y('ER.dep_fab', y)}-{Y('ER.dep_adm', y)}-{Y('ER.amort', y)})")
    A('da', '(-) Depreciación y amortización', lambda y: f"=-({Y('ER.dep_fab', y)}+{Y('ER.dep_adm', y)}+{Y('ER.amort', y)})")
    A('ebit', 'Utilidad operativa', lambda y: f"=SUM({ec(y)}{P['EV.vn']}:{ec(y)}{P['EV.da']})", bold=True)
    A('tax', '(-) IUE sobre la utilidad operativa', lambda y: f"=-MAX(0,{ec(y)}{P['EV.ebit']})*TASA_IUE")
    A('nopat', 'Utilidad operativa después de impuestos', lambda y: f"={ec(y)}{P['EV.ebit']}+{ec(y)}{P['EV.tax']}", bold=True)
    A('da2', '(+) Depreciación y amortización', lambda y: f"=-{ec(y)}{P['EV.da']}")
    A('af', '(-) Inversión en activos fijos', lambda y: f'=-{capex_y(y)}', y0='=-AF_ANIO0')
    A('dif', '(-) Inversión diferida y puesta en marcha', lambda y: '=0', y0='=-DIF_PAGO')
    A('ivarec', '(+) Recuperación del IVA de la inversión', lambda y: (f'=AF_ANIO0_IVA+DIF_IVA+{capiva_y(1)}' if y == 1 else f'={capiva_y(y)}'), y0='=0')
    A('ct', '(-) Aumento del capital de trabajo', lambda y: (f"=-({Y('INV.ct', y+1)}-{Y('INV.ct', y)})" if y < 5 else '=0'), y0=f"=-{Y('INV.ct', 1)}")
    A('fop', 'FLUJO SIN VALOR RESIDUAL NI RECUPERACIÓN DEL CAPITAL DE TRABAJO', lambda y: f"={ec(y)}{P['EV.nopat']}+SUM({ec(y)}{P['EV.da2']}:{ec(y)}{P['EV.ct']})", y0=f"=SUM(C{P['EV.af']}:C{P['EV.ct']})", bold=True)
    A('opf', 'Flujo operativo (utilidad operativa después de impuestos + depreciación)', lambda y: f"={ec(y)}{P['EV.nopat']}+{ec(y)}{P['EV.da2']}")
    r += 1
    fe = 24
    A('fd', 'Factor de descuento', lambda y: f'=1/(1+TRMA)^{y}', y0='=1', fmt='0.0000')
    A('fdesc', 'Flujo descontado', lambda y: f"={ec(y)}{fe}*{ec(y)}{P['EV.fd']}", y0=f"=C{fe}*C{P['EV.fd']}")
    A('acum', 'Flujo acumulado', lambda y: f"={ec(y-1)}{r}+{ec(y)}{fe}", y0=f'=C{fe}')
    A('acumd', 'Flujo descontado acumulado', lambda y: f"={ec(y-1)}{r}+{ec(y)}{P['EV.fdesc']}", y0=f"=C{P['EV.fdesc']}")
    A('pri_s', 'Auxiliar PRI simple', lambda y: f"=IF(AND({ec(y-1)}{P['EV.acum']}<0,{ec(y)}{P['EV.acum']}>=0),{y-1}+(-{ec(y-1)}{P['EV.acum']})/{ec(y)}{fe},\"\")")
    A('pri_d', 'Auxiliar PRI descontado', lambda y: f"=IF(AND({ec(y-1)}{P['EV.acumd']}<0,{ec(y)}{P['EV.acumd']}>=0),{y-1}+(-{ec(y-1)}{P['EV.acumd']})/{ec(y)}{P['EV.fdesc']},\"\")")
    put(ws, f'B{r}', 'Control: suma de flujos descontados = VAN', 'label', border=True); put(ws, f'C{r}', f"=SUM(C{P['EV.fdesc']}:H{P['EV.fdesc']})", 'calc', FMT_BS2)
    B.name('EV_VAN_CHK', 'Rentabilidad', f'C{r}'); r += 3
    DET_END = r
    # ---------- parte de arriba (mismas celdas que Ñapefit) ----------
    bar(2, 'FLUJO DE CAJA NETO ($us)')
    yhdr(4)
    put(ws, 'B5', 'Inversion', 'label', border=True)
    put(ws, 'C5', f"=C{P['EV.fop']}", 'calc', FMT_BS2)
    for y in range(1, 6): put(ws, f'{ec(y)}5', f"={ec(y)}{P['EV.fop']}", 'calc', FMT_BS2)
    put(ws, 'B6', 'Incluye la inversión inicial (año 0), el flujo operativo después de impuestos, la recuperación del IVA y el capital de trabajo. Detalle en la fila 100.', 'label', wrap=True)
    ws.merge_cells('B6:H6'); ws.row_dimensions[6].height = 30
    put(ws, 'B8', 'Valor Residual de Mercado', 'label', bold=True)
    put(ws, 'B10', 'Metodo de perpetuidad con crecimiento constante', 'hdr'); ws.merge_cells('B10:D10')
    put(ws, 'F10', 'Tasa de descuento', 'hdr'); ws.merge_cells('F10:G10'); put(ws, 'H10', '=TRMA', 'calc', FMT_PCT2)
    put(ws, 'B12', 'Cuentas', 'hdr'); ws.merge_cells('B12:B13')
    for y in range(1, 7):
        put(ws, f'{L(2+y)}12', y if y < 6 else 1, 'hdr'); put(ws, f'{L(2+y)}13', 2026 + y, 'hdr')
    put(ws, 'B14', 'Flujo de efectivo', 'label', border=True)
    for y in range(1, 6): put(ws, f'{L(2+y)}14', f"={ec(y)}{P['EV.opf']}", 'calc', FMT_BS2)
    put(ws, 'H14', '=G14*(1+G_PERP)', 'calc', FMT_BS2)
    put(ws, 'B15', 'VALOR RESIDUAL POR PERPETUIDAD = flujo 2032 / (TRMA - g)', 'label', border=True); put(ws, 'H15', '=H14/(H10-G_PERP)', 'calc', FMT_BS2)
    put(ws, 'B16', 'VALOR RESIDUAL CONTABLE= INV. DE AF- DEP ACUM', 'label', border=True); put(ws, 'H16', f"={Q('AF.vnl', 20)}", 'link', FMT_BS2)
    put(ws, 'B17', 'Valor residual usado (Supuestos: 1 = contable, 2 = perpetuidad)', 'label', bold=True, border=True); put(ws, 'H17', '=IF(METODO_VR=1,H16,H15)', 'calc', FMT_BS2, bold=True)
    yhdr(20)
    put(ws, 'B21', 'Inversion', 'label', border=True)
    for c in 'CDEFGH': put(ws, f'{c}21', f'={c}5', 'calc', FMT_BS2)
    put(ws, 'B22', 'Valor Residual de Mercado', 'label', border=True); put(ws, 'H22', '=H17', 'calc', FMT_BS2)
    put(ws, 'B23', 'Capital de trabajo', 'label', border=True); put(ws, 'H23', f"={Y('INV.ct', 5)}", 'link', FMT_BS2)
    put(ws, 'B24', 'Flujo de Caja de Neto', 'label', bold=True, border=True); put(ws, 'C24', '=C21', 'calc', FMT_BS2, bold=True, fill=FILL_KEY)
    for c in 'DEFGH': put(ws, f'{c}24', f'=SUM({c}21:{c}23)', 'calc', FMT_BS2, bold=True, fill=FILL_KEY)
    P['EV.fe'] = fe
    put(ws, 'D29', 'Tasa de descuento', 'hdr'); ws.merge_cells('D29:E29'); put(ws, 'F29', '=H10', 'calc', FMT_PCT2)
    put(ws, 'B32', 'Indices', 'hdr'); put(ws, 'C32', 'Monto/Tasa', 'hdr')
    ind = [(33, 'Inversion inicial', '=-C24', FMT_BS2, 'INV0'), (34, 'Valor Actual Neto (VAN)', '=NPV(F29,D24:H24)+C24', FMT_BS2, 'VAN'),
           (35, 'Tasa Interna de Retorno (TIR)', '=IFERROR(IRR(C24:H24),"No existe (los flujos no cambian de signo)")', FMT_PCT2, 'TIR'),
           (36, 'Valor Residual de Mercado', '=H22', FMT_BS2, None), (37, 'Periodo de Recuperacion de la Inversion (PRI)', None, None, 'PRI_TXT'),
           (38, 'Tasa de Descuento (TRMA)', '=F29', FMT_PCT2, None), (39, 'Rentabilidad neta del proyecto', '=IF(ISNUMBER(C35),C35-C38,"—")', FMT_PCT2, 'REN_NETA')]
    for rr, lbl, f, fm, nm in ind:
        key = nm in ('VAN', 'TIR')
        put(ws, f'B{rr}', lbl, 'label', bold=key, border=True)
        if f: put(ws, f'C{rr}', f, 'calc', fm, bold=key, fill=FILL_KEY if key else None)
        if nm: B.name('EV_' + nm, 'Rentabilidad', f'C{rr}')
    # PRI (tabla como Ñapefit)
    put(ws, 'B41', 'Periodo de Recuperacion de la Inversion - (PRI)', 'hdr'); ws.merge_cells('B41:D41')
    put(ws, 'B43', 'Año', 'hdr'); put(ws, 'C43', 'Flujo Caja neto', 'hdr'); put(ws, 'D43', 'Flujo Caja Acum.', 'hdr')
    for y in range(0, 6):
        rr = 44 + y
        put(ws, f'B{rr}', y, 'calc', FMT_INT); put(ws, f'C{rr}', f'={ec(y)}24', 'calc', FMT_BS2)
        put(ws, f'D{rr}', '=C44' if y == 0 else f'=D{rr-1}+C{rr}', 'calc', FMT_BS2)
    put(ws, 'C52', 'Periodos', 'hdr'); put(ws, 'D52', 'Tiempo', 'hdr')
    put(ws, 'B53', 'Periodo de Recuperacion de la Inversion', 'label', bold=True, wrap=True); ws.merge_cells('B53:B55')
    put(ws, 'C53', 'Años', 'label', border=True); put(ws, 'D53', '=IF(ISNUMBER(C57),INT(C57),"-")', 'calc', FMT_INT)
    put(ws, 'C54', 'Meses', 'label', border=True); put(ws, 'D54', '=IF(ISNUMBER(C57),INT(H57),"-")', 'calc', FMT_INT)
    put(ws, 'C55', 'Días', 'label', border=True); put(ws, 'D55', '=IF(ISNUMBER(C57),ROUND(H58,0),"-")', 'calc', FMT_INT)
    put(ws, 'B57', 'Periodo de Recuperacion de la Inversión (años)', 'label', bold=True, border=True)
    put(ws, 'C57', f"=IF(COUNT(D{P['EV.pri_s']}:H{P['EV.pri_s']})=0,\"No se recupera en 5 años\",MIN(D{P['EV.pri_s']}:H{P['EV.pri_s']}))", 'calc', FMT_BS2, bold=True); ws.merge_cells('C57:E57')
    B.name('EV_PRI', 'Rentabilidad', 'C57')
    put(ws, 'G57', 'Meses', 'label', border=True); put(ws, 'H57', '=IF(ISNUMBER(C57),(C57-INT(C57))*12,0)', 'calc', FMT_BS2)
    put(ws, 'G58', 'Dias', 'label', border=True); put(ws, 'H58', '=(H57-INT(H57))*30', 'calc', FMT_BS2)
    put(ws, 'C37', '=IF(ISNUMBER(C57),D53&IF(D53=1," año, "," años, ")&D54&IF(D54=1," mes y "," meses y ")&D55&" días",C57)', 'calc')
    # otros indicadores (a la derecha de los índices)
    put(ws, 'E32', 'Otros indicadores', 'hdr'); ws.merge_cells('E32:G32'); put(ws, 'H32', 'Valor', 'hdr')
    otros = [('Relación beneficio / costo', '=(C34+C33)/C33', FMT_X, 'BC'),
             ('PRI descontado (años)', f"=IF(COUNT(D{P['EV.pri_d']}:H{P['EV.pri_d']})=0,\"No se recupera\",MIN(D{P['EV.pri_d']}:H{P['EV.pri_d']}))", FMT_BS2, 'PRID'),
             ('VAN en bolivianos', '=C34*TIPO_CAMBIO', FMT_BS, 'VAN_BS'), ('Inversión inicial en bolivianos', '=C33*TIPO_CAMBIO', FMT_BS, None),
             ('Tipo de cambio (Bs por 1 $us)', '=TIPO_CAMBIO', FMT_BS2, None),
             ('Decisión', '=IF(AND(C34>0,ISNUMBER(C35)),IF(C35>C38,"ACEPTAR: VAN > 0 y TIR > TRMA","REVISAR"),"RECHAZAR: VAN <= 0")', None, 'DECISION')]
    for i, (lbl, f, fm, nm) in enumerate(otros):
        rr = 33 + i
        put(ws, f'E{rr}', lbl, 'label', border=True, bold=nm == 'DECISION'); ws.merge_cells(f'E{rr}:G{rr}')
        put(ws, f'H{rr}', f, 'calc', fm, bold=nm == 'DECISION')
        if nm: B.name('EV_' + nm, 'Rentabilidad', f'H{rr}')
    # punto de equilibrio (como Ñapefit)
    bar(63, 'PUNTO DE EQUILIBRIO')
    put(ws, 'B65', 'DETERMINACION DEL PUNTO DE EQUILIBRIO EN UND', 'hdr'); ws.merge_cells('B65:C65')
    put(ws, 'B66', 'AÑO', 'hdr'); ws.merge_cells('B66:B67'); put(ws, 'C66', 'PUNTO DE EQUILIBRIO', 'hdr'); ws.merge_cells('C66:C67')
    put(ws, 'D66', 'VENTAS', 'hdr'); ws.merge_cells('D66:D67'); put(ws, 'E66', 'MARGEN DE SEGURIDAD', 'hdr'); ws.merge_cells('E66:E67')
    ws.row_dimensions[66].height = 22
    # tabla de detalle del punto de equilibrio (debajo del flujo)
    r = DET_END
    bar(r, 'DETALLE DEL PUNTO DE EQUILIBRIO'); r += 2
    HR = r
    put(ws, f'B{r}', 'AÑO', 'hdr')
    for y in range(1, 6): put(ws, f'{ac(y)}{r}', 2026 + y, 'hdr')
    r += 1
    def PE(key, label, fn, fmt=FMT_BS2, bold=False, fill=None):
        nonlocal r
        put(ws, f'B{r}', label, 'label', bold=bold, border=True)
        for y in range(1, 6):
            v = fn(y); put(ws, f'{ac(y)}{r}', v, 'link' if '!' in v else 'calc', fmt, bold=bold, fill=fill)
        P['PE.' + key] = r; reg('PE.' + key, 'Rentabilidad', y=(lambda r_: (lambda y: f'{ac(y)}{r_}'))(r)); r += 1
    PE('u', 'Unidades vendidas', lambda y: f"={Y('ER.u', y)}", FMT_U)
    PE('vn', 'Ventas netas ($us)', lambda y: f"={Y('ER.vn', y)}")
    PE('p', 'Precio neto por filtro ($us)', lambda y: f"={ac(y)}{P['PE.vn']}/{ac(y)}{P['PE.u']}")
    PE('cvt', 'Costos variables (costo de ventas + entrega + IT)', lambda y: f"={Y('ER.cv', y)}+{Y('ER.ent', y)}+{Y('ER.it', y)}")
    PE('cvu', 'Costo variable por filtro ($us)', lambda y: f"={ac(y)}{P['PE.cvt']}/{ac(y)}{P['PE.u']}")
    PE('mcu', 'Margen de contribución por filtro ($us)', lambda y: f"={ac(y)}{P['PE.p']}-{ac(y)}{P['PE.cvu']}", bold=True)
    PE('mcp', 'Razón de contribución', lambda y: f"={ac(y)}{P['PE.mcu']}/{ac(y)}{P['PE.p']}", FMT_PCT)
    PE('cf', 'Costos fijos ($us)', lambda y: f"={Y('ER.gop', y)}-{Y('ER.ent', y)}-{Y('ER.it', y)}")
    PE('da', '   de los cuales: depreciación y amortización', lambda y: f"={Y('ER.dep_fab', y)}+{Y('ER.dep_adm', y)}+{Y('ER.amort', y)}")
    PE('int', 'Intereses ($us)', lambda y: f"={Y('ER.int', y)}")
    PE('peu', 'PUNTO DE EQUILIBRIO (filtros) = costos fijos / margen por filtro', lambda y: f"={ac(y)}{P['PE.cf']}/{ac(y)}{P['PE.mcu']}", FMT_U, bold=True, fill=FILL_KEY)
    PE('pebs', 'Punto de equilibrio en ventas netas ($us)', lambda y: f"={ac(y)}{P['PE.peu']}*{ac(y)}{P['PE.p']}")
    PE('pef', 'Punto de equilibrio con intereses (filtros)', lambda y: f"=({ac(y)}{P['PE.cf']}+{ac(y)}{P['PE.int']})/{ac(y)}{P['PE.mcu']}", FMT_U)
    PE('pec', 'Punto de equilibrio de caja (filtros)', lambda y: f"=({ac(y)}{P['PE.cf']}-{ac(y)}{P['PE.da']})/{ac(y)}{P['PE.mcu']}", FMT_U)
    PE('ms', 'Margen de seguridad', lambda y: f"=({ac(y)}{P['PE.u']}-{ac(y)}{P['PE.peu']})/{ac(y)}{P['PE.u']}", FMT_PCT, bold=True)
    PE('cap', 'Capacidad instalada anual', lambda y: '=CAP_ANUAL', FMT_U)
    PE('pecap', 'Punto de equilibrio / capacidad', lambda y: f"={ac(y)}{P['PE.peu']}/{ac(y)}{P['PE.cap']}", FMT_PCT)
    PE('ok', 'Control: equilibrio alcanzable (1 = sí)', lambda y: f"=IF({ac(y)}{P['PE.peu']}<={ac(y)}{P['PE.cap']},1,0)", FMT_INT)
    for y in range(1, 6):
        rr = 67 + y
        put(ws, f'B{rr}', 2026 + y, 'calc', FMT_INT)
        put(ws, f'C{rr}', f"={ac(y)}{P['PE.peu']}", 'calc', FMT_U, bold=True)
        put(ws, f'D{rr}', f"={ac(y)}{P['PE.u']}", 'calc', FMT_U)
        put(ws, f'E{rr}', f"={ac(y)}{P['PE.ms']}", 'calc', FMT_PCT)
    from openpyxl.chart import BarChart, Reference
    from openpyxl.chart.series import SeriesLabel
    ch = BarChart(); ch.title = 'Ventas vs. punto de equilibrio (filtros)'; ch.height = 7; ch.width = 14
    ch.add_data(Reference(ws, min_col=4, min_row=68, max_row=72), titles_from_data=False)
    ch.add_data(Reference(ws, min_col=3, min_row=68, max_row=72), titles_from_data=False)
    ch.series[0].tx = SeriesLabel(v='Ventas'); ch.series[1].tx = SeriesLabel(v='Punto de equilibrio')
    ch.set_categories(Reference(ws, min_col=2, min_row=68, max_row=72))
    ws.add_chart(ch, 'F64')
    # flujo del inversionista
    r += 2
    bar(r, 'FLUJO DEL INVERSIONISTA (con préstamo, $us)'); r += 2
    yhdr(r); r += 1
    FIN = lambda k, y: f"SUM({QR(k, 4*y-3, 4*y)})"
    A('fe2', 'Flujo económico (fila 24)', lambda y: f'={ec(y)}{fe}', y0=f'=C{fe}')
    A('prest', '(+) Préstamo', lambda y: '=0', y0='=PRESTAMO')
    A('int', '(-) Intereses', lambda y: f"=-{FIN('FIN.int', y)}")
    A('esc', '(+) Ahorro de IUE por los intereses', lambda y: f"=MIN(-{ec(y)}{P['EV.int']},MAX(0,{ec(y)}{P['EV.ebit']}))*TASA_IUE")
    A('amo', '(-) Amortización del préstamo', lambda y: f"=-{FIN('FIN.amort', y)}")
    A('fi', 'FLUJO DEL INVERSIONISTA', lambda y: f"=SUM({ec(y)}{P['EV.fe2']}:{ec(y)}{P['EV.amo']})", y0=f"=SUM(C{P['EV.fe2']}:C{P['EV.amo']})", bold=True, fill=FILL_KEY)
    fi = P['EV.fi']
    put(ws, f'B{r}', 'VAN del inversionista ($us)', 'label', bold=True, border=True); put(ws, f'C{r}', f'=NPV(TRMA,D{fi}:H{fi})+C{fi}', 'calc', FMT_BS2, bold=True); B.name('EV_VAN_INV', 'Rentabilidad', f'C{r}'); r += 1
    put(ws, f'B{r}', 'TIR del inversionista', 'label', bold=True, border=True); put(ws, f'C{r}', f'=IFERROR(IRR(C{fi}:H{fi}),"No existe")', 'calc', FMT_PCT2, bold=True); B.name('EV_TIR_INV', 'Rentabilidad', f'C{r}'); r += 1
    reg('EV.fe', 'Rentabilidad', y=lambda y: f'{ec(y)}{fe}', a0=f'C{fe}')
    ws.freeze_panes = 'C5'
    return ws
