# Informe de pruebas

Fecha: 12/11/2026. Archivo probado: `MODELO_EMPRESARIAL_MAESTRO.xlsx`. Tiene 41 hojas y 9.468 fórmulas: las 20 primeras con el formato de Ñapefit y el Filtro 2.0 incluido.

## Resultado

| Prueba | Resultado |
|---|---|
| Recalcular todo el libro con LibreOffice | **0 errores** en 9.468 fórmulas |
| Controles internos (hoja Controles) | **19 de 19 en OK** |
| Verificación independiente en Python (recalcula cifras desde los supuestos, sin leer las fórmulas) | **14 de 14 coinciden** |
| Pruebas de coherencia y estrés (54 corridas del libro completo, 155 s) | **42 de 42 superadas** |
| Cambio del tipo de cambio (9; 12; 12,06; 15) | Se recalcula todo sin errores y con 19 de 19 controles |
| Balance general | Cuadra en los 21 cierres del caso base y en los 11 casos de estrés |
| Pruebas de la tienda (`npm test`, regla del repositorio) | 463 de 463 (11/11/2026). No se tocó su código |

## 1. Qué cambió en esta versión y cómo se verificó

1. **Formato de Ñapefit:** mismas 20 hojas, nombres, orden y estilo; hojas nuevas al final. Al clonar se comprobó que los resultados eran idénticos a la versión anterior, centavo por centavo.
2. **Filtro 2.0:**
   - materiales nuevos: carbón de cáscara de castaña, indicador y QR;
   - equipo nuevo: mesa dosificadora;
   - diferidos nuevos: validación de la capa de carbón y solicitud en SENAPI;
   - gasto nuevo: avisos por WhatsApp;
   - precio Bs 420.

   El modelo sombra en Python se actualizó con estos datos y coincide.
3. **Dólares:** máquinas importadas, laboratorio, computadoras, plata coloidal y grifo se cargan en $us. Un solo tipo de cambio los pasa a Bs.

| Tipo de cambio | Activos fijos (Bs) | Costo de materiales por kit (Bs) | VAN (Bs) |
|---|---|---|---|
| 9 | 178.470 | 91,51 | 396.285 |
| 12 | 212.460 | 95,17 | 330.673 |
| 12,06 (base) | 213.140 | 95,24 | 329.361 |
| 15 | 246.450 | 98,83 | 265.048 |

4. **Más simple de leer:**
   - las fórmulas usan referencias normales (`='Supuestos'!$B$45`) en lugar de nombres;
   - se quitaron los textos largos de explicación;
   - el libro no tiene ningún nombre definido.

## 1b. Investigación de precios (12/11/2026)

Se agregaron a la hoja Competencia precios reales de fuentes públicas (botellón, filtros y purificadores) y el precio del botellón pasó de Bs 12 (supuesto) a Bs 18 (dato). Esto solo cambia la comparación para el cliente: el VAN y la TIR no cambian. Se recalculó: 0 errores, 19 de 19 controles, 14 de 14 en la verificación independiente.

## 2. Verificación independiente (modelo sombra)

| Cifra | Modelo | Python |
|---|---|---|
| Unidades 2027 (escenario base) | 3.598,31 | 3.598,31 |
| Ventas netas 2027 | 1.117.600,43 | 1.117.600,43 |
| Unidades 2031 | 7.248,77 | 7.248,77 |
| Costo laboral T1 2027 | 95.181,57 | 95.181,57 |
| Cuota trimestral del préstamo | 10.626,50 | 10.626,50 |
| Intereses T1 | 3.063,88 | 3.063,88 |
| Depreciación T1 | 6.514,39 | 6.514,39 |
| Materiales por kit con factura | 95,24 | 95,24 |
| Costo variable de producción neto | 88,60 | 88,60 |
| TRMA en Bs | 21,02% | 21,02% |
| VAN recalculado desde los flujos | 329.360,68 | 329.360,68 |
| TIR por bisección | 40,26% | 40,26% |
| Punto de equilibrio 2027 (kits) | 3.411,92 | 3.411,92 |
| IVA: débito - crédito = pagado - saldo final a favor | 700.391,20 | 700.391,20 |

## 3. Pruebas de coherencia y estrés

Cada fila es una corrida real del libro completo.

| N° | Prueba | Resultado | Detalle |
|---|---|---|---|
| 1 | Precio -10%: unidades sin cambio | Superada | 3598.31 vs 3598.31 |
| 2 | Precio -10%: ventas facturadas -10% | Superada | ratio 0.900000 |
| 3 | Precio -10%: IVA débito -10% | Superada | ratio 0.900000 |
| 4 | Precio -10%: costo de ventas sin cambio | Superada | 318823.54 vs 318823.54 |
| 5 | Precio -10%: VAN baja | Superada | -67722 < 329361 |
| 6 | Demanda -20%: unidades -20% | Superada | ratio 0.800000 |
| 7 | Demanda -20%: producción baja (≈ -20%, redondeo) | Superada | ratio 0.7999 |
| 8 | Demanda -20%: compras bajan | Superada | 314493 < 393164 |
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

## 4. Errores encontrados y corregidos durante el trabajo

| Hallazgo | Corrección |
|---|---|
| Con precio −30% la TIR no existe y aparecía `#N/A` | `IFERROR` con un texto claro |
| El capital de trabajo por desfase dejaba ~Bs 160.000 parados en caja | Se usa el déficit del arranque + un mes de costos fijos; el desfase queda como alternativa |
| En escenarios con pérdidas el déficit sumaba pérdidas al capital de trabajo | El déficit se mide solo en 2027 |
| En el script de pruebas, un caso escribía una fórmula con un nombre que ya no existe (3.556 celdas `#NAME?` en esa copia de prueba) | Se corrigió el script; el Excel entregado no tenía el error |
| Tablero con columnas angostas y textos cortados | Anchos y alineación corregidos; revisión visual en PDF |

## 5. Limitaciones

- **No se abrió en Microsoft Excel**, solo en LibreOffice. Se usaron funciones comunes (SUM, IF, INDEX, MATCH, SUMIF, SUMPRODUCT, NPV, IRR, PMT, NORMSINV, CHOOSE, ROUNDUP, IFERROR, RANK). Al abrirlo en Excel, conviene mirar que Controles diga 19 de 19.
- **El VAN económico cambia un poco con el préstamo** (Bs 329.361 con préstamo y Bs 336.470 sin préstamo). Pasa porque el capital de trabajo se mide con la caja real, que incluye la cuota, y porque la prima se calcula después de intereses. Es una diferencia de 2,2%.
- El modelo es trimestral; por eso se reserva un mes de costos fijos como caja mínima.
- Impuestos simplificados de forma prudente: no se compensa IT con IUE ni se arrastran pérdidas.
- Los valores de Sensibilidad y de "DECISIONES Y ESCENARIOS" (sección B) son resultados guardados de las corridas. Se reproducen cambiando el dato indicado en Supuestos.
- La encuesta se probó con 400 respuestas de prueba que **no se guardaron**. El archivo entregado tiene la tabla vacía.
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
python3 shadow.py MODELO.xlsx MODELO.xlsx.rows.json
```

```bash
RECALC=<ruta a recalc.py> python3 harness.py MODELO.xlsx MODELO.xlsx.rows.json corridas
```
