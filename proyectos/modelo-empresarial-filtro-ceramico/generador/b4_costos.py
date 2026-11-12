from lib import *
from b1_supuestos import ROW

CARGOS = [  # cargo, área, cantidad (None = operarios variables), sueldo 2027
    ('Gerente General', 'ADM', 1, 7000),
    ('Jefe de Producción y Calidad', 'MOI', 1, 5500),
    ('Operario ceramista', 'MOD', None, 3600),
    ('Ejecutivo comercial', 'COM', 1, 4000),
]

def build_personal(B):
    ws = B.sheet('MANO DE OBRA', 'PERSONAL, SUELDOS Y CARGAS SOCIALES', 'Equivale a "MANO DE OBRA" (Ñapefit) y "Sueldos y salarios" (Hypotolab). La cantidad de operarios depende de la producción.', tab='5B9BD5')
    put(ws, 'A5', 'A. INCREMENTO DEL SALARIO MÍNIMO (datos de Ñapefit, método de Ñapefit)', 'sec')
    for j, h in enumerate(['Año', 'SMN (Bs)', 'Incremento anual']): put(ws, f'{L(1+j)}6', h, 'hdr')
    smn = [(2021, 2164), (2022, 2250), (2023, 2362), (2024, 2500), (2025, 2750), (2026, 3300)]
    for i, (yv, v) in enumerate(smn):
        r = 7 + i
        put(ws, f'A{r}', str(yv), 'label'); put(ws, f'B{r}', v, 'input', FMT_BS)
        put(ws, f'C{r}', '' if i == 0 else f'=(B{r}-B{r-1})/B{r-1}', 'calc', FMT_PCT)
    put(ws, 'A13', 'Promedio 2022-2026', 'label', bold=True); put(ws, 'C13', '=AVERAGE(C8:C12)', 'calc', FMT_PCT2, bold=True)
    put(ws, 'D13', 'Fuente: tabla del archivo Ñapefit. Verificar los valores con los decretos oficiales.', 'note')
    put(ws, 'A15', 'B. CARGOS Y SUELDOS MENSUALES 2027 (Bs)', 'sec')
    for j, h in enumerate(['Cargo', 'Área', 'Cantidad', 'Sueldo básico mensual']): put(ws, f'{L(1+j)}16', h, 'hdr')
    r = 17
    crow = {}
    for (c, a, n, s) in CARGOS:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', a, 'label')
        put(ws, f'C{r}', n if n is not None else 'según producción', 'input' if n is not None else 'note', FMT_INT)
        put(ws, f'D{r}', s, 'input', FMT_BS)
        crow[a] = r; r += 1
    put(ws, f'A{r}', 'Áreas: MOD = mano de obra directa; MOI = mano de obra indirecta de fábrica; ADM = administración; COM = comercialización. Sueldos: supuestos de mercado (validar con avisos de empleo).', 'note')
    r += 2
    put(ws, f'A{r}', 'C. TASAS', 'sec'); r += 1
    put(ws, f'A{r}', 'Cargas patronales (CNS + riesgo + solidario + pro vivienda)', 'label'); put(ws, f'C{r}', '=TASA_CNS+TASA_RIESGO+TASA_SOLIDARIO+TASA_PROVIVIENDA', 'calc', FMT_PCT2); rpat = r; r += 1
    put(ws, f'A{r}', 'Provisiones (aguinaldo + indemnización)', 'label'); put(ws, f'C{r}', '=TASA_AGUINALDO+TASA_INDEMNIZACION', 'calc', FMT_PCT2); rprov = r; r += 1
    put(ws, f'A{r}', 'Costo laboral total sobre el total ganado', 'label', bold=True); put(ws, f'C{r}', f'=C{rpat}+C{rprov}', 'calc', FMT_PCT2, bold=True)
    B.name('TASA_CARGAS', 'MANO DE OBRA', f'C{r}'); r += 2
    # ---- Planillas anuales (formato Ñapefit) ----
    put(ws, f'A{r}', 'D. PLANILLA MENSUAL POR AÑO (formato de Ñapefit)', 'sec'); r += 1
    ROW['PER.annual_r0'] = r
    hdA = ['Personal', 'Cantidad', 'Sueldo básico (Bs)', 'Bono de antigüedad', 'Total ganado', 'Gestora Pública (12,71%)', 'Líquido pagable', 'CNS (10%)', 'Riesgo prof. (1,71%)', 'Aporte pat. sol. (3,5%)', 'Provivienda (2%)', 'Total aportes pat.', 'Provisión aguinaldo (8,33%)', 'Previsión indemnización (8,33%)', 'Total mensual', 'Total anual']
    ann_tot = {}
    for y in range(1, 6):
        put(ws, f'A{r}', f'Año {2026+y}', 'label', bold=True); r += 1
        for j, h in enumerate(hdA): put(ws, f'{L(1+j)}{r}', h, 'hdr')
        ws.row_dimensions[r].height = 42; r += 1
        a0 = r
        for (c, a, n, sal) in CARGOS:
            cr = crow[a]
            put(ws, f'A{r}', c, 'label')
            qcol = qc(4*y-3)
            put(ws, f'B{r}', f'={qcol}{{OPS}}' if n is None else f'=$C${cr}', 'calc', FMT_INT)
            put(ws, f'C{r}', f"=$D${cr}*'Calendario'!{yc(y)}12*M_SALARIOS", 'calc', FMT_BS2)
            put(ws, f'D{r}', f'=IF({y}>=ANIO_BONO,BONO_ANT*3*SMN*(1+INC_SAL)*\'Calendario\'!{yc(y)}12,0)', 'calc', FMT_BS2)
            put(ws, f'E{r}', f'=B{r}*(C{r}+D{r})', 'calc', FMT_BS2)
            put(ws, f'F{r}', f'=E{r}*TASA_GESTORA', 'calc', FMT_BS2)
            put(ws, f'G{r}', f'=E{r}-F{r}', 'calc', FMT_BS2)
            for col, t in zip('HIJK', ['TASA_CNS', 'TASA_RIESGO', 'TASA_SOLIDARIO', 'TASA_PROVIVIENDA']):
                put(ws, f'{col}{r}', f'=E{r}*{t}', 'calc', FMT_BS2)
            put(ws, f'L{r}', f'=SUM(H{r}:K{r})', 'calc', FMT_BS2)
            put(ws, f'M{r}', f'=E{r}*TASA_AGUINALDO', 'calc', FMT_BS2)
            put(ws, f'N{r}', f'=E{r}*TASA_INDEMNIZACION', 'calc', FMT_BS2)
            put(ws, f'O{r}', f'=E{r}+L{r}+M{r}+N{r}', 'calc', FMT_BS2)
            put(ws, f'P{r}', f'=O{r}*12', 'calc', FMT_BS2, bold=True)
            r += 1
        put(ws, f'A{r}', 'Total', 'label', bold=True)
        for col in 'BEFGHIJKLMNOP':
            put(ws, f'{col}{r}', f'=SUM({col}{a0}:{col}{r-1})', 'calc', FMT_BS2 if col != 'B' else FMT_INT, bold=True)
        ann_tot[y] = r; r += 2
    ROW['PER.ann_tot'] = ann_tot
    put(ws, f'A{r}', 'E. PLANILLA TRIMESTRAL (alimenta los estados financieros)', 'sec'); r += 1
    hdr_time(ws, r, year0=False); ws.freeze_panes = None; r += 1
    widths(ws, {'A': 50})
    qrow(ws, r, 'Producción planificada', 'kits', lambda q: f"='Inventario'!{qc(q)}{ROW['INV.prod']}", FMT_U); rp = r; r += 1
    qrow(ws, r, 'Operarios requeridos en el trimestre', 'personas', lambda q: f'=MAX(MIN_OPERARIOS,ROUNDUP({qc(q)}{rp}/(PROD_OPERARIO*DIAS_TRIM),0))', FMT_INT, annual='avg'); rreq = r; r += 1
    qrow(ws, r, 'OPERARIOS CONTRATADOS (máximo del año, sin despidos estacionales)', 'personas', lambda q: f'=MAX({qc(4*year_of(q)-3)}{rreq}:{qc(4*year_of(q))}{rreq})', FMT_INT, annual='avg', bold=True); rops = r; r += 1
    qrow(ws, r, 'Operarios nuevos (contrataciones)', 'personas', lambda q: f'=MAX(0,{qc(q)}{rops}-MIN_OPERARIOS)' if q == 1 else f'=MAX(0,{qc(q)}{rops}-{qc(q-1)}{rops})', FMT_INT); rnew = r; r += 1
    qrow(ws, r, 'Índice salarial', 'índice', lambda q: f"='Calendario'!{qc(q)}12*M_SALARIOS", '0.0000', annual=None); ridx = r; r += 1
    qrow(ws, r, 'Bono de antigüedad mensual por persona', 'Bs/mes', lambda q: f"=IF('Calendario'!{qc(q)}7>=ANIO_BONO,BONO_ANT*3*SMN*(1+INC_SAL)*'Calendario'!{qc(q)}12,0)", FMT_BS, annual=None); rbono = r; r += 1
    area_rows = {}
    for (c, a, n, s) in CARGOS:
        cr = crow[a]
        if n is None:
            cnt = lambda q: f'{qc(q)}{rops}'
        else:
            cnt = lambda q, cr=cr: f'$C${cr}'
        qrow(ws, r, f'Total ganado - {c}', 'Bs', lambda q, cr=cr, cnt=cnt: f'={cnt(q)}*($D${cr}*{qc(q)}{ridx}+{qc(q)}{rbono})*3', FMT_BS)
        area_rows[a] = r; r += 1
    qrow(ws, r, 'TOTAL GANADO (sueldos + bono)', 'Bs', lambda q: f"=SUM({qc(q)}{area_rows['ADM']}:{qc(q)}{r-1})", FMT_BS, bold=True); rtg = r; r += 1
    qrow(ws, r, 'Cargas patronales', 'Bs', lambda q: f'={qc(q)}{rtg}*$C${rpat}', FMT_BS); r += 1
    qrow(ws, r, 'Provisión de aguinaldo', 'Bs', lambda q: f'={qc(q)}{rtg}*TASA_AGUINALDO', FMT_BS); r += 1
    qrow(ws, r, 'Previsión de indemnización (aporte trimestral a un fondo)', 'Bs', lambda q: f'={qc(q)}{rtg}*TASA_INDEMNIZACION', FMT_BS); r += 1
    qrow(ws, r, 'COSTO LABORAL TOTAL', 'Bs', lambda q: f'=SUM({qc(q)}{rtg}:{qc(q)}{r-1})', FMT_BS, bold=True, fill=FILL_TOT); rtot = r; r += 1
    put(ws, f'A{r}', 'Costo laboral por área (total ganado x (1 + cargas y provisiones))', 'sec'); r += 1
    for a, lbl in [('MOD', 'Mano de obra directa (operarios)'), ('MOI', 'Mano de obra indirecta (jefe de producción)'), ('ADM', 'Administración'), ('COM', 'Comercialización')]:
        qrow(ws, r, lbl, 'Bs', lambda q, a=a: f'={qc(q)}{area_rows[a]}*(1+TASA_CARGAS)', FMT_BS)
        ROW['PER.' + a] = r; r += 1
    qrow(ws, r, 'Control: suma por áreas - total', 'Bs', lambda q: f"=ROUND({qc(q)}{ROW['PER.MOD']}+{qc(q)}{ROW['PER.MOI']}+{qc(q)}{ROW['PER.ADM']}+{qc(q)}{ROW['PER.COM']}-{qc(q)}{rtot},2)", FMT_BS2); ROW['PER.chk'] = r; r += 1
    qrow(ws, r, 'Capacitación de operarios nuevos', 'Bs', lambda q: f"={qc(q)}{rnew}*COSTO_CAPAC_NUEVO*'Calendario'!{qc(q)}11", FMT_BS); ROW['PER.capac'] = r; r += 1
    qrow(ws, r, 'Información: descuento Gestora (12,71%) - lo paga el trabajador', 'Bs', lambda q: f'={qc(q)}{rtg}*TASA_GESTORA', FMT_BS); r += 1
    qrow(ws, r, 'Información: líquido pagable', 'Bs', lambda q: f'={qc(q)}{rtg}-{qc(q)}{r-1}', FMT_BS); r += 1
    qrow(ws, r, 'Un mes de sueldo de toda la planilla (base de la prima anual)', 'Bs', lambda q: f'={qc(q)}{rtg}/3', FMT_BS, annual='last'); ROW['PER.mes'] = r; r += 1
    for row in ws.iter_rows(min_row=ROW['PER.annual_r0'], max_row=rp):
        for c in row:
            if isinstance(c.value, str) and '{OPS}' in c.value: c.value = c.value.replace('{OPS}', str(rops))
    qrow(ws, r, 'Control: planilla anual (formato Ñapefit) - planilla trimestral', 'Bs', lambda q: '=0', FMT_BS2,
         annual=lambda y: f"=ROUND($P${ROW['PER.ann_tot'][y]}-{yc(y)}{rtot},2)"); ROW['PER.annchk'] = r; r += 1
    ROW.update({'PER.prod': rp, 'PER.ops': rops, 'PER.new': rnew, 'PER.tg': rtg, 'PER.tot': rtot, 'PER.crow_MOI': crow['MOI'], 'PER.crow_MOD': crow['MOD']})
    put(ws, f'A{r+1}', 'Correcciones: Ñapefit sumaba el sueldo básico (no el total ganado) en 2027-2028 y aplicaba 11% de antigüedad en el 5to año; el bono se calcula sobre 3 SMN. Ninguno de los originales vinculaba operarios con producción.', 'note')
    return ws

GASTOS = [  # concepto, área, mensual, factura
    ('Alquiler de galpón (300 m² con patio de secado)', 'FAB', 6000, 1),
    ('Energía eléctrica y agua', 'FAB', 1500, 1),
    ('Mantenimiento de equipos y horno', 'FAB', 800, 1),
    ('Análisis de laboratorio (control de calidad por lote)', 'FAB', 1200, 1),
    ('Internet y telefonía', 'ADM', 300, 1),
    ('Contabilidad y asesoría legal', 'ADM', 1500, 1),
    ('Seguros', 'ADM', 500, 1),
    ('Material de escritorio', 'ADM', 300, 1),
    ('Capacitación continua del personal', 'ADM', 350, 1),
    ('Otros gastos misceláneos (sin factura)', 'ADM', 600, 0),
    ('Publicidad y marketing', 'COM', '=PUBLICIDAD_MES', 1),
    ('Transporte y logística (fijo)', 'COM', 2000, 1),
]

def build_gastos(B):
    ws = B.sheet('Otros gastos', 'GASTOS OPERATIVOS', 'Equivale a "Otros gastos" de ambos originales, en Bs (sin pasar a USD) y clasificados por área.', tab='5B9BD5')
    for j, h in enumerate(['Concepto', 'Área', 'Monto mensual 2027 (Bs)', '¿Factura? (1/0)', 'Monto anual 2027 (Bs)']):
        put(ws, f'{L(1+j)}5', h, 'hdr')
    widths(ws, {'A': 50, 'C': 14, 'D': 12, 'E': 14})
    r = 6; grow = []
    for (c, a, m, f) in GASTOS:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', a, 'label')
        put(ws, f'C{r}', m, 'input', FMT_BS); put(ws, f'D{r}', f, 'input', FMT_INT); put(ws, f'E{r}', f'=C{r}*12', 'calc', FMT_BS)
        grow.append(r); r += 1
    put(ws, f'A{r}', 'Total', 'label', bold=True); put(ws, f'C{r}', f'=SUM(C{grow[0]}:C{grow[-1]})', 'calc', FMT_BS, bold=True); put(ws, f'E{r}', f'=SUM(E{grow[0]}:E{grow[-1]})', 'calc', FMT_BS, bold=True)
    ROW['GAS.alquiler'] = grow[0]
    r += 1
    put(ws, f'A{r}', 'Todos los montos son supuestos de mercado a cotizar. FAB = fabricación, ADM = administración, COM = comercialización.', 'note'); r += 2
    put(ws, f'A{r}', 'GASTOS TRIMESTRALES CON FACTURA (pago, Bs)', 'sec'); r += 1
    hdr_time(ws, r, year0=False); ws.freeze_panes = None; r += 1
    gq = []
    for gr in grow:
        put(ws, f'B{r}', f'=B{gr}', 'calc')
        qrow(ws, r, f'=A{gr}', None, lambda q, gr=gr: f"=$C${gr}*3*'Calendario'!{qc(q)}11*M_FIJOS", FMT_BS, kind='calc')
        ws[f'B{r}'] = f'=B{gr}'
        gq.append(r); r += 1
    g0, g1 = gq[0], gq[-1]
    put(ws, f'A{r}', 'GASTOS NETOS DE IVA (al estado de resultados)', 'sec'); r += 1
    nq = []
    for gr, rr in zip(grow, gq):
        qrow(ws, r, f'=A{gr}', None, lambda q, gr=gr, rr=rr: f'={qc(q)}{rr}*(1-TASA_IVA*$D${gr})', FMT_BS, kind='calc')
        ws[f'B{r}'] = f'=B{gr}'
        nq.append(r); r += 1
    n0, n1 = nq[0], nq[-1]
    put(ws, f'A{r}', 'TOTALES POR ÁREA', 'sec'); r += 1
    for a in ['FAB', 'ADM', 'COM']:
        qrow(ws, r, f'Gastos {a} con factura (pago)', 'Bs', lambda q, a=a: f'=SUMIF($B${g0}:$B${g1},"{a}",{qc(q)}{g0}:{qc(q)}{g1})', FMT_BS); ROW[f'GAS.{a}.pago'] = r; r += 1
        qrow(ws, r, f'Gastos {a} netos de IVA', 'Bs', lambda q, a=a: f'=SUMIF($B${n0}:$B${n1},"{a}",{qc(q)}{n0}:{qc(q)}{n1})', FMT_BS); ROW[f'GAS.{a}.neto'] = r; r += 1
    qrow(ws, r, 'Total gastos fijos con factura (pago)', 'Bs', lambda q: f'=SUM({qc(q)}{g0}:{qc(q)}{g1})', FMT_BS, bold=True); ROW['GAS.pago'] = r; r += 1
    qrow(ws, r, 'IVA crédito fiscal de gastos fijos', 'Bs', lambda q: f'={qc(q)}{r-1}-SUM({qc(q)}{n0}:{qc(q)}{n1})', FMT_BS); ROW['GAS.iva'] = r; r += 2
    put(ws, f'A{r}', 'GASTO VARIABLE DE ENTREGA', 'sec'); r += 1
    qrow(ws, r, 'Entrega con factura (pago)', 'Bs', lambda q: f"='Inventario'!{qc(q)}{ROW['INV.ventas']}*ENTREGA_U*'Calendario'!{qc(q)}11*M_CVAR", FMT_BS); ROW['GAS.ent.pago'] = r; r += 1
    qrow(ws, r, 'Entrega neta de IVA', 'Bs', lambda q: f'={qc(q)}{r-1}*(1-TASA_IVA)', FMT_BS); ROW['GAS.ent.neto'] = r; r += 1
    qrow(ws, r, 'IVA crédito de entrega', 'Bs', lambda q: f'={qc(q)}{r-2}-{qc(q)}{r-1}', FMT_BS); ROW['GAS.ent.iva'] = r; r += 1
    return ws

DEP = [('Maquinaria en general', 0.125, 8), ('Equipos e instalaciones', 0.125, 8), ('Herramientas en general', 0.25, 4),
       ('Muebles y enseres', 0.10, 10), ('Equipos de computación', 0.25, 4)]
ACT = [  # detalle, clase, área, cant, moneda, costo unit, trimestre compra
    ('Horno a gas de 1 m³ (fabricación local, diseño abierto)', 'Maquinaria en general', 'FAB', 1, 'Bs', 45000, 0),
    ('Prensa hidráulica con 2 juegos de moldes', 'Maquinaria en general', 'FAB', 1, 'Bs', 47000, 0),
    ('Molino de martillos para arcilla', 'Maquinaria en general', 'FAB', 1, 'Bs', 18000, 0),
    ('Amasadora de arcilla', 'Maquinaria en general', 'FAB', 1, 'Bs', 22000, 0),
    ('Tamizadora vibratoria', 'Maquinaria en general', 'FAB', 1, 'Bs', 6000, 0),
    ('Estanterías y bandejas de secado', 'Equipos e instalaciones', 'FAB', 1, 'Bs', 8000, 0),
    ('Estaciones de prueba de caudal', 'Equipos e instalaciones', 'FAB', 30, 'Bs', 200, 0),
    ('Equipo de laboratorio (turbidímetro, pirómetro, incubadora)', 'Equipos e instalaciones', 'FAB', 1, 'USD', 1800, 0),
    ('Herramientas y carretillas', 'Herramientas en general', 'FAB', 1, 'Bs', 6000, 0),
    ('Muebles de oficina', 'Muebles y enseres', 'ADM', 1, 'Bs', 8000, 0),
    ('Computadoras', 'Equipos de computación', 'ADM', 3, 'Bs', 6500, 0),
    ('Impresora multifunción', 'Equipos de computación', 'ADM', 1, 'Bs', 2500, 0),
    ('Reposición de computadoras (vida útil cumplida)', 'Equipos de computación', 'ADM', 3, 'Bs', '=6500*\'Calendario\'!AC11', 17),
    ('Reposición de impresora', 'Equipos de computación', 'ADM', 1, 'Bs', '=2500*\'Calendario\'!AC11', 17),
    ('Reposición de herramientas', 'Herramientas en general', 'FAB', 1, 'Bs', '=6000*\'Calendario\'!AC11', 17),
]

def build_activos(B):
    ws = B.sheet('Maqu. y equip.', 'ACTIVOS FIJOS Y DEPRECIACIÓN', 'Equivale a "Maqu. y equip." y "Maquinaria". Montos en Bs; lo cotizado en USD se convierte con el tipo de cambio editable.', tab='5B9BD5')
    put(ws, 'A5', 'Tasas de depreciación (DS 24051, anexo; verificar)', 'sec')
    for j, h in enumerate(['Clase de activo', 'Tasa anual', 'Vida útil (años)']): put(ws, f'{L(1+j)}6', h, 'hdr')
    for i, (c, t, v) in enumerate(DEP):
        put(ws, f'A{7+i}', c, 'label'); put(ws, f'B{7+i}', t, 'input', FMT_PCT); put(ws, f'C{7+i}', v, 'input', FMT_INT)
    d0, d1 = 7, 7 + len(DEP) - 1
    r = d1 + 2
    hd = ['Detalle', 'Clase', 'Área', 'Cantidad', 'Moneda', 'Costo unitario', 'Costo total Bs (c/factura)', 'IVA crédito', 'Valor neto depreciable', 'Tasa anual', 'Depreciación trimestral', 'Trimestre de compra (0 = año 0)']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}{r}', h, 'hdr')
    widths(ws, {'A': 50, 'B': 22, 'C': 7, 'D': 9, 'E': 8, 'F': 12, 'G': 14, 'H': 12, 'I': 14, 'J': 9, 'K': 12, 'L': 12})
    r += 1; a0 = r
    for (dname, cl, ar, n, mon, cu, tq) in ACT:
        put(ws, f'A{r}', dname, 'label'); put(ws, f'B{r}', cl, 'label'); put(ws, f'C{r}', ar, 'label')
        put(ws, f'D{r}', n, 'input', FMT_INT); put(ws, f'E{r}', mon, 'input')
        put(ws, f'F{r}', cu, 'input' if not str(cu).startswith('=') else 'link', FMT_BS)
        put(ws, f'G{r}', f'=D{r}*F{r}*IF(E{r}="USD",TIPO_CAMBIO,1)*M_INVERSION', 'calc', FMT_BS)
        put(ws, f'H{r}', f'=G{r}*TASA_IVA', 'calc', FMT_BS)
        put(ws, f'I{r}', f'=G{r}-H{r}', 'calc', FMT_BS)
        put(ws, f'J{r}', f'=INDEX($B${d0}:$B${d1},MATCH(B{r},$A${d0}:$A${d1},0))', 'calc', FMT_PCT)
        put(ws, f'K{r}', f'=I{r}*J{r}/4', 'calc', FMT_BS)
        put(ws, f'L{r}', tq, 'input', FMT_INT)
        r += 1
    a1 = r - 1
    put(ws, f'A{r}', 'TOTAL', 'label', bold=True, fill=FILL_TOT)
    for c in 'GHI': put(ws, f'{c}{r}', f'=SUM({c}{a0}:{c}{a1})', 'calc', FMT_BS, bold=True, fill=FILL_TOT)
    r += 1
    put(ws, f'A{r}', 'Inversión en activos fijos del año 0 (con factura)', 'label', bold=True)
    put(ws, f'G{r}', f'=SUMIF(L{a0}:L{a1},0,G{a0}:G{a1})', 'calc', FMT_BS, bold=True); B.name('AF_ANIO0', 'Maqu. y equip.', f'G{r}')
    put(ws, f'H{r}', f'=SUMIF(L{a0}:L{a1},0,H{a0}:H{a1})', 'calc', FMT_BS); B.name('AF_ANIO0_IVA', 'Maqu. y equip.', f'H{r}')
    put(ws, f'I{r}', f'=SUMIF(L{a0}:L{a1},0,I{a0}:I{a1})', 'calc', FMT_BS); B.name('AF_ANIO0_NETO', 'Maqu. y equip.', f'I{r}')
    r += 1
    put(ws, f'A{r}', 'Precios: supuestos a cotizar (horno y prensa con diseños abiertos de Potters for Peace fabricados en talleres locales). Depreciación sobre el valor neto de IVA, igual que en los originales.', 'note')
    r += 2
    put(ws, f'A{r}', 'DEPRECIACIÓN TRIMESTRAL POR ACTIVO (Bs)', 'sec'); r += 1
    hdr_time(ws, r); ws.freeze_panes = None; r += 1
    dr0 = r
    for i in range(len(ACT)):
        ar_ = a0 + i
        def f(q, ar_=ar_, r=r):
            prev = f'SUM($D{r}:{qc(q-1)}{r})' if q > 1 else '0'
            return f'=IF({q}>=MAX(1,$L${ar_}),MIN($K${ar_},$I${ar_}-{prev}),0)'
        qrow(ws, r, f'=A{ar_}', None, f, FMT_BS, kind='calc')
        ws[f'B{r}'] = f'=C{ar_}'
        r += 1
    dr1 = r - 1
    qrow(ws, r, 'Depreciación de fabricación', 'Bs', lambda q: f'=SUMIF($B${dr0}:$B${dr1},"FAB",{qc(q)}{dr0}:{qc(q)}{dr1})', FMT_BS); ROW['AF.dep_fab'] = r; r += 1
    qrow(ws, r, 'Depreciación de administración', 'Bs', lambda q: f'=SUMIF($B${dr0}:$B${dr1},"ADM",{qc(q)}{dr0}:{qc(q)}{dr1})', FMT_BS); ROW['AF.dep_adm'] = r; r += 1
    qrow(ws, r, 'DEPRECIACIÓN TOTAL', 'Bs', lambda q: f'={qc(q)}{r-2}+{qc(q)}{r-1}', FMT_BS, bold=True); ROW['AF.dep'] = r; r += 1
    qrow(ws, r, 'Depreciación acumulada', 'Bs', lambda q: f'={qc(q)}{r-1}' if q == 1 else f'={qc(q-1)}{r}+{qc(q)}{r-1}', FMT_BS, annual='last', c0='=0'); ROW['AF.acum'] = r; r += 1
    qrow(ws, r, 'Compras de activos con factura (pago)', 'Bs', lambda q: f'=SUMIF($L${a0}:$L${a1},{q},$G${a0}:$G${a1})', FMT_BS, c0=f'=SUMIF($L${a0}:$L${a1},0,$G${a0}:$G${a1})'); ROW['AF.capex'] = r; r += 1
    qrow(ws, r, 'IVA crédito de compras de activos', 'Bs', lambda q: f'=SUMIF($L${a0}:$L${a1},{q},$H${a0}:$H${a1})', FMT_BS, c0=f'=SUMIF($L${a0}:$L${a1},0,$H${a0}:$H${a1})'); ROW['AF.capex_iva'] = r; r += 1
    qrow(ws, r, 'Activo fijo bruto (valor neto de IVA, acumulado)', 'Bs', lambda q: f'=SUMIF($L${a0}:$L${a1},"<="&{q},$I${a0}:$I${a1})', FMT_BS, annual='last', c0=f'=SUMIF($L${a0}:$L${a1},0,$I${a0}:$I${a1})'); ROW['AF.bruto'] = r; r += 1
    qrow(ws, r, 'VALOR NETO EN LIBROS', 'Bs', lambda q: f'={qc(q)}{r-1}-{qc(q)}{ROW["AF.acum"]}', FMT_BS, annual='last', c0=f'=C{r-1}-C{ROW["AF.acum"]}', bold=True); ROW['AF.vnl'] = r; r += 1
    return ws

DIFER = [('Constitución, licencias y registros (FUNDEMPRESA, NIT, municipio)', 6000, 0),
         ('Honorarios profesionales (abogado, contador)', 4000, 1),
         ('Validación en laboratorio acreditado (eficacia bacteriológica)', 15000, 1),
         ('Registro de marca y diseño de empaque', 3500, 0),
         ('Capacitación técnica inicial (prensado, cocción, pruebas)', 8000, 1),
         ('Adecuación del galpón (instalación de gas, ventilación, piso)', 30000, 1)]

def build_inversion(B):
    ws = B.sheet('Inversión', 'INVERSIÓN INICIAL Y CAPITAL DE TRABAJO', 'Inversión fija + diferida + puesta en marcha + capital de trabajo (método del período de desfase).', tab='C00000')
    widths(ws, {'A': 60, 'B': 14, 'C': 12, 'D': 14, 'E': 14, 'F': 40})
    for j, h in enumerate(['Concepto', 'Monto Bs (c/factura)', '¿Factura? (1/0)', 'IVA crédito', 'Valor neto']): put(ws, f'{L(1+j)}5', h, 'hdr')
    put(ws, 'A6', '1. INVERSIÓN FIJA', 'sec')
    put(ws, 'A7', 'Activos fijos (ver Maqu. y equip.)', 'label'); put(ws, 'B7', '=AF_ANIO0', 'calc', FMT_BS); put(ws, 'C7', 1, 'calc', FMT_INT)
    put(ws, 'D7', '=AF_ANIO0_IVA', 'calc', FMT_BS); put(ws, 'E7', '=AF_ANIO0_NETO', 'calc', FMT_BS)
    put(ws, 'A8', '2. INVERSIÓN DIFERIDA', 'sec')
    r = 9; d0 = r
    for (c, m, f) in DIFER:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', f'={m}*M_INVERSION', 'input', FMT_BS); put(ws, f'C{r}', f, 'input', FMT_INT)
        put(ws, f'D{r}', f'=B{r}*TASA_IVA*C{r}', 'calc', FMT_BS); put(ws, f'E{r}', f'=B{r}-D{r}', 'calc', FMT_BS); r += 1
    put(ws, f'A{r}', '3. PUESTA EN MARCHA (gastos preoperativos, se capitalizan)', 'sec'); r += 1
    pm = [('Materiales y energía del lote piloto (LOTE_PILOTO kits)', '=LOTE_PILOTO*(MP_KIT_CF+ENERGIA_KIT_CF)', 1),
          ('Sueldos preoperativos: 2 meses de jefe de producción y operarios mínimos', f"=2*('MANO DE OBRA'!D{ROW['PER.crow_MOI']}+MIN_OPERARIOS*'MANO DE OBRA'!D{ROW['PER.crow_MOD']})*(1+TASA_CARGAS)*M_SALARIOS", 0),
          ('Alquiler de 2 meses antes de operar', f"=2*'Otros gastos'!C{ROW['GAS.alquiler']}", 1),
          ('Publicidad de lanzamiento', '=15000', 1)]
    for (c, m, f) in pm:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', m, 'link' if '!' in m else ('input' if m == '=15000' else 'calc'), FMT_BS); put(ws, f'C{r}', f, 'input', FMT_INT)
        put(ws, f'D{r}', f'=B{r}*TASA_IVA*C{r}', 'calc', FMT_BS); put(ws, f'E{r}', f'=B{r}-D{r}', 'calc', FMT_BS); r += 1
    d1 = r - 1
    put(ws, f'A{r}', 'Total diferido + puesta en marcha', 'label', bold=True, fill=FILL_TOT)
    put(ws, f'B{r}', f'=SUMIF(C{d0}:C{d1},">=0",B{d0}:B{d1})', 'calc', FMT_BS, bold=True, fill=FILL_TOT)
    put(ws, f'D{r}', f'=SUM(D{d0}:D{d1})', 'calc', FMT_BS, bold=True, fill=FILL_TOT); put(ws, f'E{r}', f'=SUM(E{d0}:E{d1})', 'calc', FMT_BS, bold=True, fill=FILL_TOT)
    B.name('DIF_PAGO', 'Inversión', f'B{r}'); B.name('DIF_IVA', 'Inversión', f'D{r}'); B.name('DIF_NETO', 'Inversión', f'E{r}')
    r += 1
    put(ws, f'A{r}', 'Tasa de amortización de diferidos (4 años)', 'label'); put(ws, f'B{r}', 0.25, 'input', FMT_PCT); B.name('TASA_AMORT', 'Inversión', f'B{r}')
    put(ws, f'F{r}', 'Gastos de organización: 25% anual (verificar DS 24051).', 'note'); r += 2
    put(ws, f'A{r}', '4. CAPITAL DE TRABAJO - MÉTODO DEL PERÍODO DE DESFASE', 'sec'); r += 1
    rows = [('Días de inventario de materiales', '=DIAS_INV_MP'), ('Días de proceso', '=DIAS_PROCESO'), ('Días de inventario de producto terminado', '=DIAS_INV_PT'),
            ('Días de cobro ponderados = % canal indirecto x plazo', '=(1-MIX_DIRECTO)*DIAS_COBRO_IND')]
    c0 = r
    for (c, f) in rows:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', f, 'calc', FMT_BS2); r += 1
    put(ws, f'A{r}', 'Período de desfase (días)', 'label', bold=True); put(ws, f'B{r}', f'=SUM(B{c0}:B{r-1})', 'calc', FMT_BS2, bold=True); B.name('DIAS_DESFASE', 'Inversión', f'B{r}'); r += 2
    put(ws, f'A{r}', 'Año', 'hdr')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', str(2026+y), 'hdr')
    r += 1
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{ROW['ER.'+k]}"
    put(ws, f'A{r}', 'Costo operativo en efectivo anual (costo de ventas + gastos sin depreciación ni amortización + IT)', 'label', wrap=True)
    for y in range(1, 6):
        put(ws, f'{L(1+y)}{r}', f"={ER('cv', y)}+{ER('gop', y)}-{ER('dep_fab', y)}-{ER('dep_adm', y)}-{ER('amort', y)}-{ER('prima', y)}", 'link', FMT_BS)
    rco = r; r += 1
    put(ws, f'A{r}', 'Capital de trabajo requerido = costo anual / 360 x días de desfase', 'label', bold=True)
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f'={L(1+y)}{rco}/360*DIAS_DESFASE', 'calc', FMT_BS, bold=True)
    rdes = r; r += 1
    put(ws, f'A{r}', 'Método 2: déficit acumulado del arranque (2027) + caja mínima, escalado por costos', 'label', wrap=True)
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"=('Flujo de caja'!$C${ROW['FC.deficit']}+CAJA_MINIMA)*{L(1+y)}{rco}/$B${rco}", 'link', FMT_BS)
    rdef = r; r += 1
    put(ws, f'A{r}', 'CAPITAL DE TRABAJO USADO (según METODO_CT)', 'label', bold=True, fill=FILL_KEY)
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f'=IF(METODO_CT=1,{L(1+y)}{rdes},{L(1+y)}{rdef})', 'calc', FMT_BS, bold=True, fill=FILL_KEY)
    ROW['INV.ct_row'] = r; B.name('CT_INICIAL', 'Inversión', f'B{r}'); r += 2
    put(ws, f'A{r}', '5. RESUMEN DE LA INVERSIÓN Y SU FINANCIAMIENTO', 'sec'); r += 1
    res = [('Inversión fija (activos fijos)', '=B7'), ('Inversión diferida y puesta en marcha', '=DIF_PAGO'), ('Capital de trabajo inicial', '=CT_INICIAL')]
    s0 = r
    for (c, f) in res:
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', f, 'calc', FMT_BS); put(ws, f'C{r}', f'=B{r}/$B${s0+3}', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'INVERSIÓN TOTAL', 'label', bold=True, fill=FILL_KEY); put(ws, f'B{r}', f'=SUM(B{s0}:B{r-1})', 'calc', FMT_BS, bold=True, fill=FILL_KEY); put(ws, f'C{r}', f'=B{r}/$B${s0+3}', 'calc', FMT_PCT)
    B.name('INVERSION_TOTAL', 'Inversión', f'B{r}'); r += 1
    put(ws, f'A{r}', 'Financiamiento: préstamo bancario', 'label'); put(ws, f'B{r}', '=PRESTAMO', 'calc', FMT_BS); put(ws, f'C{r}', f'=B{r}/INVERSION_TOTAL', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'Financiamiento: aporte de los socios', 'label', bold=True); put(ws, f'B{r}', '=INVERSION_TOTAL-PRESTAMO', 'calc', FMT_BS, bold=True); put(ws, f'C{r}', f'=B{r}/INVERSION_TOTAL', 'calc', FMT_PCT)
    B.name('APORTE_SOCIOS', 'Inversión', f'B{r}'); r += 1
    put(ws, f'A{r}', 'Inversión total en USD (referencia)', 'label'); put(ws, f'B{r}', '=INVERSION_TOTAL/TIPO_CAMBIO', 'calc', FMT_BS); r += 2
    put(ws, f'A{r}', 'Correcciones: los originales tomaban como capital de trabajo un año entero de materiales y sueldos (Ñapefit: USD 265.669, el 87% de la inversión). Aquí se calculan dos métodos (desfase y déficit acumulado) y el flujo de caja verifica que la caja nunca quede bajo el mínimo.', 'note')
    return ws

def build_financiamiento(B):
    ws = B.sheet('Financiamiento', 'FINANCIAMIENTO: PRÉSTAMO BANCARIO (SISTEMA FRANCÉS, CUOTA TRIMESTRAL)', 'Ninguno de los originales usó deuda; se agrega para poder analizar endeudamiento y para el simulador.', tab='C00000')
    put(ws, 'A5', 'Monto del préstamo = % x activos fijos', 'label'); put(ws, 'C5', '=PCT_PRESTAMO*AF_ANIO0', 'calc', FMT_BS); B.name('PRESTAMO', 'Financiamiento', 'C5')
    put(ws, 'A6', 'Tasa trimestral (tasa anual / 4)', 'label'); put(ws, 'C6', '=TASA_PRESTAMO/4', 'calc', FMT_PCT2); B.name('TASA_TRIM', 'Financiamiento', 'C6')
    put(ws, 'A7', 'Cuota trimestral fija', 'label'); put(ws, 'C7', '=IF(PRESTAMO>0,PMT(TASA_TRIM,PLAZO_TRIM,-PRESTAMO),0)', 'calc', FMT_BS); B.name('CUOTA', 'Financiamiento', 'C7')
    hdr_time(ws, 9); ws.freeze_panes = None
    r = 10
    qrow(ws, r, 'Saldo inicial', 'Bs', lambda q: '=PRESTAMO' if q == 1 else f'={qc(q-1)}{r+4}', FMT_BS, annual='first'); rs = r; r += 1
    qrow(ws, r, 'Intereses', 'Bs', lambda q: f'={qc(q)}{rs}*TASA_TRIM', FMT_BS); ri = r; r += 1
    qrow(ws, r, 'Cuota', 'Bs', lambda q: f'=IF({q}<=PLAZO_TRIM,CUOTA,0)', FMT_BS); rc = r; r += 1
    qrow(ws, r, 'Amortización de capital', 'Bs', lambda q: f'=MIN({qc(q)}{rs},{qc(q)}{rc}-{qc(q)}{ri})', FMT_BS); ra = r; r += 1
    qrow(ws, r, 'Saldo final', 'Bs', lambda q: f'={qc(q)}{rs}-{qc(q)}{ra}', FMT_BS, annual='last', c0='=PRESTAMO', bold=True); rf = r; r += 1
    put(ws, f'C{r}', '=PRESTAMO', 'calc', FMT_BS); put(ws, f'A{r}', 'Desembolso', 'label'); rd = r; r += 1
    ROW.update({'FIN.int': ri, 'FIN.amort': ra, 'FIN.saldo': rf, 'FIN.desemb': rd})
    put(ws, f'A{r+1}', 'Tasa: tope de crédito productivo a microempresa según DS 2055 (verificar vigencia con el banco). La tasa trimestral simple (anual/4) es la convención bancaria habitual.', 'note')
    return ws
