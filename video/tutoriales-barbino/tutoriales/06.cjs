// Esconde el aviso «Sin PIN de gerencia» ANTES de medir el recuadro (si no, el recuadro queda corrido).
const hideBanners = (page) => page.evaluate(() => {
  for (const e of document.querySelectorAll("body *")) {
    const h = e.getBoundingClientRect().height;
    if (e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp/.test(e.textContent) && h < 130 && h > 20 && !e.closest("[data-keep]")) e.style.display = "none";
  }
});
const wrap = (T) => { const step = T.step; T.step = async (o) => { await hideBanners(T.page).catch(() => {}); return step(o); }; };

const PIN = "4826";
const PASS = "DemoBarber2026!";

module.exports = {
  number: 6,
  title: "La caja: cobrar y cerrar",
  learn: ["Abrir y cerrar la caja", "Cobrar un turno", "Vender productos y bebidas", "Anular una venta", "Controlar el stock"],
  async capture(T) {
    wrap(T);
    const { page } = T;
    const P = "/imperio/panel";
    await T.login();

    await T.go(P + "/caja");
    await T.step({ title: "La caja", text: "Hola, ¿qué tal? Hoy vemos la caja: cómo cobrar, vender y cerrar el día. Cada mañana abrís la caja contando el efectivo de cambio que dejás. Acá ya está abierta. Arriba ves lo que entró hoy, el efectivo que tendría que haber y lo cobrado por QR, tarjeta y transferencia.", hl: page.locator("section[aria-label='Resumen de la caja']") });
    await T.step({ title: "Ventas de la caja", text: "Más abajo está la lista de ventas de esta caja, con el número, la hora, el medio de pago y el cliente. Tocás cualquiera y ves el detalle.", hl: T.text("Ventas de esta caja", true) });

    // Productos: ¿puedo vender gaseosas o ceras?
    await T.go(P + "/productos");
    await T.step({ title: "¿Vendo gaseosas?", text: "¿Puedo vender gaseosas o ceras? Sí. Primero las cargás en «Más», «Productos e inventario». Tocás «Nuevo producto».", hl: page.locator("a:visible").filter({ hasText: "Nuevo producto" }) });
    const fillProduct = async (name, price, cost, min, stock) => {
      await T.go(P + "/productos/nuevo");
      await T.fill(page.locator("input[name=name]"), name);
      await T.fill(page.locator("input[name=price]"), price);
      await T.fill(page.locator("input[name=cost]"), cost);
      await T.fill(page.locator("input[name=minStock]"), min);
      await T.fill(page.locator("input[name=initialStock]"), stock);
    };
    await fillProduct("Coca-Cola 500 ml", "8", "5", "3", "4");
    await T.step({ title: "Nuevo producto", text: "Ponés el nombre, el precio de venta, el costo si querés, el stock que tenés hoy y el stock mínimo: cuando llegue a ese número, el sistema te avisa que te estás quedando sin.", hl: page.locator("input[name=minStock]"), scrollY: -120 });
    await T.tap(page.getByRole("button", { name: "Crear producto" }), 2500);
    const hasPin = !(await T.text("todavía no lo creaste").count());
    if (!hasPin) {
      await T.step({ title: "Te pide el PIN", text: "Para guardar te pide el PIN de gerencia, una clave de cuatro números que protege lo delicado. Si todavía no lo tenés, tocás «Crear PIN». Lo explicamos bien en el próximo tutorial.", hl: page.getByRole("alert").filter({ hasText: "PIN" }), scrollY: 250 });
      await T.go(P + "/gerencia");
      await T.fill(page.locator("input[name=pin]"), PIN);
      await T.fill(page.locator("input[name=pinConfirm]"), PIN);
      await T.fill(page.locator("input[name=currentPassword]"), PASS);
      await T.tap(page.getByRole("button", { name: "Crear PIN" }), 2500);
      await fillProduct("Coca-Cola 500 ml", "8", "5", "3", "4");
      await page.getByRole("button", { name: "Crear producto" }).click();
      await page.waitForTimeout(2500);
    }
    await T.fill(page.locator('input[aria-label="PIN de gerencia"]'), PIN);
    await T.step({ title: "Desbloquear", text: "Escribís tu PIN y tocás «Desbloquear y continuar». Queda abierto diez minutos, así no te lo pide a cada rato.", hl: page.getByRole("button", { name: "Desbloquear y continuar" }) });
    await T.tap(page.getByRole("button", { name: "Desbloquear y continuar" }), 3000);
    // Segundo producto y un cupón de ejemplo (fuera de cámara, ya en modo gerencia)
    await fillProduct("Cera mate 100 g", "45", "28", "2", "10");
    await page.getByRole("button", { name: "Crear producto" }).click();
    await page.waitForTimeout(2500);
    await T.go(P + "/cupones");
    await T.fill(page.locator("input[name=code]"), "AMIGO10");
    await T.fill(page.locator("input[name=value]"), "10");
    await page.getByRole("button", { name: "Crear cupón" }).click();
    await page.waitForTimeout(2000);

    // Fuera de cámara: un cliente reserva por la página con anticipo, y el local lo verifica.
    const pub = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: "es-BO", timezoneId: "America/La_Paz" });
    const pp = await pub.newPage();
    await pp.goto(T.B + "/imperio/reservar", { waitUntil: "networkidle" });
    await pp.locator("a").filter({ hasText: "Corte + barba" }).first().click();
    await pp.waitForTimeout(1500);
    await pp.locator("a").filter({ hasText: "Diego" }).first().click();
    await pp.waitForTimeout(1500);
    if (!(await pp.locator("a").filter({ hasText: /^\d\d:\d\d$/ }).count())) {
      await pp.locator("a").filter({ hasText: /[1-9]\d* libres/ }).first().click();
      await pp.waitForTimeout(1500);
    }
    await pp.locator("a").filter({ hasText: /^\d\d:\d\d$/ }).first().click();
    await pp.waitForTimeout(1500);
    const fecha = new URL(pp.url()).searchParams.get("fecha");
    await pp.fill("input[name=name]", "Marcelo Antelo");
    await pp.fill("input[name=phone]", "76543210");
    await pp.locator("input[name=accept]").check();
    await pp.getByRole("button", { name: "Confirmar reserva" }).click();
    await pp.waitForTimeout(3000);
    await pub.close();
    await T.go(P + "/agenda?fecha=" + fecha, { wait: 1200 });
    await page.locator("a:visible").filter({ hasText: "Marcelo Antelo" }).first().click();
    await page.waitForTimeout(2000);
    await T.fill(page.locator("input[name=reference]"), "TRX-000123");
    await page.getByRole("button", { name: /Recibí el anticipo/ }).click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await T.step({ title: "Cobrar un turno", text: "Ahora, a cobrar. Cuando el cliente termina, abrís su turno en la agenda y tocás «Cobrar». Este cliente, Marcelo, reservó por tu página y ya pagó el anticipo.", hl: page.getByRole("link", { name: "Cobrar" }) });
    await T.tap(page.getByRole("link", { name: "Cobrar" }), 2000);
    await page.getByRole("button", { name: "Agregar Coca-Cola 500 ml" }).click();
    await page.waitForTimeout(400);
    await T.step({ title: "Turno y anticipo", text: "Ya viene cargado el servicio, el cliente y el barbero, y el anticipo que pagó aparece como «ya cobrado»: se descuenta solo del total. Y si se lleva una gaseosa, la sumás con el más.", hl: page.getByText(/anticipo ya cobrado:/) });
    await page.getByLabel("Medio de pago").selectOption("QR");
    await T.fill(page.getByLabel("Propina"), "5");
    await T.step({ title: "Medio y propina", text: "Abajo elegís cómo paga: efectivo, QR, tarjeta o transferencia. Si paga una parte de cada forma, tocás «Otro medio». La propina va entera para el barbero. Tocás «Registrar venta» y listo.", hl: page.getByLabel("Medio de pago") });
    await T.tap(page.getByRole("button", { name: /Registrar venta/ }), 3000);

    // Nueva venta sin reserva, con cupón
    await T.go(P + "/caja/venta", { wait: 1200 });
    await page.getByRole("button", { name: "Agregar Cera mate 100 g" }).click();
    await page.locator("li").filter({ hasText: "Perfilado de barba" }).getByRole("button", { name: "Agregar" }).click();
    await page.locator("section").filter({ hasText: "Servicios sin reserva" }).locator("select").selectOption({ label: "Diego" });
    await T.step({ title: "Nueva venta", text: "¿Alguien entra solo a comprar, o le hacés algo sin turno? Tocás «Nueva venta». Sumás productos, servicios, o las dos cosas, y elegís el barbero que atendió para que le cuente en sus ganancias.", hl: page.locator("section").filter({ hasText: "Servicios sin reserva" }).locator("select") });
    await T.fill(page.getByLabel("Código de cupón"), "AMIGO10");
    await page.getByRole("button", { name: "Aplicar" }).click();
    await page.waitForTimeout(1500);
    await T.fill(page.getByLabel("Recibido en efectivo (para el vuelto)"), "100");
    await T.step({ title: "Cupón y vuelto", text: "Si el cliente trae un cupón de descuento, escribís el código y tocás «Aplicar». Si paga en efectivo, ponés con cuánto te pagó y te calcula el vuelto.", hl: page.getByLabel("Recibido en efectivo (para el vuelto)"), scrollY: 260 });
    await T.tap(page.getByRole("button", { name: /Registrar venta/ }), 3000);

    // Anular (pide PIN): se cierra el modo gerencia para mostrar el pedido
    const saleUrl = page.url().split("?")[0];
    await T.go(P + "/gerencia");
    await page.getByRole("button", { name: "Bloquear ahora" }).click();
    await page.waitForTimeout(1500);
    await T.go(saleUrl);
    await T.fill(page.locator("input[name=reason]"), "Cobré mal el producto");
    await T.tap(page.getByRole("button", { name: "Anular venta" }), 2500);
    await T.fill(page.locator('input[aria-label="PIN de gerencia"]'), PIN);
    await T.step({ title: "¿Me equivoqué?", text: "¿Y si me equivoqué en una venta? Abrís la venta, escribís el motivo y tocás «Anular venta». Te pide el PIN de gerencia: así un empleado no puede borrar ventas. La venta no desaparece, queda tachada, y el producto vuelve al stock.", hl: page.getByRole("button", { name: "Desbloquear y continuar" }), scrollY: 260 });
    await T.tap(page.getByRole("button", { name: "Desbloquear y continuar" }), 3000);

    // Inventario
    await T.go(P + "/productos", { wait: 1200 });
    await T.step({ title: "Inventario", text: "En «Productos e inventario» ves el stock de cada cosa: se descuenta solo con cada venta. La Coca-Cola ya está en stock bajo, y te avisa también en el Inicio. Las compras, mermas y conteos se cargan en cada producto, con PIN.", hl: page.locator("a:visible, div:visible").filter({ hasText: /^Stock bajo\s*\d+$/ }).last() });

    // Cerrar caja
    await T.go(P + "/caja", { wait: 1200 });
    const exp = await page.locator("text=/Esperado: Bs/").first().innerText();
    const cents = Math.round(parseFloat(exp.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
    const counted = String((cents - 1000) / 100).replace(".", ",");
    await T.fill(page.locator("input[name=counted]"), counted);
    await T.fill(page.locator("input[name=note]"), "Faltan Bs 10, revisar con recepción");
    await T.step({ title: "Cerrar la caja", text: "Al final del día, en «Cerrar caja», contás los billetes y ponés cuánto efectivo hay. El sistema te muestra cuánto tendría que haber y si cuadra, si sobra o si falta.", hl: page.locator("input[name=counted]") });
    await T.step({ title: "¿Falta plata?", text: "¿Y si falta plata? Lo ves al toque: acá faltan diez bolivianos. Anotás una nota y cerrás igual. La diferencia queda guardada con quién cerró, para revisarla después. Una caja cerrada ya no se puede reabrir.", hl: T.text("Faltan Bs 10.", true) });
    await T.tap(page.getByRole("button", { name: "Cerrar caja" }), 3000);
    await T.fill(page.locator("input[name=opening]"), "200");
    await T.step({ title: "Abrir la caja", text: "Al otro día, la caja aparece cerrada. Ponés el efectivo inicial, por ejemplo doscientos bolivianos de cambio, y tocás «Abrir caja». Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", hl: page.getByRole("button", { name: "Abrir caja" }) });
  },
};
