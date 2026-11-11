# Decisiones (registro)

Cada decisión: fecha · qué se decidió · por qué · alternativas descartadas. Lo nuevo va arriba.

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
