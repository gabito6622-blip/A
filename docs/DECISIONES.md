# Decisiones (registro)

Cada decisión: fecha · qué se decidió · por qué · alternativas descartadas. Lo nuevo va arriba.

## 2026-11-12 · Cuentas pagadas en dólares
- **Qué se guarda:** el costo en US$ por mes, en la cuenta. Cada pago guarda los US$, la tasa y los Bs. Finanzas sigue sumando en Bs, que es la plata que de verdad sale.
- **Qué tasa se usa:** la del Banco Central del día, que la tienda ya trae sola, pero siempre se puede cambiar: los bancos cobran la tarjeta con su propia tasa.
- **«Próximos cobros»:** sale del día de cobro de cada cuenta. Los Bs que muestra son aproximados (con la tasa de hoy).

## 2026-11-12 · El dueño no tiene proveedor de Disney
- **Qué se cambió:** las fechas de «vence con el proveedor» de Disney venían de la importación y no significaban nada. Se cambiaron por «sin vencimiento»: la misma fecha lejana (+100 años) que el sistema ya usa para una cuenta cargada sin fecha.
- **Qué quedó afuera:** las 16 cuentas con fecha vencida y un perfil libre. Cambiarlas volvería a poner a la venta esos perfiles, y eso lo decide el dueño.
- **Cómo se hizo:** respaldo de lo tocado (id, producto, proveedor y fecha de cada cuenta, sin contraseñas), prueba con 1 cuenta, después 107 más. Antes y después se verificó que clientes, perfiles y fechas de clientes siguieran iguales.

## 2026-11-12 · Ver antes de confirmar: mismas cuentas que el servidor
- **Qué se calcula en el panel:** la fecha nueva al renovar y el perfil del «Automático», con las mismas reglas del servidor (`extend` y `reserveSlots`). Una prueba compara lo mostrado con lo que el servidor hace. Si un día cambia una regla del servidor, esa prueba avisa.
- **Lo que no cambia:** el servidor sigue decidiendo y frenando, como siempre. Renovar pide una confirmación más, con la fecha nueva, como ya hacía el Control.

## 2026-11-12 · Buscador: el servidor decide qué ve cada rol
- **Cómo busca:** lo hace el servidor (`/api/admin/search`), con el mismo permiso que la pantalla de donde sale cada cosa (Clientes, Control, Cuentas, Aprobar pagos). Así Atención no ve cuentas ni pedidos.
- **Qué devuelve:** nombre, teléfono, producto, perfil y fechas, lo justo para reconocer el resultado. Nunca contraseñas, PIN ni costos.
- **Cómo se abre cada resultado:** en su pantalla de siempre, ya filtrada. El buscador de Inicio abre este buscador, y «Ver todo en el Control» conserva lo que hacía antes, así no se pierde nada.

## 2026-11-12 · Sofi no se publica
- **Qué:** el dueño ya no necesita una secretaria a la que darle órdenes. Como nunca se publicó, se sacó de la rama con un revert, sin borrar el historial: el commit 2154083 la tiene completa por si algún día se quiere de vuelta.
- **Qué se conserva:** todo lo que vino después, incluido el menú en 6 áreas y los pendientes en Inicio.

## 2026-11-12 · Reglas para rediseñar el panel (pedido del dueño)
- **No se quita nada:** ni funciones, ni botones, ni rutas, ni permisos, ni datos. Se reubica y se mejora la forma de usarlo.
- **Antes de cada cambio grande:** respaldo verificable y una rama de prueba aparte de la que publica Railway.
- **Por etapas chicas,** cada una con pruebas funcionales, visuales y de permisos que comparan antes y después, y con una matriz que dice dónde quedó cada función de antes y qué prueba lo demuestra.
- **Sin publicar** hasta que el dueño apruebe con resultados a la vista. Si un cambio puede romper algo, se frena y se explica el riesgo.
- **Referencias de otras apps** (StreamGestor, Mercado Streaming, StreamingManager): solo como ideas de cómo se trabaja; nada copiado (regla 7).

## 2026-11-12 · Sofi, la secretaria: Claude entiende, el sistema hace
- **Qué hace Claude:** solo clasifica la orden dentro de una lista cerrada. Antes de mandarle el texto se tapan correos y números largos. No ve contraseñas, códigos ni costos.
- **Qué hace el sistema:** busca los datos reales y responde con plantillas propias. El texto libre que escriba Claude no se muestra nunca.
- **Lo que cambia algo** pasa por un plan de un solo uso que vence a los 10 minutos. Se ejecuta con las mismas funciones del panel y los permisos de quien confirma, y se audita como `assistant.command`.
- **Formas de pago:** QR y efectivo se anotan igual que en Vender. Fiado queda «Pendiente» en el Control. Los códigos siguen siendo solo del dueño.
- **Los planes viven en memoria:** si el servidor se reinicia, se repite la orden.

## 2026-11-12 · WhatsApp por QR: solo el oficial («coexistencia»)
- **Qué pidió el dueño:** un bot que se conecte por QR o por código.
- **Qué no se hace:** los conectores no oficiales. La regla 7 de `CLAUDE.md` los prohíbe, y además WhatsApp puede bloquear el número.
- **La opción oficial:** la «coexistencia» de Meta. Se usa el mismo número de WhatsApp Business y se conecta escaneando un QR desde la app. El bot y Wali responden por ese número, y la app del celular sigue funcionando.
- **Por qué no va directo en el panel:** según la página de Meta «Onboard WhatsApp Business app users», ese QR solo lo puede ofrecer un Solution Partner o un Tech Provider de Meta. Serlo exige verificar la empresa y pasar la revisión de la app.
- **Caminos posibles:** (a) que la tienda se haga Tech Provider; (b) usar un proveedor oficial que ya ofrezca coexistencia y conectar el panel; (c) un número aparte solo para el bot, con la guía que ya está en el panel. Decide el dueño (B21).

## 2026-11-11 · Mi oficina en 2D (pixel art propio)
- **Por qué 2D y no 3D:** carga rápido y gasta poca batería en celulares sencillos. El 3D no agrega nada útil. Los dibujos son propios, hechos con cuadraditos en SVG, sin imágenes de terceros.
- **Solo muestra:** no hace trabajo nuevo ni gasta Claude.
- **De dónde sale lo que muestra:**
  - Comprobantes y WhatsApp no dejaban rastro con fecha. Ahora anotan lo que hacen en `office_feed`, que va con los secretos: no está en el estado ni en las exportaciones. Se guardan como mucho 80 anotaciones de 7 días.
  - Lo del vigilante, los códigos, el reporte y el cartero se lee de lo que ya estaba guardado.
- **Qué nunca muestran los textos:** apellidos, correos de cuentas, contraseñas, códigos ni números de operación.
- **Quién la ve:** el dueño y los admin. Lo gastado en Claude lo ve solo el dueño. Atención (vendedor) no la ve.
- **La alarma de Vico** suena solo mientras no viste el aviso en Notificaciones.

## 2026-11-11 · Estudio de mercado: avisos y códigos solos
- **Por qué estos dos primero:** los 8 revendedores que respondieron eligieron "alertas automáticas de renovaciones". "Pérdida de clientes por vencimientos" y "Consulta y entrega de códigos" fueron los problemas más marcados (4 de 8 cada uno).
- **Avisos por Web Push y no por WhatsApp automático:** Web Push es gratis y no necesita la API de Meta. El celular pide el texto del aviso después de recibirlo. En `/c/` lo pide con su suscripción, porque ahí no hay sesión. Las suscripciones por link se guardan con los secretos (fuera del estado, de las exportaciones y del panel) y se borran cuando el link deja de servir. Los revendedores no reciben este aviso porque ya tienen el suyo.
- **Códigos solos:** hacen falta tres permisos a la vez: el del dueño, el del revendedor y un link vivo. Los perfiles de una misma cuenta comparten los códigos, porque es el mismo correo. Nadie ve códigos que llegaron antes de que entrara al perfil. La auditoría guarda solo ids, nunca el token, el correo ni el código.
- **Cuentas propias del revendedor:** el código se muestra solo si el correo no es de una cuenta de la tienda, si ningún otro revendedor lo tiene cargado y si el lector ya recibió algún código para ese correo.

## 2026-11-11 · Revendedores de otro país: qué va en su moneda
- **En Bs (moneda de la tienda):** saldo, compras y alquileres a la tienda, costos, y la lista de precios que arma para su página (al lado de su costo en Bs).
- **En su moneda:** lo que les cobra a sus clientes (cuaderno, Mi control, Quién me debe), el link de cobro, sus cuentas propias y lo que ve el público en `/r/<slug>`, donde lo de la tienda se convierte con su tipo de cambio, redondeado hacia arriba. Sin tipo de cambio, los productos de la tienda no salen en su página.
- **Nunca se mezclan monedas en una cifra.** Si una pantalla tiene las dos, muestra dos totales separados.
- **Teléfonos:** dos números con código de país tienen que coincidir completos. Los viejos sin código se comparan por los últimos 8 dígitos, como antes.

## 2026-11-11 · Cuentas propias del revendedor
- Se guardan aparte (`state.ownStock[revendedor]`), con permiso propio (`reseller.own_stock`). Las contraseñas se cifran con `GS_DATA_KEY` igual que las cuentas de la tienda (`own: true` en `db.ts`). Las cuentas de la tienda siguen guardándose igual que antes.
- El dueño ve solo cantidades; ni contraseñas ni clientes. Los clientes nuevos de cuentas propias no se crean como clientes de la tienda.
- **IPTV:** los datos para el cliente (servidor, app, pantallas, instrucciones) van en el producto y salen en "Mandar acceso". La prueba gratis dura de 1 a 72 h, no cuenta como venta ni deuda, y al renovarse toma el precio del producto.

## 2026-11-11 · El cliente de un revendedor renueva con su revendedor
- **Qué:** decisión del dueño, con la recomendación de Claude. Un cliente con `resellerId` no renueva su propio servicio con la tienda (FORBIDDEN en `orders.renew`). En "Mis cuentas" ve "Renovar con <revendedor>" (wa.me a su WhatsApp) y su página si está publicada (`src/store/myReseller.ts`).
- **Por qué:** la confianza de los revendedores (que la tienda no les saque clientes) y no mostrarle al cliente dos precios. El revendedor le sigue renovando desde su panel.
- **No cambia:** clientes directos. Las compras nuevas del cliente de un revendedor en la tienda siguen permitidas (no se pidió bloquearlas).

## 2026-11-11 · Seguridad y plata (equipo)
- El precio acordado del Control es de quien lo acordó. Para quien paga en dólares se anota aparte en US$ (`priceUsd`); no se reinterpreta el `price` en Bs.
- Los avisos con montos van a quien paga.
- "Cargar sus cuentas" reutiliza el alta sin cobro del importador (pedido de Bs 0, canal `import`).

## 2026-11-11 · Lista en dólares con saldo en dólares
- **Saldo en US$** (el dueño no eligió; se fue con la opción recomendada): el revendedor no gana ni pierde si se mueve la tasa. Cada movimiento lleva `cur: "USD"`.
- **Cada pedido guarda** lo cobrado en US$ (`order.usd`) y `order.total` en Bs = US$ × tasa del momento. Así Finanzas, Dashboard, Cómo van y Que vuelvan siguen en Bs sin cambios. `effectivePrice` convierte con la tasa de hoy.
- **Sin tasa,** el cliente en dólares no compra ni recarga. Tampoco se cambia de lista a otra moneda con saldo o pagos por revisar. Sin cupones ni "Armá tu combo" en dólares.
- **Alquiler de página y premio por referido** se convierten con la tasa de hoy: el cobro se redondea hacia arriba y el premio hacia abajo.
- **Detectado y arreglado:** `/api/me/renew` con "local", "usdt" o "binance" renovaba al instante sin cobrar. Ahora USDT queda esperando el comprobante y los demás se rechazan.

## 2026-11-11 · Tasa del dólar: Banco Central de Bolivia (fuente elegida por el dueño)
- **Fuente:** el tipo de cambio oficial de la portada del BCB. Se lee la tarjeta del dólar (`is-tc-oficial`: `<time datetime>` + `bcb-tco-num`), solo hasta su `</article>`, para no tomar el número del oro. Rango válido: Bs 5 a 50.
- **Cuándo:** cada 3 h. Solo se aplica cuando el BCB publica una fecha nueva, así un cambio a mano del mismo día no se pisa. "Traer ahora" fuerza la lectura.
- **Si falla:** no se toca la tasa (mejor vieja con aviso que equivocada). El error queda en el secreto `bcb:rate` y se muestra en Inicio.
- **Sin dependencias ni claves:** `fetch` simple con un User-Agent genérico.

## 2026-11-11 · Dólar flexible: tasa a mano, fijada por pedido
- **Qué:** el dueño actualiza la tasa (Inicio, un toque); se guarda `rateAt` y se avisa si tiene más de 24 h. Cada pedido o recarga en USDT guarda `usdtQuote` (USDT y tasa) al crearse; aprobar acredita lo pedido, aunque la tasa haya cambiado.
- **Recarga en USDT:** el revendedor de afuera elige USDT y el servidor calcula los Bs (no confía en el monto del navegador).
- **Por qué no automática:** Binance no tiene una tasa oficial USDT→Bs por API. Usar una página no oficial sería inventar una fuente. Si el dueño elige una fuente concreta, se puede sumar como sugerencia.

## 2026-11-11 · Pago en USDT para revendedores de afuera
- "Afuera" = su país no es Bolivia. Si la tienda acepta USDT (Pay ID o dirección + tasa), ven USDT primero y no ven el QR de Bolivia. La recarga se pide en Bs y se muestra cuánto es en USDT con la tasa de la tienda; se acredita en Bs al aprobar.
- Sin USDT configurado, nada cambia (siguen con QR o el medio de su país).

## 2026-11-11 · "Era una prueba" en vez de liberar o devolver
- **Qué:** marcar la venta como `trial` (igual que las pruebas gratis) y cerrar sus servicios, con el perfil `available` (sin cuarentena, porque nadie lo usó de verdad). Se marca la venta entera, aunque se toque desde un solo servicio, y también sus renovaciones. Si se pagó con saldo, vuelve como "refund".
- **Por qué no "Liberar perfil" ni "Devolver":** liberar deja la venta contando como plata que entró; devolver acredita saldo aunque se haya pagado en efectivo.
- **Quién:** dueño y admin (`assignment.replace`). Atención no puede.
- **Primer uso:** las 5 ventas de prueba de la tienda real (6 servicios, Bs 100), cuando se publique.

## 2026-11-11 · Cómo van cuenta los cobros del Control
- **Qué:** "lo que te pagó" = pedidos entregados + cobros marcados "pagado" en el Control. Cada marca nueva guarda `control.paidLog` (fecha, inicio del período, monto a su precio). Las marcas viejas, sin fecha, cuentan una vez en el inicio del período actual (vencimiento − duración).
- **Sin duplicar:** si el servicio tiene un pedido que cuenta a menos de 20 días del cobro marcado (o del inicio de su período), la marca no suma. Un período se anota una sola vez; volver a "pendiente" borra ese cobro.
- **Por qué no se inventa nada:** los alquileres sin marca de pago no suman, aunque estén activos. Si no está marcado, no se sabe si se cobró.
- **% contra el mes pasado:** solo si la base es al menos Bs 30. Con una base chiquita el % confunde.

## 2026-11-11 · Tanda "vender más" con 3 equipos en paralelo
- **Qué se eligió:** recuperar ventas perdidas (Que vuelvan), ver la salud de los revendedores (Cómo van) y ayudar al revendedor a cobrar (Link de cobro). Son las tres palancas de plata que no dependían de cuentas ni decisiones del dueño.
- **Que vuelvan:** usa el permiso existente `customer.manage` (dueño, admin y Atención, que manda WhatsApp a diario). Los clientes de un revendedor no aparecen: le pertenecen a él. "Escrito" oculta 7 días; "No molestar", 60. Nada se manda solo (wa.me). El tope de 7 días vale también para pedidos esperando pago.
- **Cómo van:** "lo que pagó" sale solo de pedidos entregados (venta o renovación; sin recargas, pruebas ni importados), igual que Dashboard y Finanzas, para no contar dos veces una renovación pagada con saldo. Los estados comparan 30 días contra 30 días; el ↑/↓ del mes compara contra el mes pasado a la misma altura. Es una vista propia y no una sección de Revendedores porque esa ya es larga y Atención no debe ver estos montos. Por privacidad no se muestra lo que cada revendedor cobra a sus clientes (la idea vieja D16 queda en "lo que te paga"). Las renovaciones ahora guardan el vencimiento anterior para saber si fueron a tiempo.
- **Link de cobro:** token de 192 bits guardado en el perfil repartido, con índice en memoria que se rehace si una transacción se deshace. La respuesta pública es una lista cerrada de campos y cualquier fallo da el mismo 404. Límite de 20 links inválidos por IP cada 15 min. El QR del revendedor se muestra aunque su página esté apagada (no si la tienda la bloqueó). Si la cuenta se transfiere, el link muere.
- **Transferir un alquiler borra el cuaderno del revendedor anterior** (`subs` y `rcontrol`): lo detectó el equipo del link de cobro; ya pasaba antes y rompía la separación entre revendedores. La auditoría anota cuántos perfiles se borraron.

## 2026-11-11 · Invitar revendedores: el dueño lo hace con un botón, no Claude
- **Qué:** el dueño pidió dejarlo "para hacerlo yo con un botón". La invitación queda en Inicio. Cada WhatsApp lo abre y lo manda el dueño (wa.me), nunca un envío automático.
- **Por qué no un solo toque por persona:** generar el PIN necesita esperar al servidor, y el celular bloquea abrir WhatsApp después de esa espera. Por eso son 2 toques (Generar PIN, Abrir WhatsApp), y la fila avanza sola.
- **Los 6 servicios de perfil:** los 5 de Disney comparten una sola cuenta de 7 perfiles y el de Prime es una venta de la tienda (10/11). No se pasan a cuenta completa: harían falta 5 cuentas distintas que no existen. Queda en BACKLOG B4.

## 2026-11-11 · Los alquileres son siempre cuenta completa (1 perfil, nombre fijo)
- **Qué:** cada cuenta de alquiler tiene un solo perfil, "Cuenta completa". Los perfiles libres de más se retiran (no se borran: quedan fuera de la venta) y las etiquetas viejas del Excel pasan a la nota del Control como "Excel: <etiqueta>".
- **Por qué:** el dueño lo pidió: todas son cuentas completas. Los nombres "pack"/"Perfil N" confundían y los 28 perfiles libres de más mostraban stock que no existe.
- **Aviso:** en un producto de cuenta completa, cambiar el nombre del perfil no avisa al cliente (no cambia su acceso). Así el arreglo no disparó unos 60 WhatsApp. Cambiar el PIN sigue avisando.
- **Cómo se aplicó en la tienda real:** respaldo de cuentas y servicios antes; prueba con 1 perfil (la cola de avisos siguió en 33); después todo. Resultado verificado: 123 cuentas con 1 perfil, 91 servicios activos antes y después, cola de avisos en 33.
- **No se tocó:** 2 servicios del producto "Disney" de perfil (una cuenta de 7 perfiles), porque son perfiles sueltos de verdad. Lo decide el dueño (BACKLOG B4).

## 2026-11-11 · Repartir perfiles: el cuaderno del revendedor
- **Qué:** los revendedores alquilan cuentas completas (86 alquileres reales) y reparten perfiles por fuera; casi no cargan clientes uno por uno (1 servicio). Se agrega, por cuenta alquilada, la lista de perfiles repartidos (cliente, WhatsApp, vence, precio, pago, nota). Alimenta Avisar, Quién me debe, Ganancias, Tu día y el aviso diario.
- **Privacidad:** son datos del revendedor. El dueño no los ve: las respuestas de la API al equipo se limpian (`pubAssignment` quita `subs` y `rcontrol`).
- **Descartado:** convertir cada perfil en un "cliente" del sistema (duplicaba clientes y mezclaba el fiado).

## 2026-11-11 · Los revendedores compran solo alquileres de cuentas completas
- **Qué:** con el ajuste "solo lo de revendedores", el revendedor ve y compra únicamente los productos "solo revendedores": Disney + ESPN (Bs 69), Disney sin ESPN (Bs 34), Prime Video (Bs 20) y HBO Max (Bs 15), todos alquiler mensual de cuenta completa.
- **Por qué:** es lo único que el dueño les vende; el resto del catálogo los confundía y generaba avisos de "falta precio de revendedor" sin sentido.
- **Efecto:** 3 servicios antiguos de Disney de perfil a nombre de revendedores se renuevan pidiéndolo por WhatsApp. Respaldo de productos y listas antes del cambio guardado aparte.

## 2026-11-11 · Seguridad del acceso
- **Registrarse con un correo que ya existe NO abre la cuenta** (aunque no tenga contraseña). Para ponerle clave a una cuenta existente está "Olvidé mi contraseña", que prueba que el correo es tuyo. Antes, saber el correo de un revendedor alcanzaba para entrar a su cuenta (hallazgo crítico de la auditoría, ya cerrado con prueba).
- **Un correo = una persona**: no se pueden crear dos clientes con el mismo correo.
- **Atención (rol seller) no ve costos ni proveedores** del dueño (`accountCost`, notas de cuentas, lista de proveedores). Sí ve la contraseña de la cuenta para entregarla: es su trabajo.

## 2026-11-11 · Teléfonos de Bolivia con +591 automático
- **Qué:** si alguien escribe 8 dígitos que empiezan con 6 o 7 (o 591 + 8 dígitos), se guarda como +591…; los duplicados se detectan por los últimos 8 dígitos.
- **Por qué:** así lo escribe la gente; sin el código el link de WhatsApp salía roto y el mismo cliente quedaba repetido.

## 2026-11-11 · "Renovar" solo cuando se puede
- **Qué:** si la renovación pasaría la fecha en que la cuenta vence con el proveedor, en vez del botón se muestra 🔒 "La renueva la tienda" (con aviso a la tienda). "Elegir los que vencen" deja afuera esos casos.
- **Por qué:** el botón fallaba con un error al cobrar; ahora el cliente y el revendedor saben qué pasa antes de tocar.

## 2026-11-11 · Mi control y Quién me debe siempre de acuerdo
- **Qué:** marcar "Pendiente/No pagó" en Mi control anota el fiado solo; marcar "Pagado" lo salda. "Mis ganancias" separa **vendiste por** de **ya cobraste**.
- **Por qué:** el revendedor veía números distintos en cada pantalla y ganancias que no había cobrado.

## 2026-11-11 · El botón Atrás no saca de la tienda
- **Qué:** cada pantalla de la tienda/GaboHub entra al historial del navegador; el carrito y las ventanas se cierran con Atrás.

## 2026-11-11 · Archivos comprimidos (gzip) y ETag
- **Qué:** la tienda manda JS/CSS/HTML comprimidos (shop.js baja de ~227 KB a ~66 KB) y responde 304 si el celular ya tiene la versión. Se mantiene `no-cache`: cada actualización se ve al instante.


## 2026-11-11 · Pulido de GaboHub en 4 miradas + seguridad
- **Qué:** auditar con datos ficticios desde 5 lugares (cliente que compra, revendedor, quien atiende el panel, dueño, aislamiento entre revendedores) y arreglar por impacto.
- **Por qué:** el dueño pidió "ponete en el lugar de cada uno". Separar miradas evita que un arreglo para el dueño rompa al revendedor.
- **Límite:** nada de pagos, cuentas ni mensajes reales; no se publica sin permiso del dueño.

## 2026-11-10 · Dominio propio: tienda en la portada, GaboHub en /hub
- **Qué:** con `GS_PUBLIC_ORIGIN=https://gabostore.lat`, `gabostore.lat/` lleva a la tienda, `www` redirige al dominio principal y GaboHub vive en `/hub`. El link de Railway sigue mostrando GaboHub en `/`.
- **Por qué:** el plan Hobby de Railway permite 2 dominios propios por servicio (raíz + www); los clientes finales son la mayoría del tráfico.
- **Descartado:** subdominio `hub.gabostore.lat` (necesita un 3er dominio en Railway).

## 2026-11-10 · Avisos al celular separados por persona
- **Qué:** las suscripciones de clientes/revendedores (`push_csubs`) están aparte de las del equipo (`push_subs`). Un revendedor nunca recibe avisos del panel. En la tienda publicada con https, las claves VAPID se generan solas y quedan guardadas.
- **Por qué:** privacidad y cero configuración para el dueño.

## 2026-11-10 · Fiado: una libreta por acreedor
- **Qué:** el fiado del dueño y el de cada revendedor son libretas distintas (`creditorId`). El revendedor solo anota a SUS clientes. "Mi control" del revendedor usa `rcontrol`, separado del Control del dueño.
- **Por qué:** un revendedor nunca debe ver lo que le deben a otro ni tocar el Control del dueño.

## 2026-11-10 · Fallas con estados y aviso al que reportó
- **Qué:** Recibido → Revisando → Solucionado; responde el equipo (rol `customer.manage`); al cambiar de estado se avisa al celular de quien reportó. El revendedor ve email/perfil de la cuenta de SU cliente, nunca datos internos (quién reportó, id de cuenta).

## 2026-11-10 · Mensajes por WhatsApp siempre manuales (wa.me)
- **Qué:** los avisos a clientes ("vence", "te debo", "ya quedó") se arman listos pero los manda una persona con un toque.
- **Por qué:** sin riesgo de bloqueo de número ni mensajes no deseados; el bot oficial de Meta es aparte y opcional.

## 2026-11-10 · Fechas en hora de Bolivia
- **Qué:** `TZ=America/La_Paz` en el servidor y formato con zona La Paz en el navegador; "vence en X días" cuenta días de calendario.
