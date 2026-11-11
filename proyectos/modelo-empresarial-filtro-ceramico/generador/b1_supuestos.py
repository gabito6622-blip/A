from lib import *
import openpyxl

class RowMap(dict):
    misses = set()
    def __missing__(self, k):
        RowMap.misses.add(k)
        return 999
ROW = RowMap()

def build_supuestos(B):
    ws = B.sheet('SUPUESTOS', 'PANEL DE SUPUESTOS Y REGISTRO DE HIPÓTESIS',
                 'Todas las celdas azules con fondo amarillo son editables. Cada supuesto indica su tipo, fuente y cómo validarlo.', tab='FFC000')
    widths(ws, {'A': 24, 'B': 52, 'C': 14, 'D': 16, 'E': 18, 'F': 62, 'G': 46})
    hdrs = ['Código (nombre)', 'Descripción', 'Valor', 'Unidad', 'Tipo de dato', 'Fuente / justificación', 'Cómo validarlo']
    for j, h in enumerate(hdrs):
        put(ws, f'{L(1+j)}5', h, 'hdr')
    S = []
    sec = lambda t: S.append(('#', t))
    def p(nm, d, v, u, t, fu, va, fmt=None):
        S.append((nm, d, v, u, t, fu, va, fmt))
    REAL = 'Dato real (fuente)'; NORM = 'Norma legal'; EST = 'Estimación técnica'; SUP = 'Supuesto (validar)'; ORIG = 'Tomado de los originales'
    sec('1. PARÁMETROS GENERALES Y MONEDA')
    p('ANIO_INICIO', 'Primer año de operación (año 0 = 2026, puesta en marcha)', 2027, 'año', SUP, 'Ñapefit proyecta 2027-2031; se conserva el horizonte de 5 años.', 'Calendario académico del proyecto', FMT_INT)
    p('TIPO_CAMBIO', 'Tipo de cambio oficial Bs por USD (régimen flexible)', 12.06, 'Bs/USD', REAL, 'BCB abandonó el tipo fijo de 6,96 el 29/06/2026 (Res. Directorio 88/2026). Valor del 04/11/2026 según tabla del BCB reproducida por allratestoday.com; el 08/09/2026 el BCB fijó 12,64 (Correo del Sur).', 'Consultar bcb.gob.bo el día de la defensa y actualizar esta celda', FMT_BS2)
    p('FECHA_TC', 'Fecha del tipo de cambio usado', '04/11/2026', 'fecha', REAL, 'Ver fila anterior', 'Actualizar junto con el tipo de cambio')
    p('TC_HISTORICO', 'Tipo de cambio fijo usado en Ñapefit y Hypotolab (solo referencia)', 6.96, 'Bs/USD', ORIG, 'Vigente 2011-28/06/2026. No se usa en cálculos.', '—', FMT_BS2)
    p('INFL_BO', 'Inflación anual esperada en Bolivia (ajuste de costos)', 0.06, '% anual', EST, 'INE: inflación acumulada ene-oct 2026 = 6,03%; interanual a sep-2026 = 5,70% (BCB). Se usa 6% como proyección.', 'Comparar con el IPC del INE y el Informe de Política Monetaria del BCB', FMT_PCT)
    p('AJUSTE_PRECIO', 'Ajuste anual del precio de venta', '=INFL_BO', '% anual', SUP, 'Por defecto igual a la inflación (precio constante en términos reales).', 'Decisión comercial; ver hoja SENSIBILIDAD', FMT_PCT)
    p('INFL_US', 'Inflación esperada en EE.UU. (para convertir la TRMA de USD a Bs)', 0.025, '% anual', SUP, 'Supuesto cercano a la meta de la Reserva Federal (2%).', 'Consultar expectativas de inflación de EE.UU.', FMT_PCT)
    p('TASA_IVA', 'Impuesto al Valor Agregado (incluido en el precio facturado)', 0.13, '%', NORM, 'Ley 843 (texto ordenado). Igual en ambos originales.', 'Ley 843, Título I', FMT_PCT)
    p('TASA_IT', 'Impuesto a las Transacciones (sobre ingresos brutos)', 0.03, '%', NORM, 'Ley 843, Título VI. Igual en ambos originales.', 'Ley 843', FMT_PCT)
    p('TASA_IUE', 'Impuesto sobre las Utilidades de las Empresas', 0.25, '%', NORM, 'Ley 843, Título III. Igual en ambos originales.', 'Ley 843', FMT_PCT)
    p('DIAS_TRIM', 'Días laborables por trimestre (5 días x 12 semanas)', 60, 'días', ORIG, 'Mismo criterio que Ñapefit (Capacidad Inst.: K7*5*12).', 'Plan de turnos de la planta', FMT_INT)
    p('HORAS_TURNO', 'Horas por turno', 8, 'h/día', ORIG, 'Ñapefit: 8 h con 1 h de ocio.', 'Reglamento interno', FMT_INT)
    p('HORAS_OCIO', 'Horas no productivas por turno', 1, 'h/día', ORIG, 'Ñapefit: "Horas de ocio = 1".', 'Estudio de tiempos', FMT_INT)
    sec('2. MERCADO Y DEMANDA')
    p('TAM_HOGAR', 'Tamaño medio del hogar urbano', 3.5, 'personas/hogar', SUP, 'No se encontró el dato municipal del Censo 2024 en esta sesión.', 'Tabla de hogares del Censo 2024 (INE)', FMT_BS2)
    p('PCT_OBJETIVO', 'Hogares que compran agua embotellada o tratan el agua para beber', 0.50, '% hogares', SUP, 'Hipótesis sin encuesta. Es el principal supuesto de mercado.', 'Pregunta 1 de la encuesta (hoja MUESTRA_ENCUESTA)', FMT_PCT)
    p('CONSUMO_Q', 'Compra promedio de kits por hogar y año (renovación cada 2 años)', 0.5, 'kits/hogar/año', EST, 'Vida útil del elemento cerámico 1-2 años (Akvopedia, Potters for Peace). Se asume 2 años.', 'Pruebas de durabilidad y encuesta', FMT_BS2)
    p('ACEP_SUPUESTA', 'Aceptación del producto (si no hay encuesta)', 0.60, '%', SUP, 'Ñapefit usó 83% y Hypotolab 90% sin encuesta documentada; aquí se usa 60% por prudencia.', 'Se reemplaza sola cuando se cargan ≥ n encuestas', FMT_PCT)
    p('CRECE_PART', 'Crecimiento anual relativo de la participación de mercado', 0.10, '% anual', SUP, 'Los originales hacían crecer la participación al ritmo de la población (1,42%), lo que no tiene sustento comercial. Aquí refleja maduración de marca y distribución.', 'Seguimiento de ventas reales (CONTROL DE PERIODOS)', FMT_PCT)
    p('COB_2027', 'Cobertura de distribución 2027 (municipio de Santa Cruz de la Sierra)', "=POB_URB_MUN_2024/POB_URB_DEP_2024", '% hogares urbanos', REAL, 'Población urbana municipal / población urbana departamental (INE, Censo 2024).', 'Fórmula; no editar salvo cambio de estrategia', FMT_PCT)
    p('COB_2028', 'Cobertura de distribución 2028', '=COB_2027', '%', SUP, 'Se mantiene el municipio.', 'Plan de distribución', FMT_PCT)
    p('COB_2029', 'Cobertura 2029 (ingreso al área metropolitana)', 0.70, '%', SUP, 'Expansión a municipios vecinos mediante distribuidores.', 'Acuerdos con distribuidores', FMT_PCT)
    p('COB_2030', 'Cobertura 2030', 0.75, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('COB_2031', 'Cobertura 2031', 0.80, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('ESCENARIO', 'Escenario activo: 1 = Pesimista, 2 = Base, 3 = Optimista', 2, 'código', SUP, 'Mismo esquema de tres escenarios de ambos originales.', 'Cambiar para ver todo el modelo en otro escenario', FMT_INT)
    p('PART_PES', 'Participación inicial - escenario pesimista', 0.035, '% demanda efectiva', SUP, 'Originales: 1% / 3% / 5%. Se ajusta al tamaño del mercado de este producto.', 'Encuesta + ventas piloto', FMT_PCT)
    p('PART_BASE', 'Participación inicial - escenario base', 0.05, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('PART_OPT', 'Participación inicial - escenario optimista', 0.065, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('EST_T1', 'Estacionalidad: peso del 1er trimestre (verano)', 0.28, '% del año', SUP, 'Mayor consumo de agua en meses calurosos (dic-mar). Originales: 23/32/30/15% y 30/23/20/27%.', 'Ventas reales por trimestre', FMT_PCT)
    p('EST_T2', 'Estacionalidad: 2do trimestre', 0.22, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('EST_T3', 'Estacionalidad: 3er trimestre', 0.22, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    p('EST_T4', 'Estacionalidad: 4to trimestre', 0.28, '%', SUP, 'Idem', 'Idem', FMT_PCT)
    sec('3. MULTIPLICADORES DE ESTRÉS (1 = sin cambio). Sirven para pruebas y sensibilidad')
    p('M_DEMANDA', 'Multiplicador de unidades vendidas', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    p('M_PRECIO', 'Multiplicador del precio de venta', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    p('M_CVAR', 'Multiplicador de costos variables (materiales, energía, entrega)', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    p('M_FIJOS', 'Multiplicador de gastos operativos fijos (sin sueldos)', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    p('M_SALARIOS', 'Multiplicador de sueldos', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    p('M_INVERSION', 'Multiplicador de inversión en activos', 1, 'x', SUP, 'Prueba de estrés', '—', FMT_BS2)
    sec('4. COMERCIALIZACIÓN Y PRECIO')
    p('PVP', 'Precio de venta al público 2027, con factura (kit completo)', 390, 'Bs/kit', SUP, 'Precio de mercado elegido (ver hoja PRECIO: cubre el costo total y es menor al gasto anual en botellones).', 'Prueba de precio en la encuesta y ventas piloto', FMT_BS)
    p('MIX_DIRECTO', 'Ventas por canal directo (tienda en planta, redes, ferias)', 0.40, '% unidades', SUP, 'El resto va por ferreterías, supermercados y farmacias.', 'Contratos con distribuidores', FMT_PCT)
    p('MARGEN_CANAL', 'Margen del canal indirecto sobre el precio al público', 0.25, '% del PVP', SUP, 'Ñapefit usó 30% y Hypotolab 20% para el canal indirecto.', 'Negociación con distribuidores', FMT_PCT)
    p('DIAS_COBRO_IND', 'Plazo de cobro al canal indirecto', 30, 'días', SUP, 'Crédito habitual a distribuidores.', 'Contratos', FMT_INT)
    p('ENTREGA_U', 'Costo de entrega por kit (2027, con factura)', 8, 'Bs/kit', SUP, 'Delivery o flete a punto de venta.', 'Cotizar servicio de reparto', FMT_BS2)
    p('PUBLICIDAD_MES', 'Presupuesto mensual de publicidad 2027', 8000, 'Bs/mes', SUP, 'Redes, demostraciones, ferias y material en punto de venta. Ñapefit/Hypotolab: Bs 5.000/año (muy bajo para lanzar un producto).', 'Plan de medios', FMT_BS)
    p('PRECIO_BOTELLON', 'Precio de un botellón de agua de 20 L (comparación)', 12, 'Bs', SUP, 'No se encontró precio publicado en esta sesión.', 'Relevar 5 distribuidoras de Santa Cruz', FMT_BS2)
    p('LITROS_DIA', 'Agua para beber y cocinar por hogar', 4, 'L/día', SUP, 'Hipótesis prudente.', 'Encuesta', FMT_BS2)
    p('MARKUP_COSTO', 'Utilidad sobre precio en el método de costo (referencia)', 0.30, '%', ORIG, 'Ñapefit 35%, Hypotolab 30%.', 'Política de precios', FMT_PCT)
    sec('5. PRODUCCIÓN E INVENTARIOS')
    p('PROD_OPERARIO', 'Filtros por operario y día', 12, 'filtros/op/día', EST, 'Potters for Peace: una planta básica con 3-4 trabajadores produce ~50 filtros/día.', 'Prueba piloto con cronómetro', FMT_BS2)
    p('MIN_OPERARIOS', 'Mínimo de operarios en planta', 2, 'personas', SUP, 'Seguridad en el horno y continuidad.', 'Plan de turnos', FMT_INT)
    p('MERMA', 'Merma del elemento cerámico (rotura o rechazo en prueba de caudal)', 0.10, '%', SUP, 'Supuesto prudente para un taller nuevo.', 'Registro de lotes piloto', FMT_PCT)
    p('SS_PT', 'Stock de seguridad de producto terminado (sobre ventas del trimestre siguiente)', 0.15, '%', ORIG, 'Hypotolab: ASCM recomienda 10-20%.', 'Rotación real', FMT_PCT)
    p('STOCK_MP', 'Stock final de materiales (sobre necesidades del trimestre siguiente)', 0.33, '%', SUP, 'Aproximadamente 1 mes de materiales.', 'Plazos de entrega de proveedores', FMT_PCT)
    p('INV_INI_PT', 'Inventario inicial de producto terminado (enero 2027)', 0, 'kits', SUP, 'El lote piloto se usa en validación y no se vende.', '—', FMT_U)
    p('LOTE_PILOTO', 'Filtros del lote piloto para validación', 200, 'kits', ORIG, 'Ñapefit: "2 lotes de 100 und" para pruebas piloto.', '—', FMT_U)
    p('COSTO_CAPAC_NUEVO', 'Capacitación por cada operario nuevo', 1500, 'Bs/persona', SUP, 'Inducción técnica en prensado, cocción y pruebas.', 'Cotizar curso', FMT_BS)
    sec('6. PERSONAL Y CARGAS SOCIALES')
    p('SMN', 'Salario mínimo nacional 2026', 3300, 'Bs/mes', ORIG, 'Valor usado en Ñapefit (hoja MANO DE OBRA, tabla de incremento salarial).', 'Decreto supremo de incremento salarial vigente', FMT_BS)
    p('INC_SAL', 'Incremento salarial anual', "='PERSONAL'!$C$13", '% anual', ORIG, 'Promedio de incrementos del SMN 2022-2026 (método de Ñapefit). Es mayor que la inflación: supuesto prudente.', 'Decretos de incremento salarial', FMT_PCT)
    p('TASA_CNS', 'Aporte patronal Caja Nacional de Salud', 0.10, '%', NORM, 'Igual en ambos originales.', 'Normativa de seguridad social', FMT_PCT2)
    p('TASA_RIESGO', 'Riesgo profesional (patronal)', 0.0171, '%', NORM, 'Igual en ambos originales.', 'Gestora Pública', FMT_PCT2)
    p('TASA_SOLIDARIO', 'Aporte patronal solidario', 0.035, '%', ORIG, 'Ñapefit usa 3,5% y Hypotolab 3%. Se adopta el mayor (prudente).', 'Confirmar tasa vigente con la Gestora Pública', FMT_PCT2)
    p('TASA_PROVIVIENDA', 'Aporte patronal pro vivienda', 0.02, '%', NORM, 'Igual en ambos originales.', 'Normativa', FMT_PCT2)
    p('TASA_AGUINALDO', 'Provisión de aguinaldo', 0.0833, '%', NORM, 'Un sueldo al año (1/12).', 'Ley General del Trabajo', FMT_PCT2)
    p('TASA_INDEMNIZACION', 'Previsión de indemnización (se paga a un fondo cada trimestre)', 0.0833, '%', NORM, 'Un sueldo por año trabajado. Igual en ambos originales.', 'Ley General del Trabajo', FMT_PCT2)
    p('TASA_GESTORA', 'Aporte laboral a la Gestora (descuento al trabajador, no es costo)', 0.1271, '%', NORM, 'Igual en ambos originales.', 'Gestora Pública', FMT_PCT2)
    p('BONO_ANT', 'Bono de antigüedad (2 a 4 años de servicio)', 0.05, '% de 3 SMN', NORM, 'Se calcula sobre 3 salarios mínimos (los originales lo calculaban sobre el sueldo).', 'Verificar con normativa laboral vigente', FMT_PCT)
    p('ANIO_BONO', 'Año del proyecto desde el que se paga el bono (2 años cumplidos)', 3, 'año', NORM, 'Personal contratado en enero 2027 cumple 2 años en 2029.', '—', FMT_INT)
    sec('7. FINANCIAMIENTO')
    p('PCT_PRESTAMO', 'Préstamo bancario como % de los activos fijos', 0.50, '%', SUP, 'Ninguno de los originales usó deuda (préstamo = 0).', 'Precalificación con un banco', FMT_PCT)
    p('TASA_PRESTAMO', 'Tasa de interés anual del préstamo', 0.115, '% anual', SUP, 'Tope de crédito productivo para microempresa según DS 2055 (verificar vigencia).', 'Cotización bancaria', FMT_PCT2)
    p('PLAZO_TRIM', 'Plazo del préstamo', 12, 'trimestres', SUP, '3 años, cuota fija trimestral (sistema francés).', 'Cotización bancaria', FMT_INT)
    sec('8. TASA MÍNIMA DE RENDIMIENTO (TRMA)')
    p('RF', 'Tasa libre de riesgo (bonos del Tesoro de EE.UU.)', 0.0445, '%', ORIG, 'Valor de Ñapefit (Hypotolab: 4,10%).', 'Rendimiento del bono a 10 años el día de la defensa', FMT_PCT2)
    p('BETA', 'Beta del sector', 0.9, 'x', ORIG, 'Valor de Ñapefit (Hypotolab: 1,32, sector alimentos). Supuesto para productos del hogar.', 'Beta desapalancada de Damodaran para "Household Products"', FMT_BS2)
    p('RM', 'Rendimiento esperado del mercado (S&P 500)', 0.1381, '%', ORIG, 'Valor de Ñapefit (Hypotolab: 13,36%). Ver serie 2021-2026 en la hoja TRMA.', 'Serie histórica del S&P 500', FMT_PCT2)
    p('CRP', 'Riesgo país Bolivia (EMBI)', 0.0415, '%', REAL, '415 puntos básicos al 17/08/2026 (Revista Mercado). Ñapefit usó 5,79%; Hypotolab 13,75% (dato de 2025).', 'Último EMBI publicado', FMT_PCT2)
    p('PRIMA_ADIC', 'Prima adicional por tamaño o riesgo del proyecto', 0.0, '%', SUP, 'Editable para pruebas (ver SENSIBILIDAD).', 'Criterio del evaluador', FMT_PCT2)
    sec('9. EVALUACIÓN Y CAPITAL DE TRABAJO')
    p('METODO_VR', 'Valor residual: 1 = contable (Ñapefit), 2 = perpetuidad (Hypotolab)', 1, 'código', ORIG, 'Por prudencia el método contable es el principal.', '—', FMT_INT)
    p('G_PERP', 'Crecimiento a perpetuidad (solo método 2)', 0.0, '%', ORIG, 'Hypotolab usó g = 0.', '—', FMT_PCT)
    p('METODO_CT', 'Capital de trabajo: 1 = período de desfase (Sapag), 2 = déficit acumulado del arranque (2027) + caja mínima', 2, 'código', SUP, 'Se usa el método 2 porque se verifica con el flujo de caja real del modelo; el desfase (método 1) dejaba ~Bs 160.000 ociosos en caja durante 5 años. El método 1 se informa como alternativa prudente.', 'Comparar ambos en INVERSION y en SENSIBILIDAD', FMT_INT)
    p('CAJA_MINIMA', 'Caja mínima: un mes de sueldos y gastos fijos de 2027 (colchón para desfases dentro del trimestre)', "=ROUND(('PERSONAL'!$D$"+str(ROW['PER.tot'])+"+'GASTOS_OPERATIVOS'!$D$"+str(ROW['GAS.pago'])+")/3,-3)", 'Bs', SUP, 'El modelo es trimestral y no ve los pagos de mitad de trimestre; se reserva un mes de costos fijos en efectivo.', 'Flujo mensual del primer año', FMT_BS)
    p('DIAS_INV_MP', 'Días de inventario de materiales', 30, 'días', SUP, 'Coherente con STOCK_MP (≈1 mes).', '—', FMT_INT)
    p('DIAS_PROCESO', 'Días de proceso (secado + cocción + pruebas)', 12, 'días', EST, 'Secado de 7-10 días + cocción + prueba de caudal.', 'Lote piloto', FMT_INT)
    p('DIAS_INV_PT', 'Días de inventario de producto terminado', 20, 'días', SUP, 'Coherente con SS_PT.', '—', FMT_INT)

    r = 6
    for item in S:
        if item[0] == '#':
            put(ws, f'A{r}', item[1], 'sec')
            for j in range(2, 8): ws[f'{L(j)}{r}'].fill = FILL_SEC
            r += 1; continue
        nm, d, v, u, t, fu, va, fmt = item
        put(ws, f'A{r}', nm, 'label', bold=True)
        put(ws, f'B{r}', d, 'label', wrap=True)
        put(ws, f'C{r}', v, 'input', fmt)
        put(ws, f'D{r}', u, 'note')
        put(ws, f'E{r}', t, 'label')
        put(ws, f'F{r}', fu, 'label', wrap=True)
        put(ws, f'G{r}', va, 'label', wrap=True)
        B.name(nm, 'SUPUESTOS', f'C{r}')
        ROW['SUP.' + nm] = r
        r += 1
    # validación del escenario
    dv = DataValidation(type='whole', operator='between', formula1='1', formula2='3', showErrorMessage=True,
                        errorTitle='Escenario', error='Ingrese 1, 2 o 3')
    ws.add_data_validation(dv); dv.add(f"C{ROW['SUP.ESCENARIO']}")
    dv2 = DataValidation(type='whole', operator='between', formula1='1', formula2='2', showErrorMessage=True)
    ws.add_data_validation(dv2); dv2.add(f"C{ROW['SUP.METODO_VR']}")
    # parámetro derivado: participación inicial del escenario activo
    r += 1
    put(ws, f'A{r}', 'PART_INICIAL', 'label', bold=True)
    put(ws, f'B{r}', 'Participación inicial del escenario activo (calculada)', 'label')
    put(ws, f'C{r}', '=CHOOSE(ESCENARIO,PART_PES,PART_BASE,PART_OPT)', 'calc', FMT_PCT)
    B.name('PART_INICIAL', 'SUPUESTOS', f'C{r}')
    r += 1
    put(ws, f'A{r}', 'NOMBRE_ESCENARIO', 'label', bold=True)
    put(ws, f'B{r}', 'Nombre del escenario activo', 'label')
    put(ws, f'C{r}', '=CHOOSE(ESCENARIO,"Pesimista","Base","Optimista")', 'calc')
    B.name('NOMBRE_ESCENARIO', 'SUPUESTOS', f'C{r}')
    r += 1
    put(ws, f'A{r}', 'SUMA_EST', 'label', bold=True)
    put(ws, f'B{r}', 'Control: la estacionalidad debe sumar 100%', 'label')
    put(ws, f'C{r}', '=EST_T1+EST_T2+EST_T3+EST_T4', 'calc', FMT_PCT)
    B.name('SUMA_EST', 'SUPUESTOS', f'C{r}')
    ws.freeze_panes = 'C6'
    return ws


def build_calendario(B):
    ws = B.sheet('CALENDARIO', 'CALENDARIO E ÍNDICES DE PRECIOS', 'Base temporal común: año 0 (2026) + 20 trimestres (2027-2031) + 5 columnas anuales.', tab='808080')
    hdr_time(ws)
    put(ws, 'A6', 'N° de trimestre', 'label'); put(ws, 'C6', 0, 'calc', FMT_INT)
    for q in range(1, NQ+1):
        put(ws, f'{qc(q)}6', 1 if q == 1 else f'={qc(q-1)}6+1', 'calc', FMT_INT)
    put(ws, 'A7', 'Año del proyecto (1-5)', 'label'); put(ws, 'C7', 0, 'calc', FMT_INT)
    for q in range(1, NQ+1):
        put(ws, f'{qc(q)}7', f'=INT(({qc(q)}6-1)/4)+1', 'calc', FMT_INT)
    put(ws, 'A8', 'Año calendario', 'label'); put(ws, 'C8', '=ANIO_INICIO-1', 'calc', FMT_INT)
    for q in range(1, NQ+1):
        put(ws, f'{qc(q)}8', f'=ANIO_INICIO+{qc(q)}7-1', 'calc', FMT_INT)
    put(ws, 'A9', 'Trimestre del año', 'label')
    for q in range(1, NQ+1):
        put(ws, f'{qc(q)}9', f'={qc(q)}6-4*({qc(q)}7-1)', 'calc', FMT_INT)
    put(ws, 'A10', 'Índice de precio de venta', 'label')
    put(ws, 'A11', 'Índice de costos (inflación)', 'label')
    put(ws, 'A12', 'Índice salarial', 'label')
    put(ws, 'A13', 'Peso estacional del trimestre', 'label')
    put(ws, 'A14', 'Fin de año (1 = 4to trimestre)', 'label')
    put(ws, 'A15', 'Días laborables', 'label')
    for q in range(1, NQ+1):
        c = qc(q)
        put(ws, f'{c}10', f'=(1+AJUSTE_PRECIO)^({c}7-1)', 'calc', '0.0000')
        put(ws, f'{c}11', f'=(1+INFL_BO)^({c}7-1)', 'calc', '0.0000')
        put(ws, f'{c}12', f'=(1+INC_SAL)^({c}7-1)', 'calc', '0.0000')
        put(ws, f'{c}13', f'=CHOOSE({c}9,EST_T1,EST_T2,EST_T3,EST_T4)', 'calc', FMT_PCT)
        put(ws, f'{c}14', f'=IF({c}9=4,1,0)', 'calc', FMT_INT)
        put(ws, f'{c}15', '=DIAS_TRIM', 'calc', FMT_INT)
    for y in range(1, 6):
        c = yc(y)
        put(ws, f'{c}7', y, 'calc', FMT_INT)
        put(ws, f'{c}8', f'=ANIO_INICIO+{y-1}', 'calc', FMT_INT)
        put(ws, f'{c}10', f'=(1+AJUSTE_PRECIO)^({y}-1)', 'calc', '0.0000')
        put(ws, f'{c}11', f'=(1+INFL_BO)^({y}-1)', 'calc', '0.0000')
        put(ws, f'{c}12', f'=(1+INC_SAL)^({y}-1)', 'calc', '0.0000')
        put(ws, f'{c}13', f'=SUM({qc(4*y-3)}13:{qc(4*y)}13)', 'calc', FMT_PCT)
        put(ws, f'{c}15', f'=SUM({qc(4*y-3)}15:{qc(4*y)}15)', 'calc', FMT_INT)
    put(ws, 'A17', 'Nota: los índices convierten valores de 2027 a cada año. Precio, costos y sueldos se ajustan con tasas separadas (ver SUPUESTOS).', 'note')
    return ws


def build_poblacion(B, src_path):
    ws = B.sheet('POBLACION', 'POBLACIÓN DE SANTA CRUZ (INE, CENSO 2024) Y PROYECCIÓN',
                 'Tablas copiadas de los originales (INE Cuadros 3, 4 y 8). Las proyecciones usan la tasa del INE como celda, no como número escrito.', tab='70AD47')
    src = openpyxl.load_workbook(src_path, data_only=True)
    sc = src['Santa Cruz']; zu = src['Zona urbana']
    widths(ws, {'A': 8, 'B': 10, 'C': 16, 'D': 14, 'E': 18, 'F': 22, 'G': 18})
    for col in 'HIJKLMNOP': ws.column_dimensions[col].width = 12
    put(ws, 'A5', 'Cuadro 3 - Departamento de Santa Cruz: población por grupo de edad (INE)', 'sec')
    heads = ['N°', 'Nivel', 'Departamento', 'Provincia', 'Municipio', 'Área y edad', '2001 Total', '2001 H', '2001 M', '2012 Total', '2012 H', '2012 M', '2024 Total', '2024 H', '2024 M']
    for j, h in enumerate(heads): put(ws, f'{L(2+j)}6', h, 'hdr')
    r = 7
    for sr in range(9, 30):
        for j in range(15):
            v = sc.cell(sr, 2+j).value
            put(ws, f'{L(2+j)}{r}', v, 'label', FMT_U if isinstance(v, (int, float)) else None)
        r += 1
    r_dep_tot = 7  # fila de total departamental (2024 en col N)
    r += 1
    put(ws, f'A{r}', 'Cuadro 8 - Indicadores de crecimiento intercensal (INE)', 'sec'); r += 1
    heads8 = ['N°', 'Nivel', 'Departamento', 'Provincia', 'Municipio', 'Área', 'Crec. abs 2001-2012', 'Crec. abs 2012-2024', 'Crec. rel 2001-2012 (%)', 'Crec. rel 2012-2024 (%)', 'Tasa anual 2001-2012 (%)', 'Tasa anual 2012-2024 (%)']
    for j, h in enumerate(heads8): put(ws, f'{L(2+j)}{r}', h, 'hdr')
    r += 1; r8 = r
    for sr in range(41, 44):
        for j in range(12):
            v = sc.cell(sr, 2+j).value
            put(ws, f'{L(2+j)}{r}', v, 'label', '#,##0.0000' if isinstance(v, float) else (FMT_U if isinstance(v, int) else None))
        r += 1
    r8_tot, r8_urb = r8, r8 + 1
    r += 1
    put(ws, f'A{r}', 'Cuadro 4 - Municipio de Santa Cruz de la Sierra por área y edad (INE)', 'sec'); r += 1
    for j, h in enumerate(heads): put(ws, f'{L(2+j)}{r}', h, 'hdr')
    r += 1; r4 = r
    for sr in range(9, 33):
        for j in range(15):
            v = zu.cell(sr, 2+j).value
            put(ws, f'{L(2+j)}{r}', v, 'label', FMT_U if isinstance(v, (int, float)) else None)
        r += 1
    r4_urb = r4 + 8  # fila "Urbana" del municipio
    r += 1
    put(ws, f'A{r}', 'CÁLCULOS DERIVADOS (fórmulas)', 'sec'); r += 1
    calc = [
        ('POB_DEP_2024', 'Población departamental 2024', f'=N{r_dep_tot}', FMT_U),
        ('TASA_DEP', 'Tasa anual de crecimiento departamental 2012-2024', f'=M{r8_tot}/100', FMT_PCT2),
        ('TASA_URB', 'Tasa anual de crecimiento urbano departamental 2012-2024', f'=M{r8_urb}/100', FMT_PCT2),
        ('POB_URB_DEP_2024', 'Población urbana departamental 2024 = crec. absoluto 2012-24 / crec. relativo + crec. absoluto', f'=I{r8_urb}/(K{r8_urb}/100)+I{r8_urb}', FMT_U),
        ('POB_URB_MUN_2024', 'Población urbana del municipio de Santa Cruz de la Sierra 2024', f'=N{r4_urb}', FMT_U),
        ('POB_MUN_18_59_URB', 'Población urbana municipal de 18 a 59 años (usada por Ñapefit)', f'=SUM(N{r4_urb+4}:N{r4_urb+6})', FMT_U),
    ]
    for nm, d, f, fm in calc:
        put(ws, f'A{r}', '', 'label'); put(ws, f'B{r}', nm, 'label', bold=True)
        put(ws, f'F{r}', d, 'label')
        ws.merge_cells(f'F{r}:L{r}')
        put(ws, f'M{r}', f, 'calc', fm)
        B.name(nm, 'POBLACION', f'M{r}')
        r += 1
    r += 1
    put(ws, f'A{r}', 'PROYECCIÓN 2024-2031 (P_t = P_t-1 x (1 + tasa INE))', 'sec'); r += 1
    years = list(range(2024, 2032))
    put(ws, f'B{r}', 'Serie', 'hdr'); ws.merge_cells(f'B{r}:F{r}')
    for j, yv in enumerate(years): put(ws, f'{L(7+j)}{r}', str(yv), 'hdr')
    r += 1
    ROW['POB.year_row'] = r - 1
    series = [('Población departamental total', 'POB_DEP_2024', 'TASA_DEP'),
              ('Población urbana departamental', 'POB_URB_DEP_2024', 'TASA_URB'),
              ('Población urbana municipal (Santa Cruz de la Sierra)', 'POB_URB_MUN_2024', 'TASA_URB')]
    for k, (lbl, base, rate) in enumerate(series):
        put(ws, f'B{r}', lbl, 'label'); ws.merge_cells(f'B{r}:F{r}')
        put(ws, f'G{r}', f'={base}', 'calc', FMT_U)
        for j in range(1, len(years)):
            put(ws, f'{L(7+j)}{r}', f'={L(6+j)}{r}*(1+{rate})', 'calc', FMT_U)
        ROW[f'POB.s{k}'] = r
        r += 1
    put(ws, f'B{r+1}', 'Columnas de 2027 a 2031 = J a N. Fuente: INE, Censo de Población y Vivienda 2024 (tablas incluidas en Ñapefit y Hypotolab).', 'note')
    # columnas 2027..2031 -> J..N  (2024=G)
    return ws
