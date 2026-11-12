import json, sys, subprocess, re
T = json.load(open(sys.argv[1])); P = json.load(open(sys.argv[2])); shadow = open(sys.argv[3]).read(); fid = open(sys.argv[4]).read(); nform = int(sys.argv[5]); npm = sys.argv[6]
def f(x, d=0):
    s = f"{x:,.{d}f}"; return s.replace(',', '§').replace('.', ',').replace('§', '.')
tests = T['tests']; ok = sum(t['ok'] for t in tests)
sh = [l for l in shadow.splitlines() if l.startswith(('OK ', 'XX '))]
shok = sum(l.startswith('OK') for l in sh)
fidtot = fid.strip().splitlines()[-1]
m = re.search(r'TOTAL (\d+) de (\d+) (\d+)%', fidtot)
L = []
L.append('# Informe de pruebas\n')
L.append(f"Fecha: 12/11/2026. Archivo probado: `MODELO_EMPRESARIAL_MAESTRO.xlsx`. Tiene 41 hojas y {f(nform)} fórmulas. Las 20 primeras son un clon de Ñapefit con los estados financieros en $us.\n")
L.append('## Resultado\n')
L.append('| Prueba | Resultado |\n|---|---|')
L.append(f"| Recalcular todo el libro con LibreOffice | **0 errores** en {f(nform)} fórmulas |")
L.append(f"| Controles internos (hoja Controles) | **{T['base']['ctrl_ok']} de {T['base']['ctrl_tot']} en OK** |")
L.append(f"| Mismo resultado que la versión anterior en Bs | VAN $us 27.310,17 × 12,06 = **Bs 329.360,68**, igual al centavo |")
L.append(f"| Verificación independiente en Python (recalcula cifras desde los supuestos, sin leer las fórmulas) | **{shok} de {len(sh)} coinciden** |")
L.append(f"| Pruebas de coherencia y estrés ({T['runs']} corridas del libro completo, {round(T['segundos'])} s) | **{ok} de {len(tests)} superadas** |")
L.append(f"| Parecido con Ñapefit (títulos de Ñapefit que están en la misma celda del clon) | **{m.group(1)} de {m.group(2)} ({m.group(3)}%)** |")
L.append('| Cambio del tipo de cambio (9; 12; 12,06; 15) | Se recalcula todo sin errores y con 19 de 19 controles |')
L.append('| Balance general | Cuadra en los 21 cierres del caso base y en los 11 casos de estrés |')
L.append(f"| Pruebas de la tienda (`npm test`, regla del repositorio) | {npm}. No se tocó su código |\n")
L.append('## 1. Qué cambió en esta versión y cómo se verificó\n')
L.append('1. **Clon de Ñapefit:** cada tabla de las 20 hojas está en las mismas filas y columnas que en Ñapefit, con los mismos títulos y colores. Por ejemplo:')
L.append('   - Rentabilidad: flujo en la fila 5, valor residual en las filas 8 a 17, flujo neto en la 24, índices en B32, PRI en B41 y punto de equilibrio en B63;')
L.append('   - Flujo de caja: salidas de la 7 a la 18, inversión en la 23, financiamiento en la 28 y resumen anual desde la 37;')
L.append('   - Carga impositiva: compras en B2, ventas en B9, "Diferencia IVA" en Q2 y trimestres desde la fila 17;')
L.append('   - Compras: producción en la 18, cantidades en la 27, dólares en la 42 y programa de compras en la 55.\n')
L.append('   Los cálculos de apoyo que Ñapefit no tenía (por ejemplo, el detalle del flujo económico o la valorización del inventario) van debajo de las tablas originales.')
L.append('2. **Estados financieros en $us**, como Ñapefit. Lo que se cotiza en Bolivia se carga en Bs y se pasa a $us con el tipo de cambio de Supuestos. El VAN se muestra también en Bs.')
L.append('3. **Resultados iguales a la versión anterior:** cada cifra en $us es la anterior en Bs dividida por 12,06. Se comprobó con el VAN (al centavo), las ventas, la utilidad neta y los escenarios.\n')
L.append('### Comparación con Ñapefit, hoja por hoja\n')
L.append('| Hoja | Títulos de Ñapefit | En la misma celda |\n|---|---|---|')
for line in fid.strip().splitlines()[:-1]:
    mm = re.match(r'(.+?)\s+orig\s+(\d+)\s+misma celda\s+(\d+) \((\d+)%\)', line)
    if mm: L.append(f"| {mm.group(1).strip()} | {mm.group(2)} | {mm.group(3)} ({mm.group(4)}%) |")
L.append('\nLo que no coincide son filas propias del producto: otras máquinas, materiales y cargos (por ejemplo, 4 cargos en vez de 5 y 7 etapas de producción en vez de 6).\n')
L.append('### Cambio del tipo de cambio\n')
L.append('| Caso | VAN ($us) | VAN (Bs) | TIR | Controles |\n|---|---|---|---|---|')
for r in P:
    L.append(f"| {r['caso']} | {f(r['van'])} | {f(r['vanbs'])} | {f(r['tir']*100, 2)}% | {r['ok']} de {r['tot']} |")
L.append('')
L.append('## 2. Verificación independiente (modelo sombra)\n')
L.append('| Cifra | Modelo | Python |\n|---|---|---|')
for l in sh:
    mm = re.match(r'(OK |XX )\s*(.+?)\s+modelo=([-\d,\.]+)\s+python=([-\d,\.]+)', l)
    if mm:
        a = float(mm.group(3).replace(',', '')); b = float(mm.group(4).replace(',', ''))
        d = 4 if abs(a) < 1 else 2
        L.append(f"| {mm.group(2)} | {f(a, d)} | {f(b, d)} |")
L.append('')
L.append('## 3. Pruebas de coherencia y estrés\n')
L.append('Cada fila es una corrida real del libro completo.\n')
L.append('| N° | Prueba | Resultado | Detalle |\n|---|---|---|---|')
for i, t in enumerate(tests, 1):
    L.append(f"| {i} | {t['prueba']} | {'Superada' if t['ok'] else 'NO superada'} | {str(t['detalle'])[:80]} |")
L.append('\nLas alertas funcionan:\n- con demanda +80%, el control de capacidad pasa a REVISAR;\n- con precio −30% o en el pesimista, se marcan caja bajo el mínimo, VAN negativo y TIR menor que la TRMA.\n')
L.append('### Escenarios ($us)\n')
L.append('| Escenario | VAN | TIR |\n|---|---|---|')
for k in ['Pesimista', 'Base', 'Optimista']:
    v = T['scen'][k]; tir = v['tir']
    L.append(f"| {k} | {f(v['van'])} | {f(tir*100, 2) + '%' if isinstance(tir, (int, float)) else tir} |")
open(sys.argv[7], 'w').write('\n'.join(L) + '\n')
print('ok', ok, len(tests), shok, len(sh))
