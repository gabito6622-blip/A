# Decisiones (registro)

Cada decisión: fecha · qué se decidió · por qué · alternativas descartadas. Lo nuevo va arriba.

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
