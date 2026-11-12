# Guía para la defensa

Explica cada hoja de `MODELO_EMPRESARIAL_MAESTRO.xlsx`: qué calcula, de dónde salen los datos y cómo responder lo que pregunte el licenciado. Las cifras son del **escenario base, versión del 12/11/2026 (Filtro 2.0)**.

## 0. La idea en una frase

Se tomó la metodología de Ñapefit e Hypotolab (población → demanda → pronóstico → producción → costos → estados financieros → evaluación), se corrigieron sus errores y se aplicó a un producto físico no alimenticio: el **Filtro de agua 2.0**. Es un filtro de barro cocido con plata coloidal y una capa de carbón activado de cáscara de castaña, fabricado en Santa Cruz.

## 1. Cómo está organizado el Excel

Las **20 primeras hojas copian el formato de Ñapefit**: mismos nombres, orden y estilo. Después vienen las hojas nuevas.

| Bloque | Hojas | Para qué sirve |
|---|---|---|
| Mercado (como Ñapefit) | Santa Cruz, Zona urbana, Demanda, Pronostico | Población, demanda y ventas por escenario |
| Producción (como Ñapefit) | Inventario, Inv. terminado, MP, Capacidad Inst., Infraestructura, Compras, Maqu. y equip., MANO DE OBRA, Otros gastos | Cuánto producir, con qué y con quién |
| Finanzas (como Ñapefit) | Precio, Inversión, Estado de resultado, Carga impositiva, Flujo de caja, TRMA, Rentabilidad | Precio, estados y evaluación (VAN, TIR, PRI, punto de equilibrio) |
| Nuevas: entradas | Supuestos, Calendario | Todo lo que se puede cambiar está en Supuestos |
| Nuevas: finanzas | Financiamiento, Balance general, Ratios, Sensibilidad | Préstamo, balance que cuadra, indicadores, escenarios |
| Nuevas: Juego de Negocios | SIMULADOR EMPRESARIAL, DECISIONES Y ESCENARIOS, CONTROL DE PERIODOS | Preparar decisiones y comparar plan con real |
| Nuevas: resumen | Dashboard, Controles | Tablero y alertas |
| Nuevas: investigación | Producto, Selección de producto, Muestra y encuesta, Competencia, Estrategia comercial, Proceso productivo | Justificar el producto y la estrategia |
| Nuevas: referencias | Matriz comparativa, Fuentes, Índice, Leyenda | Auditoría, fuentes y navegación |

**Colores:** azul con fondo amarillo = dato que se puede cambiar; negro = fórmula; amarillo fuerte = resultado clave. Las fórmulas son referencias normales a celdas, por ejemplo `='Supuestos'!$B$45`.

## 2. Dólares y tipo de cambio

- **Lo que se compra en dólares está en dólares**, como en Ñapefit: prensa, molino, amasadora, tamizadora, equipo de laboratorio, computadoras, impresora, plata coloidal y grifo.
- Hay **una sola celda de tipo de cambio** (Supuestos, primera sección). Si se cambia, por ejemplo a 12, se recalcula todo: el costo de las máquinas en Bs, la depreciación, la inversión, el préstamo, el costo por kit, los estados financieros, el VAN y las columnas en $us.
- Los estados financieros están en Bs. Varias hojas muestran también la columna en $us: MP, Maqu. y equip., MANO DE OBRA, Otros gastos, Inversión, Pronostico, Demanda y Rentabilidad.
- **Prueba hecha:**

| Tipo de cambio | Activos fijos | VAN |
|---|---|---|
| 9 | Bs 178.470 | Bs 396.285 |
| 12 | Bs 212.460 | Bs 330.673 |
| 12,06 (base) | Bs 213.140 | Bs 329.361 |
| 15 | Bs 246.450 | Bs 265.048 |

- *¿Por qué 12,06?* El BCB dejó el tipo fijo de 6,96 el 29/06/2026. 12,06 es el dato del 04/11/2026 (fuente secundaria); hay que verificarlo en la página del BCB el día de la defensa.

## 3. Hoja por hoja (las clonadas de Ñapefit)

### Santa Cruz y Zona urbana
Son las mismas tablas del INE (Censo 2024) que tenía Ñapefit, con su formato. Debajo están los cálculos:
- tasa de crecimiento urbana del departamento: 1,587% anual;
- población urbana departamental 2024: 2.586.612;
- proyección hasta 2031: `población del año anterior × (1 + tasa)`.

La tasa se toma de la celda del INE, no escrita a mano como en Ñapefit.

### Demanda
Cada porcentaje está en Supuestos:
1. hogares = población urbana / 3,5;
2. × cobertura (municipio en 2027-28 = 61,9%; área metropolitana 70-80% desde 2029);
3. × 50% de hogares objetivo;
4. × 0,5 kits por hogar y año = **demanda potencial: 119.944 kits en 2027**;
5. × 60% de aceptación = **demanda efectiva: 71.966 kits**.

- *¿Por qué 0,5?* El filtro dura entre 1 y 2 años: se supone que cada hogar compra uno cada 2 años.
- *¿Y el 60%?* Es un supuesto. Cuando se carguen 384 encuestas reales en "Muestra y encuesta", la aceptación medida lo reemplaza sola.

### Pronostico
Igual que Ñapefit: recuadro de escenarios, una tabla por escenario con los años hacia abajo y las tablas trimestrales "AÑOS / TRIMESTRES".
- Ventas = demanda × aceptación × participación (3,5% / 5% / 6,5%; crece 10% por año).
- Escenario base: **3.598 kits en 2027 → 7.249 en 2031**.
- Por trimestre: 28/22/22/28% (más en verano).

### Inventario e Inv. terminado
- Producción = ventas + stock de seguridad (15% del trimestre siguiente) − inventario inicial.
- El inventario final de un trimestre es el inicial del siguiente.
- Inv. terminado lo valora a costo promedio y calcula el costo de ventas.

### MP
Materiales por kit con su moneda:

| Material | Por kit |
|---|---|
| Arcilla | 5 kg |
| Aserrín | 0,6 kg |
| Plata coloidal | 2 ml ($us) |
| Carbón activado de cáscara de castaña | 0,15 kg |
| Balde de 20 L | 1 |
| Grifo | 1 ($us) |
| Indicador de cambio | 1 |
| Empaque con QR | 1 |

- Costo por kit con factura: **Bs 95,24** ($us 7,90).
- Con gas y sin IVA: **Bs 88,60**.
- El balde (Bs 55) es lo más caro.

### Capacidad Inst.
- La capacidad es la de la etapa más lenta (secado y horno): 50 filtros por día = 12.000 al año.
- Utilización: 31% en 2027 → 61% en 2031.

### Infraestructura
Matriz de puntos para elegir el local (como Ñapefit, con la fórmula corregida) y cronograma de puesta en marcha.

### Compras
- Compras = necesidad + stock final (1 mes) − stock inicial.
- Detalle en kilos, mililitros y unidades, y en Bs.

### Maqu. y equip.
- Activos por **Bs 213.140** ($us 17.673): parte en Bs (horno local, estanterías, muebles) y parte en $us (máquinas importadas, laboratorio, computadoras).
- Depreciación sobre el precio sin IVA: maquinaria 12,5%, computación y herramientas 25%, muebles 10%.
- En 2031 se reponen computadoras y herramientas.

### MANO DE OBRA
- Gerente, jefe de producción, ejecutivo comercial y operarios. Los operarios dependen de la producción: 2 en 2027-28, 3 desde 2029.
- Hay una **planilla mensual por año**, como en Ñapefit: sueldo, bono, total ganado, Gestora, líquido pagable, aportes patronales, aguinaldo, indemnización, total mensual y anual (Bs y $us).
- Debajo, la planilla trimestral que va a los estados. Una fila de control comprueba que las dos coincidan (diferencia 0).

### Otros gastos
- Gastos mensuales por área, en Bs y $us.
- 2.0 agrega Bs 300/mes para el registro de clientes y los avisos de cambio por WhatsApp.

### Precio
**De dónde sale el precio:** investigación de escritorio con precios reales (hoja Competencia). En Bolivia, los filtros simples cuestan Bs 399 a 477 y los purificadores Bs 650 o más. Bs 420 queda entre ambos y se recupera en menos de 4 meses de botellones. La encuesta (pregunta 6) debe confirmarlo.

1. **Precio elegido:** Bs 420 con factura. La empresa recibe en promedio **Bs 357** (40% venta directa al precio completo; 60% por tiendas que se quedan 25%). Sin IVA, Bs 310,59.
2. **Método de costo (el de Ñapefit):**
   - costo unitario total 2027: Bs 289,30;
   - ÷ (1 − 30%) y × (1 + 19,05% de IVA e IT) = **Bs 492**.

   Es mayor que el precio de mercado porque en 2027 se vende poco. Por eso el primer año deja poca ganancia.
3. **Para el cliente:**
   - con 4 litros por día y la recarga a Bs 18 (precio real en Santa Cruz), gasta Bs 1.314 al año en botellones;
   - el filtro le cuesta Bs 210 al año (Bs 420 cada 2 años, unos **Bs 18 por mes**);
   - ahorra **Bs 1.104 al año** y recupera la compra en menos de 4 meses;
   - el filtro conviene desde **0,64 litros por día**.

### Inversión
| Concepto | Bs | $us |
|---|---|---|
| Activos fijos | 213.140 | 17.673 |
| Diferidos y puesta en marcha (incluye validación de la capa de carbón y solicitud en SENAPI) | 160.872 | 13.339 |
| Capital de trabajo | 101.690 | 8.432 |
| **Total** | **475.701** | **39.445** |

- Préstamo: Bs 106.570 (50% de los activos). Aporte de socios: Bs 369.131.
- **Capital de trabajo:** se usa el déficit de caja del arranque (Bs 46.690) más un mes de costos fijos (Bs 55.000). El otro método (desfase, 80 días) daría Bs 223.965 y dejaría dinero parado en caja.

### Estado de resultado
| Bs | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---|---|---|---|---|
| Ventas netas | 1.117.600 | 1.323.806 | 1.772.587 | 2.249.617 | 2.842.335 |
| Utilidad operativa | 38.083 | 110.846 | 211.771 | 456.311 | 805.771 |
| Utilidad neta | 20.368 | 77.784 | 156.662 | 342.233 | 604.329 |

### Carga impositiva
- IVA 13%: débito − crédito, y el saldo a favor pasa al trimestre siguiente.
- IT 3%.
- IUE 25% anual, pagado en abril del año siguiente.
- Prima anual solo si hay ganancia.

### Flujo de caja
- Cobros y pagos reales, préstamo y aporte.
- La caja más baja es **Bs 55.000** (inicio de 2027) y nunca baja de ese colchón.

### TRMA
1. Costo de capital en dólares = 4,45% + 0,9 × (13,81% − 4,45%) + riesgo país 4,15% = **17,02%**.
2. Como los flujos están en Bs con inflación, se pasa a Bs: (1,1702 × 1,06 / 1,025) − 1 = **21,02%**.

### Rentabilidad
| Indicador | Valor |
|---|---|
| VAN (TRMA 21,02%) | **Bs 329.361** ($us 27.310) |
| TIR | **40,26%** |
| Beneficio/costo | 1,69 |
| Recupera la inversión | 3 años, 1 mes y 12 días |
| Recuperación descontada | 4,03 años |
| VAN y TIR del inversionista (con préstamo) | Bs 351.685 y 44,5% |
| Punto de equilibrio 2027 | 3.412 kits (margen de seguridad 5,2%) |
| Punto de equilibrio 2031 | 4.135 kits (margen de seguridad 43%) |

## 4. Hojas nuevas (resumen)

- **Supuestos:** todos los datos que se pueden cambiar, con su fuente y cómo validarlos. Incluye el tipo de cambio y los multiplicadores para pruebas de estrés (1 = normal).
- **Balance general:** cuadra en los 21 cierres.
- **Financiamiento:** préstamo a 3 años, 11,5% anual, cuota trimestral de Bs 10.627.
- **Sensibilidad:** cómo cambia el VAN si cambian el precio, las ventas, los costos o la tasa.
- **SIMULADOR EMPRESARIAL, DECISIONES Y ESCENARIOS, CONTROL DE PERIODOS:** para el Juego de Negocios. No copian el simulador del docente; se ajustan cuando tengamos su manual.
- **Controles:** 19 de 19 en OK.

## 5. Preguntas probables

1. **¿Qué tiene de nuevo?** La capa de carbón de cáscara de castaña (residuo boliviano), el indicador de cambio, el QR con el análisis del lote y el aviso de cambio por WhatsApp.
2. **¿Por qué es difícil de copiar?**
   - receta propia de barro y carbón validada en laboratorio;
   - contrato por la cáscara de castaña;
   - control de calidad por lote;
   - marca;
   - clientes registrados que vuelven a comprar.

   La técnica básica es libre; lo difícil de copiar es lo que se construye alrededor.
3. **¿Es rentable?** Sí en el escenario base (VAN Bs 329.361; TIR 40,3% > 21,0%). Pero depende del precio: el filtro 2.0 vendido a Bs 390 tendría VAN de solo Bs 55.396. El escenario pesimista da VAN negativo.
4. **¿Qué pasa si sube el dólar?** Se cambia la celda del tipo de cambio y todo se recalcula: con 15 Bs/$us el VAN baja a Bs 265.048, pero sigue positivo.
5. **¿De dónde sale el precio?** De una investigación de escritorio con precios reales:
   - botellón Villa Santa Bs 18 (2026);
   - estudio de la AEMP: Bs 11,70 a 13,00 en Santa Cruz (2011-2017);
   - filtros de Bs 399 a 477 y purificadores desde Bs 650.

   La encuesta de 384 hogares (`ENCUESTA_PARA_IMPRIMIR.md`) tiene que confirmarlo. No se inventaron respuestas.
6. **¿Funciona el filtro?** Las fuentes describen filtros de barro en general. El nuestro debe validarse en laboratorio antes de vender (está presupuestado). Hasta entonces no se promete ningún porcentaje.
