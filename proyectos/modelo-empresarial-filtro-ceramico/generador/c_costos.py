from lib import *
from b1_supuestos import ROW

C2q = lambda q: L(2 + q)   # columnas C..V (como Ñapefit)

GROUPS = [  # titulo, subtitulo, tasa, área, items: (detalle, cant, moneda, costo unit, trimestre compra)
    ('Depreciación de maquinaria y equipo', 'Activos fijos para el área de producción', 0.125, 'FAB', [
        ('Horno a gas de 1 m³ (fabricación local)', 1, 'Bs', 45000, 0), ('Prensa hidráulica con 2 juegos de moldes', 1, 'USD', 3900, 0),
        ('Molino de martillos', 1, 'USD', 1500, 0), ('Amasadora de arcilla', 1, 'USD', 1800, 0), ('Tamizadora vibratoria', 1, 'USD', 500, 0),
        ('Estanterías y bandejas de secado', 1, 'Bs', 8000, 0), ('Estaciones de prueba de caudal', 30, 'Bs', 200, 0),
        ('Equipo de laboratorio (turbidímetro, pirómetro, incubadora)', 1, 'USD', 1800, 0), ('Mesa dosificadora para la capa de carbón', 1, 'Bs', 3500, 0)]),
    ('Depreciación de muebles y enseres', 'Activos fijos para el área de oficina administrativa', 0.10, 'ADM', [('Escritorios y sillas', 1, 'Bs', 5000, 0), ('Archiveros y estanterías', 1, 'Bs', 1800, 0), ('Mesa de reuniones', 1, 'Bs', 1200, 0)]),
    ('Depreciación de equipos de computación', 'Activos fijos para el área de oficina administrativa', 0.25, 'ADM', [
        ('Computadoras', 3, 'USD', 540, 0), ('Impresora multifunción', 1, 'USD', 210, 0),
        ('Reposición de computadoras (2031)', 3, 'USD', 540, 17), ('Reposición de impresora (2031)', 1, 'USD', 210, 17)]),
    ('Depreciación de herramientas', 'Herramientas de producción', 0.25, 'FAB', [
        ('Herramientas y carretillas', 1, 'Bs', 6000, 0), ('Reposición de herramientas (2031)', 1, 'Bs', "=6000*'Calendario'!AC11", 17)]),
]

def build_maquinaria(B):
    ws = B.wb.create_sheet('Maqu. y equip.')
    widths(ws, {'A': 4, 'B': 52, 'C': 10, 'D': 13.5, 'E': 13, 'F': 11, 'G': 12, 'H': 11, 'I': 11, 'J': 9, 'K': 12, 'L': 13})
    for q in range(1, NQ+1): ws.column_dimensions[C2q(q)].width = max(ws.column_dimensions[C2q(q)].width or 0, 11)
    hd = ['Detalle', 'Cantidad', 'Costo Unitario', 'Costo total', 'IVA', 'Precio neto', 'Dpc. Anual', 'Dpc. Trim', 'Moneda', 'Trimestre de compra', 'Costo total (Bs)']
    r = 2; items = []; grp_rows = []
    for gi, (tit, sub, rate, area, its) in enumerate(GROUPS):
        put(ws, f'B{r}', tit, 'label', bold=True); put(ws, f'C{r}', rate, 'input', FMT_PCT)
        if gi == 0: put(ws, f'E{r}', 'PRECIOS EN $US', 'label', bold=True)
        rr = r
        put(ws, f'B{r+1}', sub, 'label')
        for j, h in enumerate(hd): put(ws, f'{L(2+j)}{r+2}', h, 'hdr')
        ws.row_dimensions[r+2].height = 30
        i0 = r + 3
        for k, (d, n, mon, cu, tq) in enumerate(its):
            ri = i0 + k
            put(ws, f'B{ri}', d, 'label', border=True); put(ws, f'C{ri}', n, 'input', FMT_INT)
            put(ws, f'D{ri}', cu, 'input' if not str(cu).startswith('=') else 'link', FMT_BS2)
            put(ws, f'E{ri}', f'=C{ri}*D{ri}*IF(J{ri}="USD",1,1/TIPO_CAMBIO)*M_INVERSION', 'calc', FMT_BS2)
            put(ws, f'F{ri}', f'=E{ri}*TASA_IVA', 'calc', FMT_BS2); put(ws, f'G{ri}', f'=E{ri}-F{ri}', 'calc', FMT_BS2)
            put(ws, f'H{ri}', f'=G{ri}*$C${rr}', 'calc', FMT_BS2); put(ws, f'I{ri}', f'=H{ri}/4', 'calc', FMT_BS2)
            put(ws, f'J{ri}', mon, 'input'); put(ws, f'K{ri}', tq, 'input', FMT_INT); put(ws, f'L{ri}', f'=E{ri}*TIPO_CAMBIO', 'calc', FMT_BS)
            items.append((ri, rr, gi))
        it_end = i0 + len(its) - 1
        rt = max(it_end + 1, i0 + (9 if gi == 0 else 3))
        put(ws, f'B{rt}', 'TOTAL' if gi == 0 else 'Total', 'label', bold=True, border=True)
        for c in 'EFGHIL': put(ws, f'{c}{rt}', f'=SUM({c}{i0}:{c}{rt-1})', 'calc', FMT_BS2 if c != 'L' else FMT_BS, bold=True)
        grp_rows.append((i0, it_end, rr, area))
        r = rt + 2
    a0, a1 = 5, items[-1][0]
    # bloque trimestral de depreciación
    rd = r + 1
    put(ws, f'B{rd}', 'DEPRECIACIÓN ($us)', 'label', bold=True)
    year_quarter_hdr(ws, rd, 3, labels=['1ERO', '2DO', '3ERO', '4TO'])
    rows = {}
    def life_q(rr_): return f'(4/$C${rr_})'
    rr_ = rd + 2
    for gi, (i0, i1, rate_r, area) in enumerate(grp_rows):
        put(ws, f'B{rr_}', GROUPS[gi][0].replace('Depreciación de ', 'Depreciación de '), 'label', border=True)
        for q in range(1, NQ+1):
            terms = [f'IF(AND({q}>=MAX(1,$K${i}),{q}<MAX(1,$K${i})+{life_q(rate_r)}),$I${i},0)' for i in range(i0, i1 + 1)]
            put(ws, f'{C2q(q)}{rr_}', '=' + '+'.join(terms), 'calc', FMT_BS2)
        rows[gi] = rr_; rr_ += 1
    rT = rr_
    def line(r_, lbl, fn, fmt=FMT_BS2, bold=False):
        put(ws, f'B{r_}', lbl, 'label', bold=bold, border=True)
        for q in range(1, NQ+1): put(ws, f'{C2q(q)}{r_}', fn(q), 'calc', fmt, bold=bold)
    line(rT, 'Depreciación de activos fijos', lambda q: f'=SUM({C2q(q)}{rows[0]}:{C2q(q)}{rows[3]})', bold=True)
    line(rT + 1, 'Depreciación acumulada de activos fijos', lambda q: f'={C2q(q)}{rT}' if q == 1 else f'={C2q(q-1)}{rT+1}+{C2q(q)}{rT}')
    line(rT + 2, 'Depreciación de fabricación (maquinaria + herramientas)', lambda q: f'={C2q(q)}{rows[0]}+{C2q(q)}{rows[3]}')
    line(rT + 3, 'Depreciación de administración (muebles + computación)', lambda q: f'={C2q(q)}{rows[1]}+{C2q(q)}{rows[2]}')
    line(rT + 4, 'Compras de activos ($us, con IVA)', lambda q: f'=SUMIF($K${a0}:$K${a1},{q},$E${a0}:$E${a1})')
    line(rT + 5, 'IVA de las compras de activos', lambda q: f'=SUMIF($K${a0}:$K${a1},{q},$F${a0}:$F${a1})')
    line(rT + 6, 'Activo fijo al costo (precio neto acumulado)', lambda q: f'=SUMIF($K${a0}:$K${a1},"<="&{q},$G${a0}:$G${a1})')
    line(rT + 7, 'Valor neto en libros', lambda q: f'={C2q(q)}{rT+6}-{C2q(q)}{rT+1}', bold=True)
    rs = rT + 9
    put(ws, f'B{rs}', 'TOTAL INVERSIÓN ACTIVOS FIJOS AÑO 0 ($)', 'label', bold=True, border=True); put(ws, f'C{rs}', f'=SUMIF($K${a0}:$K${a1},0,$E${a0}:$E${a1})', 'calc', FMT_BS2, bold=True)
    put(ws, f'B{rs+1}', 'IVA de la inversión año 0', 'label', border=True); put(ws, f'C{rs+1}', f'=SUMIF($K${a0}:$K${a1},0,$F${a0}:$F${a1})', 'calc', FMT_BS2)
    put(ws, f'B{rs+2}', 'Precio neto de la inversión año 0', 'label', border=True); put(ws, f'C{rs+2}', f'=SUMIF($K${a0}:$K${a1},0,$G${a0}:$G${a1})', 'calc', FMT_BS2)
    put(ws, f'B{rs+3}', 'En bolivianos', 'label', border=True); put(ws, f'C{rs+3}', f'=C{rs}*TIPO_CAMBIO', 'calc', FMT_BS)
    B.name('AF_ANIO0', 'Maqu. y equip.', f'C{rs}'); B.name('AF_ANIO0_IVA', 'Maqu. y equip.', f'C{rs+1}'); B.name('AF_ANIO0_NETO', 'Maqu. y equip.', f'C{rs+2}')
    Qr = lambda r_: (lambda q: f'{C2q(q)}{r_}')
    reg('AF.dep', 'Maqu. y equip.', q=Qr(rT)); reg('AF.acum', 'Maqu. y equip.', q=Qr(rT+1))
    reg('AF.dep_fab', 'Maqu. y equip.', q=Qr(rT+2)); reg('AF.dep_adm', 'Maqu. y equip.', q=Qr(rT+3))
    reg('AF.capex', 'Maqu. y equip.', q=Qr(rT+4), a0=f'C{rs}'); reg('AF.capex_iva', 'Maqu. y equip.', q=Qr(rT+5), a0=f'C{rs+1}')
    reg('AF.bruto', 'Maqu. y equip.', q=Qr(rT+6), a0=f'C{rs+2}'); reg('AF.vnl', 'Maqu. y equip.', q=Qr(rT+7), a0=f'C{rs+2}')
    return ws

CARGOS = [('Gerente General', 'ADM', 1, 7000), ('Jefe de Producción y Calidad', 'MOI', 1, 5500), ('Operario ceramista', 'MOD', None, 3600), ('Ejecutivo comercial', 'COM', 1, 4000)]

def build_mano_obra(B):
    ws = B.wb.create_sheet('MANO DE OBRA')
    widths(ws, {'A': 4, 'B': 34, 'C': 13, 'D': 13, 'E': 12, 'F': 12, 'G': 12, 'H': 10, 'I': 26, 'J': 10, 'K': 12, 'L': 12, 'M': 12, 'N': 13, 'O': 14, 'P': 14, 'Q': 14, 'R': 8, 'S': 14, 'T': 12, 'U': 11, 'V': 14})
    for j, h in enumerate(['Cargo', 'Cantidad', 'Salario Mensual (Bs.)', 'Total Mensual (Bs.)', 'Total Mensual ($)']): put(ws, f'{L(2+j)}2', h, 'hdr')
    crow = {}
    for i, (c, a, n, s) in enumerate(CARGOS):
        r = 3 + i; crow[a] = r
        put(ws, f'B{r}', c, 'label', border=True)
        put(ws, f'C{r}', n if n is not None else '=T4', 'input' if n is not None else 'calc', FMT_INT)
        put(ws, f'D{r}', s, 'input', FMT_BS); put(ws, f'E{r}', f'=C{r}*D{r}', 'calc', FMT_BS); put(ws, f'F{r}', f'=E{r}/TIPO_CAMBIO', 'calc', FMT_BS2)
    put(ws, 'B7', 'Total', 'label', bold=True, border=True)
    for c in 'CEF': put(ws, f'{c}7', f'=SUM({c}3:{c}6)', 'calc', FMT_BS2 if c == 'F' else FMT_BS, bold=True)
    # tabla "Año 2027" (I..O)
    put(ws, 'I2', 'Año 2027', 'hdr'); ws.merge_cells('I2:O2')
    for j, h in enumerate(['Cargo', 'Cantidad', 'Salario Mensual (Bs.)', 'Total Mensual (Bs.)', 'Total Mensual ($)', 'Total Trimestral ($)', 'Total Anual ($)']): put(ws, f'{L(9+j)}3', h, 'hdr')
    for i in range(4):
        r = 4 + i; rs = 3 + i
        put(ws, f'I{r}', f'=B{rs}', 'calc'); put(ws, f'J{r}', f'=C{rs}', 'calc', FMT_INT); put(ws, f'K{r}', f'=D{rs}', 'calc', FMT_BS)
        put(ws, f'L{r}', f'=J{r}*K{r}', 'calc', FMT_BS); put(ws, f'M{r}', f'=L{r}/TIPO_CAMBIO', 'calc', FMT_BS2)
        put(ws, f'N{r}', f'=M{r}*3', 'calc', FMT_BS2); put(ws, f'O{r}', f'=N{r}*4', 'calc', FMT_BS2)
    put(ws, 'I8', 'Total', 'label', bold=True, border=True)
    for c in 'JLMNO': put(ws, f'{c}8', f'=SUM({c}4:{c}7)', 'calc', FMT_BS2, bold=True)
    # incremento salarial (SMN)
    put(ws, 'B10', 'INCREMENTO SALARIAL (2021-2026)', 'hdr'); ws.merge_cells('B10:D10')
    for j, h in enumerate(['Año', 'Salario Mínimo Nacional (Bs)', 'Incremento Anual']): put(ws, f'{L(2+j)}11', h, 'hdr')
    for i, (yv, v) in enumerate([(2021, 2164), (2022, 2250), (2023, 2362), (2024, 2500), (2025, 2750), (2026, 3300)]):
        r = 12 + i
        put(ws, f'B{r}', yv, 'calc', FMT_INT); put(ws, f'C{r}', v, 'input', FMT_BS); put(ws, f'D{r}', 0 if i == 0 else f'=(C{r}-C{r-1})/C{r-1}', 'calc', FMT_PCT)
    put(ws, 'B19', 'INCREMENTO SALARIAL EN PROMEDIO', 'label', bold=True, border=True); put(ws, 'D19', '=AVERAGE(D13:D17)', 'calc', FMT_PCT2, bold=True)
    put(ws, 'F10', 'BONO DE ANTIGÜEDAD', 'hdr'); ws.merge_cells('F10:G10')
    put(ws, 'F11', 'AÑOS', 'hdr'); put(ws, 'G11', 'PORCENTAJES', 'hdr')
    for i, (a, b) in enumerate([('De 2-4', .05), ('De 5-7', .11), ('De 8-10', .18), ('De 11-14', .26), ('De 15-19', .34), ('De 20-24', .42), ('25 o más', .50)]):
        put(ws, f'F{12+i}', a, 'label', border=True); put(ws, f'G{12+i}', b, 'calc', FMT_PCT)
    # operarios según producción (R..V)
    put(ws, 'R2', 'OPERARIOS SEGÚN LA PRODUCCIÓN', 'hdr'); ws.merge_cells('R2:V2')
    for j, h in enumerate(['Año', 'Producción máxima por trimestre', 'Operarios necesarios', 'Operarios nuevos', 'Capacitación de nuevos ($)']): put(ws, f'{L(18+j)}3', h, 'hdr')
    ws.row_dimensions[3].height = 45
    for y in range(1, 6):
        r = 3 + y
        put(ws, f'R{r}', 2026 + y, 'calc', FMT_INT)
        put(ws, f'S{r}', '=MAX(' + ','.join(Q('INV.prod', q) for q in range(4*y-3, 4*y+1)) + ')', 'link', FMT_U)
        put(ws, f'T{r}', f'=MAX(MIN_OPERARIOS,ROUNDUP(S{r}/(PROD_OPERARIO*DIAS_TRIM),0))', 'calc', FMT_INT, bold=True)
        put(ws, f'U{r}', f'=MAX(0,T{r}-MIN_OPERARIOS)' if y == 1 else f'=MAX(0,T{r}-T{r-1})', 'calc', FMT_INT)
        put(ws, f'V{r}', f"=U{r}*COSTO_CAPAC_NUEVO*'Calendario'!{yc(y)}11/TIPO_CAMBIO", 'calc', FMT_BS2)
    reg('PER.ops', 'MANO DE OBRA', y=lambda y: f'T{3+y}')
    # planillas por año (posiciones de Ñapefit)
    starts = [22, 34, 45, 56, 67]
    hdA = ['Personal', 'Sueldo Basico ($us)', 'Bono de Antigüedad', 'Total ganado', 'Gestora Publica', 'Liquido Pagable', 'Aportes Patronales', '', '', '', 'Total Aportes Pat.', 'Provision para', 'Prevision para', 'Total Mensual', 'Total Anual', 'Total Anual (Bs)']
    tot_rows = {}; cargo_rows = {}
    for y, r0 in enumerate(starts, start=1):
        put(ws, f'B{r0}', f'Año {2026+y}', 'label', bold=True)
        for j, h in enumerate(hdA):
            if h: put(ws, f'{L(2+j)}{r0+1}', h, 'hdr')
        ws[f'I{r0+1}'].fill = FILL_HDR; ws[f'J{r0+1}'].fill = FILL_HDR; ws[f'K{r0+1}'].fill = FILL_HDR
        ws.merge_cells(f'H{r0+1}:K{r0+1}')
        for c, h in zip('HIJK', ['CNS', 'Riesgo Prof.', 'Aporte Pat. Sol.', 'Provivienda']): put(ws, f'{c}{r0+2}', h, 'hdr')
        for c, h in zip('MNO', ['aguinaldo', 'indemnizacion', '(Sueldos, Aportes']): put(ws, f'{c}{r0+2}', h, 'hdr')
        put(ws, f'O{r0+3}', 'y prov.)', 'hdr')
        ws.row_dimensions[r0+1].height = 45
        rr = r0 + 3
        put(ws, f'D{rr}', f'=IF({y}>=ANIO_BONO,BONO_ANT,0)', 'calc', FMT_PCT)
        for c, t in zip('FHIJKMN', ['TASA_GESTORA', 'TASA_CNS', 'TASA_RIESGO', 'TASA_SOLIDARIO', 'TASA_PROVIVIENDA', 'TASA_AGUINALDO', 'TASA_INDEMNIZACION']):
            put(ws, f'{c}{rr}', f'={t}', 'calc', FMT_PCT2)
        for i, (c, a, n, s) in enumerate(CARGOS):
            r = r0 + 4 + i; cr = crow[a]; cargo_rows[(y, a)] = r
            cant = f'$T${3+y}' if n is None else f'$C${cr}'
            if n is None: put(ws, f'B{r}', f'="Operarios ceramistas ("&{cant}&")"', 'calc')
            else: put(ws, f'B{r}', c, 'label', border=True)
            put(ws, f'C{r}', f"={cant}*$D${cr}*'Calendario'!{yc(y)}12*M_SALARIOS/TIPO_CAMBIO", 'calc', FMT_BS2)
            put(ws, f'D{r}', f"=IF({y}>=ANIO_BONO,BONO_ANT*3*SMN*(1+INC_SAL)*'Calendario'!{yc(y)}12/TIPO_CAMBIO*{cant},0)", 'calc', FMT_BS2)
            put(ws, f'E{r}', f'=C{r}+D{r}', 'calc', FMT_BS2); put(ws, f'F{r}', f'=E{r}*$F${rr}', 'calc', FMT_BS2); put(ws, f'G{r}', f'=E{r}-F{r}', 'calc', FMT_BS2)
            for c2 in 'HIJK': put(ws, f'{c2}{r}', f'=E{r}*${c2}${rr}', 'calc', FMT_BS2)
            put(ws, f'L{r}', f'=SUM(H{r}:K{r})', 'calc', FMT_BS2); put(ws, f'M{r}', f'=E{r}*$M${rr}', 'calc', FMT_BS2); put(ws, f'N{r}', f'=E{r}*$N${rr}', 'calc', FMT_BS2)
            put(ws, f'O{r}', f'=E{r}+L{r}+M{r}+N{r}', 'calc', FMT_BS2); put(ws, f'P{r}', f'=O{r}*12', 'calc', FMT_BS2, bold=True); put(ws, f'Q{r}', f'=P{r}*TIPO_CAMBIO', 'calc', FMT_BS)
        rt = r0 + 8; tot_rows[y] = rt
        put(ws, f'B{rt}', 'Total', 'label', bold=True, border=True)
        for c2 in 'CDEFGHIJKLMNOPQ': put(ws, f'{c2}{rt}', f'=SUM({c2}{r0+4}:{c2}{rt-1})', 'calc', FMT_BS2 if c2 != 'Q' else FMT_BS, bold=True)
    # tabla "Incremento salarial" (I12..N18): total anual por cargo y año
    put(ws, 'I11', 'Incremento Salarial', 'hdr'); ws.merge_cells('I11:N11')
    put(ws, 'I12', 'Cargo', 'hdr')
    for y in range(1, 6): put(ws, f'{L(9+y)}12', f'Año {2026+y} ($)', 'hdr')
    for i, (c, a, n, s) in enumerate(CARGOS):
        r = 13 + i
        put(ws, f'I{r}', c, 'label', border=True)
        for y in range(1, 6): put(ws, f'{L(9+y)}{r}', f'=P{cargo_rows[(y, a)]}', 'calc', FMT_BS2)
    put(ws, 'I17', 'Total', 'label', bold=True, border=True)
    for y in range(1, 6): put(ws, f'{L(9+y)}17', f'=P{tot_rows[y]}', 'calc', FMT_BS2, bold=True)
    # planilla trimestral (alimenta los estados)
    rq = 80
    put(ws, f'B{rq}', 'PLANILLA POR TRIMESTRE ($us) - alimenta el Estado de resultado y el Flujo de caja', 'label', bold=True)
    year_quarter_hdr(ws, rq + 1, 3)
    lines = [('MOD', 'Mano de obra directa (operarios)', lambda y: f'P{cargo_rows[(y, "MOD")]}/4'),
             ('MOI', 'Mano de obra indirecta (jefe de producción)', lambda y: f'P{cargo_rows[(y, "MOI")]}/4'),
             ('ADM', 'Administración (gerente)', lambda y: f'P{cargo_rows[(y, "ADM")]}/4'),
             ('COM', 'Comercialización (ejecutivo)', lambda y: f'P{cargo_rows[(y, "COM")]}/4'),
             ('tot', 'COSTO LABORAL TOTAL', lambda y: f'P{tot_rows[y]}/4'),
             ('mes', 'Un mes de sueldo de toda la planilla (base de la prima)', lambda y: f'E{tot_rows[y]}')]
    r = rq + 3
    for k, lbl, fn in lines:
        put(ws, f'B{r}', lbl, 'label', bold=k == 'tot', border=True)
        for q in range(1, NQ+1): put(ws, f'{C2q(q)}{r}', '=' + fn(year_of(q)), 'calc', FMT_BS2, bold=k == 'tot')
        reg('PER.' + k, 'MANO DE OBRA', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r))
        r += 1
    put(ws, f'B{r}', 'Capacitación de operarios nuevos', 'label', border=True)
    for q in range(1, NQ+1): put(ws, f'{C2q(q)}{r}', f'=V{3+year_of(q)}' if qk(q) == 1 else '=0', 'calc', FMT_BS2)
    reg('PER.capac', 'MANO DE OBRA', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r))
    ROW['PER.crow_MOI'] = crow['MOI']; ROW['PER.crow_MOD'] = crow['MOD']
    return ws

GASTOS = [('Alquiler de galpón (300 m² con patio de secado)', 'FAB', 6000, 1), ('Energía eléctrica y agua', 'FAB', 1500, 1), ('Mantenimiento de equipos y horno', 'FAB', 800, 1),
          ('Análisis de laboratorio (control por lote)', 'FAB', 1200, 1), ('Internet y telefonía', 'ADM', 300, 1), ('Contabilidad y asesoría legal', 'ADM', 1500, 1),
          ('Seguros', 'ADM', 500, 1), ('Suministros de oficina y papelería', 'ADM', 300, 1), ('Capacitación continua', 'ADM', 350, 1), ('Otros Gastos Misceláneos (sin factura)', 'ADM', 600, 0),
          ('Marketing y publicidad', 'COM', '=PUBLICIDAD_MES', 1), ('Transporte y Logística', 'COM', 2000, 1), ('Registro de clientes y avisos por WhatsApp', 'COM', 300, 1)]

def build_otros_gastos(B):
    ws = B.wb.create_sheet('Otros gastos')
    widths(ws, {'A': 4, 'B': 44, 'C': 17, 'D': 17, 'E': 19, 'F': 13, 'G': 8, 'H': 11})
    for q in range(1, NQ+1): ws.column_dimensions[C2q(q)].width = max(ws.column_dimensions[C2q(q)].width or 0, 13)
    for j, h in enumerate(['Concepto', 'Monto mensual (Bs.)', 'Monto trimestral (Bs)', 'Monto trimestral (USD)', 'ANUAL (USD)', 'Área', 'Factura (1/0)']): put(ws, f'{L(2+j)}2', h, 'hdr')
    g0 = 3
    for i, (c, a, m, f) in enumerate(GASTOS):
        r = g0 + i
        put(ws, f'B{r}', c, 'label', border=True); put(ws, f'C{r}', m, 'input', FMT_BS)
        put(ws, f'D{r}', f'=C{r}*3', 'calc', FMT_BS); put(ws, f'E{r}', f'=D{r}/TIPO_CAMBIO', 'calc', FMT_BS2); put(ws, f'F{r}', f'=E{r}*4', 'calc', FMT_BS2)
        put(ws, f'G{r}', a, 'input'); put(ws, f'H{r}', f, 'input', FMT_INT)
    g1 = g0 + len(GASTOS) - 1; rt = g1 + 1
    put(ws, f'B{rt}', 'Total General', 'label', bold=True, border=True)
    for c in 'CDEF': put(ws, f'{c}{rt}', f'=SUM({c}{g0}:{c}{g1})', 'calc', FMT_BS2 if c in 'EF' else FMT_BS, bold=True)
    put(ws, f'B{rt+1}', 'Área: FAB = fabricación, ADM = administración, COM = comercialización', 'label')
    ROW['GAS.alquiler'] = g0; ROW['GAS.transporte'] = g0 + 11
    r0 = rt + 4
    put(ws, f'B{r0}', 'GASTOS POR TRIMESTRE ($us), con el ajuste por inflación', 'label', bold=True)
    year_quarter_hdr(ws, r0 + 1, 3)
    E = f'$E${g0}:$E${g1}'; G = f'$G${g0}:$G${g1}'; H = f'$H${g0}:$H${g1}'
    idx = lambda q: f"'Calendario'!{qc(q)}$11"
    r = r0 + 3
    for a, nm in [('FAB', 'fabricación'), ('ADM', 'administración'), ('COM', 'comercialización')]:
        put(ws, f'B{r}', f'Gastos de {nm} (con IVA, pago)', 'label', border=True)
        put(ws, f'B{r+1}', f'Gastos de {nm} (sin IVA, al resultado)', 'label', border=True)
        for q in range(1, NQ+1):
            put(ws, f'{C2q(q)}{r}', f'=SUMIF({G},"{a}",{E})*{idx(q)}*M_FIJOS', 'calc', FMT_BS2)
            put(ws, f'{C2q(q)}{r+1}', f'=SUMPRODUCT(({G}="{a}")*{E}*(1-TASA_IVA*{H}))*{idx(q)}*M_FIJOS', 'calc', FMT_BS2)
        reg(f'GAS.{a}.pago', 'Otros gastos', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r))
        reg(f'GAS.{a}.neto', 'Otros gastos', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r+1))
        r += 2
    put(ws, f'B{r}', 'Total gastos con IVA (pago)', 'label', bold=True, border=True)
    put(ws, f'B{r+1}', 'IVA crédito fiscal de los gastos', 'label', border=True)
    put(ws, f'B{r+2}', 'Entrega de filtros (con IVA, pago)', 'label', border=True)
    put(ws, f'B{r+3}', 'Entrega de filtros (sin IVA)', 'label', border=True)
    put(ws, f'B{r+4}', 'IVA crédito fiscal de la entrega', 'label', border=True)
    for q in range(1, NQ+1):
        c = C2q(q)
        put(ws, f'{c}{r}', f'={c}{r0+3}+{c}{r0+5}+{c}{r0+7}', 'calc', FMT_BS2, bold=True)
        put(ws, f'{c}{r+1}', f'={c}{r}-({c}{r0+4}+{c}{r0+6}+{c}{r0+8})', 'calc', FMT_BS2)
        put(ws, f'{c}{r+2}', f"={Q('INV.ventas', q)}*ENTREGA_U/TIPO_CAMBIO*{idx(q)}*M_CVAR", 'link', FMT_BS2)
        put(ws, f'{c}{r+3}', f'={c}{r+2}*(1-TASA_IVA)', 'calc', FMT_BS2)
        put(ws, f'{c}{r+4}', f'={c}{r+2}-{c}{r+3}', 'calc', FMT_BS2)
    for k, off in [('GAS.pago', 0), ('GAS.iva', 1), ('GAS.ent.pago', 2), ('GAS.ent.neto', 3), ('GAS.ent.iva', 4)]:
        reg(k, 'Otros gastos', q=(lambda r_: (lambda q: f'{C2q(q)}{r_}'))(r + off))
    return ws
