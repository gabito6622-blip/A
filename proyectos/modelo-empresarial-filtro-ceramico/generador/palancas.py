import openpyxl, json, sys, os, subprocess
BASE, OUTDIR = sys.argv[1], sys.argv[2]
R = json.load(open(BASE + '.rows.json'))
RECALC = os.environ.get('RECALC', 'recalc.py')  # script que recalcula con LibreOffice
os.makedirs(OUTDIR, exist_ok=True)
src = openpyxl.load_workbook(BASE)
def cell_of(n):
    sh, c = R['_names'][n]; return sh, c
def run(ch, cells=None, i=[0]):
    i[0] += 1
    wb = openpyxl.load_workbook(BASE)
    for k, v in ch.items():
        sh, c = cell_of(k); wb[sh][c].value = v
    for (sh, c), v in (cells or {}).items(): wb[sh][c].value = v
    p = os.path.join(OUTDIR, f'p{i[0]}.xlsx'); wb.save(p)
    st = json.loads(subprocess.run(['python3', RECALC, p, '120'], capture_output=True, text=True).stdout)
    d = openpyxl.load_workbook(p, data_only=True)
    nv = lambda n: (lambda sh, c: d[sh][c].value)(*R['_names'][n])
    r = dict(van=nv('EV_VAN'), tir=nv('EV_TIR'), ok=nv('CTRL_OK'), tot=nv('CTRL_TOT'), err=st['total_errors'], inv=nv('INVERSION_TOTAL'), af=nv('AF_ANIO0'), mp=nv('MP_KIT_CF'), invusd=d['Inversión']['F'+str([rr for rr in range(1,80) if d['Inversión']['A'+str(rr)].value=='INVERSIÓN TOTAL'][0])].value)
    os.remove(p); return r
cases = [('Base (PVP Bs 420, TC 12,06)', {}, None),
         ('Mismo filtro 2.0 a Bs 390', {'PVP': 390}, None),
         ('Tipo de cambio 12', {'TIPO_CAMBIO': 12}, None),
         ('Tipo de cambio 15', {'TIPO_CAMBIO': 15}, None),
         ('Tipo de cambio 9', {'TIPO_CAMBIO': 9}, None),
         ('Canal directo 50%', {'MIX_DIRECTO': 0.5}, None),
         ('Contenedor a Bs 45', {}, {('MP', 'G11'): 45})]
out = []
for nm, ch, cells in cases:
    r = run(ch, cells); r['caso'] = nm; out.append(r); print(nm, '| VAN', round(r['van']), '| TIR', round(r['tir'],4), '| inv', round(r['inv']), '| activos', round(r['af']), '| MP/kit', round(r['mp'],2), '| inv $us', round(r['invusd']), '| ctrl', r['ok'], r['tot'], 'err', r['err'])
json.dump(out, open(os.path.join(OUTDIR, 'palancas.json'), 'w'), indent=1)
