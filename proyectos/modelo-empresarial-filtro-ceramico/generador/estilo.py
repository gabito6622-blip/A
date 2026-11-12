"""Copia los colores de relleno de la plantilla original (mismas celdas) a las 20 hojas del clon."""
import colorsys, openpyxl
from collections import Counter
from openpyxl.styles import PatternFill, Font
from lib import FILL_HDR, FILL_BAR
THEME = {0: 'FFFFFF', 1: '000000', 2: 'E7E6E6', 3: '44546A', 4: '4472C4', 5: 'ED7D31', 6: 'A5A5A5', 7: 'FFC000', 8: '5B9BD5', 9: '70AD47'}

def _rgb(color):
    if color is None: return None
    if color.type == 'rgb' and color.rgb and isinstance(color.rgb, str): return color.rgb[-6:]
    if color.type == 'theme' and color.theme in THEME:
        base = THEME[color.theme]; t = color.tint or 0
        r, g, b = (int(base[i:i+2], 16) / 255 for i in (0, 2, 4))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        l = l * (1 + t) if t < 0 else l * (1 - t) + t
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return ''.join(f'{round(x*255):02X}' for x in (r, g, b))
    return None

def _dark(hexrgb):
    r, g, b = (int(hexrgb[i:i+2], 16) for i in (0, 2, 4))
    return 0.299*r + 0.587*g + 0.114*b < 140

def aplicar(wb, plantilla, hojas):
    o = openpyxl.load_workbook(plantilla)
    for sh in hojas:
        if sh not in o.sheetnames or sh not in wb.sheetnames: continue
        a, b = o[sh], wb[sh]
        cnt = Counter()
        for row in a.iter_rows():
            for c in row:
                if c.fill and c.fill.fill_type == 'solid' and c.font and c.font.b:
                    col = _rgb(c.fill.fgColor)
                    if col and col not in ('FFFFFF',): cnt[col] += 1
        dom = cnt.most_common(1)[0][0] if cnt else None
        done = set()
        for row in a.iter_rows():
            for c in row:
                if not (c.fill and c.fill.fill_type == 'solid'): continue
                col = _rgb(c.fill.fgColor)
                if not col or col == 'FFFFFF': continue
                d = b[c.coordinate]
                if d.value is None and not (d.fill and d.fill.fill_type == 'solid'): continue
                d.fill = PatternFill('solid', fgColor=col); done.add(c.coordinate)
                f = d.font
                d.font = Font(name=f.name, size=f.size, bold=f.b, italic=f.i, color='FFFFFF' if _dark(col) else '000000')
        if dom:
            for row in b.iter_rows():
                for d in row:
                    if d.coordinate in done or not (d.fill and d.fill.fill_type == 'solid'): continue
                    cur = d.fill.fgColor.rgb[-6:] if isinstance(d.fill.fgColor.rgb, str) else ''
                    if cur == 'FFD966':
                        d.fill = PatternFill('solid', fgColor=dom)
                        f = d.font; d.font = Font(name=f.name, size=f.size, bold=f.b, italic=f.i, color='FFFFFF' if _dark(dom) else '000000')
