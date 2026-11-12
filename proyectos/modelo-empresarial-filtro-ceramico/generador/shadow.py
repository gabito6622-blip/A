# Verificación independiente: recalcula en Python, desde los supuestos, cifras clave del libro y las compara.
import openpyxl, json, sys
f, rows = sys.argv[1], sys.argv[2]
R = json.load(open(rows)); wb = openpyxl.load_workbook(f, data_only=True)
def v(sh, c): return wb[sh][c].value
def nv(n):
    sh, c = R['_names'][n]; return wb[sh][c].value
G = R['_reg']
def cv(key, kind, i):
    e = G[key]; return wb[e['sheet']][e[kind][i-1]].value
def a0(key):
    e = G[key]; return wb[e['sheet']][e['a0']].value
TC = nv('TIPO_CAMBIO')
res = []
def chk(name, model, mine, tol=0.01):
    ok = abs(model - mine) <= tol * max(1, abs(mine))
    res.append(ok); print(f"{'OK ' if ok else 'XX '} {name:55s} modelo={model:,.4f}  python={mine:,.4f}")
# demanda 2027
urb24 = 426053/0.197193900338752 + 426053
tasa_urb = 1.58729494393037/100
pop27 = urb24*(1+tasa_urb)**3
hog = pop27/3.5; cob = 1601724/urb24
u27 = hog*cob*0.5*0.5*0.6*0.05
chk('Unidades 2027 (escenario base)', cv('ER.u', 'y', 1), u27)
# ventas netas 2027
pprom = 420*(0.4+0.6*0.75)
chk('Ventas netas 2027 ($us)', cv('ER.vn', 'y', 1), u27*pprom*0.87/TC)
# unidades 2031: participación 5%*1.1^4, cobertura 80%
pop31 = urb24*(1+tasa_urb)**7
u31 = pop31/3.5*0.80*0.5*0.5*0.6*0.05*1.1**4
chk('Unidades 2031', cv('ER.u', 'y', 5), u31)
# planilla 1er trimestre (2 operarios)
tasa = 0.10+0.0171+0.035+0.02+0.0833+0.0833
chk('Costo laboral T1 2027 ($us)', cv('PER.tot', 'q', 1), (7000+5500+4000+2*3600)*3*(1+tasa)/TC)
# préstamo
acts = [(45000,.125),(3900*TC,.125),(1500*TC,.125),(1800*TC,.125),(500*TC,.125),(8000,.125),(6000,.125),(1800*TC,.125),(3500,.125),(6000,.25),(8000,.10),(3*540*TC,.25),(210*TC,.25)]
P = 0.5*sum(c for c,t in acts)/1.0; i = 0.115/4; n = 12
cuota = P*i/(1-(1+i)**-n)
chk('Cuota trimestral del préstamo ($us)', nv('CUOTA'), cuota/TC)
chk('Intereses T1 ($us)', cv('FIN.int', 'q', 1), P*i/TC)
# depreciación T1
dep = sum(c*0.87*t/4 for c,t in acts)
chk('Depreciación T1 ($us)', cv('AF.dep', 'q', 1), dep/TC)
# costo variable por kit
mat = 5*1.1*0.4 + 0.6*1.1*0.5 + 2*1.1*0.10*TC + 0.15*30 + 55 + 1.0*TC + 4 + 14.5
chk('Materiales por kit con factura', nv('MP_KIT_CF'), mat)
chk('Costo variable de producción neto', nv('CVP_KIT_NETO'), (mat + 6*1.1)*0.87)
# TRMA
ke = 0.0445 + 0.9*(0.1381-0.0445) + 0.0415
chk('TRMA en Bs', nv('TRMA'), (1+ke)*1.06/1.025-1)
# VAN y TIR con los flujos del libro
fl = [v('Rentabilidad', f"{c}{R['EV.fe']}") for c in 'CDEFGH']
chk('VAN en Bs = VAN en $us x tipo de cambio', nv('EV_VAN_BS'), nv('EV_VAN')*TC)
t = nv('TRMA'); van = sum(x/(1+t)**k for k, x in enumerate(fl))
chk('VAN recalculado desde los flujos', nv('EV_VAN'), van)
lo, hi = -0.9, 5
for _ in range(200):
    mid = (lo+hi)/2
    if sum(x/(1+mid)**k for k, x in enumerate(fl)) > 0: lo = mid
    else: hi = mid
chk('TIR por bisección', nv('EV_TIR'), mid, 1e-4)
# punto de equilibrio 2027
g = lambda k: cv('ER.' + k, 'y', 1)
cf = g('gop') - g('ent') - g('it'); cvu = (g('cv')+g('ent')+g('it'))/g('u'); p = g('vn')/g('u')
chk('Punto de equilibrio 2027 (filtros)', cv('PE.peu', 'y', 1), cf/(p-cvu))
# IVA de los 5 años
df = sum(cv('CI.df', 'q', q) for q in range(1, 21))
cfi = a0('CI.sff') + sum(cv('CI.cf', 'q', q) for q in range(1, 21))
pag = sum(cv('CI.pagar', 'q', q) for q in range(1, 21))
sal = cv('CI.sff', 'q', 20)
chk('IVA: débito - crédito = pagado - saldo final a favor', df-cfi, pag-sal)
# balance
chk('Balance: activo = pasivo + patrimonio al cierre de 2031', cv('BAL.at', 'q', 20), cv('BAL.pp', 'q', 20))
print(f"\n{sum(res)} de {len(res)} comprobaciones coinciden")
