from lib import *
from b1_supuestos import ROW

def _regrow(key, sheet, r, y='last', a0=True):
    reg(key, sheet, q=(lambda r_: (lambda q: f'{qc(q)}{r_}'))(r), y=(lambda r_: (lambda y: f'{yc(y)}{r_}'))(r), a0=f'C{r}' if a0 else None)

def build_financiamiento(B):
    ws = B.sheet('Financiamiento', 'FINANCIAMIENTO: PRÉSTAMO BANCARIO (SISTEMA FRANCÉS, CUOTA TRIMESTRAL, $us)')
    put(ws, 'A5', 'Monto del préstamo = % x activos fijos ($)', 'label'); put(ws, 'C5', '=PCT_PRESTAMO*AF_ANIO0', 'calc', FMT_BS2); B.name('PRESTAMO', 'Financiamiento', 'C5')
    put(ws, 'A6', 'Tasa trimestral (tasa anual / 4)', 'label'); put(ws, 'C6', '=TASA_PRESTAMO/4', 'calc', FMT_PCT2); B.name('TASA_TRIM', 'Financiamiento', 'C6')
    put(ws, 'A7', 'Cuota trimestral fija ($)', 'label'); put(ws, 'C7', '=IF(PRESTAMO>0,PMT(TASA_TRIM,PLAZO_TRIM,-PRESTAMO),0)', 'calc', FMT_BS2); B.name('CUOTA', 'Financiamiento', 'C7')
    put(ws, 'A8', 'Monto del préstamo en bolivianos', 'label'); put(ws, 'C8', '=PRESTAMO*TIPO_CAMBIO', 'calc', FMT_BS)
    hdr_time(ws, 10, unit='Moneda'); ws.freeze_panes = None
    r = 11
    qrow(ws, r, 'Saldo inicial', '$us', lambda q: '=PRESTAMO' if q == 1 else f'={qc(q-1)}{r+4}', FMT_BS2, annual='first'); rs = r; r += 1
    qrow(ws, r, 'Intereses', '$us', lambda q: f'={qc(q)}{rs}*TASA_TRIM', FMT_BS2); ri = r; r += 1
    qrow(ws, r, 'Cuota', '$us', lambda q: f'=IF({q}<=PLAZO_TRIM,CUOTA,0)', FMT_BS2); rc = r; r += 1
    qrow(ws, r, 'Amortización de capital', '$us', lambda q: f'=MIN({qc(q)}{rs},{qc(q)}{rc}-{qc(q)}{ri})', FMT_BS2); ra = r; r += 1
    qrow(ws, r, 'Saldo final', '$us', lambda q: f'={qc(q)}{rs}-{qc(q)}{ra}', FMT_BS2, annual='last', c0='=PRESTAMO', bold=True); rf = r; r += 1
    ROW.update({'FIN.int': ri, 'FIN.amort': ra, 'FIN.saldo': rf})
    _regrow('FIN.int', 'Financiamiento', ri, a0=False); _regrow('FIN.amort', 'Financiamiento', ra, a0=False); _regrow('FIN.saldo', 'Financiamiento', rf)
    put(ws, f'A{r+1}', 'Tasa: tope de crédito productivo a microempresa (DS 2055; verificar con el banco).', 'note')
    return ws

def build_balance(B):
    ws = B.sheet('Balance general', 'BALANCE GENERAL (al cierre de cada trimestre, $us)')
    hdr_time(ws, unit='Moneda')
    P = ROW
    r = 6
    f = '(DIAS_COBRO_IND/90)'
    def Qr(key, label, fn, c0, bold=False, fill=None):
        nonlocal r
        qrow(ws, r, label, '$us', fn, FMT_BS2, c0=c0, annual='last', bold=bold, fill=fill); P['BAL.' + key] = r; _regrow('BAL.' + key, 'Balance general', r); r += 1
    put(ws, f'A{r}', 'ACTIVO', 'sec'); r += 1
    Qr('caja', 'Caja y bancos', lambda q: f"={Q('FC.sfin', q)}", f"={A0('FC.sfin')}")
    Qr('cxc', 'Cuentas por cobrar (canal indirecto)', lambda q: f"={Q('CI.fact', q)}*(1-MIX_DIRECTO)*{f}", '=0')
    Qr('imp', 'Inventario de materiales', lambda q: f"={Q('COM.finbs', q)}", '=0')
    Qr('ipt', 'Inventario de producto terminado', lambda q: f"={Q('INV.finbs', q)}", '=0')
    Qr('iva', 'Crédito fiscal IVA (saldo a favor)', lambda q: f"={Q('CI.sff', q)}", f"={A0('CI.sff')}")
    Qr('ac', 'Total activo corriente', lambda q: f"=SUM({qc(q)}{P['BAL.caja']}:{qc(q)}{P['BAL.iva']})", f"=SUM(C{P['BAL.caja']}:C{P['BAL.iva']})", bold=True)
    Qr('afb', 'Activo fijo (costo neto de IVA)', lambda q: f"={Q('AF.bruto', q)}", f"={A0('AF.bruto')}")
    Qr('dep', '(-) Depreciación acumulada', lambda q: f"=-{Q('AF.acum', q)}", '=0')
    Qr('dif', 'Activo diferido', lambda q: '=DIF_NETO', '=DIF_NETO')
    Qr('amo', '(-) Amortización acumulada', lambda q: f"=-SUM({QR('ER.amort', 1, q)})", '=0')
    Qr('anc', 'Total activo no corriente', lambda q: f"=SUM({qc(q)}{P['BAL.afb']}:{qc(q)}{P['BAL.amo']})", f"=SUM(C{P['BAL.afb']}:C{P['BAL.amo']})", bold=True)
    Qr('at', 'TOTAL ACTIVO', lambda q: f"={qc(q)}{P['BAL.ac']}+{qc(q)}{P['BAL.anc']}", f"=C{P['BAL.ac']}+C{P['BAL.anc']}", bold=True, fill=FILL_TOT)
    put(ws, f'A{r}', 'PASIVO', 'sec'); r += 1
    Qr('iue', 'IUE por pagar', lambda q: f"={Q('CI.iue_sal', q)}", '=0')
    Qr('pri', 'Prima por pagar', lambda q: f"={Q('CI.pri_sal', q)}", '=0')
    Qr('pre', 'Préstamo bancario', lambda q: f"={Q('FIN.saldo', q)}", f"={A0('FIN.saldo')}")
    Qr('pt', 'TOTAL PASIVO', lambda q: f"=SUM({qc(q)}{P['BAL.iue']}:{qc(q)}{P['BAL.pre']})", f"=SUM(C{P['BAL.iue']}:C{P['BAL.pre']})", bold=True)
    put(ws, f'A{r}', 'PATRIMONIO', 'sec'); r += 1
    Qr('cap', 'Capital social (aporte de los socios)', lambda q: '=APORTE_SOCIOS', '=APORTE_SOCIOS')
    Qr('res', 'Resultados acumulados', lambda q: f"={'C' if q == 1 else qc(q-1)}{r}+{Q('ER.un', q)}", '=0')
    Qr('pat', 'TOTAL PATRIMONIO', lambda q: f"={qc(q)}{P['BAL.cap']}+{qc(q)}{P['BAL.res']}", f"=C{P['BAL.cap']}+C{P['BAL.res']}", bold=True)
    Qr('pp', 'TOTAL PASIVO + PATRIMONIO', lambda q: f"={qc(q)}{P['BAL.pt']}+{qc(q)}{P['BAL.pat']}", f"=C{P['BAL.pt']}+C{P['BAL.pat']}", bold=True, fill=FILL_TOT)
    Qr('chk', 'CONTROL: activo - (pasivo + patrimonio) = 0', lambda q: f"=ROUND({qc(q)}{P['BAL.at']}-{qc(q)}{P['BAL.pp']},2)", f"=ROUND(C{P['BAL.at']}-C{P['BAL.pp']},2)", bold=True, fill=FILL_KEY)
    return ws

def build_ratios(B):
    from b2_mercado import year_hdr
    ws = B.sheet('Ratios', 'INDICADORES FINANCIEROS ANUALES')
    year_hdr(ws, 5)
    ER = lambda k, y: Y('ER.' + k, y)
    BL = lambda k, y: Y('BAL.' + k, y)
    def pc(y):
        if y >= 5: return '0'
        return f"SUM({QR('FIN.amort', 4*y+1, 4*y+4)})"
    rows = [('Margen bruto', lambda y: f"={ER('ub', y)}/{ER('vn', y)}", FMT_PCT),
            ('Margen operativo (utilidad operativa / ventas netas)', lambda y: f"={ER('ebit', y)}/{ER('vn', y)}", FMT_PCT),
            ('Margen neto', lambda y: f"={ER('un', y)}/{ER('vn', y)}", FMT_PCT),
            ('Rentabilidad sobre activos (ROA)', lambda y: f"={ER('un', y)}/{BL('at', y)}", FMT_PCT),
            ('Rentabilidad sobre patrimonio (ROE)', lambda y: f"={ER('un', y)}/{BL('pat', y)}", FMT_PCT),
            ('Liquidez corriente (activo corriente / pasivo corriente)', lambda y: f"=IF(({BL('iue', y)}+{BL('pri', y)}+{pc(y)})>0,{BL('ac', y)}/({BL('iue', y)}+{BL('pri', y)}+{pc(y)}),\"sin pasivo corriente\")", FMT_X),
            ('Endeudamiento (pasivo total / activo total)', lambda y: f"={BL('pt', y)}/{BL('at', y)}", FMT_PCT),
            ('Cobertura de intereses (utilidad operativa / intereses)', lambda y: f"=IF({ER('int', y)}>0,{ER('ebit', y)}/{ER('int', y)},\"sin deuda\")", FMT_X),
            ('Rotación de inventario de producto terminado (veces)', lambda y: f"=IF({BL('ipt', y)}>0,{ER('cv', y)}/{BL('ipt', y)},0)", FMT_BS2),
            ('Utilización de la capacidad instalada', lambda y: f"={Y('CAP.util', y)}", FMT_PCT),
            ('Caja al cierre del año ($us)', lambda y: f"={BL('caja', y)}", FMT_BS2)]
    r = 6
    for lbl, fn, fm in rows:
        arow(ws, r, lbl, '', fn, fm); r += 1
    put(ws, f'A{r+1}', 'Pasivo corriente = IUE + prima por pagar + cuotas de capital del año siguiente.', 'note')
    return ws
