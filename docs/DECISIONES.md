# Decisiones (registro)

Cada decisión: fecha · qué se decidió · por qué · alternativas descartadas. Lo nuevo va arriba.

## 2026-11-14 · Dos tipos de revendedor; el bloqueo va en el servidor
- **Qué se decidió:** `Customer.trust` = sin valor («De confianza», como siempre) o `"independent"`. Los que entran por la solicitud quedan independientes; los 25 de hoy, de confianza. Lo cambia el dueño.
- **Dónde se corta:** en `visibleTo` (catálogo, precios, compras y renovaciones pasan por ahí), en la página pública, en el catálogo para descargar y en las etiquetas del directorio. Esconder botones solo no alcanza (regla de aislamiento).
- **El dueño eligió:** el independiente nunca le compra (no hay «pedir y aprobar»). Si le agarra confianza, lo pasa con un toque.
- **Si un revendedor de confianza pasa a independiente:** lo que ya tiene sigue visible hasta que venza, pero no lo puede renovar desde su panel.

## 2026-11-14 · GaboHub: inicio de 4 botones y el resto plegado
- **Qué se decidió:** el inicio del revendedor muestra solo lo de todos los días (cuentas, código, renovar, comprar) y pliega lo demás en «Todas mis herramientas».
- **Por qué:** solo 2 de 25 revendedores entraron alguna vez; el dueño contó que «ven demasiadas cosas a la vez». Lo que más hacen (mirar sus cuentas, sacar el código de Disney, renovar) estaba mezclado con página, combos, ganancias y planes.
- **Sin quitar nada:** regla del dueño. Todo sigue a un toque (plegado en el inicio) y en «Más».
- **Link de un toque sin cambiar el PIN:** «Nuevo PIN y acceso» deja afuera al revendedor hasta que le llega el PIN nuevo; para invitar a los 25 hacía falta algo que no rompa nada. El link es de un solo uso y por 24 h (lo que ya hacía el sistema), va en el `#` (WhatsApp no lo «gasta» al armar la vista previa).
- **Descartado:** un «modo simple» que se prenda o apague (dos inicios para mantener); un video (no hay cómo grabarlo sin el dueño: queda en el backlog).

## 2026-11-13 · Colores puestos por el servidor (no esconder la página)
- **Qué se decidió:** el HTML sale con las variables de color del dueño (o del revendedor) en `<html style>`, en vez de esconder la página hasta que cargue.
- **Por qué:** esconder deja la pantalla vacía más tiempo; con los colores puestos, el primer cuadro ya es el definitivo. No se puede leer la preferencia con un `<script>` en línea porque la política de seguridad (CSP) no lo permite, y un `style` sí.
- **Una sola cuenta de colores:** `earlyLook.ts` repite la de `lookColors` (contraste 4,5:1); hay una prueba que compara el resultado con el dorado real.
- **Panel:** arranca oscuro porque es el tema por defecto; quien eligió claro ve un instante oscuro (antes pasaba al revés con casi todos).
- **panel./hub. llevan a la dirección de siempre** (no sirven el panel ahí): una sola sesión y los avisos al celular quedan en un solo lugar.

## 2026-11-13 · La portada del dominio sirve la tienda, no redirige
- **Qué se decidió:** `gabostore.lat/` entrega la tienda en la misma respuesta, en vez de un 302 a `/tienda/`.
- **Por qué:** con el salto, el celular hace dos viajes y, en el medio, puede seguir viéndose la página anterior. Sin salto es más rápido y no asoma nada.
- **Descartado:** mover la tienda entera a `/` (rompería links guardados a `/tienda/`); los dos caminos quedan andando.

## 2026-11-13 · Subdominios de revendedores: servir la página, no redirigir
- **Qué se decidió:** `daniel.gabostore.lat` muestra la página directamente (por dentro, la misma ruta `/r/daniel`) en vez de mandar a `gabostore.lat/r/daniel`.
- **Por qué:** si redirige, el cliente ve la dirección larga y la vista previa de WhatsApp queda con el link largo.
- **Interruptor aparte (`GS_SHOP_SUBDOMAINS=1`) para mostrar el link nuevo:** el código puede publicarse antes de que el DNS y el certificado del comodín estén listos; mientras tanto nadie recibe un link que todavía no abre.
- **Subdominio desconocido → portada de la tienda** (no un error): quien escribe mal el nombre igual llega a Gabriel Store.
- **Descartado:** cargar un dominio por revendedor a mano en Railway (26 revendedores = 26 dominios y 26 certificados); el comodín sirve para todos.
## 2026-11-13 · Atajos: cómo se decidió cada regla
- **«Ya le avisé» vale por vencimiento, no por fecha:** se guarda para qué vencimiento fue el aviso; al renovar o cambiar la fecha deja de contar solo. Descartado: guardarlo en la nota (texto libre que hay que borrar a mano, como se hizo el 13/11 por chat).
- **Segundo aviso el día antes:** la regla de Aracely es «3 días antes y otra vez 1 día antes». Si vence mañana u hoy y el aviso tiene 2 días o más, vuelve a «por avisar». Descartado: una regla por cliente configurable (más pantallas para un caso que la regla general ya cubre).
- **«Cobrar» con link abre una tarjeta en vez de ir directo a WhatsApp:** el link se crea en el servidor al tocar; abrir WhatsApp después de esperar una respuesta lo bloquean los celulares (ventana emergente). La tarjeta muestra el mensaje y un enlace real. Con los links apagados sigue siendo un toque directo.
- **Resumen del mediodía solo a dueño y admins:** Mi secretaria no es de Atención, y el aviso nombra a quién cobrar. Salió de la revisión de aislamiento.
- **«Que vuelvan» del revendedor dentro de Mi día, no como pestaña nueva:** es parte de su rutina diaria y no suma otra entrada al menú. Ventanas: 60 días para clientes registrados (igual criterio que el dueño, más largo porque el revendedor tiene pocos) y 31 a 90 para perfiles repartidos (hasta 30 ya los muestra «Para cobrar»).
- **Cierre de mes sin % inventados:** igual que el cierre del dueño; si el mes anterior no tuvo ventas o fue su primer mes (incompleto), se dice y no se calcula %.

## 2026-11-13 · Tres niveles de GaboHub, cortados por «lo que vende» y «lo que ahorra trabajo»
- **Qué se decidió:** Gratis / Vendedor (Bs 28) / Negocio (Bs 49). El dueño preguntó si Básico/Completo estaba bien cortado o hacían falta tres; aprobó los tres («Ok»).
- **Por qué:** lo que hace que el revendedor **venda más** (y le compre más a la tienda) conviene regalarlo o cobrarlo barato: comprar, catálogo, su página. Lo que le **ahorra horas de administración** (Mi día, Mi control, Quién me debe, Ganancias, Excel, Tito) es lo que de verdad vale una cuota. Además, el «pausado por falta de pago» ya era un plan gratis de hecho: ahora se llama así y no asusta.
- **Sin pagar = Gratis, no «bloqueado»:** el revendedor que no paga sigue siendo cliente de la tienda (compra, saca su catálogo). Se le apaga la página y la oficina, no el negocio.
- **Salir de Gratis se cobra en el momento** para que nadie use un plan pago 30 días y vuelva a Gratis antes del cobro. Entre Vendedor y Negocio el cambio sigue rigiendo desde el próximo cobro (sin prorrateo), como antes.
- **Compatibilidad:** `hubPlan` acepta los nombres viejos y `basicPrice` se lee como `sellerPrice`, así el Bs 28 ya cargado en la tienda real pasa a ser el Vendedor sin tocar datos. Con el cobro apagado rige Negocio para todos.
- **Descartado:** cobrar prorrateo al cambiar de plan (más reglas que explicar por Bs 20 de diferencia); poner el catálogo en el plan Vendedor (el catálogo es lo que más le ayuda a vender, y vender es lo que más le conviene a la tienda).

## 2026-11-13 · Catálogo público: el mismo archivo, sin sesión, con freno
- **Mismo generador, mismos datos públicos:** el catálogo público usa `catalogData` con un actor interno de solo lectura; lo que sale es lo mismo que ve cualquiera en la tienda (productos publicados, precios públicos, promos activas). Nada que no esté ya en la vitrina.
- **Memoria de 5 minutos y límite por IP:** un PDF con 35 logos tarda un instante en armarse, pero si lo comparten en un estado lo pueden bajar cientos de personas seguidas. Se arma una vez cada 5 minutos por negocio y diseño; 12 bajadas por IP cada 10 minutos cortan a quien lo use de travesura.
- **«Promos y combos» con ahorro calculado:** el dueño pidió qué decir cuando le preguntan «¿cuáles son tus promos?». El ahorro se calcula con los precios de hoy y no se copia de la descripción, así nunca queda un número viejo.

## 2026-11-13 · Centro de exportaciones: sin librerías, una sola fuente, nada privado
- **PDF y Excel propios, sin dependencias:** el proyecto no tiene librerías de terceros y la imagen de producción no trae Chromium. Se escribió un PDF 1.4 mínimo (Helvetica estándar con tabla de anchos, WinAnsi, formas, PNG/JPEG, links) y se amplió el escritor de Excel con estilos, fórmulas, filtros y gráficos DrawingML. Los dos se verifican con herramientas externas en las pruebas (poppler, openpyxl, LibreOffice), pero en producción no hacen falta.
- **Una sola fuente de datos para los tres formatos** (`catalogData`): la vista previa, el texto de WhatsApp y el PDF salen de lo mismo, así no pueden mostrar precios distintos. Los precios del revendedor son los de su página (`resellerPrices` + `toMine`); los de la tienda, los públicos. Emojis solo en WhatsApp (el PDF usa Helvetica, sin emojis).
- **Ingresos ≠ ganancia, explícito en el archivo:** la portada del Excel dice qué es cada indicador; la tienda ve ingresos (regla de `income.ts`, sin duplicar) y gastos aparte; el revendedor ve «vendiste», «le pagaste a la tienda» y «te quedó». Un revendedor de otro país no ve una resta entre monedas.
- **Qué nunca sale:** correos y claves de cuentas, costos de la tienda en el archivo del revendedor, otros revendedores, ids internos. El Excel del dueño tampoco lleva correos de cuentas (si lo comparte con un contador, no filtra accesos).
- **Catálogo para todos, Excel para el plan Completo:** el catálogo es la vidriera del revendedor y sirve aunque esté en Básico; el reporte usa Mi control y Mis ganancias, que ya eran del Completo.
- **QR dentro del PDF: todavía no.** El dueño pidió «enlace o QR cuando sea útil»; va el link clicable y el WhatsApp. Un generador de QR propio queda anotado como mejora.

## 2026-11-13 · Un solo tipo de link de cobro, para dos tipos de cliente
- **Misma página, misma lista cerrada:** el link de los clientes registrados reutiliza `/c/<token>` y `publicView` en vez de una página nueva. Así lo que ya se auditó (sin correo, sin clave, sin teléfono, sin costos, sin ids) vale igual para los dos casos, y Tito, el QR, el logo y los avisos del link funcionan sin código aparte.
- **El token vive en el alquiler (`rlink`), no en el cliente:** un cliente puede tener varias cuentas con precios y fechas distintas; el link es por servicio, como en los perfiles repartidos.
- **El link muere si el cliente cambia de revendedor:** se comprueba `c.resellerId === rlink.by` en cada apertura. Nunca se muestran datos a nombre de otro.
- **Un solo aviso a la mañana:** el recordatorio «Tu día» reemplaza al «vence mañana» cuando Mi día tiene algo, en vez de sumarse: dos avisos seguidos se ignoran. Si el revendedor no tiene Mi día (Básico o pausado), vuelve el aviso de siempre.

## 2026-11-13 · «Mi día» del revendedor: lo mismo que el dueño, con fórmulas y no con agentes
- **El dueño lo pidió así:** «los revendedores no van a tener agentes ni oficinas; tiene que ser todo mediante fórmulas para que tengan lo mismo que yo». Casi todo lo del dueño ya eran reglas (secretaria, Me pagó, semáforo, cierre); solo Mi oficina usa a Claude. Mi día reutiliza esas reglas sobre los datos del revendedor y no cuesta nada por uso.
- **Una lista, dos fuentes:** el revendedor tiene clientes registrados (Mi control) y perfiles repartidos (Repartir perfiles). Antes miraba dos pantallas; ahora las dos entran en los mismos tres grupos. Los grupos son los del dueño (cobrar / avisar / deben) con la misma ventana de 3 días (`SECRETARY_AHEAD_DAYS`).
- **«Me pagó» no es lo mismo que renovar, y se dice:** el revendedor cobra a su cliente pero el servicio lo renueva pagándole a la tienda. Por eso en un cliente registrado «Me pagó» marca pagado y **ofrece** renovar con su saldo en el mismo toque (casilla marcada si le alcanza), usando `orders.renew` de siempre. Si no alcanza o la cuenta vence antes, el cobro queda anotado y se explica. En un perfil repartido, que es su propia libreta, sí corre la fecha (igual que «renovar» en Repartir perfiles).
- **Mismo estilo, sin personajes:** tarjetas, botones de 44 px y colores por estado de GaboHub; no hay agentes con nombre porque eso es la oficina del dueño.
- **Del plan Completo:** depende de Mi control, que ya era del Completo; no tendría sentido en el Básico.

## 2026-11-13 · Optimización 2: el link acorta el camino, no decide por nadie
- **Apagado de fábrica:** el dueño pidió «implementala inicialmente apagada». Sin el interruptor, no hay botón, no hay ruta útil y el aviso de Tito no cambia. Prenderlo es un toque suyo, reversible, y apagarlo invalida todos los links vivos.
- **Un token aparte, no una sesión del cliente:** el link lleva una sesión de tipo `renew` (cliente + servicio) y no una sesión normal. Así, si el cliente lo reenvía, el que lo abre solo puede pagar ese servicio: no ve correos, claves, teléfono ni otras cuentas. El acceso a Mis cuentas es opcional («full») y lo elige el dueño.
- **Reutiliza `orders.renew`:** el pago por link pasa por la misma función que «Renovar» en Mis cuentas, con el actor del cliente (`renewlink:…` en la auditoría). Mismo precio acordado, mismo freno del proveedor, misma aprobación en Aprobar pagos para QR, mismo comprobante repetido frenado. No se creó un segundo camino de cobro.
- **Clientes de revendedor quedan afuera:** renuevan con su revendedor (regla existente); el botón no aparece y la API responde 409. Evita que un cliente final pague a la tienda lo que le corresponde a su revendedor.
- **Un solo uso para pagar:** con saldo, el link se consume al entregar; con QR, al mandar el comprobante. Antes de eso se puede volver a abrir (para subir la captura más tarde). Con acceso «full» el link sigue sirviendo para entrar mientras no venza.
- **Límite propio por IP (40 / 15 min):** el de login (5) frenaba el camino normal (ver, pagar, subir comprobante, volver a mirar); 40 alcanza de sobra para una persona y corta a quien pruebe tokens al azar.

## 2026-11-13 · Optimización 1: menos trabajo diario sin perder control
- **«Me pagó» reutiliza el Control, no lo reemplaza:** corre la fecha con `extend` (mismo freno del proveedor) y marca pagado con `setRentalControl` (mismo `paidLog` que leen Finanzas y Cómo van). Así el número no cambia según desde dónde cobres.
- **Vista previa obligatoria:** el dueño pidió ver cliente, cuenta, monto, período y fecha nueva antes de guardar. Es una llamada aparte; el guardado repite la validación por si cambió algo en el medio.
- **Frenos elegidos:** período ya cobrado (duplicado real), cobro hace menos de 10 min (doble toque o dos personas), proveedor (nunca se vende más allá de la cuenta). Descartado: frenar por «ya está pagado» a secas, porque cobrar el mes siguiente de una cuenta pagada es el caso normal.
- **La nota se limpia, no se borra:** «EN COBRO» y «POR CORTAR» salen de la nota del Control (si no, la secretaria la seguiría pidiendo) y la nota anterior queda en la auditoría.
- **Semáforo: «dada de baja» no es alerta:** el dueño ya revisó esas cuentas; mostrarlas rojas para siempre tapa las 4 que sí importan. No se borran ni se retiran: el dueño dijo «no retirar en lote».
- **% solo con mes completo:** un porcentaje contra un mes a medias es un número inventado; se muestra desde cuándo hay datos.

## 2026-11-13 · Premium 2.0 · Etapa 9: un cierre que no inventa números
- **El cierre usa `incomeEvents()` y nada más:** si el cierre tuviera su propia cuenta, volveríamos al problema de la etapa 2 (tres pantallas, tres números). Entró, por origen, por quién y por app salen de la misma lista.
- **«Cerrado» es solo una etiqueta:** no se congela nada ni se bloquea editar el pasado; si el dueño corrige un cobro de octubre, el cierre de octubre cambia. Congelar meses queda para cuando haya contador.
- **Excel y no PDF:** el dueño ya exporta a Excel y lo abre en el celular; un PDF sería otra dependencia.
- **Comparativa simple:** Bs y % contra el mes anterior completo (no «a esta altura»), porque el cierre se mira al terminar el mes; «Cómo van» ya tiene la comparación a la misma altura para los revendedores.

## 2026-11-13 · Premium 2.0 · Etapa 8: ayudar a responder, no responder solo
- **Nada se automatiza hacia afuera:** la misión prohíbe cobros y mensajes automáticos; por eso «automatización» acá es recordar y preparar (tiempo de espera, respuestas a un toque, mensajes armados, débitos por anotar). El envío sigue siendo del dueño.
- **24 h como «tarde»:** una falla es un cliente sin servicio; un día sin respuesta ya es mucho. Es un color, no un bloqueo.
- **Mensajes con 3 comodines y nada más:** `{nombre}`, `{cuentas}`, `{total}` cubren los tres casos sin inventar un editor de plantillas; las plantillas oficiales de Meta no se tocan (las aprueba Meta).
- **Débitos por la nota, no por un campo nuevo:** el dueño ya escribe «se debita el 18/11, tarjeta 8562» en la nota; se lee eso y la fecha del proveedor. Un campo «autopago» queda para después si hace falta filtrar más.

## 2026-11-13 · Premium 2.0 · Etapa 7: la oficina cuenta el día entero, sin inventar
- **Lo que hizo el dueño entra a la línea de tiempo:** la queja era «solo 6 eventos». En vez de inventar actividad para los asistentes, se lee la auditoría que ya existe (aprobar, rechazar, vender, cambiar clave). Es real y ya estaba guardado.
- **La sala siempre es oscura:** es una escena (Propuesta 1 aprobada), no una pantalla de formularios; en tema claro también se ve de noche, y lo de abajo (detalle, línea de tiempo, Para hoy) sí sigue al tema del panel.
- **Avatares vectoriales en vez del pixel art:** los 6 se mantienen con su nombre, puesto, rasgos y colores (ahora de la paleta Premium); el estado se lee en el anillo y el monitor, no solo en el texto.
- **«Para hoy» reutiliza la secretaria:** son los mismos conteos (sin volver a calcular reglas); el detalle vive en Mi secretaria.

## 2026-11-12 · Premium 2.0 · Etapa 6: planes sin tocar lo que ya cobra
- **La prueba gratis es para quien nunca pagó, no solo para los nuevos:** cuando el dueño prenda el cobro, sus revendedores de hoy (ARIt, rodbol, Paraguay…) arrancan con 15 días gratis en vez de un descuento sorpresa. Es la forma menos agresiva de empezar a cobrar; si el dueño prefiere cobrar desde el día uno, pone 0 días.
- **El Básico se define por lo que NO incluye:** las mismas cuatro herramientas que ya se pausan por falta de pago (Mi control, Quién me debe, Mis ganancias, Afiches). Así no hay que inventar permisos nuevos: se reutiliza el candado que existe, con otro mensaje y otro botón.
- **Sin prorrateo:** cambiar de plan a mitad de mes no devuelve ni cobra diferencia; rige desde el próximo cobro (pasar al Completo destraba ya). Más simple de explicar y nadie pierde plata por un error de dedo.
- **Precios en manos del dueño:** no se fijó el precio del Básico ni los días de prueba en el código; quedan en Ajustes y el cobro sigue apagado hasta que él lo prenda.

## 2026-11-12 · Premium 2.0 · Etapa 5: la tienda explica, los colores los elige el dueño
- **El motivo del rechazo se le dice al cliente:** antes solo quedaba en la auditoría y el cliente preguntaba por WhatsApp. Se muestra tal cual lo escribe el dueño (es él quien lo redacta), recortado a 200 letras.
- **No se cambian los colores de la tienda solos:** la misión pide azul eléctrico/cian, pero el dueño ya tiene Apariencia con sus colores. Se agrega el estilo «Premium 2.0» como opción y se deja la decisión en Apariencia. Descartado: cambiar el valor por defecto (habría cambiado la tienda al publicar sin que nadie lo pidiera).
- **Pasos numerados en vez de rediseñar el formulario de recarga:** el formulario funciona; lo que faltaba era que se entienda el orden. Tres títulos y nada más.
- **Contraste medido, no estimado:** las letras de los servicios pasaron a texto oscuro sobre pastel porque blanco sobre el color del producto no llega a 4,5:1 con amarillos ni verdes claros.

## 2026-11-12 · Premium 2.0 · Etapa 4: inventario que avisa, no que decide
- **Doble = misma plataforma + mismo correo, no solo mismo correo:** el dueño usa el mismo Gmail para Disney y Netflix. Bloquear por correo a secas le hubiera impedido cargar cuentas reales.
- **Dominio mal escrito avisa, no frena:** el 12/11 el dueño escribió «gmaik.com» y era un error; pero un dominio raro puede ser real. La respuesta trae `warning` y el panel lo muestra; la cuenta queda cargada.
- **Semáforo con motivos escritos:** un color solo no alcanza para saber qué hacer; cada cuenta dice por qué está amarilla o roja, con las mismas marcas que el dueño ya usa en las notas (CAÍDA, POR CORTAR, SEGUIMIENTO, DESENLAZAR).
- **Cortes no mueve fechas:** el dueño pidió «un corte de toditas las cuentas y ordenarlo»; mover vencimientos solo sería tocar plata de clientes. La pantalla sugiere la fecha que más se repite y muestra a quién le sobran o faltan días; él decide y lo hace con los botones de siempre (fecha, renovar). Descartado: «alinear todos» con un botón.
- **«Cambié la clave» registra, no ejecuta:** el panel no entra a Netflix ni a Disney; el dueño cambia la clave en la plataforma y acá queda la fecha, la auditoría (sin la clave) y el aviso en cola para los clientes de esa cuenta. La secretaria deja de pedirla 7 días; si la nota sigue diciendo «cambiar clave», vuelve a recordarla.

## 2026-11-12 · Premium 2.0 · Etapa 3: rápido sin cambiar lo que se ve
- **Un endpoint para Inicio, no un rediseño:** la pantalla queda igual; solo cambia cómo trae los datos (una llamada en vez de seis). Si una parte falla, viene en `null` y la pantalla sigue (antes, un `.catch` por llamada hacía lo mismo).
- **Caché de 20 s, solo listas del panel, se vacía al guardar y al cambiar de pantalla:** la demora que sentía el dueño era filtrar el Control (cada pestaña volvía a bajar todos los alquileres). Con esa regla, nunca ve un dato viejo después de guardar, y al entrar a una pantalla siempre lee de nuevo. Descartado: caché larga o compartida con la tienda (los primeros intentos rompieron dos pruebas de la tienda y de Mis clientes).
- **Oscuro por defecto, claro opcional, sin mover el interruptor:** la misión pide oscuros elegantes; el dueño y su equipo que ya eligieron claro lo conservan porque la preferencia vive en su aparato. La paleta oscura se toma de `tema.css` para que panel, oficina y futuras pantallas sean iguales.
- **GaboHub se queda con el aspecto que define el dueño:** su página ya arranca oscura (fondo `#090e1d`) y un interruptor personal por revendedor tocaría Apariencia y las páginas `/r/<slug>`; va al BACKLOG con prioridad baja.

## 2026-11-12 · Premium 2.0 · Etapa 2: un solo «lo que entró»
- **Los cobros del Control cuentan en todas las pantallas:** el negocio real del dueño (alquileres de Disney a revendedores) se cobra casi siempre por fuera y se marca 💵 en el Control. «Cómo van» ya los contaba; Inicio y Finanzas no, y por eso nunca coincidían. Ahora los tres leen `incomeEvents()` (src/store/income.ts) con la misma regla de no duplicar (un pedido a menos de 20 días de la marca = el mismo pago).
- **Lo importado no es ingreso:** cargar lo que ya estaba vendido (Excel, «cargar vendidas») no es plata que entró ese día. Finanzas lo contaba (en Bs 0 casi siempre, pero contaba); se alineó con Inicio.
- **Hora de Bolivia fija, no la del servidor:** Railway puede correr en UTC; con `TZ` sin setear, una venta a las 21:00 caía al día siguiente. Bolivia no tiene horario de verano, así que se usa UTC−4 fijo (más rápido que `Intl` y sin depender de la zona del proceso).
- **Costo en US$ a la tasa de hoy:** lo que el dueño paga con tarjeta en dólares cambia con la tasa; guardar solo los Bs del día de la carga mostraba una ganancia vieja. Se convierte al mirar, no al guardar; el Bs anotado queda como referencia.
- **Fiado sigue en Bs:** la libreta se lleva en Bs (así nació y así están los movimientos); al que paga en dólares se le muestra el ≈ US$ a la tasa de hoy, con la tasa visible. Descartado: libretas por moneda (habría que migrar movimientos y dividir totales).

## 2026-11-12 · Premium 2.0 · Etapa 1: la plata se frena, no se adivina
- **Comprobante repetido se bloquea, no se avisa:** antes el panel solo marcaba «repetido» y se podía aprobar igual; con dos revendedores y mucha venta eso termina en una cuenta regalada. Ahora frena y solo el dueño lo pasa, con motivo escrito. Un admin no, porque es la persona que más aprueba y el dueño quiere ver esos casos.
- **Referencias normalizadas al comparar, no al guardar:** se guarda lo que escribió el dueño (para buscarlo igual que en el banco) y se compara sin formato. Descartado: pedirle que escriba «solo números» (más fricción en el celular).
- **Monto verificado en recargas en vez de confiar en el cliente:** el cliente declara, el dueño confirma. Si no toca el campo, se acredita lo declarado, como antes. Se auditan solo las correcciones.
- **Recargas: llave desde la tienda + tope de 3 en revisión:** el doble toque es el caso real (celular, conexión lenta); el tope evita que una cuenta llene la bandeja. Descartado: bloquear por imagen repetida en recargas, porque mucha gente manda la misma captura por error y ya se marca.
- **Bandeja de Binance en lugar de reintento automático:** Binance ya cobró; reintentar solo cada tanto podría entregar cuando el dueño no mira. Mejor que lo vea en Aprobación y decida (reintentar o descartar con motivo). Sin cobros automáticos nuevos.
- **Consentimiento con origen:** la Ley 164 y las reglas de Meta piden poder mostrar cuándo y cómo dijo que sí. Valores cerrados (registro, cliente, whatsapp, panel, revendedor, importado) para poder filtrar después.
- **«Enviado a mano» pide permiso:** era la puerta para saltarse la BAJA. El dueño puede forzar (a veces el cliente pide por otro canal), con motivo y auditado.

## 2026-11-12 · «Mi secretaria» lee las marcas de las notas, sin IA
- **Qué:** la pantalla se arma con reglas fijas sobre los datos (notas «EN COBRO», «POR CORTAR», «DESENLAZAR», fechas y estado de pago), no con Claude. Así funciona siempre, gratis y al instante, aunque los agentes estén apagados o sin clave.
- **Avisar:** muestra lo que vence en los próximos 3 días y la nota de la ficha de cada revendedor (su regla: «avisar 3 días antes», «1 a 2 días antes»), en vez de adivinar la regla leyendo el texto.
- **Nada sale solo:** los mensajes son links wa.me que abre el dueño. «Lo que pasó» solo lo ve quien puede ver la Auditoría (el dueño).
- **Descartado:** una tarjeta más en Inicio (ya está «Lo que tenés pendiente», que solo cuenta); el dueño pidió un botón que le diga todo con detalle.

## 2026-11-12 · GaboHub etapa 5: qué pasa si un revendedor no paga la suscripción
- **Propuesta del asistente, sin respuesta explícita del dueño («vos trabajá»):** nunca se bloquea lo que le deja plata al dueño (comprar, cuentas, códigos, recargar, vender, anotar fiados). Después de los días de gracia se pausan Mi control, Quién me debe, Mis ganancias y Afiches, y su página si tiene. Es fácil de cambiar antes de prender el cobro.
- **La pausa la controla el servidor** (402 en esas pantallas) y solo cuenta mientras el cobro esté prendido para todos: si el dueño lo apaga, nadie queda pausado.
- **Dónde se guarda:** con página, en su página (como siempre); sin página, aparte (`hubBill`), y pasa a la página si después la arma.
- **US$ fijos:** el dueño pidió US$ 5 redondos; sin ese número se usa la tasa del día como antes.

## 2026-11-12 · GaboHub etapa 4: clientes en una sola lista
- **Cómo se une:** una cuenta propia va con el cliente si la venta tiene su ficha; si no, por WhatsApp (solo números, 7 o más). Los perfiles de cuentas completas, por WhatsApp. Sin WhatsApp, se agrupan por nombre como «sueltos».
- **Sueltos, no fichas automáticas:** no se crea ningún cliente solo; el revendedor decide con «Guardar en mis clientes».
- **Sin cambios de servidor.**

## 2026-11-12 · GaboHub etapa 3: cuentas propias en Mi control, Quién me debe y Mis ganancias
- **Qué:** un apartado «📦» al final de cada pantalla, con los mismos botones que ya tiene «Mis cuentas propias» (Renovó, Me pagó). Lo de arriba no cambia.
- **Por qué apartado y no mezclado:** así lo hacen ya los perfiles de cuentas completas; los números de la tienda los calcula el servidor y no se tocan.
- **Ganancias sin costo:** las cuentas propias no tienen anotado cuánto le cuestan al revendedor, así que se muestra lo que cobra, no la ganancia, y se lo dice claro. Anotar ese costo queda en el BACKLOG.

## 2026-11-12 · GaboHub etapa 2: Inventario por plataforma
- **Qué:** una pantalla que junta por app lo comprado a la tienda, las cuentas completas y las propias. Solo lee; para hacer algo, «Ver» lleva a la pantalla de siempre.
- **Por qué así:** no se mueve ni se rehace ninguna función (regla del dueño), y el revendedor ve todo su stock en un lugar.
- **Cómo se juntan las apps:** por nombre, sin tildes ni mayúsculas y sin «(alquiler revendedores)». Si el revendedor le pone otro nombre a su producto propio (por ejemplo «Netflix 4K»), sale en su propia fila.
- **Cuentas completas:** también vienen entre sus servicios; se cuentan una sola vez, como «Cuentas completas».

## 2026-11-12 · GaboHub etapa 1: navegación como el panel del dueño
- **Qué:** barra de abajo Inicio · Clientes · Vender · Inventario · Más; las 10 pestañas de «Mis clientes» en 3 grupos; pantallas nuevas Vender y Más.
- **Por qué así:** el dueño quiere que el revendedor se sienta en su propio panel. El problema principal era que casi todo (la página, los combos, las cuentas propias) estaba en una fila de pestañas que había que correr de costado.
- **Códigos y Comprar salen de la barra de abajo:** siguen a un toque en el Inicio, en Más, en Vender y en la barra de arriba de la PC.
- **Sin cambios de servidor ni de datos.**

## 2026-11-12 · Precio de GaboHub
- **Qué decidió el dueño:** Bs 49 por mes, o US$ 5 fijos para los que pagan en dólares. Lo pagan todos los revendedores (no solo los de página propia). Sin el «gratis si compra Bs 200». El cobro queda apagado hasta que él lo prenda.
- **Por qué US$ 5 fijos:** pasar Bs 49 con la tasa del día da otro número cada día; el dueño quiere un precio redondo en dólares.

## 2026-11-12 · Revendedor de prueba en la tienda real
- **Qué:** el dueño quería entrar desde su celular al panel de un revendedor. El demo con datos inventados solo se ve dentro de la app de Claude, así que, con su OK, se creó «Revendedor Demo (prueba)» en la tienda real: sin clientes, saldo 0 y solo panel. Al crearlo no se mandó ningún mensaje (la cola siguió en 75).
- **Ojo para revisarlo desde las pruebas:** la llave del asistente va en cada pedido y le gana a la sesión del revendedor, así que desde acá se ve el panel como admin. Se comprobó que el número y el PIN entran (respuesta 200).

## 2026-11-12 · Cuentas por plataforma (etapa 7)
- **Qué:** en el celular, Cuentas agrupa por plataforma por defecto. Adentro de cada grupo van las mismas tarjetas, sin tocar nada de ellas.
- **Por qué así:** la regla del dueño es no perder ninguna función. Reusar la tarjeta tal cual garantiza que los botones sean los mismos, y la prueba lo comprueba comparando las dos vistas.
- **Vista clásica a un toque:** por si el dueño prefiere la lista de antes. Se guarda solo en ese celular.
- **Computadora sin cambios:** ahí la tabla ya se lee bien.

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
