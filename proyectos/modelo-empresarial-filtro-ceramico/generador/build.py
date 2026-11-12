import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import b1_supuestos as b1
from b1_supuestos import ROW, RowMap
import b2_mercado as b2, b3_operaciones as b3, b4_costos as b4, b5_finanzas as b5, b6_eval as b6, b7_sim as b7, b8_docs as b8

SRC = sys.argv[1]; OUT = sys.argv[2]
SNAP = sys.argv[3] if len(sys.argv) > 3 else None

ORDER = [
 ('Santa Cruz', 'Ñapefit', 'Población departamental (INE, Cuadros 3 y 8) y proyección'),
 ('Zona urbana', 'Ñapefit', 'Población del municipio por área y edad (INE, Cuadro 4)'),
 ('Demanda', 'Ñapefit', 'Demanda potencial y efectiva'),
 ('Pronostico', 'Ñapefit', 'Tres escenarios y pronóstico trimestral'),
 ('Inventario', 'Ñapefit', 'Plan de producción e inventario en unidades'),
 ('Inv. terminado', 'Ñapefit', 'Inventario de producto terminado en unidades y Bs; costo de ventas'),
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
 ('TRMA', 'Ñapefit', 'Tasa de descuento (CAPM + riesgo país, en Bs)'),
 ('Rentabilidad', 'Ñapefit', 'Flujo de fondos, VAN, TIR, PRI, B/C y punto de equilibrio'),
 ('Supuestos', 'Nuevo', 'Panel de supuestos editables y registro de hipótesis'),
 ('Calendario', 'Nuevo', 'Trimestres e índices de precios, costos y sueldos'),
 ('Financiamiento', 'Nuevo', 'Préstamo bancario y tabla de amortización'),
 ('Balance general', 'Nuevo', 'Balance general con control de cuadre'),
 ('Ratios', 'Nuevo', 'Indicadores financieros'),
 ('Sensibilidad', 'Nuevo', 'Sensibilidad, puntos críticos y estrés'),
 ('SIMULADOR EMPRESARIAL', 'Nuevo', 'Decisiones por período y sus consecuencias'),
 ('DECISIONES Y ESCENARIOS', 'Nuevo', 'Escenario activo, corridas registradas y comparador de decisiones'),
 ('CONTROL DE PERIODOS', 'Nuevo', 'Plan vs. real por trimestre'),
 ('Dashboard', 'Nuevo', 'Tablero ejecutivo'),
 ('Controles', 'Nuevo', 'Alertas de consistencia'),
 ('Producto', 'Nuevo', 'Descripción del producto, problema, segmentación y ahorro'),
 ('Selección de producto', 'Nuevo', 'Cinco productos evaluados con 14 criterios'),
 ('Muestra y encuesta', 'Nuevo', 'Tamaño de muestra, cuestionario y tabulación'),
 ('Competencia', 'Nuevo', 'Competidores, sustitutos y fuerzas de Porter'),
 ('Estrategia comercial', 'Nuevo', 'Mezcla de marketing, canales y gastos comerciales'),
 ('Proceso productivo', 'Nuevo', 'Etapas, equipos, tiempos y controles'),
 ('Matriz comparativa', 'Nuevo', 'Auditoría de las hojas de Ñapefit y Hypotolab'),
 ('Fuentes', 'Nuevo', 'Fuentes y bibliografía'),
 ('Índice', 'Nuevo', 'Este índice'),
 ('Leyenda', 'Nuevo', 'Cómo usar el modelo'),
]

def build_precio_costo(B, ws):
    P = ROW
    r = 17
    put(ws, f'A{r}', 'B. MÉTODO DE COSTO (metodología de Ñapefit y Hypotolab, en Bs, año 2027)', 'sec'); r += 1
    ER = lambda k: f"'Estado de resultado'!{yc(1)}{P['ER.'+k]}"
    rows = [('q', 'Unidades vendidas (Q)', f"={ER('u')}", FMT_U),
            ('mp', 'Materiales y energía (costo de ventas)', f"={ER('cv')}", FMT_BS),
            ('mod', 'Mano de obra directa', f"='MANO DE OBRA'!{yc(1)}{P['PER.MOD']}", FMT_BS),
            ('moi', 'Mano de obra indirecta', f"='MANO DE OBRA'!{yc(1)}{P['PER.MOI']}", FMT_BS),
            ('gf', 'Gastos de fabricación y depreciación', f"={ER('gfab')}+{ER('dep_fab')}", FMT_BS),
            ('ga', 'Gastos de administración y comercialización', f"={ER('tadm')}+{ER('tcom')}", FMT_BS)]
    for k, lbl, f, fm in rows:
        put(ws, f'A{r}', lbl, 'label'); put(ws, f'C{r}', f, 'link', fm); P['PREC.' + k] = r; r += 1
    put(ws, f'A{r}', 'Costo total', 'label', bold=True); put(ws, f'C{r}', f"=SUM(C{P['PREC.mp']}:C{P['PREC.ga']})", 'calc', FMT_BS, bold=True); rct = r; r += 1
    put(ws, f'A{r}', 'Costo unitario total', 'label'); put(ws, f'C{r}', f"=C{rct}/C{P['PREC.q']}", 'calc', FMT_BS2); rcu = r; r += 1
    put(ws, f'A{r}', 'Precio antes de impuestos = costo unitario / (1 - utilidad)', 'label'); put(ws, f'C{r}', f'=C{rcu}/(1-MARKUP_COSTO)', 'calc', FMT_BS2); rpa = r; r += 1
    put(ws, f'A{r}', 'Recargo por IVA + IT = (IVA + IT) / (1 - IVA - IT)', 'label'); put(ws, f'C{r}', '=(TASA_IVA+TASA_IT)/(1-TASA_IVA-TASA_IT)', 'calc', FMT_PCT2); rg = r
    put(ws, f'D{r}', 'Los originales usaban 19,04% escrito a mano.', 'note'); r += 1
    put(ws, f'A{r}', 'Precio con factura por método de costo (lo que debe recibir la empresa)', 'label', bold=True); put(ws, f'C{r}', f'=C{rpa}*(1+C{rg})', 'calc', FMT_BS2, bold=True); rpm = r; r += 1
    put(ws, f'A{r}', 'Precio promedio que realmente factura la empresa con el PVP elegido', 'label'); put(ws, f'C{r}', f"=C{ROW['PRE.prom']}", 'calc', FMT_BS2); rpe = r; r += 1
    put(ws, f'A{r}', 'Diferencia (precio de mercado / precio por costo - 1)', 'label', bold=True); put(ws, f'C{r}', f'=C{rpe}/C{rpm}-1', 'calc', FMT_PCT, bold=True); r += 1
    put(ws, f'A{r}', 'Margen real sobre costo total (precio neto de IVA e IT / costo unitario - 1)', 'label'); put(ws, f'C{r}', f'=C{rpe}*(1-TASA_IVA-TASA_IT)/C{rcu}-1', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'PVP sugerido por método de costo (si todo se vendiera por canal indirecto)', 'label'); put(ws, f'C{r}', f'=C{rpm}/(1-MARGEN_CANAL)', 'calc', FMT_BS2); r += 2
    put(ws, f'A{r}', 'C. MARGEN DE CONTRIBUCIÓN UNITARIO POR AÑO', 'sec'); r += 1
    from b2_mercado import year_hdr
    year_hdr(ws, r); r += 1
    for k, lbl, fm in [('p', 'Precio neto por kit', FMT_BS2), ('cvu', 'Costo variable por kit', FMT_BS2), ('mcu', 'Margen de contribución por kit', FMT_BS2), ('mcp', 'Razón de contribución', FMT_PCT)]:
        arow(ws, r, lbl, '', lambda y, k=k: f"='Rentabilidad'!{ac(y)}{P['PE.'+k]}", fm); r += 1
    r += 1
    put(ws, f'A{r}', 'D. PRECIO FRENTE A LA COMPETENCIA', 'sec'); r += 1
    put(ws, f'A{r}', 'Ahorro anual del hogar frente al botellón (Bs)', 'label'); put(ws, f'C{r}', f"='Producto'!B{P['PM.ahorro']}", 'link', FMT_BS); r += 1
    put(ws, f'A{r}', 'Meses para recuperar el precio del kit', 'label'); put(ws, f'C{r}', f"='Producto'!B{P['PM.meses']}", 'link', FMT_BS2); r += 1
    put(ws, f'A{r}', 'Precios de competidores: ver Competencia (pendientes de relevamiento).', 'note')
    widths(ws, {'A': 66})

def build_all():
    B = Book()
    b1.build_supuestos(B); b1.build_calendario(B); b1.build_poblacion(B, SRC)
    pre = b2.build_precio_tabla(B)
    b2.build_muestra(B); b2.build_demanda(B); b2.build_pronostico(B); b2.build_producto(B)
    b3.build_materiales(B)
    cap, rq = b3.build_capacidad(B)
    b3.build_inventario(B); b3.build_compras(B)
    b4.build_personal(B); b4.build_gastos(B); b4.build_activos(B); b4.build_inversion(B); b4.build_financiamiento(B)
    b3.fill_capacidad_q(B, cap, rq)
    b5.build_er(B); b5.build_impuestos(B); b5.build_flujo(B); b5.build_balance(B); b5.build_trma(B)
    b6.build_evaluacion(B); b6.build_pe(B); b6.build_ratios(B)
    build_precio_costo(B, pre)
    b7.build_simulador(B); dec = b7.build_decisiones(B); b7.build_control(B)
    b8.build_matriz(B); b8.build_seleccion(B); b8.build_competencia(B); b8.build_estrategia(B); b8.build_proceso(B); b8.build_localizacion(B)
    b8.build_fuentes(B); b8.build_controles(B); sen = b8.build_sensibilidad(B); b8.build_dashboard(B)
    b8.build_indice(B, ORDER); b8.build_leyenda(B)
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
    put(sen, f'A{r}', 'A. VAN (Bs) ante cambios de una variable a la vez', 'sec'); r += 1
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
    for j, h in enumerate(['Caso', 'VAN (Bs)', 'TIR', 'Caja mínima (Bs)', 'Balance cuadra', 'Controles OK']): put(sen, f'{L(1+j)}{r}', h, 'hdr')
    r += 1
    for row in snap['estres']:
        vals = [row['caso'], row['van'], row['tir'], row['cajamin'], row['balance'], row['ctrl']]
        fm = [None, FMT_BS, FMT_PCT2, FMT_BS, None, None]
        for j, v in enumerate(vals): put(sen, f'{L(1+j)}{r}', v, 'label', fm[j])
        r += 1
    # gráfico tornado (barras) con -10% / +10%
    ch = BarChart(); ch.type = 'bar'; ch.title = 'VAN ante -10% y +10% en cada variable (Bs)'; ch.height = 9; ch.width = 18
    i_m10 = cols.index('-10%'); i_p10 = cols.index('+10%')
    ch.add_data(Reference(sen, min_col=2+i_m10, min_row=t0-1, max_row=t1), titles_from_data=True)
    ch.add_data(Reference(sen, min_col=2+i_p10, min_row=t0-1, max_row=t1), titles_from_data=True)
    ch.set_categories(Reference(sen, min_col=1, min_row=t0, max_row=t1))
    sen.add_chart(ch, f'A{r+2}')

from openpyxl.chart import BarChart, Reference
# pasada 1: llenar mapa de filas; pasada 2: construir con referencias completas
build_all()
RowMap.misses = set()
B, dec, sen = build_all()
if RowMap.misses:
    print('FALTAN FILAS:', RowMap.misses); sys.exit(1)
if SNAP and os.path.exists(SNAP):
    write_snapshot(B, dec, sen, json.load(open(SNAP)))
names = [o[0] for o in ORDER]
assert set(names) == set(B.wb.sheetnames), (set(names) ^ set(B.wb.sheetnames))
B.wb._sheets = [B.wb[n] for n in names]
B.wb.active = 0
for ws in B.wb.worksheets:
    ws.sheet_view.tabSelected = (ws.title == 'Santa Cruz')
B.wb.properties.title = 'Modelo empresarial maestro - Filtro cerámico'
B.wb.properties.creator = 'Modelo académico'
B.wb.calculation.fullCalcOnLoad = True
B.wb.save(OUT)
json.dump(dict(ROW), open(OUT + '.rows.json', 'w'), indent=0)
print('OK', OUT, len(names), 'hojas')
