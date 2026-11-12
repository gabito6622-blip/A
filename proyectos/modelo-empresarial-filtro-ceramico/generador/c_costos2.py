from lib import *
from b1_supuestos import ROW

def build_precio(B):
    ws = B.wb.create_sheet('Precio')
    widths(ws, {'A': 4, 'B': 26, 'C': 10, 'D': 30, 'E': 15, 'F': 16.5, 'G': 15.5, 'H': 28.5, 'I': 15.5, 'J': 20, 'K': 15, 'L': 16})
    ER = lambda k: Y(k, 1)
    put(ws, 'B1', 'Método basado en costos expresado en $us', 'label', bold=True)
    for c, h in [('B', 'Detalle'), ('D', 'Q'), ('E', 'Costo total ($)'), ('F', 'Costo unitario ($)'), ('G', 'Utilidad 30%'), ('H', 'Precio antes de impuestos ($)'), ('I', 'IVA + IT (19,05%)'), ('J', 'Precio c/ctvos'), ('K', 'Precio s/ctvos'), ('L', 'Bs')]:
        put(ws, f'{c}2', h, 'hdr')
    put(ws, 'G2', '="Utilidad "&TEXT(MARKUP_COSTO,"0%")', 'hdr')
    put(ws, 'B3', 'Filtro 2.0 (1 kit)', 'label', bold=True, border=True)
    put(ws, 'D3', f"={ER('ER.u')}", 'link', FMT_U); put(ws, 'E3', '=SUM(F6:F10)', 'calc', FMT_BS2); put(ws, 'F3', '=E3/D3', 'calc', FMT_BS2)
    put(ws, 'H3', '=F3/(1-MARKUP_COSTO)', 'calc', FMT_BS2); put(ws, 'G3', '=H3-F3', 'calc', FMT_BS2)
    put(ws, 'I3', '=H3*(TASA_IVA+TASA_IT)/(1-TASA_IVA-TASA_IT)', 'calc', FMT_BS2); put(ws, 'J3', '=H3+I3', 'calc', FMT_BS2)
    put(ws, 'K3', '=ROUND(J3,0)', 'calc', FMT_BS2); put(ws, 'L3', '=K3*TIPO_CAMBIO', 'calc', FMT_BS2, bold=True)
    items = [(6, 'MP', f"={ER('ER.cv')}"), (7, 'MOD', f"=SUM({QR('PER.MOD', 1, 4)})"), (8, 'MOI', f"={ER('ER.sfab')}-F7+{ER('ER.sadm')}+{ER('ER.scom')}"),
             (9, 'GFD', '=F19'), (10, 'GFI', '=J19')]
    for r, k, f in items:
        put(ws, f'C{r}', 'Anual', 'label', border=True); put(ws, f'D{r}', k, 'label', border=True); put(ws, f'F{r}', f, 'link', FMT_BS2)
    put(ws, 'D12', 'GASTO DE FABRICACIÓN DIRECTO', 'hdr'); ws.merge_cells('D12:F12'); put(ws, 'H12', 'GASTO DE FABRICACIÓN INDIRECTO', 'hdr'); ws.merge_cells('H12:J12')
    gfd = [('Alquiler, energía, mantenimiento y laboratorio', f"={ER('ER.gfab')}"), ('Depreciación de activos de producción', f"={ER('ER.dep_fab')}")]
    for i, (t, f) in enumerate(gfd):
        put(ws, f'D{13+i}', t, 'label', border=True); put(ws, f'F{13+i}', f, 'link', FMT_BS2)
    gfi = [('Gastos de administración', f"={ER('ER.gadm')}"), ('Capacitación', f"={ER('ER.capac')}"), ('Depreciación de oficina', f"={ER('ER.dep_adm')}"),
           ('Amortización de diferidos', f"={ER('ER.amort')}"), ('Prima anual', f"={ER('ER.prima')}"), ('Marketing, publicidad y logística', f"={ER('ER.gcom')}"), ('Entrega', f"={ER('ER.ent')}")]
    for i, (t, f) in enumerate(gfi):
        put(ws, f'H{13+i}', t, 'label', border=True); put(ws, f'J{13+i}', f, 'link', FMT_BS2)
    put(ws, 'D19', 'Total General', 'label', bold=True, border=True); put(ws, 'F19', '=SUM(F13:F18)', 'calc', FMT_BS2, bold=True)
    put(ws, 'H19', 'TOTAL', 'label', bold=True, border=True); put(ws, 'J19', '=SUM(J13:J18)', 'calc', FMT_BS2, bold=True)
    put(ws, 'D23', 'DETERMINACIÓN DEL PRECIO DEL PRODUCTO EN $', 'label', bold=True)
    hd = ['AÑO', 'COSTO UNIT. ($)', 'PRECIO PROMEDIO SIN IMPUESTOS ($)', 'PRECIO AL PÚBLICO C/FACTURA ($)', 'PRECIO A TIENDAS (canal indirecto) ($)', 'PRECIO AL PÚBLICO (Bs)', 'PRECIO PROMEDIO QUE FACTURA LA EMPRESA ($)', 'PROMEDIO (Bs)']
    for j, h in enumerate(hd): put(ws, f'{L(4+j)}24', h, 'hdr')
    ws.row_dimensions[24].height = 45
    for y in range(1, 6):
        r = 25 + y
        put(ws, f'D{r}', 2026 + y, 'calc', FMT_INT)
        put(ws, f'E{r}', f"=({Y('ER.cv', y)}+{Y('ER.gop', y)}-{Y('ER.it', y)})/{Y('ER.u', y)}", 'link', FMT_BS2)
        put(ws, f'I{r}', f"={Y('DEM.pvp', y)}", 'link', FMT_BS2)
        put(ws, f'G{r}', f'=I{r}/TIPO_CAMBIO', 'calc', FMT_BS2)
        put(ws, f'H{r}', f'=G{r}*(1-MARGEN_CANAL)', 'calc', FMT_BS2)
        put(ws, f'J{r}', f'=MIX_DIRECTO*G{r}+(1-MIX_DIRECTO)*H{r}', 'calc', FMT_BS2, bold=True)
        put(ws, f'F{r}', f'=J{r}*(1-TASA_IVA-TASA_IT)', 'calc', FMT_BS2)
        put(ws, f'K{r}', f'=J{r}*TIPO_CAMBIO', 'calc', FMT_BS2)
    reg('PRE.prom_usd', 'Precio', y=lambda y: f'J{25+y}')
    reg('PRE.pvp_usd', 'Precio', y=lambda y: f'G{25+y}')
    put(ws, 'D32', 'PRECIO FRENTE AL MERCADO', 'label', bold=True)
    rows = [('Ahorro anual del hogar frente al botellón (Bs)', f"='Producto'!B{ROW['PM.ahorro']}", FMT_BS),
            ('Meses para recuperar el precio del filtro', f"='Producto'!B{ROW['PM.meses']}", FMT_BS2),
            ('Litros por día desde los que conviene el filtro', f"='Producto'!B{ROW['PM.litros']}", FMT_BS2),
            ('Filtro o purificador más barato encontrado (Bs)', f"='Competencia'!C{ROW['COMP.min']}", FMT_BS),
            ('Filtro o purificador más caro encontrado (Bs)', f"='Competencia'!C{ROW['COMP.max']}", FMT_BS),
            ('Precio con 30% por el método de costo, puesto al público (Bs)', '=L3/(MIX_DIRECTO+(1-MIX_DIRECTO)*(1-MARGEN_CANAL))', FMT_BS)]
    for i, (t, f, fm) in enumerate(rows):
        put(ws, f'D{33+i}', t, 'label', border=True); ws.merge_cells(f'D{33+i}:G{33+i}'); put(ws, f'H{33+i}', f, 'link' if '!' in f else 'calc', fm)
    put(ws, 'D40', 'Fuente del precio de Bs 420: precio de mercado, entre los filtros simples y los purificadores (hoja Competencia), y menor que 4 meses de botellones. Falta confirmarlo con la encuesta.', 'label')
    return ws

DIFER = [('Constitución, licencias y registros', 6000, 0), ('Honorarios profesionales', 4000, 1), ('Validación en laboratorio acreditado', 15000, 1),
         ('Registro de marca y diseño de empaque', 3500, 0), ('Validación de la capa de carbón', 8000, 1), ('Solicitud de modelo de utilidad (SENAPI)', 5000, 0),
         ('Capacitación técnica inicial', 8000, 1), ('Adecuación del galpón (gas, ventilación, piso)', 30000, 1)]

def build_inversion(B):
    ws = B.wb.create_sheet('Inversión')
    widths(ws, {'A': 4, 'B': 46, 'C': 14.5, 'D': 11, 'E': 11, 'F': 11, 'G': 11, 'H': 13, 'I': 13, 'J': 34, 'K': 15, 'L': 15})
    put(ws, 'B2', 'Cuentas', 'hdr'); put(ws, 'C2', 'Año 0 (2026)', 'hdr'); put(ws, 'D2', 2027, 'hdr'); ws.merge_cells('D2:G2'); put(ws, 'H2', 'TOTAL ($)', 'hdr'); put(ws, 'I2', 'TOTAL (Bs)', 'hdr')
    for k in range(4): put(ws, f'{L(4+k)}3', QL[k], 'hdr')
    for c, h in [('J', 'Factura (1/0)'), ('K', 'IVA ($)'), ('L', 'Monto (Bs)')]: put(ws, f'{c}2', h, 'hdr')
    def row(r, lbl, c=None, bold=False, iva=None, bs=None, fac=None):
        put(ws, f'B{r}', lbl, 'label', bold=bold, border=True)
        if c is not None: put(ws, f'C{r}', c, 'link' if '!' in str(c) else 'calc', FMT_BS2)
        put(ws, f'I{r}', f'=H{r}*TIPO_CAMBIO', 'calc', FMT_BS)
        if fac is not None: put(ws, f'J{r}', fac, 'input', FMT_INT)
        if iva is not None: put(ws, f'K{r}', iva, 'calc', FMT_BS2)
        if bs is not None: put(ws, f'L{r}', bs, 'input', FMT_BS)
    row(4, 'Inversión fija', bold=True); put(ws, 'H4', '=H5', 'calc', FMT_BS2, bold=True)
    row(5, 'Activos fijos', c='=AF_ANIO0', iva='=AF_ANIO0_IVA'); put(ws, 'H5', '=SUM(C5:G5)', 'calc', FMT_BS2)
    row(6, 'Inversión diferida', bold=True)
    r = 7
    for (t, m, f) in DIFER:
        row(r, t, c=f'=L{r}*M_INVERSION/TIPO_CAMBIO', iva=f'=C{r}*TASA_IVA*J{r}', bs=m, fac=f); put(ws, f'H{r}', f'=SUM(C{r}:G{r})', 'calc', FMT_BS2); r += 1
    d1 = r - 1
    put(ws, 'H6', f'=SUM(H7:H{d1})', 'calc', FMT_BS2, bold=True)
    rpm = r; row(r, 'Inversión para la puesta en marcha', bold=True); r += 1
    pm = [('Materia prima y gas del lote piloto', '=LOTE_PILOTO*(MP_KIT_CF+ENERGIA_KIT_CF)/TIPO_CAMBIO', 1),
          ('Sueldos de 2 meses antes de operar (jefe y operarios)', f"=2*('MANO DE OBRA'!D{ROW['PER.crow_MOI']}+MIN_OPERARIOS*'MANO DE OBRA'!D{ROW['PER.crow_MOD']})*(1+TASA_CARGAS)*M_SALARIOS/TIPO_CAMBIO", 0),
          ('Alquiler de 2 meses antes de operar', f"=2*'Otros gastos'!C{ROW['GAS.alquiler']}/TIPO_CAMBIO", 1),
          ('Publicidad de lanzamiento', None, 1)]
    p0 = r
    for (t, f, fac) in pm:
        if f is None: row(r, t, c=f'=L{r}/TIPO_CAMBIO', iva=f'=C{r}*TASA_IVA*J{r}', bs=15000, fac=fac)
        else: row(r, t, c=f, iva=f'=C{r}*TASA_IVA*J{r}', fac=fac)
        put(ws, f'H{r}', f'=SUM(C{r}:G{r})', 'calc', FMT_BS2); r += 1
    p1 = r - 1
    put(ws, f'H{rpm}', f'=SUM(H{p0}:H{p1})', 'calc', FMT_BS2, bold=True)
    rct = r; row(r, 'Capital de trabajo', c='=CT_INICIAL', bold=True); put(ws, f'H{r}', f'=SUM(C{r}:G{r})', 'calc', FMT_BS2, bold=True); r += 1
    rtot = r; row(r, 'Total inversión', bold=True); put(ws, f'H{r}', f'=H4+H6+H{rpm}+H{rct}', 'calc', FMT_BS2, bold=True, fill=FILL_KEY)
    B.name('INVERSION_TOTAL', 'Inversión', f'H{rtot}')
    put(ws, f'B{r+1}', 'Tasa de amortización de diferidos (4 años)', 'label', border=True); put(ws, f'C{r+1}', 0.25, 'input', FMT_PCT); B.name('TASA_AMORT', 'Inversión', f'C{r+1}')
    put(ws, f'B{r+2}', 'Diferidos y puesta en marcha ($): pago / IVA / neto', 'label', border=True)
    put(ws, f'C{r+2}', f'=H6+H{rpm}', 'calc', FMT_BS2); put(ws, f'D{r+2}', f'=SUM(K7:K{p1})', 'calc', FMT_BS2); put(ws, f'E{r+2}', f'=C{r+2}-D{r+2}', 'calc', FMT_BS2)
    B.name('DIF_PAGO', 'Inversión', f'C{r+2}'); B.name('DIF_IVA', 'Inversión', f'D{r+2}'); B.name('DIF_NETO', 'Inversión', f'E{r+2}')
    r = r + 4
    put(ws, f'B{r}', 'INVERSIÓN', 'label', bold=True); put(ws, f'J{r}', 'INVERSIÓN SIN CAPITAL DE TRABAJO', 'label', bold=True)
    s = [('Capital de Trabajo', f'=H{rct}'), ('Activo Diferido', '=H6'), ('Activo Fijo', '=H5'), ('Inversión para la Puesta en Marcha', f'=H{rpm}')]
    for i, (t, f) in enumerate(s):
        put(ws, f'B{r+1+i}', t, 'label', border=True); put(ws, f'C{r+1+i}', f, 'calc', FMT_BS2)
    put(ws, f'C{r+5}', f'=SUM(C{r+1}:C{r+4})', 'calc', FMT_BS2, bold=True)
    for i, (t, f) in enumerate(s[1:]):
        put(ws, f'J{r+1+i}', t, 'label', border=True); put(ws, f'K{r+1+i}', f, 'calc', FMT_BS2)
    put(ws, f'J{r+4}', 'TOTAL DE INVERSIÓN REQUERIDA', 'label', bold=True, border=True); put(ws, f'K{r+4}', f'=SUM(K{r+1}:K{r+3})', 'calc', FMT_BS2, bold=True)
    r = r + 7
    put(ws, f'B{r}', 'FINANCIAMIENTO DE LA INVERSIÓN', 'label', bold=True)
    put(ws, f'B{r+1}', 'Préstamo bancario', 'label', border=True); put(ws, f'C{r+1}', '=PRESTAMO', 'calc', FMT_BS2); put(ws, f'D{r+1}', f'=C{r+1}/INVERSION_TOTAL', 'calc', FMT_PCT)
    put(ws, f'B{r+2}', 'Aporte de los socios', 'label', border=True); put(ws, f'C{r+2}', '=INVERSION_TOTAL-PRESTAMO', 'calc', FMT_BS2); put(ws, f'D{r+2}', f'=C{r+2}/INVERSION_TOTAL', 'calc', FMT_PCT)
    B.name('APORTE_SOCIOS', 'Inversión', f'C{r+2}')
    r = r + 5
    put(ws, f'B{r}', 'CÁLCULO DEL CAPITAL DE TRABAJO', 'label', bold=True); r += 1
    c0 = r
    for t, f in [('Días de inventario de materia prima', '=DIAS_INV_MP'), ('Días de proceso', '=DIAS_PROCESO'), ('Días de inventario de producto terminado', '=DIAS_INV_PT'), ('Días de cobro (60% a 30 días)', '=(1-MIX_DIRECTO)*DIAS_COBRO_IND')]:
        put(ws, f'B{r}', t, 'label', border=True); put(ws, f'C{r}', f, 'calc', FMT_BS2); r += 1
    put(ws, f'B{r}', 'Período de desfase (días)', 'label', bold=True, border=True); put(ws, f'C{r}', f'=SUM(C{c0}:C{r-1})', 'calc', FMT_BS2, bold=True); B.name('DIAS_DESFASE', 'Inversión', f'C{r}'); r += 2
    put(ws, f'B{r}', 'Año', 'hdr')
    for y in range(1, 6): put(ws, f'{L(2+y)}{r}', 2026 + y, 'hdr')
    r += 1
    put(ws, f'B{r}', 'Costo operativo en efectivo del año ($)', 'label', border=True)
    for y in range(1, 6):
        put(ws, f'{L(2+y)}{r}', f"={Y('ER.cv', y)}+{Y('ER.gop', y)}-{Y('ER.dep_fab', y)}-{Y('ER.dep_adm', y)}-{Y('ER.amort', y)}-{Y('ER.prima', y)}", 'link', FMT_BS2)
    rco = r; r += 1
    put(ws, f'B{r}', 'Método 1: período de desfase (costo / 360 x días)', 'label', border=True)
    for y in range(1, 6): put(ws, f'{L(2+y)}{r}', f'={L(2+y)}{rco}/360*DIAS_DESFASE', 'calc', FMT_BS2)
    rdes = r; r += 1
    put(ws, f'B{r}', 'Método 2: déficit de caja del arranque + caja mínima', 'label', border=True)
    for y in range(1, 6): put(ws, f'{L(2+y)}{r}', f"=({A0('FC.deficit')}+CAJA_MINIMA)*{L(2+y)}{rco}/$C${rco}", 'link', FMT_BS2)
    rdef = r; r += 1
    put(ws, f'B{r}', 'CAPITAL DE TRABAJO USADO', 'label', bold=True, border=True)
    for y in range(1, 6): put(ws, f'{L(2+y)}{r}', f'=IF(METODO_CT=1,{L(2+y)}{rdes},{L(2+y)}{rdef})', 'calc', FMT_BS2, bold=True, fill=FILL_KEY)
    B.name('CT_INICIAL', 'Inversión', f'C{r}')
    reg('INV.ct', 'Inversión', y=(lambda r_: (lambda y: f'{L(2+y)}{r_}'))(r))
    return ws
