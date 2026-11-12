# Mide el parecido con la plantilla: cuántos títulos de la plantilla están en la misma celda del clon.
# Uso: python3 parecido.py <plantilla.xlsx> <clon.xlsx>
import openpyxl, sys
o = openpyxl.load_workbook(sys.argv[1]); m = openpyxl.load_workbook(sys.argv[2])
def labels(ws): return {c.coordinate for row in ws.iter_rows() for c in row if isinstance(c.value, str) and not c.value.startswith('=')}
tot_a = tot_ab = 0
for sh in o.sheetnames:
    a, b = labels(o[sh]), labels(m[sh]); tot_a += len(a); tot_ab += len(a & b)
    print(f'{sh:22s} orig {len(a):4d}  misma celda {len(a & b):4d} ({len(a&b)/max(1,len(a)):.0%})')
print('TOTAL', tot_ab, 'de', tot_a, f'{tot_ab/tot_a:.0%}')
