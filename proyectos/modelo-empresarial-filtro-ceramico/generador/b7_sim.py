from lib import *
from b1_supuestos import ROW
from b2_mercado import year_hdr
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import SeriesLabel

NP = 12
def pc(p): return L(3 + p)  # período 1..12 -> D..O

def build_simulador(B):
    ws = B.sheet('SIMULADOR EMPRESARIAL', 'SIMULADOR EMPRESARIAL (preparación para el Juego de Negocios)',
                 'Modelo trimestral simplificado. Si una celda de "Decisión" queda vacía se usa el valor sugerido por el modelo maestro. NO reproduce las reglas del simulador del docente.', tab='7030A0')
    P = ROW
    widths(ws, {'A': 54, 'B': 14, 'C': 3})
    put(ws, 'A5', 'A. PARÁMETROS (vinculados al modelo maestro o supuestos editables)', 'sec')
    prm = [('SIM_ELAST_P', 'Elasticidad precio de la demanda', -1.2, 'input', FMT_BS2, 'Supuesto: bien durable con sustitutos (botellón). Reemplazar con la regla del simulador.'),
           ('SIM_ELAST_PUB', 'Elasticidad de la demanda a la publicidad', 0.10, 'input', FMT_BS2, 'Supuesto: +10% de publicidad → +1% de demanda.'),
           ('SIM_ELAST_DIST', 'Elasticidad de la demanda a la distribución', 0.05, 'input', FMT_BS2, 'Supuesto.'),
           ('SIM_CAPAC_EF', 'Mejora de productividad por cada Bs 1.000 de capacitación por operario', 0.02, 'input', FMT_PCT, 'Supuesto, con tope de 10%.'),
           ('SIM_FACTOR_CANAL', 'Precio que recibe la empresa / PVP (mezcla de canales)', "=MIX_DIRECTO+(1-MIX_DIRECTO)*(1-MARGEN_CANAL)", 'calc', FMT_PCT, 'Del modelo maestro.'),
           ('SIM_CAJA_INI', 'Caja inicial del período 1', f"={A0('FC.sfin')}", 'link', FMT_BS2, 'Saldo de caja al cierre del año 0.'),
           ('SIM_DEUDA_INI', 'Deuda inicial del período 1', '=PRESTAMO', 'calc', FMT_BS2, 'Préstamo del modelo maestro.')]
    r = 6
    for nm, lbl, v, k, fm, nt in prm:
        put(ws, f'A{r}', lbl, 'label'); put(ws, f'B{r}', v, k, fm); put(ws, f'D{r}', nt, 'note')
        B.name(nm, 'SIMULADOR EMPRESARIAL', f'B{r}'); r += 1
    r += 1
    put(ws, f'A{r}', 'B. DECISIONES POR PERÍODO', 'sec'); r += 1
    put(ws, f'A{r}', 'Concepto', 'hdr'); put(ws, f'B{r}', 'Unidad', 'hdr')
    for p in range(1, NP+1):
        put(ws, f'{pc(p)}{r}', f'P{p} ({QLABEL[p-1]})', 'hdr'); ws.column_dimensions[pc(p)].width = 13
    hr = r; r += 1
    def M(sheet, key, p, mult=''):
        return f"={Q(key, p)}{mult}"
    decisions = [
        ('precio', 'Precio al público (PVP)', '$us/filtro', lambda p: f"={Y('PRE.pvp_usd', year_of(p))}", FMT_BS2),
        ('pub', 'Publicidad del trimestre', '$us', lambda p: f"=PUBLICIDAD_MES*3*'Calendario'!{qc(p)}11*M_FIJOS/TIPO_CAMBIO", FMT_BS2),
        ('dist', 'Distribución y logística fija del trimestre', '$us', lambda p: f"='Otros gastos'!$C${P['GAS.transporte']}*3*'Calendario'!{qc(p)}11*M_FIJOS/TIPO_CAMBIO", FMT_BS2),
        ('ops', 'Operarios', 'personas', lambda p: f"={Y('PER.ops', year_of(p))}", FMT_INT),
        ('sal', 'Sueldo mensual por operario', '$us/mes', lambda p: f"='MANO DE OBRA'!$D${P['PER.crow_MOD']}*'Calendario'!{qc(p)}12*M_SALARIOS/TIPO_CAMBIO", FMT_BS2),
        ('cap', 'Capacitación del trimestre', '$us', lambda p: M('MANO DE OBRA', 'PER.capac', p), FMT_BS2),
        ('prod', 'Producción planificada', 'filtros', lambda p: M('Inventario', 'INV.prod', p), FMT_U),
        ('comp', 'Compras de materiales', 'juegos', lambda p: M('Compras', 'COM.compras', p), FMT_U),
        ('pnew', 'Préstamo nuevo', '$us', lambda p: '=0', FMT_BS2),
        ('aext', 'Amortización extraordinaria', '$us', lambda p: '=0', FMT_BS2),
    ]
    for key, lbl, u, fn, fm in decisions:
        put(ws, f'A{r}', f'{lbl} - sugerido', 'label'); put(ws, f'B{r}', u, 'note')
        for p in range(1, NP+1): put(ws, f'{pc(p)}{r}', fn(p), 'link' if '!' in fn(p) else 'calc', fm)
        rs = r; r += 1
        put(ws, f'A{r}', f'{lbl} - DECISIÓN (vacío = sugerido)', 'label', bold=True); put(ws, f'B{r}', u, 'note')
        for p in range(1, NP+1): put(ws, f'{pc(p)}{r}', None, 'input', fm)
        rd = r; r += 1
        put(ws, f'A{r}', f'{lbl} - usado', 'label'); put(ws, f'B{r}', u, 'note')
        for p in range(1, NP+1): put(ws, f'{pc(p)}{r}', f'=IF({pc(p)}{rd}="",{pc(p)}{rs},{pc(p)}{rd})', 'calc', fm)
        P['SIM.s_' + key] = rs; P['SIM.' + key] = r; r += 1
    r += 1
    put(ws, f'A{r}', 'C. RESULTADOS POR PERÍODO', 'sec'); r += 1
    def RW(key, lbl, u, fn, fm=FMT_BS2, bold=False, fill=None):
        nonlocal r
        put(ws, f'A{r}', lbl, 'label', bold=bold, fill=fill); put(ws, f'B{r}', u, 'note')
        for p in range(1, NP+1):
            v = fn(p); put(ws, f'{pc(p)}{r}', v, 'link' if '!' in v else 'calc', fm, bold=bold, fill=fill)
        P['SIM.' + key] = r; r += 1
    S = lambda k, p: f"{pc(p)}{P['SIM.'+k]}"
    SS = lambda k, p: f"{pc(p)}{P['SIM.s_'+k]}"
    prev = lambda k, p: f"{pc(p-1)}{P['SIM.'+k]}"
    RW('dbase', 'Demanda base (modelo maestro)', 'kits', lambda p: M('Pronostico', 'PRO.units', p), FMT_U)
    RW('dem', 'DEMANDA ESTIMADA según las decisiones', 'kits', lambda p: f"={S('dbase',p)}*({S('precio',p)}/{SS('precio',p)})^SIM_ELAST_P*(({S('pub',p)}+1)/({SS('pub',p)}+1))^SIM_ELAST_PUB*(({S('dist',p)}+1)/({SS('dist',p)}+1))^SIM_ELAST_DIST", FMT_U, bold=True)
    RW('prodv', 'Productividad por operario', 'kits/día', lambda p: f"=PROD_OPERARIO*(1+MIN(0.1,IF({S('ops',p)}>0,{S('cap',p)}*TIPO_CAMBIO/{S('ops',p)}/1000*SIM_CAPAC_EF,0)))", FMT_BS2)
    RW('capq', 'Capacidad del trimestre = mín(instalada, operarios x productividad x días)', 'kits', lambda p: f"=MIN(CAP_TRIM,{S('ops',p)}*{S('prodv',p)}*DIAS_TRIM)", FMT_U)
    RW('mpi', 'Inventario inicial de materiales', 'juegos', lambda p: '=0' if p == 1 else f"={pc(p-1)}{r+3}", FMT_U)
    RW('mpd', 'Materiales disponibles', 'juegos', lambda p: f"={S('mpi',p)}+{S('comp',p)}", FMT_U)
    RW('preal', 'Producción real = mín(planificada, capacidad, materiales)', 'kits', lambda p: f"=MIN({S('prod',p)},{S('capq',p)},{S('mpd',p)})", FMT_U, bold=True)
    RW('mpf', 'Inventario final de materiales', 'juegos', lambda p: f"={S('mpd',p)}-{S('preal',p)}", FMT_U)
    RW('pti', 'Inventario inicial de producto terminado', 'kits', lambda p: '=INV_INI_PT' if p == 1 else f"={pc(p-1)}{r+4}", FMT_U)
    RW('disp', 'Disponible para la venta', 'kits', lambda p: f"={S('pti',p)}+{S('preal',p)}", FMT_U)
    RW('ven', 'VENTAS = mín(demanda, disponible)', 'kits', lambda p: f"=MIN({S('dem',p)},{S('disp',p)})", FMT_U, bold=True)
    RW('perd', 'Ventas perdidas por falta de producto', 'kits', lambda p: f"={S('dem',p)}-{S('ven',p)}", FMT_U)
    RW('ptf', 'Inventario final de producto terminado', 'kits', lambda p: f"={S('disp',p)}-{S('ven',p)}", FMT_U)
    RW('ing', 'Ingresos netos (sin IVA)', '$us', lambda p: f"={S('ven',p)}*{S('precio',p)}*SIM_FACTOR_CANAL*(1-TASA_IVA)")
    RW('cvar', '(-) Costo variable (materiales, energía, entrega) e IT', '$us', lambda p: f"={S('ven',p)}*((CVP_KIT_NETO+ENTREGA_U*(1-TASA_IVA))/TIPO_CAMBIO*'Calendario'!{qc(p)}11*M_CVAR+{S('precio',p)}*SIM_FACTOR_CANAL*TASA_IT)")
    RW('mc', 'Margen de contribución', '$us', lambda p: f"={S('ing',p)}-{S('cvar',p)}", bold=True)
    RW('sueop', '(-) Sueldos de operarios con cargas', '$us', lambda p: f"={S('ops',p)}*{S('sal',p)}*3*(1+TASA_CARGAS)")
    RW('sueot', '(-) Otros sueldos con cargas (modelo maestro)', '$us', lambda p: f"={Q('PER.MOI', p)}+{Q('PER.ADM', p)}+{Q('PER.COM', p)}")
    RW('pdc', '(-) Publicidad, distribución y capacitación (netas de IVA)', '$us', lambda p: f"=({S('pub',p)}+{S('dist',p)})*(1-TASA_IVA)+{S('cap',p)}")
    RW('ogf', '(-) Otros gastos fijos (modelo maestro)', '$us', lambda p: f"={Q('GAS.FAB.neto', p)}+{Q('GAS.ADM.neto', p)}")
    RW('da', '(-) Depreciación y amortización', '$us', lambda p: f"={Q('ER.dep_fab', p)}+{Q('ER.dep_adm', p)}+{Q('ER.amort', p)}")
    RW('ebit', 'Utilidad operativa', '$us', lambda p: f"={S('mc',p)}-SUM({S('sueop',p)}:{S('da',p)})", bold=True)
    RW('di', 'Deuda al inicio', '$us', lambda p: '=SIM_DEUDA_INI' if p == 1 else f"={pc(p-1)}{r+5}")
    RW('int', '(-) Intereses', '$us', lambda p: f"={S('di',p)}*TASA_TRIM")
    RW('uai', 'Utilidad antes de impuestos', '$us', lambda p: f"={S('ebit',p)}-{S('int',p)}")
    RW('iue', '(-) IUE estimado (25% si hay utilidad; simplificado)', '$us', lambda p: f"=MAX(0,{S('uai',p)})*TASA_IUE")
    RW('un', 'UTILIDAD NETA', '$us', lambda p: f"={S('uai',p)}-{S('iue',p)}", bold=True, fill=FILL_KEY)
    RW('df', 'Deuda al final', '$us', lambda p: f"=MAX(0,{S('di',p)}+{S('pnew',p)}-MIN({S('di',p)},{Q('FIN.amort', p)})-{S('aext',p)})")
    RW('dinv', '(-) Aumento del valor de inventarios', '$us', lambda p: f"=(({S('mpf',p)}-{S('mpi',p)})+({S('ptf',p)}-{S('pti',p)}))*CVP_KIT_NETO/TIPO_CAMBIO*'Calendario'!{qc(p)}11*M_CVAR")
    RW('cini', 'Caja al inicio', '$us', lambda p: '=SIM_CAJA_INI' if p == 1 else f"={pc(p-1)}{r+1}")
    RW('cfin', 'CAJA AL FINAL (flujo simplificado)', '$us', lambda p: f"={S('cini',p)}+{S('un',p)}+{S('da',p)}-{S('dinv',p)}+({S('df',p)}-{S('di',p)})", bold=True, fill=FILL_KEY)
    RW('liq', 'Liquidez: caja / pagos de deuda del trimestre', 'x', lambda p: f"=IF(({S('di',p)}-{S('df',p)}+{S('int',p)})>0,{S('cfin',p)}/({S('di',p)}-{S('df',p)}+{S('int',p)}),0)", FMT_X)
    RW('end', 'Endeudamiento: deuda / (deuda + aporte + utilidades acumuladas)', '%', lambda p: f"={S('df',p)}/({S('df',p)}+APORTE_SOCIOS+SUM($D{P['SIM.un']}:{pc(p)}{P['SIM.un']}))", FMT_PCT)
    RW('umaster', 'Comparación: utilidad neta del modelo maestro (antes de IUE anual)', '$us', lambda p: f"={Q('ER.uai', p)}")
    RW('alerta', 'Alerta', '', lambda p: f"=IF({S('cfin',p)}<0,\"CAJA NEGATIVA\",IF({S('perd',p)}>0.5,\"VENTAS PERDIDAS\",IF({S('ptf',p)}>{S('dem',p)},\"EXCESO DE STOCK\",\"OK\")))", None)
    r += 1
    put(ws, f'A{r}', 'D. ¿QUIÉN CONTROLA CADA VARIABLE?', 'sec'); r += 1
    for j, h in enumerate(['Variable', '¿Decisión interna de la empresa?', '¿La permite modificar el Juego de Negocios?', 'Qué hacer al recibir el manual']):
        put(ws, f'{L(1 + (0 if j == 0 else j+2))}{r}', h, 'hdr')
    r += 1
    tab = [('Precio', 'Sí', 'POR CONFIRMAR', 'Copiar rango permitido y su efecto en la demanda'),
           ('Publicidad', 'Sí', 'POR CONFIRMAR', 'Reemplazar elasticidad SIM_ELAST_PUB por la regla del juego'),
           ('Distribución', 'Sí', 'POR CONFIRMAR', 'Idem'),
           ('Producción y compras', 'Sí', 'POR CONFIRMAR', 'Ajustar plazos de entrega y costos de inventario'),
           ('Operarios, sueldos y capacitación', 'Sí', 'POR CONFIRMAR', 'Ajustar costos de contratación/despido y productividad'),
           ('Préstamos y amortizaciones', 'Sí', 'POR CONFIRMAR', 'Copiar tasas y límites de crédito del juego'),
           ('Demanda del mercado', 'No (la genera el mercado)', 'La calcula el juego', 'Usar los reportes de cada período en CONTROL DE PERIODOS'),
           ('Inflación, tipo de cambio, impuestos', 'No', 'Parámetros del juego', 'Copiar los valores del manual a Supuestos')]
    for row in tab:
        put(ws, f'A{r}', row[0], 'label')
        for j, v in enumerate(row[1:]): put(ws, f'{L(4+j)}{r}', v, 'label')
        r += 1
    put(ws, f'A{r+1}', 'Limitaciones: flujo de caja simplificado (sin plazos de cobro ni IVA); IUE estimado por trimestre. Para cifras oficiales usar los estados del modelo maestro.', 'note')
    ws.freeze_panes = f'D{hr+1}'
    return ws

def build_decisiones(B):
    ws = B.sheet('DECISIONES Y ESCENARIOS', 'DECISIONES Y ESCENARIOS', 'A: escenario activo en vivo. B: corridas registradas de los tres escenarios y pruebas de estrés. C: comparador de decisiones para un año.', tab='7030A0')
    P = ROW
    widths(ws, {'A': 48, 'B': 15, 'C': 15, 'D': 15, 'E': 15, 'F': 15, 'G': 15, 'H': 15, 'I': 15})
    put(ws, 'A5', 'A. ESCENARIO ACTIVO (se recalcula con cualquier cambio)', 'sec')
    live = [('Escenario', '=NOMBRE_ESCENARIO', None), ('VAN ($us)', '=EV_VAN', FMT_BS2), ('VAN (Bs)', '=EV_VAN_BS', FMT_BS), ('TIR', '=EV_TIR', FMT_PCT2), ('TRMA', '=TRMA', FMT_PCT2),
            ('Período de recuperación (años)', '=EV_PRI', FMT_BS2), ('Relación B/C', '=EV_BC', FMT_X),
            ('Ventas 2027 (kits)', f"={Y('ER.u', 1)}", FMT_U), ('Ventas 2031 (kits)', f"={Y('ER.u', 5)}", FMT_U),
            ('Utilidad neta 2027 ($us)', f"={Y('ER.un', 1)}", FMT_BS2), ('Utilidad neta 2031 ($us)', f"={Y('ER.un', 5)}", FMT_BS2),
            ('Caja mínima trimestral ($us)', f"=MIN({A0('FC.sfin')},{QR('FC.sfin', 1, 20)})", FMT_BS2), ('Decisión', '=EV_DECISION', None)]
    r = 6
    for lbl, f, fm in live:
        put(ws, f'A{r}', lbl, 'label'); put(ws, f'B{r}', f, 'calc', fm); r += 1
    r += 1
    put(ws, f'A{r}', 'B. CORRIDAS REGISTRADAS (valores guardados por el procedimiento de pruebas; ver INFORME_DE_PRUEBAS.md)', 'sec'); r += 1
    hd = ['Caso', 'VAN ($us)', 'TIR', 'PRI (años)', 'Ventas 2027', 'Utilidad neta 2031', 'Caja mínima', 'Balance cuadra']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}{r}', h, 'hdr')
    P['DEC.snap_hdr'] = r; r += 12
    put(ws, f'A{r}', 'Estos valores no se recalculan solos: son el resultado de cambiar ESCENARIO o los multiplicadores en Supuestos y recalcular. Para reproducirlos, cambie la celda indicada y lea la sección A.', 'note'); r += 2
    put(ws, f'A{r}', 'C. COMPARADOR DE DECISIONES PARA UN AÑO (modelo de margen de contribución)', 'sec'); r += 1
    put(ws, f'A{r}', 'Año a analizar (1 = 2027 ... 5 = 2031)', 'label'); put(ws, f'B{r}', 1, 'input', FMT_INT); ry = r; r += 1
    yr = f'$B${ry}'
    put(ws, f'A{r}', 'Datos base del año (modelo maestro)', 'label', bold=True); r += 1
    PE = lambda k: f"INDEX('Rentabilidad'!$C${P['PE.'+k]}:$G${P['PE.'+k]},{yr})"
    base = [('Unidades vendidas', f'={PE("u")}', FMT_U), ('Precio neto por kit', f'={PE("p")}', FMT_BS2), ('Costo variable por kit', f'={PE("cvu")}', FMT_BS2),
            ('Costos fijos operativos', f'={PE("cf")}', FMT_BS), ('Intereses', f'={PE("int")}', FMT_BS),
            ('Publicidad anual (con factura)', f"=PUBLICIDAD_MES*12*INDEX('Calendario'!$Y$11:$AC$11,{yr})*M_FIJOS/TIPO_CAMBIO", FMT_BS), ('Capacidad anual', '=CAP_ANUAL', FMT_U)]
    bref = {}
    for lbl, f, fm in base:
        put(ws, f'A{r}', lbl, 'label'); put(ws, f'B{r}', f, 'link', fm); bref[lbl] = f'$B${r}'; r += 1
    r += 1
    alts = ['Base', 'Subir precio 10%', 'Bajar precio 10%', 'Publicidad +50%', 'Reducir costo variable 5%', 'Más deuda (+$us 10.000)']
    put(ws, f'A{r}', 'Alternativa', 'hdr')
    for j, a in enumerate(alts): put(ws, f'{L(2+j)}{r}', a, 'hdr')
    r += 1
    inputs = [('Cambio de precio', [0, 0.10, -0.10, 0, 0, 0], FMT_PCT), ('Cambio de publicidad', [0, 0, 0, 0.5, 0, 0], FMT_PCT),
              ('Cambio de costo variable', [0, 0, 0, 0, -0.05, 0], FMT_PCT), ('Deuda adicional ($us)', [0, 0, 0, 0, 0, 10000], FMT_BS)]
    ir = {}
    for lbl, vals, fm in inputs:
        put(ws, f'A{r}', lbl, 'label')
        for j, v in enumerate(vals): put(ws, f'{L(2+j)}{r}', v, 'input', fm)
        ir[lbl] = r; r += 1
    def CR(lbl, fn, fm, bold=False, fill=None):
        nonlocal r
        put(ws, f'A{r}', lbl, 'label', bold=bold, fill=fill)
        for j in range(len(alts)): put(ws, f'{L(2+j)}{r}', fn(L(2+j)), 'calc', fm, bold=bold, fill=fill)
        rr = r; r += 1; return rr
    ru = CR('Unidades (con elasticidades, tope de capacidad)', lambda c: f"=MIN({bref['Capacidad anual']},{bref['Unidades vendidas']}*(1+{c}{ir['Cambio de precio']})^SIM_ELAST_P*(1+{c}{ir['Cambio de publicidad']})^SIM_ELAST_PUB)", FMT_U)
    rv = CR('Ventas netas', lambda c: f"={c}{ru}*{bref['Precio neto por kit']}*(1+{c}{ir['Cambio de precio']})", FMT_BS)
    rcv = CR('Costos variables', lambda c: f"={c}{ru}*({bref['Costo variable por kit']}*(1+{c}{ir['Cambio de costo variable']})+{bref['Precio neto por kit']}/(1-TASA_IVA)*TASA_IT*{c}{ir['Cambio de precio']})", FMT_BS)
    rmc = CR('Margen de contribución', lambda c: f"={c}{rv}-{c}{rcv}", FMT_BS, bold=True)
    rcf = CR('Costos fijos', lambda c: f"={bref['Costos fijos operativos']}+{bref['Publicidad anual (con factura)']}*{c}{ir['Cambio de publicidad']}*(1-TASA_IVA)", FMT_BS)
    reb = CR('Utilidad operativa', lambda c: f"={c}{rmc}-{c}{rcf}", FMT_BS)
    rin = CR('Intereses', lambda c: f"={bref['Intereses']}+{c}{ir['Deuda adicional ($us)']}*TASA_PRESTAMO", FMT_BS)
    rua = CR('Utilidad antes de impuestos', lambda c: f"={c}{reb}-{c}{rin}", FMT_BS)
    run = CR('UTILIDAD NETA (IUE 25%)', lambda c: f"={c}{rua}-MAX(0,{c}{rua})*TASA_IUE", FMT_BS, bold=True, fill=FILL_KEY)
    CR('Diferencia contra la base', lambda c: f"={c}{run}-$B${run}", FMT_BS)
    CR('Punto de equilibrio (kits)', lambda c: f"={c}{rcf}/({c}{rmc}/{c}{ru})", FMT_U)
    put(ws, f'A{r}', 'MEJOR ALTERNATIVA (mayor utilidad neta)', 'label', bold=True)
    put(ws, f'B{r}', f'=INDEX(B{ru-5}:G{ru-5},MATCH(MAX(B{run}:G{run}),B{run}:G{run},0))', 'calc', bold=True, fill=FILL_KEY)
    r += 2
    put(ws, f'A{r}', 'Las elasticidades vienen de SIMULADOR EMPRESARIAL (supuestos). La alternativa de deuda solo muestra el costo financiero; su beneficio depende del uso que se dé al dinero.', 'note')
    return ws

def build_control(B):
    ws = B.sheet('CONTROL DE PERIODOS', 'CONTROL DE PERIODOS: PLAN vs. REAL', 'Cargar en las columnas azules los resultados reales (o los reportes del Juego de Negocios). Las desviaciones y el semáforo se calculan solos.', tab='7030A0')
    P = ROW
    hd = ['Período', 'Trimestre', 'Plan: ventas (filtros)', 'Plan: ventas netas ($us)', 'Plan: producción (kits)', 'Plan: inventario final (kits)', 'Plan: utilidad antes de IUE ($us)', 'Plan: caja final ($us)',
          'Real: ventas (kits)', 'Real: ventas netas ($us)', 'Real: producción (kits)', 'Real: inventario final (kits)', 'Real: utilidad ($us)', 'Real: caja final ($us)',
          'Desv. ventas', 'Desv. utilidad ($us)', 'Desv. caja ($us)', 'Semáforo']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}5', h, 'hdr')
    widths(ws, {L(j): 14 for j in range(1, 19)}); ws.column_dimensions['A'].width = 9; ws.column_dimensions['R'].width = 30
    ws.row_dimensions[5].height = 45
    for q in range(1, NQ+1):
        r = 5 + q
        put(ws, f'A{r}', q, 'label', FMT_INT); put(ws, f'B{r}', QLABEL[q-1], 'label')
        plan = [f"={Q(k, q)}" for k in ('ER.u', 'ER.vn', 'INV.prod', 'INV.fin', 'ER.uai', 'FC.sfin')]
        for j, f in enumerate(plan): put(ws, f'{L(3+j)}{r}', f, 'link', FMT_U if j in (0, 2, 3) else FMT_BS2)
        for j in range(6): put(ws, f'{L(9+j)}{r}', None, 'input', FMT_U if j in (0, 2, 3) else FMT_BS2)
        put(ws, f'O{r}', f'=IF(I{r}="","",I{r}/C{r}-1)', 'calc', FMT_PCT)
        put(ws, f'P{r}', f'=IF(M{r}="","",M{r}-G{r})', 'calc', FMT_BS)
        put(ws, f'Q{r}', f'=IF(N{r}="","",N{r}-H{r})', 'calc', FMT_BS)
        put(ws, f'R{r}', f'=IF(I{r}="","Sin datos reales",IF(AND(O{r}>=-0.1,N{r}>=CAJA_MINIMA),"VERDE: dentro del plan",IF(N{r}<0,"ROJO: caja negativa","AMARILLO: revisar")))', 'calc')
    r = 5 + NQ + 2
    put(ws, f'A{r}', 'RESUMEN ANUAL', 'sec'); r += 1
    for j, h in enumerate(['Año', '', 'Plan: ventas (kits)', 'Plan: ventas netas', 'Plan: producción', '', 'Plan: utilidad antes de IUE', '', 'Real: ventas (kits)', 'Real: ventas netas', 'Real: producción', '', 'Real: utilidad']):
        if h: put(ws, f'{L(1+j)}{r}', h, 'hdr')
    r += 1
    for y in range(1, 6):
        a, b = 6 + 4*(y-1), 9 + 4*(y-1)
        put(ws, f'A{r}', str(2026+y), 'label')
        for col in 'CDEGIJKM':
            put(ws, f'{col}{r}', f'=SUM({col}{a}:{col}{b})', 'calc', FMT_BS)
        r += 1
    ch = LineChart(); ch.title = 'Ventas plan vs. real (kits por trimestre)'; ch.height = 8; ch.width = 22
    ch.add_data(Reference(ws, min_col=3, min_row=5, max_row=5+NQ), titles_from_data=True)
    ch.add_data(Reference(ws, min_col=9, min_row=5, max_row=5+NQ), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, min_row=6, max_row=5+NQ))
    ws.add_chart(ch, f'A{r+2}')
    ws.freeze_panes = 'C6'
    return ws
