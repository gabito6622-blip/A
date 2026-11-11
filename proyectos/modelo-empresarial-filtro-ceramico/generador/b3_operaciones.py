from lib import *
from b1_supuestos import ROW

MATS = [  # nombre, unidad, consumo/kit, merma?, precio Bs con factura, factura?, fuente
    ('Arcilla roja (molida y tamizada)', 'kg', 5.0, 1, 0.40, 1, 'Supuesto: cotizar con ladrilleras / canteras de la zona'),
    ('Aserrín o cascarilla de arroz tamizada', 'kg', 0.6, 1, 0.50, 1, 'Supuesto: residuo de aserraderos o arroceras; cotizar'),
    ('Plata coloidal 3,2%', 'ml', 2.0, 1, 1.20, 1, 'Supuesto; dosis de referencia de Potters for Peace (verificar)'),
    ('Contenedor plástico 20 L grado alimentario con tapa', 'unidad', 1.0, 0, 55.0, 1, 'Supuesto: cotizar con fábricas de plásticos de Santa Cruz'),
    ('Grifo plástico', 'unidad', 1.0, 0, 12.0, 1, 'Supuesto: cotizar'),
    ('Empaque: caja, manual y etiqueta', 'unidad', 1.0, 0, 14.0, 1, 'Supuesto: cotizar con imprentas'),
]

def build_materiales(B):
    ws = B.sheet('MATERIALES', 'MATERIALES POR KIT (LISTA DE MATERIALES) Y COSTO UNITARIO', 'Equivale a "MP" (Ñapefit) y "Costos (MP)" (Hypotolab). Precios en Bs con factura, editables.', tab='5B9BD5')
    widths(ws, {'A': 44, 'B': 9, 'C': 12, 'D': 10, 'E': 13, 'F': 14, 'G': 10, 'H': 14, 'I': 14, 'J': 16, 'K': 52})
    hd = ['Material', 'Unidad', 'Consumo por kit', '¿Merma? (1/0)', 'Consumo con merma', 'Precio unit. Bs (c/factura)', '¿Factura? (1/0)', 'Costo/kit c/factura', 'Costo/kit neto de IVA', 'Tipo', 'Fuente']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}6', h, 'hdr')
    r = 7
    for (n, u, c, m, p, fa, fu) in MATS:
        put(ws, f'A{r}', n, 'label'); put(ws, f'B{r}', u, 'note')
        put(ws, f'C{r}', c, 'input', FMT_BS2); put(ws, f'D{r}', m, 'input', FMT_INT)
        put(ws, f'E{r}', f'=C{r}*(1+MERMA*D{r})', 'calc', '#,##0.000')
        put(ws, f'F{r}', p, 'input', FMT_BS2); put(ws, f'G{r}', fa, 'input', FMT_INT)
        put(ws, f'H{r}', f'=E{r}*F{r}', 'calc', FMT_BS2)
        put(ws, f'I{r}', f'=H{r}*(1-TASA_IVA*G{r})', 'calc', FMT_BS2)
        put(ws, f'J{r}', 'Supuesto (cotizar)', 'label'); put(ws, f'K{r}', fu, 'note')
        r += 1
    ROW['MAT.first'] = 7; ROW['MAT.last'] = r - 1
    put(ws, f'A{r}', 'TOTAL MATERIALES INVENTARIABLES POR KIT', 'label', bold=True, fill=FILL_TOT)
    put(ws, f'H{r}', f'=SUM(H7:H{r-1})', 'calc', FMT_BS2, bold=True, fill=FILL_TOT)
    put(ws, f'I{r}', f'=SUM(I7:I{r-1})', 'calc', FMT_BS2, bold=True, fill=FILL_TOT)
    B.name('MP_KIT_CF', 'MATERIALES', f'H{r}'); B.name('MP_KIT_NETO', 'MATERIALES', f'I{r}')
    r += 2
    put(ws, f'A{r}', 'Energía de cocción (gas) por filtro (no inventariable)', 'label')
    put(ws, f'B{r}', 'Bs', 'note'); put(ws, f'C{r}', 1, 'input', FMT_BS2); put(ws, f'D{r}', 1, 'input', FMT_INT)
    put(ws, f'E{r}', f'=C{r}*(1+MERMA*D{r})', 'calc', '#,##0.000'); put(ws, f'F{r}', 6, 'input', FMT_BS2); put(ws, f'G{r}', 1, 'input', FMT_INT)
    put(ws, f'H{r}', f'=E{r}*F{r}', 'calc', FMT_BS2); put(ws, f'I{r}', f'=H{r}*(1-TASA_IVA*G{r})', 'calc', FMT_BS2)
    put(ws, f'J{r}', 'Supuesto (medir)', 'label'); put(ws, f'K{r}', 'Supuesto: medir consumo de gas por cocción en el lote piloto', 'note')
    B.name('ENERGIA_KIT_CF', 'MATERIALES', f'H{r}'); B.name('ENERGIA_KIT_NETO', 'MATERIALES', f'I{r}')
    r += 1
    put(ws, f'A{r}', 'COSTO VARIABLE DE PRODUCCIÓN POR KIT (2027)', 'label', bold=True, fill=FILL_TOT)
    put(ws, f'H{r}', '=MP_KIT_CF+ENERGIA_KIT_CF', 'calc', FMT_BS2, bold=True, fill=FILL_TOT)
    put(ws, f'I{r}', '=MP_KIT_NETO+ENERGIA_KIT_NETO', 'calc', FMT_BS2, bold=True, fill=FILL_TOT)
    B.name('CVP_KIT_NETO', 'MATERIALES', f'I{r}')
    r += 1
    put(ws, f'A{r}', 'Costo en USD (referencia, neto de IVA)', 'label'); put(ws, f'I{r}', f'=I{r-1}/TIPO_CAMBIO', 'calc', FMT_BS2)
    r += 1
    put(ws, f'A{r}', 'Kg de mezcla cerámica por filtro (arcilla + aserrín, con merma)', 'label')
    put(ws, f'E{r}', '=E7+E8', 'calc', '#,##0.000'); B.name('KG_FILTRO', 'MATERIALES', f'E{r}')
    r += 2
    put(ws, f'A{r}', 'PROVEEDORES (sin nombres inventados: se completan al cotizar)', 'sec'); r += 1
    for j, h in enumerate(['Insumo', 'Tipo de proveedor', 'Criterios de selección', 'Estado']):
        put(ws, f'{L(1+j*3 if j else 1)}{r}', h, 'hdr')
    prov = [('Arcilla', 'Canteras y ladrilleras de la región', 'Plasticidad, ausencia de contaminantes, regularidad', 'Por cotizar'),
            ('Aserrín / cascarilla', 'Aserraderos o arroceras', 'Granulometría uniforme, sin químicos', 'Por cotizar'),
            ('Plata coloidal', 'Importadores de insumos químicos', 'Concentración certificada', 'Por cotizar'),
            ('Contenedor y grifo', 'Fábricas de plástico locales', 'Grado alimentario, precio por volumen', 'Por cotizar'),
            ('Empaque', 'Imprentas y fábricas de cartón', 'Precio y plazo', 'Por cotizar'),
            ('Gas', 'Distribuidora de gas natural / GLP', 'Disponibilidad en la zona', 'Por cotizar')]
    r += 1
    for row in prov:
        for j, v in enumerate(row):
            put(ws, f'{L(1+j*3 if j else 1)}{r}', v, 'label')
        r += 1
    put(ws, f'A{r+1}', 'Ñapefit y Hypotolab listaban proveedores de su producto alimenticio; no aplican a este producto. Se conserva la metodología (cantidad por unidad x precio = costo unitario).', 'note')
    return ws

STAGES = [  # etapa, equipo, capacidad, unidad, tipo ('kg_h','u_h','u_dia')
    ('Molienda y tamizado', 'Molino de martillos + tamizadora', 120, 'kg/hora', 'kg_h'),
    ('Mezclado y amasado', 'Amasadora', 100, 'kg/hora', 'kg_h'),
    ('Prensado', 'Prensa hidráulica con molde', 10, 'filtros/hora', 'u_h'),
    ('Secado al aire', 'Estanterías: 400 filtros / ciclo de 8 días', 50, 'filtros/día', 'u_dia'),
    ('Cocción a ~860 °C', 'Horno a gas 1 m³: 50 filtros por cocción, 1 cocción/día', 50, 'filtros/día', 'u_dia'),
    ('Prueba de caudal', '30 estaciones x 2 pruebas/día', 60, 'filtros/día', 'u_dia'),
    ('Plata coloidal y ensamblaje', 'Mesa de ensamblaje', 15, 'kits/hora', 'u_h'),
]

def build_capacidad(B):
    ws = B.sheet('CAPACIDAD', 'CAPACIDAD INSTALADA Y UTILIZADA', 'Capacidad por etapa → cuello de botella → capacidad instalada. La utilización se mide contra el cuello de botella (corrige a Ñapefit).', tab='5B9BD5')
    hd = ['Etapa', 'Equipo', 'Capacidad', 'Unidad', 'Filtros/hora', 'Horas productivas/día', 'Filtros/día', 'Filtros/trimestre', 'Filtros/año']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}6', h, 'hdr')
    widths(ws, {'A': 30, 'B': 46, 'C': 11, 'D': 13, 'E': 12, 'F': 12, 'G': 12, 'H': 14, 'I': 14})
    r = 7
    for (e, eq, cap, u, t) in STAGES:
        put(ws, f'A{r}', e, 'label'); put(ws, f'B{r}', eq, 'label'); put(ws, f'C{r}', cap, 'input', FMT_BS); put(ws, f'D{r}', u, 'note')
        if t == 'kg_h':
            put(ws, f'E{r}', f'=C{r}/KG_FILTRO', 'calc', FMT_BS2); put(ws, f'F{r}', '=HORAS_TURNO-HORAS_OCIO', 'calc', FMT_BS2)
            put(ws, f'G{r}', f'=E{r}*F{r}', 'calc', FMT_BS)
        elif t == 'u_h':
            put(ws, f'E{r}', f'=C{r}', 'calc', FMT_BS2); put(ws, f'F{r}', '=HORAS_TURNO-HORAS_OCIO', 'calc', FMT_BS2)
            put(ws, f'G{r}', f'=E{r}*F{r}', 'calc', FMT_BS)
        else:
            put(ws, f'E{r}', '—', 'note'); put(ws, f'F{r}', '—', 'note'); put(ws, f'G{r}', f'=C{r}', 'calc', FMT_BS)
        put(ws, f'H{r}', f'=G{r}*DIAS_TRIM', 'calc', FMT_U); put(ws, f'I{r}', f'=H{r}*4', 'calc', FMT_U)
        r += 1
    last = r - 1
    put(ws, f'A{r}', 'CAPACIDAD INSTALADA (cuello de botella)', 'label', bold=True, fill=FILL_TOT)
    put(ws, f'B{r}', f'=INDEX(A7:A{last},MATCH(MIN(G7:G{last}),G7:G{last},0))', 'calc', bold=True, fill=FILL_TOT)
    put(ws, f'G{r}', f'=MIN(G7:G{last})', 'calc', FMT_BS, bold=True, fill=FILL_TOT)
    put(ws, f'H{r}', f'=G{r}*DIAS_TRIM', 'calc', FMT_U, bold=True, fill=FILL_TOT)
    put(ws, f'I{r}', f'=H{r}*4', 'calc', FMT_U, bold=True, fill=FILL_TOT)
    B.name('CAP_TRIM', 'CAPACIDAD', f'H{r}'); B.name('CAP_ANUAL', 'CAPACIDAD', f'I{r}')
    ROW['CAP.inst'] = r
    r += 2
    put(ws, f'A{r}', 'Referencia: Potters for Peace indica ~50 filtros/día para una planta básica con 3-4 trabajadores. Las capacidades de cada equipo son supuestos a confirmar con fichas técnicas o cotizaciones.', 'note')
    r += 2
    put(ws, f'A{r}', 'CAPACIDAD UTILIZADA POR TRIMESTRE', 'sec'); r += 1
    hdr_time(ws, r, year0=False); ws.freeze_panes = None; r += 1
    ROW['CAP.q0'] = r
    return ws, r

def fill_capacidad_q(B, ws, r):
    qrow(ws, r, 'Producción planificada', 'kits', lambda q: f"='INVENTARIO_PT'!{qc(q)}{ROW['INV.prod']}", FMT_U); rp = r; r += 1
    qrow(ws, r, 'Capacidad instalada (cuello de botella)', 'kits', lambda q: '=CAP_TRIM', FMT_U); ri = r; r += 1
    qrow(ws, r, 'Capacidad de la mano de obra (operarios x productividad x días)', 'kits', lambda q: f"='PERSONAL'!{qc(q)}{ROW['PER.ops']}*PROD_OPERARIO*DIAS_TRIM", FMT_U); rl = r; r += 1
    qrow(ws, r, 'Capacidad efectiva = mínimo (instalada, mano de obra)', 'kits', lambda q: f'=MIN({qc(q)}{ri},{qc(q)}{rl})', FMT_U); re_ = r; r += 1
    qrow(ws, r, 'Utilización de la capacidad instalada', '%', lambda q: f'={qc(q)}{rp}/{qc(q)}{ri}', FMT_PCT, annual=lambda y: f'={yc(y)}{rp}/{yc(y)}{ri}', bold=True); ru = r; r += 1
    qrow(ws, r, 'Holgura (capacidad efectiva - producción)', 'kits', lambda q: f'={qc(q)}{re_}-{qc(q)}{rp}', FMT_U); rh = r; r += 1
    qrow(ws, r, 'Control: ¿la producción cabe en la capacidad?', '1 = sí', lambda q: f'=IF({qc(q)}{rh}>=-0.5,1,0)', FMT_INT, annual=lambda y: f'=MIN({qc(4*y-3)}{r}:{qc(4*y)}{r})'); ROW['CAP.ok'] = r; r += 1
    ROW['CAP.prod'] = rp; ROW['CAP.util'] = ru; ROW['CAP.inst_q'] = ri

def build_inventario(B):
    ws = B.sheet('INVENTARIO_PT', 'PLAN DE PRODUCCIÓN E INVENTARIO DE PRODUCTO TERMINADO',
                 'Producción = ventas + stock de seguridad - inventario inicial. Valuación a costo promedio ponderado (costeo variable). Reemplaza "Inventario" e "Inv. terminado".', tab='5B9BD5')
    hdr_time(ws)
    r = 6
    P = ROW
    qrow(ws, r, 'Ventas del trimestre', 'kits', lambda q: f"='PRONOSTICO'!{qc(q)}{P['PRO.q.units']}", FMT_U); rv = r; r += 1
    qrow(ws, r, 'Ventas del trimestre siguiente', 'kits', lambda q: f"='PRONOSTICO'!{qc(q)}{P['PRO.q.next']}", FMT_U, annual=None); rn = r; r += 1
    qrow(ws, r, 'Stock de seguridad objetivo', 'kits', lambda q: f'=SS_PT*{qc(q)}{rn}', FMT_U, annual='last'); rs = r; r += 1
    ri = r
    qrow(ws, r, 'Inventario inicial', 'kits', lambda q: '=INV_INI_PT' if q == 1 else f'={qc(q-1)}{ri+3}', FMT_U, annual='first'); r += 1
    qrow(ws, r, 'Producción requerida', 'kits', lambda q: f'=MAX(0,{qc(q)}{rv}+{qc(q)}{rs}-{qc(q)}{ri})', FMT_U); r += 1
    qrow(ws, r, 'PRODUCCIÓN PLANIFICADA (redondeada)', 'kits', lambda q: f'=ROUNDUP({qc(q)}{ri+1},0)', FMT_U, bold=True); rp = r; r += 1
    qrow(ws, r, 'Inventario final', 'kits', lambda q: f'={qc(q)}{ri}+{qc(q)}{rp}-{qc(q)}{rv}', FMT_U, annual='last'); rf = r; r += 1
    qrow(ws, r, 'Control: inventario final ≥ 0', '1 = sí', lambda q: f'=IF({qc(q)}{rf}>=-0.001,1,0)', FMT_INT, annual=lambda y: f'=MIN({qc(4*y-3)}{r}:{qc(4*y)}{r})'); P['INV.ok'] = r; r += 2
    put(ws, f'A{r}', 'VALUACIÓN (Bs, neto de IVA)', 'sec'); r += 1
    qrow(ws, r, 'Materiales consumidos', 'Bs', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.consumo']}", FMT_BS); rm = r; r += 1
    qrow(ws, r, 'Energía de cocción', 'Bs', lambda q: f"='COMPRAS'!{qc(q)}{P['COM.en_neto']}", FMT_BS); r += 1
    qrow(ws, r, 'Costo de producción del trimestre', 'Bs', lambda q: f'={qc(q)}{rm}+{qc(q)}{rm+1}', FMT_BS); rc = r; r += 1
    rib = r
    qrow(ws, r, 'Inventario inicial valorizado', 'Bs', lambda q: '=0' if q == 1 else f'={qc(q-1)}{rib+3}', FMT_BS, annual='first'); r += 1
    qrow(ws, r, 'Costo unitario promedio ponderado', 'Bs/kit', lambda q: f'=IF({qc(q)}{ri}+{qc(q)}{rp}>0,({qc(q)}{rib}+{qc(q)}{rc})/({qc(q)}{ri}+{qc(q)}{rp}),0)', FMT_BS2, annual=None); ru = r; r += 1
    qrow(ws, r, 'COSTO DE VENTAS', 'Bs', lambda q: f'={qc(q)}{rv}*{qc(q)}{ru}', FMT_BS, bold=True); rcv = r; r += 1
    qrow(ws, r, 'Inventario final valorizado', 'Bs', lambda q: f'={qc(q)}{rib}+{qc(q)}{rc}-{qc(q)}{rcv}', FMT_BS, annual='last'); rfb = r; r += 1
    P.update({'INV.ventas': rv, 'INV.prod': rp, 'INV.fin': rf, 'INV.ini': ri, 'INV.cv': rcv, 'INV.finbs': rfb, 'INV.ss': rs})
    put(ws, f'A{r+1}', 'Corrección: en Ñapefit el "inventario inicial" era igual a las ventas y el final siempre 0; Hypotolab tenía valores pegados con *1,1 solo en algunas celdas. Aquí el inventario se arrastra de un trimestre al siguiente.', 'note')
    return ws

def build_compras(B):
    ws = B.sheet('COMPRAS', 'PROGRAMA DE COMPRAS DE MATERIALES', 'Un "juego" = materiales para un kit (incluye merma). Compras = necesidad + stock final - stock inicial. Reemplaza el programa de compras pegado como valores en Ñapefit.', tab='5B9BD5')
    hdr_time(ws)
    P = ROW
    r = 6
    qrow(ws, r, 'Necesidad de juegos (= producción)', 'juegos', lambda q: f"='INVENTARIO_PT'!{qc(q)}{P['INV.prod']}", FMT_U); rq = r; r += 1
    qrow(ws, r, 'Necesidad del trimestre siguiente', 'juegos', lambda q: f'={qc(q+1)}{rq}' if q < NQ else f"='PRONOSTICO'!{qc(q)}{P['PRO.q.next']}", FMT_U, annual=None); rn = r; r += 1
    qrow(ws, r, 'Stock final objetivo', 'juegos', lambda q: f'=STOCK_MP*{qc(q)}{rn}', FMT_U, annual='last'); rs = r; r += 1
    ri = r
    qrow(ws, r, 'Inventario inicial de materiales', 'juegos', lambda q: '=0' if q == 1 else f'={qc(q-1)}{ri+2}', FMT_U, annual='first'); r += 1
    qrow(ws, r, 'COMPRAS', 'juegos', lambda q: f'=ROUNDUP(MAX(0,{qc(q)}{rq}+{qc(q)}{rs}-{qc(q)}{ri}),0)', FMT_U, bold=True); rc = r; r += 1
    qrow(ws, r, 'Inventario final de materiales', 'juegos', lambda q: f'={qc(q)}{ri}+{qc(q)}{rc}-{qc(q)}{rq}', FMT_U, annual='last'); rf = r; r += 1
    qrow(ws, r, 'Control: inventario de materiales ≥ 0', '1 = sí', lambda q: f'=IF({qc(q)}{rf}>=-0.001,1,0)', FMT_INT, annual=lambda y: f'=MIN({qc(4*y-3)}{r}:{qc(4*y)}{r})'); P['COM.ok'] = r; r += 2
    put(ws, f'A{r}', 'COMPRAS EN Bs', 'sec'); r += 1
    qrow(ws, r, 'Costo por juego con factura', 'Bs/juego', lambda q: f"=MP_KIT_CF*'CALENDARIO'!{qc(q)}11*M_CVAR", FMT_BS2, annual=None); rcc = r; r += 1
    qrow(ws, r, 'Costo por juego neto de IVA', 'Bs/juego', lambda q: f"=MP_KIT_NETO*'CALENDARIO'!{qc(q)}11*M_CVAR", FMT_BS2, annual=None); rcn = r; r += 1
    qrow(ws, r, 'Compras con factura (pago)', 'Bs', lambda q: f'={qc(q)}{rc}*{qc(q)}{rcc}', FMT_BS, bold=True); rpb = r; r += 1
    qrow(ws, r, 'Compras netas de IVA (al inventario)', 'Bs', lambda q: f'={qc(q)}{rc}*{qc(q)}{rcn}', FMT_BS); rpn = r; r += 1
    qrow(ws, r, 'IVA crédito fiscal de compras', 'Bs', lambda q: f'={qc(q)}{rpb}-{qc(q)}{rpn}', FMT_BS); riva = r; r += 1
    rib = r
    qrow(ws, r, 'Inventario inicial valorizado', 'Bs', lambda q: '=0' if q == 1 else f'={qc(q-1)}{rib+3}', FMT_BS, annual='first'); r += 1
    qrow(ws, r, 'Costo promedio ponderado por juego', 'Bs/juego', lambda q: f'=IF({qc(q)}{ri}+{qc(q)}{rc}>0,({qc(q)}{rib}+{qc(q)}{rpn})/({qc(q)}{ri}+{qc(q)}{rc}),0)', FMT_BS2, annual=None); rpr = r; r += 1
    qrow(ws, r, 'Materiales consumidos en producción', 'Bs', lambda q: f'={qc(q)}{rq}*{qc(q)}{rpr}', FMT_BS); rcon = r; r += 1
    qrow(ws, r, 'Inventario final valorizado', 'Bs', lambda q: f'={qc(q)}{rib}+{qc(q)}{rpn}-{qc(q)}{rcon}', FMT_BS, annual='last'); rfb = r; r += 2
    put(ws, f'A{r}', 'ENERGÍA DE COCCIÓN (se compra al consumir)', 'sec'); r += 1
    qrow(ws, r, 'Energía con factura (pago)', 'Bs', lambda q: f"='INVENTARIO_PT'!{qc(q)}{P['INV.prod']}*ENERGIA_KIT_CF*'CALENDARIO'!{qc(q)}11*M_CVAR", FMT_BS); ren = r; r += 1
    qrow(ws, r, 'Energía neta de IVA (al costo de producción)', 'Bs', lambda q: f"='INVENTARIO_PT'!{qc(q)}{P['INV.prod']}*ENERGIA_KIT_NETO*'CALENDARIO'!{qc(q)}11*M_CVAR", FMT_BS); renn = r; r += 1
    qrow(ws, r, 'IVA crédito fiscal de energía', 'Bs', lambda q: f'={qc(q)}{ren}-{qc(q)}{renn}', FMT_BS); reni = r; r += 2
    put(ws, f'A{r}', 'DETALLE DE COMPRAS POR MATERIAL (cantidades físicas)', 'sec'); r += 1
    for i, m in enumerate(MATS):
        mr = P['MAT.first'] + i
        qrow(ws, r, m[0], m[1], lambda q, mr=mr: f"={qc(q)}{rc}*'MATERIALES'!$E${mr}", '#,##0.0'); r += 1
    r += 1
    put(ws, f'A{r}', 'DETALLE DE COMPRAS POR MATERIAL (Bs con factura)', 'sec'); r += 1
    rd0 = r
    for i, m in enumerate(MATS):
        mr = P['MAT.first'] + i
        qrow(ws, r, m[0], 'Bs', lambda q, mr=mr: f"={qc(q)}{rc}*'MATERIALES'!$H${mr}*'CALENDARIO'!{qc(q)}11*M_CVAR", FMT_BS); r += 1
    qrow(ws, r, 'Total (debe coincidir con "Compras con factura")', 'Bs', lambda q: f'=SUM({qc(q)}{rd0}:{qc(q)}{r-1})', FMT_BS, bold=True); P['COM.det_tot'] = r; r += 1
    P.update({'COM.compras': rc, 'COM.pago': rpb, 'COM.neto': rpn, 'COM.iva': riva, 'COM.consumo': rcon, 'COM.finbs': rfb, 'COM.fin': rf,
              'COM.en_pago': ren, 'COM.en_neto': renn, 'COM.en_iva': reni})
    return ws
