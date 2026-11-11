# Informe de pruebas

## Tanda 11/11/2026 · Lista en dólares + tasa del Banco Central (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar el equipo y la tasa del BCB | **383 → 400 / 400 ✅** |
| Lista en dólares | `test/lista-dolares.test.mjs` (15): precios en US$, recarga USDT → US$, compra con saldo US$ 20 → 13, total en Bs con la tasa, la tasa cambia y el saldo no, renovaciones, devolución y "Era una prueba" en US$, ajuste del dueño, dashboard sin mezclar monedas, cambio de lista con saldo rechazado, sin tasa rechazado, permisos, navegador | ✅ |
| Tasa del BCB | `test/tasa-bcb.test.mjs` (2) con una copia de la página; además la página real de hoy da 11,71 (11/11/2026) y se leyó en vivo desde el panel de prueba | ✅ |
| Al integrar | sin choques. Corregido: productos a pedido decían "pagás con QR" a revendedores de afuera | ✅ |
| **Después de publicar (#34), tienda real** | Tasa del BCB prendida: 11,71 (11/11). Lista US$ creada; 1 revendedor primero y después 2 más. Cola 33 → 33, servicios 85 → 85. Recorrido de tienda, /hub y panel: 0 desbordes, 0 errores | ✅ |
| Celular | revendedor de Panamá en la lista US$ a 360 px: ve US$ 7 y recarga 20 USDT → US$ 20, sin QR, 0 desbordes, 0 errores | ✅ |


## Tanda 11/11/2026 · Otro país, cuentas propias, IPTV, USDT y revendedores cómodos (2 equipos + integración)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` antes de lanzar y después de integrar | **347 → 382 / 382 ✅** (0 saltadas) |
| Otro país | `test/otro-pais.test.mjs` (11): teléfonos +595 en todas sus formas, Bolivia igual que antes, ₲ sin decimales, ninguna cifra con dos monedas, `/r/` con y sin tipo de cambio, `/c/` en ₲ | ✅ |
| Cuentas propias | `test/cuentas-propias.test.mjs` (9): lista pegada con vista previa, sin doble asignación, renovar/liberar/pagado, contraseñas cifradas en el archivo de la base, permisos por HTTP, el dueño/admin/vendedor no ven nada (rutas `/api/admin/*`, Excel, auditoría), IPTV y prueba de 24 h | ✅ |
| USDT | `test/usdt-afuera.test.mjs`: recarga USDT solo si está configurado, se acredita en Bs; en el navegador Paraguay ve USDT primero, montos en USDT, sin QR; Bolivia igual que antes | ✅ |
| Vista previa y logos | `test/vista-previa.test.mjs` (8) + `test/revendedor-pantallas.test.mjs` (navegador): etiquetas por ruta, `/r/` no publicada genérica, `/c/` sin datos, escape, sin caché cruzada, logos en las pantallas | ✅ |
| Era una prueba | `test/era-prueba.test.mjs` (4) | ✅ |
| Dólar flexible | `test/usdt-afuera.test.mjs`: `rateAt` solo cambia si cambia la tasa; recarga en USDT calcula Bs con la tasa de hoy; cambiar la tasa no mueve lo ya pedido; compra en USDT fija su cotización; tarjeta de Inicio cambia la tasa con coma | ✅ 383/383 |
| Al integrar | 4 choques en `shop.js`, `app.ts` y `subLinks.ts` (logos de un equipo + moneda del otro en la misma línea): se conservaron los dos lados | 382/382 |
| Celular | Barrida del equipo: 166 → 0 problemas en las pantallas del revendedor; Paraguay a 360/390 claro y oscuro sin desborde; panel del dueño (Inicio, Control, Revendedores, Cómo van, Que vuelvan) sin desborde. Arreglado al integrar: botones de Control a 44 px y etiqueta a 12 px | ✅ (queda el deslizador del asesor de la tienda, que ya estaba) |

**Después de publicar (#33), tienda real:**
- "Era una prueba" se usó primero en 1 servicio (la cola de avisos siguió en 33) y después en los otros 4 pedidos: 6 servicios cerrados, Bs 100 fuera de los números.
- Servicios activos 91 → 85 (los 85 alquileres). La cuenta Disney de 7 perfiles y la Prime de 5 quedaron todas libres.
- Cómo van, este mes: Bs 241 → Bs 207.
- Recorrido de la tienda, /hub, /c/ inválido y el panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes, 0 errores.
- Vista previa de una /r/ no publicada: genérica ("Streaming hub").

**No se probó:** celular real, WhatsApp mostrando la vista previa (solo las etiquetas en el HTML), un pago real en USDT, `revision-accesibilidad.cjs` completo (el equipo lo corrió con axe en sus pantallas).


## Tanda 11/11/2026 · Cómo van cuenta los cobros del Control
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **347 / 347 ✅** (1 nueva) |
| Cobros del Control | `test/como-van.test.mjs` "cuenta lo marcado 💵 cobrado…": marca vieja en el inicio del período; marca nueva con fecha y monto; volver a pendiente la borra; mismo período una vez; con pedido no duplica; marca de octubre va al mes pasado; sin % gigante | ✅ |
| El revendedor no ve los cobros anotados | revisión de código: sus pantallas (`portal.ts`, `resellerTools.ts`) solo leen `control.price` | ✅ |
| Celular | `revision-celular.cjs` Cómo van a 360 y 390, claro y oscuro | 0 desbordes; únicos avisos en el asesor de la tienda (ya estaban) |
| Estimado con los datos reales (copia de solo lectura) | 27 alquileres marcados pagado | ~Bs 207 este mes (3) y ~Bs 1.537 en meses anteriores; los 57 sin marca no suman |
| **Después de publicar (#32), tienda real, solo lectura** | Cómo van por API y recorrido del panel a 390 px | Te pagaron este mes **Bs 34 → Bs 241**; mes pasado **Bs 0 → Bs 1.424** (menos que el estimado: no se duplicaron los que ya tenían pedido); Bs 948 de 30 días vienen del Control. Servicios 91 → 91, cola de avisos 33 → 33. Sin `paidLog`, `subs` ni contraseñas en la respuesta. 0 desbordes, 0 errores |


## Tanda 11/11/2026 · Vender más (3 equipos en paralelo)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` antes de lanzar y después de integrar los 3 equipos + el arreglo de transferencia | **315 → 346 / 346 ✅** (31 nuevas, 0 saltadas) |
| Que vuelvan | `test/winback.test.mjs` (15: cada caso que entra y no entra, 7/60 días con reloj, métrica, permisos por HTTP, sin costos ni correos) + `winback-panel.test.mjs` (navegador) | ✅ |
| Cómo van | `test/como-van.test.mjs` (7: borde de mes en hora de Bolivia, sin doble conteo, cada estado, permisos, JSON sin datos de clientes del revendedor) | ✅ |
| Link de cobro | `test/link-cobro.test.mjs` (8: camino feliz, aislamiento entre revendedores, 60+ respuestas del panel y 6 Excel sin el cuaderno ni tokens, revocar/borrar/renovar, límite por IP, navegador) | ✅ |
| Transferir no pasa el cuaderno | prueba en `link-cobro`: **falla sin el arreglo, pasa con él** | ✅ |
| Revisión en celular (integrado) | `revision-celular.cjs`, dueño: Inicio, Que vuelvan, Cómo van y Revendedores a 360/390/768, claro y oscuro; Atención: Inicio, Que vuelvan, Revendedores | Pantallas nuevas: **0 desbordes, 0 botones chicos, 0 textos chicos**. Revendedores: avisos que ya estaban (BACKLOG V11) |
| Por rol (integrado) | Playwright con datos de ejemplo: admin ve Cómo van y Que vuelvan; Atención no ve Cómo van; revendedora crea su link y la página /c/… se ve a 360/390 claro y oscuro; cliente final en la tienda | 0 errores de consola, 0 desbordes |

**Después de publicar (#31), en la tienda real y solo leyendo:** servicios 91 → 91, cuentas 125 → 125, revendedores 22 (16 sin PIN), cola de avisos 33 → 33. Tienda, /hub, link de cobro inválido (muestra "Este link ya no sirve") y panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes, 0 errores. Las respuestas de Que vuelvan y Cómo van no traen `subs`, `rcontrol`, contraseñas ni costos de cuentas.

**No se probó:** celular real (guardar el QR manteniendo apretado, que abra WhatsApp), un QR bancario real, `revision-accesibilidad.cjs` (falta axe-core), datos reales de producción.

## Tanda 11/11/2026 · Cobro de alquileres (#29) y cuentas completas (#30)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` en la rama `ccr-a0b95638-dpfc8j` (igual a producción + método de trabajo) | **314 / 314 ✅** en ~11 s |
| Renombrar perfil de cuenta completa no avisa | prueba en `test/store.test.mjs`; cambiar el PIN sí avisa | ✅ |
| Arreglo en la tienda real | respaldo previo → 1 perfil de prueba (cola de avisos 33 → 33) → todos | 54 renombrados, 28 retirados, 21 notas guardadas, 0 problemas |
| Verificación después | lectura del panel con la llave del asistente | 123 cuentas de alquiler con 1 perfil "Cuenta completa"; servicios activos 91 → 91; cola de avisos 33 → 33 |

| Invitar desde Inicio | `test/invitar-inicio.test.mjs` con navegador (Playwright): tarjeta con el número correcto, botón arma la fila, PIN, link de WhatsApp al número correcto, avanza sola, Anterior conserva el PIN, a quien no tocaste no se le genera PIN, Atención no la ve, 0 errores. WhatsApp bloqueado en la prueba | ✅ (en la CI se salta: no tiene navegador) |
| Revisión en celular | 360 y 390 px, claro y oscuro, datos de ejemplo | sin desborde ni errores |
| Total | `npm test` | **315 / 315 ✅** |

**No se probó:** que los revendedores vean el nombre nuevo en su celular (se verificó por la API, no con su sesión).

# Informe de pruebas — Pulido GaboHub (11/11/2026)

Rama: `pulido-fix` (sin publicar). Todo con **datos ficticios** en copias locales; nada contra producción, sin pagos ni mensajes reales.

## 1. Cómo se probó
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` (node:test, 309 pruebas: núcleo, servidor, seguridad, permisos, números) | **309 / 309 ✅** |
| Recorrido en celular (390×844) | Playwright, 43 pantallas: 12 del dueño, 12 de Atención, 13 del revendedor, 6 del cliente | **0 errores de consola · 0 desbordes · 0 rechazos de permiso** |
| Aislamiento entre revendedores | Ariana pide sus datos (control, clientes, fiado, servicios, fallas, ganancias) y se busca algo de Bruno o costos del proveedor | **No aparece nada ajeno ✅** |
| Auditoría de seguridad | 120+ intentos cruzados Ariana↔Bruno + barrido de ids secuenciales 1..1300 (cus_, asg_, ord_, fia_, tik_) | **0 accesos ajenos ✅** (scripts en `pulido/seguridad/scripts`) |
| Peso de la tienda | `curl` con y sin gzip | shop.js **227 KB → 66 KB**; repetida con ETag → **304** (no se vuelve a bajar) |

## 2. Lo que se arregló, con su prueba
### 🔒 Seguridad
| Hallazgo | Prueba |
|---|---|
| **CRÍTICO:** registrarse con el correo de otra cuenta abría esa cuenta | `test/pulido-seguridad.test.mjs` "registrarse con el correo de una cuenta existente NO abre su sesión" |
| Dos clientes con el mismo correo | idem "no se puede crear un cliente con un correo que ya es de otro" |
| Atención veía costo de cuentas y proveedores; podía cambiar el costo | idem "Atención (seller) no ve costo…" (+ 403 al cambiar costo) |
| Atención podía alargar fechas sin cobrar, aprobar revendedores, dar PIN a revendedores | `test/pulido-panel.test.mjs` (permisos) |

### 👔 Dueño (números)
| Hallazgo | Antes → Después | Prueba |
|---|---|---|
| "Vas a cobrar" con precio público | Bs 1.382 → **Bs 975** (= suma de las Fichas: Ariana 908 + Bruno 67) | `pulido-panel.test.mjs` |
| "Te quedó" sin costo de cuentas | Bs 992 → **Bs −1.988 (estimado)** con aviso "56 cuentas sin anotar" | idem |
| Proveedores mezclaba períodos | Ingreso 1.301 (toda la historia) → **1.005 (30 días = Dashboard)** | idem |
| "Vencen en 7 días" distinto por pantalla | 6 / 7 → **6 en todas** | idem |
| Cobrar a clientes de revendedores con precio público | → "🏪 de Ariana" + "📣 Avisar a Ariana" | navegador |
| PIN nuevo sin confirmar / saldo con prompt | → confirmación + saldo antes→después | navegador (`panel-fix/shots/flow-*`) |
| Sin aviso si falta precio de revendedor o se pierde plata | → avisos en Notificaciones y en la carga masiva | `pulido-panel.test.mjs` |

### 🏪 Revendedor
| Hallazgo | Prueba |
|---|---|
| Número sin +591 → WhatsApp roto y clientes repetidos | `store.test.mjs` "No pagó → la libreta…" (+591, duplicado) + navegador (`wa.me/59170099111`) |
| Ganancias contaban lo no cobrado | `store.test.mjs` (vendiste 40, cobraste 0) |
| Quién me debe en Bs 0 mientras Mi control decía que le deben | `store.test.mjs` + navegador (No pagó → 25; Pagado → 0) |
| "Renovar" que fallaba por vencimiento del proveedor | navegador: 40 candados 🔒, 0 botones que fallan |
| Movimientos de saldo con códigos | `store.test.mjs` ("Netflix perfil para Rodrigo Paz") |
| Mi control interminable | navegador: 16.283 → **5.529 px** con 41 servicios |

### 🛒 Cliente
| Hallazgo | Prueba |
|---|---|
| Atrás sacaba de la tienda | navegador: Atrás cierra el carrito, el 2º Atrás vuelve a Inicio de la tienda |
| QR ofrecido sin QR / sin salida para pagar | `paymethods.test.mjs` + navegador (aviso y botón desactivado) |
| Acceso abría en correo | navegador (abre en número + PIN, "Olvidé mi PIN") |
| Asesor recomendaba agotados | navegador |

## 3. Lo que NO se probó (y por qué)
- **Producción:** no se tocó; se prueba al publicar con tu OK (salud del servidor + recorrido rápido).
- **Avisos al celular reales:** el envío se prueba con un servicio falso (`push.test.mjs`); no se mandó ninguna notificación real.
- **iPhone real:** se emuló Chromium móvil; instalar como app en iPhone depende de Safari.

## 4. Pendientes conocidos
Ver `docs/BACKLOG.md` (estado ⏳): Mis cuentas del revendedor largo, vista previa de Mi página en celular, primer precio lejos en el diseño "clásico", reubicar para Atención, liberar cuarentena por cuenta, "lo que te paga vs lo que cobra" el revendedor.
