# Auditoría comparativa: Ñapefit + Hypotolab → Modelo empresarial maestro

Archivos auditados (entregados por el usuario):

- **Ñapefit**: `OFICIAL OFICIAL Ñ APEFIT- INVERSIONES 3.xlsx` — 20 hojas, 2.939 fórmulas, 2 vínculos a archivos externos.
- **Hypotolab**: `Plan financiero HIPOTAB.xlsx` — 19 hojas, 3.112 fórmulas, sin vínculos externos.

Método: se leyeron todas las celdas de ambos libros dos veces (fórmulas y valores guardados), se reconstruyó la cadena de dependencias entre hojas y se revisó cada fórmula principal. La matriz completa (39 filas, una por hoja original) está al final de este documento.

## 1. Qué tenía cada archivo

Ambos libros siguen **la misma metodología académica** (probablemente la plantilla de la cátedra). Cambian el producto y algunos detalles.

| Bloque | Ñapefit (snack de queso y yuca) | Hypotolab (láminas para hipotensión) |
|---|---|---|
| Población | `Santa Cruz` + `Zona urbana` (INE, Censo 2024) | `Santa Cruz` |
| Demanda | Población 18-59 urbana × % × consumo | Población ≥25 años × 5% hipotensos × consumo |
| Pronóstico | 3 escenarios (1/3/5% de participación), trimestres 23/32/30/15% | 3 escenarios, trimestres 30/23/20/27% |
| Inventario | `Inventario`, `Inv. terminado` (sin stock real) | `Inventario` (stock de seguridad ASCM 10-20%), `Inventario envases` |
| Materia prima | `MP` | `Costos (MP)` con proveedores reales |
| Compras | `Compras` | `Compras` |
| Capacidad | `Capacidad Inst.` | `Capacidad Instalada` |
| Localización | `Infraestructura` (matriz ponderada + puesta en marcha) | `Infraestructura` |
| Activos | `Maqu. y equip.` | `Maquinaria` |
| Personal | `MANO DE OBRA` (5 cargos) | `Sueldos y salarios` (6 cargos) |
| Gastos | `Otros gastos` | `Otros gastos` |
| Precio | `Precio` (costo + 35%) | `Precio` (costo + 30%) |
| Impuestos | `Carga impositiva` | `Impuestos` |
| Inversión | `Inversión` | `Inversión` (con "validación médica") |
| Estados | `Estado de resultado`, `Flujo de caja` | `Estado de resultados`, `Flujo de caja` |
| Tasa | `TRMA` (CAPM: 18,66%) | `TRMA` (CAPM: 30,07%) |
| Evaluación | `Rentabilidad` (VAN, TIR, PRI; punto de equilibrio vacío) | `Rentabilidad` (VAN, TIR, PRI, perpetuidad, punto de equilibrio) |

Ninguno de los dos tenía: balance general, préstamo (financiamiento = 0), análisis de sensibilidad, tamaño de muestra, encuesta tabulada, competencia, estrategia comercial, tablero, controles de consistencia ni gráficos. Ambos usaban dólares convertidos a un tipo de cambio fijo de 6,96 escrito a mano en cientos de celdas.

## 2. Metodología que se conservó

| Metodología original | Dónde está ahora |
|---|---|
| Población INE → demanda → aceptación × participación → ventas | `Santa Cruz y Zona urbana`, `Demanda`, `Pronostico` |
| Tres escenarios pesimista / esperado / optimista | `Pronostico` + selector `ESCENARIO` en `Supuestos` |
| Distribución trimestral de las ventas | `Pronostico` (pesos en `Supuestos`) |
| Stock de seguridad ASCM 10-20% (Hypotolab) | `Inventario e Inv. terminado` (15%) |
| Receta por unidad × precio = costo unitario | `MP` |
| Compras derivadas de la producción | `Compras` |
| Capacidad por máquina en horas y unidades | `Capacidad Inst.` |
| Matriz ponderada de localización y cronograma de puesta en marcha | `Infraestructura` |
| Activos con IVA separado y depreciación sobre el valor neto | `Maqu. y equip.` |
| Planilla con CNS, riesgo profesional, aporte solidario, pro vivienda, aguinaldo, indemnización, bono de antigüedad | `MANO DE OBRA` |
| Incremento salarial = promedio de incrementos del SMN (Ñapefit) | `MANO DE OBRA` → `INC_SAL` |
| Precio por método de costo + recargo de IVA e IT + precio para canal indirecto | `Precio` (sección B) |
| IVA débito − crédito, IT 3%, IUE 25% | `Carga impositiva` |
| Inversión fija + diferida + puesta en marcha + capital de trabajo | `Inversión` |
| Estado de resultados y flujo de caja directo, trimestral y anual | `Estado de resultado`, `Flujo de caja` |
| TRMA por CAPM con riesgo país | `TRMA` |
| VAN, TIR, PRI, valor residual contable (Ñapefit) y por perpetuidad (Hypotolab) | `Rentabilidad` (selector `METODO_VR`) |
| Punto de equilibrio (Hypotolab) | `Rentabilidad` |
| Validación previa del producto (Hypotolab: médica) | `Inversión`: validación en laboratorio acreditado |

Donde los dos archivos hacían lo mismo, se dejó **una sola implementación** y se documentó la equivalencia (por ejemplo, `Inventario` + `Inv. terminado` + `Inventario envases` → `Inventario e Inv. terminado`).

## 3. Errores encontrados y corregidos

### Ñapefit
1. **Flujo de caja, año 0**: `B26 = B25 + B24 + B21` suma la inversión en lugar de restarla (da +3.842 en vez de −38.698).
2. **Vínculos a otros archivos**: `Compras!G3` apunta a `[1]Inventario!G17` ("Plan financiero HIPOTAB.xlsx") y `Flujo de caja!D16:V16` a `[2]Estado de resultado` ("REPELTEX T.xlsx"). Los sueldos del flujo salían de otro proyecto.
3. **Programa de compras pegado como valores** (`Compras!D57:M65`): no coincide con las fórmulas de la misma hoja (almidón 33.787 kg contra 23.157 kg calculados).
4. **Capacidad mal medida**: la utilización se divide por la capacidad del secador (55.876 envases/trimestre) y no por el cuello de botella (selladora: 27.000). En el 2do trimestre la producción (32.218) supera la capacidad real.
5. **Inventario ficticio**: "inventario inicial" = ventas del mismo trimestre y final = 0 siempre.
6. **Pesos trimestrales distintos**: unidades con 23/32/30/15% y ventas en Bs con 19,7/34,2/25,6/20,5%.
7. **Pronóstico**: la fila 2028 en USD usa `$C$44` en los cuatro trimestres; precios escritos a mano (35; 39,2; 45,08...) que no salen de la hoja `Precio`.
8. **Demanda**: 2026 usa `×0,3` y `×0,2` aunque el rótulo dice 70%; consumo 20 en 2026 y 6 después.
9. **Precio**: `J14` toma Internet (`F4`) en lugar de suministros (`F8`); el total `F19` no incluye la depreciación que lista en `F18`; mezcla Bs y USD en la misma tabla.
10. **Mano de obra**: en 2027-2028 el total mensual suma el sueldo básico y no el total ganado; el bono de antigüedad del 5to año usa 11% (corresponde 5%, 4 años de servicio) y se calcula sobre el sueldo y no sobre 3 salarios mínimos.
11. **Infraestructura**: `M9` multiplica pesos cruzados (`K7×M6` y `K6×M7`).
12. **Rentabilidad**: el PRI tiene el signo cambiado (`B46+(C33+D46)/C47` = 1,89 años; correcto 2,11) y además está escrito a mano ("1 año y 11 meses"); el valor residual por perpetuidad quedó sin calcular; el punto de equilibrio está vacío.
13. **Flujo anual ≠ suma de trimestres**: el anual descuenta IUE y el trimestral no (159.706 contra 118.905 en 2027).
14. **Capital de trabajo**: un año completo de materiales y sueldos (USD 265.669 = 87% de la inversión).
15. **Estado de resultados**: mantenimiento (3.500) y transporte (1.000) escritos a mano, distintos de `Otros gastos`; IUE de 25% por trimestre.

### Hypotolab
1. **Escenario esperado sin aceptación**: `F18 = C18*E18` (los otros escenarios multiplican también por la aceptación).
2. **Flujo de caja sin IUE**: la fila de IUE del flujo anual está vacía, por lo que el flujo está sobrestimado.
3. **Rangos corridos** en el flujo anual: `D46 = SUM(D11:G11)` y `D50`, `E50` (debían ser `G11:J11`, etc.).
4. **Inventario con valores pegados** y el 10% de stock de seguridad solo en algunos trimestres.
5. **Valor residual doble**: suma perpetuidad (285.389) y además el capital de trabajo, con g = 0.
6. **PRI escrito a mano** ("3 años 4 meses", 3 / 4 / 19 en celdas fijas) cuando su propia fórmula da 3,05 años.
7. **Punto de equilibrio** con precio que incluye impuestos y costos fijos que incluyen IVA e IT.
8. **Capacidad**: usa las horas de la primera máquina para todas y mide la utilización contra una sola máquina.
9. **Merma del 10%** aplicada solo en la conversión a USD; agua y glicerina en ml rotuladas como kg.
10. **TRMA** con riesgo país de 13,75% (dato de 2025, cuando el EMBI superaba 2.000 pb).

### Ambos
- **Tipo de cambio fijo 6,96 escrito en cientos de celdas.** El BCB lo abandonó el 29/06/2026; hoy ronda Bs 12 por USD.
- **Sin balance general** y sin controles: no había forma de comprobar que los estados financieros fueran coherentes.
- **IUE trimestral** aunque haya pérdidas; **IVA a favor** que no se arrastra al período siguiente.
- **Costo de ventas = solo materia prima**, con sueldos de planta como gasto operativo (se mantiene como *costeo variable*, ahora explicado).

## 4. Modificaciones de diseño

- **Moneda única: bolivianos nominales.** El USD solo aparece como referencia, con tipo de cambio editable y fechado (`SUPUESTOS → TIPO_CAMBIO`, `FECHA_TC`).
- **Supuestos con nombre** (`PVP`, `TASA_IVA`, `ACEPTACION`…): las fórmulas se leen como texto (`=PVP*M_PRECIO`).
- **Registro de supuestos**: cada uno con tipo (dato real, norma, estimación técnica, supuesto a validar, tomado de los originales), fuente y forma de validarlo.
- **Inventario real** con arrastre entre trimestres y valuación a costo promedio ponderado.
- **Operarios según la producción** (antes la planilla era fija).
- **IUE anual** pagado en abril del año siguiente; **prima anual** solo si hay utilidades; **saldo a favor de IVA** que se arrastra.
- **Capital de trabajo** por período de desfase (Sapag), con el método del déficit acumulado como alternativa (`METODO_CT`).
- **TRMA ajustada por inflación** con la ecuación de Fisher: los precios y costos suben con la inflación de Bolivia y se pasan a $us con un tipo de cambio fijo.

## 5. Elementos nuevos

`Balance general` (cuadra en los 21 cierres), `Financiamiento` (préstamo, sistema francés), `Muestra y encuesta` (tamaño de muestra, cuestionario y tabulación que reemplaza sola el supuesto de aceptación cuando hay datos), `Competencia`, `Estrategia comercial`, `Proceso productivo`, `Selección de producto`, `Ratios`, `Sensibilidad`, `SIMULADOR EMPRESARIAL`, `DECISIONES Y ESCENARIOS`, `CONTROL DE PERIODOS`, `Dashboard`, `Controles`, `Fuentes`, `Índice`, `Calendario`. Flujo del inversionista, B/C, PRI descontado, WACC de referencia.

## 6. Lo que no se reprodujo y por qué

| Elemento | Motivo |
|---|---|
| Fotos de máquinas, locales y capturas del INE (≈ 30 imágenes en `Infraestructura`, `TRMA`, `Zona urbana`, `Costos (MP)`, `Rentabilidad`) | Son del producto alimenticio anterior o capturas de pantalla; no corresponden al nuevo producto. Las tablas del INE sí se copiaron como datos. |
| Recetas, proveedores y precios de Ñapefit e Hypotolab | Pertenecen a otros productos. Se conserva el método, no los valores. |
| Vínculos a "Plan financiero HIPOTAB.xlsx" y "REPELTEX T.xlsx" | Eran errores (dependencia de archivos ajenos). |
| Fórmulas matriciales sueltas (`Rentabilidad!C45`, `Pronóstico!C10`) | Se reemplazaron por fórmulas normales equivalentes. |
| Encuestas y cotizaciones | No existían en los originales y no se inventaron: hay plantilla y supuestos marcados para validar. |

## Anexo: matriz hoja por hoja

Una fila por hoja original. Montos en la moneda del original (USD a 6,96).

| Hoja original | Archivo | Objetivo | Fórmulas principales | Errores encontrados | Mejora aplicada | Hoja en el modelo |
|---|---|---|---|---|---|---|
| Santa Cruz | Ñapefit | Población departamental INE (Cuadros 3 y 8) y proyección 2025-2031 | C52 = B52*(1+0,01421517) | Tasa escrita como número en cada celda; T14 dice "hombres 20-64" pero suma ambos sexos de 25 a 64 | Tasa tomada de la celda del INE; rótulos corregidos | Santa Cruz / Zona urbana |
| Zona urbana | Ñapefit | Población del municipio por área y edad (INE Cuadro 4) | R19 = SUM(N21:N23); R20 = R19/B56 | R20 divide un dato municipal por la población departamental (mezcla niveles) | Se usan niveles coherentes (urbano departamental y urbano municipal) | Santa Cruz / Zona urbana |
| Demanda | Ñapefit | Demanda de mercado en unidades y Bs | D34 = D32*D33 | 2026 usa x0,3 y x0,2 aunque dice 70%; consumo 20 vs 6; precio con 10% fijo distinto del 12% de Pronóstico; 6,96 escrito | Cadena homogénea con supuestos con nombre; precio desde PRECIO | Demanda |
| Pronostico | Ñapefit | 3 escenarios de ventas y distribución trimestral | F = C*D*E; trimestres = anual x % | Precios escritos a mano; fila 2028 en USD usa $C$44 en los 4 trimestres; fórmulas sueltas H40/J41; participación crece con la población | Escenario activo seleccionable; precio vinculado; crecimiento de participación como supuesto explícito | Pronostico |
| Inventario | Ñapefit | Ventas trimestrales y "inventario" | C18 = C6*$E$14 | Los pesos de esta hoja no se usan para unidades pero sí para ventas en Bs (inconsistencia); factor E14 = 1 (sin stock de seguridad) | Un solo juego de pesos estacionales; stock de seguridad explícito | Inventario / Inv. terminado |
| Inv. terminado | Ñapefit | Inventario de producto terminado en unidades y USD | Inv. final = inicial - ventas | Inventario inicial = ventas del mismo trimestre: no hay inventario real; valuado en USD | Inventario que se arrastra entre trimestres y valuación a costo promedio en Bs | Inventario / Inv. terminado |
| MP | Ñapefit | Receta y costo de materia prima por envase | H20 = F20*F4/D20 | Rótulo "Bs/Kg" en costo por envase; restos de cálculos de otro producto (maltodextrina, glicerina) | Lista de materiales con merma, factura e IVA | MP |
| Capacidad Inst. | Ñapefit | Capacidad por máquina y utilización | M7 = K7*5*12; N17 = C17/$M$8 | Divide por la capacidad del secador (55.876) y no por el cuello de botella (selladora 27.000): en el 2do trimestre la producción (32.218) supera la capacidad real | Cuello de botella = MIN; control de capacidad por trimestre | Capacidad Inst. |
| Infraestructura | Ñapefit | Elección de local y puesta en marcha | L9 = suma de peso x puntaje | M9 multiplica pesos cambiados (K7 x M6 y K6 x M7) | SUMPRODUCT con los mismos pesos para todos | Infraestructura |
| Compras | Ñapefit | Necesidades y programa de compras | D29 = B22*$M$4 | G3 vinculado a otro archivo ([1]); el programa de compras (D57:M65) son valores pegados que no coinciden con las fórmulas (almidón 33.787 vs 23.157 kg) | Compras = necesidad + stock final - stock inicial, todo con fórmulas | Compras |
| Maqu. y equip. | Ñapefit | Activos fijos y depreciación | G = E - IVA; H = G x tasa | B5 usa un rango (B7:D7) como referencia de una celda; precios en USD a 6,96 | Moneda por activo y tipo de cambio editable; depreciación con tope y reposiciones | Maqu. y equip. |
| MANO DE OBRA | Ñapefit | Planilla con cargas sociales 2027-2031 | O = N + M + L + C | En 2027-2028 suma el básico (C) y no el total ganado (E); bono sobre el sueldo y 11% en el 5to año; P14 suelto | Operarios según producción; bono sobre 3 SMN; costos por área | MANO DE OBRA |
| Otros gastos | Ñapefit | Gastos mensuales | D = C x 3; E = D / 6,96 | Conversión fija a 6,96 | En Bs, por área, con factura o sin factura | Otros gastos |
| Precio | Ñapefit | Precio por método de costo | H3 = F3/(1-0,35); I3 = H3 x 19,04% | J14 toma Internet (F4) en lugar de suministros (F8); F19 no suma la depreciación que lista; mezcla Bs y USD | Método de costo como referencia + precio de mercado + precios por canal | Precio |
| Inversión | Ñapefit | Inversión total | H21 = H4+H6+H9+H15 | Capital de trabajo = 1 año completo de materiales y sueldos (87% de la inversión) | Capital de trabajo por período de desfase y verificado con el flujo de caja | Inversión |
| Estado de resultado | Ñapefit | ER trimestral y anual | D20 = D7 - D19; D22 = D20 x 25% | Mantenimiento y transporte escritos a mano (no coinciden con Otros gastos); IUE trimestral; costo de ventas solo materiales | Gastos vinculados; IUE anual; costos fijos por área; prima e intereses | Estado de resultado |
| Carga impositiva | Ñapefit | IVA, IT por año y trimestre | IVA = DF - CF | Ventas trimestrales con pesos distintos a los de unidades; no arrastra saldo a favor | Saldo a favor de IVA; IUE y prima con fecha de pago | Carga impositiva |
| Flujo de caja | Ñapefit | Flujo directo trimestral y anual | C21 = C5 - C20 | B26 suma la inversión en vez de restarla; sueldos desde otro archivo ([2] REPELTEX); anual (con IUE) ≠ suma de trimestres (sin IUE) | Flujo directo completo con préstamo y aporte; anual = suma de trimestres; control de caja | Flujo de caja |
| TRMA | Ñapefit | Tasa de descuento CAPM | F4 = Rf + β(Rm-Rf) + CRP | Tasa en USD aplicada a flujos convertidos con tipo fijo; promedio del S&P con año incompleto | Conversión a Bs con Fisher; riesgo país actualizado | TRMA |
| Rentabilidad | Ñapefit | VAN, TIR, PRI, valor residual, punto de equilibrio | VAN = NPV + C24; TIR = IRR | PRI con signo cambiado (1,89 en vez de 2,11 años) y texto escrito a mano; perpetuidad sin calcular; punto de equilibrio vacío | PRI por interpolación; B/C; dos métodos de valor residual; flujo del inversionista | Rentabilidad |
| Santa Cruz | Hypotolab | Igual que Ñapefit | Idem | Idem (tasa escrita a mano) | Idem | Santa Cruz / Zona urbana |
| Demanda | Hypotolab | Demanda de personas con hipotensión | D34 = D32 x D33 | Porcentajes sin fuente | Supuestos con tipo, fuente y validación | Demanda |
| Pronóstico | Hypotolab | 3 escenarios | F = C x D x E | Escenario esperado omite la aceptación (F18 = C18 x E18) | Misma fórmula en los 3 escenarios | Pronostico |
| Inventario | Hypotolab | Stock de seguridad (ASCM 10-20%) | C19 = valor x 1,1 | Valores pegados; el 10% solo en algunos trimestres | Política de stock aplicada a todos los trimestres con fórmula (se conserva la idea ASCM) | Inventario / Inv. terminado |
| Inventario envases | Hypotolab | Inventario de producto terminado | Final = inicial - ventas | Inventario final no se arrastra al siguiente trimestre | Inventario arrastrado y valuado | Inventario / Inv. terminado |
| Costos (MP) | Hypotolab | Receta y costo por envase + proveedores | D46 = SUM; E46 = D46/6,96 x 1,1 | La merma de 10% solo en la columna USD | Merma explícita por material | MP |
| Compras | Hypotolab | Necesidades de materiales | D28 = B21 x $M$4 | Agua y glicerina en ml rotuladas como kg; compras = necesidad (sin stock) | Stock de materiales y compras redondeadas | Compras |
| Infraestructura | Hypotolab | Elección de local | Suma ponderada | Sin errores de fórmula | Se conserva el método | Infraestructura |
| Capacidad Instalada | Hypotolab | Capacidad por máquina | K9 = G9 x $I$8 | Usa las horas de la 1ra máquina para todas; utilización contra una sola máquina | Cuello de botella y capacidad de mano de obra | Capacidad Inst. |
| Maquinaria | Hypotolab | Activos y depreciación | Igual a Ñapefit | Precios en USD a 6,96 | Tipo de cambio editable | Maqu. y equip. |
| Sueldos y salarios | Hypotolab | Planilla 6 cargos | Igual a Ñapefit | Aporte solidario 3% (Ñapefit 3,5%); bono sobre el sueldo | Tasa más prudente y bono sobre 3 SMN | MANO DE OBRA |
| Impuestos | Hypotolab | IVA, IT | C26 = $C$11 x 0,3 | Pesos trimestrales escritos a mano | Pesos vinculados a Supuestos | Carga impositiva |
| Precio | Hypotolab | Precio por costo (30%) y canal (20%) | H3 = F3/(1-0,3) | Mezcla de monedas | Método conservado como referencia en Bs | Precio |
| Otros gastos | Hypotolab | Gastos mensuales | E = D / 6,96 | Conversión fija | En Bs por área | Otros gastos |
| Estado de resultados | Hypotolab | ER | Idem | Publicidad escrita a mano; IUE trimestral | Idem Ñapefit | Estado de resultado |
| Inversión | Hypotolab | Inversión total | Suma | Capital de trabajo de un año; incluye impuestos | Período de desfase; se conserva la "validación" previa (aquí de laboratorio) | Inversión |
| Flujo de caja | Hypotolab | Flujo directo | Idem | No descuenta el IUE en el flujo anual; rangos corridos (D46 = SUM(D11:G11)); "IVA" de 7.200 que era la validación médica | IUE pagado; rangos por año correctos | Flujo de caja |
| TRMA | Hypotolab | CAPM | Igual | Riesgo país de 2025 (ya bajó) | Riesgo país actualizado y conversión a Bs | TRMA |
| Rentabilidad | Hypotolab | VAN, TIR, PRI, perpetuidad, punto de equilibrio | VR = H14/(H10-0) | Suma valor por perpetuidad y además capital de trabajo; "3 años 4 meses" escrito cuando la fórmula da 3,05 años; equilibrio con precio con impuestos | Valor residual con selector; PRI calculado; equilibrio corregido | Rentabilidad |
