# Informe de pruebas

Fecha: 11/11/2026. Archivo probado: `MODELO_EMPRESARIAL_MAESTRO.xlsx` (41 hojas, 9.152 fórmulas; las 20 primeras con el formato clonado de Ñapefit).

## Resultado

| Prueba | Resultado |
|---|---|
| Recalcular todo el libro con LibreOffice | **0 errores** en 9.152 fórmulas |
| Controles internos (hoja `Controles`) | **19 de 19 en OK** |
| Verificación independiente en Python (cifras recalculadas desde los supuestos, sin leer fórmulas) | **14 de 14 coinciden** |
| Pruebas de coherencia y estrés (52 corridas, 173 s) | **42 de 42 superadas** |
| Balance general | Cuadra en los 21 cierres del caso base y en los 11 casos de estrés |
| Pruebas de la tienda (`npm test`, por regla del repositorio) | 463 de 463 superadas (33,7 s); no se tocó su código |

## 0. Clonado del formato de Ñapefit (12/11/2026)

Se rehizo el libro con las mismas 20 hojas, nombres, orden y estilo de Ñapefit, y las hojas nuevas al final. Se comprobó que el clon da **exactamente los mismos resultados** que la versión anterior: VAN Bs 191.167,64; TIR 32,63%; misma caja trimestre por trimestre; balance en 0 en los 21 cierres; 19 de 19 controles. La planilla anual por año (formato Ñapefit) coincide con la trimestral (diferencia 0 en los 5 años). Las 52 corridas se repitieron sobre el clon.

## 1. Cómo se probó

1. **Construcción reproducible.** El Excel se genera con los scripts de `generador/` (Python + openpyxl). Todas las celdas de cálculo son fórmulas; los únicos valores escritos son supuestos (azules), datos del INE copiados de los originales y los resultados guardados de las corridas (sección B de `DECISIONES Y ESCENARIOS` y sección A en adelante de `Sensibilidad`, rotulados como tales).
2. **Recálculo.** LibreOffice recalcula el libro completo y se buscan errores (`#DIV/0!`, `#REF!`, `#N/A`, `#NAME?`, `#VALUE!`).
3. **Controles internos** (fórmulas dentro del libro): balance, inventarios, capacidad, caja, coherencia de flujos, préstamo pagado, VAN = suma de flujos descontados, utilidades acumuladas = resultados del balance, estacionalidad, compras por material y costo laboral por áreas.
4. **Modelo sombra** (`generador/shadow.py`): recalcula en Python, desde los supuestos y sin usar las fórmulas, las unidades 2027 y 2031, las ventas netas, la planilla, la cuota e intereses del préstamo, la depreciación, el costo por kit, la TRMA, el VAN, la TIR (por bisección), el punto de equilibrio y el cuadre del IVA.
5. **Corridas automáticas** (`generador/harness.py`): cambia un supuesto en una copia, recalcula todo el libro, lee los resultados y comprueba que las consecuencias sean coherentes en todos los estados.

## 2. Verificación independiente (modelo sombra)

| Cifra | Modelo | Python |
|---|---|---|
| Unidades 2027 | 3.598,31 | 3.598,31 |
| Ventas netas 2027 (Bs) | 1.037.771,83 | 1.037.771,83 |
| Unidades 2031 | 7.248,77 | 7.248,77 |
| Costo laboral 1er trimestre (Bs) | 95.181,57 | 95.181,57 |
| Cuota del préstamo (Bs) | 10.455,40 | 10.455,40 |
| Intereses del 1er trimestre (Bs) | 3.014,55 | 3.014,55 |
| Depreciación del 1er trimestre (Bs) | 6.419,19 | 6.419,19 |
| Materiales por kit con factura (Bs) | 86,17 | 86,17 |
| Costo variable de producción neto (Bs) | 80,71 | 80,71 |
| TRMA | 21,02% | 21,02% |
| VAN (Bs) | 191.167,64 | 191.167,64 |
| TIR | 32,63% | 32,63% |
| Punto de equilibrio 2027 (kits) | 3.570,22 | 3.570,22 |
| IVA: débito − crédito = pagado − saldo final | 641.525,01 | 641.525,01 |

## 3. Pruebas de coherencia y estrés

Cada fila es una corrida real del libro completo.

| N° | Prueba | Resultado | Detalle |
|---|---|---|---|
| 1 | Precio -10%: unidades sin cambio | Superada | 3598.31 vs 3598.31 |
| 2 | Precio -10%: ventas facturadas -10% | Superada | ratio 0.900000 |
| 3 | Precio -10%: IVA débito -10% | Superada | ratio 0.900000 |
| 4 | Precio -10%: costo de ventas sin cambio | Superada | 290419.58 vs 290419.58 |
| 5 | Precio -10%: VAN baja | Superada | -214408 < 191168 |
| 6 | Demanda -20%: unidades -20% | Superada | ratio 0.800000 |
| 7 | Demanda -20%: producción baja (≈ -20%, redondeo) | Superada | ratio 0.7999 |
| 8 | Demanda -20%: compras bajan | Superada | 284533 < 355710 |
| 9 | Demanda -20%: costo de ventas ≈ -20% | Superada | ratio 0.8000 |
| 10 | Costo variable +10%: costo de ventas +10% | Superada | ratio 1.100000 |
| 11 | Costo variable +10%: ventas sin cambio | Superada |  |
| 12 | Sueldos +10%: planilla +10% | Superada | ratio 1.100000 |
| 13 | Monotonía: VAN crece con el precio | Superada |  |
| 14 | Monotonía: VAN crece con las unidades | Superada |  |
| 15 | Monotonía: VAN baja con el costo variable | Superada |  |
| 16 | Monotonía: VAN baja con la TRMA | Superada |  |
| 17 | Escenarios ordenados: pesimista < base < optimista | Superada |  |
| 18 | Balance cuadra en estrés: Pesimista | Superada |  |
| 19 | Sin errores de fórmula en estrés: Pesimista | Superada |  |
| 20 | Balance cuadra en estrés: Optimista | Superada |  |
| 21 | Sin errores de fórmula en estrés: Optimista | Superada |  |
| 22 | Balance cuadra en estrés: Precio -10% y costo variable +10% | Superada |  |
| 23 | Sin errores de fórmula en estrés: Precio -10% y costo variable +10% | Superada |  |
| 24 | Balance cuadra en estrés: Sin crecimiento de participación (CRECE_PART = 0) | Superada |  |
| 25 | Sin errores de fórmula en estrés: Sin crecimiento de participación (CRECE_PART = 0) | Superada |  |
| 26 | Balance cuadra en estrés: Sin expansión metropolitana (cobertura fija) | Superada |  |
| 27 | Sin errores de fórmula en estrés: Sin expansión metropolitana (cobertura fija) | Superada |  |
| 28 | Balance cuadra en estrés: Inflación 10% y tipo de cambio 15 Bs/USD | Superada |  |
| 29 | Sin errores de fórmula en estrés: Inflación 10% y tipo de cambio 15 Bs/USD | Superada |  |
| 30 | Balance cuadra en estrés: Capital de trabajo por período de desfase (METODO_CT = 1) | Superada |  |
| 31 | Sin errores de fórmula en estrés: Capital de trabajo por período de desfase (METODO_CT = 1) | Superada |  |
| 32 | Balance cuadra en estrés: Valor residual por perpetuidad (METODO_VR = 2) | Superada |  |
| 33 | Sin errores de fórmula en estrés: Valor residual por perpetuidad (METODO_VR = 2) | Superada |  |
| 34 | Balance cuadra en estrés: Sin préstamo (PCT_PRESTAMO = 0) | Superada |  |
| 35 | Sin errores de fórmula en estrés: Sin préstamo (PCT_PRESTAMO = 0) | Superada |  |
| 36 | Balance cuadra en estrés: Demanda +80% (prueba de capacidad) | Superada |  |
| 37 | Sin errores de fórmula en estrés: Demanda +80% (prueba de capacidad) | Superada |  |
| 38 | Balance cuadra en estrés: Precio -30% (prueba de alerta) | Superada |  |
| 39 | Sin errores de fórmula en estrés: Precio -30% (prueba de alerta) | Superada |  |
| 40 | Demanda +80%: el control de capacidad lo detecta | Superada | ['La producción cabe en la capacidad en todos los trimestres'] |
| 41 | Precio -30%: el modelo marca VAN negativo y alertas | Superada | ['Caja ≥ caja mínima en todos los cierres', 'VAN económico positivo', 'TIR mayor |
| 42 | Encuesta (datos de prueba, no guardados): con 400 respuestas la aceptación pasa a la medida (55%) | Superada | aceptación 0.55 |
Casos de estrés: escenario pesimista, escenario optimista, precio −10% con costo variable +10%, sin crecimiento de la participación, sin expansión metropolitana, inflación 10% con tipo de cambio 15, capital de trabajo por desfase, valor residual por perpetuidad, sin préstamo, demanda +80% y precio −30%. Los valores están en `Sensibilidad` (sección D) y en `INFORME_DE_VIABILIDAD.md`.

**Las alertas funcionan:**
- con demanda +80%, el control de capacidad pasa a REVISAR;
- con precio −30%, el pesimista o precio −10% con costo +10%, se marcan caja bajo el mínimo, VAN negativo y TIR menor que la TRMA (o inexistente).

## 4. Errores encontrados durante la construcción y cómo se corrigieron

| Hallazgo | Corrección |
|---|---|
| Con precio −30% la TIR no existe y aparecía `#N/A` en 14 celdas (portada, tablero, evaluación) | `IFERROR` en la TIR con un texto explicativo; la decisión y los controles tratan ese caso |
| El primer cálculo del capital de trabajo (desfase, Bs 216.345) dejaba la caja siempre por encima de Bs 163.000 | Se agregó el método del déficit acumulado del arranque + un mes de costos fijos (Bs 108.308); el desfase queda como alternativa (VAN Bs 101.975) |
| En la primera versión del déficit acumulado, en escenarios con pérdidas se sumaban pérdidas al capital de trabajo (doble conteo; VAN pesimista −797.738) | El déficit se mide solo en el arranque (2027); las pérdidas posteriores aparecen como caja negativa y alerta |
| Tablero con columnas angostas (`###`) y textos cortados en la portada y en la selección | Anchos y alineación corregidos; revisión visual en PDF |

## 5. Lo que no se pudo probar y limitaciones

- **No se abrió en Microsoft Excel**, solo en LibreOffice. Se usaron únicamente funciones compatibles con Excel 2007 o posteriores (SUM, IF, INDEX, MATCH, SUMIF, SUMPRODUCT, NPV, IRR, PMT, NORMSINV, CHOOSE, ROUNDUP, IFERROR, RANK), sin funciones nuevas ni matriciales. Al abrirlo en Excel conviene confirmar que la hoja `Controles` siga mostrando 19 de 19.
- **El VAN económico varía levemente con el préstamo** (Bs 191.168 con préstamo y Bs 198.490 sin préstamo). Hay dos causas: el capital de trabajo del método 2 se mide con la caja real, que incluye la cuota; y la prima anual se calcula sobre la utilidad después de intereses, como manda la ley. Es una diferencia de 3,8%, documentada.
- **Granularidad trimestral:** no ve los desfases dentro del trimestre; por eso se reserva un mes de costos fijos como caja mínima.
- **Simplificaciones tributarias prudentes:** no se compensa IT con IUE ni se arrastran pérdidas; IVA e IT se pagan en el mismo trimestre.
- **Sensibilidad registrada:** los valores de `Sensibilidad` y de la sección B de `DECISIONES Y ESCENARIOS` son resultados guardados de las corridas. No se recalculan solos: para reproducir un caso se cambia el supuesto indicado y se lee la sección A.
- **Encuesta:** el cambio automático de aceptación supuesta a medida se probó con 400 respuestas **de prueba que no se guardaron** en el modelo. El archivo entregado tiene la tabulación vacía.
- **Simulador del docente:** sin su manual, `SIMULADOR EMPRESARIAL` usa elasticidades supuestas y no se pudo contrastar con el juego real.
- **Datos externos:** tipo de cambio, inflación y riesgo país se consultaron el 11/11/2026 en fuentes públicas (ver `Fuentes`). Las tasas de depreciación (DS 24051), la tasa bancaria (DS 2055) y el aporte solidario provienen del conocimiento general o de los originales y están marcadas para verificar.

## 6. Cómo repetir las pruebas

```bash
cd proyectos/modelo-empresarial-filtro-ceramico/generador
```

```bash
python3 build.py <ruta a Ñapefit.xlsx> MODELO.xlsx
```

Luego se recalcula con LibreOffice (por ejemplo, con un script `recalc.py`) y se ejecutan:

```bash
python3 shadow.py MODELO.xlsx MODELO.xlsx.rows.json
```

```bash
RECALC=<ruta a recalc.py> python3 harness.py MODELO.xlsx MODELO.xlsx.rows.json corridas
```

`build.py` necesita el archivo Ñapefit original solo para copiar las tablas del INE.
