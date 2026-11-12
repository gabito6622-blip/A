from lib import *
from b1_supuestos import ROW, _copy_block
import openpyxl

def build_santa_cruz(B, src_path):
    src = openpyxl.load_workbook(src_path)
    ws = B.wb.create_sheet('Santa Cruz')
    _copy_block(src['Santa Cruz'], ws, 1, 43, 1, 16)
    # análisis a la derecha (como Ñapefit S/T)
    for r, lbl, f, fm in [(19, 'Tasa de crecimiento de Santa Cruz', '=M41/100', FMT_PCT2),
                          (20, 'Tasa de crecimiento urbana de Santa Cruz', '=M42/100', FMT_PCT2),
                          (21, 'Población urbana de Santa Cruz 2024', '=I42/(K42/100)+I42', FMT_U)]:
        put(ws, f'S{r}', lbl, 'label', border=True); put(ws, f'T{r}', f, 'calc', fm)
    ws.column_dimensions['S'].width = 40; ws.column_dimensions['T'].width = 14
    B.name('TASA_DEP', 'Santa Cruz', 'T19'); B.name('TASA_URB', 'Santa Cruz', 'T20'); B.name('POB_URB_DEP_2024', 'Santa Cruz', 'T21')
    B.name('POB_DEP_2024', 'Santa Cruz', 'N9')
    put(ws, 'B47', 'PROYECCIONES (2025 - 2031)', 'label', bold=True)
    for j, yv in enumerate(range(2024, 2032)):
        c = L(2 + j)
        put(ws, f'{c}49', yv, 'hdr'); put(ws, f'{c}50', 'Total', 'hdr')
        put(ws, f'{c}52', '=N9' if j == 0 else f'={L(1+j)}52*(1+$T$19)', 'calc', FMT_U)
        put(ws, f'{c}54', 'Urbana', 'hdr')
        put(ws, f'{c}56', '=T21' if j == 0 else f'={L(1+j)}56*(1+$T$20)', 'calc', FMT_U)
    reg('POB.tot', 'Santa Cruz', y=lambda yv: f'{L(2 + yv - 2024)}52')
    reg('POB.urb', 'Santa Cruz', y=lambda yv: f'{L(2 + yv - 2024)}56')
    return ws

def build_zona_urbana(B, src_path):
    src = openpyxl.load_workbook(src_path)
    ws = B.wb.create_sheet('Zona urbana')
    _copy_block(src['Zona urbana'], ws, 1, 47, 1, 16)
    ws.column_dimensions['S'].width = 48
    put(ws, 'R19', '=SUM(N21:N23)', 'calc', FMT_U); put(ws, 'S19', 'PERSONAS DEL ÁREA URBANA DE 18 A 59 AÑOS', 'label', border=True)
    put(ws, 'R20', '=N17', 'calc', FMT_U); put(ws, 'S20', 'POBLACIÓN URBANA DEL MUNICIPIO 2024', 'label', border=True)
    put(ws, 'R21', '=R20/POB_URB_DEP_2024', 'calc', FMT_PCT); put(ws, 'S21', 'MUNICIPIO / URBANO DEPARTAMENTAL (cobertura inicial)', 'label', border=True)
    B.name('POB_MUN_18_59_URB', 'Zona urbana', 'R19'); B.name('POB_URB_MUN_2024', 'Zona urbana', 'R20')
    put(ws, 'B51', 'PROYECCIONES (2025 - 2031) - población urbana del municipio', 'label', bold=True)
    for j, yv in enumerate(range(2024, 2032)):
        c = L(2 + j)
        put(ws, f'{c}53', yv, 'hdr'); put(ws, f'{c}54', 'Urbana', 'hdr')
        put(ws, f'{c}56', '=R20' if j == 0 else f'={L(1+j)}56*(1+TASA_URB)', 'calc', FMT_U)
    return ws

def build_demanda(B):
    ws = B.wb.create_sheet('Demanda')
    widths(ws, {'A': 17.5, 'B': 52, 'C': 6, 'D': 15, 'E': 15, 'F': 15, 'G': 15, 'H': 15, 'I': 15})
    put(ws, 'B27', 'DEMANDA FILTRO DE AGUA 2.0', 'label', bold=True); ws['B27'].font = Font(name=FONT, size=16, bold=True)
    put(ws, 'B29', 'SUPUESTOS', 'hdr')
    years = list(range(2026, 2032))
    for j, yv in enumerate(years): put(ws, f'{L(4+j)}29', yv, 'hdr')
    cob = {2026: 'COB_2027', 2027: 'COB_2027', 2028: 'COB_2028', 2029: 'COB_2029', 2030: 'COB_2030', 2031: 'COB_2031'}
    rows = [
        (30, 'Población de Santa Cruz', lambda yv, c: f"={Y('POB.tot', yv)}", FMT_U),
        (31, 'Población urbana de Santa Cruz', lambda yv, c: f"={Y('POB.urb', yv)}", FMT_U),
        (32, 'Hogares urbanos (3,5 personas por hogar)', lambda yv, c: f'={c}31/TAM_HOGAR', FMT_U),
        (33, 'Cobertura de la distribución (%)', lambda yv, c: f'={cob[yv]}', FMT_PCT),
        (34, 'Hogares a los que llega la distribución', lambda yv, c: f'={c}32*{c}33', FMT_U),
        (35, 'Hogares que compran botellón o hierven el agua (50%)', lambda yv, c: f'={c}34*PCT_OBJETIVO', FMT_U),
        (36, 'Promedio de compra (q) filtros por hogar al año', lambda yv, c: '=CONSUMO_Q', FMT_BS2),
        (37, 'Demanda de mercado (unid)', lambda yv, c: f'={c}35*{c}36', FMT_U),
        (38, 'Precio (Bs) (ajuste por inflación)', lambda yv, c: f'=PVP*(1+AJUSTE_PRECIO)^({yv}-2027)*M_PRECIO', FMT_BS2),
        (39, 'Demanda de mercado (Bs)', lambda yv, c: f'={c}37*{c}38', FMT_U),
        (40, 'Demanda de mercado ($)', lambda yv, c: f'={c}39/TIPO_CAMBIO', FMT_U),
    ]
    for r, lbl, fn, fm in rows:
        put(ws, f'B{r}', lbl, 'label', bold=r in (37,), border=True)
        for j, yv in enumerate(years):
            c = L(4 + j); v = fn(yv, c)
            put(ws, f'{c}{r}', v, 'link' if '!' in v else 'calc', fm, bold=r in (37,))
    put(ws, 'A33', 'Supuestos', 'note'); put(ws, 'A38', 'Precio: hoja Competencia', 'note')
    ycol = lambda y: L(4 + y)  # y=1 -> 2027 -> E
    reg('DEM.dpot', 'Demanda', y=lambda y: f'{ycol(y)}37')
    reg('DEM.hobj', 'Demanda', y=lambda y: f'{ycol(y)}35')
    reg('DEM.cob', 'Demanda', y=lambda y: f'{ycol(y)}33')
    reg('DEM.pvp', 'Demanda', y=lambda y: f'{ycol(y)}38')
    return ws

def build_pronostico(B):
    ws = B.wb.create_sheet('Pronostico')
    widths(ws, {'A': 4, 'B': 15.9, 'C': 13, 'D': 12, 'E': 12, 'F': 13, 'G': 12.1, 'H': 14.1, 'I': 9, 'J': 16.9, 'K': 4, 'L': 9, 'M': 10, 'N': 10})
    def bar(r, t, c1='B', c2='J'):
        put(ws, f'{c1}{r}', t, 'bar'); ws.merge_cells(f'{c1}{r}:{c2}{r}')
    bar(2, 'PRONÓSTICO DE VENTAS')
    put(ws, 'B4', 'ESCENARIOS', 'hdr'); ws.merge_cells('B4:D4')
    for j, (t, n) in enumerate([('Pesimista', 'PART_PES'), ('Esperado', 'PART_BASE'), ('Optimista', 'PART_OPT')]):
        put(ws, f'{L(2+j)}5', t, 'hdr'); put(ws, f'{L(2+j)}6', f'={n}', 'calc', FMT_PCT)
    put(ws, 'F4', 'Tasa de crecimiento', 'hdr'); ws.merge_cells('F4:G4'); put(ws, 'H4', '=CRECE_PART', 'calc', FMT_PCT2)
    put(ws, 'F6', 'Escenario usado', 'hdr'); ws.merge_cells('F6:G6'); put(ws, 'H6', '=NOMBRE_ESCENARIO', 'calc', bold=True)
    hd = ['Año', 'Demanda del mercado (unid)', 'Aceptación del producto', 'Participación estimada (%)', 'Ventas proyectadas (unid)', 'Precio (Bs)', 'Ventas proyectadas (Bs)', 'Tipo de cambio', 'Ventas proyectadas ($)']
    starts = {}
    for key, title, r0, part in [('PES', 'ESCENARIO PESIMISTA', 8, 'PART_PES'), ('BASE', 'ESCENARIO ESPERADO', 16, 'PART_BASE'), ('OPT', 'ESCENARIO OPTIMISTA', 24, 'PART_OPT')]:
        bar(r0, title)
        for j, h in enumerate(hd): put(ws, f'{L(2+j)}{r0+1}', h, 'hdr')
        ws.row_dimensions[r0+1].height = 45
        f0 = r0 + 2; starts[key] = f0
        for y in range(1, 6):
            r = f0 + y - 1
            put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT)
            put(ws, f'C{r}', f"={Y('DEM.dpot', y)}", 'link', FMT_U, bold=True)
            put(ws, f'D{r}', '=ACEPTACION', 'calc', FMT_PCT)
            put(ws, f'E{r}', f'={part}' if y == 1 else f'=E{r-1}*(100%+$H$4)', 'calc', FMT_PCT2)
            put(ws, f'F{r}', f'=C{r}*D{r}*E{r}*M_DEMANDA', 'calc', FMT_U, bold=True)
            put(ws, f'G{r}', f"={Y('DEM.pvp', y)}", 'link', FMT_BS2)
            put(ws, f'H{r}', f'=F{r}*G{r}', 'calc', FMT_BS2)
            put(ws, f'I{r}', '=TIPO_CAMBIO', 'calc', FMT_BS2)
            put(ws, f'J{r}', f'=H{r}/I{r}', 'calc', FMT_BS2)
    # tabla de precio (como Ñapefit L17:N22)
    for j, h in enumerate(['Año', 'Precio $', 'Precio Bs']): put(ws, f'{L(12+j)}17', h, 'hdr')
    for y in range(1, 6):
        r = 17 + y
        put(ws, f'L{r}', 2026 + y, 'calc', FMT_INT); put(ws, f'N{r}', f'=G{starts["BASE"]+y-1}', 'calc', FMT_BS2, bold=True); put(ws, f'M{r}', f'=N{r}/TIPO_CAMBIO', 'calc', FMT_BS2)
    bar(32, 'PRONÓSTICO DE VENTAS TRIMESTRAL (EN BASE AL ESCENARIO USADO, CELDA H6)', 'B', 'J')
    def qtable(r_title, title, val):
        put(ws, f'B{r_title}', title, 'hdr'); ws.merge_cells(f'B{r_title}:G{r_title}')
        rw = r_title + 1
        put(ws, f'B{rw}', 'AÑOS / TRIMESTRES', 'hdr')
        for k in range(4): put(ws, f'{L(3+k)}{rw}', f'=EST_T{k+1}', 'hdr', FMT_PCT)
        put(ws, f'G{rw}', f'=SUM(C{rw}:F{rw})', 'hdr', FMT_PCT)
        for k, t in enumerate(QL + ['TOTAL']): put(ws, f'{L(3+k)}{rw+1}', t, 'hdr')
        r0 = rw + 2
        for y in range(1, 6):
            r = r0 + y - 1
            put(ws, f'B{r}', 2026 + y, 'calc', FMT_INT)
            for k in range(4): put(ws, f'{L(3+k)}{r}', val(y, k, r, rw), 'calc' if '!' not in val(y, k, r, rw) else 'link', FMT_U)
            put(ws, f'G{r}', f'=SUM(C{r}:F{r})', 'calc', FMT_U, bold=True)
        return r0
    act = lambda y: f"CHOOSE(ESCENARIO,$F${starts['PES']+y-1},$F${starts['BASE']+y-1},$F${starts['OPT']+y-1})"
    u0 = qtable(34, 'PROYECCION DE VENTAS EN CANTIDAD', lambda y, k, r, rw: f'={act(y)}*{L(3+k)}${rw}')
    f0 = qtable(43, 'PROYECCION DE VENTAS EN $ (precio promedio que factura la empresa)', lambda y, k, r, rw: f"={L(3+k)}{u0+y-1}*{Y('PRE.prom_usd', y)}")
    reg('PRO.units', 'Pronostico', q=grid(u0), y=lambda y: f'G{u0+y-1}')
    reg('PRO.fact', 'Pronostico', q=grid(f0), y=lambda y: f'G{f0+y-1}')
    reg('PRO.part', 'Pronostico', y=lambda y: f"E{starts['BASE']+y-1}")
    for k in ('PES', 'BASE', 'OPT'): ROW[f'PRO.{k}.f0'] = starts[k]
    ROW['PRO.u0'] = u0
    return ws
