import openpyxl, json, sys
f = sys.argv[1]
wb = openpyxl.load_workbook(f, data_only=True)
R = json.load(open(sys.argv[2]))
def nv(name):
    dn = wb.defined_names[name]; sh, c = list(dn.destinations)[0]
    return wb[sh][c.replace('$','')].value
out = {}
for n in ['EV_VAN','EV_TIR','TRMA','EV_BC','EV_PRI','EV_PRID','INVERSION_TOTAL','PRESTAMO','APORTE_SOCIOS','CT_INICIAL','DIF_PAGO','AF_ANIO0','CTRL_OK','CTRL_TOT','EV_VAN_INV','EV_TIR_INV','CAP_ANUAL','N_MUESTRA','ACEPTACION','INC_SAL','WACC','MP_KIT_CF','CVP_KIT_NETO','EV_DECISION']:
    out[n] = nv(n)
for k,v in out.items(): print(f'{k:16s} {v}')
ws = wb['ESTADO_RESULTADOS']
def rowvals(sh, key, cols):
    return [wb[sh][f'{c}{R[key]}'].value for c in cols]
Y = ['Y','Z','AA','AB','AC']
for k in ['ER.u','ER.vn','ER.cv','ER.ub','ER.tfab','ER.tadm','ER.tcom','ER.it','ER.ebit','ER.int','ER.prima','ER.iue','ER.un']:
    print(f'{k:10s}', [round(x or 0) for x in rowvals('ESTADO_RESULTADOS', k, Y)])
print('caja', [round(x) for x in rowvals('FLUJO_CAJA','FC.sfin', ['C']+[openpyxl.utils.get_column_letter(3+q) for q in range(1,21)])])
print('balchk', rowvals('BALANCE_GENERAL','BAL.chk', ['C']+[openpyxl.utils.get_column_letter(3+q) for q in range(1,21)]))
print('FE', [round(x) for x in rowvals('EVALUACION','EV.fe', list('CDEFGH'))])
print('util', [round(x,3) for x in rowvals('CAPACIDAD','CAP.util', Y)])
print('ops', rowvals('PERSONAL','PER.ops', [openpyxl.utils.get_column_letter(3+q) for q in range(1,21)]))
print('PE', [round(x) for x in rowvals('PUNTO_EQUILIBRIO','PE.peu', list('CDEFG'))])
print('CT', [round(wb['INVERSION'][f'{c}{R["INV.ct_row"]}'].value) for c in 'BCDEF'])
c = wb['CONTROLES']
for r in range(6, 27):
    if c[f'B{r}'].value: print(r, c[f'B{r}'].value[:60], c[f'C{r}'].value, c[f'D{r}'].value)
