# Pendientes (BACKLOG)

Prioridad: P1 = frena ventas o es un riesgo · P2 = molesta todos los días · P3 = lindo de tener.
Estado: ⏳ pendiente · 🔧 en curso · ✅ hecho (con prueba) · 🧑 decide el dueño.
Origen: 🛒 cliente · 🏪 revendedor · 🎧 atención · 👔 dueño · 🔒 seguridad (auditoría del 11/11/2026).

## Decisiones del dueño
| # | Pendiente | Prioridad | Estado |
|---|---|---|---|
| B1 | Qué compran y a cuánto los revendedores | P1 | ✅ solo alquileres: Disney 69/34, Prime 20, HBO 15 |
| B2 | Precios Netflix 3m → Bs 110 y Dúo Netflix+HBO → Bs 50 | P2 | 🧑 |
| B3 | Conectar gabostore.lat (DNS en Namecheap) | P1 | 🔧 con el dueño |
| B4 | ✅ marcados como prueba en la tienda real (#33): 6 servicios, Bs 100 · 6 servicios de perfil que no son alquiler: 5 en una misma cuenta Disney (cera 100gr, rodbol ×2, Ivana, gabo) y 1 Prime (gabo). ¿Son ventas reales de perfil o pruebas? | P3 | 🧑 |
| B6 | Invitar a los 16 revendedores sin PIN | P1 | 🧑 botón "▶ Invitarlos ahora" en Inicio (publicado en #31) |
| B10 | Tasa del USDT automática | P3 | ✅ Banco Central de Bolivia (el dueño eligió la fuente), #34 |
| B11 | País puesto en la tienda real: "paraguay" → Paraguay (+595, ₲), "panama" → Otro país (+507, $). La cola de avisos siguió en 33 | P1 | ✅ |
| B13 | Precio en US$ de Flujo TV para la lista en dólares (en Bs está a Bs 25) | P1 | 🧑 |
| B14 | Lista "Panamá y Paraguay (US$)" creada en la tienda real y paraguay, panama y EXTRANJERO pasados a ella (saldo US$ 0, 85 servicios intactos, cola 33) | P1 | ✅ #34 |
| B15 | Que el cliente final de un revendedor no vea en "Mis pedidos" lo que pagó el revendedor (su costo) | P2 | ✅ equipo seguridad y plata |
| B16 | Precio acordado en US$ en Control para clientes en dólares | P3 | ✅ "Te paga US$" |
| B17 | El cliente de un revendedor renueva con su revendedor | P2 | ✅ decisión del dueño |
| B18 | Al cargar un cliente, que no se sepa si ese teléfono ya es cliente de otro revendedor ("Ya existe un cliente con ese teléfono") | P3 | ⏳ |
| B19 | "Apps más vendidas" de Finanzas cuenta unidades cargadas en lote/importadas | P3 | ⏳ |
| B12 | Datos de revendedores para invitarlos: "paraguay" ✅ corregido a +595 992 946 366 (captura del dueño); Panamá: +507 6554-3461 (cuentaspremiumpty) y +507 6045-0712 (Resell Panama), falta saber cuál es "panama" y cuál "EXTRANJERO"; sin WhatsApp: panama, EXTRANJERO, aneliz, Dani strem, ANDROID; JOSUE ORIAS incompleto (776115438). ¿De qué país es EXTRANJERO? | P1 | 🧑 |
| B8 | USDT activado en la tienda real con el Binance Pay ID del dueño y la tasa del BCB (11,71). Lo ven todos los clientes como opción "USDT (manual)"; los de afuera, primero | P1 | ✅ |
| B9 | Revendedores de otro país: ¿se les cobra algo extra? | P3 | 🧑 |
| B7 | Que vuelvan: ¿respetar el permiso de WhatsApp del cliente (`whatsappConsent`)? Hoy no filtra porque lo manda una persona a mano, como la fila de cobro | P2 | 🧑 |

## Tanda "vender más" (equipos)
| # | De | Pendiente | Prioridad | Estado |
|---|---|---|---|---|
| V1 | 👔 | Que vuelvan (recuperar ventas perdidas) | P1 | ✅ `test/winback*.test.mjs` |
| V2 | 👔 | Cómo van tus revendedores | P2 | ✅ `test/como-van.test.mjs` |
| V3 | 🏪 | Link de cobro para los clientes del revendedor | P1 | ✅ `test/link-cobro.test.mjs` |
| V4 | 🔒 | Transferir un alquiler pasaba el cuaderno del revendedor anterior | P1 | ✅ prueba en `link-cobro` |
| V5 | 👔 | Que vuelvan: revendedor con varias cuentas del mismo producto (se le cae 1 de 3 y no aparece) | P2 | ⏳ |
| V6 | 👔 | Cómo van: % enorme cuando el mes anterior fue casi cero (ej. +2057 %); mostrar "nuevo ingreso" | P3 | ✅ sin % si la base es menor a Bs 30 |
| V7 | 👔 | Cómo van: sumar a los revendedores anotados solo como texto en el Control | P3 | ⏳ |
| V8 | 🏪 | Link de cobro: mostrar los datos de pago escritos del revendedor (banco, a nombre de…) | P3 | ⏳ |
| V9 | 🔒 | Que el log de errores no guarde la ruta `/api/cobro/<token>` | P3 | ⏳ |
| V10 | 👔 | Que vuelvan: sumar pruebas gratis vencidas sin compra; "volvieron" solo del producto ofrecido | P3 | ⏳ |
| V12 | 👔 | Cómo van: los cobros de alquiler que marcás como "pagado" en el Control (y lo importado del Excel) no son pedidos, así que no suman en "te pagaron". Hoy en la tienda real da Bs 34 este mes. Contarlos sin duplicar las renovaciones con pedido | P1 | ✅ prueba `como-van` (#32) |
| V11 | 👔 | Revendedores a 360 px: tarjetas de la lista se salen 15 px, link de la página cortado (ya estaba) | P3 | ✅ equipo revendedores cómodos |
| W1 | 🏪 | Cuentas propias: avisos de vencimiento en "Tu día" y en el aviso diario al celular | P2 | ✅ |
| W2 | 🏪 | Afiches en la moneda del revendedor de afuera | P3 | ✅ |
| W3 | 🏪 | Celulares de Argentina: el "9" después de +54 en wa.me | P3 | ✅ al armar el link (falta en los links que arma `panel.js`) |
| W7 | 👔 | Pasar a "panama" y "EXTRANJERO" a Panamá (US$) | P3 | ✅ tienda real |
| B20 | Flujo TV para los de afuera (US$ 2,50) | P1 | ✅ #36 (a pedido: no hay cuentas de Flujo TV cargadas) |
| W8 | 🏪 | Que el panel no se redibuje mientras alguien escribe | P3 | ⏳ |
| W4 | 🏪 | Vista previa de `/r/` con el logo del revendedor encima | P3 | ⏳ |
| W5 | 🛒 | Montos negativos: "Bs -5" debería decir "-Bs 5" | P3 | ⏳ |
| W6 | 🛒 | Revisar la regla de 44 px en la tienda del cliente y en `/r/` (estilos generales tocados en la barrida) | P3 | ⏳ |
| B5 | Alquileres como cuenta completa (1 perfil "Cuenta completa") | P2 | ✅ 123 cuentas, sin avisos |

## Auditoría del pulido
| # | De | Pendiente | Prioridad | Estado |
|---|---|---|---|---|
| S1 | 🔒 | Registrarse con correo ajeno abría esa cuenta (toma de cuenta) | P1 | ✅ prueba `pulido-seguridad` |
| S2 | 🔒 | Dos clientes con el mismo correo | P2 | ✅ prueba `pulido-seguridad` |
| S3 | 🔒🎧 | Atención veía costo de cuentas y proveedores | P2 | ✅ prueba `pulido-seguridad` |
| C1 | 🛒 | Sin QR/WhatsApp el pedido quedaba sin salida; QR ofrecido sin QR | P1 | ✅ prueba `paymethods` + navegador |
| C2 | 🛒 | Botón Atrás del celular sacaba de la tienda | P1 | ✅ navegador |
| C3 | 🛒🏪🎧 | "Renovar" aparecía y fallaba por vencimiento del proveedor | P1 | ✅ candado 🔒 + navegador |
| C4 | 🛒 | Asesor recomendaba combos agotados | P2 | ✅ navegador |
| C5 | 🛒 | Portada prometía QR/WhatsApp/"al instante" que no había | P2 | ✅ |
| C6 | 🛒 | Acceso abría en correo, todo decía "con tu número" | P2 | ✅ navegador |
| C7 | 🛒 | "Últimas 1 unidades", pie con "·" suelto, índice de términos | P3 | ✅ |
| C8 | 🛒 | Copiar correo/contraseña en Mis cuentas | P2 | ✅ |
| C9 | 🛒 | En celular el primer precio aparece lejos (diseño clásico) | P2 | ⏳ (la tienda real usa "ticket", que ya muestra precios arriba) |
| C10 | 🛒 | Descripción del producto oculta en celular (diseño clásico) | P3 | ⏳ |
| C11 | 🛒 | 310 KB por visita sin comprimir | P2 | ✅ gzip + ETag (227→66 KB) |
| C12 | 🛒 | "Tu pedido en vivo" (Pedido → Revisando pago → Entregado, con hora estimada) | P3 | ✅ idea wow, navegador |
| R1 | 🏪 | Teléfono sin +591 → WhatsApp roto y clientes duplicados | P1 | ✅ prueba `store` + navegador |
| R2 | 🏪 | Ganancias contaban lo que no te pagaron | P1 | ✅ prueba `store` |
| R3 | 🏪 | Quién me debe en Bs 0 mientras Mi control decía que te deben | P1 | ✅ prueba `store` |
| R4 | 🏪 | Cada pantalla contaba distinto "los que vencen"; aviso llevaba a Mis cuentas | P2 | ✅ "📣 Avisarles" + semana completa |
| R5 | 🏪 | "Tu acceso" ofrecía correo sin tener contraseña | P2 | ✅ |
| R6 | 🏪 | Mis combos sin estilo y se borraban sin preguntar | P2 | ✅ |
| R7 | 🏪 | Afiche con combos agotados y sin los combos propios | P2 | ✅ |
| R8 | 🏪 | Barra de abajo sin Clientes; pestañas en 4 filas | P2 | ✅ |
| R9 | 🏪 | Vender fiado; datos tapados tras vender; confirmación | P2 | ✅ navegador |
| R10 | 🏪 | Mi control muy largo con muchos clientes | P2 | ✅ filas que se abren con un toque (16.283 → 5.529 px con 41 servicios) · Mis cuentas del revendedor: datos plegados ✅ (pulido 2) |
| R11 | 🏪 | Vista previa de Mi página tapa lo que editás; deshacer plantilla | P3 | ✅ pulido 2 |
| R12 | 🏪 | Movimientos de saldo con códigos (ord_…) en vez de qué y para quién | P3 | ✅ prueba `store` ("Netflix perfil para Rodrigo Paz") |
| R13 | 🏪 | "Tu día" en Inicio (por avisar · te deben · ganaste) | P2 | ✅ idea wow |
| D1–D9 | 👔 | Números del panel, Finanzas, Proveedores, Control de revendedores, PIN/saldo, precio de revendedor | P1 | ✅ `pulido-panel.test.mjs` + navegador |
| D10 | 👔 | Cuentas: filtros de cuarentena y proveedor ≤7 días + liberar cuarentena por cuenta | P2 | ✅ (pulido 2) |
| D11 | 👔 | Revendedores activos / dormidos | P2 | ✅ |
| D12 | 👔 | Menú del celular: reordenar, "Nuevo producto" plegable | P3 | ⏳ (íconos distintos ✅) |
| D13–D15 | 👔 | Auditoría en palabras, "Tu mes" en Inicio, detalles | P3 | ✅ |
| D16 | 👔 | "Lo que te paga vs lo que cobra" cada revendedor | P3 | ⏳ idea wow |
| A1 | 🎧 | "No me entra": Reenviar accesos | P1 | ✅ |
| A2 | 🎧 | Fechas libres / aprobar revendedores / PIN a revendedores | P1 | ✅ `pulido-panel.test.mjs` |
| A3 | 🎧 | Costo editable por Atención | P2 | ✅ 403 en servidor (`pulido-seguridad`) |
| A4 | 🎧 | Fallas y avisos para Atención; buscar por número con +591 | P2 | ✅ |
| A5 | 🎧 | Cola de avisos de WhatsApp para Atención; Reubicar para Atención | P2 | ⏳ (botones ocultos por ahora) |
