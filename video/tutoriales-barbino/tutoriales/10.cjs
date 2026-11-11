// Tutorial 10 — Números y vender más: finanzas, reportes, paquetes y regalos, cupones, precios por horario y fila de espera.
// Oculta los avisos de arriba ANTES de medir el recuadro (si no, el recuadro queda corrido).
const hideBanners = (page) =>
  page.evaluate(() => {
    for (const e of document.querySelectorAll("body *")) {
      const h = e.getBoundingClientRect().height;
      if (e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp|Modo gerencia (activo|bloqueado)/.test(e.textContent) && h < 130 && h > 20) e.style.display = "none";
    }
  });
// Prepara el PIN de gerencia y desbloquea el modo gerencia, sin mostrarlo en el video.
async function gerencia(T) {
  const { page } = T;
  await T.go("/imperio/panel/gerencia");
  if (await page.getByRole("button", { name: "Crear PIN" }).count()) {
    await page.locator("input[name=pin]").last().fill("4718");
    await page.locator("input[name=pinConfirm]").fill("4718");
    await page.locator("input[name=currentPassword]").fill("DemoBarber2026!");
    await page.getByRole("button", { name: "Crear PIN" }).click();
    await page.waitForTimeout(2500);
    await T.go("/imperio/panel/gerencia");
  }
  const u = page.getByRole("button", { name: "Desbloquear modo gerencia" });
  if (await u.count()) {
    await page.locator("form", { has: u }).locator("input[name=pin]").fill("4718");
    await u.click();
    await page.waitForTimeout(2500);
  }
}

module.exports = {
  number: 10,
  title: "Números y vender más",
  learn: ["Tu ganancia real del mes", "Reportes y Excel", "Paquetes, membresías y regalos", "Cupones y precios por horario", "Fila de espera con la TV"],
  async capture(T) {
    const { page } = T;
    const step = T.step;
    T.step = async (o) => { await hideBanners(page); await step(o); };
    await T.login();
    await gerencia(T);

    // 1. Finanzas
    await T.go("/imperio/panel/finanzas");
    await T.step({ title: "Finanzas", text: "Hola, ¿qué tal? Hoy vemos los números y cómo vender más. ¿Cuánto me queda de verdad a fin de mes? Eso te dice «Finanzas»: lo que entró, menos lo del equipo, los productos y los gastos del local. Esa es tu ganancia real.", hl: T.text(/Ganancia real/i) });
    await T.tap(T.text("Alquiler del local"), 400);
    await T.fill(page.locator("input[name=description]"), "Alquiler de noviembre");
    await T.fill(page.locator("input[name=amount]"), "150");
    await T.tap(page.getByRole("button", { name: "Transferencia", exact: true }), 400);
    await T.step({ title: "Cargar un gasto", text: "Para que sea real, cargás los gastos a medida que salen: elegís en qué se gastó, alquiler, luz, insumos, ponés el detalle, el monto y cómo lo pagaste. Si sale del efectivo de la caja, se descuenta solo al cerrarla.", hl: T.text("¿En qué se gastó?"), scrollY: -20 });
    await T.tap(T.role("button", "Cargar gasto"), 3000);
    await T.tap(page.getByRole("button", { name: "Equipos e inversiones" }), 600);
    await T.step({ title: "Inversiones aparte", text: "¿Y si compro una máquina o un aire acondicionado? Va en «Equipos e inversiones», que se muestra aparte: no te hunde la ganancia del mes, porque te dura años.", hl: page.locator("p", { hasText: "no restan de la ganancia" }), scrollY: 120 });
    await T.fill(page.locator("input[aria-label='Nombre de la categoría']"), "Gas");
    await T.step({ title: "Tus categorías", text: "Y si te falta una categoría, la creás: por ejemplo «Gas» o «Limpieza». Abajo ves en qué se te va la plata, de mayor a menor.", hl: page.locator("input[aria-label='Nombre de la categoría']"), scrollY: 250 });
    await T.tap(page.locator("form", { has: page.locator("input[aria-label='Nombre de la categoría']") }).getByRole("button", { name: "Crear" }), 2500);

    // 2. Reportes
    await T.go("/imperio/panel/reportes");
    await T.step({ title: "Reportes", text: "En «Reportes» ves cómo te fue en el mes: cuánto vendiste, el ticket promedio, cuántos clientes atendiste y cuántos faltaron sin avisar. Después, las ventas de cada día, cuánto vendió cada barbero y los servicios que más salen.", long: 1700 });
    await T.text("¿Cuándo hay más movimiento?").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, 250));
    await page.waitForTimeout(300);
    await T.step({ title: "Mejores días", text: "Acá ves qué días y a qué horas tenés más movimiento, para saber cuándo poner más barberos. Y arriba, con «Descargar Excel», te llevás todas las ventas del mes." });

    // 3. Paquetes y regalos
    await T.go("/imperio/panel/paquetes");
    await page.locator("summary", { hasText: "Crear paquete o membresía" }).evaluate((el) => { el.parentElement.open = true; });
    await page.waitForTimeout(500);
    await T.fill(page.locator("input[name=name][placeholder='5 cortes']"), "5 cortes");
    await T.fill(page.locator("input[name=price]"), "180");
    await T.step({ title: "Paquetes", text: "Ahora, vender más. En «Paquetes y regalos» creás un paquete, por ejemplo cinco cortes por Bs 180 que vencen en noventa días. O una membresía: tantos cortes por mes, que se renueva.", hl: page.locator("input[name=price]"), scrollY: 200 });
    await T.tap(T.role("button", "Crear"), 2500);
    await T.go("/imperio/panel/paquetes");
    await T.tap(T.role("tab", "Tarjeta de regalo"), 600);
    await T.fill(page.locator("input[name=giftAmount]"), "50");
    await T.fill(page.locator("input[name=recipient]"), "Papá");
    await T.step({ title: "¿Regalar un corte?", text: "¿Puedo regalar un corte? Sí: vendés una tarjeta de regalo. Ponés el monto, para quién es, y cómo te pagaron. La plata entra hoy a la caja.", hl: page.locator("input[name=giftAmount]") });
    await T.tap(T.role("button", /Cobrar/), 4000);
    await T.step({ title: "El código", text: "Te queda la tarjeta con su código, lista para mandarla por WhatsApp. Cuando la persona viene, en la caja escribís el código y se descuenta solo. Lo mismo con los paquetes: cada uso se resta." });

    // 4. Cupones
    await T.go("/imperio/panel/cupones");
    await T.fill(page.locator("input[name=code]"), "AMIGO20");
    await T.fill(page.locator("input[name=value]"), "20");
    await T.fill(page.locator("input[name=description]"), "Veinte por ciento para amigos");
    await T.step({ title: "Cupones", text: "Los cupones son para tus promos. Le ponés un código, por ejemplo «AMIGO20», el descuento en porcentaje o en plata, y si querés, fechas y un máximo de usos.", hl: page.locator("input[name=code]") });
    await T.tap(T.role("button", "Crear cupón"), 2500);
    await T.go("/imperio/panel/caja/venta");
    await T.tap(page.getByRole("button", { name: "Agregar" }).first(), 600);
    await T.fill(page.locator("input[aria-label='Código de cupón']"), "AMIGO20");
    await T.tap(T.role("button", "Aplicar"), 2000);
    await T.step({ title: "Aplicar en la caja", text: "El cliente te dice el código al pagar. En «Nueva venta» lo escribís en «Cupón», tocás «Aplicar» y el descuento se hace solo.", hl: page.locator("span", { hasText: "AMIGO20" }), scrollY: 200 });

    // 5. Precios por horario
    await T.go("/imperio/panel/ajustes/precios");
    await T.fill(page.locator("input[name=label]"), "Mañanas tranquilas");
    await T.step({ title: "Precios por horario", text: "¿Cómo lleno las mañanas vacías? Con «Precios por horario», en «Ajustes». Elegís los días, el horario y el descuento: por ejemplo, de lunes a miércoles, de nueve a doce, veinte por ciento menos.", hl: page.locator("input[name=percent]") });
    await T.tap(T.role("button", "Agregar"), 2500);
    await T.go("/imperio/reservar");
    await T.tap(T.text("Corte clásico").first(), 1500);
    await T.tap(T.text("El primero libre").first(), 1500);
    const tomorrow = page.locator("nav a", { hasText: /^MIÉ|^Mié/i }).first();
    if (await tomorrow.count()) await T.tap(tomorrow, 1500);
    await T.step({ title: "El cliente lo ve", text: "Y tu cliente, al reservar, ve esos horarios marcados con el descuento. Se aplica solo, sin que tengas que hacer nada.", hl: page.locator("a", { hasText: "−20%" }) });

    // 6. Fila de espera
    await T.go("/imperio/panel/fila");
    await T.fill(page.locator("input[name=name]"), "Javier");
    await T.step({ title: "Fila de espera", text: "Por último, la fila de espera, para los que llegan sin reserva. Anotás el nombre, el servicio y si prefiere a algún barbero. También se pueden anotar solos con el QR «Ya llegué» pegado en la puerta.", hl: page.locator("input[name=name]"), scrollY: 200 });
    await T.tap(T.role("button", "Anotar en la fila"), 2500);
    const tv = await page.locator("a", { hasText: "Pantalla para la TV" }).first().getAttribute("href");
    await T.go(tv, { wait: 2500 });
    await T.step({ title: "Pantalla para la TV", text: "Con «Pantalla para la TV» abrís esto en el televisor del local: cada uno ve su número y cuánto le falta. Ojo: Finanzas viene en los planes Pro y Business, y la fila, la fidelidad y los reportes desde el plan Team. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!" });
  },
};
