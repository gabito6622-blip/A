# Informe de pruebas

Fecha: 12/11/2026. Archivo probado: `MODELO_EMPRESARIAL_MAESTRO.xlsx`. Tiene 39 hojas y 7.435 fórmulas (menos que las 9.468 de la versión anterior porque las tablas de Ñapefit son más compactas). Las 20 primeras son un clon de Ñapefit con los estados financieros en $us.

## Resultado

| Prueba | Resultado |
|---|---|
| Recalcular todo el libro con LibreOffice | **0 errores** en 7.435 fórmulas |
| Controles internos (hoja Controles) | **19 de 19 en OK** |
| Mismo resultado que la versión anterior en Bs | VAN $us 27.310,17 × 12,06 = **Bs 329.360,68**, igual al centavo |
| Verificación independiente en Python (recalcula cifras desde los supuestos, sin leer las fórmulas) | **16 de 16 coinciden** |
| Pruebas de coherencia y estrés (54 corridas del libro completo, repetidas sobre la versión final: 208 s) | **42 de 42 superadas** |
| Parecido con Ñapefit (títulos de Ñapefit que están en la misma celda del clon) | **1.402 de 1.557 (90%)** |
| Cambio del tipo de cambio en la celda B3 de Supuestos (9; 12; 12,06; 15) | Se recalcula todo sin errores y con 19 de 19 controles. Ninguna fórmula tiene el tipo de cambio escrito a mano |
| Balance general | Cuadra en los 21 cierres del caso base y en los 11 casos de estrés |
| Pruebas de la tienda (`npm test`, regla del repositorio) | 463 de 463 (12/11/2026, 28 s). No se tocó su código |

## 1. Qué cambió en esta versión y cómo se verificó

0. **Más humano (última pasada):** títulos cortos, sin instrucciones dentro de las celdas ni nombres internos; Supuestos con 4 columnas; se quitaron las hojas Leyenda y Matriz comparativa (la matriz pasó como anexo a `AUDITORIA_COMPARATIVA.md`). Solo cambiaron textos: los resultados son los mismos (VAN $us 27.310,17; 19 de 19 controles; 16 de 16 en la verificación aparte).

1. **Clon de Ñapefit:** cada tabla de las 20 hojas está en las mismas filas y columnas que en Ñapefit, con los mismos títulos y colores. Por ejemplo:
   - Rentabilidad: flujo en la fila 5, valor residual en las filas 8 a 17, flujo neto en la 24, índices en B32, PRI en B41 y punto de equilibrio en B63;
   - Flujo de caja: salidas de la 7 a la 18, inversión en la 23, financiamiento en la 28 y resumen anual desde la 37;
   - Carga impositiva: compras en B2, ventas en B9, "Diferencia IVA" en Q2 y trimestres desde la fila 17;
   - Compras: producción en la 18, cantidades en la 27, dólares en la 42 y programa de compras en la 55.

   Los cálculos de apoyo que Ñapefit no tenía (por ejemplo, el detalle del flujo económico o la valorización del inventario) van debajo de las tablas originales.
2. **Estados financieros en $us**, como Ñapefit. Lo que se cotiza en Bolivia se carga en Bs y se pasa a $us con el tipo de cambio de Supuestos. El VAN se muestra también en Bs.
3. **Resultados iguales a la versión anterior:** cada cifra en $us es la anterior en Bs dividida por 12,06. Se comprobó con el VAN (al centavo), las ventas, la utilidad neta y los escenarios.

### Comparación con Ñapefit, hoja por hoja

| Hoja | Títulos de Ñapefit | En la misma celda |
|---|---|---|
| Santa Cruz | 124 | 121 (98%) |
| Zona urbana | 177 | 177 (100%) |
| Demanda | 11 | 10 (91%) |
| Pronostico | 54 | 54 (100%) |
| Inventario | 14 | 14 (100%) |
| Inv. terminado | 68 | 67 (99%) |
| MP | 93 | 83 (89%) |
| Capacidad Inst. | 72 | 66 (92%) |
| Infraestructura | 51 | 45 (88%) |
| Compras | 163 | 126 (77%) |
| Maqu. y equip. | 65 | 45 (69%) |
| MANO DE OBRA | 188 | 166 (88%) |
| Otros gastos | 13 | 13 (100%) |
| Precio | 46 | 37 (80%) |
| Inversión | 35 | 32 (91%) |
| Estado de resultado | 110 | 92 (84%) |
| Carga impositiva | 92 | 92 (100%) |
| Flujo de caja | 109 | 92 (84%) |
| TRMA | 27 | 27 (100%) |
| Rentabilidad | 45 | 43 (96%) |

Lo que no coincide son filas propias del producto: otras máquinas, materiales y cargos (por ejemplo, 4 cargos en vez de 5 y 7 etapas de producción en vez de 6).

### Cambio del tipo de cambio

| Caso | VAN ($us) | VAN (Bs) | TIR | Controles |
|---|---|---|---|---|
| Base (PVP Bs 420, TC 12,06) | 27.310 | 329.361 | 40,26% | 19 de 19 |
| Mismo filtro 2.0 a Bs 390 | 4.593 | 55.396 | 24,15% | 19 de 19 |
| Tipo de cambio 12 | 27.556 | 330.673 | 40,36% | 19 de 19 |
| Tipo de cambio 15 | 17.670 | 265.048 | 35,68% | 19 de 19 |
| Tipo de cambio 9 | 44.032 | 396.285 | 45,66% | 19 de 19 |
| Canal directo 50% | 37.088 | 447.282 | 47,91% | 19 de 19 |
| Contenedor a Bs 45 | 36.612 | 441.546 | 47,27% | 19 de 19 |

## 2. Verificación independiente (modelo sombra)

| Cifra | Modelo | Python |
|---|---|---|
| Unidades 2027 (escenario base) | 3.598,31 | 3.598,31 |
| Ventas netas 2027 ($us) | 92.670,02 | 92.670,02 |
| Unidades 2031 | 7.248,77 | 7.248,77 |
| Costo laboral T1 2027 ($us) | 7.892,34 | 7.892,34 |
| Cuota trimestral del préstamo ($us) | 881,14 | 881,14 |
| Intereses T1 ($us) | 254,05 | 254,05 |
| Depreciación T1 ($us) | 540,16 | 540,16 |
| Materiales por kit con factura | 95,24 | 95,24 |
| Costo variable de producción neto | 88,60 | 88,60 |
| TRMA en Bs | 0,2102 | 0,2102 |
| VAN en Bs = VAN en $us x tipo de cambio | 329.360,68 | 329.360,68 |
| VAN recalculado desde los flujos | 27.310,17 | 27.310,17 |
| TIR por bisección | 0,4026 | 0,4026 |
| Punto de equilibrio 2027 (filtros) | 3.411,92 | 3.411,92 |
| IVA: débito - crédito = pagado - saldo final a favor | 58.075,56 | 58.075,56 |
| Balance: activo = pasivo + patrimonio al cierre de 2031 | 150.496,63 | 150.496,63 |

## 3. Pruebas de coherencia y estrés

Cada fila es una corrida real del libro completo.

| N° | Prueba | Resultado | Detalle |
|---|---|---|---|
| 1 | Precio -10%: unidades sin cambio | Superada | 3598.31 vs 3598.31 |
| 2 | Precio -10%: ventas facturadas -10% | Superada | ratio 0.900000 |
| 3 | Precio -10%: IVA débito -10% | Superada | ratio 0.900000 |
| 4 | Precio -10%: costo de ventas sin cambio | Superada | 26436.45 vs 26436.45 |
| 5 | Precio -10%: VAN baja | Superada | -5615 < 27310 |
| 6 | Demanda -20%: unidades -20% | Superada | ratio 0.800000 |
| 7 | Demanda -20%: producción baja (≈ -20%, redondeo) | Superada | ratio 0.7999 |
| 8 | Demanda -20%: compras bajan | Superada | 26077 < 32601 |
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

Las alertas funcionan:
- con demanda +80%, el control de capacidad pasa a REVISAR;
- con precio −30% o en el pesimista, se marcan caja bajo el mínimo, VAN negativo y TIR menor que la TRMA.

### Escenarios ($us)

| Escenario | VAN | TIR |
|---|---|---|
| Pesimista | -40.051 | -1,71% |
| Base | 27.310 | 40,26% |
| Optimista | 77.857 | 73,53% |

### Casos de estrés ($us)

| Caso | VAN | Controles en OK |
|---|---|---|
| Pesimista | -40.051 | 16 de 19 (alertas esperadas) |
| Optimista | 77.857 | 19 de 19 |
| Precio -10% y costo variable +10% | -18.345 | 16 de 19 (alertas esperadas) |
| Sin crecimiento de participación | 1.224 | 19 de 19 |
| Sin expansión metropolitana | 10.999 | 19 de 19 |
| Inflación 10% y tipo de cambio 15 | 20.050 | 19 de 19 |
| Capital de trabajo por desfase | 18.912 | 19 de 19 |
| Valor residual por perpetuidad | 120.583 | 19 de 19 |
| Sin préstamo | 27.900 | 19 de 19 |
| Demanda +80% | 170.772 | 18 de 19 (avisa que no alcanza la capacidad) |
| Precio -30% | -89.528 | 16 de 19 (alertas esperadas) |

## 4. Errores encontrados y corregidos durante el trabajo

| Hallazgo | Corrección |
|---|---|
| En Ñapefit, Inv. terminado no tenía fila de producción (el inventario final no cuadraba) | Se agregó la producción en la fila 7 sin mover las filas de Ñapefit |
| Con precio −30% la TIR no existe y aparecía `#N/A` | `IFERROR` con un texto claro |
| El capital de trabajo por desfase dejaba ~Bs 160.000 parados en caja | Se usa el déficit del arranque + un mes de costos fijos; el desfase queda como alternativa |
| En escenarios con pérdidas el déficit sumaba pérdidas al capital de trabajo | El déficit se mide solo en 2027 |
| Al mover las tablas a las filas de Ñapefit, los controles que leen el flujo de caja apuntaban a filas viejas | Se actualizaron antes de entregar; el control "operación + inversión + financiamiento = saldo" da 0 |

## 5. Limitaciones

- **No se abrió en Microsoft Excel**, solo en LibreOffice. Se usaron funciones comunes (SUM, IF, INDEX, MATCH, SUMIF, SUMPRODUCT, NPV, IRR, PMT, NORMSINV, CHOOSE, ROUNDUP, IFERROR). Al abrirlo en Excel, conviene mirar que Controles diga 19 de 19.
- **El VAN económico cambia un poco con el préstamo** ($us 27.310 con préstamo y $us 27.900 sin préstamo). Pasa porque el capital de trabajo se mide con la caja real, que incluye la cuota, y porque la prima se calcula después de intereses. Es una diferencia de 2,2%.
- El modelo es trimestral; por eso se reserva un mes de costos fijos como caja mínima.
- Impuestos simplificados de forma prudente: no se compensa IT con IUE ni se arrastran pérdidas.
- Los valores de Sensibilidad y de "DECISIONES Y ESCENARIOS" (sección B) son resultados guardados de las corridas. Se reproducen cambiando el dato indicado en Supuestos.
- La encuesta se probó con 400 respuestas de prueba que **no se guardaron**. El archivo entregado tiene la tabla vacía.
- El parecido con Ñapefit se midió por la posición de los títulos. No se comparó el ancho exacto de cada columna ni los bordes.
- Datos para verificar: tipo de cambio (fuente secundaria), tasas de depreciación (DS 24051), tasa bancaria (DS 2055), aporte solidario, si aplica el modelo de utilidad en SENAPI.

## 6. Cómo repetir las pruebas

```bash
cd proyectos/modelo-empresarial-filtro-ceramico/generador
```

```bash
python3 build.py <ruta a Ñapefit.xlsx> MODELO.xlsx
```

Recalcular con LibreOffice y luego:

```bash
python3 shadow.py MODELO_calc.xlsx MODELO.xlsx.rows.json
```

```bash
RECALC=<ruta a recalc.py> python3 harness.py MODELO.xlsx MODELO.xlsx.rows.json corridas
```

```bash
python3 parecido.py <ruta a Ñapefit.xlsx> MODELO.xlsx
```
