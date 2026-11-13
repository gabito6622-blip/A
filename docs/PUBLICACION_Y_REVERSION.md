# Publicación y reversión de la Optimización 1 + 2 (rama `optimizacion-1`)

Fecha: 13/11/2026 · Estado: **lista, sin publicar**. Se publica solo con el «PUBLICÁ» del dueño, después de que confirme su respaldo.

## 1. Qué se publicaría
- **Optimización 1:** semáforo sin falsas alarmas, «💵 Me pagó» desde Mi secretaria con vista previa, cierre con mes anterior incompleto, detalles visuales, demo de GaboHub (solo con datos ficticios, no toca la tienda real).
- **Optimización 2:** renovar con QR o saldo desde un link, **apagado de fábrica**. Hasta que el dueño lo prenda en Configuración → Soporte, la tienda se comporta exactamente igual que hoy: no hay botón nuevo en la secretaria, el aviso de Tito sigue abriendo Mis cuentas, y cualquier link `/tienda/#renovar=…` responde «El link venció o ya se usó».

## 2. Confirmación: no modifica ni reemplaza la base de producción
| Pregunta | Respuesta | Cómo se verificó |
|---|---|---|
| ¿Cambia el formato de la base (`/data/gabriel.db`)? | **No.** No hay migraciones nuevas ni tablas nuevas. | `git diff premium-2.0..optimizacion-1 -- src/server/db.ts` solo agrega la palabra `"renew"` a un tipo de TypeScript (la columna `kind` de sesiones ya es texto libre). |
| ¿Borra, reescribe o reinicia datos al arrancar? | **No.** Al arrancar lee el último estado guardado, como siempre. Ningún script ni seed corre en producción. | revisión del diff: nada toca `data/`, `seed-*` solo se usan a mano en carpetas vacías (abortan si la carpeta tiene datos). |
| ¿Agrega campos a los datos? | Solo **opcionales** (`settings.renewLink`, `control.paidLog` ya existía, `risk.inactive` se calcula al vuelo). Si no están, se asume el valor de hoy (links apagados). | `src/store/types.ts`, `src/store/catalog.ts`. |
| ¿Cambia precios, cuentas, clientes o alquileres? | **No.** Nada se escribe hasta que el dueño toque un botón. | 78 alquileres activos contados antes y después de la última publicación; se repite la cuenta después de esta. |
| ¿Se puede volver atrás sin perder datos? | **Sí**, porque el código nuevo solo lee/escribe el mismo estado. Volver al código anterior deja todo como estaba; lo único que la versión vieja ignoraría es el ajuste `renewLink` (sin efecto). | sección 5. |

## 3. Verificación: «Me pagó» sin cobros duplicados y con la fecha del proveedor
Pruebas en `test/optimizacion-1.test.mjs` (pasan en la tanda completa):
| Freno | Qué prueba | Resultado |
|---|---|---|
| Mismo período dos veces | marcar el cobro, volver a pedir la vista previa del mismo período → bloqueado «ya figura cobrado» | ✅ |
| Doble toque / dos personas | un segundo cobro a los segundos del primero → bloqueado «se marcó un cobro hace 1 min» (400 por API) | ✅ |
| Misma llave de idempotencia | dos `POST …/pay` con la misma `idempotencyKey` → una sola fecha nueva, un solo `paidLog` | ✅ |
| Fecha del proveedor | fecha nueva que pasaría la de la cuenta → bloqueado con el texto de la fecha; se usa el mismo `extend` del Control (sin `allowBeyondSupplier`) | ✅ |
| Finanzas cuenta una vez | después de «Me pagó», ingresos del mes suben exactamente el monto una vez | ✅ |

Para la renovación por link (`test/renovar-link.test.mjs`): saldo descuenta una vez y el link queda usado; QR no corre la fecha hasta que el dueño aprueba; segundo pedido por el mismo link → 409; proveedor → 409 sin descontar nada.

## 4. Procedimiento de publicación (cuando el dueño diga «PUBLICÁ»)
1. **Respaldo** (lo hace el dueño): Panel → Configuración → Respaldos → «Descargar respaldo» y confirmar que la copia del día está en su Gmail. Guardar también el número de alquileres activos de Inicio (hoy 78).
2. **Verificar la rama:** `npm test` en `optimizacion-1` tiene que dar todo verde (hoy 527 + 9 nuevas). La CI de GitHub también.
3. **PR** desde `optimizacion-1` hacia `ccr-0b4be8d6-1sld7s` (la rama que publica Railway) y fusión con **squash**. Railway vuelve a publicar solo, en 1 a 2 minutos.
4. **Verificación de solo lectura en la tienda real** (sin tocar datos):
   - `/api/health` responde; el panel abre; Inicio muestra los mismos 78 alquileres activos y los mismos ingresos del mes;
   - Configuración → Soporte muestra «Links de renovación» **apagado**;
   - Mi secretaria abre y muestra «💵 Me pagó» sin botón de link;
   - `/tienda/#renovar=prueba` muestra «El link venció o ya se usó» (apagado);
   - Inventario: las cuentas dadas de baja aparecen ⚪, las vivas con problemas siguen rojas.
5. **Avisar al dueño** el resultado con números. Prender los links es decisión suya, otro día si quiere.

## 5. Reversión (si algo no gusta o falla)
- **Sin tocar datos:** en GitHub, «Revert» del PR fusionado en `ccr-0b4be8d6-1sld7s` (o fusionar de nuevo el commit anterior `424da35…` de Premium 2.0). Railway publica la versión anterior en 1 a 2 minutos. Los datos siguen en `/data`, intactos: la versión anterior los lee sin problema.
- **Nunca** se restaura un respaldo para revertir código: el respaldo es solo para un desastre de datos, y lo decide el dueño.
- Si los links estaban prendidos y se revierte: los links ya mandados dejan de funcionar (la versión vieja no conoce esa ruta). Ningún cobro queda a medias: con saldo ya se entregó; con QR el pedido queda en «Aprobar pagos» como cualquier otro.

## 6. Qué no hace esta publicación
- No prende Wali ni ninguna automatización; no manda mensajes; no cambia precios de la tienda ni de GaboHub; no toca los 18 grupos de cuentas por perfiles; no retira ni borra cuentas.
