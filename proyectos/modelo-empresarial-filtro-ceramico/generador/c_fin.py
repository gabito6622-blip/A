from lib import *
from b1_supuestos import ROW

C2q = lambda q: L(2 + q)

def build_er(B):
    ws = B.wb.create_sheet('Estado de resultado')
    widths(ws, {'A': 4, 'B': 5, 'C': 46})
    for q in range(1, NQ+1): ws.column_dimensions[qc(q)].width = 11
    put(ws, 'B2', 'ITEM', 'hdr'); ws.merge_cells('B2:C3')
    for y in range(1, 6):
        a = qc(4*y-3)
        put(ws, f'{a}2', f'AÑO {2026+y}', 'hdr')
        for k in range(4):
            put(ws, f'{qc(4*y-3+k)}3', QL[k], 'hdr')
            if k: ws[f'{qc(4*y-3+k)}2'].fill = FILL_HDR; ws[f'{qc(4*y-3+k)}2'].border = BORDER
        ws.merge_cells(f'{a}2:{qc(4*y)}2')
    yq = lambda q, r: f'SUM({qc(4*year_of(q)-3)}{r}:{qc(4*year_of(q))}{r})'
    L_ = [  # fila, signo, etiqueta, clave, f(q)
        (4, '(+)', 'TOTAL INGRESO (ventas sin IVA)', 'vn', lambda q: f"={Q('CI.fact', q)}*(1-TASA_IVA)"),
        (5, '(-)', 'Costo de venta (materia prima y gas)', 'cv', lambda q: f"={Q('INV.cv', q)}"),
        (7, '', 'UTILIDAD BRUTA EN VENTAS', 'ub', lambda q: f'={qc(q)}4-{qc(q)}5'),
        (8, '(-)', 'Sueldos y salarios de producción', 'sfab', lambda q: f"={Q('PER.MOD', q)}+{Q('PER.MOI', q)}"),
        (9, '(-)', 'Alquiler, servicios, mantenimiento y laboratorio', 'gfab', lambda q: f"={Q('GAS.FAB.neto', q)}"),
        (10, '(-)', 'Depreciación de producción', 'dep_fab', lambda q: f"={Q('AF.dep_fab', q)}"),
        (11, '(-)', 'Sueldos y salarios de administración', 'sadm', lambda q: f"={Q('PER.ADM', q)}"),
        (12, '(-)', 'Gastos de administración', 'gadm', lambda q: f"={Q('GAS.ADM.neto', q)}"),
        (13, '(-)', 'Capacitación de operarios nuevos', 'capac', lambda q: f"={Q('PER.capac', q)}"),
        (14, '(-)', 'Depreciación de oficina', 'dep_adm', lambda q: f"={Q('AF.dep_adm', q)}"),
        (15, '(-)', 'Amortización de diferidos', 'amort', lambda q: f'=IF({q}<=4/TASA_AMORT,DIF_NETO*TASA_AMORT/4,0)'),
        (16, '(-)', 'Prima anual (solo si hay utilidad)', 'prima', lambda q: f'={qc(q)}29'),
        (17, '(-)', 'Sueldos y salarios de comercialización', 'scom', lambda q: f"={Q('PER.COM', q)}"),
        (18, '(-)', 'Marketing, publicidad y logística', 'gcom', lambda q: f"={Q('GAS.COM.neto', q)}"),
        (19, '(-)', 'Entrega de filtros', 'ent', lambda q: f"={Q('GAS.ent.neto', q)}"),
        (20, '(-)', 'IT', 'it', lambda q: f"={Q('CI.fact', q)}*TASA_IT"),
        (21, '(-)', 'TOTAL GASTO OPERATIVO', 'gop', lambda q: f'=SUM({qc(q)}8:{qc(q)}20)'),
        (22, '', 'UTILIDAD OPERATIVA (antes de intereses e impuestos)', 'ebit', lambda q: f'={qc(q)}7-{qc(q)}21'),
        (23, '(-)', 'Intereses del préstamo', 'int', lambda q: f"={Q('FIN.int', q)}"),
        (24, '', 'UTILIDAD ANTES DE IMPUESTOS', 'uai', lambda q: f'={qc(q)}22-{qc(q)}23'),
        (25, '(-)', 'IUE por pagar (25% de la utilidad del año)', 'iue', lambda q: f'=IF({qk(q)}=4,MAX(0,{yq(q, 24)})*TASA_IUE,0)'),
        (26, '', 'UTILIDAD NETA (después de impuestos)', 'un', lambda q: f'={qc(q)}24-{qc(q)}25'),
        (28, '', 'Auxiliar: utilidad antes de prima e impuestos', 'uapi', lambda q: f'={qc(q)}7-SUM({qc(q)}8:{qc(q)}15)-SUM({qc(q)}17:{qc(q)}20)-{qc(q)}23'),
        (29, '', 'Auxiliar: prima = mín(un mes de sueldos, 25% de la utilidad)', 'prima_calc', lambda q: f"=IF({qk(q)}=4,IF({yq(q, 28)}>0,MIN({Q('PER.mes', q)},0.25*{yq(q, 28)}),0),0)"),
    ]
    bolds = {'vn', 'ub', 'gop', 'ebit', 'uai', 'un'}
    OFF = 30
    for (r, sg, lbl, k, f) in L_:
        put(ws, f'B{r}', sg, 'label', border=True); put(ws, f'C{r}', lbl, 'label', bold=k in bolds, border=True)
        for q in range(1, NQ+1):
            v = f(q); put(ws, f'{qc(q)}{r}', v, 'link' if '!' in v else 'calc', FMT_BS, bold=k in bolds, fill=FILL_KEY if k == 'un' else None)
    # tabla anual (como Ñapefit, debajo)
    put(ws, f'B{OFF+2}', 'ITEM', 'hdr'); ws.merge_cells(f'B{OFF+2}:C{OFF+2}')
    for y in range(1, 6): put(ws, f'{L(3+y)}{OFF+2}', 2026 + y, 'hdr'); ws[f'{L(3+y)}{OFF+2}'].fill = FILL_ANUAL
    ws[f'B{OFF+2}'].fill = FILL_ANUAL
    for (r, sg, lbl, k, f) in L_:
        if r >= 28: continue
        ra = r + OFF
        put(ws, f'B{ra}', sg, 'label', border=True); put(ws, f'C{ra}', lbl, 'label', bold=k in bolds, border=True)
        for y in range(1, 6):
            put(ws, f'{L(3+y)}{ra}', f'=SUM({qc(4*y-3)}{r}:{qc(4*y)}{r})', 'calc', FMT_BS, bold=k in bolds, fill=FILL_KEY if k == 'un' else None)
    rm = 26 + OFF + 1
    put(ws, f'C{rm}', 'Margen de utilidad', 'label', border=True)
    for y in range(1, 6): put(ws, f'{L(3+y)}{rm}', f'=IF({L(3+y)}{4+OFF}<>0,{L(3+y)}{26+OFF}/{L(3+y)}{4+OFF},0)', 'calc', FMT_PCT)
    for (r, sg, lbl, k, f) in L_:
        reg('ER.' + k, 'Estado de resultado', q=(lambda r_: (lambda q: f'{qc(q)}{r_}'))(r), y=(lambda r_: (lambda y: f'{L(3+y)}{r_+OFF}'))(r))
    # unidades vendidas (para indicadores)
    reg('ER.u', 'Inventario', q=REG['INV.ventas']['q'], y=REG['INV.ventas']['y'])
    # totales por bloque (anuales) para indicadores
    ru = rm + 2
    put(ws, f'C{ru}', 'Total gastos de fabricación', 'label', border=True)
    put(ws, f'C{ru+1}', 'Total gastos de administración', 'label', border=True)
    put(ws, f'C{ru+2}', 'Total gastos de comercialización', 'label', border=True)
    for y in range(1, 6):
        c = L(3 + y)
        put(ws, f'{c}{ru}', f'=SUM({c}{8+OFF}:{c}{10+OFF})', 'calc', FMT_BS)
        put(ws, f'{c}{ru+1}', f'=SUM({c}{11+OFF}:{c}{16+OFF})', 'calc', FMT_BS)
        put(ws, f'{c}{ru+2}', f'=SUM({c}{17+OFF}:{c}{19+OFF})', 'calc', FMT_BS)
    reg('ER.tfab', 'Estado de resultado', y=lambda y: f'{L(3+y)}{ru}')
    reg('ER.tadm', 'Estado de resultado', y=lambda y: f'{L(3+y)}{ru+1}')
    reg('ER.tcom', 'Estado de resultado', y=lambda y: f'{L(3+y)}{ru+2}')
    ws.freeze_panes = 'D4'
    return ws

def build_carga(B):
    ws = B.wb.create_sheet('Carga impositiva')
    widths(ws, {'A': 4, 'B': 46})
    for q in range(1, NQ+1): ws.column_dimensions[C2q(q)].width = 11.5
    ws.column_dimensions['Q'].width = 16
    def hdr_y(r, title, c0=3, cl='B'):
        put(ws, f'{cl}{r}', title, 'hdr'); ws.merge_cells(f'{cl}{r}:{L(c0+4)}{r}')
        put(ws, f'{cl}{r+1}', 'Detalle', 'hdr')
        for y in range(1, 6): put(ws, f'{L(c0-1+y)}{r+1}', 2026 + y, 'hdr')
    def qhdr(r, title):
        put(ws, f'B{r}', title, 'hdr')
        for y in range(1, 6):
            a = C2q(4*y-3); put(ws, f'{a}{r}', 2026 + y, 'hdr')
            for k in range(4):
                put(ws, f'{C2q(4*y-3+k)}{r+1}', ['1ERO', '2DO', '3ERO', '4TO'][k], 'hdr')
                if k: ws[f'{C2q(4*y-3+k)}{r}'].fill = FILL_HDR; ws[f'{C2q(4*y-3+k)}{r}'].border = BORDER
            ws.merge_cells(f'{a}{r}:{C2q(4*y)}{r}')
        put(ws, f'B{r+1}', 'Detalle', 'hdr')
    out = {}
    def qline(r, k, lbl, fn, bold=False):
        put(ws, f'B{r}', lbl, 'label', bold=bold, border=True)
        for q in range(1, NQ+1):
            v = fn(q); put(ws, f'{C2q(q)}{r}', v, 'link' if '!' in v else 'calc', FMT_BS2, bold=bold)
        if k:
            out[k] = r; reg('CI.' + k, 'Carga impositiva', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r))
    put(ws, 'B15', 'Trimestralmente', 'label', bold=True)
    # compras (trimestral)
    qhdr(17, 'Compras')
    qline(19, 'base_mp', 'Materia prima, gas y otros gastos (con factura)', lambda q: f"=({Q('COM.iva', q)}+{Q('COM.en_iva', q)}+{Q('GAS.iva', q)}+{Q('GAS.ent.iva', q)})/TASA_IVA")
    qline(20, 'base_af', 'Inversion en activo fijo (con factura)', lambda q: f"={Q('AF.capex_iva', q)}/TASA_IVA")
    qline(21, None, 'Total compras', lambda q: f'=SUM({C2q(q)}19:{C2q(q)}20)')
    qline(22, 'cf', 'IVA CREDITO FISCAL (13%)', lambda q: f'={C2q(q)}21*TASA_IVA', True)
    # ventas (trimestral)
    qhdr(24, 'Ventas')
    qline(26, 'fact', 'Por venta de productos (facturado)', lambda q: f"={Q('PRO.fact', q)}", True)
    qline(27, 'df', 'Debito fiscal (13%)', lambda q: f'={C2q(q)}26*TASA_IVA')
    qline(28, 'it', 'IT (3%)', lambda q: f'={C2q(q)}26*TASA_IT')
    # IVA (trimestral)
    qhdr(30, 'IVA')
    qline(32, 'pagar', 'IVA por pagar', lambda q: f'=MAX(0,{C2q(q)}34)', True)
    qline(33, 'sfi', 'Saldo a favor del trimestre anterior', lambda q: '=$C$14' if q == 1 else f'={C2q(q-1)}35')
    qline(34, 'neto', 'IVA neto (débito - crédito - saldo a favor)', lambda q: f'={C2q(q)}27-{C2q(q)}22-{C2q(q)}33')
    qline(35, 'sff', 'Saldo a favor para el trimestre siguiente', lambda q: f'=MAX(0,-{C2q(q)}34)')
    # IUE y prima
    qhdr(37, 'IUE (impuesto sobre las utilidades)')
    qline(39, 'iue_dev', 'IUE del año (registrado en diciembre)', lambda q: f"={Q('ER.iue', q)}")
    qline(40, 'iue_pag', 'IUE pagado (abril del año siguiente)', lambda q: f'={C2q(q-2)}39' if (q % 4 == 2 and q > 4) else '=0', True)
    qline(41, 'iue_sal', 'IUE por pagar (saldo)', lambda q: (f'={C2q(q-1)}41' if q > 1 else '=0') + f'+{C2q(q)}39-{C2q(q)}40')
    qhdr(43, 'Prima anual (obligación laboral)')
    qline(45, 'pri_dev', 'Prima del año (registrada en diciembre)', lambda q: f"={Q('ER.prima', q)}")
    qline(46, 'pri_pag', 'Prima pagada (enero a marzo del año siguiente)', lambda q: f'={C2q(q-1)}45' if (q % 4 == 1 and q > 1) else '=0', True)
    qline(47, 'pri_sal', 'Prima por pagar (saldo)', lambda q: (f'={C2q(q-1)}47' if q > 1 else '=0') + f'+{C2q(q)}45-{C2q(q)}46')
    reg('CI.sff', 'Carga impositiva', q=(lambda q: f'{C2q(q)}35'), a0='C14')
    ysum = lambda r, y: f'=SUM({C2q(4*y-3)}{r}:{C2q(4*y)}{r})'
    # resumen anual (arriba, como Ñapefit)
    hdr_y(2, 'Compras')
    for r, lbl, src, bold in [(4, 'Materia prima, gas y otros gastos', 19, False), (5, 'Inversion en activo fijo', 20, False), (6, 'Total compras', 21, False), (7, 'IVA CREDITO FISCAL (13%)', 22, True)]:
        put(ws, f'B{r}', lbl, 'label', bold=bold, border=True)
        for y in range(1, 6): put(ws, f'{L(2+y)}{r}', ysum(src, y), 'calc', FMT_BS2, bold=bold)
    hdr_y(9, 'Ventas')
    for r, lbl, src, bold in [(11, 'Por venta de productos', 26, False), (12, 'IVA Debito fiscal (13%)', 27, True), (13, 'IT (3%)', 28, False)]:
        put(ws, f'B{r}', lbl, 'label', bold=bold, border=True)
        for y in range(1, 6): put(ws, f'{L(2+y)}{r}', ysum(src, y), 'calc', FMT_BS2, bold=bold)
    put(ws, 'B14', 'Crédito fiscal de la inversión inicial (año 2026)', 'label', bold=True, border=True)
    put(ws, 'C14', '=AF_ANIO0_IVA+DIF_IVA', 'calc', FMT_BS2, bold=True)
    put(ws, 'Q2', 'Diferencia IVA', 'hdr'); ws.merge_cells('Q2:V2')
    put(ws, 'Q3', 'Detalle', 'hdr')
    for y in range(1, 6): put(ws, f'{L(17+y)}3', 2026 + y, 'hdr')
    put(ws, 'Q4', 'IVA por pagar', 'label', bold=True, border=True)
    put(ws, 'Q5', 'Débito - crédito del año', 'label', border=True)
    for y in range(1, 6):
        put(ws, f'{L(17+y)}4', ysum(32, y), 'calc', FMT_BS2, bold=True)
        put(ws, f'{L(17+y)}5', f'={L(2+y)}12-{L(2+y)}7', 'calc', FMT_BS2)
    put(ws, 'Q7', 'IVA + IT', 'hdr'); ws.merge_cells('Q7:Q12')
    put(ws, 'R7', 'Detalle', 'hdr'); put(ws, 'S7', 'Impuestos por pagar', 'hdr')
    for y in range(1, 6):
        put(ws, f'R{7+y}', 2026 + y, 'calc', FMT_INT); put(ws, f'S{7+y}', f'={L(17+y)}4+{L(2+y)}13', 'calc', FMT_BS2)
    put(ws, 'U7', 'IUE', 'hdr'); put(ws, 'V7', 'del año', 'hdr'); put(ws, 'W7', 'pagado', 'hdr')
    for y in range(1, 6):
        put(ws, f'U{7+y}', 2026 + y, 'calc', FMT_INT); put(ws, f'V{7+y}', ysum(39, y), 'calc', FMT_BS2); put(ws, f'W{7+y}', ysum(40, y), 'calc', FMT_BS2)
    ws.column_dimensions['W'].width = 12
    ws.freeze_panes = 'C1'
    return ws

def build_flujo(B):
    ws = B.wb.create_sheet('Flujo de caja')
    widths(ws, {'A': 46, 'B': 14})
    for q in range(1, NQ+1): ws.column_dimensions[C2q(q)].width = 11
    put(ws, 'A2', 'Método Directo', 'hdr'); put(ws, 'B2', 'Año 0 (2026)', 'hdr')
    for y in range(1, 6):
        a = C2q(4*y-3); put(ws, f'{a}2', f'AÑO {2026+y}', 'hdr')
        for k in range(4):
            put(ws, f'{C2q(4*y-3+k)}3', QL[k], 'hdr')
            if k: ws[f'{C2q(4*y-3+k)}2'].fill = FILL_HDR; ws[f'{C2q(4*y-3+k)}2'].border = BORDER
        ws.merge_cells(f'{a}2:{C2q(4*y)}2')
    put(ws, 'A3', 'Actividades de operación', 'hdr'); put(ws, 'B3', '(Puesta en marcha)', 'hdr')
    f = '(DIAS_COBRO_IND/90)'
    fact = lambda q: Q('CI.fact', q)
    G = lambda a: (lambda q: f"={Q(f'GAS.{a}.pago', q)}")
    lines = [
        (4, 'Entradas:', None, None, True),
        (5, 'Efectivo recibido por los clientes', lambda q: f"={fact(q)}*(MIX_DIRECTO+(1-MIX_DIRECTO)*(1-{f}))" + ('' if q == 1 else f"+{fact(q-1)}*(1-MIX_DIRECTO)*{f}"), '=0', False),
        (6, 'Salidas:', None, None, True),
        (7, 'Costo de bienes de consumo (materia prima)', lambda q: f"={Q('COM.pago', q)}", '=0', False),
        (8, 'Gas para el horno', lambda q: f"={Q('COM.en_pago', q)}", '=0', False),
        (9, 'Alquiler, servicios, mantenimiento y laboratorio', G('FAB'), '=0', False),
        (10, 'Gastos de administración', G('ADM'), '=0', False),
        (11, 'Marketing, publicidad y logística', G('COM'), '=0', False),
        (12, 'Entrega de filtros', lambda q: f"={Q('GAS.ent.pago', q)}", '=0', False),
        (13, 'Capacitación de operarios nuevos', lambda q: f"={Q('PER.capac', q)}", '=0', False),
        (14, 'Prima anual', lambda q: f"={Q('CI.pri_pag', q)}", '=0', False),
        (15, 'IUE', lambda q: f"={Q('CI.iue_pag', q)}", '=0', False),
        (16, 'Sueldos y salarios', lambda q: f"={Q('PER.tot', q)}", '=0', False),
        (17, 'IT', lambda q: f"={Q('CI.it', q)}", '=0', False),
        (18, 'IVA (DF- CF)', lambda q: f"={Q('CI.pagar', q)}", '=0', False),
        (20, 'Total salidas', lambda q: f'=SUM({C2q(q)}7:{C2q(q)}18)', '=SUM(B7:B18)', True),
        (21, 'Efectivo de las actividades de operación', lambda q: f'={C2q(q)}5-{C2q(q)}20', '=B5-B20', True),
        (23, 'Flujo de Inversion', None, None, True),
        (24, 'Activos fijos', lambda q: f"=-{Q('AF.capex', q)}", '=-AF_ANIO0', False),
        (25, 'Activos diferidos y puesta en marcha', lambda q: '=0', '=-DIF_PAGO', False),
        (26, 'Saldo de efectivo despues de inversion', lambda q: f'={C2q(q)}21+{C2q(q)}24+{C2q(q)}25', '=B21+B24+B25', True),
        (28, 'Flujo de Financiamiento', None, None, True),
        (29, 'Inversion del socio', lambda q: '=0', '=APORTE_SOCIOS', False),
        (30, 'Ingreso por prestamo', lambda q: '=0', '=PRESTAMO', False),
        (31, 'Intereses bancarios', lambda q: f"=-{Q('FIN.int', q)}", '=0', False),
        (32, 'Amortizacion de capital', lambda q: f"=-{Q('FIN.amort', q)}", '=0', False),
        (33, 'Total flujo de Financiamiento', lambda q: f'=SUM({C2q(q)}29:{C2q(q)}32)', '=SUM(B29:B32)', True),
        (34, 'Saldo de efectivo del periodo', lambda q: f'={C2q(q)}26+{C2q(q)}33', '=B26+B33', True),
        (35, 'Saldo de efectivo acumulado', lambda q: f'=B35+{C2q(q)}34' if q == 1 else f'={C2q(q-1)}35+{C2q(q)}34', '=B34', True),
    ]
    for (r, lbl, fn, b0, bold) in lines:
        put(ws, f'A{r}', lbl, 'label', bold=bold, border=True)
        if fn is None: continue
        put(ws, f'B{r}', b0, 'calc', FMT_BS2, bold=bold)
        for q in range(1, NQ+1):
            v = fn(q); put(ws, f'{C2q(q)}{r}', v, 'link' if '!' in v else 'calc', FMT_BS2, bold=bold, fill=FILL_KEY if r == 35 else None)
    Qr = lambda r_: (lambda q: f'{C2q(q)}{r_}')
    # bloque anual (como Ñapefit, debajo: filas 37 a 70)
    R0 = 37
    put(ws, f'A{R0}', 'Metodo Directo', 'hdr'); put(ws, f'B{R0}', 'Año 0 (2026)', 'hdr'); put(ws, f'C{R0}', 'Años', 'hdr')
    for y in range(2, 6): ws[f'{L(2+y)}{R0}'].fill = FILL_ANUAL; ws[f'{L(2+y)}{R0}'].border = BORDER
    ws.merge_cells(f'C{R0}:G{R0}'); ws[f'C{R0}'].fill = FILL_ANUAL
    put(ws, f'A{R0+1}', 'Actividades de operación', 'hdr'); put(ws, f'B{R0+1}', '(Puesta en marcha)', 'hdr')
    for y in range(1, 6): put(ws, f'{L(2+y)}{R0+1}', 2026 + y, 'hdr'); ws[f'{L(2+y)}{R0+1}'].fill = FILL_ANUAL
    for (r, lbl, fn, b0, bold) in lines:
        ra = r + 35
        put(ws, f'A{ra}', lbl, 'label', bold=bold, border=True)
        if fn is None: continue
        put(ws, f'B{ra}', f'=B{r}', 'calc', FMT_BS2, bold=bold)
        for y in range(1, 6):
            q1, q4 = C2q(4*y-3), C2q(4*y)
            v = f'={q4}{r}' if r == 35 else f'=SUM({q1}{r}:{q4}{r})'
            put(ws, f'{L(2+y)}{ra}', v, 'calc', FMT_BS2, bold=bold)
    reg('FC.sfin_y', 'Flujo de caja', y=lambda y: f'{L(2+y)}70')
    # apoyo: control de caja mínima y déficit del arranque
    put(ws, 'A72', 'Control: caja igual o mayor a la caja mínima (1 = sí)', 'label', border=True)
    put(ws, 'B72', '=IF(B35>=CAJA_MINIMA-0.01,1,0)', 'calc', FMT_INT)
    for q in range(1, NQ+1): put(ws, f'{C2q(q)}72', f'=IF({C2q(q)}35>=CAJA_MINIMA-0.01,1,0)', 'calc', FMT_INT)
    put(ws, 'A74', 'Capital de trabajo: déficit de caja del arranque', 'label', bold=True)
    put(ws, 'A75', 'Operación - intereses - amortización - reposiciones', 'label', border=True)
    put(ws, 'A76', 'Acumulado desde 2027', 'label', border=True)
    for q in range(1, NQ+1):
        c = C2q(q)
        put(ws, f'{c}75', f'={c}21+{c}31+{c}32+{c}24', 'calc', FMT_BS2)
        put(ws, f'{c}76', f'={c}75' if q == 1 else f'={C2q(q-1)}76+{c}75', 'calc', FMT_BS2)
    put(ws, 'A77', 'Déficit máximo de los 4 trimestres de 2027', 'label', bold=True, border=True); put(ws, 'B77', '=MAX(0,-MIN(C76:F76))', 'calc', FMT_BS2, bold=True)
    reg('FC.deficit', 'Flujo de caja', a0='B77')
    for k, r in [('cobros', 5), ('op', 21), ('neto', 34), ('sfin', 35), ('ok', 72), ('capex', 24), ('dif', 25), ('aporte', 29), ('prest', 30), ('int', 31), ('amo', 32)]:
        reg('FC.' + k, 'Flujo de caja', q=Qr(r), a0=f'B{r}')
    ws.freeze_panes = 'C4'
    return ws

def build_trma(B, src_path):
    import openpyxl
    ws = B.wb.create_sheet('TRMA')
    widths(ws, {'A': 4, 'B': 14, 'C': 45, 'D': 12, 'E': 12, 'F': 14})
    put(ws, 'B2', 'TASA RENDIMIENTO MÍNIMA ACEPTABLE', 'label', bold=True)
    for c, h in [('B', 'Método'), ('C', 'Detalle'), ('D', 'Fórmula'), ('E', 'Valor'), ('F', 'TRMA')]: put(ws, f'{c}3', h, 'hdr')
    rows = [('CAPM', 'Tasa libre de riesgo (Bonos de EE.UU.)', 'Rf', '=RF', FMT_PCT2), ('', 'Beta del sector', 'Bi', '=BETA', FMT_BS2),
            ('', 'S&P500', 'Rm', '=RM', FMT_PCT2), ('', 'Riesgo país por invertir en Bolivia', 'CRP', '=CRP', FMT_PCT2), ('', 'Prima adicional', 'PA', '=PRIMA_ADIC', FMT_PCT2)]
    for i, (a, b, c, d, fm) in enumerate(rows):
        r = 4 + i
        put(ws, f'B{r}', a, 'label', bold=True, border=True); put(ws, f'C{r}', b, 'label', border=True); put(ws, f'D{r}', c, 'label', border=True); put(ws, f'E{r}', d, 'calc', fm)
    put(ws, 'F4', '=E4+(E5*(E6-E4))+E7+E8', 'calc', FMT_PCT2, bold=True)
    put(ws, 'C10', 'Inflación esperada en Bolivia', 'label', border=True); put(ws, 'E10', '=INFL_BO', 'calc', FMT_PCT2)
    put(ws, 'C11', 'Inflación esperada en EE.UU.', 'label', border=True); put(ws, 'E11', '=INFL_US', 'calc', FMT_PCT2)
    put(ws, 'C12', 'TRMA USADA = (1 + TRMA en $) x (1 + infl. Bolivia) / (1 + infl. EE.UU.) - 1', 'label', bold=True, border=True)
    put(ws, 'F12', '=(1+F4)*(1+E10)/(1+E11)-1', 'calc', FMT_PCT2, bold=True, fill=FILL_KEY)
    B.name('TRMA', 'TRMA', 'F12')
    put(ws, 'C13', 'Se usa la tasa con inflación boliviana porque los precios y costos suben con la inflación de Bolivia y se pasan a $us con un tipo de cambio fijo.', 'label', wrap=True)
    ws.merge_cells('C13:F14'); ws.row_dimensions[13].height = 30
    put(ws, 'C16', 'Proporción de deuda (D/V)', 'label', border=True); put(ws, 'E16', '=PRESTAMO/INVERSION_TOTAL', 'calc', FMT_PCT)
    put(ws, 'C17', 'Costo de la deuda después de impuestos', 'label', border=True); put(ws, 'E17', '=TASA_PRESTAMO*(1-TASA_IUE)', 'calc', FMT_PCT2)
    put(ws, 'C18', 'WACC (referencia)', 'label', bold=True, border=True); put(ws, 'F18', '=(1-E16)*TRMA+E16*E17', 'calc', FMT_PCT2, bold=True); B.name('WACC', 'TRMA', 'F18')
    ws.merge_cells('B4:B8'); ws.merge_cells('F4:F8')
    ws['B4'].alignment = Alignment(horizontal='center', vertical='center'); ws['F4'].alignment = Alignment(horizontal='center', vertical='center')
    put(ws, 'B27', 'Año', 'hdr'); put(ws, 'C27', 'Rendimiento Total Anual (S&P 500 Total Return)', 'hdr'); put(ws, 'D27', 'Estado del Periodo', 'hdr')
    for i, (yv, v, e) in enumerate([(2021, .2871, 'Año completo cerrado'), (2022, -.1811, 'Año completo cerrado'), (2023, .2629, 'Año completo cerrado'), (2024, .2502, 'Año completo cerrado'), (2025, .1788, 'Año completo cerrado'), (2026, .1127, 'Parcial (Acumulado a fines de mayo)')]):
        put(ws, f'B{28+i}', yv, 'calc', FMT_INT); put(ws, f'C{28+i}', v, 'input', FMT_PCT2); put(ws, f'D{28+i}', e, 'label', border=True)
    put(ws, 'B34', 'Promedio 2021-2025', 'label', border=True); put(ws, 'C34', '=AVERAGE(C28:C32)', 'calc', FMT_PCT2)
    put(ws, 'D34', 'Sin 2026 porque el año no terminó', 'label')
    widths(ws, {'D': 30, 'J': 22, 'K': 14, 'O': 22, 'P': 14})
    put(ws, 'J13', 'BETA DESPALANCADA', 'hdr'); ws.merge_cells('J13:K13')
    put(ws, 'J14', 'Beta usada', 'label', border=True); put(ws, 'K14', '=BETA', 'calc', FMT_BS2)
    put(ws, 'J15', 'Fuente: valor de Ñapefit; validar con la beta de Damodaran del sector', 'label', wrap=True); ws.merge_cells('J15:K16')
    put(ws, 'O18', 'BONO DE EEUU', 'hdr'); ws.merge_cells('O18:P18')
    put(ws, 'O19', 'Tasa libre de riesgo', 'label', border=True); put(ws, 'P19', '=RF', 'calc', FMT_PCT2)
    put(ws, 'O27', 'RIESGO PAIS EMBI', 'hdr'); ws.merge_cells('O27:P27')
    put(ws, 'O28', 'Riesgo país Bolivia', 'label', border=True); put(ws, 'P28', '=CRP', 'calc', FMT_PCT2)
    put(ws, 'O29', '415 puntos básicos al 17/08/2026 (Revista Mercado)', 'label', wrap=True); ws.merge_cells('O29:P30')
    return ws
