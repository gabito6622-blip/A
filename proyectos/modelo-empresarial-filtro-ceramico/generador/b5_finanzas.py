from lib import *
from b1_supuestos import ROW

def CAL(q, row): return f"'CALENDARIO'!{qc(q)}{row}"

def build_er(B):
    ws = B.sheet('ESTADO_RESULTADOS', 'ESTADO DE RESULTADOS (trimestral y anual, Bs)', 'Costeo variable: el costo de ventas incluye materiales y energía; sueldos y gastos de planta son costos fijos del período.', tab='C00000')
    hdr_time(ws)
    P = ROW
    def lk(sheet, key):
        return lambda q: f"='{sheet}'!{qc(q)}{P[key]}"
    r = 6
    lines = []
    def L_(key, label, f, fmt=FMT_BS, bold=False, fill=None, annual='sum'):
        nonlocal r
        qrow(ws, r, label, 'Bs' if fmt != FMT_U else 'kits', f, fmt, bold=bold, fill=fill, annual=annual)
        P['ER.' + key] = r; r += 1
    def SEC(t):
        nonlocal r
        put(ws, f'A{r}', t, 'sec'); r += 1
    L_('u', 'Unidades vendidas', lk('INVENTARIO_PT', 'INV.ventas'), FMT_U)
    L_('fact', 'Ventas facturadas (con IVA)', lk('PRONOSTICO', 'PRO.q.fact'))
    L_('df', '(-) IVA débito fiscal', lambda q: f"={qc(q)}{P['ER.fact']}*TASA_IVA")
    L_('vn', 'VENTAS NETAS', lambda q: f"={qc(q)}{P['ER.fact']}-{qc(q)}{P['ER.df']}", bold=True)
    L_('cv', '(-) Costo de ventas (materiales y energía)', lk('INVENTARIO_PT', 'INV.cv'))
    L_('ub', 'UTILIDAD BRUTA', lambda q: f"={qc(q)}{P['ER.vn']}-{qc(q)}{P['ER.cv']}", bold=True, fill=FILL_TOT)
    SEC('Gastos de fabricación (fijos)')
    L_('sfab', 'Sueldos y cargas de producción (MOD + MOI)', lambda q: f"='PERSONAL'!{qc(q)}{P['PER.MOD']}+'PERSONAL'!{qc(q)}{P['PER.MOI']}")
    L_('gfab', 'Gastos de fabricación (alquiler, energía, mantenimiento, laboratorio)', lk('GASTOS_OPERATIVOS', 'GAS.FAB.neto'))
    L_('dep_fab', 'Depreciación de fabricación', lk('ACTIVOS_FIJOS', 'AF.dep_fab'))
    L_('tfab', 'Total gastos de fabricación', lambda q: f"=SUM({qc(q)}{P['ER.sfab']}:{qc(q)}{P['ER.dep_fab']})", bold=True)
    SEC('Gastos de administración')
    L_('sadm', 'Sueldos y cargas de administración', lk('PERSONAL', 'PER.ADM'))
    L_('gadm', 'Gastos de administración', lk('GASTOS_OPERATIVOS', 'GAS.ADM.neto'))
    L_('capac', 'Capacitación de operarios nuevos', lk('PERSONAL', 'PER.capac'))
    L_('dep_adm', 'Depreciación de administración', lk('ACTIVOS_FIJOS', 'AF.dep_adm'))
    L_('amort', 'Amortización de activos diferidos', lambda q: f"=IF('CALENDARIO'!{qc(q)}6<=4/TASA_AMORT,DIF_NETO*TASA_AMORT/4,0)")
    L_('prima', 'Prima anual (solo si hay utilidades)', lambda q: f"={qc(q)}{P['ER.prima_calc']}")
    L_('tadm', 'Total gastos de administración', lambda q: f"=SUM({qc(q)}{P['ER.sadm']}:{qc(q)}{P['ER.prima']})", bold=True)
    SEC('Gastos de comercialización')
    L_('scom', 'Sueldos y cargas de comercialización', lk('PERSONAL', 'PER.COM'))
    L_('gcom', 'Publicidad y logística', lk('GASTOS_OPERATIVOS', 'GAS.COM.neto'))
    L_('ent', 'Entrega por unidad vendida', lk('GASTOS_OPERATIVOS', 'GAS.ent.neto'))
    L_('tcom', 'Total gastos de comercialización', lambda q: f"=SUM({qc(q)}{P['ER.scom']}:{qc(q)}{P['ER.ent']})", bold=True)
    L_('it', 'Impuesto a las Transacciones (IT)', lambda q: f"={qc(q)}{P['ER.fact']}*TASA_IT")
    L_('gop', 'TOTAL GASTOS OPERATIVOS', lambda q: f"={qc(q)}{P['ER.tfab']}+{qc(q)}{P['ER.tadm']}+{qc(q)}{P['ER.tcom']}+{qc(q)}{P['ER.it']}", bold=True)
    L_('ebit', 'UTILIDAD OPERATIVA (EBIT)', lambda q: f"={qc(q)}{P['ER.ub']}-{qc(q)}{P['ER.gop']}", bold=True, fill=FILL_TOT)
    L_('int', '(-) Intereses del préstamo', lk('FINANCIAMIENTO', 'FIN.int'))
    L_('uai', 'UTILIDAD ANTES DE IMPUESTOS', lambda q: f"={qc(q)}{P['ER.ebit']}-{qc(q)}{P['ER.int']}", bold=True)
    L_('iue', '(-) IUE 25% (anual, se registra en el 4to trimestre)', lambda q: f"=IF('CALENDARIO'!{qc(q)}14=1,MAX(0,SUM({qc(4*year_of(q)-3)}{P['ER.uai']}:{qc(4*year_of(q))}{P['ER.uai']}))*TASA_IUE,0)")
    L_('un', 'UTILIDAD NETA', lambda q: f"={qc(q)}{P['ER.uai']}-{qc(q)}{P['ER.iue']}", bold=True, fill=FILL_KEY)
    r += 1
    SEC('Cálculos auxiliares (sin referencias circulares)')
    L_('uapi', 'Utilidad antes de prima e impuestos', lambda q: f"={qc(q)}{P['ER.ub']}-{qc(q)}{P['ER.tfab']}-SUM({qc(q)}{P['ER.sadm']}:{qc(q)}{P['ER.amort']})-{qc(q)}{P['ER.tcom']}-{qc(q)}{P['ER.it']}-{qc(q)}{P['ER.int']}")
    y4 = lambda q, k: f"SUM({qc(4*year_of(q)-3)}{P[k]}:{qc(4*year_of(q))}{P[k]})"
    L_('prima_calc', 'Prima = mín(un mes de sueldo, 25% de la utilidad) si la utilidad anual es positiva', lambda q: f"=IF('CALENDARIO'!{qc(q)}14=1,IF({y4(q,'ER.uapi')}>0,MIN('PERSONAL'!{qc(q)}{P['PER.mes']},0.25*{y4(q,'ER.uapi')}),0),0)")
    r += 1
    SEC('Márgenes')
    for k, lbl in [('ub', 'Margen bruto'), ('ebit', 'Margen operativo'), ('un', 'Margen neto')]:
        qrow(ws, r, lbl, '%', lambda q, k=k: f"=IF({qc(q)}{P['ER.vn']}<>0,{qc(q)}{P['ER.'+k]}/{qc(q)}{P['ER.vn']},0)", FMT_PCT,
             annual=lambda y, k=k: f"=IF({yc(y)}{P['ER.vn']}<>0,{yc(y)}{P['ER.'+k]}/{yc(y)}{P['ER.vn']},0)")
        P['ER.m_' + k] = r; r += 1
    put(ws, f'A{r+1}', 'Correcciones: los originales ponían solo materiales en el costo de ventas y aplicaban IUE trimestral aun con pérdidas; Hypotolab no restaba IUE en el flujo anual. Aquí el IUE es anual, sobre la utilidad del año, y el flujo lo paga en abril del año siguiente.', 'note')
    return ws

def build_impuestos(B):
    ws = B.sheet('IMPUESTOS', 'CARGA IMPOSITIVA: IVA, IT, IUE Y OBLIGACIONES LABORALES', 'Equivale a "Carga impositiva" / "Impuestos". Agrega el saldo a favor de IVA que se arrastra (los originales lo ignoraban).', tab='C00000')
    hdr_time(ws)
    P = ROW
    r = 6
    def Q(key, label, f, c0=None, annual='sum', bold=False):
        nonlocal r
        qrow(ws, r, label, 'Bs', f, FMT_BS, c0=c0, annual=annual, bold=bold); P['IMP.' + key] = r; r += 1
    Q('fact', 'Ventas facturadas', lambda q: f"='ESTADO_RESULTADOS'!{qc(q)}{P['ER.fact']}")
    Q('df', 'IVA débito fiscal (13%)', lambda q: f"='ESTADO_RESULTADOS'!{qc(q)}{P['ER.df']}", bold=True)
    Q('cf_mp', 'IVA crédito: compras de materiales', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.iva']}")
    Q('cf_en', 'IVA crédito: energía', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.en_iva']}")
    Q('cf_g', 'IVA crédito: gastos fijos', lambda q: f"='GASTOS_OPERATIVOS'!{qc(q)}{P['GAS.iva']}")
    Q('cf_e', 'IVA crédito: entrega', lambda q: f"='GASTOS_OPERATIVOS'!{qc(q)}{P['GAS.ent.iva']}")
    Q('cf_af', 'IVA crédito: activos fijos', lambda q: f"='ACTIVOS_FIJOS'!{qc(q)}{P['AF.capex_iva']}", c0=f"='ACTIVOS_FIJOS'!C{P['AF.capex_iva']}")
    Q('cf_dif', 'IVA crédito: diferidos y puesta en marcha', lambda q: '=0', c0='=DIF_IVA')
    Q('cf', 'Total IVA crédito fiscal', lambda q: f"=SUM({qc(q)}{P['IMP.cf_mp']}:{qc(q)}{P['IMP.cf_dif']})", c0=f"=SUM(C{P['IMP.cf_mp']}:C{P['IMP.cf_dif']})", bold=True)
    Q('sfi', 'Saldo a favor del período anterior', lambda q: f"={'C' if q == 1 else qc(q-1)}{r+3}", annual='first')
    Q('neto', 'IVA neto (débito - crédito - saldo a favor)', lambda q: f"={qc(q)}{P['IMP.df']}-{qc(q)}{P['IMP.cf']}-{qc(q)}{P['IMP.sfi']}", annual=None)
    Q('pagar', 'IVA A PAGAR', lambda q: f"=MAX(0,{qc(q)}{P['IMP.neto']})", bold=True)
    Q('sff', 'Saldo a favor para el período siguiente', lambda q: f"=MAX(0,-{qc(q)}{P['IMP.neto']})", c0=f"=C{P['IMP.cf']}", annual='last')
    Q('it', 'IT A PAGAR (3% de ventas facturadas)', lambda q: f"={qc(q)}{P['IMP.fact']}*TASA_IT", bold=True)
    Q('iue_dev', 'IUE devengado (anual)', lambda q: f"='ESTADO_RESULTADOS'!{qc(q)}{P['ER.iue']}")
    Q('iue_pag', 'IUE pagado (abril del año siguiente = 2do trimestre)', lambda q: f"={qc(q-2)}{P['IMP.iue_dev']}" if (q % 4 == 2 and q > 4) else '=0', bold=True)
    Q('iue_sal', 'IUE por pagar (saldo)', lambda q: f"={'C' if q == 1 else qc(q-1)}{r}+{qc(q)}{P['IMP.iue_dev']}-{qc(q)}{P['IMP.iue_pag']}", c0='=0', annual='last')
    Q('pri_dev', 'Prima anual devengada', lambda q: f"='ESTADO_RESULTADOS'!{qc(q)}{P['ER.prima']}")
    Q('pri_pag', 'Prima pagada (1er trimestre del año siguiente)', lambda q: f"={qc(q-1)}{P['IMP.pri_dev']}" if (q % 4 == 1 and q > 1) else '=0')
    Q('pri_sal', 'Prima por pagar (saldo)', lambda q: f"={'C' if q == 1 else qc(q-1)}{r}+{qc(q)}{P['IMP.pri_dev']}-{qc(q)}{P['IMP.pri_pag']}", c0='=0', annual='last')
    put(ws, f'A{r+1}', 'Simplificaciones (prudentes): no se compensa el IT con el IUE pagado ni se arrastran pérdidas tributarias; IVA e IT se pagan en el mismo trimestre.', 'note')
    return ws

def build_flujo(B):
    ws = B.sheet('FLUJO_CAJA', 'FLUJO DE CAJA (método directo, trimestral y anual, Bs)', 'Cobros y pagos reales: incluye plazos de cobro, IVA, IUE diferido, préstamo y aporte de socios.', tab='C00000')
    hdr_time(ws)
    P = ROW
    r = 6
    f = '(DIAS_COBRO_IND/90)'
    fact = lambda q: f"'ESTADO_RESULTADOS'!{qc(q)}{P['ER.fact']}"
    def Q(key, label, fn, c0=None, annual='sum', bold=False, fill=None):
        nonlocal r
        qrow(ws, r, label, 'Bs', fn, FMT_BS, c0=c0, annual=annual, bold=bold, fill=fill); P['FC.' + key] = r; r += 1
    put(ws, f'A{r}', 'ENTRADAS', 'sec'); r += 1
    Q('cobros', 'Cobros por ventas', lambda q: f"={fact(q)}*(MIX_DIRECTO+(1-MIX_DIRECTO)*(1-{f}))" + ('' if q == 1 else f"+{fact(q-1)}*(1-MIX_DIRECTO)*{f}"), c0='=0')
    Q('aporte', 'Aporte de los socios', lambda q: '=0', c0='=APORTE_SOCIOS')
    Q('prest', 'Desembolso del préstamo', lambda q: '=0', c0='=PRESTAMO')
    Q('tent', 'Total entradas', lambda q: f"=SUM({qc(q)}{P['FC.cobros']}:{qc(q)}{P['FC.prest']})", c0=f"=SUM(C{P['FC.cobros']}:C{P['FC.prest']})", bold=True)
    put(ws, f'A{r}', 'SALIDAS', 'sec'); r += 1
    Q('capex', 'Inversión en activos fijos', lambda q: f"='ACTIVOS_FIJOS'!{qc(q)}{P['AF.capex']}", c0=f"='ACTIVOS_FIJOS'!C{P['AF.capex']}")
    Q('dif', 'Inversión diferida y puesta en marcha', lambda q: '=0', c0='=DIF_PAGO')
    Q('mp', 'Compras de materiales', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.pago']}", c0='=0')
    Q('en', 'Energía de cocción', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.en_pago']}", c0='=0')
    Q('sue', 'Sueldos, cargas sociales y provisiones', lambda q: f"='PERSONAL'!{qc(q)}{P['PER.tot']}", c0='=0')
    Q('cap', 'Capacitación de operarios nuevos', lambda q: f"='PERSONAL'!{qc(q)}{P['PER.capac']}", c0='=0')
    Q('gas', 'Gastos operativos fijos', lambda q: f"='GASTOS_OPERATIVOS'!{qc(q)}{P['GAS.pago']}", c0='=0')
    Q('ent', 'Entrega de productos', lambda q: f"='GASTOS_OPERATIVOS'!{qc(q)}{P['GAS.ent.pago']}", c0='=0')
    Q('iva', 'IVA pagado', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.pagar']}", c0='=0')
    Q('it', 'IT pagado', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.it']}", c0='=0')
    Q('iue', 'IUE pagado', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.iue_pag']}", c0='=0')
    Q('pri', 'Prima pagada', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.pri_pag']}", c0='=0')
    Q('int', 'Intereses', lambda q: f"='FINANCIAMIENTO'!{qc(q)}{P['FIN.int']}", c0='=0')
    Q('amo', 'Amortización del préstamo', lambda q: f"='FINANCIAMIENTO'!{qc(q)}{P['FIN.amort']}", c0='=0')
    Q('tsal', 'Total salidas', lambda q: f"=SUM({qc(q)}{P['FC.capex']}:{qc(q)}{P['FC.amo']})", c0=f"=SUM(C{P['FC.capex']}:C{P['FC.amo']})", bold=True)
    Q('neto', 'FLUJO NETO DEL PERÍODO', lambda q: f"={qc(q)}{P['FC.tent']}-{qc(q)}{P['FC.tsal']}", c0=f"=C{P['FC.tent']}-C{P['FC.tsal']}", bold=True)
    Q('sini', 'Saldo inicial de caja', lambda q: f"={'C' if q == 1 else qc(q-1)}{r+1}", c0='=0', annual='first')
    Q('sfin', 'SALDO FINAL DE CAJA', lambda q: f"={qc(q)}{P['FC.sini']}+{qc(q)}{P['FC.neto']}", c0=f"=C{P['FC.sini']}+C{P['FC.neto']}", annual='last', bold=True, fill=FILL_KEY)
    Q('ok', 'Control: caja ≥ caja mínima (1 = sí)', lambda q: f"=IF({qc(q)}{P['FC.sfin']}>=CAJA_MINIMA,1,0)", c0=f"=IF(C{P['FC.sfin']}>=CAJA_MINIMA,1,0)", annual=lambda y: f"=MIN({qc(4*y-3)}{r}:{qc(4*y)}{r})")
    r += 1
    put(ws, f'A{r}', 'RESUMEN POR ACTIVIDAD', 'sec'); r += 1
    Q('op', 'Flujo de actividades de operación', lambda q: f"={qc(q)}{P['FC.cobros']}-SUM({qc(q)}{P['FC.mp']}:{qc(q)}{P['FC.pri']})", c0=f"=C{P['FC.cobros']}-SUM(C{P['FC.mp']}:C{P['FC.pri']})")
    Q('inv', 'Flujo de actividades de inversión', lambda q: f"=-{qc(q)}{P['FC.capex']}-{qc(q)}{P['FC.dif']}", c0=f"=-C{P['FC.capex']}-C{P['FC.dif']}")
    Q('fin', 'Flujo de actividades de financiamiento', lambda q: f"={qc(q)}{P['FC.aporte']}+{qc(q)}{P['FC.prest']}-{qc(q)}{P['FC.int']}-{qc(q)}{P['FC.amo']}", c0=f"=C{P['FC.aporte']}+C{P['FC.prest']}")
    Q('chk', 'Control: operación + inversión + financiamiento - flujo neto (debe ser 0)', lambda q: f"=ROUND({qc(q)}{P['FC.op']}+{qc(q)}{P['FC.inv']}+{qc(q)}{P['FC.fin']}-{qc(q)}{P['FC.neto']},2)", c0=f"=ROUND(C{P['FC.op']}+C{P['FC.inv']}+C{P['FC.fin']}-C{P['FC.neto']},2)")
    r += 1
    put(ws, f'A{r}', 'CÁLCULO DEL CAPITAL DE TRABAJO POR DÉFICIT ACUMULADO (no depende del aporte)', 'sec'); r += 1
    Q('opdeuda', 'Flujo de operación - intereses - amortización - reposiciones', lambda q: f"={qc(q)}{P['FC.op']}-{qc(q)}{P['FC.int']}-{qc(q)}{P['FC.amo']}-{qc(q)}{P['FC.capex']}", c0=None)
    Q('cum', 'Acumulado desde 2027', lambda q: f"={qc(q)}{P['FC.opdeuda']}" if q == 1 else f"={qc(q-1)}{r}+{qc(q)}{P['FC.opdeuda']}", annual='last')
    put(ws, f'A{r}', 'Déficit acumulado máximo del ciclo de arranque (4 trimestres de 2027, Bs)', 'label', bold=True)
    put(ws, f'C{r}', f"=MAX(0,-MIN(D{P['FC.cum']}:G{P['FC.cum']}))", 'calc', FMT_BS, bold=True); P['FC.deficit'] = r; r += 1
    put(ws, f'A{r}', 'Se mide solo el arranque: si hubiera pérdidas en años posteriores, no son capital de trabajo; el control de caja las muestra como necesidad de financiamiento adicional.', 'note'); r += 1
    put(ws, f'A{r+1}', 'Correcciones: Ñapefit sumaba la inversión en lugar de restarla (B26 = B25+B24+B21), tomaba sueldos de otro archivo ([2] REPELTEX) y el flujo trimestral no coincidía con el anual. Aquí el anual es la suma de los trimestres.', 'note')
    return ws

def build_balance(B):
    ws = B.sheet('BALANCE_GENERAL', 'BALANCE GENERAL (al cierre de cada trimestre, Bs)', 'Nuevo: ninguno de los originales tenía balance. Debe cuadrar en todos los períodos (fila de control).', tab='C00000')
    hdr_time(ws)
    P = ROW
    r = 6
    f = '(DIAS_COBRO_IND/90)'
    def Q(key, label, fn, c0, bold=False, fill=None):
        nonlocal r
        qrow(ws, r, label, 'Bs', fn, FMT_BS, c0=c0, annual='last', bold=bold, fill=fill); P['BAL.' + key] = r; r += 1
    put(ws, f'A{r}', 'ACTIVO', 'sec'); r += 1
    Q('caja', 'Caja y bancos', lambda q: f"='FLUJO_CAJA'!{qc(q)}{P['FC.sfin']}", f"='FLUJO_CAJA'!C{P['FC.sfin']}")
    Q('cxc', 'Cuentas por cobrar (canal indirecto)', lambda q: f"='ESTADO_RESULTADOS'!{qc(q)}{P['ER.fact']}*(1-MIX_DIRECTO)*{f}", '=0')
    Q('imp', 'Inventario de materiales', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.finbs']}", '=0')
    Q('ipt', 'Inventario de producto terminado', lambda q: f"='INVENTARIO_PT'!{qc(q)}{P['INV.finbs']}", '=0')
    Q('iva', 'Crédito fiscal IVA (saldo a favor)', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.sff']}", f"='IMPUESTOS'!C{P['IMP.sff']}")
    Q('ac', 'Total activo corriente', lambda q: f"=SUM({qc(q)}{P['BAL.caja']}:{qc(q)}{P['BAL.iva']})", f"=SUM(C{P['BAL.caja']}:C{P['BAL.iva']})", bold=True)
    Q('afb', 'Activo fijo (costo neto de IVA)', lambda q: f"='ACTIVOS_FIJOS'!{qc(q)}{P['AF.bruto']}", f"='ACTIVOS_FIJOS'!C{P['AF.bruto']}")
    Q('dep', '(-) Depreciación acumulada', lambda q: f"=-'ACTIVOS_FIJOS'!{qc(q)}{P['AF.acum']}", '=0')
    Q('dif', 'Activo diferido', lambda q: '=DIF_NETO', '=DIF_NETO')
    Q('amo', '(-) Amortización acumulada', lambda q: f"=-SUM('ESTADO_RESULTADOS'!$D${P['ER.amort']}:{qc(q)}{P['ER.amort']})", '=0')
    Q('anc', 'Total activo no corriente', lambda q: f"=SUM({qc(q)}{P['BAL.afb']}:{qc(q)}{P['BAL.amo']})", f"=SUM(C{P['BAL.afb']}:C{P['BAL.amo']})", bold=True)
    Q('at', 'TOTAL ACTIVO', lambda q: f"={qc(q)}{P['BAL.ac']}+{qc(q)}{P['BAL.anc']}", f"=C{P['BAL.ac']}+C{P['BAL.anc']}", bold=True, fill=FILL_TOT)
    put(ws, f'A{r}', 'PASIVO', 'sec'); r += 1
    Q('iue', 'IUE por pagar', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.iue_sal']}", f"='IMPUESTOS'!C{P['IMP.iue_sal']}")
    Q('pri', 'Prima por pagar', lambda q: f"='IMPUESTOS'!{qc(q)}{P['IMP.pri_sal']}", f"='IMPUESTOS'!C{P['IMP.pri_sal']}")
    Q('pre', 'Préstamo bancario', lambda q: f"='FINANCIAMIENTO'!{qc(q)}{P['FIN.saldo']}", f"='FINANCIAMIENTO'!C{P['FIN.saldo']}")
    Q('pt', 'TOTAL PASIVO', lambda q: f"=SUM({qc(q)}{P['BAL.iue']}:{qc(q)}{P['BAL.pre']})", f"=SUM(C{P['BAL.iue']}:C{P['BAL.pre']})", bold=True)
    put(ws, f'A{r}', 'PATRIMONIO', 'sec'); r += 1
    Q('cap', 'Capital social (aporte de los socios)', lambda q: '=APORTE_SOCIOS', '=APORTE_SOCIOS')
    Q('res', 'Resultados acumulados', lambda q: f"={'C' if q == 1 else qc(q-1)}{r}+'ESTADO_RESULTADOS'!{qc(q)}{P['ER.un']}", '=0')
    Q('pat', 'TOTAL PATRIMONIO', lambda q: f"={qc(q)}{P['BAL.cap']}+{qc(q)}{P['BAL.res']}", f"=C{P['BAL.cap']}+C{P['BAL.res']}", bold=True)
    Q('pp', 'TOTAL PASIVO + PATRIMONIO', lambda q: f"={qc(q)}{P['BAL.pt']}+{qc(q)}{P['BAL.pat']}", f"=C{P['BAL.pt']}+C{P['BAL.pat']}", bold=True, fill=FILL_TOT)
    Q('chk', 'CONTROL: activo - (pasivo + patrimonio) = 0', lambda q: f"=ROUND({qc(q)}{P['BAL.at']}-{qc(q)}{P['BAL.pp']},2)", f"=ROUND(C{P['BAL.at']}-C{P['BAL.pp']},2)", bold=True, fill=FILL_KEY)
    return ws

def build_trma(B):
    ws = B.sheet('TRMA', 'TASA DE RENDIMIENTO MÍNIMA ACEPTABLE (CAPM + riesgo país, convertida a Bs)', 'Método de ambos originales (CAPM). Mejora: los flujos están en Bs nominales, por eso la tasa en USD se convierte a Bs con la ecuación de Fisher.', tab='C00000')
    widths(ws, {'A': 58, 'B': 16, 'C': 16, 'D': 16, 'E': 50})
    for j, h in enumerate(['Componente', 'Este modelo', 'Ñapefit', 'Hypotolab', 'Comentario']): put(ws, f'{L(1+j)}5', h, 'hdr')
    rows = [('Tasa libre de riesgo (Rf)', '=RF', 0.0445, 0.041, 'Bono del Tesoro de EE.UU.'),
            ('Beta (β)', '=BETA', 0.9, 1.32, 'Supuesto; actualizar con beta sectorial'),
            ('Rendimiento del mercado (Rm)', '=RM', 0.1381, 0.1336, 'S&P 500'),
            ('Riesgo país (CRP)', '=CRP', 0.0579, 0.1375, 'EMBI Bolivia: bajó de ~2.000 pb (2025) a ~415 pb (ago-2026)'),
            ('Prima adicional', '=PRIMA_ADIC', 0, 0, 'Editable')]
    for i, (a, b, c, d, e) in enumerate(rows):
        r = 6 + i
        put(ws, f'A{r}', a, 'label'); put(ws, f'B{r}', b, 'calc', FMT_PCT2 if i != 1 else FMT_BS2)
        put(ws, f'C{r}', c, 'label', FMT_PCT2 if i != 1 else FMT_BS2); put(ws, f'D{r}', d, 'label', FMT_PCT2 if i != 1 else FMT_BS2); put(ws, f'E{r}', e, 'note')
    put(ws, 'A11', 'Costo del capital propio en USD = Rf + β(Rm - Rf) + CRP + prima', 'label', bold=True)
    for c in 'BCD': put(ws, f'{c}11', f'={c}6+{c}7*({c}8-{c}6)+{c}9+{c}10', 'calc', FMT_PCT2, bold=True)
    put(ws, 'E11', 'Ñapefit: 18,66%; Hypotolab: 30,07% (con riesgo país de 2025)', 'note')
    put(ws, 'A12', 'Inflación esperada Bolivia', 'label'); put(ws, 'B12', '=INFL_BO', 'calc', FMT_PCT2)
    put(ws, 'A13', 'Inflación esperada EE.UU.', 'label'); put(ws, 'B13', '=INFL_US', 'calc', FMT_PCT2)
    put(ws, 'A14', 'TRMA EN Bs NOMINALES = (1 + Ke USD) x (1 + inflación Bolivia) / (1 + inflación EE.UU.) - 1', 'label', bold=True)
    put(ws, 'B14', '=(1+B11)*(1+B12)/(1+B13)-1', 'calc', FMT_PCT2, bold=True, fill=FILL_KEY)
    B.name('TRMA', 'TRMA', 'B14')
    put(ws, 'A16', 'Costo promedio ponderado de capital (WACC, referencia)', 'sec')
    put(ws, 'A17', 'Proporción de deuda (D/V)', 'label'); put(ws, 'B17', '=PRESTAMO/INVERSION_TOTAL', 'calc', FMT_PCT)
    put(ws, 'A18', 'Costo de la deuda después de impuestos = i x (1 - IUE)', 'label'); put(ws, 'B18', '=TASA_PRESTAMO*(1-TASA_IUE)', 'calc', FMT_PCT2)
    put(ws, 'A19', 'WACC = E/V x TRMA + D/V x Kd(1 - t)', 'label', bold=True); put(ws, 'B19', '=(1-B17)*TRMA+B17*B18', 'calc', FMT_PCT2, bold=True)
    B.name('WACC', 'TRMA', 'B19')
    put(ws, 'E19', 'El proyecto se evalúa con la TRMA (más exigente que el WACC), como en los originales.', 'note')
    put(ws, 'A21', 'Rendimiento del S&P 500 (serie de Ñapefit)', 'sec')
    sp = [(2021, 0.2871), (2022, -0.1811), (2023, 0.2629), (2024, 0.2502), (2025, 0.1788)]
    put(ws, 'A22', 'Año', 'hdr'); put(ws, 'B22', 'Rendimiento total', 'hdr')
    for i, (yv, v) in enumerate(sp):
        put(ws, f'A{23+i}', str(yv), 'label'); put(ws, f'B{23+i}', v, 'input', FMT_PCT2)
    put(ws, 'A28', 'Promedio aritmético 2021-2025 (años completos)', 'label'); put(ws, 'B28', '=AVERAGE(B23:B27)', 'calc', FMT_PCT2)
    put(ws, 'E28', 'Ñapefit promediaba incluyendo 2026 parcial (11,27% a mayo). Se excluye el año incompleto. Se mantiene Rm = 13,81% de Ñapefit (más prudente que este promedio).', 'note')
    return ws
