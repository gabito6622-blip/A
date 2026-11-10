# Fase 3 — Procedimiento para analizar los resultados reales

Este procedimiento sirve cada vez que quieras sacar conclusiones. Se puede repetir con 20, 50 o 200 respuestas; lo que cambia es **cuánto se puede confiar** en lo que dicen.

## 0. ¿Hay respuestas suficientes?

| Respuestas válidas | Qué se puede hacer |
|---|---|
| Menos de 15 | Solo explorar ideas y leer las respuestas abiertas. No decidir precios. |
| 15 a 29 | Ver tendencias. Elegir funciones para una primera versión de prueba. |
| 30 a 99 | Decidir funciones prioritarias y un precio **de prueba** para pilotos. |
| 100 o más | Decidir precios públicos, **si además** hay pagos verificados de pilotos. |

Además:

- Para hablar de un **segmento** (por ejemplo, "51–100 clientes") hacen falta **al menos 5 respuestas de ese segmento**. El informe avisa cuando no las hay.
- Para fijar un precio público hacen falta **al menos 5 pilotos que hayan pagado**. Lo que la gente dice que pagaría casi siempre es más de lo que paga.
- La muestra **no es aleatoria**: responde quien recibió el enlace y quiso contestar. Los porcentajes describen a quienes respondieron, no a todo el mercado.

## 1. Preparar los datos (en Google)

1. En Apps Script ejecutá `actualizarAnalisis`.
2. Revisá la pestaña **Pilotos (privado)** y marcá **Demo realizada / Prueba iniciada / Pagó o dejó anticipo** solo con hechos reales.
3. Leé la pestaña **Informe**: ya tiene las 7 respuestas calculadas automáticamente.
4. Para un análisis completo con Claude, ejecutá `exportarCsvAnonimo`. Crea en la carpeta **Encuesta Gabriel Store** un archivo `gabriel-store-encuesta-anonima-AAAA-MM-DD.csv` **sin nombres, teléfonos ni ciudad** (cada persona es R001, R002...). Descargalo.

## 2. Pedir el análisis a Claude

Subí el CSV anónimo a una sesión de Claude Code con este repositorio. Para que **no** quede guardado en GitHub, ponelo en `encuesta-mercado/datos/` (esa carpeta está en `.gitignore`). Después escribí:

> Analizá la encuesta siguiendo `encuesta-mercado/ANALISIS.md` con el archivo `encuesta-mercado/datos/<archivo>.csv`.

## 3. Lo que hace el analista (Claude) — paso a paso

1. **Calcular** con la misma lógica del script:
   ```bash
   node encuesta-mercado/analizar.mjs encuesta-mercado/datos/<archivo>.csv --anonimo   # informe
   node encuesta-mercado/analizar.mjs encuesta-mercado/datos/<archivo>.csv --json      # todos los números
   ```
2. **Leer todas las respuestas abiertas** (qué molesta, qué es indispensable, "Otro") y agruparlas a mano en temas. La clasificación por palabras clave del script es solo un punto de partida.
3. **Responder las 7 preguntas**, cada una con el número de respuestas en que se basa:
   1. **Cinco funciones a priorizar**: el puntaje del script (2 × la eligen + sufren el problema) **más** lo indispensable para cambiar de sistema. Si una función aparece mucho en "indispensable" pero poco en las opciones, decirlo.
   2. **Segunda etapa**: las demás, con el motivo.
   3. **Precios Básico, Profesional y Automatizado**: partir de la tabla de aceptación (qué % pagaría al menos el mínimo de cada rango). Compararla con lo que **ya pagan hoy** (gasto actual): un precio muy por encima del gasto actual necesita una razón fuerte. El Profesional **no se midió directamente**: presentarlo como hipótesis a validar con pilotos.
   4. **Mejor cliente por tamaño**: el segmento con más personas calificadas y verificadas, y mayor disposición de pago. Si tiene menos de 5 respuestas, decir que no es concluyente.
   5. **Ventajas competitivas**: qué molesta de los sistemas mencionados y qué piden como indispensable, contra lo que Gabriel Store ya tiene o puede hacer.
   6. **Pilotos**: lista por nivel (verificada → calificada → declarada con "Tal vez"). En el CSV anónimo salen como R001...; los nombres y teléfonos se buscan en la pestaña privada **Pilotos**.
   7. **Lanzamiento y estrategia comercial**: segmento inicial, oferta para pilotos, precio de prueba, canal y la métrica de éxito (conversión de prueba a pago).
4. **Separar siempre dos columnas de evidencia**:
   - **Dicen** (intención declarada o calificada): respuestas del formulario.
   - **Hacen** (intención verificada): demo hecha, prueba iniciada o pago, marcado en Pilotos.
   Ninguna conclusión de precio se presenta como firme si solo se apoya en "dicen".
5. **Marcar el nivel de confianza** en cada conclusión (según la tabla de la sección 0) y el tamaño de la muestra del segmento.

## 4. Reglas que el análisis no puede romper

- No inventar datos ni completar huecos con supuestos sin decirlo.
- No mostrar teléfonos en ningún informe. Los nombres solo en documentos privados.
- No extrapolar una muestra chica a "el mercado".
- No tratar "Sí, me interesa la prueba" como una venta.
- Si una pregunta tiene pocas respuestas (por ejemplo, abiertas opcionales), decir cuántas son.

## 5. Niveles de intención (cómo los calcula el script)

| Nivel | Condición | Fuente |
|---|---|---|
| Sin intención de pago | "No pagaría" en básico y avanzado | Formulario |
| Declarada | Dice que pagaría algo | Formulario |
| Calificada | Declarada + quiere la prueba ("Sí") + autoriza contacto + dejó WhatsApp | Formulario |
| Verificada: demo o prueba | Asistió a una demo o inició la prueba | Pestaña Pilotos (manual) |
| Verificada: pagó | Pagó o dejó anticipo | Pestaña Pilotos (manual) |

## 6. Cómo se calcula el precio sugerido

Para cada rango de precio se calcula qué porcentaje de personas pagaría **al menos el mínimo** de ese rango (criterio conservador: quien elige "Bs 31–60" cuenta como Bs 31).

- **Básico**: entre los rangos que acepta al menos el **50 %** de los encuestados, el que da más ingreso esperado (precio × aceptación).
- **Automatizado**: lo mismo con la pregunta del plan avanzado, entre quienes pagarían el básico, con umbral del **30 %**.
- **Profesional**: punto medio (media geométrica) entre ambos. **Estimado**, no medido.
- El precio sugerido se redondea dentro del rango a un número terminado en 9 (por ejemplo Bs 31–60 → Bs 39).

Los umbrales se cambian en `CONFIG.UMBRAL_ACEPTACION_BASICO` y `CONFIG.UMBRAL_ACEPTACION_AUTOMATIZADO`.
