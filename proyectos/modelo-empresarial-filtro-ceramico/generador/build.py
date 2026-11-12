import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import b1_supuestos as b1
from b1_supuestos import ROW, RowMap
import b2_mercado as b2, b7_sim as b7, b8_docs as b8

SRC = sys.argv[1]; OUT = sys.argv[2]
SNAP = sys.argv[3] if len(sys.argv) > 3 else None

ORDER = [
 ('Santa Cruz', 'Ñapefit', 'Población departamental (INE, Cuadros 3 y 8) y proyección'),
 ('Zona urbana', 'Ñapefit', 'Población del municipio por área y edad (INE, Cuadro 4)'),
 ('Demanda', 'Ñapefit', 'Demanda potencial y efectiva'),
 ('Pronostico', 'Ñapefit', 'Tres escenarios y pronóstico trimestral'),
 ('Inventario', 'Ñapefit', 'Plan de producción e inventario en unidades'),
 ('Inv. terminado', 'Ñapefit', 'Inventario de producto terminado en unidades y $us; costo de ventas'),
 ('MP', 'Ñapefit', 'Materiales por kit, costo unitario y proveedores'),
 ('Capacidad Inst.', 'Ñapefit', 'Capacidad por etapa, cuello de botella y utilización'),
 ('Infraestructura', 'Ñapefit', 'Elección del local y puesta en marcha'),
 ('Compras', 'Ñapefit', 'Programa de compras de materiales'),
 ('Maqu. y equip.', 'Ñapefit', 'Activos fijos y depreciación'),
 ('MANO DE OBRA', 'Ñapefit', 'Cargos, planillas por año, cargas sociales y planilla trimestral'),
 ('Otros gastos', 'Ñapefit', 'Gastos operativos por área'),
 ('Precio', 'Ñapefit', 'Precio por canal, método de costo y margen de contribución'),
 ('Inversión', 'Ñapefit', 'Inversión fija, diferida, puesta en marcha y capital de trabajo'),
 ('Estado de resultado', 'Ñapefit', 'Estado de resultados trimestral y anual'),
 ('Carga impositiva', 'Ñapefit', 'IVA, IT, IUE y prima'),
 ('Flujo de caja', 'Ñapefit', 'Flujo de caja directo'),
 ('TRMA', 'Ñapefit', 'Tasa de descuento (CAPM + riesgo país + inflación de Bolivia)'),
 ('Rentabilidad', 'Ñapefit', 'Flujo de fondos, VAN, TIR, PRI, B/C y punto de equilibrio'),
 ('Supuestos', 'Nuevo', 'Datos del proyecto'),
 ('Calendario', 'Nuevo', 'Trimestres e índices de precios, costos y sueldos'),
 ('Financiamiento', 'Nuevo', 'Préstamo bancario y tabla de amortización'),
 ('Balance general', 'Nuevo', 'Balance general trimestral'),
 ('Ratios', 'Nuevo', 'Indicadores financieros'),
 ('Sensibilidad', 'Nuevo', 'Sensibilidad, puntos críticos y estrés'),
 ('SIMULADOR EMPRESARIAL', 'Nuevo', 'Decisiones por período y sus consecuencias'),
 ('DECISIONES Y ESCENARIOS', 'Nuevo', 'Escenarios y comparación de decisiones'),
 ('CONTROL DE PERIODOS', 'Nuevo', 'Plan vs. real por trimestre'),
 ('Dashboard', 'Nuevo', 'Resumen de resultados'),
 ('Controles', 'Nuevo', 'Verificaciones del modelo'),
 ('Producto', 'Nuevo', 'Descripción del producto, problema, segmentación y ahorro'),
 ('Selección de producto', 'Nuevo', 'Cinco productos evaluados con 14 criterios'),
 ('Muestra y encuesta', 'Nuevo', 'Tamaño de muestra, cuestionario y tabulación'),
 ('Competencia', 'Nuevo', 'Competidores, sustitutos y fuerzas de Porter'),
 ('Estrategia comercial', 'Nuevo', 'Mezcla de marketing, canales y gastos comerciales'),
 ('Proceso productivo', 'Nuevo', 'Etapas, equipos, tiempos y controles'),
 ('Fuentes', 'Nuevo', 'Fuentes y bibliografía'),
 ('Índice', 'Nuevo', 'Este índice'),
]

import c_mercado as cm, c_prod as cp, c_costos as cc, c_costos2 as cc2, c_fin as cf, c_eval as ce, c_anexos as ca, c_anexos2 as ca2
from lib import REG, Reg

def build_all():
    B = Book()
    b1.build_supuestos(B); b1.build_calendario(B)
    cm.build_santa_cruz(B, SRC); cm.build_zona_urbana(B, SRC); cm.build_demanda(B); cm.build_pronostico(B)
    cp.build_inventario(B); cp.build_inv_terminado(B); cp.build_mp(B); cp.build_capacidad(B); cp.build_infraestructura(B); cp.build_compras(B)
    cc.build_maquinaria(B); cc.build_mano_obra(B); cc.build_otros_gastos(B)
    cc2.build_precio(B); cc2.build_inversion(B)
    cf.build_er(B); cf.build_carga(B); cf.build_flujo(B); cf.build_trma(B, SRC)
    ce.build_rentabilidad(B)
    ca.build_financiamiento(B); ca.build_balance(B); ca.build_ratios(B)
    b7.build_simulador(B); dec = b7.build_decisiones(B); b7.build_control(B)
    b2.build_muestra(B); b2.build_producto(B)
    b8.build_seleccion(B); b8.build_competencia(B); ca2.build_estrategia(B); b8.build_proceso(B)
    b8.build_fuentes(B); ca2.build_controles(B); sen = ca2.build_sensibilidad(B); ca2.build_dashboard(B)
    b8.build_indice(B, ORDER)
    return B, dec, sen

def write_snapshot(B, dec, sen, snap):
    r0 = ROW['DEC.snap_hdr'] + 1
    for i, row in enumerate(snap.get('casos', [])):
        r = r0 + i
        vals = [row['caso'], row['van'], row['tir'], row['pri'], row['ventas1'], row['un5'], row['cajamin'], row['balance']]
        fm = [None, FMT_BS, FMT_PCT2, FMT_BS2, FMT_U, FMT_BS, FMT_BS, None]
        for j, v in enumerate(vals): put(dec, f'{L(1+j)}{r}', v, 'label', fm[j])
    r = ROW['SEN.start']
    put(sen, f'A{r}', f"Corridas registradas el {snap.get('fecha','')} (escenario base). Los valores de esta sección son resultados guardados, no fórmulas.", 'note'); r += 1
    put(sen, f'A{r}', 'A. VAN ($us) ante cambios de una variable a la vez', 'sec'); r += 1
    cols = snap['sens_cols']
    put(sen, f'A{r}', 'Variable (celda que se cambia)', 'hdr')
    for j, c in enumerate(cols): put(sen, f'{L(2+j)}{r}', c, 'hdr')
    r += 1; t0 = r
    for row in snap['sens']:
        put(sen, f'A{r}', row['var'], 'label')
        for j, v in enumerate(row['van']): put(sen, f'{L(2+j)}{r}', v, 'label', FMT_BS)
        r += 1
    t1 = r - 1; r += 1
    put(sen, f'A{r}', 'B. TIR ante los mismos cambios', 'sec'); r += 1
    put(sen, f'A{r}', 'Variable', 'hdr')
    for j, c in enumerate(cols): put(sen, f'{L(2+j)}{r}', c, 'hdr')
    r += 1
    for row in snap['sens']:
        put(sen, f'A{r}', row['var'], 'label')
        for j, v in enumerate(row['tir']): put(sen, f'{L(2+j)}{r}', v, 'label', FMT_PCT2)
        r += 1
    r += 1
    put(sen, f'A{r}', 'C. PUNTOS CRÍTICOS (valor de la variable que hace VAN = 0, con todo lo demás constante)', 'sec'); r += 1
    for j, h in enumerate(['Variable', 'Valor crítico (multiplicador)', 'Equivale a', 'Holgura frente al base']): put(sen, f'{L(1+j)}{r}', h, 'hdr')
    r += 1
    for row in snap['criticos']:
        put(sen, f'A{r}', row['var'], 'label'); put(sen, f'B{r}', row['mult'], 'label', '0.000'); put(sen, f'C{r}', row['equiv'], 'label'); put(sen, f'D{r}', row['holgura'], 'label', FMT_PCT); r += 1
    r += 1
    put(sen, f'A{r}', 'D. ESTRÉS COMBINADO', 'sec'); r += 1
    for j, h in enumerate(['Caso', 'VAN ($us)', 'TIR', 'Caja mínima ($us)', 'Balance cuadra', 'Controles OK']): put(sen, f'{L(1+j)}{r}', h, 'hdr')
    r += 1
    for row in snap['estres']:
        vals = [row['caso'], row['van'], row['tir'], row['cajamin'], row['balance'], row['ctrl']]
        fm = [None, FMT_BS, FMT_PCT2, FMT_BS, None, None]
        for j, v in enumerate(vals): put(sen, f'{L(1+j)}{r}', v, 'label', fm[j])
        r += 1
    # gráfico tornado (barras) con -10% / +10%
    ch = BarChart(); ch.type = 'bar'; ch.title = 'VAN ante -10% y +10% en cada variable ($us)'; ch.height = 9; ch.width = 18
    i_m10 = cols.index('-10%'); i_p10 = cols.index('+10%')
    ch.add_data(Reference(sen, min_col=2+i_m10, min_row=t0-1, max_row=t1), titles_from_data=True)
    ch.add_data(Reference(sen, min_col=2+i_p10, min_row=t0-1, max_row=t1), titles_from_data=True)
    ch.set_categories(Reference(sen, min_col=1, min_row=t0, max_row=t1))
    sen.add_chart(ch, f'A{r+2}')

from openpyxl.chart import BarChart, Reference
# pasada 1: llenar mapa de filas; pasada 2: construir con referencias completas
build_all()
RowMap.misses = set(); Reg.misses = set()
B, dec, sen = build_all()
if RowMap.misses or Reg.misses:
    print('FALTAN FILAS:', RowMap.misses, 'FALTAN SERIES:', Reg.misses); sys.exit(1)
if SNAP and os.path.exists(SNAP):
    write_snapshot(B, dec, sen, json.load(open(SNAP)))
import re
NAMES = dict(B.names)
def _ref(nm):
    sh, cell = NAMES[nm]
    col = ''.join(ch for ch in cell if ch.isalpha()); row = ''.join(ch for ch in cell if ch.isdigit())
    return f"'{sh}'!${col}${row}"
pats = [(re.compile(r"(?<![A-Za-z0-9_\.'!$])" + re.escape(nm) + r"(?![A-Za-z0-9_(])"), _ref(nm)) for nm in sorted(NAMES, key=len, reverse=True)]
def _conv(f):
    parts = f.split('"')
    for i in range(0, len(parts), 2):
        for p, rf in pats:
            parts[i] = p.sub(lambda m: rf, parts[i])
    return '"'.join(parts)
for ws in B.wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('='):
                c.value = _conv(c.value)
for nm in list(B.wb.defined_names.keys()):
    del B.wb.defined_names[nm]
ROW['_names'] = {k: [v[0], v[1]] for k, v in NAMES.items()}
_reg = {}
for k, e in REG.items():
    d = {'sheet': e['sheet'], 'a0': e.get('a0')}
    d['q'] = [e['q'](q) for q in range(1, NQ+1)] if e.get('q') else None
    try: d['y'] = [e['y'](y) for y in range(1, 6)] if e.get('y') else None
    except Exception: d['y'] = None
    _reg[k] = d
ROW['_reg'] = _reg
import humano
print('textos cambiados:', humano.aplicar(B.wb))
import estilo
estilo.aplicar(B.wb, SRC, [o[0] for o in ORDER if o[1] == 'Ñapefit'])
names = [o[0] for o in ORDER]
assert set(names) == set(B.wb.sheetnames), (set(names) ^ set(B.wb.sheetnames))
B.wb._sheets = [B.wb[n] for n in names]
B.wb.active = names.index('Supuestos')
for ws in B.wb.worksheets:
    ws.sheet_view.tabSelected = (ws.title == 'Supuestos')
_sv = B.wb['Supuestos'].sheet_view
_sv.selection[0].activeCell = 'B3'; _sv.selection[0].sqref = 'B3'
B.wb.properties.title = 'Modelo empresarial maestro - Filtro 2.0'
# control: nombres sin convertir
left = set()
_known = set(NAMES)
for ws in B.wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('='):
                txt = re.sub(r'"[^"]*"', '', c.value); txt = re.sub(r"'[^']*'!", '', txt)
                for tok in re.findall(r'(?<![A-Za-z0-9_$.])([A-Z][A-Z0-9_]*[A-Z_][A-Z0-9_]*)(?![A-Za-z0-9_(!])', txt):
                    if not re.fullmatch(r'[A-Z]{1,3}[0-9]+', tok) and tok not in ('TRUE', 'FALSE'):
                        left.add((ws.title, tok))
if left:
    print('NOMBRES SIN DEFINIR:', sorted({t for _, t in left})[:50], len(left)); sys.exit(1)
B.wb.properties.creator = 'Modelo académico'
B.wb.calculation.fullCalcOnLoad = True
B.wb.save(OUT)
json.dump(dict(ROW), open(OUT + '.rows.json', 'w'), indent=0)
print('OK', OUT, len(names), 'hojas')
