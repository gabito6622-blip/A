import openpyxl, json, sys, os, subprocess, shutil, tempfile, time
from openpyxl.utils import get_column_letter as L
BASE, ROWS, OUTDIR = sys.argv[1], sys.argv[2], sys.argv[3]
R = json.load(open(ROWS))
RECALC = os.environ.get('RECALC', 'recalc.py')  # script que recalcula con LibreOffice
os.makedirs(OUTDIR, exist_ok=True)
src = openpyxl.load_workbook(BASE)
def cell_of(name):
    sh, c = R['_names'][name]; return sh, c
N = 0
def run(changes, extra=None):
    global N; N += 1
    wb = openpyxl.load_workbook(BASE)
    for k, val in changes.items():
        sh, c = cell_of(k); wb[sh][c].value = val
    if extra: extra(wb)
    p = os.path.join(OUTDIR, f'run{N}.xlsx'); wb.save(p)
    out = subprocess.run(['python3', RECALC, p, '120'], capture_output=True, text=True, timeout=300)
    st = json.loads(out.stdout)
    assert st.get('status') == 'success', st
    d = openpyxl.load_workbook(p, data_only=True)
    def nv(n):
        sh, c = R['_names'][n]; return d[sh][c].value
    G = R['_reg']
    def cv(key, kind, i):
        e = G[key]; return d[e['sheet']][e[kind][i-1]].value
    def yv(key, y):
        e = G[key]
        if e['y']: return cv(key, 'y', y)
        return sum(cv(key, 'q', q) for q in range(4*y-3, 4*y+1))
    def allq(key, a0=True):
        e = G[key]; vals = [cv(key, 'q', q) for q in range(1, 21)]
        if a0 and e['a0']: vals = [d[e['sheet']][e['a0']].value] + vals
        return vals
    m = dict(van=nv('EV_VAN'), tir=nv('EV_TIR'), pri=nv('EV_PRI'), trma=nv('TRMA'),
             u1=yv('ER.u', 1), u5=yv('ER.u', 5), fact1=yv('CI.fact', 1), vn1=yv('ER.vn', 1), cv1=yv('ER.cv', 1),
             df1=yv('CI.df', 1), prod1=yv('INV.prod', 1), comp1=yv('COM.pago', 1),
             un1=yv('ER.un', 1), un5=yv('ER.un', 5), ebit1=yv('ER.ebit', 1),
             sue1=yv('PER.tot', 1), invtot=nv('INVERSION_TOTAL'),
             cajamin=min(allq('FC.sfin')), balabs=sum(abs(x) for x in allq('BAL.chk')),
             ctrl_ok=nv('CTRL_OK'), ctrl_tot=nv('CTRL_TOT'), errors=st['total_errors'],
             capok=min(allq('CAP.ok')), util5=yv('CAP.util', 5), acep=nv('ACEPTACION'), van_bs=nv('EV_VAN_BS'))
    c = d['Controles']; m['revisar'] = [c[f'B{r}'].value for r in range(6, 30) if c[f'D{r}'].value == 'REVISAR']
    os.remove(p)
    return m

t0 = time.time()
base = run({})
print('base', round(base['van']), base['tir'], base['ctrl_ok'], base['ctrl_tot'], base['balabs'])
results = {'base': base}
# 1) Escenarios
scen = {}
for code, nm in [(1, 'Pesimista'), (2, 'Base'), (3, 'Optimista')]:
    scen[nm] = run({'ESCENARIO': code}); print(nm, round(scen[nm]['van']))
# 2) Sensibilidad
cols = ['-20%', '-10%', '+10%', '+20%']; deltas = [-0.2, -0.1, 0.1, 0.2]
vars_ = [('Precio de venta (M_PRECIO)', 'M_PRECIO'), ('Unidades vendidas (M_DEMANDA)', 'M_DEMANDA'), ('Costo variable (M_CVAR)', 'M_CVAR'),
         ('Gastos fijos sin sueldos (M_FIJOS)', 'M_FIJOS'), ('Sueldos (M_SALARIOS)', 'M_SALARIOS'), ('Inversión en activos (M_INVERSION)', 'M_INVERSION')]
sens = []; sensruns = {}
for lbl, nm in vars_:
    vans, tirs = [], []
    for dlt in deltas:
        m = run({nm: 1 + dlt}); vans.append(m['van']); tirs.append(m['tir']); sensruns[(nm, dlt)] = m
    sens.append({'var': lbl, 'van': [vans[0], vans[1], base['van'], vans[2], vans[3]], 'tir': [tirs[0], tirs[1], base['tir'], tirs[2], tirs[3]]})
    print(lbl, [round(x) for x in vans])
# TRMA relativa
ke = 0.0445 + 0.9*(0.1381-0.0445) + 0.0415
T = base['trma']; vans, tirs = [], []
for dlt in deltas:
    Tn = T*(1+dlt); x = (1+Tn)*(1+0.025)/(1+0.06) - 1 - ke
    m = run({'PRIMA_ADIC': x}); vans.append(m['van']); tirs.append(m['tir'])
sens.append({'var': 'TRMA (PRIMA_ADIC ajustada)', 'van': [vans[0], vans[1], base['van'], vans[2], vans[3]], 'tir': [tirs[0], tirs[1], base['tir'], tirs[2], tirs[3]]})
print('TRMA', [round(x) for x in vans])
cols5 = ['-20%', '-10%', 'Base', '+10%', '+20%']
# 3) Puntos críticos por secante
crit = []
for lbl, nm, equiv in [('Precio de venta', 'M_PRECIO', 'PVP 2027 = Bs {:.0f}'), ('Unidades vendidas', 'M_DEMANDA', 'ventas 2027 = {:.0f} kits'),
                       ('Costo variable', 'M_CVAR', 'costo variable = Bs {:.2f}/kit'), ('Gastos fijos sin sueldos', 'M_FIJOS', 'x{:.3f}')]:
    x0, f0 = 1.0, base['van']
    x1 = 0.9 if nm in ('M_PRECIO', 'M_DEMANDA') else 1.1
    f1 = sensruns[(nm, round(x1-1, 1))]['van']
    for _ in range(4):
        if f1 == f0: break
        x2 = x1 - f1*(x1-x0)/(f1-f0)
        m = run({nm: x2}); x0, f0, x1, f1 = x1, f1, x2, m['van']
        if abs(f1) < 40: break
    if nm == 'M_PRECIO': eq = equiv.format(420*x1)
    elif nm == 'M_DEMANDA': eq = equiv.format(base['u1']*x1)
    elif nm == 'M_CVAR': eq = equiv.format(88.6036*x1)
    else: eq = f'gastos fijos x{x1:.3f}'
    crit.append({'var': lbl, 'mult': x1, 'equiv': eq, 'holgura': x1-1, 'van_final': f1})
    print('critico', lbl, x1, f1)
# 4) Estrés combinado y pruebas de coherencia
def setcob(wb):
    s = wb['Supuestos']
    for n in ['COB_2029', 'COB_2030', 'COB_2031']:
        sh, c = cell_of(n); s0, c0 = R['_names']['COB_2027']; wb[sh][c].value = f"='{s0}'!${''.join(ch for ch in c0 if ch.isalpha())}${''.join(ch for ch in c0 if ch.isdigit())}"
stress = [('Pesimista', {'ESCENARIO': 1}, None), ('Optimista', {'ESCENARIO': 3}, None),
          ('Precio -10% y costo variable +10%', {'M_PRECIO': 0.9, 'M_CVAR': 1.1}, None),
          ('Sin crecimiento de participación (CRECE_PART = 0)', {'CRECE_PART': 0}, None),
          ('Sin expansión metropolitana (cobertura fija)', {}, setcob),
          ('Inflación 10% y tipo de cambio 15 Bs/USD', {'INFL_BO': 0.10, 'TIPO_CAMBIO': 15}, None),
          ('Capital de trabajo por período de desfase (METODO_CT = 1)', {'METODO_CT': 1}, None),
          ('Valor residual por perpetuidad (METODO_VR = 2)', {'METODO_VR': 2}, None),
          ('Sin préstamo (PCT_PRESTAMO = 0)', {'PCT_PRESTAMO': 0}, None),
          ('Demanda +80% (prueba de capacidad)', {'M_DEMANDA': 1.8}, None),
          ('Precio -30% (prueba de alerta)', {'M_PRECIO': 0.7}, None)]
estres = []
for nm, ch, ex in stress:
    m = run(ch, ex)
    estres.append({'caso': nm, 'van': m['van'], 'tir': m['tir'], 'cajamin': m['cajamin'], 'balance': 'Sí' if m['balabs'] < 1 else 'NO',
                   'ctrl': f"{m['ctrl_ok']} de {m['ctrl_tot']}", 'revisar': m['revisar'], 'm': m})
    print('estres', nm, round(m['van']), m['ctrl_ok'], m['revisar'])
# Pruebas de coherencia entre estados
tests = []
def T_(name, cond, detail):
    tests.append({'prueba': name, 'ok': bool(cond), 'detalle': detail}); print('OK ' if cond else 'XX ', name, detail)
mP = sensruns[('M_PRECIO', -0.1)]; mD = sensruns[('M_DEMANDA', -0.2)]; mC = sensruns[('M_CVAR', 0.1)]; mS = sensruns[('M_SALARIOS', 0.1)]
T_('Precio -10%: unidades sin cambio', abs(mP['u1']-base['u1']) < 1e-6, f"{mP['u1']:.2f} vs {base['u1']:.2f}")
T_('Precio -10%: ventas facturadas -10%', abs(mP['fact1']/base['fact1']-0.9) < 1e-9, f"ratio {mP['fact1']/base['fact1']:.6f}")
T_('Precio -10%: IVA débito -10%', abs(mP['df1']/base['df1']-0.9) < 1e-9, f"ratio {mP['df1']/base['df1']:.6f}")
T_('Precio -10%: costo de ventas sin cambio', abs(mP['cv1']-base['cv1']) < 0.01, f"{mP['cv1']:.2f} vs {base['cv1']:.2f}")
T_('Precio -10%: VAN baja', mP['van'] < base['van'], f"{mP['van']:.0f} < {base['van']:.0f}")
T_('Demanda -20%: unidades -20%', abs(mD['u1']/base['u1']-0.8) < 1e-9, f"ratio {mD['u1']/base['u1']:.6f}")
T_('Demanda -20%: producción baja (≈ -20%, redondeo)', abs(mD['prod1']/base['prod1']-0.8) < 0.01, f"ratio {mD['prod1']/base['prod1']:.4f}")
T_('Demanda -20%: compras bajan', mD['comp1'] < base['comp1'], f"{mD['comp1']:.0f} < {base['comp1']:.0f}")
T_('Demanda -20%: costo de ventas ≈ -20%', abs(mD['cv1']/base['cv1']-0.8) < 0.01, f"ratio {mD['cv1']/base['cv1']:.4f}")
T_('Costo variable +10%: costo de ventas +10%', abs(mC['cv1']/base['cv1']-1.1) < 1e-6, f"ratio {mC['cv1']/base['cv1']:.6f}")
T_('Costo variable +10%: ventas sin cambio', abs(mC['vn1']-base['vn1']) < 0.01, '')
T_('Sueldos +10%: planilla +10%', abs(mS['sue1']/base['sue1']-1.1) < 1e-6, f"ratio {mS['sue1']/base['sue1']:.6f}")
T_('Monotonía: VAN crece con el precio', all(sens[0]['van'][i] < sens[0]['van'][i+1] for i in range(4)), '')
T_('Monotonía: VAN crece con las unidades', all(sens[1]['van'][i] < sens[1]['van'][i+1] for i in range(4)), '')
T_('Monotonía: VAN baja con el costo variable', all(sens[2]['van'][i] > sens[2]['van'][i+1] for i in range(4)), '')
T_('Monotonía: VAN baja con la TRMA', all(sens[-1]['van'][i] > sens[-1]['van'][i+1] for i in range(4)), '')
T_('Escenarios ordenados: pesimista < base < optimista', scen['Pesimista']['van'] < scen['Base']['van'] < scen['Optimista']['van'], '')
for e in estres:
    T_(f"Balance cuadra en estrés: {e['caso']}", e['balance'] == 'Sí', '')
    T_(f"Sin errores de fórmula en estrés: {e['caso']}", e['m']['errors'] == 0, '')
dem = [e for e in estres if e['caso'].startswith('Demanda +80%')][0]
T_('Demanda +80%: el control de capacidad lo detecta', any('capacidad' in s for s in dem['revisar']), str(dem['revisar']))
p30 = [e for e in estres if e['caso'].startswith('Precio -30%')][0]
T_('Precio -30%: el modelo marca VAN negativo y alertas', p30['van'] < 0 and len(p30['revisar']) > 0, str(p30['revisar']))
# Encuesta: prueba del interruptor (datos de prueba, NO se guardan en el modelo)
def survey(wb):
    s = wb['Muestra y encuesta']; s['B25'] = 100; s['B26'] = 120; s['B27'] = 80; s['B28'] = 60; s['B29'] = 40
mE = run({}, survey)
T_('Encuesta (datos de prueba, no guardados): con 400 respuestas la aceptación pasa a la medida (55%)', abs(mE['acep'] - 0.55) < 1e-9, f"aceptación {mE['acep']}")
snap = {'fecha': '12/11/2026', 'sens_cols': cols5, 'sens': sens, 'criticos': crit,
        'estres': [{k: v for k, v in e.items() if k not in ('m',)} for e in estres],
        'casos': [{'caso': nm, 'van': scen[nm]['van'], 'tir': scen[nm]['tir'], 'pri': scen[nm]['pri'] if isinstance(scen[nm]['pri'], (int, float)) else str(scen[nm]['pri']), 'ventas1': scen[nm]['u1'], 'un5': scen[nm]['un5'], 'cajamin': scen[nm]['cajamin'], 'balance': 'Sí' if scen[nm]['balabs'] < 1 else 'NO'} for nm in ['Pesimista', 'Base', 'Optimista']] +
                 [{'caso': e['caso'], 'van': e['van'], 'tir': e['tir'], 'pri': '', 'ventas1': e['m']['u1'], 'un5': e['m']['un5'], 'cajamin': e['cajamin'], 'balance': e['balance']} for e in estres[2:9]]}
json.dump(snap, open(os.path.join(OUTDIR, 'snapshot.json'), 'w'), indent=1, default=str)
json.dump({'tests': tests, 'base': base, 'scen': scen, 'estres': [{k: v for k, v in e.items()} for e in estres], 'runs': N, 'segundos': time.time()-t0}, open(os.path.join(OUTDIR, 'tests.json'), 'w'), indent=1, default=str)
print('runs', N, 'seg', round(time.time()-t0), 'tests ok', sum(t['ok'] for t in tests), 'de', len(tests))
