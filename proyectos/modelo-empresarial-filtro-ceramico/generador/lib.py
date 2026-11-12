from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

FONT = 'Calibri'
F_IN = Font(name=FONT, size=11, color='0000FF')
F_CALC = Font(name=FONT, size=11, color='000000')
F_LINK = Font(name=FONT, size=11, color='008000')
F_LBL = Font(name=FONT, size=11)
F_LBLB = Font(name=FONT, size=11, bold=True)
F_HDR = Font(name=FONT, size=11, bold=True, color='000000')
F_TIT = Font(name=FONT, size=14, bold=True, color='000000')
F_SUB = Font(name=FONT, size=11, italic=True, color='555555')
F_SEC = Font(name=FONT, size=11, bold=True, color='FFFFFF')
FILL_IN = PatternFill('solid', fgColor='FFF2CC')
FILL_HDR = PatternFill('solid', fgColor='FFD966')
FILL_ANUAL = PatternFill('solid', fgColor='A9D08E')
FILL_BAR = PatternFill('solid', fgColor='BF8F00')
FILL_SEC = PatternFill('solid', fgColor='BF8F00')
FILL_TOT = PatternFill('solid', fgColor='EDEDED')
FILL_KEY = PatternFill('solid', fgColor='FFFF00')
THIN = Side(style='thin', color='000000')
BORDER = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
WRAP = Alignment(wrap_text=True, vertical='top')
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)

KEEP_NOTES = {'Sensibilidad', 'DECISIONES Y ESCENARIOS', 'Muestra y encuesta', 'SIMULADOR EMPRESARIAL', 'Competencia'}
FMT_BS = '#,##0;(#,##0);"-"'
FMT_BS2 = '#,##0.00;(#,##0.00);"-"'
FMT_U = '#,##0;(#,##0);"-"'
FMT_PCT = '0.0%;(0.0%);"-"'
FMT_PCT2 = '0.00%;(0.00%);"-"'
FMT_X = '0.00"x"'
FMT_INT = '0'

NQ = 20
def qc(q):  # trimestre 1..20 -> D..W
    return L(3 + q)
def yc(y):  # año 1..5 -> Y..AC (columnas anuales en hojas trimestrales)
    return L(24 + y)
def ac(y):  # hojas anuales: año 1..5 -> C..G
    return L(2 + y)
def ec(y):  # evaluación: año 0..5 -> C..H
    return L(3 + y)
QLABEL = [f"{2027 + (q-1)//4}-T{(q-1)%4+1}" for q in range(1, NQ+1)]
def year_of(q): return (q-1)//4 + 1
def qrange(y): return f"{qc(4*y-3)}{{r}}:{qc(4*y)}{{r}}"

def R(sheet, cell, absolute=False):
    if absolute:
        col = ''.join(ch for ch in cell if ch.isalpha()); row = ''.join(ch for ch in cell if ch.isdigit())
        cell = f"${col}${row}"
    return f"'{sheet}'!{cell}"

class Book:
    def __init__(self):
        self.wb = Workbook()
        self.wb.remove(self.wb.active)
        self.names = {}
        self.order = []
    def sheet(self, name, title, subtitle='', tab=None):
        ws = self.wb.create_sheet(name)
        ws['A1'] = title; ws['A1'].font = F_TIT
        ws.column_dimensions['A'].width = 46
        ws.column_dimensions['B'].width = 14
        return ws
    def name(self, nm, sheet, cell):
        col = ''.join(ch for ch in cell if ch.isalpha()); row = ''.join(ch for ch in cell if ch.isdigit())
        ref = f"'{sheet}'!${col}${row}"
        self.wb.defined_names[nm] = DefinedName(nm, attr_text=ref)
        self.names[nm] = (sheet, cell)

def put(ws, cell, value, kind='calc', fmt=None, bold=False, fill=None, wrap=False, comment=None, align=None, border=False):
    c = ws[cell]
    c.value = value
    if kind == 'input':
        c.font = Font(name=FONT, size=11, color='0000FF', bold=bold); c.fill = FILL_IN
    elif kind == 'link':
        c.font = Font(name=FONT, size=11, color='000000', bold=bold)
    elif kind == 'label':
        c.font = Font(name=FONT, size=11, bold=bold)
        c.alignment = Alignment(vertical='top', wrap_text=wrap)
    elif kind == 'hdr':
        c.font = F_HDR; c.fill = FILL_HDR; c.alignment = CENTER; c.border = BORDER
    elif kind == 'bar':
        c.font = F_SEC; c.fill = FILL_BAR; c.alignment = Alignment(horizontal='center', vertical='center')
    elif kind == 'sec':
        c.font = F_SEC; c.fill = FILL_SEC
        from openpyxl.utils import column_index_from_string as CI
        col = ''.join(ch for ch in cell if ch.isalpha()); row = int(''.join(ch for ch in cell if ch.isdigit()))
        for k in range(1, 8):
            nc = ws.cell(row, CI(col) + k)
            if nc.value is None and not isinstance(nc, type(None)):
                try: nc.fill = FILL_SEC
                except AttributeError: pass
    elif kind == 'note' and isinstance(value, str) and len(value) > 45 and ws.title not in KEEP_NOTES:
        c.value = None
        return c
    elif kind == 'note':
        c.font = Font(name=FONT, size=9, italic=True, color='555555')
    else:
        c.font = Font(name=FONT, size=11, bold=bold)
    if kind in ('calc', 'link', 'input') or (kind == 'label' and border):
        c.border = BORDER
    if fmt: c.number_format = fmt
    if fill: c.fill = fill
    if wrap: c.alignment = WRAP
    if align: c.alignment = align
    if comment: c.comment = Comment(comment, 'Modelo')
    return c

def is_link(f):
    return isinstance(f, str) and f.startswith('=') and "!" in f

def hdr_time(ws, row=4, year0=True, annual=True, first='Concepto', unit='Unidad'):
    put(ws, f'A{row}', first, 'hdr'); put(ws, f'B{row}', unit, 'hdr')
    if year0:
        put(ws, f'C{row}', 'Año 0 (2026)', 'hdr')
    for q in range(1, NQ+1):
        put(ws, f'{qc(q)}{row}', ['1ER', '2DO', '3ER', '4TO'][(q-1) % 4], 'hdr')
        ws.column_dimensions[qc(q)].width = 12
    if row > 1 and all(ws[f'{qc(q)}{row-1}'].value is None for q in range(1, NQ+1)):
        for y in range(1, 6):
            a, b = qc(4*y-3), qc(4*y)
            put(ws, f'{a}{row-1}', f'AÑO {2026+y}', 'hdr')
            for q in range(4*y-2, 4*y+1): ws[f'{qc(q)}{row-1}'].border = BORDER; ws[f'{qc(q)}{row-1}'].fill = FILL_HDR
            ws.merge_cells(f'{a}{row-1}:{b}{row-1}')
    ws.column_dimensions['C'].width = 13
    ws.column_dimensions['X'].width = 3
    if annual:
        for y in range(1, 6):
            put(ws, f'{yc(y)}{row}', f'TOTAL {2026+y}', 'hdr'); ws[f'{yc(y)}{row}'].fill = FILL_ANUAL
            ws.column_dimensions[yc(y)].width = 13
    ws.freeze_panes = f'C{row+1}'

def qrow(ws, r, label, unit, f, fmt=FMT_BS, c0=None, annual='sum', bold=False, kind=None, fill=None, note=None):
    """f(q) -> formula string for quarter q. c0: value/formula for Año 0 column C. annual: 'sum'|'last'|'avg'|None|callable(y)"""
    put(ws, f'A{r}', label, 'label', bold=bold, fill=fill, border=True)
    put(ws, f'B{r}', unit, 'note'); ws[f'B{r}'].border = BORDER
    if c0 is not None:
        k = kind or ('link' if is_link(c0) else 'calc')
        put(ws, f'C{r}', c0, k, fmt, bold=bold, fill=fill)
    for q in range(1, NQ+1):
        v = f(q)
        k = kind or ('link' if is_link(v) else 'calc')
        put(ws, f'{qc(q)}{r}', v, k, fmt, bold=bold, fill=fill)
    if annual:
        for y in range(1, 6):
            if callable(annual):
                v = annual(y)
            elif annual == 'sum':
                v = f'=SUM({qc(4*y-3)}{r}:{qc(4*y)}{r})'
            elif annual == 'last':
                v = f'={qc(4*y)}{r}'
            elif annual == 'avg':
                v = f'=AVERAGE({qc(4*y-3)}{r}:{qc(4*y)}{r})'
            elif annual == 'first':
                v = f'={qc(4*y-3)}{r}'
            put(ws, f'{yc(y)}{r}', v, 'calc', fmt, bold=bold, fill=fill)
    if note:
        put(ws, f'AE{r}', note, 'note')

def arow(ws, r, label, unit, f, fmt=FMT_BS, bold=False, kind=None, cols=ac, years=range(1, 6), fill=None, note=None, notecol='I'):
    put(ws, f'A{r}', label, 'label', bold=bold, fill=fill, border=True)
    put(ws, f'B{r}', unit, 'note'); ws[f'B{r}'].border = BORDER
    for y in years:
        v = f(y)
        k = kind or ('link' if is_link(v) else 'calc')
        put(ws, f'{cols(y)}{r}', v, k, fmt, bold=bold, fill=fill)
    if note:
        put(ws, f'{notecol}{r}', note, 'note')

def widths(ws, d):
    for k, v in d.items():
        ws.column_dimensions[k].width = v

def table(ws, r0, c0, headers, rows, kinds=None, fmts=None, wrapcols=()):
    """Write header + rows starting at row r0 col letter index c0 (int)."""
    for j, h in enumerate(headers):
        put(ws, f'{L(c0+j)}{r0}', h, 'hdr')
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            k = (kinds[j] if kinds else None)
            if k is None:
                k = 'link' if is_link(v) else ('calc' if isinstance(v, str) and v.startswith('=') else 'label')
            fm = fmts[j] if fmts else None
            c = put(ws, f'{L(c0+j)}{r0+1+i}', v, k, fm)
            if j in wrapcols: c.alignment = WRAP
    return r0 + len(rows)

# ---------------- Registro de series (para referencias entre hojas con distinto diseño) ----------------
class Reg(dict):
    misses = set()
    def __missing__(self, k):
        Reg.misses.add(k)
        return {'sheet': 'Supuestos', 'q': (lambda q: 'A1'), 'y': (lambda y: 'A1'), 'a0': 'A1'}
REG = Reg()
def reg(key, sheet, q=None, y=None, a0=None):
    REG[key] = {'sheet': sheet, 'q': q, 'y': y, 'a0': a0}
def Q(key, q):
    e = REG[key]; return f"'{e['sheet']}'!{e['q'](q)}"
def Y(key, y):
    e = REG[key]; return f"'{e['sheet']}'!{e['y'](y)}"
def A0(key):
    e = REG[key]
    return f"'{e['sheet']}'!{e['a0']}" if e.get('a0') else '0'
def QR(key, q1, q2):
    """rango de trimestres (misma fila) si la serie es una fila continua"""
    e = REG[key]; return f"'{e['sheet']}'!{e['q'](q1)}:{e['q'](q2)}"
def qk(q): return (q - 1) % 4 + 1
def grid(r0, col0=3):
    """tabla años x trimestres: fila r0 = 2027, columnas C..F (col0..col0+3)"""
    return lambda q: f"{L(col0 + qk(q) - 1)}{r0 + year_of(q) - 1}"
QL = ['1ER', '2DO', '3ER', '4TO']
def year_quarter_hdr(ws, r, c0, years=range(1, 6), merge=True, labels=None):
    """encabezado tipo Ñapefit: fila r con AÑO, fila r+1 con 1ER..4TO, columnas desde c0 (índice)"""
    for y in years:
        a = c0 + 4 * (y - 1)
        put(ws, f'{L(a)}{r}', 2026 + y, 'hdr')
        for k in range(4):
            put(ws, f'{L(a+k)}{r+1}', (labels or QL)[k], 'hdr')
            if k: ws[f'{L(a+k)}{r}'].fill = FILL_HDR; ws[f'{L(a+k)}{r}'].border = BORDER
        if merge: ws.merge_cells(f'{L(a)}{r}:{L(a+3)}{r}')
