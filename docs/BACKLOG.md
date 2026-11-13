# Pendientes (BACKLOG)

Prioridad: P1 = frena ventas o es un riesgo · P2 = molesta todos los días · P3 = lindo de tener.
Estado: ⏳ pendiente · 🔧 en curso · ✅ hecho (con prueba) · 🧑 decide el dueño.
Origen: 🛒 cliente · 🏪 revendedor · 🎧 atención · 👔 dueño · 🔒 seguridad (auditoría del 11/11/2026).

- **[Baja] GaboHub: interruptor claro/oscuro personal para revendedores** (Premium 2.0, etapa 3). Hoy el aspecto del hub lo define el dueño en Apariencia; un interruptor por persona tendría que convivir con las páginas `/r/<slug>` y con `lookColors`. Anotado el 12/11.

- **[Decide el dueño] Subdominios de revendedores** (13/11). Falta: permiso para crear `*.gabostore.lat` en Railway, los registros en Namecheap, «Publicá» y la variable `GS_SHOP_SUBDOMAINS=1`. La página de Daniel (`cus_00717`) está apagada y su nombre es `dani-strem-daniel-quispe-quisp`: para `daniel.gabostore.lat` hay que prenderla y cambiar el nombre a `daniel` (el dueño decide).

- **[Decide el dueño] GaboHub: tres niveles publicados (PR #57), falta el «prendé»** (13/11). Gratis / Vendedor Bs 28 / Negocio Bs 49 ya en la tienda real con el cobro apagado. Falta: el precio del Vendedor en US$ (sugerido US$ 3; hoy los de afuera pagarían con la tasa del día), publicar, y decidir cuándo prender el cobro (con los 15 días de prueba, cada revendedor arranca en Negocio gratis).
- **[P2] Venta a mano con precio propio.** Hoy «Vender» cobra el precio de lista: Alejandra pagó Bs 27 por Flujo TV (lista Bs 25) y en Finanzas entró Bs 25 (el Control sí dice Bs 27). Agregar «precio cobrado» a la venta manual del staff (13/11).
- **[P2] «Registrar línea IPTV»: la fecha con el proveedor figura opcional,** pero sin ella la línea queda vencida y no se puede vender. Hacerla obligatoria o poner «sin fecha» por defecto (13/11).
- **[P2] Productos IPTV publicados con líneas sueltas:** MASTV y FLUJOTV están publicados; una línea cargada sin asignar puede venderla la tienda web. Al cargar líneas de clientes que ya existen, asignarlas en el mismo paso (13/11).
- **[P3] GaboHub: prorrateo al cambiar entre Vendedor y Negocio.** Hoy el cambio rige desde el próximo cobro (subir a Negocio a mitad de mes no cuesta más hasta entonces). Si se prende el cobro y alguien abusa, cobrar la diferencia proporcional.

## Decisiones del dueño
| # | Pendiente | Prioridad | Estado |
|---|---|---|---|
| B1 | Qué compran y a cuánto los revendedores | P1 | ✅ solo alquileres: Disney 69/34, Prime 20, HBO 15 |
| B2 | Precios Netflix 3m → Bs 110 y Dúo Netflix+HBO → Bs 50 | P2 | 🧑 |
| B3 | Conectar gabostore.lat (DNS en Namecheap) | P1 | 🔧 con el dueño |
| B4 | ✅ marcados como prueba en la tienda real (#33): 6 servicios, Bs 100 · 6 servicios de perfil que no son alquiler: 5 en una misma cuenta Disney (cera 100gr, rodbol ×2, Ivana, gabo) y 1 Prime (gabo). ¿Son ventas reales de perfil o pruebas? | P3 | 🧑 |
| B6 | Invitar a los 16 revendedores sin PIN | P1 | 🧑 botón "▶ Invitarlos ahora" en Inicio (publicado en #31) |
| B21 | WhatsApp oficial con su mismo número (coexistencia por QR): ¿hacerse Tech Provider de Meta, usar un proveedor oficial o un número aparte para el bot? Al conectar, pausar el bot cuando el dueño responde desde el celular | P1 | 🧑 |
| B22 | 16 cuentas de Disney caídas (vencidas, sin clientes): el dueño decidió retirarlas él | P2 | 🔧 botones publicados (#44, #45); falta que el dueño las retire o las deje como propias |
| B26 | Revisar una por una las cuentas de Disney que el panel muestra «libres»: el dueño dice que no están confirmadas (puede que alguien las tenga) | P1 | 🧑 con el dueño |
| B25 | Cuentas propias del revendedor sin costo anotado: Mis ganancias muestra lo que cobra, no la ganancia. Agregar «cuánto te cuesta» (por cuenta o por producto) para mostrar ganancia real | P3 | idea, sin empezar |
| B24 | «Revendedor Demo (prueba)» creado en la tienda real (12/11, con OK del dueño) para que vea el panel de revendedor: número inventado +591 70000099, sin clientes, saldo 0; con página propia activada (sin armar) para que pruebe el asistente de 3 pasos. Sacarlo cuando el dueño diga | P3 | 🧑 |
| B23 | Cuentas autopagables con tarjeta (Netflix y otras): cobran US$ 9 por mes cada una. Hoy no hay ninguna de Netflix cargada en el panel (12/11: 111 + 12 de Disney de alquiler, 1 de Disney+ y 1 de Prime). El dueño va a pasar la lista, separada en: clientes finales, revendedores y otros clientes. Al cargarlas, poner «Se cobra en dólares» = 9 | P1 | 🧑 esperando la lista |
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
| R3 | Link de cobro para clientes registrados + recordatorio «Tu día» de Tito: dar el OK y el «PUBLICÁ» | P1 | ✅ publicado el 13/11 (#54) |
| R4 | Centro de exportaciones (catálogo WhatsApp/PDF y Excel): dar el OK con los ejemplos y el «PUBLICÁ» | P1 | ✅ publicado el 13/11 (#55) |
| R5 | QR propio (sin librerías) dentro del catálogo PDF y en la página /c/ | P3 | ⏳ |
| R6 | Catálogo PDF con logos, catálogo público para clientes y «Promos y combos» con ahorro: el dueño dijo «agregar y publicar» (13/11) | P1 | ✅ publicado el 13/11 (#56) |
| M19 | Pruebas de navegador del hub (`hub-inventario`, `tarjeta`) fallan a veces bajo carga en la tanda completa; solas pasan. Subir tiempos de espera o esperar la condición en vez de contar | P3 | ⏳ |
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

## Estudio de mercado (11/11/2026)
| # | Pendiente | Prioridad | Estado |
|---|---|---|---|
| M1 | Avisos automáticos de vencimiento al cliente final | P1 | ✅ publicado (#37) |
| M2 | El cliente ve su código solo | P1 | ✅ publicado (#37), apagado hasta que el dueño lo prenda |
| M3 | Probar los avisos en un Android y un iPhone reales con la tienda publicada | P1 | 🧑 13/11: el servidor tiene las claves y 0 celulares del panel suscritos; el dueño tiene que tocar «Activar avisos» en su celular y «Probar» |
| M4 | Bot más automático: entrega automática y respuestas por WhatsApp oficial (necesita la API de Meta) | P2 | 🧑 |
| M5 | Que "N de tus clientes reciben avisos solos" cuente también a los clientes con cuenta del revendedor | P3 | ⏳ |
| M6 | Recordar para siempre los correos de cuentas propias que la tienda ya leyó (hoy el código deja de mostrarse si no llega ninguno en 7 días) | P3 | ⏳ |
| M7 | Precio de GaboHub: 7 de 8 pagarían Bs 60 o menos por mes (4 de ellos Bs 30 o menos) | P2 | 🔧 decidido el 12/11: Bs 49 o US$ 5 fijos, lo pagan TODOS los revendedores, sin «gratis si compra» · ✅ publicado (#49) y configurado, APAGADO: lo prende el dueño |
| M8 | Historial de conteos de avisos de más de un día | P3 | ⏳ |
| M9 | 🏢 Mi oficina: asistentes animados en 2D con lo que hacen de verdad | P3 | ✅ publicado (#38) |
| M10 | Mi oficina: aviso al celular cuando Vico prende la alarma (hoy solo en Notificaciones y en la oficina) | P3 | ⏳ |
| M11 | Sofi: medir qué tan bien entiende con Claude real y textos dictados | P2 | ❌ cancelado: Sofi no se usa (12/11) |
| M12 | Sofi: más órdenes (aprobar pagos, anotar pagos del fiado), siempre con confirmación | P3 | ❌ cancelado: Sofi no se usa (12/11) |
| M13 | Sofi: renovar por días sueltos y mensaje de WhatsApp propio para renovaciones | P3 | ❌ cancelado: Sofi no se usa (12/11) |
| M14 | 💰 Cajero: confirmar pagos con el correo del Banco Ganadero | — | ⏸️ en pausa: el dueño ya no va a usar el Ganadero (12/11) |
| M15 | Panel ordenado en 6 áreas + Herramientas (Inicio, Ventas, Clientes, Inventario, Revendedores, Finanzas): buscador global, Ficha 360°, Vender/Renovar/Reemplazar guiados, inventario por niveles. Auditoría y matriz de las 30 pantallas presentadas el 12/11; sin tocar código | P1 | ✅ aprobada · etapas 1 y 2 publicadas (#39) · etapa 3 (buscador) publicada (#40) · etapa 4 (ficha 360°) publicada (#41) · etapa 5 (ver antes de confirmar) publicada (#42) · etapa 6 (pestañas de Avisos y Plata) publicada (#43) · etapa 7 (cuentas por plataforma) publicada (#45) · arreglo «vencidas» publicado (#46) |
| M16 | Alquileres de Disney frenados por la fecha del proveedor | P2 | ✅ resuelto el 12/11: el dueño no tiene proveedor de Disney; se quitaron las fechas (ver B22 para las 16 restantes) |
| M17 | La prueba `avisos-solos` falló 1 vez por azar en una corrida completa (12/11) y otra en la CI (13/11) | P3 | ✅ causa: el token al azar del link `/c/…` a veces contiene «Bs» y la revisión de privacidad lo tomaba por un monto; ahora revisa el texto sin el token (13/11) |
| M18 | La prueba `tarjeta` (navegador, panel) falló 1 vez por tiempo de espera en una corrida completa lenta (76 s, 13/11); sola pasa. Revisar si conviene subirle el tiempo de espera | P3 | ⏳ |
| O1 | Dar el «PUBLICÁ» de Optimización 1 + 2 después de confirmar el respaldo (Configuración → Respaldos) | P1 | ✅ publicado el 13/11 (#52) |
| O2 | Prender los links de renovación (Configuración → Soporte) y elegir si solo renuevan o también entran a Mis cuentas | P2 | ✅ prendidos el 13/11 por pedido del dueño: «solo renovar», 48 h (respaldo del ajuste anterior guardado fuera del repo) |
| O3 | Mensaje de WhatsApp de la secretaria con `{link}` (hoy se copia el link y se pega a mano) | P3 | ⏳ |
| O4 | Cobros de anoche sin marcar (Araceli jm2/mig/sp, piza nes, cabezas p29d, aneliz uwb) → marcarlos con «Me pagó» cuando esté publicado | P2 | 🧑 datos del dueño |
| O5 | Clientes de las 18 cuentas por perfiles sin clientes cargados | P2 | 🧑 datos del dueño |
| O6 | Precio del plan Básico de GaboHub | P2 | ✅ 13/11: el dueño fijó Bs 28; cargado en la tienda real con respaldo del ajuste anterior; el cobro sigue apagado. Mismo día: pasa a ser el plan **Vendedor** de los tres niveles (publicado, PR #57); falta el precio en US$ |
| R1 | «Mi día» del revendedor: dar el OK con las capturas y después el «PUBLICÁ» | P1 | ✅ publicado el 13/11 (#53) |
| R2 | Que la tarjeta «Tu día» del Inicio de GaboHub cuente igual que Mi día (hoy cuenta «por avisar» con ventana de 7 días; Mi día usa 3 días + vencidos) | P3 | ⏳ |
