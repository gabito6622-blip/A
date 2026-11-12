from lib import *
from b1_supuestos import ROW

def _grid_table(ws, r_title, title, valfn, fmt=FMT_U, total='sum', weights=True):
    """Tabla años x trimestres al estilo Ñapefit. Devuelve fila de 2027."""
    put(ws, f'B{r_title}', title, 'label', bold=True)
    rw = r_title + 1
    put(ws, f'B{rw}', 'AÑOS / TRIMESTRES', 'hdr')
    for k in range(4): put(ws, f'{L(3+k)}{rw}', f"='Pronostico'!{L(3+k)}$35" if weights else QL[k], 'hdr', FMT_PCT if weights else None)
    put(ws, f'G{rw}', f'=SUM(C{rw}:F{rw})' if weights else 'TOTAL', 'hdr', FMT_PCT if weights else None)
    if weights:
        for k, t in enumerate(QL + ['TOTAL']): put(ws, f'{L(3+k)}{rw+1}', t, 'hdr')
        r0 = rw + 2
    else:
        r0 = rw + 1
    for y in range(1, 6):
        r = r0 + y - 1
        put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT)
        for k in range(4):
            q = 4 * (y - 1) + k + 1
            v = valfn(q)
            put(ws, f'{L(3+k)}{r}', v, 'link' if '!' in v else 'calc', fmt)
        if total == 'sum': put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', fmt, bold=True)
        elif total == 'min': put(ws, f'G{r}', f'=MIN(C{r}:F{r})', 'calc', fmt, bold=True)
        elif total == 'last': put(ws, f'G{r}', f'=F{r}', 'calc', fmt, bold=True)
        elif total == 'first': put(ws, f'G{r}', f'=C{r}', 'calc', fmt, bold=True)
    return r0

def build_inventario(B):
    ws = B.wb.create_sheet('Inventario')
    widths(ws, {'A': 4, 'B': 22, 'C': 12, 'D': 12, 'E': 12, 'F': 12, 'G': 12})
    s0 = 6
    ventas = lambda q: f"={Q('PRO.units', q)}"
    _grid_table(ws, 3, 'PROYECCION DE VENTAS EN CANTIDAD', ventas)
    S = grid(s0); I_ = grid(18); P_ = grid(28); F_ = grid(38)
    put(ws, 'D14', 'Stock de seguridad (% ventas del trim. siguiente)', 'label'); put(ws, 'E14', '=SS_PT', 'calc', FMT_PCT)
    nxt = lambda q: S(q + 1) if q < NQ else f'($G$10*($G$10/$G$9)*EST_T1)'
    _grid_table(ws, 15, 'INVENTARIO INICIAL', lambda q: '=INV_INI_PT' if q == 1 else f'={F_(q-1)}', total='first')
    _grid_table(ws, 25, 'PRODUCCIÓN', lambda q: f'=ROUNDUP(MAX(0,{S(q)}+$E$14*{nxt(q)}-{I_(q)}),0)')
    _grid_table(ws, 35, 'INVENTARIO FINAL', lambda q: f'={I_(q)}+{P_(q)}-{S(q)}', total='last')
    _grid_table(ws, 45, 'CONTROL: INVENTARIO FINAL NO NEGATIVO (1 = sí)', lambda q: f'=IF({F_(q)}>=-0.001,1,0)', fmt=FMT_INT, total='min')
    reg('INV.ventas', 'Inventario', q=S, y=lambda y: f'G{s0+y-1}')
    reg('INV.ini', 'Inventario', q=I_, y=lambda y: f'G{18+y-1}')
    reg('INV.prod', 'Inventario', q=P_, y=lambda y: f'G{28+y-1}')
    reg('INV.fin', 'Inventario', q=F_, y=lambda y: f'G{38+y-1}')
    reg('INV.ok', 'Inventario', q=grid(48), y=lambda y: f'G{48+y-1}')
    return ws

def build_inv_terminado(B):
    ws = B.wb.create_sheet('Inv. terminado')
    widths(ws, {'A': 4, 'B': 40})
    for q in range(1, NQ+1): ws.column_dimensions[L(2+q)].width = 11.5
    C = lambda q: L(2 + q)
    Q4 = ['1ERO', '2DO', '3ERO', '4TO']
    put(ws, 'B2', 'INVENTARIO PT EN CANTIDADES', 'label', bold=True)
    year_quarter_hdr(ws, 2, 3, labels=Q4); put(ws, 'B3', 'Detalle', 'hdr')
    put(ws, 'B4', 'Inventario inicial', 'label', border=True)
    put(ws, 'B5', 'Ventas', 'label', border=True)
    put(ws, 'B6', 'Inventario final', 'label', bold=True, border=True)
    put(ws, 'B7', '(+) Producción del trimestre (hoja Inventario)', 'label', border=True)
    for q in range(1, NQ+1):
        c = C(q)
        put(ws, f'{c}4', f"={Q('INV.ini', q)}", 'link', FMT_U)
        put(ws, f'{c}5', f"={Q('INV.ventas', q)}", 'link', FMT_U)
        put(ws, f'{c}7', f"={Q('INV.prod', q)}", 'link', FMT_U)
        put(ws, f'{c}6', f'={c}4+{c}7-{c}5', 'calc', FMT_U, bold=True)
    put(ws, 'B8', 'INVENTARIO PT EN $US', 'label', bold=True)
    year_quarter_hdr(ws, 8, 3, labels=Q4); put(ws, 'B9', 'Detalle', 'hdr')
    put(ws, 'B10', 'Inventario inicial', 'label', border=True)
    put(ws, 'B11', 'Ventas (costo de ventas)', 'label', bold=True, border=True)
    put(ws, 'B12', 'Inventario final', 'label', border=True)
    put(ws, 'B13', '(+) Costo de producción del trimestre (MP + gas)', 'label', border=True)
    put(ws, 'B14', 'TOTAL (1 FILTRO) $ - costo promedio', 'label', bold=True, border=True)
    for q in range(1, NQ+1):
        c = C(q)
        put(ws, f'{c}13', f"={Q('COM.consumo', q)}+{Q('COM.en_neto', q)}", 'link', FMT_BS2)
        put(ws, f'{c}10', '=0' if q == 1 else f'={C(q-1)}12', 'calc', FMT_BS2)
        put(ws, f'{c}14', f'=IF({c}4+{c}7>0,({c}10+{c}13)/({c}4+{c}7),0)', 'calc', FMT_BS2, bold=True)
        put(ws, f'{c}11', f'={c}5*{c}14', 'calc', FMT_BS2, bold=True)
        put(ws, f'{c}12', f'={c}10+{c}13-{c}11', 'calc', FMT_BS2)
    put(ws, 'B16', 'Inventario', 'label', bold=True)
    put(ws, 'B17', 'Año', 'hdr'); put(ws, 'B18', 'Detalle', 'hdr')
    for y in range(1, 6):
        a = L(1 + 2 * y); b = L(2 + 2 * y)
        put(ws, f'{a}17', 2026 + y, 'hdr'); ws[f'{b}17'].fill = FILL_HDR; ws[f'{b}17'].border = BORDER; ws.merge_cells(f'{a}17:{b}17')
        put(ws, f'{a}18', 'Cantidad unid.', 'hdr'); put(ws, f'{b}18', '$us', 'hdr')
        q1, q4 = 4 * y - 3, 4 * y
        put(ws, f'{a}19', f'={C(q1)}4', 'calc', FMT_U); put(ws, f'{b}19', f'={C(q1)}10', 'calc', FMT_BS2)
        put(ws, f'{a}20', f'=SUM({C(q1)}5:{C(q4)}5)', 'calc', FMT_U); put(ws, f'{b}20', f'=SUM({C(q1)}11:{C(q4)}11)', 'calc', FMT_BS2)
        put(ws, f'{a}21', f'={C(q4)}6', 'calc', FMT_U); put(ws, f'{b}21', f'={C(q4)}12', 'calc', FMT_BS2)
        put(ws, f'{a}22', f'=SUM({C(q1)}7:{C(q4)}7)', 'calc', FMT_U); put(ws, f'{b}22', f'=SUM({C(q1)}13:{C(q4)}13)', 'calc', FMT_BS2)
    for r, t in [(19, 'Inventario inicial'), (20, 'Ventas'), (21, 'Inventario final'), (22, '(+) Producción')]: put(ws, f'B{r}', t, 'label', border=True)
    put(ws, 'B24', 'COSTO VARIABLE DE PRODUCCIÓN (1 FILTRO) $', 'label', bold=True, border=True); put(ws, 'D24', '=CVP_KIT_NETO/TIPO_CAMBIO', 'calc', FMT_BS2)
    reg('INV.cv', 'Inv. terminado', q=lambda q: f'{C(q)}11', y=lambda y: f'{L(2+2*y)}20')
    reg('INV.finbs', 'Inv. terminado', q=lambda q: f'{C(q)}12', y=lambda y: f'{L(2+2*y)}21')
    reg('INV.finq', 'Inv. terminado', q=lambda q: f'{C(q)}6')
    ws.freeze_panes = 'C4'
    return ws

MATS = [  # nombre, unidad, cantidad por filtro, merma(1/0), compra: cantidad, unidad, precio, moneda, proveedor
    ('Arcilla roja (molida y tamizada)', 'kg', 5.0, 1, 1, 'kg', 0.40, 'Bs', 'Ladrilleras o canteras de la zona'),
    ('Aserrín o cascarilla de arroz', 'kg', 0.6, 1, 1, 'kg', 0.50, 'Bs', 'Aserraderos o arroceras'),
    ('Plata coloidal 3,2% (importada)', 'ml', 2.0, 1, 1, 'ml', 0.10, 'USD', 'Importador de insumos químicos'),
    ('Carbón activado de cáscara de castaña', 'kg', 0.15, 0, 1, 'kg', 30.0, 'Bs', 'Beneficiadoras de castaña'),
    ('Balde plástico 20 L con tapa', 'unidad', 1.0, 0, 1, 'unidad', 55.0, 'Bs', 'Fábricas de plástico de Santa Cruz'),
    ('Grifo plástico (importado)', 'unidad', 1.0, 0, 1, 'unidad', 1.00, 'USD', 'Importadora de accesorios'),
    ('Indicador de cambio (cinta en la tapa)', 'unidad', 1.0, 0, 1, 'unidad', 4.0, 'Bs', 'Proveedor de etiquetas'),
    ('Empaque: caja, manual y etiqueta con QR', 'unidad', 1.0, 0, 1, 'unidad', 14.5, 'Bs', 'Imprenta'),
    ('Gas para el horno', 'filtro', 1.0, 1, 1, 'filtro', 6.0, 'Bs', 'Distribuidora de gas'),
]

def build_mp(B):
    ws = B.wb.create_sheet('MP')
    widths(ws, {'A': 4, 'B': 42, 'C': 4, 'D': 13, 'E': 9, 'F': 13, 'G': 9, 'H': 14, 'I': 12, 'J': 34})
    put(ws, 'B2', 'MATERIA PRIMA BASE (1 FILTRO 2.0)', 'label', bold=True)
    for c, h in [('B', 'Detalle'), ('D', 'Cantidad por filtro'), ('E', 'Unidad'), ('F', 'Con merma (10%)'), ('G', 'Unidad'), ('H', 'Aplica merma (1/0)')]: put(ws, f'{c}3', h, 'hdr')
    for i, m in enumerate(MATS):
        r = 4 + i
        put(ws, f'B{r}', m[0], 'label', border=True); put(ws, f'D{r}', m[2], 'input', FMT_BS2); put(ws, f'E{r}', m[1], 'label', border=True)
        put(ws, f'F{r}', f'=D{r}*(1+MERMA*H{r})', 'calc', '#,##0.000'); put(ws, f'G{r}', m[1], 'label', border=True); put(ws, f'H{r}', m[3], 'input', FMT_INT)
    put(ws, 'B18', 'COSTO DE MATERIA PRIMA', 'label', bold=True)
    for c, h in [('B', 'Detalle'), ('D', 'Cantidad de compra'), ('E', 'Unidad'), ('F', 'Precio de compra'), ('G', 'Moneda'), ('H', 'Costo por filtro (Bs)'), ('I', 'Unidad'), ('J', 'Proveedor')]: put(ws, f'{c}19', h, 'hdr')
    for i, m in enumerate(MATS):
        r = 20 + i; rq = 4 + i
        put(ws, f'B{r}', m[0], 'label', border=True); put(ws, f'D{r}', m[4], 'input', FMT_BS2); put(ws, f'E{r}', m[5], 'label', border=True)
        put(ws, f'F{r}', m[6], 'input', FMT_BS2); put(ws, f'G{r}', 'USD' if m[7] == 'USD' else 'Bs', 'input')
        put(ws, f'H{r}', f'=F{r}*IF(G{r}="USD",TIPO_CAMBIO,1)*F{rq}/D{r}', 'calc', FMT_BS2); put(ws, f'I{r}', 'Bs/filtro', 'label', border=True)
        put(ws, f'J{r}', m[8], 'label', border=True)
    n = len(MATS); rt = 20 + n
    put(ws, f'B{rt}', 'TOTAL', 'label', bold=True, border=True); put(ws, f'H{rt}', f'=SUM(H20:H{rt-1})', 'calc', FMT_BS2, bold=True)
    put(ws, 'B37', 'COSTOS DE MATERIA PRIMA BASE (1 filtro)', 'label', bold=True)
    for c, h in [('B', 'Detalle'), ('D', 'Bs'), ('E', '$'), ('F', 'Bs sin IVA')]: put(ws, f'{c}38', h, 'hdr')
    for i, m in enumerate(MATS):
        r = 39 + i
        put(ws, f'B{r}', m[0], 'label', border=True); put(ws, f'D{r}', f'=H{20+i}', 'calc', FMT_BS2)
        put(ws, f'E{r}', f'=D{r}/TIPO_CAMBIO', 'calc', FMT_BS2); put(ws, f'F{r}', f'=D{r}*(1-TASA_IVA)', 'calc', FMT_BS2)
    rT = 39 + n
    put(ws, f'B{rT}', 'TOTAL', 'label', bold=True, border=True)
    for c in 'DEF': put(ws, f'{c}{rT}', f'=SUM({c}39:{c}{rT-1})', 'calc', FMT_BS2, bold=True)
    rg = 39 + n - 1  # fila del gas
    B.name('MP_KIT_CF', 'MP', f'D{rT+2}'); B.name('MP_KIT_NETO', 'MP', f'F{rT+2}')
    put(ws, f'B{rT+2}', 'Materia prima por filtro (sin gas)', 'label', border=True)
    put(ws, f'D{rT+2}', f'=SUM(D39:D{rg-1})', 'calc', FMT_BS2); put(ws, f'E{rT+2}', f'=D{rT+2}/TIPO_CAMBIO', 'calc', FMT_BS2); put(ws, f'F{rT+2}', f'=SUM(F39:F{rg-1})', 'calc', FMT_BS2)
    put(ws, f'B{rT+3}', 'Gas por filtro', 'label', border=True)
    put(ws, f'D{rT+3}', f'=D{rg}', 'calc', FMT_BS2); put(ws, f'E{rT+3}', f'=D{rT+3}/TIPO_CAMBIO', 'calc', FMT_BS2); put(ws, f'F{rT+3}', f'=F{rg}', 'calc', FMT_BS2)
    B.name('ENERGIA_KIT_CF', 'MP', f'D{rT+3}'); B.name('ENERGIA_KIT_NETO', 'MP', f'F{rT+3}')
    B.name('CVP_KIT_NETO', 'MP', f'F{rT}')
    put(ws, f'B{rT+4}', 'Kg de mezcla de barro por filtro (arcilla + aserrín)', 'label', border=True); put(ws, f'D{rT+4}', '=F4+F5', 'calc', '#,##0.000')
    B.name('KG_FILTRO', 'MP', f'D{rT+4}')
    ROW['MP.n'] = n; ROW['MP.qrow0'] = 4; ROW['MP.crow0'] = 20
    r = rT + 7
    put(ws, f'B{r}', 'PROVEEDORES', 'label', bold=True); r += 1
    for c, h in [('B', 'Insumo'), ('D', 'Tipo de proveedor'), ('H', 'Criterio'), ('J', 'Estado')]: put(ws, f'{c}{r}', h, 'hdr')
    r += 1
    for a, b, c in [('Arcilla y aserrín', 'Canteras, ladrilleras, aserraderos', 'Limpieza y precio'), ('Cáscara de castaña', 'Beneficiadoras de castaña', 'Contrato de exclusividad'),
                    ('Plata coloidal y grifo', 'Importadores', 'Certificado y plazo'), ('Balde, indicador y empaque', 'Fábricas e imprentas locales', 'Precio por volumen'), ('Gas', 'Distribuidora', 'Disponibilidad')]:
        put(ws, f'B{r}', a, 'label', border=True); put(ws, f'D{r}', b, 'label', border=True); put(ws, f'H{r}', c, 'label', border=True); put(ws, f'J{r}', 'Por cotizar', 'label', border=True); r += 1
    return ws

STAGES = [('Molienda y tamizado', 120, 'kg/hora', 'kg_h'), ('Mezclado y amasado', 100, 'kg/hora', 'kg_h'), ('Prensado', 10, 'filtros/hora', 'u_h'),
          ('Secado al aire (400 filtros / 8 días)', 50, 'filtros/día', 'u_dia'), ('Cocción en horno (50 por cocción)', 50, 'filtros/día', 'u_dia'),
          ('Prueba de caudal (30 estaciones)', 60, 'filtros/día', 'u_dia'), ('Capa de carbón y ensamblaje', 15, 'filtros/hora', 'u_h')]

def build_capacidad(B):
    ws = B.wb.create_sheet('Capacidad Inst.')
    widths(ws, {'A': 4, 'B': 36, 'C': 6, 'D': 10, 'E': 11, 'F': 12, 'G': 11, 'H': 11, 'I': 11, 'J': 8, 'K': 11, 'L': 11, 'M': 12, 'N': 12, 'O': 12, 'P': 12, 'Q': 10, 'R': 10})
    put(ws, 'B2', 'Mezcla por filtro', 'label'); put(ws, 'D2', '=KG_FILTRO*1000', 'calc', FMT_U); put(ws, 'E2', 'gr', 'label')
    put(ws, 'D3', '=KG_FILTRO', 'calc', '#,##0.000'); put(ws, 'E3', 'kg', 'label')
    put(ws, 'I2', 'Horas de ocio', 'label'); put(ws, 'I3', '=HORAS_OCIO', 'calc', FMT_INT); put(ws, 'J3', 'horas', 'label')
    put(ws, 'I4', 'Horas productivas del personal', 'label'); put(ws, 'I5', '=HORAS_TURNO-HORAS_OCIO', 'calc', FMT_INT); put(ws, 'J5', 'horas', 'label')
    put(ws, 'K5', 'CAP. PRODUCTIVA', 'label', bold=True); put(ws, 'M5', 'CAP. INSTALADA', 'label', bold=True)
    for c, h in [('B', 'Detalle'), ('E', 'Capacidad por máquina'), ('F', 'Unidad'), ('G', 'Capacidad (filtros/hora)'), ('I', 'Horas productivas'), ('K', 'Producción diaria'), ('M', 'Producción trimestral'), ('O', 'Producción anual')]:
        put(ws, f'{c}6', h, 'hdr')
    ws.row_dimensions[6].height = 32
    for i, (e, cap, u, t) in enumerate(STAGES):
        r = 7 + i
        put(ws, f'B{r}', e, 'label', border=True); put(ws, f'E{r}', cap, 'input', FMT_BS); put(ws, f'F{r}', u, 'label', border=True)
        if t == 'kg_h': put(ws, f'G{r}', f'=E{r}/$D$3', 'calc', FMT_BS2)
        elif t == 'u_h': put(ws, f'G{r}', f'=E{r}', 'calc', FMT_BS2)
        if t in ('kg_h', 'u_h'): put(ws, f'H{r}', 'filtros/hora', 'label')
        if t == 'u_dia':
            put(ws, f'K{r}', f'=E{r}', 'calc', FMT_U)
        else:
            put(ws, f'I{r}', '=$I$5', 'calc', FMT_BS2); put(ws, f'J{r}', 'Horas', 'label'); put(ws, f'K{r}', f'=G{r}*I{r}', 'calc', FMT_U)
        put(ws, f'L{r}', 'filtros/día', 'label'); put(ws, f'M{r}', f'=K{r}*DIAS_TRIM', 'calc', FMT_U); put(ws, f'N{r}', 'filtros/trim', 'label')
        put(ws, f'O{r}', f'=M{r}*4', 'calc', FMT_U); put(ws, f'P{r}', 'filtros/año', 'label')
    rl = 7 + len(STAGES) - 1
    put(ws, f'I{rl+1}', '=SUM(I7:I' + str(rl) + ')', 'calc', FMT_BS2)
    # cuello de botella (a la derecha)
    put(ws, 'R5', 'CAPACIDAD INSTALADA', 'hdr'); ws.merge_cells('R5:S5')
    put(ws, 'R6', 'Etapa más lenta (cuello de botella)', 'label', border=True, wrap=True); put(ws, 'S6', f'=INDEX(B7:B{rl},MATCH(MIN(K7:K{rl}),K7:K{rl},0))', 'calc', wrap=True)
    put(ws, 'R7', 'Producción diaria', 'label', border=True); put(ws, 'S7', f'=MIN(K7:K{rl})', 'calc', FMT_U, bold=True)
    put(ws, 'R8', 'Producción trimestral', 'label', border=True); put(ws, 'S8', f'=MIN(M7:M{rl})', 'calc', FMT_U, bold=True)
    put(ws, 'R9', 'Producción anual', 'label', border=True); put(ws, 'S9', f'=MIN(O7:O{rl})', 'calc', FMT_U, bold=True)
    widths(ws, {'R': 22, 'S': 20})
    ws.row_dimensions[6].height = 45
    B.name('CAP_TRIM', 'Capacidad Inst.', 'S8'); B.name('CAP_ANUAL', 'Capacidad Inst.', 'S9')
    # producción y utilización (como Ñapefit: tabla de unidades a la izquierda y % a la derecha)
    r0 = 14
    put(ws, 'B14', 'PRODUCCIÓN PLANIFICADA', 'label', bold=True); put(ws, 'J14', 'CAPACIDAD UTILIZADA', 'label', bold=True)
    put(ws, 'B15', 'AÑOS / TRIMESTRES', 'hdr'); put(ws, 'J15', 'AÑOS / TRIMESTRES', 'hdr')
    for k, t in enumerate(QL + ['TOTAL']):
        put(ws, f'{L(3+k)}15', t, 'hdr'); put(ws, f'{L(14+k)}16', t, 'hdr')
    for k in range(4):
        put(ws, f'{L(3+k)}16', f'=EST_T{k+1}', 'calc', FMT_PCT); put(ws, f'{L(14+k)}15', f'={L(3+k)}16', 'calc', FMT_PCT)
    put(ws, 'G16', '=SUM(C16:F16)', 'calc', FMT_PCT); put(ws, 'R15', '=G16', 'calc', FMT_PCT)
    for y in range(1, 6):
        r = 16 + y
        put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT); put(ws, f'J{r}', 2026 + y, 'calc', FMT_INT)
        for k in range(4):
            q = 4 * (y - 1) + k + 1
            put(ws, f'{L(3+k)}{r}', f"={Q('INV.prod', q)}", 'link', FMT_U)
            put(ws, f'{L(14+k)}{r}', f'={L(3+k)}{r}/CAP_TRIM', 'calc', FMT_PCT)
        put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', FMT_U, bold=True); put(ws, f'R{r}', f'=G{r}/CAP_ANUAL', 'calc', FMT_PCT, bold=True)
    reg('CAP.util', 'Capacidad Inst.', y=lambda y: f'R{16+y}')
    r1 = 24
    put(ws, f'B{r1}', 'CAPACIDAD DE LA MANO DE OBRA (operarios x filtros por día x días)', 'label', bold=True)
    put(ws, f'J{r1}', 'CONTROL: ¿LA PRODUCCIÓN CABE? (1 = sí)', 'label', bold=True)
    put(ws, f'B{r1+1}', 'AÑOS / TRIMESTRES', 'hdr'); put(ws, f'J{r1+1}', 'AÑOS / TRIMESTRES', 'hdr')
    for k, t in enumerate(QL + ['TOTAL']):
        put(ws, f'{L(3+k)}{r1+1}', t, 'hdr'); put(ws, f'{L(14+k)}{r1+1}', t if t != 'TOTAL' else 'MÍNIMO', 'hdr')
    for y in range(1, 6):
        r = r1 + 1 + y; rp = 16 + y
        put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT); put(ws, f'J{r}', 2026 + y, 'calc', FMT_INT)
        for k in range(4):
            put(ws, f'{L(3+k)}{r}', f"={Y('PER.ops', y)}*PROD_OPERARIO*DIAS_TRIM", 'link', FMT_U)
            put(ws, f'{L(14+k)}{r}', f'=IF({L(3+k)}{rp}<=MIN(CAP_TRIM,{L(3+k)}{r})+0.5,1,0)', 'calc', FMT_INT)
        put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', FMT_U, bold=True); put(ws, f'R{r}', f'=MIN(N{r}:Q{r})', 'calc', FMT_INT, bold=True)
    reg('CAP.ok', 'Capacidad Inst.', q=grid(r1 + 2, 14), y=lambda y: f'R{r1+1+y}')
    return ws

def build_infraestructura(B):
    ws = B.wb.create_sheet('Infraestructura')
    widths(ws, {'A': 12, 'B': 30, 'J': 34.1, 'K': 6, 'L': 12, 'M': 12, 'N': 12, 'O': 3, 'P': 30, 'Q': 15.5, 'R': 60})
    put(ws, 'J2', 'Análisis de Ponderación de Criterios', 'label', bold=True); put(ws, 'M2', 'Puntuación', 'label'); put(ws, 'N2', '1 al 5', 'label')
    for c, h in [('J', 'CRITERIO'), ('K', 'PESO'), ('L', 'LOCAL 1'), ('M', 'LOCAL 2'), ('N', 'LOCAL 3')]: put(ws, f'{c}4', h, 'hdr')
    crit = [('Ubicación', 4, [4, 4, 3]), ('Costo del Alquiler', 5, [3, 4, 5]), ('Espacio para secado', 4, [4, 3, 5]), ('Gas y servicios básicos', 3, [5, 4, 4]), ('Cercanía a la arcilla', 2, [3, 3, 4])]
    for i, (c, w, s) in enumerate(crit):
        r = 5 + i
        put(ws, f'J{r}', c, 'label', border=True); put(ws, f'K{r}', w, 'input', FMT_INT)
        for j, v in enumerate(s): put(ws, f'{L(12+j)}{r}', v, 'input', FMT_INT)
    put(ws, 'J10', 'TOTAL', 'label', bold=True, border=True)
    for j in range(3): put(ws, f'{L(12+j)}10', f'=SUMPRODUCT($K$5:$K$9,{L(12+j)}5:{L(12+j)}9)', 'calc', FMT_INT, bold=True)
    put(ws, 'J11', '="Conclusión: el "&INDEX(L4:N4,MATCH(MAX(L10:N10),L10:N10,0))&" es la mejor opción"', 'calc', bold=True)
    put(ws, 'P4', 'PUESTA EN MARCHA (3 MESES)', 'label', bold=True)
    for c, h in [('P', 'Etapa'), ('Q', 'Tiempo Estimado'), ('R', 'Descripción')]: put(ws, f'{c}5', h, 'hdr')
    st = [('1. Búsqueda de local', '2 semanas', 'Galpón con patio de secado, gas y agua.'), ('2. Permisos y licencias', '1 mes', 'FUNDEMPRESA, NIT, licencia municipal.'),
          ('3. Fabricación e importación de equipos', '4 semanas', 'Horno y estanterías en talleres locales; prensa, molino y laboratorio importados.'),
          ('4. Instalación de equipos', '2 semanas', 'Instalación de gas, ventilación y piso; calibración del horno.'),
          ('5. Contratación y capacitación', '3 semanas', 'Jefe de producción y operarios; prensado, cocción y pruebas.'),
          ('6. Lote piloto y laboratorio', '4 semanas', 'Lote piloto; análisis de bacterias y de la capa de carbón.'), ('7. Lanzamiento', '2 semanas', 'Publicidad de lanzamiento y acuerdos con tiendas.')]
    for i, (a, b, c) in enumerate(st):
        put(ws, f'P{6+i}', a, 'label', border=True); put(ws, f'Q{6+i}', b, 'label', border=True); put(ws, f'R{6+i}', c, 'label', border=True)
    locs = [(13, 'LOCAL 1', 'Zona industrial norte: buen acceso a la ciudad y gas natural; alquiler medio.'),
            (27, 'LOCAL 2', 'Zona sur (Plan 3000): cerca de muchos clientes; patio más chico.'),
            (41, 'LOCAL 3', 'Municipio vecino (Warnes): alquiler más barato y patio grande; más lejos de los clientes.')]
    for r, a, b in locs:
        put(ws, f'A{r}', a, 'label', bold=True); put(ws, f'B{r}', b, 'label', wrap=True); ws.merge_cells(f'B{r}:H{r+1}')
    put(ws, 'J13', 'MAQUINARIAS', 'label', bold=True)
    for i, t in enumerate(['Máquina 1: Horno a gas de 1 m³', 'Máquina 2: Prensa hidráulica con moldes', 'Máquina 3: Molino de martillos', 'Máquina 4: Amasadora de arcilla',
                           'Máquina 5: Tamizadora vibratoria', 'Máquina 6: Estaciones de prueba de caudal', 'Máquina 7: Mesa dosificadora de carbón']):
        put(ws, f'J{14+i}', t, 'label')
    return ws

def build_compras(B):
    ws = B.wb.create_sheet('Compras')
    widths(ws, {'A': 4, 'B': 34, 'C': 8})
    for q in range(1, NQ+1): ws.column_dimensions[qc(q)].width = 12
    n = ROW['MP.n']; qr0 = ROW['MP.qrow0']; cr0 = ROW['MP.crow0']
    nm = n - 1  # materiales (sin gas)
    # A) producción por año y trimestre
    put(ws, 'B2', 'PRODUCCIÓN PLANIFICADA (filtros)', 'label', bold=True)
    put(ws, 'B3', 'AÑOS / TRIMESTRES', 'hdr')
    for k, t in enumerate(QL + ['TOTAL']): put(ws, f'{L(3+k)}4', t, 'hdr')
    for k in range(4): put(ws, f'{L(3+k)}3', f"='Pronostico'!{L(3+k)}$35", 'hdr', FMT_PCT)
    put(ws, 'G3', '=SUM(C3:F3)', 'hdr', FMT_PCT)
    for y in range(1, 6):
        r = 5 + y
        put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT)
        for k in range(4): put(ws, f'{L(3+k)}{r}', f"={Q('INV.prod', 4*(y-1)+k+1)}", 'link', FMT_U)
        put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', FMT_U, bold=True)
    # B) materia prima por filtro (I..N) y C) costo por filtro (P..W)
    put(ws, 'I2', 'MATERIA PRIMA BASE (1 FILTRO)', 'label', bold=True); put(ws, 'P2', 'COSTO DE MATERIA PRIMA PARA PRODUCIR UN FILTRO', 'label', bold=True)
    for c, h in [('I', 'Detalle'), ('K', 'Cantidad'), ('L', 'Unidad')]: put(ws, f'{c}3', h, 'hdr')
    for c, h in [('P', 'Detalle'), ('R', 'Bs/filtro'), ('T', '$/filtro'), ('V', '$ sin IVA')]: put(ws, f'{c}3', h, 'hdr')
    for i in range(nm):
        r = 4 + i
        put(ws, f'I{r}', f"='MP'!B{qr0+i}", 'link'); put(ws, f'K{r}', f"='MP'!F{qr0+i}", 'link', '#,##0.000'); put(ws, f'L{r}', f"='MP'!E{qr0+i}", 'link')
        put(ws, f'P{r}', f"='MP'!B{cr0+i}", 'link'); put(ws, f'R{r}', f"='MP'!H{cr0+i}", 'link', FMT_BS2)
        put(ws, f'T{r}', f'=R{r}/TIPO_CAMBIO', 'calc', FMT_BS2); put(ws, f'V{r}', f'=T{r}*(1-TASA_IVA)', 'calc', FMT_BS2)
        put(ws, f'N{r}', 'por filtro', 'label'); put(ws, f'S{r}', 'Bs', 'label'); put(ws, f'U{r}', '$us', 'label'); put(ws, f'W{r}', '$us', 'label')
    rt = 4 + nm
    put(ws, f'P{rt}', 'TOTAL', 'label', bold=True, border=True)
    for c in 'RTV': put(ws, f'{c}{rt}', f'=SUM({c}4:{c}{rt-1})', 'calc', FMT_BS2, bold=True)
    def qline(r, lbl, fn, fmt=FMT_U, bold=False):
        if lbl is not None: put(ws, f'B{r}', lbl, 'label', bold=bold, border=True)
        for q in range(1, NQ+1):
            v = fn(q); put(ws, f'{qc(q)}{r}', v, 'link' if '!' in v else 'calc', fmt, bold=bold)
    def ybar(r, title, c1='B', c2='W'):
        put(ws, f'{c1}{r}', title, 'bar'); ws.merge_cells(f'{c1}{r}:{c2}{r+1}')
    def tbl_hdr(r, title, sub):
        put(ws, f'B{r}', title, 'hdr'); ws.merge_cells(f'B{r}:C{r}')
        put(ws, f'B{r+1}', sub, 'hdr'); ws.merge_cells(f'B{r+1}:C{r+1}')
        for y in range(1, 6):
            a = qc(4*y-3); put(ws, f'{a}{r}', 2026 + y, 'hdr')
            for k in range(4):
                put(ws, f'{qc(4*y-3+k)}{r+1}', ['1ERO', '2DO', '3ERO', '4TO'][k], 'hdr')
                if k: ws[f'{qc(4*y-3+k)}{r}'].fill = FILL_HDR; ws[f'{qc(4*y-3+k)}{r}'].border = BORDER
            ws.merge_cells(f'{a}{r}:{qc(4*y)}{r}')
    # D) producción en línea de tiempo (B18, como Ñapefit)
    ybar(18, 'PRODUCCIÓN PLANIFICADA POR TRIMESTRE (filtros)', 'B', 'U')
    for y in range(1, 6):
        a = L(2 + 4*(y-1)); put(ws, f'{a}20', 2026 + y, 'hdr')
        for k in range(4):
            c = L(2 + 4*(y-1) + k); put(ws, f'{c}21', QL[k], 'hdr')
            if k: ws[f'{c}20'].fill = FILL_HDR; ws[f'{c}20'].border = BORDER
            put(ws, f'{c}22', f"={Q('INV.prod', 4*(y-1)+k+1)}", 'link', FMT_U)
        ws.merge_cells(f'{a}20:{L(5 + 4*(y-1))}20')
    ybar(24, 'COMPRAS E INVENTARIO DE MATERIA PRIMA (1 juego = materiales para 1 filtro)')
    RC = 75  # fila de compras (juegos)
    # F) materia prima en cantidad (B27)
    tbl_hdr(27, 'MATERIA PRIMA EN CANTIDAD', 'COMPRAS DEL TRIMESTRE')
    for i in range(nm):
        qline(29 + i, None, lambda q, i=i: f'={qc(q)}${RC}*$K${4+i}', '#,##0.0')
        put(ws, f'B{29+i}', f'=I{4+i}', 'link', border=True); ws.merge_cells(f'B{29+i}:C{29+i}')
    # G) materia prima en $us (B42)
    tbl_hdr(42, 'MATERIA PRIMA EN $US', 'COMPRAS CON FACTURA')
    m0 = 44
    for i in range(nm):
        qline(m0 + i, None, lambda q, i=i: f"={qc(q)}${RC}*$T${4+i}*'Calendario'!{qc(q)}$11*M_CVAR", FMT_BS2)
        put(ws, f'B{m0+i}', f'=P{4+i}', 'link', border=True); ws.merge_cells(f'B{m0+i}:C{m0+i}')
    rtot = m0 + nm
    put(ws, f'B{rtot}', 'COSTO TOTAL DE MP', 'label', bold=True, border=True); ws.merge_cells(f'B{rtot}:C{rtot}')
    qline(rtot, None, lambda q: f'=SUM({qc(q)}{m0}:{qc(q)}{rtot-1})', FMT_BS2, bold=True)
    # H) programa de compras anual (B55)
    rp = 55
    put(ws, f'B{rp}', 'PROGRAMA DE COMPRAS', 'hdr'); ws.merge_cells(f'B{rp}:C{rp}')
    for y in range(1, 6):
        a = L(2 + 2 * y); b = L(3 + 2 * y)
        put(ws, f'{a}{rp}', 2026 + y, 'hdr'); ws[f'{b}{rp}'].fill = FILL_HDR; ws[f'{b}{rp}'].border = BORDER; ws.merge_cells(f'{a}{rp}:{b}{rp}')
        put(ws, f'{a}{rp+1}', 'Q', 'hdr'); put(ws, f'{b}{rp+1}', '$us', 'hdr')
    put(ws, f'B{rp+1}', 'Detalle', 'hdr'); ws.merge_cells(f'B{rp+1}:C{rp+1}')
    for i in range(nm):
        r = rp + 2 + i
        put(ws, f'B{r}', f'=I{4+i}', 'link', border=True); ws.merge_cells(f'B{r}:C{r}')
        for y in range(1, 6):
            a = L(2 + 2 * y); b = L(3 + 2 * y); q1, q4 = qc(4*y-3), qc(4*y)
            put(ws, f'{a}{r}', f'=SUM({q1}{29+i}:{q4}{29+i})', 'calc', '#,##0.0'); put(ws, f'{b}{r}', f'=SUM({q1}{m0+i}:{q4}{m0+i})', 'calc', FMT_BS2)
    rr = rp + 2 + nm
    put(ws, f'B{rr}', 'TOTAL', 'label', bold=True, border=True); ws.merge_cells(f'B{rr}:C{rr}')
    for y in range(1, 6):
        b = L(3 + 2 * y); put(ws, f'{b}{rr}', f'=SUM({b}{rp+2}:{b}{rr-1})', 'calc', FMT_BS2, bold=True)
    # E) cálculo de las compras (juegos) - apoyo
    put(ws, 'B68', 'CÁLCULO DE LAS COMPRAS (juegos de materiales)', 'label', bold=True)
    year_quarter_hdr(ws, 69, 4); put(ws, 'B70', 'Detalle', 'hdr')
    nxt20 = f"'Pronostico'!$G${ROW['PRO.u0']+4}*('Pronostico'!$G${ROW['PRO.u0']+4}/'Pronostico'!$G${ROW['PRO.u0']+3})*EST_T1"
    qline(71, 'Necesidad (= producción)', lambda q: f'={L(1+q)}22')
    qline(72, 'Necesidad del trimestre siguiente', lambda q: f'={qc(q+1)}71' if q < NQ else f'={nxt20}')
    qline(73, 'Stock final deseado (1 mes)', lambda q: f'=STOCK_MP*{qc(q)}72')
    qline(74, 'Inventario inicial', lambda q: '=0' if q == 1 else f'={qc(q-1)}76')
    qline(RC, 'COMPRAS (juegos)', lambda q: f'=ROUNDUP(MAX(0,{qc(q)}71+{qc(q)}73-{qc(q)}74),0)', bold=True)
    qline(76, 'Inventario final', lambda q: f'={qc(q)}74+{qc(q)}75-{qc(q)}71')
    qline(77, 'Control: inventario final no negativo (1 = sí)', lambda q: f'=IF({qc(q)}76>=-0.001,1,0)', FMT_INT)
    # valorización
    put(ws, 'B79', 'VALORIZACIÓN DEL INVENTARIO DE MATERIA PRIMA ($us, promedio ponderado)', 'label', bold=True)
    year_quarter_hdr(ws, 80, 4); put(ws, 'B81', 'Detalle', 'hdr')
    qline(82, 'Compras sin IVA (al inventario)', lambda q: f'={qc(q)}{rtot}*(1-TASA_IVA)', FMT_BS2)
    qline(83, 'IVA crédito fiscal de compras', lambda q: f'={qc(q)}{rtot}-{qc(q)}82', FMT_BS2)
    qline(84, 'Inventario inicial valorizado', lambda q: '=0' if q == 1 else f'={qc(q-1)}87', FMT_BS2)
    qline(85, 'Costo promedio por juego', lambda q: f'=IF({qc(q)}74+{qc(q)}75>0,({qc(q)}84+{qc(q)}82)/({qc(q)}74+{qc(q)}75),0)', FMT_BS2)
    qline(86, 'Materia prima consumida en producción', lambda q: f'={qc(q)}71*{qc(q)}85', FMT_BS2)
    qline(87, 'Inventario final valorizado', lambda q: f'={qc(q)}84+{qc(q)}82-{qc(q)}86', FMT_BS2)
    rg = 89
    put(ws, f'B{rg}', 'GAS PARA EL HORNO ($us)', 'label', bold=True)
    year_quarter_hdr(ws, rg + 1, 4); put(ws, f'B{rg+2}', 'Detalle', 'hdr')
    qline(rg + 3, 'Gas con factura (pago)', lambda q: f"={qc(q)}71*ENERGIA_KIT_CF/TIPO_CAMBIO*'Calendario'!{qc(q)}$11*M_CVAR", FMT_BS2)
    qline(rg + 4, 'Gas sin IVA (al costo de producción)', lambda q: f"={qc(q)}71*ENERGIA_KIT_NETO/TIPO_CAMBIO*'Calendario'!{qc(q)}$11*M_CVAR", FMT_BS2)
    qline(rg + 5, 'IVA crédito fiscal del gas', lambda q: f'={qc(q)}{rg+3}-{qc(q)}{rg+4}', FMT_BS2)
    Qrow = lambda r: (lambda q: f'{qc(q)}{r}')
    reg('COM.compras', 'Compras', q=Qrow(RC)); reg('COM.fin', 'Compras', q=Qrow(76)); reg('COM.ok', 'Compras', q=Qrow(77))
    reg('COM.pago', 'Compras', q=Qrow(rtot)); reg('COM.neto', 'Compras', q=Qrow(82)); reg('COM.iva', 'Compras', q=Qrow(83))
    reg('COM.consumo', 'Compras', q=Qrow(86)); reg('COM.finbs', 'Compras', q=Qrow(87))
    reg('COM.en_pago', 'Compras', q=Qrow(rg+3)); reg('COM.en_neto', 'Compras', q=Qrow(rg+4)); reg('COM.en_iva', 'Compras', q=Qrow(rg+5))
    ROW['COM.m0'] = m0; ROW['COM.rtot'] = rtot; ROW['COM.anual_tot'] = rr
    return ws
