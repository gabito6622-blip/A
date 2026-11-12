# Guía para la defensa

Explica cada hoja del archivo `MODELO_EMPRESARIAL_MAESTRO.xlsx` (formato clonado de Ñapefit): qué calcula, con qué método, de dónde salen los datos y cómo responder las preguntas más probables del licenciado. Las cifras citadas corresponden al **escenario base** de la versión del 11/11/2026.

## 0. La idea en una frase

Se tomó la metodología común de Ñapefit e Hypotolab (población → demanda → pronóstico → producción → costos → estados financieros → evaluación), se corrigieron sus errores y se aplicó a un producto físico no alimenticio: un **kit purificador de agua con filtro cerámico y plata coloidal**, fabricado en Santa Cruz. Todo el libro está en bolivianos y se recalcula solo cuando cambia un supuesto.

## 1. Cómo está organizado

Las **20 primeras hojas son un clon de Ñapefit**: mismos nombres, mismo orden y el mismo estilo (encabezados dorados, totales anuales en verde, bordes, Calibri). Después vienen las hojas nuevas.

| Bloque | Hojas | Para qué sirve |
|---|---|---|
| Clon de Ñapefit: mercado | Santa Cruz, Zona urbana, Demanda, Pronostico | Población, demanda y ventas por escenario |
| Clon de Ñapefit: producción | Inventario, Inv. terminado, MP, Capacidad Inst., Infraestructura, Compras, Maqu. y equip., MANO DE OBRA, Otros gastos | Cuánto producir, con qué y con quién |
| Clon de Ñapefit: finanzas | Precio, Inversión, Estado de resultado, Carga impositiva, Flujo de caja, TRMA, Rentabilidad | Precio, estados financieros y evaluación (VAN, TIR, PRI, punto de equilibrio) |
| Nuevas: entradas | Supuestos, Calendario | Todo lo editable está en Supuestos |
| Nuevas: finanzas | Financiamiento, Balance general, Ratios, Sensibilidad | Préstamo, balance que cuadra, indicadores y escenarios |
| Nuevas: Juego de Negocios | SIMULADOR EMPRESARIAL, DECISIONES Y ESCENARIOS, CONTROL DE PERIODOS | Preparar decisiones y comparar plan contra real |
| Nuevas: tablero y controles | Dashboard, Controles | Resumen y alertas |
| Nuevas: investigación | Producto, Selección de producto, Muestra y encuesta, Competencia, Estrategia comercial, Proceso productivo | Justificar el producto y la estrategia |
| Nuevas: referencias | Matriz comparativa, Fuentes, Índice, Leyenda | Auditoría, fuentes y navegación |

**Convención de colores:** azul con fondo amarillo = supuesto editable; negro = fórmula; verde = vínculo a otra hoja; amarillo intenso = resultado clave.

**Supuestos con nombre:** las fórmulas usan nombres (`PVP`, `TASA_IVA`, `ACEPTACION`), por ejemplo `=PVP*M_PRECIO`. Se puede leer una fórmula sin buscar celdas.

## 2. Hoja por hoja

### Supuestos
Panel único de entradas. Cada fila tiene: nombre, descripción, valor, unidad, **tipo de dato** (dato real con fuente, norma legal, estimación técnica, supuesto a validar, tomado de los originales), fuente y forma de validarlo.
- *¿Por qué hay "multiplicadores" M_?* Para pruebas de estrés: `M_PRECIO = 0,9` baja el precio 10% en todo el libro sin tocar fórmulas.
- *¿Cómo se cambia de escenario?* `ESCENARIO` = 1, 2 o 3.

### Calendario
Año 0 (2026) + 20 trimestres (2027-2031). Calcula los índices de ajuste: precio `(1+AJUSTE_PRECIO)^(año-1)`, costos `(1+INFL_BO)^(año-1)` y sueldos `(1+INC_SAL)^(año-1)`. Separarlos permite ver qué pasa si los sueldos suben más que los precios (es lo que se supone: 8,96% contra 6%).

### Santa Cruz y Zona urbana
Son copia fiel de las hojas de Ñapefit (mismos cuadros del INE, mismo formato). Debajo se agregaron los cálculos. Calcula:
- Tasa de crecimiento urbana departamental = 1,587% anual (Cuadro 8 del INE).
- Población urbana departamental 2024 = crecimiento absoluto 2012-24 / crecimiento relativo + crecimiento absoluto = **2.586.612**.
- Proyección `P_t = P_t-1 × (1 + tasa)`. A diferencia de los originales, la tasa está en una celda y no escrita en cada fórmula.

### Demanda
Cadena (método de los originales, con cada porcentaje en SUPUESTOS):
`hogares = población urbana / 3,5` → `× cobertura` (municipio en 2027-28 = 61,9%; área metropolitana 70-80% desde 2029) → `× 50% hogares objetivo` → `× 0,5 kits por hogar y año` = **demanda potencial 119.944 kits en 2027** → `× 60% aceptación` = **demanda efectiva 71.966 kits**.
- *¿Por qué 0,5?* El elemento cerámico dura 1-2 años (Akvopedia, Potters for Peace): se supone renovación cada 2 años.
- *¿De dónde sale el 60%?* Es un supuesto. Los originales usaban 83% y 90% sin encuesta. Cuando se carguen al menos 384 encuestas en la hoja Muestra y encuesta, la aceptación medida reemplaza sola al supuesto.

### Muestra y encuesta
Tamaño de muestra para población finita: `n = Z²·p·q·N / (e²·(N−1) + Z²·p·q)` con 95% de confianza, p = 0,5 y e = 5% → **n = 384 hogares**. Incluye el cuestionario (7 preguntas, cada una valida un supuesto) y la tabulación. **No se inventaron respuestas.**

### Pronostico
Mismo diseño que Ñapefit: recuadro de escenarios, una tabla por escenario con los años hacia abajo y las tablas trimestrales "AÑOS / TRIMESTRES" (1ER a 4TO).
Tres escenarios como en los originales: `ventas = demanda potencial × aceptación × participación`. Participación inicial 3,5% / 5% / 6,5%, que crece 10% al año por maduración de marca y distribución. Las ventas del escenario activo se reparten por trimestre (28/22/22/28%: más en verano).
- Ventas base: **3.598 kits en 2027 → 7.249 en 2031** (5% → 7,3% de la demanda efectiva).
- *Corrección:* Hypotolab omitía la aceptación en el escenario esperado; Ñapefit hacía crecer la participación al ritmo de la población (1,42%), sin sustento comercial.

### Precio
1. **Precio elegido (de mercado):** PVP Bs 390 con factura en 2027. Canal directo (40%) cobra el PVP; canal indirecto (60%) cobra PVP × (1 − 25%). Precio promedio facturado: **Bs 331,50**; neto de IVA: Bs 288,41.
2. **Método de costo (el de los originales):** costo unitario total 2027 Bs 276,97 → `/(1 − 30%)` → `× (1 + 19,05%)` de IVA e IT = Bs 471 por kit. Es mayor que el precio de mercado porque en 2027 se vende poco y los costos fijos pesan mucho: **por eso 2027 casi no deja utilidad (margen operativo 0,5%)**. A medida que crece el volumen, el costo unitario baja.
3. **Frente al cliente:** un hogar que toma 4 L/día gasta Bs 876 al año en botellones; el kit cuesta Bs 195 por año (Bs 390 cada 2 años). Ahorro: **Bs 681/año**; recupera la compra en 5,3 meses.
- *¿De dónde sale 19,05%?* `(IVA + IT)/(1 − IVA − IT) = 0,16/0,84`. Los originales tenían 19,04% escrito a mano.

### MP
Lista de materiales por kit: arcilla 5 kg, aserrín 0,6 kg, plata coloidal 2 ml, contenedor de 20 L, grifo y empaque; merma de 10% en lo cerámico. Costo por kit con factura **Bs 86,17**; costo variable de producción neto de IVA (con gas) **Bs 80,71**. Los precios son supuestos a cotizar (no se inventaron proveedores).

### Capacidad Inst.
Capacidad por etapa (molienda, mezclado, prensado, secado, cocción, prueba de caudal, ensamblaje). La capacidad instalada es la de la **etapa más lenta** (secado y horno: 50 filtros/día = 12.000 al año), igual a la referencia de Potters for Peace. Utilización: **31% en 2027 → 61% en 2031**. Hay una fila de control por trimestre.
- *Corrección:* Ñapefit medía la utilización contra el secador, no contra el cuello de botella.

### Inventario e Inv. terminado (plan de producción)
`Producción = ventas + stock de seguridad − inventario inicial`, con stock de 15% de las ventas del trimestre siguiente (idea ASCM de Hypotolab). El inventario final de un trimestre es el inicial del siguiente. Se valoriza a **costo promedio ponderado** (costeo variable: materiales + energía).

### Compras
Compras en "juegos" (materiales para un kit): `compras = necesidad + stock final (33% del trimestre siguiente) − stock inicial`. Detalle en kilos, mililitros y unidades por material, y en Bs con y sin IVA. Una fila de control verifica que el detalle sume lo mismo que el total.

### MANO DE OBRA
Igual que en Ñapefit, hay una **planilla mensual por año** (2027-2031) con sueldo básico, bono, total ganado, Gestora, líquido pagable, aportes patronales, aguinaldo, indemnización, total mensual y total anual. Debajo está la planilla trimestral que alimenta los estados; una fila de control comprueba que las dos den lo mismo (diferencia 0 en los 5 años).
4 cargos fijos y operarios que **dependen de la producción**: `operarios = máx(2, redondeo(producción / (12 filtros × 60 días)))`, el máximo del año (no se despide por estacionalidad). Cargas: CNS 10%, riesgo 1,71%, solidario 3,5%, pro vivienda 2%, aguinaldo 8,33%, indemnización 8,33% = **33,87%** sobre el total ganado. Bono de antigüedad desde el 3er año sobre 3 salarios mínimos.
- *¿Por qué 3,5% de aporte solidario?* Ñapefit usaba 3,5% y Hypotolab 3%: se tomó el mayor por prudencia (pendiente de confirmar).

### Otros gastos
Gastos mensuales por área (fabricación, administración, comercialización), con o sin factura. El IVA de los que tienen factura es crédito fiscal y no gasto. Entrega variable de Bs 8 por kit.

### Maqu. y equip.
Horno, prensa, molino, amasadora, tamizadora, estanterías, estaciones de prueba, laboratorio (cotizado en USD y convertido con el tipo de cambio), herramientas, muebles y computadoras: **Bs 209.708**. Depreciación sobre el valor neto de IVA con las tasas del DS 24051 (12,5%, 25%, 10%). En 2031 se reponen computadoras y herramientas (vida útil cumplida).

### Inversión
| Concepto | Bs |
|---|---|
| Activos fijos | 209.708 |
| Diferidos (constitución, honorarios, validación de laboratorio, marca, capacitación, adecuación) + puesta en marcha (lote piloto, 2 meses de sueldos y alquiler, lanzamiento) | 146.057 |
| Capital de trabajo | 108.308 |
| **Total** | **464.073** (≈ USD 38.480) |

Financiamiento: préstamo de Bs 104.854 (50% de los activos fijos) y aporte de socios de Bs 359.219.

**Capital de trabajo, dos métodos:**
- *Período de desfase (Sapag):* 80 días × costo anual / 360 = Bs 216.345.
- *Déficit acumulado del arranque (usado):* el flujo trimestral muestra que en 2027 la caja baja como máximo Bs 53.308; se suma una reserva de un mes de costos fijos (Bs 55.000) porque el modelo trimestral no ve los pagos de mitad de trimestre → Bs 108.308.
- *¿Por qué no el desfase?* Con él la caja nunca bajaba de Bs 163.000: había dinero ocioso 5 años. El desfase queda como prueba prudente (VAN más bajo, ver SENSIBILIDAD).

### Financiamiento
Préstamo a 3 años, cuota fija trimestral (sistema francés), 11,5% anual (tope de crédito productivo para microempresa según DS 2055; confirmar con el banco). Cuota = `PMT(11,5%/4; 12; −préstamo)` = Bs 10.455.

### Carga impositiva
- IVA: débito (13% de lo facturado) − crédito (13% de compras con factura) − saldo a favor anterior. Si sale negativo, se arrastra (los originales lo perdían).
- IT: 3% de lo facturado, cada trimestre.
- IUE: 25% de la utilidad anual, registrado en diciembre y pagado en abril del año siguiente.
- Prima anual: solo si hay utilidad; el menor entre un mes de sueldos y 25% de la utilidad; se paga en el primer trimestre siguiente.
- Simplificaciones prudentes: no se compensa IT con IUE ni se arrastran pérdidas.

### Estado de resultado
Ventas facturadas − IVA = ventas netas − costo de ventas (materiales y energía) = utilidad bruta − gastos de fabricación, administración y comercialización − IT = EBIT − intereses = UAI − IUE = utilidad neta.

| Bs | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---|---|---|---|---|
| Ventas netas | 1.037.772 | 1.229.249 | 1.645.973 | 2.088.930 | 2.639.311 |
| EBIT | 5.360 | 66.145 | 141.524 | 365.410 | 684.528 |
| Utilidad neta | (5.389) | 44.344 | 104.012 | 274.057 | 513.396 |

- *¿Por qué casi no hay utilidad en 2027?* Ventas de 3.598 kits contra un punto de equilibrio de 3.570: el primer año se cubren apenas los costos fijos. El resultado mejora con volumen (apalancamiento operativo).

### Flujo de caja
Método directo: cobros (40% contado + 60% a 30 días) − pagos de materiales, energía, sueldos, gastos, entrega, IVA, IT, IUE, prima, intereses y amortización. Año 0: aporte + préstamo − inversiones. Caja mínima trimestral: **Bs 55.000** (3er trimestre de 2027). El anual es la suma de los trimestres. Control: operación + inversión + financiamiento = flujo neto.

### Balance general
Nuevo (ningún original lo tenía). Activo: caja, cuentas por cobrar, inventarios, crédito fiscal IVA, activo fijo y diferido netos. Pasivo: IUE y prima por pagar, préstamo. Patrimonio: capital y resultados acumulados. **Cuadra en los 21 cierres** (fila de control = 0).
- *¿Cómo sé que los estados están integrados?* Si cualquier cifra del estado de resultados o del flujo estuviera mal enlazada, el balance no cuadraría. Además, CONTROLES compara la suma de utilidades con los resultados acumulados y la suma de flujos con la caja final.

### TRMA
`Ke (USD) = Rf + β(Rm − Rf) + riesgo país = 4,45% + 0,9 × (13,81% − 4,45%) + 4,15% = 17,02%`.
Como los flujos están en **bolivianos nominales**, se convierte con Fisher: `TRMA = (1 + 17,02%) × (1 + 6%) / (1 + 2,5%) − 1 = 21,02%`.
- *¿Por qué el riesgo país es 4,15% y no 13,75% como en Hypotolab?* El EMBI de Bolivia bajó de más de 2.000 pb (abril 2025) a unos 415 pb (agosto 2026). Con 13,75% la TRMA sería mayor: ver SENSIBILIDAD (fila TRMA).
- WACC de referencia: 18,2%. Se evalúa con la TRMA, que es más exigente.

### Rentabilidad
Flujo económico (sin deuda): `EBIT − IUE sobre EBIT + depreciación y amortización − inversiones + recuperación del IVA de la inversión − aumento del capital de trabajo + valor residual`.

| Indicador | Valor |
|---|---|
| VAN a la TRMA | **Bs 191.168** |
| TIR | **32,63%** (TRMA 21,02%) |
| Relación B/C | 1,41 |
| Recuperación simple | 3 años, 6 meses y 9 días |
| Recuperación descontada | 4,38 años |
| VAN del inversionista (con préstamo) | Bs 212.020; TIR 35,7% |

- *PRI:* `año anterior + |acumulado anterior| / flujo del año` (interpolación). Corrige el signo cambiado de Ñapefit.
- *Valor residual:* contable (valor en libros de los activos, método de Ñapefit) = Bs 83.218. Por perpetuidad (Hypotolab) sería mucho mayor; no se usa por prudencia.
- *Recuperación del IVA:* el IVA pagado al comprar activos vuelve como crédito fiscal en el primer año (el débito de ventas lo absorbe).

### Rentabilidad (sección D: punto de equilibrio)
`PE = costos fijos / (precio neto − costo variable unitario)`. 2027: 681.162 / (288,41 − 97,62) = **3.570 kits**; margen de seguridad 0,8%. 2031: 4.415 kits; margen de seguridad 39,1%. Siempre bajo la capacidad (máximo 37%).

### Ratios
Márgenes, ROA, ROE, liquidez, endeudamiento, cobertura de intereses, rotación de inventario y utilización.

### Sensibilidad
Resultados de corridas registradas: se cambia una variable (−20%, −10%, +10%, +20%), se recalcula todo y se guarda el VAN y la TIR. Incluye **puntos críticos** (valor que hace VAN = 0) y pruebas de estrés combinadas. Es la hoja para la pregunta "¿y si no se cumple el supuesto?".

### SIMULADOR EMPRESARIAL
Modelo trimestral simplificado para 12 períodos. Para cada decisión hay tres filas: sugerido (del modelo maestro), decisión (se escribe) y usado. Calcula demanda con elasticidades (precio −1,2; publicidad 0,10; distribución 0,05: supuestos), capacidad, producción real (limitada por capacidad y materiales), ventas (limitadas por stock), inventarios, utilidad, deuda, caja, liquidez y endeudamiento. **No reproduce el simulador del docente**: la tabla final separa lo que decide la empresa de lo que permite cambiar el juego (todo "por confirmar" hasta tener el manual).

### DECISIONES Y ESCENARIOS
(A) Resultados del escenario activo en vivo; (B) corridas registradas de los escenarios y de estrés; (C) comparador de decisiones para un año: subir/bajar precio, más publicidad, bajar costo variable, más deuda. Indica la alternativa con mayor utilidad neta.

### CONTROL DE PERIODOS
Plan (del modelo) contra real (se carga) por trimestre, con desviaciones y semáforo. Sirve para ir cargando los reportes del Juego de Negocios.

### Controles
19 controles evaluados (balance, inventarios, capacidad, caja, coherencia de flujos, préstamo pagado, VAN, sin errores...). En el escenario base: **19 de 19 en OK**.

## 3. Preguntas probables y respuestas cortas

1. **¿Por qué un filtro de agua?** Ganó la matriz de 14 criterios (4,28 sobre 5) por usar materiales locales, inversión moderada, tecnología probada y abierta, y un ahorro claro para el hogar. Le siguen envases de bagazo (3,54) y macetas de cascarilla (3,41).
2. **¿La demanda está inflada?** Se vende el 5% de la demanda efectiva en 2027 (3.598 de 71.966 kits) y 7,3% en 2031. Todos los porcentajes son supuestos marcados para validar; la hoja SENSIBILIDAD muestra qué pasa si no se cumplen.
3. **¿Es rentable de verdad?** En el escenario base sí (VAN Bs 191.168; TIR 32,6% > 21,0%). Pero es **sensible**: ver los puntos críticos en SENSIBILIDAD e INFORME_DE_VIABILIDAD. El escenario pesimista (participación de 3,5%) da VAN negativo.
4. **¿Por qué no se usó 6,96 Bs/USD?** El BCB dejó el tipo fijo el 29/06/2026. Se usa Bs 12,06 (04/11/2026), editable.
5. **¿Por qué la TRMA en Bs es mayor que en USD?** Porque los flujos incluyen inflación boliviana (6%); hay que descontarlos con una tasa que también la incluya.
6. **¿Dónde está la encuesta?** No se hizo trabajo de campo. Está el tamaño de muestra, el cuestionario y la tabulación lista; no se inventaron datos.
7. **¿Qué pasa si cambio una celda?** Todo se recalcula: demanda, producción, compras, personal, costos, estados, balance, VAN. CONTROLES avisa si algo deja de cuadrar.
8. **¿Qué se conservó de los originales?** Toda la metodología (ver AUDITORIA_COMPARATIVA.md). Se cambiaron los datos del producto y se corrigieron 25 errores.
