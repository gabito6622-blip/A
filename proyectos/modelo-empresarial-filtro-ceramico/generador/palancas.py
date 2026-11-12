import openpyxl, json, sys, os, subprocess
BASE, OUTDIR = sys.argv[1], sys.argv[2]
RECALC = os.environ.get('RECALC', 'recalc.py')  # script que recalcula con LibreOffice
os.makedirs(OUTDIR, exist_ok=True)
src = openpyxl.load_workbook(BASE)
def cell_of(n):
    sh, c = list(src.defined_names[n].destinations)[0]; return sh, c.replace('$', '')
def run(ch, cells=None, i=[0]):
    i[0] += 1
    wb = openpyxl.load_workbook(BASE)
    for k, v in ch.items():
        sh, c = cell_of(k); wb[sh][c].value = v
    for (sh, c), v in (cells or {}).items(): wb[sh][c].value = v
    p = os.path.join(OUTDIR, f'p{i[0]}.xlsx'); wb.save(p)
    st = json.loads(subprocess.run(['python3', RECALC, p, '120'], capture_output=True, text=True).stdout)
    d = openpyxl.load_workbook(p, data_only=True)
    nv = lambda n: (lambda sh, c: d[sh][c.replace('$', '')].value)(*list(d.defined_names[n].destinations)[0])
    r = dict(van=nv('EV_VAN'), tir=nv('EV_TIR'), ok=nv('CTRL_OK'), tot=nv('CTRL_TOT'), err=st['total_errors'])
    os.remove(p); return r
cases = [('Base', {}, None),
         ('PVP Bs 420 (+7,7%)', {'PVP': 420}, None),
         ('Canal directo 50% (en vez de 40%)', {'MIX_DIRECTO': 0.5}, None),
         ('Contenedor a Bs 45 (en vez de 55)', {}, {('MP', 'F10'): 45}),
         ('Publicidad Bs 6.000/mes (en vez de 8.000)', {'PUBLICIDAD_MES': 6000}, None),
         ('Sin préstamo', {'PCT_PRESTAMO': 0}, None)]
out = []
for nm, ch, cells in cases:
    r = run(ch, cells); r['caso'] = nm; out.append(r); print(nm, round(r['van']), r['tir'], r['ok'], r['tot'], r['err'])
json.dump(out, open(os.path.join(OUTDIR, 'palancas.json'), 'w'), indent=1)
