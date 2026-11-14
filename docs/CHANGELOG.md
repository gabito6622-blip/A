# Cambios (CHANGELOG)

Formato: fecha · versión publicada (PR) · qué cambió para cada persona. Lo nuevo va arriba.
"Sin publicar" = listo en una rama, esperando el OK del dueño.

## 2026-11-14 · Direcciones con mayúsculas: gabostore.lat/PANEL entra al panel (**publicado el 14/11, PR #62**)
- **Por qué:** el dueño escribió `gabostore.lat/PANEL` y le salió la portada de GaboHub («Streaming hub»): solo existía `/panel` en minúsculas.
- **Qué hay ahora:** las páginas conocidas (`/panel`, `/hub`, `/tienda/`, `/revendedores`, `/tiendas`, `/codigos`, `/recuperar`, `/privacidad`, `/terminos`, `/r/<nombre>`) escritas con mayúsculas llevan a su versión en minúsculas, con lo que venga después del `?`. No toca la API, los archivos ni los links de cobro (`/c/…`), que sí distinguen mayúsculas.
- Prueba: `test/dominio.test.mjs` (2 nuevas).

## 2026-11-13 · Sin destello azul al entrar; atajos panel.gabostore.lat y hub.gabostore.lat (**publicado el 13/11, PR #61**)
- **Por qué:** el dueño veía «un destello azul al principio» al entrar a gabostore.lat. La página arrancaba con los colores de fábrica (azul `#3984ff`) y recién al llegar la configuración pasaba a su dorado (`#fcc42d`). El panel arrancaba claro con la barra del celular azul y después pasaba a oscuro.
- **Qué hay ahora:** el servidor manda la tienda, GaboHub y cada página de revendedor con sus colores ya puestos (fondo, color principal, tarjetas, botones, barra del celular y estilo de fondo). El panel arranca oscuro (su tema por defecto).
- **Atajos:** `panel.gabostore.lat` lleva a `gabostore.lat/panel` y `hub.gabostore.lat` a `gabostore.lat/hub` (andan cuando esté el comodín `*.gabostore.lat`).
- Por dentro: `src/server/earlyLook.ts` (misma cuenta de colores y contraste que `applyLook`/`lookColors` del navegador).
- Pruebas: `test/sin-destello.test.mjs` (4) y 1 más en `test/subdominios.test.mjs`.

## 2026-11-13 · gabostore.lat abre la tienda al toque, sin salto (**publicado el 13/11, PR #61**)
- **Por qué:** el dueño vio que al entrar a gabostore.lat «por un momento sale la portada de Gabo» antes de su tienda. La portada mandaba a `/tienda/` con un salto (302) y, mientras iba y volvía, el celular podía seguir mostrando otra página.
- **Qué hay ahora:** `gabostore.lat/` responde la tienda directamente (una sola carga, sin redirección). `/tienda/`, `/hub` y `/panel` siguen igual. La dirección de Railway sigue mostrando GaboHub en la portada, como antes.
- Por dentro: la página lleva `<meta name="gs-mode" content="store">` para que el navegador la arme como tienda.
- Prueba: `test/dominio.test.mjs` (portada 200 sin salto; en celular, una sola página y es la tienda).

## 2026-11-13 · Revendedores: su página en su propio subdominio (daniel.gabostore.lat) (**publicado el 13/11, PR #61**)
- **Por qué:** el dueño pidió «daniel.gabostore.lat … para que los revendedores estén cómodos»: un link corto y con su nombre es más fácil de pasar por WhatsApp que `gabostore.lat/r/dani-strem-…`.
- **Qué hay ahora:** `<nombre>.gabostore.lat` muestra la misma página que `/r/<nombre>` sin cambiar la dirección (la vista previa de WhatsApp también dice el subdominio). Si el nombre no es de una página publicada, está apagada o es reservado (api, panel, hub, www, mail…), lleva a la portada de la tienda. `/r/<nombre>` sigue andando igual.
- **Link que ve el revendedor:** «Tu dirección», «Copiar link», «Compartir», «Abrir» y el afiche usan el subdominio **solo** con `GS_SHOP_SUBDOMAINS=1` en Railway; sin esa variable siguen mostrando `/r/<nombre>`. Se prende cuando el comodín `*.gabostore.lat` tenga DNS y candado.
- Servidor: `domainRedirect` reescribe `/` del subdominio a `/r/<nombre>` y la página lleva `<meta name="gs-shop">`; `/api/settings` manda `shopDomain`. Lista de nombres reservados ampliada.
- **Elegir su nombre:** en GaboHub → Mi página → «Tu marca», el campo dice «Tu dirección (lo que va antes de .gabostore.lat)» y muestra al instante «Tu link: https://<nombre>.gabostore.lat». Lo que escribe pasa solo a minúsculas y guiones (las reglas de siempre: 3 a 30, sin repetir, sin nombres reservados). Avisa que el link viejo deja de andar si lo cambia.
- **Panel del dueño:** las tarjetas de revendedores, la tabla de páginas y los mensajes de bienvenida/guía usan el mismo link nuevo cuando el interruptor está prendido.
- Prueba nueva `test/subdominios.test.mjs` (8, una en celular eligiendo el nombre).

## 2026-11-13 · Dominio propio: gabostore.lat (**en vivo desde el 13/11, 17:57 Bolivia**)
- gabostore.lat abre la tienda Gabriel Store (la portada lleva a `/tienda/`); www.gabostore.lat lleva a gabostore.lat; GaboHub sigue en `/hub`. La dirección de Railway sigue funcionando, así que los links viejos no se rompen.
- Hecho: el dueño agregó los dos dominios en Railway y los registros en Namecheap (ALIAS `@`, CNAME `www`, dos TXT `_railway-verify`; se borraron los de Netlify). Con el token de Railway del dueño se leyeron los registros pedidos y, con los dos certificados listos, se cambió `GS_PUBLIC_ORIGIN` a `https://gabostore.lat` (antes la dirección de Railway). Ninguna otra variable se tocó.
- Los links nuevos (cobro, renovación, acceso, códigos) salen con gabostore.lat. Clientes y revendedores tienen que iniciar sesión de nuevo en la dirección nueva.

## 2026-11-13 · Atajos del dueño y de los revendedores (**publicado el 13/11, PR #61**)
Pedido del dueño: «todo eso, implementá». Siete cosas, cada una con su prueba:
- **Mi secretaria · «✅ Ya le avisé»:** un toque marca que ya le escribiste a un cliente y deja de pedírtelo. Vale para ese vencimiento (al renovar se va). Si vence mañana u hoy y el aviso fue hace 2 días o más, lo vuelve a pedir (regla «3 días antes y otra vez 1 día antes»). «↩️ No le avisé» deshace. El Control muestra «📣 Ya le avisaste el …». No manda nada ni cambia pagos o fechas.
- **Control · fila de envíos:** después de «Mover todos a otra cuenta», arriba aparece «📲 Mandar los accesos nuevos»: el mensaje de cada cliente y su botón de WhatsApp; al tocarlo pasa solo al siguiente.
- **Control · «Cobrar» con link:** con los links de renovación prendidos, «💰 Cobrar» abre «Cobro listo» con el mensaje completo y el link del cliente (paga con QR o saldo; vos solo aprobás). Con los links apagados o clientes de un revendedor, igual que antes.
- **Avisos al celular · resumen del mediodía:** una vez por día, desde las 12:00, «🗂️ Mediodía: N en cobro · N por cortar · N por avisar» que abre Mi secretaria. Sin pendientes no avisa. Se apaga en Avisos al celular. Va solo a celulares de dueño y admins.
- **Revendedores · «🔁 Que vuelvan» (en Mi día):** sus clientes a los que se les venció y no renovaron (hasta 60 días; perfiles repartidos de 31 a 90), con mensaje listo y «✅ Ya le escribí» (no lo muestra por 7 días). Plan Negocio.
- **Revendedores · «🧾 Cierre de mes» (en Mis ganancias):** este mes contra el anterior con % (sin % si el anterior no tuvo ventas o quedó incompleto), quién le pagó más y la app que más le dejó.
- **Detalles:** «Tu mes / Finanzas de noviembre 2026» (antes «nov 26», que se leía como día 26); títulos largos que ya no se cortan a 360 px; azul de los botones con contraste AA; prueba `seguridad-plata` sin falso positivo.

## 2026-11-13 · Cuentas: «↔️ Mover todos a otra cuenta» (Netflix caído → todos los clientes de una vez) (**publicado el 13/11, PR #60**, squash `693e99e`)
- **Por qué:** «se me cayó un Netflix y hoy tengo que reemplazar a toditos». «Cambiar de cuenta» mueve de a un cliente; con 5 perfiles son 5 vueltas.
- **Qué hay ahora:** en la tarjeta de la cuenta (Inventario → Cuentas), «↔️ Mover todos a otra cuenta (N)»: lista solo las cuentas de la misma plataforma con N perfiles libres o apartados; «Mover N · mismas fechas» pide confirmación y pasa a todos de una vez. Cada cliente conserva su fecha; si el perfil nuevo se llama igual (Perfil 1 → Perfil 1) se respeta, si no va al primero libre; los perfiles viejos quedan apartados; cada Control recibe la nota «↔️ fecha: de vieja a nueva». Todo o nada: si no alcanzan los perfiles, no se mueve nadie. Al terminar, el panel abre el Control filtrado por la cuenta nueva para tocar «📲 Reenviar accesos» a cada uno.
- Servidor: `POST /api/admin/accounts/:id/move-all` (`toAccountId`, `reason`), auditoría `account.move_all`.
- Prueba nueva `test/mover-cuenta-completa.test.mjs`: errores (misma cuenta, otra plataforma, perfiles insuficientes sin mover a nadie), 3 clientes movidos con fechas y notas intactas y mismo nombre de perfil, PIN nuevo en «Reenviar accesos»; navegador a 360 px.

## 2026-11-13 · Control: «↔️ Cambiar de cuenta» a una cuenta elegida, misma fecha (**publicado el 13/11, PR #59**, squash `c0e7987`)
- **Por qué:** el dueño renovó un Disney en otra cuenta y quiso pasar al cliente a ESA cuenta manteniendo su vencimiento. El panel solo tenía «Reubicar» (elige sola cualquier cuenta libre) y «Pasar a otro» (cambia de cliente, no de cuenta). No había forma de elegir el destino.
- **Qué hay ahora:** en cada tarjeta del Control (y en la tabla), «↔️ Cambiar de cuenta» lista las otras cuentas activas de la misma plataforma con perfil libre o apartado, y «Mover · misma fecha». La cuenta vieja queda apartada (no se revende sin revisar). En la nota del Control queda «↔️ dd/mm/aaaa: de correo-viejo a correo-nuevo», que lee Mi secretaria. Después, «📲 Reenviar accesos» manda los datos nuevos.
- Servidor: `POST /api/admin/assignments/:id/replace` acepta `toSlotId`; valida misma plataforma, perfil libre y cuenta activa (errores claros).
- Prueba nueva `test/cambiar-cuenta.test.mjs`: API (errores y cambio real con fecha intacta y nota) y navegador a 360 px.

## 2026-11-13 · Panel → Control: «Reenviar accesos» que no cerraba y mensaje de «Cobrar» completo (**publicado el 13/11, PR #58**, squash `576567c`)
- **Arreglo:** la tarjeta «✅ Listo para enviar» (botón «📲 Reenviar accesos») salía transparente encima de la ficha y la ✕ no hacía nada. Causa: se dibujaba fuera de la zona del tema (sin sus colores) y los botones ✕ y «Copiar todo» llevaban un atributo vacío que el código leía como «no tocado». Ahora se ve con fondo, cierra con la ✕, con Escape o tocando afuera, y «Copiar todo» copia.
- **Mejora pedida por el dueño:** el botón «💰 Cobrar» de cada alquiler arma el mensaje completo: plataforma, correo de la cuenta, perfil (si no es cuenta completa), vencimiento con los días que faltan o pasaron, y monto. Antes decía solo «tu Disney vence el … Monto …» sin el correo. El aviso al revendedor por un cliente suyo lleva los mismos datos y lo que le sale a él.
- Prueba nueva `test/panel-reenviar-accesos.test.mjs` (navegador 360 px): fondo no transparente, cierre por ✕ / Escape / afuera, copiar, y el texto del Cobrar con correo, fecha y Bs 69.

## 2026-11-13 · Códigos que llegan solos a la bandeja del revendedor (**publicado el 13/11, PR #58**, squash `576567c`)
- **Para el revendedor:** la pestaña «Códigos» y el «📩 Ver códigos» de cada cuenta se refrescan solos cada 10 segundos mientras están a la vista, igual que la página pública del link de códigos. Pide el código en la app y lo ve aparecer sin tocar «Actualizar» (el botón sigue ahí). Solo se redibuja si llegó algo nuevo, así no se borra lo que esté escribiendo; con la pestaña oculta o al irse a otra pantalla deja de consultar.
- Prueba nueva `test/codigos-refresco.test.mjs` (navegador a 360 px con reloj simulado): el código aparece solo a los 10 s en la bandeja y en «Ver códigos»; en el Inicio no se consulta más.

## 2026-11-13 · GaboHub en tres niveles: Gratis / Vendedor / Negocio (**publicado el 13/11, PR #57**, squash `6a4ad6a`)
- **Para el revendedor:** tres planes claros. **Gratis** (siempre, sin cobro): comprar con saldo, Mis cuentas, códigos, fallas, recargas y su catálogo en WhatsApp y PDF con sus precios. **Vendedor** (Bs 28): + su página con QR, combos, cupones, afiches, repartir perfiles y links de cobro. **Negocio** (Bs 49): + Mi día, Mi control, Quién me debe, Mis ganancias, el Excel y el recordatorio diario de Tito. El candado de cada pestaña dice qué plan hace falta y ofrece pasarse con el precio a la vista; el Inicio muestra en qué plan está y los otros dos.
- **Quien no paga pasa a Gratis** (después de los días de gracia) en vez de quedar «pausado»: sigue comprando y sacando su catálogo; su página y sus herramientas vuelven apenas paga. **Quien elige Gratis no debe nada y no se le cobra nunca.** Salir de Gratis cobra el mes en el momento (si no hay saldo, vence hoy y corren los días de gracia). En la prueba gratis rige Negocio.
- **Para el dueño:** en Revendedores → Ajustes el precio del Básico pasa a llamarse **Vendedor** (el Bs 28 ya cargado se respeta); en la ficha de cada revendedor el selector tiene los tres planes y avisa si hoy está en otro por falta de pago. **Con el cobro apagado (como hoy) no cambia nada para nadie: rige Negocio para todos.**
- Técnica: `planGate(revendedor, herramienta)` en el servidor decide ruta por ruta (402 `HUB_PLAN` nombra el plan; `HUB_UNPAID` si además venció); los nombres viejos `basic`/`full` se leen como Vendedor/Negocio. Pruebas nuevas en `test/gabohub-tres-niveles.test.mjs` (4) y adaptadas en `gabohub-planes` y `exportaciones`.

## 2026-11-13 · Catálogo público para clientes + «Promos y combos» con ahorro (**publicado el 13/11, PR #56**, squash)
- **El cliente baja el catálogo sin entrar:** botón «📄 Catálogo en PDF» en la portada y en el catálogo de la tienda (`/tienda`) y en la página de cada revendedor (`/r/<slug>`). Rutas públicas `GET /api/catalogo.pdf` y `GET /api/shops/:slug/catalogo.pdf` (404 si la página no existe, está apagada o bloqueada). El PDF se guarda en memoria 5 minutos por negocio y diseño, y hay límite de 12 descargas por IP cada 10 minutos. El link es fijo: se puede mandar por WhatsApp o poner en un estado y siempre baja la versión del día.
- **Las promos son los combos:** la categoría pasa a llamarse «🎁 Promos y combos» y va primera. Cada combo lleva **«Ahorrás Bs X»**, calculado con los precios de hoy (lo que suman las apps sueltas menos el combo; para el revendedor, con sus precios). En la portada: «11 promos · ahorrás hasta Bs 34». El texto de WhatsApp dice «(ahorrás Bs X)».
- Pruebas en `exportaciones`: ahorro del Dúo (Bs 5) y del Pack Familia de Ana (Bs 8); descarga pública de la tienda y de Ana (200, archivo idéntico en la segunda bajada), página inexistente 404.

## 2026-11-13 · Catálogo PDF con los logos de las apps (**publicado el 13/11, PR #56**, squash)
- El dueño vio su catálogo real y pidió los logos. Ahora cada producto lleva su logo (el de la tienda, achicado a 160 px con un reductor PNG propio en `pdf.ts` para que el archivo pese poco: el catálogo real con 35 logos pesa ~310 KB) y los combos muestran los logos de las apps que incluyen (hasta 4), que se reconocen mejor que la imagen chica del combo. Si un logo está en un formato que el PDF no acepta (WEBP), va la inicial de color.
- Los combos ya no repiten las apps dos veces cuando la descripción ya las enumera.
- La vista previa de «Mis descargas» también muestra los logos. El JSON no expone el archivo del logo, solo `hasImage`.
- Prueba: `exportaciones` sube un PNG a un producto y comprueba con `pdfimages` que la página de productos lleva imágenes incrustadas.

## 2026-11-13 · 📁 Mis descargas: Centro de exportaciones premium (**publicado el 13/11, PR #55**, squash)
Para la tienda (panel → Herramientas → 📁 Mis descargas) y para cada revendedor (GaboHub → Clientes → pestaña «📁 Mis descargas», también en Más). Una sola fuente de datos (`src/server/exportCenter.ts`): productos publicados y con precio, con la misma regla de precios que la tienda y que `/r/<slug>`. Nunca costos, ganancias, claves, correos de cuentas ni clientes.
- **📋 Catálogo para WhatsApp:** texto ordenado con nombre del negocio, categorías, productos y precios, descripción breve, combos («incluye…»), promos vigentes (Armá tu combo y cupones activos), WhatsApp para pedir, link de la tienda o de su página, horario y «los precios pueden cambiar». Copiar todo, copiar una categoría, o «Abrir WhatsApp con el mensaje» (no se manda nada). Elegir qué categorías entran.
- **📄 Catálogo PDF A4** en dos diseños, con el escritor de PDF propio (`src/server/pdf.ts`, sin dependencias): **Premium** (portada con los colores y el logo del negocio, productos por categoría en tarjetas, precios destacados, promos, «¿Cómo pedir?» con WhatsApp y link clicables, pie con fecha) y **Clásico** (blanco, letras grandes, precios claros, WhatsApp arriba de todo). Nombre del archivo con negocio, diseño y fecha.
- **📊 Excel de mi negocio** (`src/server/reportXlsx.ts` sobre `writeXlsxPro`, estilos/fórmulas/filtros/gráficos nativos): Portada con indicadores, Resumen mes a mes (gráfico de columnas), Ventas (filtro, panel fijo, total con SUM), Por producto (barras + torta), Cobros y deudas, Vencimientos, Clientes. Período: este mes, mes pasado, 30 días o fechas. Tienda: ingresos con la misma regla de `income.ts` (pedidos entregados + cobros del Control, sin duplicar), gastos y «te quedó» aparte. Revendedor: vendiste (a sus precios), le pagaste a la tienda, te quedó, su libreta, sus perfiles repartidos y sus clientes; nada de la tienda ni de otros.
- Pantalla con vista previa del catálogo antes de descargar, selector de diseño, casillas de categorías y botones grandes (compartida: `public/descargas.js`).
- API: `/api/admin/descargas/{catalogo,whatsapp,logo,catalogo.pdf,reporte.xlsx}` y las mismas bajo `/api/me/descargas/` para revendedores (catálogo también en plan Básico; Excel del plan Completo; GaboHub pausado → 402).
- Pruebas: `test/exportaciones.test.mjs` (6, con pdftotext/pdfinfo, openpyxl y navegador a 360 px), `test/pdf-writer.test.mjs` (12), `test/xlsx-pro.test.mjs` (7). `panel-ordenado` ajustada por el menú nuevo.

## 2026-11-13 · Link de cobro para todos los clientes del revendedor + recordatorio «Tu día» de Tito (**publicado el 13/11, PR #54**, squash)
- **Link de cobro para clientes registrados:** hasta hoy solo los perfiles repartidos tenían `/c/<token>`. Ahora cada fila de Mi control tiene «🔗 Link de cobro» (crear, copiar, mandar por WhatsApp, ver, cambiar). Es la misma página pública y la misma lista cerrada de campos: nombre de pila, app, vence, monto en su moneda, QR del revendedor y «Ya pagué» a su WhatsApp. Nada de la cuenta, ni costos, ni teléfono, ni ids. Lo crea solo el revendedor del cliente; muere si se revoca o si la tienda pasa el cliente a otro revendedor; sobrevive al reinicio. Guardado en `assignment.rlink` (campo opcional nuevo).
- **Los mensajes llevan el link:** «Mensaje listo» de Mi día, «Recordar renovación» y «Avisar a los que vencen» de Mi control incluyen «Mirá cuánto es y cómo pagar acá 👉 …» cuando el cliente tiene link.
- **Recordatorio matutino de Tito al revendedor:** a partir de las 9, un solo aviso «☀️ Tu día: 2 para cobrar · 1 por avisar» con los nombres y el aviso de saldo si no le alcanza para renovar; el toque abre `/hub#dia` (la pestaña Mi día). Reemplaza al «vence mañana» de siempre solo cuando hay algo en Mi día; con GaboHub pausado o plan Básico sigue el aviso anterior. Nada se manda sin que el revendedor haya activado los avisos.
- API: `POST /api/me/control/:id/link`, `POST /api/me/control/:id/link/revoke`; `GET /api/cobro/:token` resuelve también estos links. Pruebas: `test/link-cobro-clientes.test.mjs` (4).

## 2026-11-13 · «☀️ Mi día» del revendedor (**publicado el 13/11, PR #53**, squash)
- **La secretaria del dueño, para el revendedor, con las mismas fórmulas (sin agentes):** pestaña nueva «☀️ Mi día» en GaboHub → Clientes (primera del grupo Negocio) y acceso desde «Tu día» y «Tu negocio sin Excel» del Inicio. Tres grupos por cliente: **💵 Cobrar hoy** (vencidos hasta 30 días atrás o que vencen hoy), **📣 Avisar** (vencen en 1 a 3 días) y **💸 Me deben** (marcados sin pagar más lejos). Junta sus dos listas: clientes registrados (Mi control) y perfiles repartidos (Repartir perfiles). Totales en su moneda.
- **«💵 Me pagó» de un toque con vista previa:** perfil repartido que vence → corre su fecha un período y queda pagado; si no vence todavía, solo pagado. Cliente registrado → pagado en Mi control (y su libreta de Quién me debe se salda) y, si marca la casilla, **renovado con su saldo en el mismo toque** (la misma renovación de siempre: precio de su lista, freno del proveedor, saldo). Si no se puede renovar, el cobro queda anotado igual y dice por qué. Precio editable. Idempotente.
- **«💬 Mensaje listo»** por cliente: abre WhatsApp con el texto según el grupo, con el link de cobro `/c/…` de cada perfil si lo tiene, y queda marcado «Escrito ✓» en ese celular. Nada se manda solo.
- Plan Básico: Mi día es del plan Completo (como Mi control). Solo ve lo suyo: nada de otros revendedores ni de clientes directos de la tienda; sin correos ni claves.
- API: `GET /api/me/dia`, `GET /api/me/dia/preview/:id`, `POST /api/me/dia/pay/:id` (sesión de revendedor). Pruebas: `test/revendedor-mi-dia.test.mjs` (5, una en navegador).

## 2026-11-13 · Optimización 2: renovar con QR o saldo desde un link (**publicado el 13/11, PR #52**, squash; **apagado de fábrica**)
- **Interruptor** en Configuración → «Soporte y mensajes»: «Prender los links de renovación», qué puede hacer el link (solo renovar / renovar y entrar a Mis cuentas) y cuántas horas vale (48 por defecto, de 1 a 168). Apagado, nada cambia.
- **Mi secretaria:** con el interruptor prendido, cada cuenta de un cliente directo tiene «🔗 Link para renovar» (`POST /api/admin/assignments/:id/renew-link`): copia el link para pegarlo en WhatsApp. No aparece para clientes de revendedores (renuevan con su revendedor, 409).
- **Pantalla «Renovar» en la tienda** (`/tienda/#renovar=TOKEN`): muestra UN servicio (sin correo, clave ni teléfono), fecha actual, fecha nueva, precio en su moneda y saldo. «Pagar con mi saldo» renueva al instante (la plata ya entró); «Pagar con QR» crea el pedido, pide el comprobante y queda **En revisión** hasta que el dueño aprueba en Aprobar pagos, como siempre. Nunca se entrega sin plata confirmada.
- **Frenos:** fecha del proveedor (409 sin cobrar), segundo pedido por el mismo link (409), link vencido o usado (404), interruptor apagado (todos los links dejan de servir), 40 intentos por IP cada 15 min, idempotencia por llave.
- **Aviso de Tito:** con el interruptor prendido y `GS_PUBLIC_ORIGIN` cargado, el toque del aviso abre «Renovar» de ese servicio; apagado, sigue abriendo Mis cuentas. No se manda ningún mensaje nuevo.
- API pública nueva: `GET/POST /api/renovar/:token`, `POST /api/renovar/:token/evidence`, `POST /api/renovar/:token/entrar` (solo con acceso «full»).
- Pruebas nuevas: `test/renovar-link.test.mjs` (9, incluida una en navegador a 360 px). Procedimiento: `docs/PUBLICACION_Y_REVERSION.md`.

## 2026-11-13 · Optimización 1 (**publicado el 13/11, PR #52**)
- **Semáforo sin falsas alarmas:** una cuenta con todos sus perfiles dados de baja (las «caídas» que ya revisaste) o retirada deja de ser alerta roja: pastilla «⚪ Dada de baja» (`risk.inactive`). No se borra ni se retira nada; una cuenta con perfiles vivos y nota CAÍDA sigue en rojo. En la tienda real, de 34 rojas quedarían 4.
- **«💵 Me pagó» en Mi secretaria:** en cada cuenta de Cobrar / Cortar / Vencidas / Te deben / Avisar. Primero una **vista previa** (`GET /api/admin/assignments/:id/pay-preview`): cliente (y quién paga), cuenta y perfil, monto (Bs o US$), período y **fecha nueva**, fecha del proveedor, avisos. **Frena** si ese período ya figura cobrado, si hubo un cobro hace menos de 10 minutos o si la fecha nueva pasa la del proveedor. «Confirmar» (`POST …/pay`, idempotente) corre la fecha con la misma regla del Control, marca pagado con el precio (editable), anota el cobro para Finanzas (una sola vez, también si ya estaba pagado el período anterior), limpia «EN COBRO / POR CORTAR» de la nota y deja «💵 pagado dd/mm»; auditoría `secretary.paid` con la nota anterior.
- **Cierre de mes con mes anterior incompleto:** si la tienda empezó a registrar después del día 1 del mes anterior, no se muestra % (sería inventado): dice «mes anterior incompleto (datos desde dd/mm)». Los Bs sí se comparan.
- **Detalles visuales:** botón «Escribir por WhatsApp» de la FAQ a 44 px también en PC; el dibujo de los celulares de la landing de revendedores pasó de 9,5 px a 12 px (sin recortes).
- **Demo de GaboHub** (`scripts/seed-gabohub-demo.mjs` + `docs/DEMO_GABOHUB.md`): Ana en prueba, Beto en Básico, Carla en Completo con página, Paula en US$; cobro prendido solo en la demo.
- **Propuesta** `docs/PROPUESTA_RENOVACION_QR.md`: renovar con QR o saldo desde el aviso, con aprobación humana; sin activar.
- Pruebas nuevas: `test/optimizacion-1.test.mjs` (5).

## 2026-11-13 · Tienda real: apariencia «Premium 2.0» y 15 días de prueba en GaboHub (con OK del dueño)
- **Apariencia:** la tienda real pasó del estilo anterior (fondo `#172038`, dorado `#fcc42d`/`#ffd95a`, sólido, Outfit) primero al estilo «Premium 2.0 · Azul eléctrico» y, con la segunda decisión del dueño («Dale» a la mezcla), al **fondo oscuro Premium con el dorado del logo** (fondo `#070b16`, dorado `#fcc42d` / `#ffd95a`, vidrio, Outfit + Inter). El azul eléctrico queda para el panel y la oficina. Respaldo del estilo anterior guardado fuera del repo; se vuelve atrás desde Apariencia.
- **GaboHub:** `trialDays: 15`. Todo lo demás igual (Bs 49 / US$ 5, gracia 3 días, para todos, **cobro apagado**). Falta el precio del plan Básico (lo decide el dueño).

## 2026-11-13 · Premium 2.0 · Etapa 9 «Finanzas pro» (publicado el 13/11, #51)
- **Cierre de mes** (`GET /api/admin/finance/cierre?month=AAAA-MM`, dueño): para el mes elegido (12 meses para atrás, hora de Bolivia), con la **misma fuente de ingresos** que Inicio y Finanzas: entró en total y por origen (pedidos / cobros marcados en el Control), cuántas ventas, renovaciones y cobros del Control, gastos (y cuánto fue de cuentas), te quedó, estimado de cuentas sin anotar (solo el mes en curso), **comparativa con el mes anterior** (Bs y %), **quién te pagó más** (top 5, revendedor o cliente) y **apps que más dejaron**.
- **Excel del mes** (`GET /api/admin/finance/cierre.xlsx?month=…`): una hoja con todo lo anterior; queda en Auditoría como exportación.
- **Pantalla Finanzas:** tarjeta «📒 Cierre de mes» arriba, con chips de los últimos 6 meses, 4 indicadores, los dos rankings y el botón «Descargar Excel del mes». Lo demás de Finanzas no cambia.
- **Prueba nueva `test/finanzas-pro.test.mjs`** (2 pruebas).

## 2026-11-13 · Premium 2.0 · Etapa 8 «Automatización y soporte» (publicado el 13/11, #51)
- **Fallas reportadas con tiempo de espera:** cada falla dice «espera hace 2 h / 3 d» y, pasadas 24 h sin resolver, se marca ⏰ en rojo (`late`); las resueltas dicen cuánto tardaron (`waitMs`). Quien reportó también lo ve en su panel.
- **Respuestas guardadas:** chips debajo de cada falla que llenan la respuesta con un toque. El dueño las edita en Configuración → «Soporte y mensajes de la secretaria» (hasta 10, una por línea); si no hay, salen tres de ejemplo.
- **Mensajes de «Mi secretaria» editables:** cobrar/vencidas, avisar y te deben, con `{nombre}`, `{cuentas}` y `{total}`. Vacío = el texto de siempre. Siguen siendo links de WhatsApp que abre el dueño; nada sale solo.
- **Secretaria · «💳 Débitos de tarjeta»:** cuentas con autopago (la nota dice «autopago», «se debita», «tarjeta»…) que se cobran desde ayer hasta en 3 días, con el monto (US$ si lo anotaste): el recordatorio que pidió el dueño para anotar «Pagué la renovación» cuando vea el débito.
- API: `GET /api/admin/settings/soporte` (staff) y `ticketReplies` / `secretaryMsg` en `POST /api/admin/settings` (validados). El `/api/settings` público no los expone.
- **Prueba nueva `test/soporte.test.mjs`** (4 pruebas).

## 2026-11-13 · Premium 2.0 · Etapa 7 «Mi Oficina 2.0» (publicado el 13/11, #51)
- **Sala nueva (Propuesta 1 «Oficina nocturna», la aprobada):** ventanas con el cielo de La Paz según la hora, reloj, ticker «EN VIVO» con lo último que pasó, y 6 escritorios con avatar vectorial propio dentro de un anillo que cambia según el estado (cian trabajando, violeta esperando, rojo alerta, gris dormido), monitor que «corre» cuando trabaja, globito con lo último que hizo, contador «hoy» y pastilla de estado. Mismos 6: Rocío, Wali, Dani, Vico, Coco y Tito. Tocar uno sigue abriendo su detalle con prender/apagar (solo el dueño).
- **Línea de tiempo (de la Propuesta 2):** «Lo que pasó hoy» en orden, con hora y quién; si hoy no pasó nada, lo último de la semana.
- **Más eventos reales:** además de lo de los asistentes, entra **lo que hizo el dueño** desde la auditoría que ya existe: «Aprobaste el pago de Ana (Netflix)», «Rechazaste un pago de…», «Vendiste … a …», «Cambiaste la clave de una cuenta de …». Solo primer nombre y plataforma; nunca apellidos, correos, montos de costo, claves ni números de operación.
- **«Para hoy»:** tarjeta con los conteos de Mi secretaria (cobrar, cortar, vencidas sin anotar, avisar, claves por cambiar, desenlazar) y el botón para abrirla. **«Claude este mes»** con barra de uso (solo el dueño).
- **Colores de `tema.css`** (la sala es una escena: siempre oscura, también en tema claro); celular primero: 2 escritorios por fila, 3 desde 640 px; animaciones moderadas y apagadas con «menos movimiento».
- `GET /api/admin/office`: `pendientes` (conteos) y eventos `a: "owner"` en `feed`. **Prueba nueva `test/oficina-2.test.mjs`** (2 pruebas); la prueba anterior de la oficina sigue igual.

## 2026-11-12 · Premium 2.0 · Etapa 6 «GaboHub alquilable» (publicado el 13/11, #51; el cobro sigue APAGADO)
- **Prueba gratis de N días** (`shopRent.trialDays`, 0 a 90; sugerido 15): cuando el dueño prende el cobro, cada revendedor que nunca pagó arranca con esos días gratis (no se le descuenta nada); el primer cobro es al terminar. En su Inicio ve «🎁 Prueba gratis de GaboHub hasta el dd/mm». Auditoría `reseller.hub_trial`.
- **Dos planes:** Completo (todo) y Básico (`shopRent.basicPrice` / `basicPriceUsd`; sin precio Básico = un solo plan). El Básico incluye comprar, sus cuentas, códigos, recargar y vender; **no** incluye Mi control, Quién me debe, Mis ganancias ni Afiches (el servidor responde `402 HUB_PLAN` y la pantalla ofrece «Pasar al Completo»). El revendedor cambia su plan desde su Inicio (`POST /api/me/hub/plan`); el dueño, desde la tarjeta del revendedor (`POST /api/admin/resellers/:id/plan`). Sin prorrateo: el precio nuevo rige desde el próximo cobro; pasar al Completo destraba al instante. Auditoría `reseller.hub_plan`.
- **Ajustes de revendedores:** campos nuevos «Días de prueba gratis», «Plan Básico por mes» y «Plan Básico en dólares». Validación: prueba de 0 a 90 días; el Básico no puede costar más que el Completo.
- **`/api/me/shop`:** `rent` trae `plan`, `plans {basic, full}`, `trial`, `trialDays`, `lockReason` ("suspended" | "plan" | null). `chargeRents` devuelve además `trials`.
- **Nada se cobra solo mientras el cobro esté apagado** (como está hoy en la tienda real). Los números finales (Bs 49 / US$ 5 del Completo, precio del Básico, días de prueba) los decide el dueño.
- **Prueba nueva `test/gabohub-planes.test.mjs`** (3 pruebas).

## 2026-11-12 · Premium 2.0 · Etapa 5 «Tienda premium» (publicado el 13/11, #51)
- **Pedido rechazado con motivo:** al rechazar un pago, el motivo queda en el pedido (`rejectReason`) y el cliente lo ve en «Mis cuentas → Historial de pedidos» («❌ Motivo: … Si pagaste, hacé el pedido de nuevo y subí el comprobante correcto, o escribinos por WhatsApp»). El cliente final de un revendedor no ve el motivo del pago que hizo su revendedor (sigue viendo solo el estado).
- **Historial con estados de color:** Entregado (verde), En revisión (ámbar), Rechazado (rojo), lo demás gris. Los pedidos pendientes ya tenían sus pasos («Pedido → Revisando pago → Entregado») y la hora estimada.
- **Recarga guiada:** el formulario de Saldo se lee en 3 pasos: «1 · Elegí cuánto», «2 · Pagá», «3 · Subí el comprobante».
- **Botones «Copiar»** del correo y la clave: de 32 a 44 px (regla de celular).
- **Estilo «Premium 2.0 · Azul eléctrico»** en Apariencia (primero de la lista): fondo `#070b16`, azul `#3b7bff`, cian `#22d3ee`, vidrio, Outfit + Inter. **No se aplica solo**: la tienda sigue con los colores que eligió el dueño hasta que él lo toque.
- **Dashboard del panel (contraste):** el selector «7 / 30 / 90 días» pasa a tinta plena y las letras de «Resumen por servicio» van oscuras sobre un pastel del color del producto; el gris de texto del tema claro pasó de `#4f5a6b` a `#485363`. Todo ≥ 4,5:1 en claro y oscuro.
- **Prueba nueva `test/tienda-premium.test.mjs`** (4 pruebas: núcleo + navegador).

## 2026-11-12 · Premium 2.0 · Etapa 4 «Inventario inteligente» (publicado el 13/11, #51)
- **Correos de cuentas sin dobles:** al cargar o editar una cuenta, el correo se guarda sin espacios y en minúsculas, y **la misma cuenta dos veces para la misma plataforma ya no entra** (mensaje claro con el correo que ya existe). La misma dirección en otra plataforma sí puede (Disney y Netflix con el mismo Gmail). Una cuenta retirada libera el correo.
- **Aviso de dominio mal escrito:** «gmaik.com», «gmai.com», «hotmial.com»… se cargan igual, pero la respuesta trae `warning` («¿Será …@gmail.com?»). No frena.
- **Semáforo de riesgo por cuenta** (`risk` en `GET /api/admin/accounts`, pastilla 🟢/🟡/🔴 en Cuentas con los motivos): rojo = venció o vence en ≤2 días con clientes adentro, nota «CAÍDA / POR CORTAR / NO VENDER», aviso grave de la plataforma sin ver; amarillo = clave pendiente, proveedor en ≤7 días, sin fecha del proveedor con clientes, perfiles apartados, nota con «SEGUIMIENTO / cambiar clave», aviso leve sin ver, clave sin cambiar hace más de 90 días.
- **Pantalla nueva «✂️ Cortes»** (Inventario, dueño y admin; `GET /api/admin/cortes`): cuentas por perfiles con clientes que vencen en fechas distintas. Para cada una: fecha de corte sugerida (la que más se repite; si empatan, la más lejana), diferencia en días, proveedor, y por perfil cuántos días le sobran (+) o le faltan (−). No cambia nada: es para decidir. Filtro «Desalineadas / Todas».
- **«🔑 Cambié la clave»** (botón en Cuentas y en Cortes; `POST /api/admin/accounts/:id/password`): guarda la clave nueva y la fecha (`passwordChangedAt`), audita (`account.password_rotated`, sin la clave) y deja en la cola un aviso «datos actualizados» por cada cliente de esa cuenta (nada sale solo).
- **Mi secretaria:** sección nueva «🔑 Claves por cambiar»: cuentas cuya nota pide cambiar la clave o seguimiento, con cuántos clientes tienen y la última fecha de cambio; deja de pedirla 7 días después de un «Cambié la clave».
- **`costUsd` al cargar** (ya anotado en la etapa 2) y **prueba nueva `test/inventario-inteligente.test.mjs`** (5 pruebas).

## 2026-11-12 · Premium 2.0 · Etapa 3 «Panel rápido y oscuro» (publicado el 13/11, #51)
- **Inicio en una sola llamada:** `GET /api/admin/inicio` trae junto lo que antes se pedía en 6 llamadas encadenadas (alquileres, pagos por revisar, finanzas del mes, agentes, revendedores sin PIN y notificaciones). Cada parte es idéntica a su endpoint suelto; si una falla, va en `null` y lo demás se muestra igual. El admin no recibe finanzas; un cliente no entra. La pantalla pasó de 12 pedidos a 7 (los otros son la sesión, la configuración, la campanita y dos tarjetas).
- **Filtrar sin volver a pedir:** `common.js` guarda por 20 s las lecturas grandes del panel (`/api/admin/assignments`, `customers`, `products`, `price-groups`, `stock`, `suppliers`, `inicio`). Cambiar de pestaña o filtro en el Control (y en Clientes, Reubicar, etc.) vuelve a dibujar sin ir al servidor. Cualquier guardado (POST) vacía la caché, y al cambiar de pantalla también: lo que se guarda se ve al instante.
- **Oscuro por defecto (Premium):** el panel arranca en oscuro con los colores de `tema.css` (`--gs-*`, los mismos de la oficina). Quien ya había elegido claro o sistema lo conserva (queda guardado en el aparato) y el botón Claro/Oscuro/Sistema sigue igual. `html[data-gs-theme]` acompaña el tema para que las piezas comunes se pinten igual.
- **GaboHub:** sin cambios en esta etapa; su aspecto lo define el dueño en Apariencia (fondo oscuro por defecto). Un interruptor claro/oscuro personal para revendedores queda anotado en el BACKLOG.
- **Prueba nueva `test/panel-rapido.test.mjs`** (2 pruebas: API y navegador).

## 2026-11-12 · Premium 2.0 · Etapa 2 «Números que coinciden» (publicado el 13/11, #51)
- **Una sola fuente de ingresos (`src/store/income.ts`):** Inicio, Finanzas, el resumen (`/api/admin/stats`) y «Cómo van» calculan «lo que entró» con la misma regla: pedidos entregados (ventas y renovaciones) **más los cobros marcados 💵 en el Control** (sin pedido), sin recargas, sin pruebas gratis, sin lo importado de un Excel y sin contar dos veces el mismo mes. Antes Inicio y Finanzas no contaban los cobros del Control (la mayoría de los alquileres de Disney), y Finanzas sí contaba lo importado.
- **Se ve de dónde viene:** Inicio dice «Bs X marcados 💵 en el Control» bajo Ingresos y el gráfico por día tiene una barra violeta «Cobros del Control»; Finanzas lo dice en «Entró» (`delControl` por mes); el resumen trae `fromControl`.
- **Meses y días en hora de Bolivia:** los cortes de mes (Finanzas, gráfico de 12 meses, costo estimado de cuentas, gastos) y de día (gráfico por día, «vencen en 14 días», `byDay`) usan el calendario de Bolivia (UTC−4) aunque el servidor corra en otra zona horaria (`boMonthStart`, `boDayKey`… en `src/store/time.ts`).
- **Costo en dólares en la ganancia:** una cuenta pagada en US$ con la tarjeta (`costUsd`) entra al costo estimado del mes, al margen por producto y al reporte de proveedores con la tasa de hoy (`accountCostBs`). Y ahora `costUsd` se puede anotar al cargar la cuenta (`POST /api/admin/accounts`), no solo al editarla.
- **Fiado por moneda:** en la libreta del dueño, quien paga en dólares ve su deuda también en US$ (`currency`, `owedUsd`, `rate`, a la tasa de hoy; la libreta sigue en Bs) y el mensaje «Cobrar» dice «US$ 7,00 (Bs 70)».
- **Prueba nueva `test/numeros-coinciden.test.mjs`** (4 pruebas); `test/pulido-panel.test.mjs` fija la fecha de Bolivia en vez de la del proceso.

## 2026-11-12 · Premium 2.0 · Etapa 1 «Plata segura» (publicado el 13/11, #51)
- **Comprobante repetido:** si dos pedidos vivos traen la misma imagen, el segundo ya no se aprueba (error `DUPLICATE_EVIDENCE`, 409). Solo el dueño puede forzarlo, con un motivo de 4 letras o más, y queda en Auditoría («payment.approve_forced»). Si el otro pedido fue rechazado, la misma foto es un reintento y se aprueba normal. Un admin no puede forzar.
- **Referencias bancarias comparadas de verdad:** «0012-345», « 12 345 » y «12.345» son el mismo pago (se ignoran espacios, guiones, puntos, barras, mayúsculas y ceros de adelante). Se guarda como la escribieron.
- **Número de operación ya visto:** al subir un comprobante cuyo número declarado ya figura en otro pedido, queda marcado (`referenceSeenIn`) y el panel lo avisa; no bloquea, decide el dueño.
- **Recargas con monto verificado:** al aprobar una recarga, el dueño puede poner los Bs (o los US$) que de verdad llegaron; se acredita eso y queda en Auditoría («payment.amount_corrected», de → a). Límites: Bs 10 a Bs 5.000, US$ 1 a US$ 1.000.
- **Recargas sin dobles:** la tienda manda una llave por recarga (`idempotencyKey`); un doble toque crea una sola. Y no se aceptan más de 3 recargas en revisión por cliente.
- **Binance, bandeja de pagos cobrados sin entregar:** si el webhook confirma el pago pero la entrega falla (sin stock, estado raro, pedido no encontrado), el caso queda en `GET /api/admin/binance/failed` y en el panel (Aprobación), con «Reintentar» (entrega con la misma transacción, sin cobrar de nuevo) y «Descartar» con motivo (auditado). Antes solo quedaba en el registro del servidor.
- **Consentimiento de WhatsApp con fecha y origen:** cada SÍ/BAJA guarda cuándo y por dónde llegó (`registro`, `cliente`, `whatsapp`, `panel`, `revendedor`, `importado`), también en Auditoría.
- **«Enviado a mano» respeta el permiso:** un aviso que quedó «sin permiso» no se puede marcar como enviado a mano (error `NO_CONSENT`); el dueño sí, con motivo (Auditoría «outbox.sent_without_consent»).
- **Pedido sin perfil:** si al aprobar una venta no queda ningún perfil reservado y no hay stock, ya no se entrega vacía: error `OUT_OF_STOCK` con el aviso de cargar stock.
- **Prueba nueva `test/plata-segura.test.mjs`** (9 pruebas): todo lo de arriba, por el núcleo y por la API (incluido el webhook de Binance firmado con un certificado de prueba).

## 2026-11-12 · Premium 2.0 · Etapa 0 «Base segura» (publicado el 13/11, #51)
- **Tema común `public/tema.css`:** variables de marca (azul eléctrico, cian, violeta, oscuros), estados, tipografía, 44 px mínimos, radios, movimiento moderado y modo claro. Lo cargan la tienda, el panel y las páginas sueltas. Todavía no cambia el aspecto: es la base para las etapas siguientes.
- **Fuentes sin frenar el primer dibujado:** los `<link>` de Google Fonts vienen con `media="print"` y `common.js` los activa (sin JS en línea, compatible con la CSP). Sin JS, se ve con la fuente del sistema.
- **Mi oficina:** Tito ya no «salta» cada 20 s. Su evento usa la hora real del último aviso (`exp_stats.lastAt`, nuevo) o las 9 de Bolivia si no hay hora guardada; antes usaba «ahora» y la oficina se redibujaba entera en cada refresco.
- **Buscador del panel:** ya no conoce a «Sofi» (se dio de baja el 12/11); busca a los 6 de la oficina.
- **Letra mínima de 12 px:** `.mk-kpi small`, `.mk-row em/i`, `.fcard small`, `.pay small`, `.hqrow .sbtn small` (tienda y hub) y `.thsort span` (panel) pasaron de 11 a 12 px; el aviso «Sumá otro servicio» del carrito mide 44 px.
- **Prueba nueva `test/base-segura.test.mjs`:** tema cargado y fuentes no bloqueantes; Tito con hora estable; tienda a 360 px (portada, catálogo, carrito y pago) sin desborde, botones de 44 px y letra de 12 px o más.

## 2026-11-12 · Netflix: primera carga (con OK del dueño)
- **Producto nuevo «Netflix completa (alquiler revendedores)»** (`netflix-alq`): cuenta completa, 30 días, Bs 120, solo revendedores, categoría Alquiler (igual que los de Disney).
- **Revendedor nuevo «Revendedor 78230650»** (+591 78230650, lista revendedor); nombre pendiente.
- **Cuenta paphola40@gmail.com** (Netflix completa): cargada con proveedor hasta el 18/11 (autopago con tarjeta terminada en 8562, costo US$ 9) y clave pendiente. Alquilada a «Revendedor 78230650» del 07/11 al 07/12/2026, pagada Bs 120.
- **Dalster** (+591 63855044, revendedor nuevo): 3 Netflix completas (netscz106+sol, gabito6622+mer, gabito6622+01), del 07/11 al 07/12/2026, pagadas (monto por confirmar; figuran a Bs 120 c/u, el precio del producto). Claves cargadas (no se escriben acá). Fecha del proveedor: falta (quedaron con la marca «sin fecha»).
- **11 cuentas de Netflix por perfiles** (clientes finales del dueño, producto «Netflix Premium HD 4K»): gabol.apv, gabito6617+mer1, netgb115, netgb.117, netscz109, netscz.111, anarquianetflix91, gabito6617+8, n2025gt+br, n.2025jg y n.2025gt (todas @gmail.com). 5 perfiles cada una (confirmar), los 55 APARTADOS para que la tienda no venda ninguno hasta cargar los clientes. Clave y fecha del proveedor: faltan. gabol.apv: la paga con la tarjeta de la mamá (por confirmar); gabito6617+mer1: con su tarjeta. El dueño escribió «netgb.117@gmaik.com»: se cargó como @gmail.com.
- **avd2jgrb+1@gmail.com** (Disney+ sin ESPN, por perfiles para clientes finales): 7 perfiles APARTADOS; nota «🔍 SEGUIMIENTO: revisar si hay que cambiar la clave» (la secretaria lo recuerda). Clave cargada (no se escribe acá).
- **gabiti6615+big@gmail.com** (HBO Max por perfiles para clientes finales): 5 perfiles APARTADOS; clave cargada (no se escribe acá). Venció el 08/11: nota «✂️ POR CORTAR» y fecha del proveedor 08/11 (dicho por el dueño).
- **gabiti6615+h1u@gmail.com** (HBO Max por perfiles para clientes finales): 5 perfiles APARTADOS; clave cargada (no se escribe acá).
- **gabiti6615+8@gmail.com** (HBO Max por perfiles para clientes finales): 5 perfiles APARTADOS; clave cargada (no se escribe acá). Confirma que «gabiti6615» (con i) es un correo real.
- **gabito6623+max@gmail.com** (HBO Max por perfiles para clientes finales): 5 perfiles APARTADOS hasta cargar los clientes; clave cargada (no se escribe acá). Faltan fecha del proveedor y clientes.
- **gabito6619+1dest@gmail.com** (Disney+ con ESPN, por perfiles para clientes finales): igual que viex, 7 perfiles APARTADOS, nota «✂️ POR CORTAR», clave cargada (no se escribe acá).
- **gabito6626+viex@gmail.com** (Disney+ sin ESPN, por perfiles para clientes finales): cargada con 7 perfiles APARTADOS y nota «✂️ POR CORTAR» (el dueño la corta antes de usarla; la secretaria lo recuerda). Clave cargada (no se escribe acá). Faltan fecha del proveedor y clientes.
- **Clientes finales nuevos con Netflix perfil extra:** Marisel (+591 75504203, pagó Bs 50, del 10/11 al 10/12) , Ruthy (+591 60377171, pagó Bs 50, del 08/11 al 08/12; ya anotada en gabito6617+xtra@gmail.com, clave cargada) y José Antonio (+591 72717875, pagó Bs 50, del 10/11 al 10/12; ya anotado en gabito6617+xtra1@gmail.com, clave cargada, sin cobrar de nuevo: importador). Fichas creadas con nota; falta saber en qué cuenta está cada perfil extra y su correo para anotarles el servicio.

## 2026-11-12 · Panel: botón «Mi secretaria» (publicado, #50)
- **Nuevo en Inicio:** botón grande «🗂️ Mi secretaria · ¿qué hay pendiente?» (y en el menú, área Inicio). Abre una pantalla con todo lo pendiente: cobrar (nota «EN COBRO»), cortar («POR CORTAR»), vencidas sin anotar, quién debe, a quién avisar (vencen en 3 días, con la regla de la ficha de cada revendedor), cuentas por desenlazar, libres de verdad (y las que el sistema no puede vender por la fecha del proveedor), apartadas y lo que pasó en las últimas 24 horas (solo el dueño).
- **Mensaje listo:** cada revendedor trae un botón que abre WhatsApp con el texto armado (cuentas, fechas y total). Lo manda el dueño; la pantalla no envía nada ni cambia datos.
- Archivos: `src/store/secretary.ts`, `GET /api/admin/secretaria`, `public/secretaria.js`, estilos `.sec-*` en `public/panel.css`.

## 2026-11-12 · Revisión de cuentas libres (con OK del dueño)
- **Dadas de baja por caídas:** gabito6626+dan, gabito6626+fue, gabito6626+03, gabolapv+7, gabolapv+tel, opa.jg12, n2025gt+nova1, n2025gt+san, n2025gt+tm3, n2025gt+za, n2025nt+f183, netgb10+m25, netgb117+a, netgb117+ew, netgb117+gr1, netgb117+fe11, netscz107+fg, netscz108+4d, netscz108+cap, netscz108+d24, netscz108+e29, netscz108+sad, netscz108+tube, netscz108+zz1, opajg12+com14, opajg12+ma189, opajg12+mu3 y prijg002 (figuraban libres o en cuarentena). Cupo «dado de baja» y nota «⛔ CAÍDA · NO VENDER». No se borró nada.
- **gabito6626+star:** libre confirmada por el dueño, con clave nueva (no se escribe acá). Nota «✅ LIBRE oficialmente».
- **n2025gt+18dp:** revisada por el dueño: libre, con clave nueva (no se escribe acá). Se quitó la marca vieja «pagar proveedor».
- **netgb117+cd:** verificada por el dueño: libre, con clave nueva (no se escribe acá). Ojo: en el panel la fecha del proveedor figura vencida (07/07/2026); falta que el dueño diga la fecha nueva.
- **netscz107+7es:** libre confirmada por el dueño, con clave nueva (no se escribe acá). netgb117+vox2 (perfiles de la tienda) queda como está, por pedido del dueño.
- **n2025gt+ps1** (sin ESPN): la usa el dueño para sus perfiles de clientes finales. Se apartó (cuarentena) para que no se alquile; nota «👤 LA USA EL DUEÑO · NO ALQUILAR». Pendiente: cambiar la clave.
- **n2025jg+nov y n2025jg+nov3** (sin ESPN): igual que ps1, las usa el dueño para sus perfiles de clientes finales. Apartadas (cuarentena) con nota «NO ALQUILAR». Pendiente: cambiar clave y expulsar dispositivos para liberarlas.
- **netscz108+jon** (con ESPN): la usa el dueño para sus perfiles con ESPN. Apartada (cuarentena) con nota «NO ALQUILAR». Pendiente: cambiar la clave.
- **netscz108+va y netscz.101** (la .101 era de vallejos): sirven, pero el dueño debe cambiar la clave; siguen en cuarentena con esa nota. (La .101 se había dado de baja por error y el dueño lo corrigió: volvió a cuarentena.)
- **netscz108+va:** el dueño le cambió la clave (no se escribe acá): libre confirmada, sale de cuarentena y se puede vender.
- **Resultado de la revisión de libres:** quedan 15 cupos libres (7 perfiles de netgb117+vox2 + star, sem, 18dp, 7es, cd, 10m, pasa, kd3) y 6 apartados (ps1, nov, nov3, jon, va, netscz.101). Ya no hay libres sin confirmar.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · ANDROID, next y Daniel Choque
- **ANDROID · n2025gt+g** (Disney+ sin ESPN): pagada, vence 15/11, Bs 38. ANDROID no tiene número en el panel.
- **next · gabito6619+21dp:** pagada, vence 28/11, Bs 66.
- **Daniel Choque · n2025gt+dch:** cliente final; ya figuraba bien: pagada hasta el 02/03/2027 (sin cambios).
- **Con esto quedan revisadas todas las cuentas Disney alquiladas.**

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · JOSUE ORIAS, aneliz y panama
- **JOSUE ORIAS · netgb118+25** (Disney+ sin ESPN): vencía 27/10; renovada hasta el 27/11/2026, pagada Bs 40. Su teléfono en el panel tiene 9 dígitos (776115438): falta confirmarlo.
- **aneliz · gabito6619+uwb:** no pagó (venció 06/11). Nota «✂️ POR CORTAR»; entra en el recordatorio de las 19:30. Al cortarla, el dueño pasa la clave nueva y se libera. Ficha actualizada: «aneliz · Aneliz Contreras», +591 71009060.
- **panama · netgb117+op:** renovó por US$ 7; vence 11/12/2026, pagada (precio fijado en US$ 7).

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · MZA
- **MZA · Marco Antonio Zurita** (mismo número): nota «Paga Bs 35 por cuenta Disney».
- **n2025jg+nov2** (Disney+ sin ESPN, vence 24/11) y **primeairm1+3** (con ESPN, vence 27/11): pagadas a Bs 35 c/u (primeairm1+3 figuraba Bs 30).

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · EXTRANJERO
- **EXTRANJERO** (+507 6554 3461, lista en US$): nota «Paga US$ 3 por cuenta Disney+ (sin ESPN)».
- **n2025gt+nm, gabiti6615+nova y netgb10+nov:** pagó US$ 9 el 04/11 por las 3. Vencían el 02/11; ahora vencen el 03/12 (1 día de regalo), pagadas a US$ 3 c/u (antes US$ 3,50 de su lista). En nov se quitó la vieja marca «Excel: CORTAR» porque renovó.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · piza
- **piza** (+591 67327507): tuvo 5 cuentas Disney (9dp pasó a rodbol y netscz108+2 a Aracely hoy).
- **gabito6619+kd3:** vencida desde el 27/10; el dueño la cortó con clave nueva (no se escribe acá). Liberada con nota «LIBRE oficialmente … DESENLAZAR del correo de piza» (la secretaria diaria lo recuerda).
- **netscz108+nes** (vence 12/11): «🔔 EN COBRO»; el dueño ya le escribió. Si no confirma, se corta. Entra en el recordatorio de las 19:30.
- **n2022nb+rt:** se cayó del todo (sin membresía, dicho por el dueño). Se le quitó a piza (vencida desde el 30/08) y se dio de baja (cupo «dado de baja», nota «⛔ SE CAYÓ: SIN MEMBRESÍA · NO VENDER»). No se borró nada.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · MAUMAU
- **MAUMAU:** número nuevo +591 65001393 (antes +591 76221571; queda anotado en su ficha). Nota: «Paga Bs 69 por cuenta Disney».
- **gabito6619+g10:** pagada a Bs 69 (antes Bs 60), vence 27/11/2026. En el Excel figuraba con vendedor «PIZA».

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · canaviry
- **gabito6626+pasa:** vencida desde el 24/10 sin pagar; el dueño la cortó con clave nueva (no se escribe acá). Liberada: nota «LIBRE oficialmente … DESENLAZAR del correo de canaviry» (la secretaria diaria lo recuerda).
- **netgb117+cm3:** pagada a Bs 65 (antes figuraba Bs 69 sin pago); vence 19/11/2026. canaviry queda al día.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · paraguay
- **paraguay** (+595 99 294 6366, lista «Panamá y Paraguay (US$)»): nota «Paga US$ 7 por cuenta Disney, en USDT». El panel ya muestra sus cuentas en Bs con la tasa del Banco Central del día (hoy 11,70 → Bs 81,90). Tiene 8 cuentas activas; de las caídas no hay registro (el Excel solo traía las activas).
- **paraguay al día hasta el 16 y 19/11:** opajg12+br (16/11) ya figuraba pagada; netscz101+18epg y netscz101+d10 (19/11) marcadas pagadas (US$ 7 c/u, orden del dueño). Las 5 vencidas (02/11 al 10/11) esperan respuesta del dueño.
- **netgb117+sa:** renovó; vence 11/12/2026, pagada US$ 7.
- **rolljos11+8:** no la renovó (venció 10/11): nota «✂️ POR CORTAR». Al cortarla el dueño pasa la clave nueva y se libera.
- **netgb117+prem, opajg12+x13 y netscz101+pg:** renovaron con 1 día de regalo: vencen 03/12, 05/12 y 07/12/2026; pagadas US$ 7 c/u. paraguay queda con 7 cuentas pagadas y 1 por cortar.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · ARIt
- **ARIt · Aracely Sarabia Rojas** (mismo número): nota «✅ muy buena revendedora, siempre paga; a veces paga 3 o 4 por adelantado. Avisarle 3 días antes y 1 día antes».
- La secretaria (avisos de mediodía y tarde) aplica esa regla y le agrupa las cuentas en un solo mensaje.
- Sus 16 cuentas: falta que el dueño diga pagos y precio (3 vencieron el 11/11).
- **Caídas del mes pasado:** gabito6626+r19 (16/10) → reemplazada por n2025nt+tv89 (ya era de ella); netscz107+e26 (07/10, vencía 05/11) → reemplazada por netscz107+1, que estaba en cuarentena: sacada y anotada a Aracely; vence el 05/12, pagada Bs 66 (confirmado por el dueño). r19 y e26 figuran «libres»: falta que el dueño diga si están muertas o sirven. Una (opajg12+dd10) tiene una contraseña escrita en la nota del Control: se ofreció pasarla al campo protegido.
- **Diciembre pagado por adelantado:** el 07/11 pagó Bs 330 por 5 cuentas a Bs 66 c/u: netscz107+1 (05/12), netscz108+tm y netscz108+ob29 (07/12), netscz107+der3 y n2025nt+tv89 (08/12). Antes figuraban a Bs 69 (tm, ob29, der3) y Bs 65 sin pago (tv89); ahora las 5 quedan pagadas a Bs 66 con nota del pago conjunto.
- **n2025gt+f3 se cayó el 31/10:** el dueño le dio netscz108+2 en su lugar. netscz108+2 figuraba de piza (vencida 25/10, sin pagar): se pasó a Aracely, vence el 16/11 como la f3, Bs 69, pago pendiente. La f3 se liberó y quedó con la nota «⛔ SE CAYÓ el 31/10 · NO VENDER».
- **Bajas confirmadas por el dueño (12/11):** gabito6626+r19, netscz107+e26 y n2025gt+f3 (las 3 caídas de Aracely). Su cupo pasó a «dado de baja» (ya no figuran libres ni se pueden vender) y cada cuenta tiene la nota de cuándo se cayó y por cuál se reemplazó. No se borró nada: se puede volver atrás desde el panel.
- **Todo pagado salvo las vencidas (orden del dueño, 12/11):** ama, splus, bron15, netscz108+2 (16/11), rd3, disla (21/11), dj10, 5 y dd10 (28/11) marcadas pagadas con su precio de siempre (65, 66 o 69). Con las 5 de diciembre, quedan 14 pagadas.
- **jm2, mig y sp (vencieron 11/11):** «🔔 EN COBRO»; el dueño ya le avisó y cobró. Si no paga hoy, las corta esta noche. jm2 pasó de «pagado» (del mes pasado, sin registro de cobro) a «pendiente». Recordatorio de la secretaria hoy 19:30.
- **Los 9 revendedores revisados quedan pagados (orden del dueño, 12/11):** se marcaron pagadas las que faltaban: gabito6626+mana de Daniel (19/11, Bs 69), netgb117+pg19 de Robin (15/11, Bs 70) y n2025nt+za de Raúl (15/11, Bs 65). Siguen sin pagar solo las de cobro: las 3 de rodbol que debe (Bs 198, vencen 04/12), sus 3 «EN COBRO» y las 3 «EN COBRO» de Aracely.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · oby
- **oby:** nota «✅ muy buen cliente, siempre paga; sus cuentas están enlazadas a su correo».
- **5 cuentas por vencer marcadas pagadas** (nu1 13/11, c16 16/11, dis02 19/11, nu2 19/11, d2025j.g 20/11), a su precio de siempre. liz y pam ya estaban pagadas.
- **gabito6626+d27:** renovó, pagó Bs 69, vence 06/12/2026.
- **netscz108+10m:** vencida el 19/10 y no cortada a tiempo; el dueño la cortó: alquiler de oby cerrado, cuenta LIBRE oficialmente, clave nueva (no se escribe acá). Nota: «antes de darla, DESENLAZARLA del correo de oby». (Se conservó la nota vieja del Excel, que se había reemplazado por error y se restauró enseguida.) Alquileres activos 81 → 80.
- **Aviso diario (la «secretaria»)**: ahora también recuerda las cuentas a desenlazar y lista las libres confirmadas.
- **oby · Ovidio Nina Huaycho** (nombre completo).
- **opajg12+nee:** estaba en cuarentena (alquiler cerrado solo al vencer, sin anotar la renovación). Es de oby: sacada de cuarentena y cargada a él con «Cargar sus cuentas» (sin cobro como venta, sin avisos), desde 09/10, renovó 09/11, vence 09/12/2026, pagada a Bs 69 (precio de revendedor del panel; el dueño no dijo otro). Alquileres activos 80 → 81.
- **oby paga Bs 69 por cada cuenta** (dicho por el dueño): c16, nu2 y d2025j.g pasaron a Bs 69 (cobro reanotado con ese monto). Nota en su ficha: «avisarle 1 a 2 días antes».

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Yuvinka Avila Orias
- **Yuvinka Avila Orias** (antes «avila», mismo número): nota «✅ buena clienta».
- **netgb117+m2:** figuraba a oby; es de Yuvinka. Pasada a ella, vence 09/12/2026, pagada a Bs 70, clave nueva (no se escribe acá).
- **netgb117+cob1:** pagada a Bs 70; vence 06/12/2026 (el dueño la corrigió del 09/12 al 06/12).
- **rolljos11:** estaba «EN COBRO»; pagó Bs 65 (el dueño corrigió: no 69), vence 12/12/2026 (nota de cobro quitada).
- **rolljos11+2:** pagada a Bs 65, vence 25/11/2026 (confirmado por el dueño). Yuvinka queda con sus 4 cuentas pagadas.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Jhon Maykol Vidaurre
- **Jhon Maykol Vidaurre** (antes «JHON VIDAURRE», mismo número).
- **gabito6626+x91** (vence 15/11): pagada a Bs 63 (lo que pagó la última vez); renueva a Bs 63; nota «📅 avisarle el 13/11». En la cuenta: «enlazada al Gmail del revendedor: cable365b@gmail.com» (se conservó «LLENA»).
- **Aviso diario de la «secretaria»** en esta conversación, pedido por el dueño: **todos los días a las 12:24 (mediodía) y a las 17:54** (≈ 6 de la tarde; el de la tarde empieza hoy 12/11): vencen en 0–2 días, en cobro, por cortar, vencidos sin pagar, cuentas a desenlazar y libres confirmadas. Los avisos sueltos (12/11 20:00, 13/11 y 14/11 9:10) quedaron pausados porque los cubre el diario. Solo arma los mensajes; no envía nada. El dueño también puede preguntar «¿qué hay pendiente?» cuando quiera.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Raúl Parrilla
- **Raúl Parrilla** (antes «Raul PARRILLA», mismo número): nota «✅ buen cliente, paga bien».
- **gabito6619+dr** (vence 24/11): pagada a Bs 68; clave actualizada (no se escribe acá).
- **n2025nt+za** (vence 15/11): nota «📅 avisarle el 14/11»; clave actualizada.
- Avisos «datos actualizados» para Raúl: no enviados (sin permiso).

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Por cortar
- **netscz.101@gmail.com** (Disney Premium + ESPN): nota «⛔ POR CORTAR» en la cuenta. En el panel no está alquilada a nadie (su perfil quedó en cuarentena cuando venció) y no se pudo ver quién la tenía: la tenía **vallejos** (dicho por el dueño). En la ficha de vallejos: nota «⛔ NO VENDERLE por ahora: no paga y no va a renovar» (no se borró ni se bloqueó; sigue su historial).

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Dani strem
- **Dani strem:** ahora «Dani strem · Daniel Quispe Quispe», con su número +591 62505099 (no tenía).
- **gabito6626+rclad:** estaba «EN COBRO»; pagó Bs 69, vence 12/12/2026 (nota de cobro quitada).
- **netgb117+efp** (vence 14/11): pagada a Bs 69.
- **gabito6626+mana:** vence 19/11, confirmado por el dueño; sin cambios.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · robin sardan
- **robin sardan:** ahora «robin sardan · Sardana Carballo Robin» (mismo número).
- **netgb117+pg19:** se extendió al 15/12 como pagada, pero el dueño corrigió: sigue hasta el 15/11 (el pago de Bs 70 era de otra cuenta). Fecha original restaurada y cobro borrado. Antes no tenía estado de pago; el panel no permite volver a «sin estado», así que quedó «pendiente» hasta que el dueño diga si ese período está pago.
- **n2025gt+2dis:** el pago de Bs 70 del 11/11 era de esta: del 12/11 al 12/12/2026, pagada a Bs 70.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Cuentas cortadas
- **n2025gt+18dp y netscz108+sem:** el dueño las cortó en Disney (rodbol no las renovó). En el panel: alquiler cerrado (queda en el historial) y perfil libre. Clave nueva cargada en las 2 (la pasó el dueño; no se escribe acá). Libres de verdad: confirmado por el dueño; Disney Premium + ESPN, cuenta completa.
- **Ojo (dicho por el dueño):** las demás cuentas que el panel muestra «libres» no están confirmadas; hay que revisarlas una por una.
- Alquileres activos: 82 → 80. Nada más cambió; no salió ningún aviso.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Ponerse al día con Disney: canaviry
- **canaviry:** ahora «canaviry · Lizbeth Alejandra Canaviri Santa» (mismo número).
- **netscz108+dy39:** figuraba a rodbol; el dueño se la dio a canaviry. Pasada a ella, del 10/11 al 10/12/2026, Bs 70 pagada, contraseña nueva cargada (no se escribe acá).

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Ponerse al día con Disney: cabezas
- **cabezas:** ahora «cabezas · Ronnye Alberto Cabezas Mendoza» (mismo número).
- **netscz108+oby:** figuraba a rodbol; el dueño se la vendió a cabezas. Pasada a él, del 11/11 al 11/12/2026, contraseña nueva cargada (no se escribe acá). Bs 65, pagada.
- **cabezas · netscz108+r10:** pagó; vence 05/12/2026, Bs 65 (estaba vencida desde el 03/11).
- **cabezas · netscz108+cit:** pagó el período actual; vence 28/11, Bs 69. opajg12+ob2 (vence 13/11) ya figuraba pagada del mes pasado. opajg12+p29d (vence 12/11): «🔔 EN COBRO», el dueño ya le escribió; pasó de «pagado» (del mes pasado, sin registro de cobro) a «pendiente». Entra en el recordatorio de las 19:30.
- Avisos: los nuevos quedaron «no enviado (sin permiso)»; no salió ningún mensaje.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Ponerse al día con Disney: rodbol
- **rodbol:** ahora se llama «rodbol · Sandi Perasso Rodrigo Diego» (apodo + nombre completo).
- **3 cuentas** (gabito6626+8ene, netscz107+dd2, gabito6626+dmw): período del 04/11 al 04/12/2026, pendientes de pago a Bs 66 c/u (precio de ese día, dicho por el dueño): Bs 198 en total. Queda anotado en el historial de cada una.
- **2 cuentas que eran de rodbol** (gabito6619+2np, que figuraba a oby, y gabito6619+9dp, que figuraba a piza): pasadas a rodbol, del 30/10 al 30/11/2026, pagadas a Bs 66 c/u (Bs 132). Contraseña nueva cargada (dada por el dueño, no se escribe acá) y correo corregido «@gmail.cm» → «@gmail.com».
- **opajg12+7ped y opajg12+k7z** figuraban a oby: pasadas a rodbol (el dueño confirmó que son de él), sin cambiar fecha ni precio.
- **gabito6626+md1, opajg12+7ped y opajg12+k7z** (vencidas el 10/11): nota «EN COBRO desde 12/11» en el Control; si no responde hasta la noche, el dueño las corta. Fechas y pagos sin tocar.
- **n2025gt+18dp, netscz108+sem, netscz108+oby y netscz108+dy39:** NO son de rodbol, el dueño ya se las dio a otros revendedores (falta decir a quién). Se les quitó la nota «en cobro» puesta por error; quedaron como estaban.
- **3 cuentas hasta el 28/11** (opajg12+gar, opajg12+cm6, netgb117+voxg): confirmadas por el dueño y pagadas: Bs 66 las 2 con ESPN y Bs 35 la sin ESPN (cobro del período anotado con ese monto).
- **Sin cambios:** los otros alquileres. La cola sumó 4 avisos para rodbol (cuenta pasada / datos actualizados) que NO se enviaron: él no aceptó avisos automáticos.

## 2026-11-12 · #49 GaboHub etapa 5: suscripción para todos los revendedores
- **Revendedores → Ajustes:** «¿Quién paga?» (solo con página propia, como antes, o todos) y «Precio fijo en dólares» para los de afuera.
- **Se cobra sola del saldo cada 30 días.** Sin saldo: sigue todo los días de gracia; después se pausan Mi control, Quién me debe, Mis ganancias y Afiches (y su página, si tiene). Comprar, sus cuentas, los códigos, recargar y vender nunca se bloquean. Paga desde el Inicio y vuelve todo al instante.
- **El cobro sigue apagado** hasta que el dueño lo prenda.

## 2026-11-12 · #48 GaboHub etapa 4: clientes en una sola lista
- **Mis clientes:** cada cliente muestra todo lo suyo: lo comprado a la tienda, sus cuentas propias y sus perfiles de cuentas completas.
- **Clientes sueltos:** quien solo estaba en una cuenta propia o en un perfil aparece en la lista, con «➕ Guardar en mis clientes».
- **Buscador:** también por app («netflix») y por teléfono.

## 2026-11-12 · #48 GaboHub etapa 3: el negocio cuenta las cuentas propias
- **Mi control:** «📦 Tus cuentas propias que vencen», con 💬 Avisar y 🔄 Renovó.
- **Quién me debe:** «📦 Ventas propias sin pagar», con 💬 Cobrar y 💵 Me pagó. Ya no dice «Nadie te debe nada» si le deben por perfiles o por cuentas propias.
- **Mis ganancias:** «📦 Tus cuentas propias (por mes)»: clientes, cuánto cobra por mes y cuánto le deben.

## 2026-11-12 · #47 GaboHub etapa 2: Inventario por plataforma
- **Inventario (abajo) → «🗂️ Por plataforma»:** por cada app, juntos, lo que el revendedor le compró a la tienda, las cuentas completas que reparte y sus cuentas propias. Arriba, cuántos clientes tiene, cupos libres, qué vence en la semana y qué ya venció.
- **Avisos por app:** «Sin cupos libres», «vence ≤ 7 d», «vencido» y «cuenta vence con tu proveedor».
- **«Ver» en cada fila:** lleva a la pantalla de siempre (la de la tienda ya filtrada por esa app).
- **La guía de bienvenida** explica también Vender, Inventario y Más.

## 2026-11-12 · #47 GaboHub con la forma del panel del dueño (etapa 1)
- **Barra de abajo del revendedor:** Inicio · Clientes · Vender · Inventario · Más, como el panel del dueño.
- **Adiós a la fila de 10 pestañas:** «Mis clientes» se partió en 3 grupos que se ven completos: Mi negocio (clientes, control, deudas, ganancias), Inventario (cuentas de la tienda, repartir perfiles, cuentas propias) y Mi vitrina (página, combos, cupones, afiches).
- **Vender:** un botón que pregunta qué vendés y te lleva directo.
- **Más:** todo el panel en un menú por áreas, con buscador.
- **Nada se perdió:** todas las pantallas, botones y formularios de adentro son los mismos.

## 2026-11-12 · #46 Arreglo: cuentas ya vencidas en «Por plataforma»
- El grupo de Disney decía «16 vencen ≤ 7 d», pero esas 16 ya vencieron (son las cuentas caídas). Ahora dicen «16 vencidas» en rojo, y «vence ≤ 7 d» cuenta solo las que todavía no vencieron.

## 2026-11-12 · #45 Cuentas por plataforma (etapa 7)
- **Inventario → Cuentas, en el celular:** las cuentas se agrupan por plataforma (Canva, ChatGPT, Disney, Netflix…). Cada grupo dice cuántas cuentas, perfiles libres y ocupados tiene, y avisa «Sin libres» o «vence ≤ 7 d». Tocás el grupo y adentro están las mismas tarjetas de siempre, con los mismos botones.
- **«📋 Vista clásica»:** un botón vuelve a la lista de antes, una cuenta tras otra. El celular recuerda la que elegiste.
- **En la computadora no cambia nada:** sigue la tabla.

## 2026-11-12 · #45 Arreglo: renglones pisados en «Cuentas caídas»
- Con muchas cuentas de nombre largo, como las 16 de la tienda real, el texto de cada renglón se montaba sobre el de abajo. Ahora cada renglón muestra su texto completo.

## 2026-11-12 · #44 💳 Cuentas pagadas en dólares con tarjeta
- **Editar cuenta:** campo nuevo «Se cobra en dólares» (US$ por mes, opcional), para las que pagás con tarjeta de crédito.
- **«💳 Pagué la renovación»:** si la cuenta se cobra en dólares, te propone los Bs = dólares × tasa del Banco Central de hoy. Si tu banco cobró otra tasa, la cambiás. Queda anotado cuánto en dólares, con qué tasa y cuánto en Bs, y tu ganancia real en Finanzas usa esos Bs.
- **Finanzas:** «💳 Próximos cobros de tu tarjeta» de los próximos 30 días, día por día, con cuántas cuentas, cuántos US$ y cuántos Bs aproximados.
- **Las cuentas sin dólares funcionan igual que antes.**

## 2026-11-12 · #44 🧹 Cuentas caídas sin clientes
- **Inventario → Cuentas:** si hay cuentas vencidas sin nadie adentro, aparece una tarjeta con su lista, todas marcadas. Destildás las que todavía funcionan y tocás «Retirar las seleccionadas». Te pide confirmar.
- **Es la misma acción de «Cuenta caída» de cada cuenta:** no se borran, dejan de venderse y quedan en el historial. Nunca aparece una cuenta con clientes.
- **Segundo botón, «✅ Funcionan: dejarlas como propias»:** las marcadas quedan en Propias y sin vencimiento (autopay), y sus perfiles libres vuelven a la venta. Es lo mismo que «Editar» de cada cuenta.

## 2026-11-12 · Datos de la tienda real (con OK del dueño) · Cuentas de Disney sin «proveedor»
- **Qué:** las cuentas de Disney estaban bajo un «Proveedor Disney» que se creó al importar la planilla, con fechas de vencimiento de proveedor que no existen: el dueño no tiene proveedor de Disney. Por eso el sistema frenaba la renovación de 81 de 82 clientes.
- **Hecho:**
  - 108 cuentas quedaron sin vencimiento de proveedor, como las demás cuentas propias;
  - «Proveedor Disney» pasó a «Propias» (125 cuentas movidas con el botón del panel);
  - ahora ningún cliente queda frenado al renovar.
- **Sin cambios:** clientes, perfiles, fechas de los clientes, ventas, contraseñas y Finanzas.
- **Pendiente:** 16 cuentas con fecha ya vencida y un perfil libre quedaron como estaban. Si se les quita la fecha, esos 16 perfiles vuelven a estar a la venta (B22).

## 2026-11-12 · #43 Pestañas de Avisos y de Plata (etapa 6)
- **«⏰ Avisos y vencimientos»:** arriba de Recordatorios, Que vuelvan y WhatsApp → Avisos hay pestañas para ir de una a otra, más «🔴 Vencidos», que abre el Control filtrado.
- **«💰 Plata»:** arriba de Finanzas, Fiado y el Dashboard hay pestañas Caja del mes, Fiado, Reportes y Pagos por revisar.
- **Cada pestaña respeta el permiso de su pantalla:** Atención ve solo Fiado y Pagos por revisar. Ninguna pantalla cambia por dentro.

## 2026-11-12 · #42 Ver antes de confirmar (etapa 5)
- **Renovar (en la ficha y en la pantalla Renovar):** muestra «Si renovás: vence el dd/mm» y pide confirmar con «vence dd/mm → dd/mm». Si +1 período se pasaría de la fecha del proveedor, lo avisa en rojo antes de tocar (el sistema lo frena, igual que siempre).
- **Vender, opción «⚡ Automático»:** dice qué perfil y de qué cuenta le va a tocar al cliente.
- **Reemplazar:** dice cuántos perfiles libres hay de ese producto, o avisa que no hay.
- **Ninguna regla ni botón cambia:** solo se ve antes lo que después pasa.

## 2026-11-12 · #41 Ficha 360° del cliente (etapa 4)
- **Clientes:** al abrir un cliente aparece su ficha, con pestañas:
  - **Servicios:** cada uno con su vencimiento, el del proveedor, el precio y el estado de pago, y los botones «Renovar +1 período», «💵 Pagado» y «↔️ Reemplazar».
  - **Pedidos:** los últimos 8.
  - **Fallas:** las que reportó.

  Más WhatsApp y «Saldo y movimientos». Todo lo que había antes (datos, edición, PIN, saldo) sigue igual, abajo.
- **Los botones son los mismos de Renovar y del Control:** hacen exactamente lo mismo, con los mismos permisos. Atención renueva pero no reemplaza, igual que hoy.

## 2026-11-12 · #40 Buscador del panel (etapa 3)
- **Botón «🔎 Buscar» arriba,** en todas las pantallas (en la compu, también con la tecla /). Encuentra:
  - clientes y revendedores, por nombre o por los últimos números del teléfono;
  - servicios, por cliente, correo o producto;
  - cuentas, por su correo;
  - pedidos, por número o por la referencia del banco.

  Ignora tildes y mayúsculas. Cada resultado abre su pantalla de siempre, ya filtrada.
- **Inicio:** su buscador ahora abre el general; «Ver todo en el Control» hace lo mismo que antes.
- **Cada rol encuentra solo lo que ya veía:** Atención no ve cuentas ni pedidos. Nunca muestra contraseñas, PIN ni costos.

## 2026-11-12 · #39 Panel ordenado, etapas 1 y 2
- **Menú en 6 áreas + Herramientas:** Inicio, Ventas, Clientes, Inventario, Revendedores, Finanzas y Herramientas, con «🔎 Buscar pantalla». Entra completo en la pantalla del celular; antes era una lista de 31 renglones.
- **Barra de abajo:** Inicio, Clientes, Vender, Inventario y Más (Más abre todo el menú). Control de alquileres pasa a Ventas.
- **Inicio:** «📋 Lo que tenés pendiente», con lo mismo que Notificaciones; los accesos rápidos suben. No se quitó nada.
- **Ninguna pantalla se quitó:** cada una conserva su dirección (`#clave`) y sus permisos.

## 2026-11-12 · ❌ No se publica (el dueño ya no la necesita; sacada de la rama) · 🗣️ Decile qué hacer (Sofi, tu secretaria)
- **Dueño y admin:** en Inicio hay una caja para darle órdenes con tus palabras. Se puede escribir o dictar con el micrófono del teclado.
  - Busca códigos, perfiles libres, cómo está un cliente, quién debe, quién vence y los datos de una cuenta (la contraseña va detrás de «Ver contraseña»).
  - Vende, renueva y pasa perfiles, siempre después de tu «✅ Hacerlo». Después deja listo el WhatsApp con los datos para el cliente.
  - Si hay dos clientes parecidos, pregunta cuál con botones.
- **Apagada por defecto.** Se prende en Configuración → Oficina virtual o desde su escritorio en Mi oficina.
- **Mi oficina:** Sofi 🗂️ es la 7.ª integrante.

## 2026-11-11 · #38 🏢 Mi oficina
- **Dueño y admin:** nueva pantalla «🏢 Mi oficina» en el menú. Muestra a los asistentes dibujados en 2D, cada uno en su escritorio:
  - con IA: Rocío (comprobantes), Wali (WhatsApp), Dani (asistente del dueño) y Vico (vigilante);
  - gratis, sin IA: Coco (códigos) y Tito (avisos de vencimiento).
- **Qué hace cada personaje:** teclea si trabajó hace poco, duerme si está apagado y prende su alarma si encontró algo grave sin ver. El globito dice lo que hizo de verdad.
- **Más en la pantalla:**
  - la ventana muestra el cielo de La Paz según la hora;
  - un reloj;
  - «Lo que pasó hoy»;
  - lo gastado en Claude este mes (solo el dueño).
- **Tocar un personaje:** muestra qué hizo esta semana y permite prenderlo o apagarlo (solo el dueño). La pantalla se actualiza sola cada 20 s.

## 2026-11-11 · #37 Lo que pidieron los revendedores en el estudio de mercado
- **🔔 Avisarme antes de que venza:** los clientes finales, con cuenta o por su link de cobro `/c/…`, reciben solos en el celular un aviso 3 días antes, 1 día antes y el día que vence. Es gratis y no usa WhatsApp. Al cliente de un revendedor el aviso le dice "Renová con <revendedor>" y no muestra el precio de la tienda. El revendedor ve cuáles de sus clientes tienen los avisos y su mensaje de cobro invita a activarlos. El dueño ve cuántos salieron hoy (Notificaciones).
- **📩 Ver mi código de acceso:** en su link de cobro, el cliente de un revendedor ve solo el código que llegó al correo de su cuenta en los últimos 30 minutos. Funciona si la tienda y el revendedor lo permiten (los dos vienen apagados). El revendedor lo prende con un interruptor por cuenta en Repartir perfiles y en Mis cuentas propias, y ve un contador "Tus clientes vieron N códigos solos este mes". El dueño lo prende en el Panel de códigos. En Mis cuentas, "Ver códigos" muestra ahí mismo los de cada servicio.
- **Auditoría:** textos claros para lo de códigos solos.

## 2026-11-11 · #36 Flujo TV para los de afuera
- **Revendedores:** con "solo lo de revendedores" ven también los productos que tienen precio en su propia lista. Así Paraguay y Panamá ven Flujo TV a US$ 2,50. La lista general "Revendedor" no abre productos nuevos y la tienda normal no cambia.
- **Datos (tienda real):** Flujo TV US$ 2,50 en la lista "Panamá y Paraguay (US$)"; "panama" y "EXTRANJERO" pasados a Panamá 🇵🇦 (+507, US$).

## 2026-11-11 · #35 Cargar sus cuentas, seguridad y plata, renovar con su revendedor, revendedor de afuera completo
- **Dueño · "📋 Cargar sus cuentas":** en la ficha de cada revendedor pegás la lista de correos que ya le vendiste (con fecha y precio, opcionales), ves cómo queda con ✅/⚠️ y guardás todo de una. No cobra, no avisa, no duplica y no dice de quién es una cuenta ajena.
- **Seguridad:** el cliente de un revendedor ya no ve lo que pagó su revendedor (Mis pedidos, Mis cuentas, bot, avisos). Al renovar, tampoco recibe tus datos internos del Control.
- **Renovar con su revendedor:** el cliente de un revendedor ve "Renovar con <revendedor>" (su WhatsApp) y su página; ya no ve tu precio de tienda ni puede renovar directo.
- **Revendedor de afuera:** tarjeta "🌎 Mi país, moneda y tipo de cambio" en su Inicio, con aviso si le falta el tipo de cambio y un ejemplo en vivo ("Disney + ESPN te cuesta US$ 7 ≈ ₲ 51.100"). Avisos de sus cuentas propias en "Tu día" y en el aviso diario al celular (uno por día). Afiches en su moneda. Panamá en la lista de países (US$). "7.300" se lee como 7300. Celulares de Argentina con el 9 en WhatsApp.
- **Dólares:** "Te paga US$" en el Control para quienes pagan en dólares. Bot, Excel, asistente de IA, "Que vuelvan" y la ficha del revendedor hablan en US$ a quien paga en dólares.

## 2026-11-11 · #34 Lista de precios en dólares (Panamá y Paraguay)
- **Revendedores en la lista en dólares:** ven precios y saldo en US$ (Disney + ESPN US$ 7, Disney sin ESPN US$ 3,50, Prime US$ 3, HBO US$ 2), pagan con saldo o USDT (1 USDT = US$ 1) y recargan con USDT (20 USDT → US$ 20). No pierden ni ganan si se mueve el dólar en Bolivia.
- **Dueño:** sigue viendo todo en Bs, con la tasa de cada pedido. Al aprobar ve "US$ 20 (≈ Bs 234)". El dashboard separa el saldo a favor en dólares. Las listas tienen moneda; no se cambia a alguien de una lista en Bs a una en US$ si tiene saldo o pagos por revisar.
- **Arreglo de seguridad:** renovar eligiendo un medio sin pago (local, USDT, Binance) ya no renueva gratis al instante.

## 2026-11-11 · #34 Tasa del dólar del Banco Central
- **Dueño:** "🏦 Tomarla del Banco Central todos los días" en la tarjeta "💱 Tasa del USDT" de Inicio. Lee el tipo de cambio oficial del Banco Central de Bolivia (hoy Bs 11,71 del 11/11) cada 3 h y lo usa cuando hay fecha nueva. Si la cambiás a mano, se respeta hasta la próxima publicación. Si la página falla, no se toca nada y lo ves en Inicio.

## 2026-11-11 · #33 Revendedores de otro país, IPTV, USDT y revendedores cómodos
- **Revendedor de otro país (primer caso: Paraguay):** elige su país y todo se adapta: sus clientes con +595 (`0981…` → `+595981…`), sus precios a clientes en ₲ sin decimales (₲ 35.000) en el cuaderno, Mi control, Quién me debe, link de cobro y su página (con su tipo de cambio). Lo que le compra a la tienda sigue en Bs. Nunca se suman dos monedas en una cifra.
- **📦 Mis cuentas propias (todos los revendedores):** cargan sus propias cuentas (Flujo TV u otras), con contraseñas cifradas, las reparten a sus clientes, renuevan, liberan, marcan pagado, mandan el acceso por WhatsApp y el link de cobro. Para IPTV: servidor, app, pantallas e instrucciones en el mensaje, y **🎁 prueba gratis de 24 h** que pasa a venta al renovarla. El dueño solo ve cuántas tienen.
- **Dólar flexible:** "💱 Tasa del USDT" en tu Inicio para cambiarla en un toque (avisa si tiene más de 24 h). Cada pedido en USDT guarda su tasa: si la cambiás después, lo ya pedido no se mueve. Al aprobar ves "≈ X USDT a Bs Y". El revendedor de afuera recarga eligiendo 10, 20, 50 o 100 USDT y ve la tasa de hoy.
- **Pagan en USDT por Binance:** "Recargar saldo" acepta USDT (si la tienda lo configuró). Los revendedores de afuera ven USDT primero, cada precio también en USDT y no ven el QR de Bolivia.
- **Revendedores cómodos:** logos de las apps en Tu día, Mis cuentas, Repartir perfiles, Mi control, Quién me debe, Mis ganancias y el link de cobro. Vista previa al compartir completa (páginas apagadas → genérica; link de cobro siempre genérico, sin datos del cliente). Barrida a 360 px: 166 problemas → 0. La tarjeta de cada revendedor en el panel ya no se sale.

## 2026-11-11 · #33 "🧪 Era una prueba"
- **Dueño y admin:** en el Control, junto a "↩️ Devolver", el botón "🧪 Era una prueba". La venta (y sus renovaciones) sale de tus números, los perfiles vuelven libres sin cuarentena, el saldo vuelve si se pagó con saldo y no se avisa a nadie.
- **Arreglo:** Finanzas ya no cuenta como "Entró" las ventas marcadas como prueba.

## 2026-11-11 · #32 Cómo van cuenta lo que cobrás en el Control
- **Dueño:** "Te pagaron" en Cómo van ahora suma los alquileres que marcás 💵 cobrado en el Control, no solo las compras por GaboHub. Cada marca guarda fecha y monto; si te equivocás y la volvés a "pendiente", se borra. Las marcas que ya tenías cuentan en el día que empezó ese mes de alquiler. Lo que ya tiene pedido no se cuenta dos veces. Ya no aparecen porcentajes gigantes cuando el mes anterior fue casi cero.

## 2026-11-11 · #31 Vender más y revendedores que cobran mejor (3 equipos)
- **Dueño y Atención · "💸 Que vuelvan":** junta a quienes dejaron un pedido sin pagar (últimos 7 días) y a quienes se les venció un servicio hace 1 a 30 días sin renovar, con el monto de hoy y un WhatsApp listo. Fila guiada (Abrir WhatsApp → pasa al siguiente, Saltar, Anterior, 🚫 No molestar) y la cuenta de cuántos volvieron a comprar. Tarjeta en Inicio. Los clientes de tus revendedores no salen (les escribe su revendedor). A quien le escribiste no vuelve a aparecer por 7 días.
- **Dueño y admin · "📈 Cómo van tus revendedores":** lo que te pagaron este mes contra el mes pasado a la misma altura, lo que vence en 7 días, cuánto pesan tus 3 primeros, y por cada revendedor su estado (🌱 nuevo, creciendo, estable, bajando, dormido), alquileres activos, renovaciones a tiempo o tarde, alquileres caídos y un WhatsApp sugerido. Atención no lo ve.
- **Revendedor · "🔗 Link de cobro":** en Repartir perfiles, cada cliente suyo puede tener un link propio: una página con su perfil, cuándo vence, cuánto debe, el QR del revendedor y un botón "Ya pagué" que le escribe al revendedor. Se copia, se manda por WhatsApp o se cambia; los recordatorios lo incluyen. La página no muestra correos, contraseñas, costos ni otros clientes.
- **Seguridad:** al transferir un alquiler de un revendedor a otro, el nuevo dueño ya no hereda los clientes que anotó el anterior.

## 2026-11-11 · #31 Invitar revendedores desde Inicio
- **Dueño:** en Inicio aparece "📲 N revendedores todavía sin acceso" con un solo botón, "▶ Invitarlos ahora", que abre la fila de invitaciones ya armada. En la fila, al tocar "Abrir WhatsApp" pasa sola al siguiente, y hay "◀ Anterior" para volver (el PIN generado se conserva). Atención no ve la tarjeta.

## 2026-11-11 · #30 Cuentas de alquiler: todas "Cuenta completa"
- **Dueño:** las 123 cuentas de alquiler (Disney con y sin ESPN, Prime, HBO) quedaron con **un solo perfil llamado "Cuenta completa"**. Se renombraron 54 perfiles ("pack", "Pack 15", "Perfil 1", "ENLAZAR"…) y se retiraron 28 perfiles libres que sobraban, que inflaban el stock. Las 21 notas viejas del Excel quedaron guardadas en Control como "Excel: …".
- **Revendedores:** no reciben ningún aviso por esto: renombrar el perfil de una cuenta completa ya no manda "cambió tu acceso", porque el acceso no cambia. Cambiar el PIN sí sigue avisando.

## 2026-11-11 · #29 Cobro de alquileres
- **Dueño:** "💰 Cobrar alquileres de la semana" en Revendedores: por revendedor, lo que le vence en 7 días (o ya venció) con el total a su precio, y un solo WhatsApp con la lista y cómo renovar; fila guiada que marca a quién ya avisaste.
- **Revendedor:** en Repartir perfiles, "🔄 Renovar cuenta" en cada alquiler y "Renovar las N que vencen" con su saldo (con candado 🔒 cuando la tienda debe renovar primero).

## 2026-11-11 · #28 Invitar a todos y Pegar mi lista
- **Dueño:** "📲 Invitar a tus revendedores": fila guiada que genera el PIN y deja listo el WhatsApp de cada uno (con el link a /hub y cómo usar Repartir perfiles). Por defecto solo a quienes no tienen PIN; a los que ya lo tienen no se les cambia. El panel ahora sabe quién tiene PIN y cuándo entró por última vez.
- **Revendedor:** "📋 Pegar mi lista" en cada cuenta alquilada: pega su lista de WhatsApp o cuaderno (nombre, perfil, número con o sin +591, fecha "15/12" o "3 de enero", precio "Bs15"/"15bs", "debe"/"no pagó") y la revisa antes de guardar. Pegar la misma lista dos veces no duplica.

## 2026-11-11 · #27 Repartir perfiles
- **Revendedor:** nueva pestaña "🧩 Repartir perfiles": en cada cuenta completa que alquila anota quién está en cada perfil (nombre, WhatsApp, vencimiento, precio, si pagó), avisa por WhatsApp, renueva +30 días y ve si le cubre lo que le cuesta la cuenta. Se suma a Avisar, Quién me debe, Mis ganancias, Tu día y al aviso diario al celular.
- **Privacidad:** el dueño no ve estos datos (ni en pantallas ni en respuestas de la API).

## 2026-11-11 · #26 Pulido 2
- **Revendedor:** Mis cuentas con correo y contraseña plegados (la lista entra en pocas pantallas); en Mi página la vista previa ya no tapa lo que editás (botón "👀 Ver cómo queda") y se puede **deshacer** una plantilla o combinación.
- **Dueño:** botón "✅ Liberar N en cuarentena" en cada cuenta.

## 2026-11-11 · #25 Revendedores ven solo lo de revendedores
- **Dueño:** ajuste "Qué compran tus revendedores". Activado en la tienda real con 4 alquileres: Disney + ESPN (Bs 69), Disney sin ESPN (Bs 34), Prime Video cuenta completa (Bs 20) y HBO Max cuenta completa (Bs 15), todos de 30 días.

## 2026-11-11 · #24 Pulido GaboHub · ver docs/INFORME_PRUEBAS.md
- **Seguridad:** cerrado el ingreso a cuentas ajenas por correo; correos únicos; Atención sin costos ni proveedores, sin alargar fechas gratis ni aprobar revendedores.
- **Dueño:** números reales en Dashboard/Control/Inicio (precio que paga el revendedor), Finanzas con costo de cuentas estimado, Proveedores en 30 días, "Tu mes" en Inicio, avisos de precio de revendedor y de pérdida, revendedores dormidos, PIN y saldo con confirmación, auditoría en palabras.
- **Atención:** "📲 Reenviar accesos" y respuesta lista para "no me entra", búsqueda por número con espacios/+591, sin pantallas que fallan por permisos.
- **Revendedor:** "Tu día", +591 automático, Mi control en filas compactas con candado cuando la tienda debe renovar, fiado sincronizado, ganancias "vendiste/cobraste", vender fiado, combos ordenados, afiche sin agotados, movimientos de saldo legibles, barra con Clientes.
- **Cliente:** Atrás dentro de la tienda, pago solo con métodos que existen, "Tu pedido en vivo", copiar datos, acceso con número y PIN, asesor sin agotados, tienda 3,4× más liviana (gzip).

## 2026-11-10 · #23 Dominio propio
- **Todos:** gabostore.lat muestra la tienda; GaboHub en /hub; www → dominio principal; links de acceso, guías y avisos apuntan a /hub.

## 2026-11-10 · #22 Herramientas de revendedores
- **Revendedor:** Mi control (tipo Excel), Quién me debe (fiado propio), Avisar a los que vencen, Mis ganancias, QR propio en su página, renovar varios, reportar falla, avisos al celular, afiches, link de códigos, instalar como app, 6 páginas listas y 595 combinaciones.
- **Dueño/atención:** pantalla "Fallas reportadas".

## 2026-11-10 · #14–#21 Panel tipo Excel y tienda
- **Dueño:** Control de alquileres como Excel (ordenar, filtros, totales, agrupar, editar en línea), fiado, ficha del revendedor, acceso del asistente, importar con Tipo y Precio, fechas de Bolivia.
- **Cliente:** tienda tipo ticket, SEO, términos con horario, comparador de combos, combos por QR, portada con logo.

## 2026-11-10 · #5–#13 Base de la plataforma
- Celular, seguridad del navegador (CSP), cupones, avisos al celular, cobro por país, oficina virtual con Claude, ganancia real, cupones de revendedores, portada GaboHub.
