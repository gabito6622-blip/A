from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

FONT = 'Arial'
F_IN = Font(name=FONT, size=10, color='0000FF')
F_CALC = Font(name=FONT, size=10, color='000000')
F_LINK = Font(name=FONT, size=10, color='008000')
F_LBL = Font(name=FONT, size=10)
F_LBLB = Font(name=FONT, size=10, bold=True)
F_HDR = Font(name=FONT, size=10, bold=True, color='FFFFFF')
F_TIT = Font(name=FONT, size=14, bold=True, color='1F4E5F')
F_SUB = Font(name=FONT, size=10, italic=True, color='555555')
F_SEC = Font(name=FONT, size=11, bold=True, color='1F4E5F')
FILL_IN = PatternFill('solid', fgColor='FFF2CC')
FILL_HDR = PatternFill('solid', fgColor='1F4E5F')
FILL_SEC = PatternFill('solid', fgColor='DDEBF7')
FILL_TOT = PatternFill('solid', fgColor='EDEDED')
FILL_KEY = PatternFill('solid', fgColor='FFFF00')
THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
WRAP = Alignment(wrap_text=True, vertical='top')
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)

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
        ws.sheet_view.showGridLines = False
        ws['A1'] = title; ws['A1'].font = F_TIT
        if subtitle:
            ws['A2'] = subtitle; ws['A2'].font = F_SUB
        ws['A3'] = '◄ Volver al índice'; ws['A3'].hyperlink = "#'INDICE'!A1"; ws['A3'].font = Font(name=FONT, size=9, color='0563C1', underline='single')
        if tab: ws.sheet_properties.tabColor = tab
        ws.column_dimensions['A'].width = 46
        ws.column_dimensions['B'].width = 14
        return ws
    def name(self, nm, sheet, cell):
        col = ''.join(ch for ch in cell if ch.isalpha()); row = ''.join(ch for ch in cell if ch.isdigit())
        ref = f"'{sheet}'!${col}${row}"
        self.wb.defined_names[nm] = DefinedName(nm, attr_text=ref)
        self.names[nm] = (sheet, cell)

def put(ws, cell, value, kind='calc', fmt=None, bold=False, fill=None, wrap=False, comment=None, align=None):
    c = ws[cell]
    c.value = value
    if kind == 'input':
        c.font = Font(name=FONT, size=10, color='0000FF', bold=bold); c.fill = FILL_IN
    elif kind == 'link':
        c.font = Font(name=FONT, size=10, color='008000', bold=bold)
    elif kind == 'label':
        c.font = Font(name=FONT, size=10, bold=bold)
        c.alignment = Alignment(vertical='top', wrap_text=wrap)
    elif kind == 'hdr':
        c.font = F_HDR; c.fill = FILL_HDR; c.alignment = CENTER
    elif kind == 'sec':
        c.font = F_SEC; c.fill = FILL_SEC
    elif kind == 'note':
        c.font = Font(name=FONT, size=9, italic=True, color='555555')
    else:
        c.font = Font(name=FONT, size=10, bold=bold)
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
        put(ws, f'{qc(q)}{row}', QLABEL[q-1], 'hdr')
        ws.column_dimensions[qc(q)].width = 12
    ws.column_dimensions['C'].width = 13
    ws.column_dimensions['X'].width = 3
    if annual:
        for y in range(1, 6):
            put(ws, f'{yc(y)}{row}', f'Año {2026+y}', 'hdr')
            ws.column_dimensions[yc(y)].width = 13
    ws.freeze_panes = f'C{row+1}'

def qrow(ws, r, label, unit, f, fmt=FMT_BS, c0=None, annual='sum', bold=False, kind=None, fill=None, note=None):
    """f(q) -> formula string for quarter q. c0: value/formula for Año 0 column C. annual: 'sum'|'last'|'avg'|None|callable(y)"""
    put(ws, f'A{r}', label, 'label', bold=bold, fill=fill)
    put(ws, f'B{r}', unit, 'note')
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
    put(ws, f'A{r}', label, 'label', bold=bold, fill=fill)
    put(ws, f'B{r}', unit, 'note')
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
