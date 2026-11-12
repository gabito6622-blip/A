# Informe de pruebas

## Tanda 12/11/2026 · Ver antes de confirmar, etapa 5 (publicado en #42)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **470 → 471 / 471 ✅** |
| Lo que se ve antes = lo que pasa después | `test/guiado.test.mjs`, con navegador a 360 px. Cubre: el «Automático» de Vender nombra el mismo perfil que después entrega el servidor; la fecha de «Si renovás» es la que queda después de renovar; la confirmación muestra «dd/mm → dd/mm»; el aviso del proveedor aparece antes y, si igual se intenta, el servidor frena y la fecha no cambia; «Hay 3 perfiles libres» y «No hay perfiles libres» coinciden con el stock | ✅ |
| Pruebas viejas más firmes | `oficina` y `buscador` fallaban a veces por casualidad: buscaban «777» o «4321» en ids y fechas. Ahora miran solo los textos que se muestran | ✅ |
| Foto antes / después | Las 30 pantallas idénticas | ✅ |
| **Después de publicar (#42), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. Solo mirando: las fichas y Renovar muestran la vista previa, sin desborde y con 0 errores | ✅ |
| Hallazgo | 81 de los 82 servicios muestran «se pasaría de la fecha del proveedor». Es correcto: son alquileres de Disney cuya cuenta vence con el proveedor el mismo día que el cliente o antes (40 de 81). El servidor ya frenaba esas renovaciones; ahora se ve antes. Para renovarlos: primero «Pagué la renovación» de la cuenta en Cuentas (mueve la fecha del proveedor) y después renovar al cliente | ℹ️ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Ficha 360°, etapa 4 (publicado en #41)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **469 → 470 / 470 ✅** |
| Ficha | `test/ficha.test.mjs`, con navegador a 360 px. Cubre: servicios, pedidos y fallas del cliente; sin contraseña ni costo; pestañas; botones de 44 px sin desborde. «Pagado», «Renovar» (+30 días) y «Reemplazar» (otro perfil) cambian lo mismo que en sus pantallas y la ficha queda abierta. Atención (en oscuro) ve la ficha y Renovar, sin Reemplazar | ✅ |
| Foto antes / después | Las 30 pantallas idénticas: mismos botones, formularios y enlaces | ✅ |
| Revisión visual | 390 px, claro y oscuro, con datos de ejemplo: 0 desbordes, 0 errores | ✅ |
| **Después de publicar (#41), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. A 390 px, solo mirando y sin tocar botones de acción, se abrieron las fichas de 3 clientes reales (11, 16 y 5 servicios) con sus 3 pestañas: 0 desbordes, 0 errores | ✅ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Buscador del panel, etapa 3 (publicado en #40)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **464 → 469 / 469 ✅** |
| Buscador | `test/buscador.test.mjs` (5): sin tildes, por teléfono, por correo de cuenta, por referencia del banco y por número de pedido; buscar por la contraseña no encuentra nada y ningún resultado trae contraseña, PIN ni costo; Atención sin cuentas ni pedidos; cliente y sin sesión → no; menos de 2 letras no busca; navegador a 360 px en claro y oscuro (botón arriba, tecla /, Esc, resultado → ficha abierta, Inicio → «Ver todo en el Control») | ✅ |
| Foto antes / después | Mismo guion y mismos datos: 28 pantallas idénticas; Inicio y Mi oficina tienen 1 botón menos cada una, por Sofi (sacada por decisión del dueño) | ✅ |
| **Después de publicar (#40), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. Búsquedas reales («disney», «gmail»): resultados sin datos sensibles. A 390 px: 6 resultados, sin desborde, el resultado abre su pantalla sin error, 0 errores | ✅ |
| Para tener en cuenta | Un teléfono se busca con 4 números o más («591» solo no alcanza). Las cuentas se buscan por correo, no por producto | ℹ️ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Panel ordenado, etapas 1 y 2 (publicado en #39)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` (sin las 13 de Sofi, que se sacó) | **464 / 464 ✅** |
| Ninguna pantalla perdida | `test/panel-ordenado.test.mjs`: por rol (dueño, admin, atención) compara el menú nuevo con la foto del anterior (30, 26 y 16 pantallas) y abre cada una sin error; buscador con permisos; barra de abajo; «Más»; pendientes de Inicio = Notificaciones; 360 px, 44 px, sin desborde | ✅ |
| Foto antes / después | Mismo guion y mismos datos de ejemplo: 27 pantallas idénticas, 0 con menos botones, formularios o enlaces. Inicio tiene 1 botón más (el pendiente); Usuarios cambia porque la prueba creó 2 usuarios | ✅ |
| Revisión visual | 390 px, claro y oscuro: menú completo en una pantalla, búsqueda e Inicio. 0 errores | ✅ |
| **Después de publicar (#39), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75 (antes y después de publicar). Con la llave del asistente (rol admin) a 390 px: el menú tiene las mismas 26 pantallas que antes y todas abren sin error ni desborde; barra de abajo correcta; 5 pendientes en Inicio; 0 errores. El respaldo automático diario existe en el código, pero la llave no puede verlo | ✅ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Sofi, la secretaria (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar | **463 → 476 / 476 ✅** (~29 s) |
| Secretaria | `test/ordenes.test.mjs` (13), con Claude falso. Cubre: cada consulta con datos reales; lo enviado a Claude no lleva contraseña, código, correo completo ni costo; los planes no cambian nada hasta confirmar; usado, vencido o de otro → error; Cancelar; ambigüedad con botones; falta de forma de pago; permisos (atención 403, cliente no); apagada, sin clave o en el tope → mensaje claro; 429; navegador a 360 px | ✅ |
| Revisión visual | 360 y 390 px, claro y oscuro: caja en Inicio, elegir cliente, plan con confirmación y Sofi en Mi oficina. 0 desbordes, 44 px, 12 px | ✅ |
| No probado | Claude real con textos dictados de verdad; el micrófono del teclado; un celular físico | ⚠️ |

## Tanda 11/11/2026 · Mi oficina (publicado en #38)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **456 → 463 / 463 ✅** (~31 s) |
| Mi oficina | `test/oficina.test.mjs` (7), con Claude y Meta falsos. Cubre: los 6 en su puesto; permisos (dueño y admin sí, vendedor 403, cliente no, gasto solo el dueño); el comprobante revisado se anota con el primer nombre, sin apellido, contraseña, correo ni número de operación; WhatsApp respondido y pase a una persona; la alarma de Vico se apaga al ver el aviso; Coco se despierta con un código que nunca se muestra; no va en el estado ni en la exportación; tope de 80; navegador a 360 px en claro y oscuro | ✅ |
| Revisión visual | Datos de ejemplo a 360, 390 y 1280 px: 0 desbordes, botones de 44 px, letra de 12 px o más, 0 errores. Video corto grabado para el dueño | ✅ |
| **Después de publicar (#38), tienda real** | Servicios 85 → 85; cola 33 → 33; `/api/admin/office` responde con los 6 (5 en su puesto, Wali apagado); panel `#oficina` a 390 px: 6 escritorios, 0 desbordes, 0 errores | ✅ |
| No probado | Revisión con axe (falta `axe-core` en este entorno) | ⚠️ |

## Tanda 11/11/2026 · Avisos solos + códigos solos (publicado en #37)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar los 2 equipos | **435 → 456 / 456 ✅** (~26 s) |
| Avisos solos | `test/avisos-solos.test.mjs` (12), con reloj controlado y push falso. Cubre 3 días, 1 día y el mismo día; uno por día sin repetir; agrupado; cliente de revendedor sin precio; link `/c/`: alta, baja y borrado al revocar, al borrar el perfil o al liberar el cupo; 410/404 borran; aislamiento; nada en el panel ni en las exportaciones. Navegador a 360 px | ✅ |
| Códigos solos | `test/codigos-solos.test.mjs` (9). Cubre la cuenta correcta; nada de más de 30 min ni de antes de entrar; interruptores del dueño y del revendedor; link revocado o borrado → 404; la respuesta no trae correo, contraseña ni cuerpo del mail; auditoría solo con ids; 429; cuentas propias. Navegador a 360 px | ✅ |
| Al integrar | Choques de imports en 5 archivos (se conservaron los dos lados). La lista cerrada de `/api/cobro` quedó con `alerts` y `codes` en las 3 pruebas que la comprueban | ✅ |
| Revisión en celular | `revision-celular.cjs` con `seed-reseller-demo` a 360/390/768, claro y oscuro: 0 desbordes y 0 textos cortados. Los botones y textos chicos que marca están en pantallas que esta tanda no tocó. Los equipos revisaron sus pantallas nuevas a 360/390 sin desborde ni errores | ✅ |
| **Después de publicar (#37), tienda real** | Servicios 85 → 85; cola de mensajes 33 → 33; USDT y tasa 11,71 sin cambios; conteo de avisos responde (0 enviados hoy, encendido); `/api/cobro/<link falso>/codes` → 404; tienda, /hub, /c/ y panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes y 0 errores. `/r/streaming-gabo` dice "no existe o no está publicada" porque esa página no está publicada (ya era así; #37 no la tocó) | ✅ |
| No probado | Recibir un aviso real en un Android o un iPhone (el navegador de prueba no se suscribe a Google ni a Apple); el lector IMAP real con códigos de verdad; la revisión de accesibilidad con axe, que no pudo correr (falta `axe-core` en el entorno) | ⚠️ |

## Tanda 11/11/2026 · Cargar sus cuentas + seguridad y plata + renovar con su revendedor (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar 2 equipos y los arreglos | **400 → 425 / 425 ✅** |
| Cargar sus cuentas | `test/cargar-vendidas.test.mjs` (10): vista previa con todos los casos, no cobra ni avisa, no duplica, no dice de quién es una cuenta ajena, revendedor en dólares → "Te paga US$", permisos, navegador a 360 px | ✅ |
| Seguridad y plata | `test/seguridad-plata.test.mjs` (12): todas las rutas `/api/me*` leídas del código y recorridas como cliente final en Bs y en US$; 16 intentos cruzados entre revendedores; precio en US$; monedas | ✅ (11 de 12 fallaban con el código anterior) |
| Ficha en US$ | `test/ficha-usd.test.mjs` | ✅ |
| Renovar con su revendedor | `test/renovar-con-revendedor.test.mjs` (2) + navegador: la clienta de Ariana ve "Renovar con Ariana Streaming" y "Ver su página", sin precio, 0 errores | ✅ |
| Afuera completo | `test/afuera-completo.test.mjs` (9): "7.300", Panamá, avisos a 3 días, aislamiento de cuentas propias, aviso diario con push falso (1 por día), Argentina en wa.me, navegador a 360 px para Paraguay, Panamá y Bolivia | ✅ (434/434 integrado) |
| **Después de publicar (#35), tienda real** | Servicios 85 → 85; cola 33 → 33; los 3 de afuera siguen en US$; tasa del BCB 11,71 (11/11); vista previa de "Cargar sus cuentas" responde (sin guardar); tienda, /hub y panel a 390 px: 0 desbordes, 0 errores | ✅ |
| Final integrado | Paraguay en la lista US$ a 360 px ve el aviso del tipo de cambio, sin desborde; panel del dueño sin desborde; tarjeta de la tasa en Inicio; 0 errores | ✅ |
| Al integrar | 1 choque de imports en `panel.js` (se conservaron los dos). Cruces arreglados: ficha en Bs para revendedor en US$; precio en US$ como nota | ✅ |


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
