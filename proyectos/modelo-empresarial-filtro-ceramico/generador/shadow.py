# Verificación independiente: recalcula en Python, desde los supuestos, cifras clave del libro y las compara.
import openpyxl, json, sys
f, rows = sys.argv[1], sys.argv[2]
R = json.load(open(rows)); wb = openpyxl.load_workbook(f, data_only=True)
def v(sh, c): return wb[sh][c].value
def nv(n):
    sh, c = R['_names'][n]; return wb[sh][c].value
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
chk('Unidades 2027 (escenario base)', v('Estado de resultado', f"Y{R['ER.u']}"), u27)
# ventas netas 2027
pprom = 420*(0.4+0.6*0.75)
chk('Ventas netas 2027', v('Estado de resultado', f"Y{R['ER.vn']}"), u27*pprom*0.87)
# unidades 2031: participación 5%*1.1^4, cobertura 80%
pop31 = urb24*(1+tasa_urb)**7
u31 = pop31/3.5*0.80*0.5*0.5*0.6*0.05*1.1**4
chk('Unidades 2031', v('Estado de resultado', f"AC{R['ER.u']}"), u31)
# planilla 1er trimestre (2 operarios)
tasa = 0.10+0.0171+0.035+0.02+0.0833+0.0833
chk('Costo laboral T1 2027', v('MANO DE OBRA', f"D{R['PER.tot']}"), (7000+5500+4000+2*3600)*3*(1+tasa))
# préstamo
TC = 12.06
acts = [(45000,.125),(3900*TC,.125),(1500*TC,.125),(1800*TC,.125),(500*TC,.125),(8000,.125),(6000,.125),(1800*TC,.125),(3500,.125),(6000,.25),(8000,.10),(3*540*TC,.25),(210*TC,.25)]
P = 0.5*sum(c for c,t in acts)/1.0; i = 0.115/4; n = 12
cuota = P*i/(1-(1+i)**-n)
chk('Cuota trimestral del préstamo', nv('CUOTA'), cuota)
chk('Intereses T1', v('Financiamiento', f"D{R['FIN.int']}"), P*i)
# depreciación T1
dep = sum(c*0.87*t/4 for c,t in acts)
chk('Depreciación T1', v('Maqu. y equip.', f"D{R['AF.dep']}"), dep)
# costo variable por kit
mat = 5*1.1*0.4 + 0.6*1.1*0.5 + 2*1.1*0.10*TC + 0.15*30 + 55 + 1.0*TC + 4 + 14.5
chk('Materiales por kit con factura', nv('MP_KIT_CF'), mat)
chk('Costo variable de producción neto', nv('CVP_KIT_NETO'), (mat + 6*1.1)*0.87)
# TRMA
ke = 0.0445 + 0.9*(0.1381-0.0445) + 0.0415
chk('TRMA en Bs', nv('TRMA'), (1+ke)*1.06/1.025-1)
# VAN y TIR con los flujos del libro
fl = [v('Rentabilidad', f"{c}{R['EV.fe']}") for c in 'CDEFGH']
t = nv('TRMA'); van = sum(x/(1+t)**k for k, x in enumerate(fl))
chk('VAN recalculado desde los flujos', nv('EV_VAN'), van)
lo, hi = -0.9, 5
for _ in range(200):
    mid = (lo+hi)/2
    if sum(x/(1+mid)**k for k, x in enumerate(fl)) > 0: lo = mid
    else: hi = mid
chk('TIR por bisección', nv('EV_TIR'), mid, 1e-4)
# punto de equilibrio 2027
g = lambda k: v('Estado de resultado', f"Y{R['ER.'+k]}")
cf = g('gop') - g('ent') - g('it'); cvu = (g('cv')+g('ent')+g('it'))/g('u'); p = g('vn')/g('u')
chk('Punto de equilibrio 2027 (kits)', v('Rentabilidad', f"C{R['PE.peu']}"), cf/(p-cvu))
# IVA anual: débito - crédito - saldo = pagado + variación saldo
df = sum(v('Carga impositiva', f"{openpyxl.utils.get_column_letter(3+q)}{R['IMP.df']}") for q in range(1, 21))
cfi = sum(v('Carga impositiva', f"{openpyxl.utils.get_column_letter(3+q)}{R['IMP.cf']}") for q in range(0, 21))
pag = sum(v('Carga impositiva', f"{openpyxl.utils.get_column_letter(3+q)}{R['IMP.pagar']}") for q in range(1, 21))
sal = v('Carga impositiva', f"W{R['IMP.sff']}")
chk('IVA: débito - crédito = pagado - saldo final a favor', df-cfi, pag-sal)
print(f"\n{sum(res)} de {len(res)} comprobaciones coinciden")
