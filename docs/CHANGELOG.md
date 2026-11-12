# Cambios (CHANGELOG)

Formato: fecha · versión publicada (PR) · qué cambió para cada persona. Lo nuevo va arriba.
"Sin publicar" = listo en una rama, esperando el OK del dueño.

## 2026-11-12 · Netflix: primera carga (con OK del dueño)
- **Producto nuevo «Netflix completa (alquiler revendedores)»** (`netflix-alq`): cuenta completa, 30 días, Bs 120, solo revendedores, categoría Alquiler (igual que los de Disney).
- **Revendedor nuevo «Revendedor 78230650»** (+591 78230650, lista revendedor); nombre pendiente.
- **Cuenta paphola40@gmail.com** (Netflix completa): cargada con proveedor hasta el 18/11 (autopago con tarjeta terminada en 8562, costo US$ 9) y clave pendiente. Alquilada a «Revendedor 78230650» del 07/11 al 07/12/2026, pagada Bs 120.
- **Dalster** (+591 63855044, revendedor nuevo): 3 Netflix completas (netscz106+sol, gabito6622+mer, gabito6622+01), del 07/11 al 07/12/2026, pagadas (monto por confirmar; figuran a Bs 120 c/u, el precio del producto). Claves cargadas (no se escriben acá). Fecha del proveedor: falta (quedaron con la marca «sin fecha»).
- **11 cuentas de Netflix por perfiles** (clientes finales del dueño, producto «Netflix Premium HD 4K»): gabol.apv, gabito6617+mer1, netgb115, netgb.117, netscz109, netscz.111, anarquianetflix91, gabito6617+8, n2025gt+br, n.2025jg y n.2025gt (todas @gmail.com). 5 perfiles cada una (confirmar), los 55 APARTADOS para que la tienda no venda ninguno hasta cargar los clientes. Clave y fecha del proveedor: faltan. gabol.apv: la paga con la tarjeta de la mamá (por confirmar); gabito6617+mer1: con su tarjeta. El dueño escribió «netgb.117@gmaik.com»: se cargó como @gmail.com.
- **avd2jgrb+1@gmail.com** (Disney+ sin ESPN, por perfiles para clientes finales): 7 perfiles APARTADOS; nota «🔍 SEGUIMIENTO: revisar si hay que cambiar la clave» (la secretaria lo recuerda). Clave cargada (no se escribe acá).
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
