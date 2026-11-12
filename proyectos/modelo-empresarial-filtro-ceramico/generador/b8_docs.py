from lib import *
from b1_supuestos import ROW
from b2_mercado import year_hdr
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import SeriesLabel

def textsheet(ws, r, rows, widths_=None, height=None):
    for row in rows:
        for j, v in enumerate(row):
            c = put(ws, f'{L(1+j)}{r}', v, 'label', wrap=True)
        if height: ws.row_dimensions[r].height = height
        r += 1
    return r

MATRIZ = [
 # hoja, archivo, objetivo, entradas, fórmulas, dependencias, resultados, errores, mejoras, hoja nueva
 ('Santa Cruz', 'Ñapefit', 'Población departamental INE (Cuadros 3 y 8) y proyección 2025-2031', 'Tablas INE 2001/2012/2024', 'C52 = B52*(1+0,01421517)', 'Alimenta Demanda', 'Población 2027 = 3.257.672', 'Tasa escrita como número en cada celda; T14 dice "hombres 20-64" pero suma ambos sexos de 25 a 64', 'Tasa tomada de la celda del INE; rótulos corregidos', 'Santa Cruz / Zona urbana'),
 ('Zona urbana', 'Ñapefit', 'Población del municipio por área y edad (INE Cuadro 4)', 'Tabla INE', 'R19 = SUM(N21:N23); R20 = R19/B56', 'Alimenta Demanda (2028+)', '18-59 urbano = 962.728', 'R20 divide un dato municipal por la población departamental (mezcla niveles)', 'Se usan niveles coherentes (urbano departamental y urbano municipal)', 'Santa Cruz / Zona urbana'),
 ('Demanda', 'Ñapefit', 'Demanda de mercado en unidades y Bs', 'Población, %, consumo, precio', 'D34 = D32*D33', 'Santa Cruz, Zona urbana → Pronóstico', 'Demanda 2027: 4.043.458', '2026 usa x0,3 y x0,2 aunque dice 70%; consumo 20 vs 6; precio con 10% fijo distinto del 12% de Pronóstico; 6,96 escrito', 'Cadena homogénea con supuestos con nombre; precio desde PRECIO', 'Demanda'),
 ('Pronostico', 'Ñapefit', '3 escenarios de ventas y distribución trimestral', 'Aceptación 83%, participación 1/3/5%', 'F = C*D*E; trimestres = anual x %', 'Demanda, Precio → Inventario, Compras, Carga impositiva', 'Ventas 2027 esperado: 100.682', 'Precios escritos a mano; fila 2028 en USD usa $C$44 en los 4 trimestres; fórmulas sueltas H40/J41; participación crece con la población', 'Escenario activo seleccionable; precio vinculado; crecimiento de participación como supuesto explícito', 'Pronostico'),
 ('Inventario', 'Ñapefit', 'Ventas trimestrales y "inventario"', 'Pesos 19,7/34,2/25,6/20,5%', 'C18 = C6*$E$14', 'Pronóstico → Inv. terminado, Capacidad, Compras', 'Igual a ventas', 'Los pesos de esta hoja no se usan para unidades pero sí para ventas en Bs (inconsistencia); factor E14 = 1 (sin stock de seguridad)', 'Un solo juego de pesos estacionales; stock de seguridad explícito', 'Inventario / Inv. terminado'),
 ('Inv. terminado', 'Ñapefit', 'Inventario de producto terminado en unidades y USD', 'Costo de 1 envase', 'Inv. final = inicial - ventas', 'Inventario, Pronóstico, MP → Precio, Carga impositiva', 'Inventario final = 0 siempre', 'Inventario inicial = ventas del mismo trimestre: no hay inventario real; valuado en USD', 'Inventario que se arrastra entre trimestres y valuación a costo promedio en Bs', 'Inventario / Inv. terminado'),
 ('MP', 'Ñapefit', 'Receta y costo de materia prima por envase', 'Gramos y precios por bolsa', 'H20 = F20*F4/D20', '→ Inv. terminado, Inversión', 'Costo 13,24 Bs/envase', 'Rótulo "Bs/Kg" en costo por envase; restos de cálculos de otro producto (maltodextrina, glicerina)', 'Lista de materiales con merma, factura e IVA', 'MP'),
 ('Capacidad Inst.', 'Ñapefit', 'Capacidad por máquina y utilización', 'kg/h, horas', 'M7 = K7*5*12; N17 = C17/$M$8', 'MP, Inventario', 'Utilización 41-67%', 'Divide por la capacidad del secador (55.876) y no por el cuello de botella (selladora 27.000): en el 2do trimestre la producción (32.218) supera la capacidad real', 'Cuello de botella = MIN; control de capacidad por trimestre', 'Capacidad Inst.'),
 ('Infraestructura', 'Ñapefit', 'Elección de local y puesta en marcha', 'Pesos y puntajes 1-5', 'L9 = suma de peso x puntaje', 'Ninguna', 'Local 1 = 68', 'M9 multiplica pesos cambiados (K7 x M6 y K6 x M7)', 'SUMPRODUCT con los mismos pesos para todos', 'Infraestructura'),
 ('Compras', 'Ñapefit', 'Necesidades y programa de compras', 'Receta, ventas trimestrales', 'D29 = B22*$M$4', 'Pronóstico, Inventario', 'Programa de compras anual', 'G3 vinculado a otro archivo ([1]); el programa de compras (D57:M65) son valores pegados que no coinciden con las fórmulas (almidón 33.787 vs 23.157 kg)', 'Compras = necesidad + stock final - stock inicial, todo con fórmulas', 'Compras'),
 ('Maqu. y equip.', 'Ñapefit', 'Activos fijos y depreciación', 'Cantidad, costo USD, tasas', 'G = E - IVA; H = G x tasa', 'Capacidad → Inversión, ER, Precio', 'Inversión USD 20.270', 'B5 usa un rango (B7:D7) como referencia de una celda; precios en USD a 6,96', 'Moneda por activo y tipo de cambio editable; depreciación con tope y reposiciones', 'Maqu. y equip.'),
 ('MANO DE OBRA', 'Ñapefit', 'Planilla con cargas sociales 2027-2031', 'Sueldos Bs, tasas', 'O = N + M + L + C', '→ Precio, Inversión, ER, Flujo', 'Planilla 2027 USD 51.471', 'En 2027-2028 suma el básico (C) y no el total ganado (E); bono sobre el sueldo y 11% en el 5to año; P14 suelto', 'Operarios según producción; bono sobre 3 SMN; costos por área', 'MANO DE OBRA'),
 ('Otros gastos', 'Ñapefit', 'Gastos mensuales', 'Montos Bs', 'D = C x 3; E = D / 6,96', '→ Precio, ER, Inversión', 'USD 28.793/año', 'Conversión fija a 6,96', 'En Bs, por área, con factura o sin factura', 'Otros gastos'),
 ('Precio', 'Ñapefit', 'Precio por método de costo', 'Costos anuales, utilidad 35%', 'H3 = F3/(1-0,35); I3 = H3 x 19,04%', 'Inventario, MO, Otros gastos, Maquinaria → Pronóstico, Carga impositiva', 'Precio 35,14 Bs', 'J14 toma Internet (F4) en lugar de suministros (F8); F19 no suma la depreciación que lista; mezcla Bs y USD', 'Método de costo como referencia + precio de mercado + precios por canal', 'Precio'),
 ('Inversión', 'Ñapefit', 'Inversión total', 'Activos, diferidos, puesta en marcha', 'H21 = H4+H6+H9+H15', 'Carga impositiva, MP, MO → Flujo, Rentabilidad', 'USD 304.368', 'Capital de trabajo = 1 año completo de materiales y sueldos (87% de la inversión)', 'Capital de trabajo por período de desfase y verificado con el flujo de caja', 'Inversión'),
 ('Estado de resultado', 'Ñapefit', 'ER trimestral y anual', 'Ventas, costos, gastos', 'D20 = D7 - D19; D22 = D20 x 25%', '→ Flujo de caja', 'Utilidad 2027 USD 122.404', 'Mantenimiento y transporte escritos a mano (no coinciden con Otros gastos); IUE trimestral; costo de ventas solo materiales', 'Gastos vinculados; IUE anual; costos fijos por área; prima e intereses', 'Estado de resultado'),
 ('Carga impositiva', 'Ñapefit', 'IVA, IT por año y trimestre', 'Compras y ventas', 'IVA = DF - CF', '→ ER, Flujo', 'IVA 2027 USD 38.549', 'Ventas trimestrales con pesos distintos a los de unidades; no arrastra saldo a favor', 'Saldo a favor de IVA; IUE y prima con fecha de pago', 'Carga impositiva'),
 ('Flujo de caja', 'Ñapefit', 'Flujo directo trimestral y anual', 'ER, impuestos', 'C21 = C5 - C20', '→ Rentabilidad', 'Flujo operativo 2027 USD 118.905', 'B26 suma la inversión en vez de restarla; sueldos desde otro archivo ([2] REPELTEX); anual (con IUE) ≠ suma de trimestres (sin IUE)', 'Flujo directo completo con préstamo y aporte; anual = suma de trimestres; control de caja', 'Flujo de caja'),
 ('TRMA', 'Ñapefit', 'Tasa de descuento CAPM', 'Rf, β, Rm, riesgo país', 'F4 = Rf + β(Rm-Rf) + CRP', '→ Rentabilidad', '18,66%', 'Tasa en USD aplicada a flujos convertidos con tipo fijo; promedio del S&P con año incompleto', 'Conversión a Bs con Fisher; riesgo país actualizado', 'TRMA'),
 ('Rentabilidad', 'Ñapefit', 'VAN, TIR, PRI, valor residual, punto de equilibrio', 'Flujos, TRMA', 'VAN = NPV + C24; TIR = IRR', 'Flujo de caja, TRMA, Maquinaria', 'VAN USD 424.005; TIR 56,6%', 'PRI con signo cambiado (1,89 en vez de 2,11 años) y texto escrito a mano; perpetuidad sin calcular; punto de equilibrio vacío', 'PRI por interpolación; B/C; dos métodos de valor residual; flujo del inversionista', 'Rentabilidad'),
 ('Santa Cruz', 'Hypotolab', 'Igual que Ñapefit', 'Tablas INE', 'Idem', '→ Demanda', 'Idem', 'Idem (tasa escrita a mano)', 'Idem', 'Santa Cruz / Zona urbana'),
 ('Demanda', 'Hypotolab', 'Demanda de personas con hipotensión', '54% y 5% sin fuente', 'D34 = D32 x D33', '→ Pronóstico', 'Demanda 2026: 1.040.692', 'Porcentajes sin fuente', 'Supuestos con tipo, fuente y validación', 'Demanda'),
 ('Pronóstico', 'Hypotolab', '3 escenarios', 'Aceptación 90%', 'F = C x D x E', 'Demanda, Precio', 'Ventas 2026: 31.221', 'Escenario esperado omite la aceptación (F18 = C18 x E18)', 'Misma fórmula en los 3 escenarios', 'Pronostico'),
 ('Inventario', 'Hypotolab', 'Stock de seguridad (ASCM 10-20%)', 'Ventas', 'C19 = valor x 1,1', 'Pronóstico → Capacidad, Compras', 'Inventario con SS', 'Valores pegados; el 10% solo en algunos trimestres', 'Política de stock aplicada a todos los trimestres con fórmula (se conserva la idea ASCM)', 'Inventario / Inv. terminado'),
 ('Inventario envases', 'Hypotolab', 'Inventario de producto terminado', 'Compras, ventas', 'Final = inicial - ventas', '→ Impuestos, Precio', 'Valores en USD', 'Inventario final no se arrastra al siguiente trimestre', 'Inventario arrastrado y valuado', 'Inventario / Inv. terminado'),
 ('Costos (MP)', 'Hypotolab', 'Receta y costo por envase + proveedores', 'mg, Bs/kg', 'D46 = SUM; E46 = D46/6,96 x 1,1', '→ Inventario envases, Inversión', '3,30 Bs; USD 0,52', 'La merma de 10% solo en la columna USD', 'Merma explícita por material', 'MP'),
 ('Compras', 'Hypotolab', 'Necesidades de materiales', 'Receta, inventario', 'D28 = B21 x $M$4', 'Inventario', 'USD 4.885 por trimestre', 'Agua y glicerina en ml rotuladas como kg; compras = necesidad (sin stock)', 'Stock de materiales y compras redondeadas', 'Compras'),
 ('Infraestructura', 'Hypotolab', 'Elección de local', 'Pesos y puntajes', 'Suma ponderada', 'Ninguna', 'Local 2 = 72', 'Sin errores de fórmula', 'Se conserva el método', 'Infraestructura'),
 ('Capacidad Instalada', 'Hypotolab', 'Capacidad por máquina', 'kg/h, horas', 'K9 = G9 x $I$8', 'Inventario', 'Utilización 73-87%', 'Usa las horas de la 1ra máquina para todas; utilización contra una sola máquina', 'Cuello de botella y capacidad de mano de obra', 'Capacidad Inst.'),
 ('Maquinaria', 'Hypotolab', 'Activos y depreciación', 'USD', 'Igual a Ñapefit', '→ ER, Precio', 'USD 22.250', 'Precios en USD a 6,96', 'Tipo de cambio editable', 'Maqu. y equip.'),
 ('Sueldos y salarios', 'Hypotolab', 'Planilla 6 cargos', 'Sueldos, tasas', 'Igual a Ñapefit', '→ Precio, ER, Flujo, Inversión', 'USD 53.003/año', 'Aporte solidario 3% (Ñapefit 3,5%); bono sobre el sueldo', 'Tasa más prudente y bono sobre 3 SMN', 'MANO DE OBRA'),
 ('Impuestos', 'Hypotolab', 'IVA, IT', 'Compras, ventas', 'C26 = $C$11 x 0,3', '→ ER, Flujo, Inversión', 'IVA 2026 USD 19.990', 'Pesos trimestrales escritos a mano', 'Pesos vinculados a Supuestos', 'Carga impositiva'),
 ('Precio', 'Hypotolab', 'Precio por costo (30%) y canal (20%)', 'Costos', 'H3 = F3/(1-0,3)', '→ Pronóstico, Impuestos', 'USD 5,03', 'Mezcla de monedas', 'Método conservado como referencia en Bs', 'Precio'),
 ('Otros gastos', 'Hypotolab', 'Gastos mensuales', 'Bs', 'E = D / 6,96', '→ ER, Precio', 'USD 4.833/trimestre', 'Conversión fija', 'En Bs por área', 'Otros gastos'),
 ('Estado de resultados', 'Hypotolab', 'ER', 'Igual a Ñapefit', 'Idem', '→ Flujo', 'Utilidad 2026 USD 27.661', 'Publicidad escrita a mano; IUE trimestral', 'Idem Ñapefit', 'Estado de resultado'),
 ('Inversión', 'Hypotolab', 'Inversión total', 'Incluye IVA e IT en capital de trabajo', 'Suma', '→ Rentabilidad', 'USD 157.723', 'Capital de trabajo de un año; incluye impuestos', 'Período de desfase; se conserva la "validación" previa (aquí de laboratorio)', 'Inversión'),
 ('Flujo de caja', 'Hypotolab', 'Flujo directo', 'ER, impuestos', 'Idem', '→ Rentabilidad', 'Flujo 2026 USD 42.473', 'No descuenta el IUE en el flujo anual; rangos corridos (D46 = SUM(D11:G11)); "IVA" de 7.200 que era la validación médica', 'IUE pagado; rangos por año correctos', 'Flujo de caja'),
 ('TRMA', 'Hypotolab', 'CAPM', 'β 1,32; CRP 13,75%', 'Igual', '→ Rentabilidad', '30,07%', 'Riesgo país de 2025 (ya bajó)', 'Riesgo país actualizado y conversión a Bs', 'TRMA'),
 ('Rentabilidad', 'Hypotolab', 'VAN, TIR, PRI, perpetuidad, punto de equilibrio', 'Flujos', 'VR = H14/(H10-0)', 'Flujo, TRMA, Precio, Inventario', 'VAN USD 87.426; TIR 46,9%', 'Suma valor por perpetuidad y además capital de trabajo; "3 años 4 meses" escrito cuando la fórmula da 3,05 años; equilibrio con precio con impuestos', 'Valor residual con selector; PRI calculado; equilibrio corregido', 'Rentabilidad'),
]

def build_matriz(B):
    ws = B.sheet('Matriz comparativa', 'MATRIZ COMPARATIVA DE LAS HOJAS ORIGINALES', 'Ñapefit (20 hojas) y Hypotolab (19 hojas): objetivo, fórmulas, errores, mejoras y hoja equivalente en este modelo.', tab='808080')
    hd = ['Hoja original', 'Archivo', 'Objetivo', 'Variables de entrada', 'Fórmulas principales', 'Dependencias', 'Resultado relevante (moneda original)', 'Errores identificados', 'Mejoras aplicadas', 'Hoja en el nuevo modelo']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}5', h, 'hdr')
    widths(ws, {'A': 18, 'B': 11, 'C': 28, 'D': 22, 'E': 26, 'F': 24, 'G': 20, 'H': 46, 'I': 38, 'J': 20})
    r = textsheet(ws, 6, MATRIZ, height=75)
    put(ws, f'A{r+1}', 'Valores de los originales leídos de sus resultados guardados (USD a 6,96). Ñapefit además tenía 2 vínculos a archivos externos: "Plan financiero HIPOTAB.xlsx" y "REPELTEX T.xlsx".', 'note')
    ws.freeze_panes = 'C6'
    return ws

PRODS = [('P1', 'Filtro de agua 2.0 (cerámica, plata y carbón de cáscara de castaña)', 'Hogares que compran botellones o hierven agua', [3, 5, 4, 3, 3, 5, 5, 4, 5, 4, 4, 5, 4, 5],
          'Materiales locales, inversión moderada, tecnología abierta y probada; ahorro claro frente al botellón; un solo producto, ideal para el simulador.'),
         ('P2', 'Envases desechables biodegradables de bagazo de caña', 'Restaurantes y delivery', [4, 4, 5, 4, 3, 3, 2, 3, 3, 4, 5, 4, 2, 4],
          'Gran mercado y bagazo local, pero la máquina de moldeo es costosa (cotizaciones en USD, ahora a ~12 Bs/USD) y compite con envases importados.'),
         ('P3', 'Bloques de construcción con plástico reciclado', 'Constructoras y autoconstrucción', [4, 3, 4, 4, 4, 3, 3, 4, 2, 2, 4, 3, 2, 4],
          'Precio unitario bajo y necesidad de ensayos de resistencia; venta B2B lenta.'),
         ('P4', 'Kit de riego por goteo con sensor de humedad para huertos', 'Huertos urbanos y pequeños productores', [4, 3, 3, 4, 3, 3, 4, 2, 3, 3, 4, 4, 3, 4],
          'Componentes electrónicos importados (riesgo cambiario) y mercado más pequeño.'),
         ('P5', 'Macetas y almacigueras biodegradables de cascarilla de arroz', 'Viveros y productores forestales', [4, 3, 2, 4, 4, 4, 4, 4, 3, 2, 3, 3, 4, 4],
          'Proceso sencillo, pero nicho B2B pequeño y estacional.')]
CRIT = [('Innovación', 0.07), ('Necesidad del mercado', 0.09), ('Mercado potencial', 0.09), ('Diferenciación', 0.06), ('Competencia (5 = poca)', 0.06),
        ('Viabilidad técnica', 0.09), ('Inversión necesaria (5 = baja)', 0.08), ('Costos de fabricación (5 = bajos)', 0.07), ('Margen de contribución', 0.08),
        ('Facilidad de comercialización', 0.06), ('Escalabilidad', 0.05), ('Compatibilidad con Juego de Negocios', 0.07), ('Riesgos operativos y financieros (5 = bajos)', 0.07), ('Viabilidad académica', 0.06)]

def build_seleccion(B):
    ws = B.sheet('Selección de producto', 'SELECCIÓN DEL PRODUCTO: MATRIZ PONDERADA (14 criterios)', 'Puntajes de 1 a 5 = juicio del equipo con base en la información de FUENTES; son supuestos editables, no resultados de encuesta.', tab='70AD47')
    widths(ws, {'A': 62, 'B': 10, 'C': 12, 'D': 12, 'E': 12, 'F': 12, 'G': 12})
    put(ws, 'A5', 'Alternativas', 'sec')
    for i, (c, n, m, s, j) in enumerate(PRODS):
        put(ws, f'A{6+i}', f'{c}: {n}', 'label', bold=True); put(ws, f'B{6+i}', m, 'label'); ws.merge_cells(f'B{6+i}:G{6+i}')
    r = 12
    put(ws, f'A{r}', 'Criterio', 'hdr'); put(ws, f'B{r}', 'Peso', 'hdr')
    for i, p in enumerate(PRODS): put(ws, f'{L(3+i)}{r}', p[0], 'hdr')
    r += 1; c0 = r
    for k, (cn, w) in enumerate(CRIT):
        put(ws, f'A{r}', cn, 'label'); put(ws, f'B{r}', w, 'input', FMT_PCT)
        for i, p in enumerate(PRODS): put(ws, f'{L(3+i)}{r}', p[3][k], 'input', FMT_INT)
        r += 1
    c1 = r - 1
    put(ws, f'A{r}', 'Suma de pesos (debe ser 100%)', 'label'); put(ws, f'B{r}', f'=SUM(B{c0}:B{c1})', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'PUNTAJE PONDERADO (máx. 5)', 'label', bold=True)
    for i in range(5): put(ws, f'{L(3+i)}{r}', f'=SUMPRODUCT($B${c0}:$B${c1},{L(3+i)}{c0}:{L(3+i)}{c1})', 'calc', FMT_BS2, bold=True, fill=FILL_KEY)
    rs = r; r += 1
    put(ws, f'A{r}', 'Ranking', 'label', bold=True)
    for i in range(5): put(ws, f'{L(3+i)}{r}', f'=RANK({L(3+i)}{rs},$C${rs}:$G${rs})', 'calc', FMT_INT, bold=True)
    r += 1
    put(ws, f'A{r}', 'PRODUCTO GANADOR', 'label', bold=True)
    put(ws, f'B{r}', f'=INDEX($C${c0-1}:$G${c0-1},MATCH(MAX($C${rs}:$G${rs}),$C${rs}:$G${rs},0))', 'calc', bold=True, fill=FILL_KEY); r += 2
    put(ws, f'A{r}', 'Justificación por alternativa', 'sec'); r += 1
    for (c, n, m, s, j) in PRODS:
        put(ws, f'A{r}', f'{c}: {n}', 'label', bold=True); put(ws, f'B{r}', j, 'label', wrap=True); ws.merge_cells(f'B{r}:G{r}'); ws.row_dimensions[r].height = 32; r += 1
    r += 1
    put(ws, f'A{r}', 'Si P1 resultara inviable con datos de campo, la siguiente alternativa del ranking debe evaluarse con este mismo modelo (cambiando MP, Capacidad Inst., Demanda y Precio).', 'note')
    return ws

def build_competencia(B):
    ws = B.sheet('Competencia', 'ANÁLISIS DE LA COMPETENCIA Y SUSTITUTOS', 'Precios de competidores: celdas vacías hasta relevarlos en tiendas (no se inventan).', tab='70AD47')
    widths(ws, {'A': 38, 'B': 34, 'C': 40, 'D': 16, 'E': 18, 'F': 30})
    hd = ['Competidor / sustituto', 'Ventaja para el cliente', 'Desventaja frente a nuestro kit', 'Precio relevado (Bs)', 'Índice de precio (nuestro PVP / competidor)', 'Fuente del precio']
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}5', h, 'hdr')
    rows = [('Agua embotellada en botellón 20 L', 'Cómoda, sin mantenimiento', 'Gasto mensual alto; hay que cargar y almacenar bidones'),
            ('Hervir el agua', 'Muy conocido, sin compra inicial', 'Consume gas y tiempo; sabor; no retiene sedimentos'),
            ('Jarras filtrantes importadas', 'Marcas conocidas', 'Cartuchos importados caros y difíciles de conseguir; costo en USD'),
            ('Purificadores de ósmosis inversa o UV', 'Alta remoción', 'Precio alto, requieren electricidad, instalación y repuestos importados'),
            ('Filtros cerámicos artesanales o importados', 'Mismo principio', 'Calidad variable, sin control de laboratorio ni garantía local')]
    for i, (a, b, c) in enumerate(rows):
        r = 6 + i
        put(ws, f'A{r}', a, 'label', bold=True); put(ws, f'B{r}', b, 'label', wrap=True); put(ws, f'C{r}', c, 'label', wrap=True)
        put(ws, f'D{r}', None, 'input', FMT_BS2)
        put(ws, f'E{r}', f"=IF(D{r}>0,PVP/D{r},\"a relevar\")", 'calc', FMT_BS2)
        put(ws, f'F{r}', 'Pendiente de relevamiento', 'note'); ws.row_dimensions[r].height = 30
    put(ws, 'A12', 'Fuerzas competitivas (Porter)', 'sec')
    porter = [('Rivalidad', 'Media: no se identificó en esta investigación un fabricante local dominante de filtros cerámicos; el sustituto principal es el botellón.'),
              ('Amenaza de nuevos ingresantes', 'Media: la tecnología es abierta; la barrera es la validación de laboratorio y la marca.'),
              ('Poder de proveedores', 'Bajo para arcilla y aserrín; medio para el contenedor plástico y la plata coloidal.'),
              ('Poder de compradores', 'Alto en el canal indirecto (exigen margen y crédito); bajo en venta directa.'),
              ('Sustitutos', 'Altos: botellón y hervir el agua. La propuesta compite por ahorro.')]
    for i, (a, b) in enumerate(porter):
        put(ws, f'A{13+i}', a, 'label', bold=True); put(ws, f'B{13+i}', b, 'label', wrap=True); ws.merge_cells(f'B{13+i}:F{13+i}')
    put(ws, 'A19', 'Ventaja frente al botellón (ver Producto): ahorro anual estimado del hogar', 'label'); put(ws, 'D19', f"='Producto'!B{ROW['PM.ahorro']}", 'link', FMT_BS)
    return ws

def build_estrategia(B):
    ws = B.sheet('Estrategia comercial', 'ESTRATEGIA COMERCIAL: MEZCLA DE MARKETING, CANALES Y GASTOS COMERCIALES', '', tab='70AD47')
    widths(ws, {'A': 34, 'B': 16, 'C': 16, 'D': 16, 'E': 16, 'F': 16, 'G': 16})
    mix = [('Producto', 'Filtro 2.0 con capa de carbón, indicador de cambio, QR del lote, garantía de 6 meses y aviso de cambio por WhatsApp.'),
           ('Precio', 'Bs 420 en 2027: menos que 6 meses de botellones; se ajusta cada año por inflación.'),
           ('Plaza', 'Canal directo (planta, redes sociales con entrega, ferias) y canal indirecto (ferreterías, supermercados, farmacias).'),
           ('Promoción', 'Demostraciones con prueba de agua, redes sociales, ferias barriales, alianzas con juntas vecinales y material en punto de venta.')]
    r = 5
    for a, b in mix:
        put(ws, f'A{r}', a, 'label', bold=True); put(ws, f'B{r}', b, 'label', wrap=True); ws.merge_cells(f'B{r}:G{r}'); ws.row_dimensions[r].height = 30; r += 1
    r += 1
    put(ws, f'A{r}', 'Canales', 'sec'); r += 1
    put(ws, f'A{r}', 'Ventas por canal directo', 'label'); put(ws, f'B{r}', '=MIX_DIRECTO', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'Ventas por canal indirecto', 'label'); put(ws, f'B{r}', '=1-MIX_DIRECTO', 'calc', FMT_PCT); r += 1
    put(ws, f'A{r}', 'Margen del canal indirecto', 'label'); put(ws, f'B{r}', '=MARGEN_CANAL', 'calc', FMT_PCT); r += 2
    put(ws, f'A{r}', 'Distribución del presupuesto de publicidad', 'sec'); r += 1
    put(ws, f'A{r}', 'Medio', 'hdr'); put(ws, f'B{r}', '% del presupuesto', 'hdr'); put(ws, f'C{r}', 'Bs 2027', 'hdr'); r += 1
    med = [('Redes sociales y pauta digital', 0.35), ('Demostraciones y ferias', 0.25), ('Material en punto de venta', 0.15), ('Alianzas comunitarias', 0.10), ('Radio y TV local', 0.15)]
    m0 = r
    for a, p in med:
        put(ws, f'A{r}', a, 'label'); put(ws, f'B{r}', p, 'input', FMT_PCT); put(ws, f'C{r}', f'=B{r}*PUBLICIDAD_MES*12*M_FIJOS', 'calc', FMT_BS); r += 1
    put(ws, f'A{r}', 'Total', 'label', bold=True); put(ws, f'B{r}', f'=SUM(B{m0}:B{r-1})', 'calc', FMT_PCT, bold=True); put(ws, f'C{r}', f'=SUM(C{m0}:C{r-1})', 'calc', FMT_BS, bold=True); r += 2
    put(ws, f'A{r}', 'Gastos comerciales y cobertura por año', 'sec'); r += 1
    year_hdr(ws, r); r += 1
    arow(ws, r, 'Cobertura de distribución', '%', lambda y: f"='Demanda'!{ac(y)}{ROW['DEM.cob']}", FMT_PCT); r += 1
    arow(ws, r, 'Gastos de comercialización (ER)', 'Bs', lambda y: f"='Estado de resultado'!{yc(y)}{ROW['ER.tcom']}", FMT_BS); r += 1
    arow(ws, r, 'Gasto comercial / ventas netas', '%', lambda y: f"='Estado de resultado'!{yc(y)}{ROW['ER.tcom']}/'Estado de resultado'!{yc(y)}{ROW['ER.vn']}", FMT_PCT); r += 1
    arow(ws, r, 'Costo comercial por kit vendido', 'Bs/kit', lambda y: f"='Estado de resultado'!{yc(y)}{ROW['ER.tcom']}/'Estado de resultado'!{yc(y)}{ROW['ER.u']}", FMT_BS2); r += 1
    return ws

def build_proceso(B):
    ws = B.sheet('Proceso productivo', 'PROCESO PRODUCTIVO', 'Etapas, equipos, tiempos y controles de calidad (base: método de Potters for Peace, adaptado).', tab='5B9BD5')
    widths(ws, {'A': 6, 'B': 30, 'C': 52, 'D': 30, 'E': 18, 'F': 40})
    hd = ['N°', 'Etapa', 'Descripción', 'Equipo', 'Tiempo', 'Control de calidad']
    rows = [(1, 'Recepción de materiales', 'Arcilla, aserrín/cascarilla, plata coloidal, contenedores, grifos y empaques', 'Balanza', '—', 'Humedad y limpieza de la arcilla; lote del proveedor'),
            (2, 'Molienda y tamizado', 'Moler la arcilla seca y tamizar arcilla y aserrín', 'Molino de martillos, tamizadora', 'Continuo', 'Granulometría'),
            (3, 'Mezclado', 'Mezclar arcilla y aserrín en proporción fija y agregar agua', 'Amasadora', 'Por lote', 'Proporción por peso registrada'),
            (4, 'Prensado', 'Dar forma de maceta al elemento con molde', 'Prensa hidráulica', '≈ 6 min/filtro', 'Espesor de pared'),
            (5, 'Secado', 'Secado al aire en estanterías', 'Estanterías', '7 a 10 días', 'Fisuras'),
            (6, 'Cocción', 'Cocción a ~860 °C; el aserrín se quema y deja poros', 'Horno a gas 1 m³', '1 cocción/día', 'Pirómetro; curva de temperatura'),
            (7, 'Prueba de caudal', 'Saturar con agua y medir litros por hora', 'Estaciones de prueba', '≈ 12 h', 'Caudal 1-3 L/h (fuera de rango = merma)'),
            (8, 'Plata coloidal', 'Aplicar la solución de plata', 'Mesa de trabajo', 'Minutos', 'Dosis por filtro'),
            (9, 'Capa de carbón activado', 'Colocar la capa de carbón de cáscara de castaña en la tapa filtrante', 'Mesa dosificadora', '≈ 2 min/kit', 'Peso de la capa'),
            (10, 'Ensamblaje y empaque', 'Montar en el balde con grifo e indicador de cambio, pegar el QR del lote', 'Mesa de ensamblaje', '≈ 4 min/kit', 'Fugas; QR legible'),
            (11, 'Control de laboratorio', 'Análisis microbiológico por muestreo de lotes', 'Laboratorio externo', 'Mensual', 'Remoción de bacterias (requisito antes de vender)')]
    for j, h in enumerate(hd): put(ws, f'{L(1+j)}5', h, 'hdr')
    r = textsheet(ws, 6, rows, height=30)
    put(ws, f'A{r+1}', 'Flujo: Materiales → Molienda → Mezcla → Prensado → Secado → Cocción → Prueba de caudal → Plata → Ensamblaje → Inventario de producto terminado → Ventas. Capacidad por etapa en la hoja Capacidad Inst..', 'note')
    return ws

def build_localizacion(B):
    ws = B.sheet('Infraestructura', 'LOCALIZACIÓN DE LA PLANTA Y PUESTA EN MARCHA', 'Método de ponderación de ambos originales, con la fórmula corregida (mismos pesos para todas las opciones).', tab='5B9BD5')
    widths(ws, {'A': 38, 'B': 10, 'C': 18, 'D': 18, 'E': 18, 'F': 40})
    put(ws, 'A5', 'Criterio', 'hdr'); put(ws, 'B5', 'Peso', 'hdr')
    opts = ['Opción A: zona industrial norte', 'Opción B: zona sur (Plan 3000)', 'Opción C: municipio vecino (Warnes)']
    for i, o in enumerate(opts): put(ws, f'{L(3+i)}5', o, 'hdr')
    crit = [('Acceso y cercanía al mercado', 4, [4, 4, 3]), ('Costo del alquiler', 5, [3, 4, 5]), ('Espacio para secado', 4, [4, 3, 5]),
            ('Gas natural y servicios básicos', 3, [5, 4, 4]), ('Cercanía a la arcilla', 2, [3, 3, 4])]
    for i, (c, w, s) in enumerate(crit):
        r = 6 + i
        put(ws, f'A{r}', c, 'label'); put(ws, f'B{r}', w, 'input', FMT_INT)
        for j, v in enumerate(s): put(ws, f'{L(3+j)}{r}', v, 'input', FMT_INT)
    put(ws, 'A11', 'PUNTAJE TOTAL', 'label', bold=True)
    for j in range(3): put(ws, f'{L(3+j)}11', f'=SUMPRODUCT($B$6:$B$10,{L(3+j)}6:{L(3+j)}10)', 'calc', FMT_INT, bold=True, fill=FILL_KEY)
    put(ws, 'A12', 'Mejor opción', 'label', bold=True); put(ws, 'C12', '=INDEX(C5:E5,MATCH(MAX(C11:E11),C11:E11,0))', 'calc', bold=True)
    put(ws, 'A13', 'Puntajes = supuestos a confirmar visitando galpones disponibles.', 'note')
    put(ws, 'A15', 'PUESTA EN MARCHA (año 0, aprox. 3 meses; adaptado de los originales)', 'sec')
    hd = ['Etapa', 'Tiempo', 'Descripción']
    for j, h in enumerate(hd): put(ws, f'{L(1+j*2 if j else 1)}16', h, 'hdr')
    st = [('1. Búsqueda y contrato del galpón', '2 semanas', 'Con patio de secado, gas y agua'),
          ('2. Constitución legal y licencias', '1 mes', 'FUNDEMPRESA, NIT, licencia municipal'),
          ('3. Fabricación de horno y prensa', '4 semanas', 'Talleres locales, diseños abiertos'),
          ('4. Adecuación e instalación', '2 semanas', 'Instalación de gas, ventilación, piso'),
          ('5. Contratación y capacitación', '3 semanas', 'Jefe de producción y operarios'),
          ('6. Lote piloto y validación de laboratorio', '4 semanas', 'LOTE_PILOTO kits; análisis de remoción de bacterias'),
          ('7. Lanzamiento comercial', '2 semanas', 'Publicidad de lanzamiento, acuerdos con distribuidores')]
    for i, (a, b, c) in enumerate(st):
        put(ws, f'A{17+i}', a, 'label'); put(ws, f'C{17+i}', b, 'label'); put(ws, f'E{17+i}', c, 'label')
    return ws

FUENTES = [
    ('INE - Censo de Población y Vivienda 2024 (Cuadros 3, 4 y 8)', 'Población departamental y municipal, tasas de crecimiento', 'Tablas incluidas en los archivos Ñapefit y Hypotolab', 'Dato real (de los originales)'),
    ('Banco Central de Bolivia - Resolución de Directorio 88/2026 y tipo de cambio oficial', 'Fin del tipo fijo 6,96 (29/06/2026); régimen flexible', 'https://www.bcb.gob.bo/bcb_tco_publico_ultima_cotizacion.php', 'Consultado 11/11/2026 (vía buscador)'),
    ('Correo del Sur, 08/09/2026: "BCB fija el dólar oficial en Bs 12,64"', 'Nivel del tipo de cambio', 'https://correodelsur.com/economia/20260908/bcb-fija-el-dolar-oficial-en-bs-12-64-y-marca-nuevo-record.html', 'Consultado 11/11/2026'),
    ('allratestoday.com - tabla de tipo de cambio BCB', 'Bs 12,06 al 04/11/2026 (fuente secundaria)', 'https://allratestoday.com/es/central-bank-rates-api/bcbol/', 'Consultado 11/11/2026; verificar en BCB'),
    ('INE / eju.tv: inflación acumulada ene-oct 2026 = 6,03%', 'Inflación', 'https://eju.tv/?p=5139016', 'Consultado 11/11/2026'),
    ('Revista Mercado / Bloomberg Línea: riesgo país Bolivia 2026', 'EMBI ≈ 415 pb (17/08/2026)', 'https://revistamercado.do/money-invest/internacional-economia/riesgo-pais-2026-el-ranking-del-embi-en-america-latina-al-cierre-de-mayo/', 'Consultado 11/11/2026'),
    ('Akvopedia - Ceramic pot filter', 'Caudal 1-3 L/h; cocción ~860 °C; plata coloidal', 'https://akvopedia.org/wiki/Ceramic_filter', 'Consultado 11/11/2026'),
    ('Potters for Peace - Ceramic Water Filter Project', '~50 filtros/día con 3-4 trabajadores; diseños abiertos de prensa y horno', 'https://www.pottersforpeace.org/ceramic-water-filter-project', 'Consultado 11/11/2026'),
    ('Ley 843 (texto ordenado)', 'IVA 13%, IT 3%, IUE 25%', 'Gaceta Oficial / Servicio de Impuestos Nacionales', 'Norma; igual en ambos originales'),
    ('DS 24051 (Reglamento del IUE), anexo de depreciaciones', 'Tasas de depreciación por clase de activo', 'Servicio de Impuestos Nacionales', 'Del conocimiento general; VERIFICAR'),
    ('DS 2055', 'Tasa máxima para crédito productivo', 'ASFI / Gaceta Oficial', 'Del conocimiento general; VERIFICAR vigencia'),
    ('Ley General del Trabajo y normativa de seguridad social', 'Aguinaldo, indemnización, prima, aportes', 'Ministerio de Trabajo / Gestora Pública', 'Tasas tomadas de los originales; VERIFICAR'),
    ('Archivo "OFICIAL ÑAPEFIT - INVERSIONES 3.xlsx"', 'Metodología, SMN 2021-2026, CAPM', 'Entregado por el usuario', 'Auditado'),
    ('Archivo "Plan financiero HIPOTAB.xlsx"', 'Metodología, stock de seguridad ASCM, punto de equilibrio', 'Entregado por el usuario', 'Auditado'),
    ('Sapag Chain, N. y Sapag Chain, R. Preparación y evaluación de proyectos (McGraw-Hill)', 'Método del período de desfase, flujo de fondos', 'Bibliografía académica', 'Referencia metodológica'),
    ('Baca Urbina, G. Evaluación de proyectos (McGraw-Hill)', 'Punto de equilibrio, capacidad, TMAR', 'Bibliografía académica', 'Referencia metodológica'),
]

def build_fuentes(B):
    ws = B.sheet('Fuentes', 'FUENTES Y BIBLIOGRAFÍA', 'Se distingue lo consultado en esta sesión, lo tomado de los originales y lo que falta verificar.', tab='808080')
    widths(ws, {'A': 62, 'B': 48, 'C': 70, 'D': 34})
    for j, h in enumerate(['Fuente', 'Qué se usó', 'Enlace / ubicación', 'Estado']): put(ws, f'{L(1+j)}5', h, 'hdr')
    r = textsheet(ws, 6, FUENTES, height=30)
    put(ws, f'A{r+1}', 'No se realizaron encuestas, cotizaciones ni visitas de campo: todo lo que depende de ellas está marcado como "Supuesto (validar)" en Supuestos.', 'note')
    return ws

def build_controles(B):
    ws = B.sheet('Controles', 'CONTROLES Y ALERTAS DE CONSISTENCIA', 'Cada control devuelve OK o REVISAR. El tablero muestra cuántos están en OK.', tab='FF0000')
    P = ROW
    widths(ws, {'A': 6, 'B': 70, 'C': 18, 'D': 14})
    for j, h in enumerate(['N°', 'Control', 'Valor', 'Estado']): put(ws, f'{L(1+j)}5', h, 'hdr')
    Q = lambda sh, k: f"'{sh}'!$D${P[k]}:$W${P[k]}"
    QC = lambda sh, k: f"'{sh}'!$C${P[k]}:$W${P[k]}"
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{P['ER.'+k]}"
    checks = [
        ('El balance cuadra en los 21 cierres (suma de diferencias absolutas)', f"=SUMPRODUCT(ABS({QC('Balance general','BAL.chk')}))", 'abs<1'),
        ('Inventario de producto terminado nunca negativo', f"=MIN({Q('Inventario','INV.ok')})", 'eq1'),
        ('Inventario de materiales nunca negativo', f"=MIN({Q('Compras','COM.ok')})", 'eq1'),
        ('La producción cabe en la capacidad en todos los trimestres', f"=MIN({Q('Capacidad Inst.','CAP.ok')})", 'eq1'),
        ('Caja ≥ caja mínima en todos los cierres', f"=MIN({QC('Flujo de caja','FC.ok')})", 'eq1'),
        ('Flujo de caja: operación + inversión + financiamiento = flujo neto', f"=SUMPRODUCT(ABS({QC('Flujo de caja','FC.chk')}))", 'abs<1'),
        ('Suma de flujos netos = caja final 2031', f"=SUM({QC('Flujo de caja','FC.neto')})-'Flujo de caja'!W{P['FC.sfin']}", 'abs<1'),
        ('Utilidades acumuladas del ER = resultados acumulados del balance', f"=SUM('Estado de resultado'!Y{P['ER.un']}:AC{P['ER.un']})-'Balance general'!W{P['BAL.res']}", 'abs<1'),
        ('La estacionalidad suma 100%', '=SUMA_EST-1', 'abs<0.0001'),
        ('Ventas anuales del escenario = suma de los trimestres', f"=SUM('Pronostico'!C{P['PRO.act.units']}:G{P['PRO.act.units']})-SUM({Q('Pronostico','PRO.q.units')})", 'abs<0.01'),
        ('Compras por material = compras totales', f"=SUM({Q('Compras','COM.det_tot')})-SUM({Q('Compras','COM.pago')})", 'abs<1'),
        ('Costo laboral por áreas = total', f"=SUMPRODUCT(ABS({Q('MANO DE OBRA','PER.chk')}))", 'abs<1'),
        ('Préstamo totalmente pagado al final', f"='Financiamiento'!W{P['FIN.saldo']}", 'abs<1'),
        ('VAN por fórmula NPV = suma de flujos descontados', f"=EV_VAN-'Rentabilidad'!C{P['EV.VAN_CHK']}", 'abs<1'),
        ('Punto de equilibrio alcanzable con la capacidad (todos los años)', f"=MIN('Rentabilidad'!C{P['PE.ok']}:G{P['PE.ok']})", 'eq1'),
        ('Sin errores de cálculo en ER, flujo y balance', f"=SUMPRODUCT(ISERROR('Estado de resultado'!C6:AC{P['ER.m_un']})*1)+SUMPRODUCT(ISERROR('Flujo de caja'!C6:AC{P['FC.chk']})*1)+SUMPRODUCT(ISERROR('Balance general'!C6:AC{P['BAL.chk']})*1)", 'eq0'),
        ('Encuesta: muestra mínima calculada', '=N_MUESTRA', 'info'),
        ('VAN económico positivo', '=EV_VAN', 'gt0'),
        ('TIR mayor que la TRMA', '=IF(ISNUMBER(EV_TIR),EV_TIR-TRMA,-1)', 'gt0'),
        ('Utilidad neta del último año positiva', f"={ER('un', 5)}", 'gt0'),
    ]
    r = 6
    for i, (d, f, kind) in enumerate(checks):
        put(ws, f'A{r}', i+1, 'label', FMT_INT); put(ws, f'B{r}', d, 'label')
        put(ws, f'C{r}', f, 'calc', FMT_BS2)
        cond = {'abs<1': f'ABS(C{r})<1', 'eq1': f'C{r}=1', 'abs<0.0001': f'ABS(C{r})<0.0001', 'abs<0.01': f'ABS(C{r})<0.01', 'eq0': f'C{r}=0', 'gt0': f'C{r}>0'}.get(kind)
        put(ws, f'D{r}', f'=IF({cond},"OK","REVISAR")' if cond else '="INFO"', 'calc', bold=True)
        r += 1
    put(ws, f'B{r+1}', 'Controles en OK', 'label', bold=True); put(ws, f'C{r+1}', f'=COUNTIF(D6:D{r-1},"OK")', 'calc', FMT_INT, bold=True)
    put(ws, f'B{r+2}', 'Controles evaluados', 'label', bold=True); put(ws, f'C{r+2}', f'=COUNTIF(D6:D{r-1},"OK")+COUNTIF(D6:D{r-1},"REVISAR")', 'calc', FMT_INT, bold=True)
    B.name('CTRL_OK', 'Controles', f'C{r+1}'); B.name('CTRL_TOT', 'Controles', f'C{r+2}')
    return ws

def build_sensibilidad(B):
    ws = B.sheet('Sensibilidad', 'ANÁLISIS DE SENSIBILIDAD Y PRUEBAS DE ESTRÉS', 'Resultados de corridas registradas (se cambia un supuesto, se recalcula todo el libro y se guarda el VAN). Ver INFORME_DE_PRUEBAS.md.', tab='7030A0')
    widths(ws, {'A': 40, 'B': 16, 'C': 16, 'D': 16, 'E': 16, 'F': 16, 'G': 30})
    put(ws, 'A5', 'Valores en vivo con los supuestos actuales', 'sec')
    put(ws, 'A6', 'VAN actual (Bs)', 'label'); put(ws, 'B6', '=EV_VAN', 'calc', FMT_BS)
    put(ws, 'A7', 'TIR actual', 'label'); put(ws, 'B7', '=EV_TIR', 'calc', FMT_PCT2)
    put(ws, 'A8', 'Escenario activo', 'label'); put(ws, 'B8', '=NOMBRE_ESCENARIO', 'calc')
    ROW['SEN.start'] = 10
    return ws

def build_dashboard(B):
    ws = B.sheet('Dashboard', 'TABLERO EJECUTIVO', 'Resumen del escenario activo. Todo se actualiza al cambiar Supuestos.', tab='1F4E5F')
    P = ROW
    widths(ws, {'A': 34, 'B': 30, 'C': 15, 'D': 34, 'E': 18, 'F': 15})
    ER = lambda k, y: f"'Estado de resultado'!{yc(y)}{P['ER.'+k]}"
    left = [('Escenario activo', '=NOMBRE_ESCENARIO', None), ('VAN económico (Bs)', '=EV_VAN', FMT_BS), ('TIR económica', '=EV_TIR', FMT_PCT2),
            ('TRMA (Bs nominales)', '=TRMA', FMT_PCT2), ('Relación beneficio/costo', '=EV_BC', FMT_X), ('Período de recuperación', f"='Rentabilidad'!C{P['EV.PRI_TXT']}", None),
            ('VAN del inversionista (Bs)', '=EV_VAN_INV', FMT_BS), ('TIR del inversionista', '=EV_TIR_INV', FMT_PCT2), ('Decisión', '=EV_DECISION', None),
            ('Inversión total (Bs)', '=INVERSION_TOTAL', FMT_BS), ('Préstamo (Bs)', '=PRESTAMO', FMT_BS), ('Aporte de socios (Bs)', '=APORTE_SOCIOS', FMT_BS)]
    right = [('Ventas 2027 (kits)', f"={ER('u',1)}", FMT_U), ('Ventas 2031 (kits)', f"={ER('u',5)}", FMT_U), ('Ventas netas 2027 (Bs)', f"={ER('vn',1)}", FMT_BS),
             ('Ventas netas 2031 (Bs)', f"={ER('vn',5)}", FMT_BS), ('Utilidad neta 2027 (Bs)', f"={ER('un',1)}", FMT_BS), ('Utilidad neta 2031 (Bs)', f"={ER('un',5)}", FMT_BS),
             ('Punto de equilibrio 2027 (kits)', f"='Rentabilidad'!C{P['PE.peu']}", FMT_U), ('Margen de seguridad 2027', f"='Rentabilidad'!C{P['PE.ms']}", FMT_PCT),
             ('Utilización de capacidad 2027', f"='Capacidad Inst.'!{yc(1)}{P['CAP.util']}", FMT_PCT), ('Utilización de capacidad 2031', f"='Capacidad Inst.'!{yc(5)}{P['CAP.util']}", FMT_PCT),
             ('Caja mínima trimestral (Bs)', f"=MIN('Flujo de caja'!C{P['FC.sfin']}:W{P['FC.sfin']})", FMT_BS), ('Controles en OK', '=CTRL_OK&" de "&CTRL_TOT', None)]
    put(ws, 'A5', 'Rentabilidad e inversión', 'sec'); put(ws, 'D5', 'Operación y liquidez', 'sec')
    for i, (l, f, fm) in enumerate(left):
        put(ws, f'A{6+i}', l, 'label'); put(ws, f'B{6+i}', f, 'calc', fm, bold=True)
    for i, (l, f, fm) in enumerate(right):
        put(ws, f'D{6+i}', l, 'label'); put(ws, f'E{6+i}', f, 'calc', fm, bold=True)
    r = 6 + max(len(left), len(right)) + 1
    put(ws, f'A{r}', 'Datos para gráficos', 'sec'); r += 1
    put(ws, f'A{r}', 'Año', 'hdr')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', str(2026+y), 'hdr')
    hr = r; r += 1
    series = [('Ventas netas', 'vn'), ('Utilidad neta', 'un'), ('EBIT', 'ebit')]
    for lbl, k in series:
        put(ws, f'A{r}', lbl, 'label')
        for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"={ER(k,y)}", 'link', FMT_BS)
        r += 1
    put(ws, f'A{r}', 'Flujo económico', 'label')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"='Rentabilidad'!{ec(y)}{P['EV.fe']}", 'link', FMT_BS)
    rfe = r; r += 1
    put(ws, f'A{r}', 'Caja al cierre del año', 'label')
    for y in range(1, 6): put(ws, f'{L(1+y)}{r}', f"='Flujo de caja'!{yc(y)}{P['FC.sfin']}", 'link', FMT_BS)
    rcj = r; r += 2
    ch = BarChart(); ch.title = 'Ventas netas, EBIT y utilidad neta (Bs)'; ch.height = 8; ch.width = 15
    ch.add_data(Reference(ws, min_col=1, max_col=6, min_row=hr+1, max_row=hr+3), from_rows=True, titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, max_col=6, min_row=hr))
    ws.add_chart(ch, f'A{r}')
    ch3 = LineChart(); ch3.title = 'Saldo de caja al cierre de cada trimestre (Bs)'; ch3.height = 8; ch3.width = 30
    fcws = B.wb['Flujo de caja']
    ch3.add_data(Reference(fcws, min_col=4, max_col=23, min_row=P['FC.sfin']), from_rows=True, titles_from_data=False)
    ch3.set_categories(Reference(B.wb['Calendario'], min_col=4, max_col=23, min_row=16))
    ch3.series[0].tx = SeriesLabel(v='Caja final')
    ch3.legend = None
    ch2 = BarChart(); ch2.title = 'Flujo económico y caja al cierre (Bs)'; ch2.height = 8; ch2.width = 15
    ch2.add_data(Reference(ws, min_col=1, max_col=6, min_row=rfe, max_row=rcj), from_rows=True, titles_from_data=True)
    ch2.set_categories(Reference(ws, min_col=2, max_col=6, min_row=hr))
    ws.add_chart(ch2, f'D{r}')
    ws.add_chart(ch3, f'A{r+18}')
    return ws

def build_portada(B, order):
    ws = B.sheet('Portada', 'MODELO EMPRESARIAL MAESTRO', 'Fusión metodológica de Ñapefit + Hypotolab aplicada a un producto físico no alimenticio', tab='1F4E5F')
    ws['A1'].font = Font(name=FONT, size=22, bold=True, color='1F4E5F')
    widths(ws, {'A': 36, 'B': 70})
    info = [('Producto', 'Kit purificador de agua con filtro cerámico y plata coloidal ("AQUATIERRA", nombre provisional)'),
            ('Mercado', 'Hogares urbanos de Santa Cruz de la Sierra y su área metropolitana (Bolivia)'),
            ('Moneda', 'Bolivianos (Bs) nominales. USD solo como referencia, con tipo de cambio editable y fechado'),
            ('Horizonte', 'Año 0 = 2026 (puesta en marcha) + 5 años de operación (2027-2031), en trimestres'),
            ('Carrera / materia', 'Ingeniería Comercial - Formulación y evaluación de proyectos / Juego de Negocios'),
            ('Integrantes', '(completar)'), ('Docente', '(completar)'), ('Fecha de la versión', '11/11/2026')]
    r = 5
    for a, b in info:
        put(ws, f'A{r}', a, 'label', bold=True); put(ws, f'B{r}', b, 'label', wrap=True); r += 1
    r += 1
    put(ws, f'A{r}', 'Resultados del escenario activo', 'sec'); r += 1
    for a, f, fm in [('Escenario', '=NOMBRE_ESCENARIO', None), ('VAN (Bs)', '=EV_VAN', FMT_BS), ('TIR', '=EV_TIR', FMT_PCT2), ('TRMA', '=TRMA', FMT_PCT2), ('Decisión', '=EV_DECISION', None), ('Controles en OK', '=CTRL_OK&" de "&CTRL_TOT', None)]:
        put(ws, f'A{r}', a, 'label'); put(ws, f'B{r}', f, 'calc', fm, bold=True, align=Alignment(horizontal='left')); r += 1
    r += 1
    put(ws, f'A{r}', 'Vea las hojas Índice y Leyenda. Las celdas azules con fondo amarillo son las únicas que se editan.', 'note')
    return ws

def build_indice(B, entries):
    ws = B.sheet('Índice', 'ÍNDICE DE HOJAS', 'Haga clic en el nombre para ir a la hoja.', tab='1F4E5F')
    widths(ws, {'A': 6, 'B': 30, 'C': 22, 'D': 90})
    for j, h in enumerate(['N°', 'Hoja', 'Bloque', 'Contenido']): put(ws, f'{L(1+j)}5', h, 'hdr')
    for i, (nm, blk, desc) in enumerate(entries):
        r = 6 + i
        put(ws, f'A{r}', i+1, 'label', FMT_INT)
        c = put(ws, f'B{r}', nm, 'label'); c.hyperlink = f"#'{nm}'!A1"; c.font = Font(name=FONT, size=10, color='0563C1', underline='single')
        put(ws, f'C{r}', blk, 'label'); put(ws, f'D{r}', desc, 'label', wrap=True)
    return ws

def build_leyenda(B):
    ws = B.sheet('Leyenda', 'CÓMO USAR EL MODELO', '', tab='1F4E5F')
    widths(ws, {'A': 30, 'B': 100})
    put(ws, 'A5', 'Celda editable (supuesto)', 'input'); put(ws, 'B5', 'Texto azul con fondo amarillo claro. Solo estas celdas se modifican.', 'label')
    put(ws, 'A6', 'Fórmula', 'calc'); put(ws, 'B6', 'Texto negro: cálculo dentro de la misma hoja. No escribir encima.', 'label')
    put(ws, 'A7', 'Vínculo a otra hoja', 'link'); put(ws, 'B7', 'Texto verde: trae un valor de otra hoja.', 'label')
    put(ws, 'A8', 'Resultado clave', 'calc', fill=FILL_KEY); put(ws, 'B8', 'Fondo amarillo intenso: indicador principal.', 'label')
    rows = [('Escenario', 'Cambie Supuestos → ESCENARIO (1 pesimista, 2 base, 3 optimista). Todo el libro se recalcula.'),
            ('Pruebas de estrés', 'Use los multiplicadores M_ en Supuestos (por ejemplo, M_PRECIO = 0,9 baja el precio 10%).'),
            ('Encuesta', 'Cargue respuestas reales en Muestra y encuesta; cuando alcancen el tamaño n, la aceptación medida reemplaza al supuesto.'),
            ('Juego de Negocios', 'SIMULADOR EMPRESARIAL (decisiones por período), DECISIONES Y ESCENARIOS (comparador) y CONTROL DE PERIODOS (plan vs. real).'),
            ('Controles', 'La hoja Controles debe mostrar todo en OK. Si algo dice REVISAR, el tablero lo indica.'),
            ('Flujo del modelo', 'Santa Cruz y Zona urbana → Demanda → Pronostico → Inventario (producción) → Compras y MANO DE OBRA → costos → Estado de resultado → Carga impositiva → Flujo de caja → Balance general → Rentabilidad → Dashboard.'),
            ('Moneda', 'Los estados financieros están en Bs. Lo importado se carga en $us y se convierte con el tipo de cambio de Supuestos; varias hojas muestran también la columna en $us.'),
            ('Tipo de cambio', 'Está en Supuestos. Si se cambia (por ejemplo a 12), se recalcula todo lo que está en dólares: máquinas importadas, laboratorio, computadoras, plata coloidal, grifo y las columnas en $us.')]
    for i, (a, b) in enumerate(rows):
        put(ws, f'A{10+i}', a, 'label', bold=True); put(ws, f'B{10+i}', b, 'label', wrap=True); ws.row_dimensions[10+i].height = 30
    return ws
