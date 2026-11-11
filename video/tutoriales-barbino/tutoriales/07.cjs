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
  number: 7,
  title: "Tu equipo y sus pagos",
  learn: ["Invitar a tu equipo", "Qué ve cada rol", "El PIN de gerencia", "Comisión o alquiler de silla", "El recibo de pago del barbero"],
  async capture(T) {
    wrap(T);
    const { page } = T;
    const P = "/imperio/panel";
    const pinInput = () => page.locator('input[aria-label="PIN de gerencia"]');
    // Si falta el PIN (datos recién restaurados), se crea; queda listo para desbloquear.
    const ensurePinExists = async (back) => {
      if (!(await page.getByText("todavía no lo creaste").count())) return false;
      await T.go(P + "/gerencia");
      await T.fill(page.locator("input[name=pin]"), PIN);
      await T.fill(page.locator("input[name=pinConfirm]"), PIN);
      await T.fill(page.locator("input[name=currentPassword]"), PASS);
      await page.getByRole("button", { name: "Crear PIN" }).click();
      await page.waitForTimeout(2500);
      await back();
      return true;
    };
    await T.login();

    await T.go(P + "/equipo");
    await T.step({ title: "Tu equipo", text: "Hola, ¿cómo estás? Hoy vemos tu equipo y cómo les pagás. En «Más», «Equipo», das acceso al panel a las personas que trabajan con vos. Cada una entra con su propia cuenta, nunca con la tuya.", hl: T.text("Invitar a una persona", true) });
    await T.step({ title: "Qué ve cada uno", text: "Hay cuatro roles. El dueño ve todo. El gerente maneja agenda, caja, catálogo, equipo e inventario. Recepción ve la agenda completa, los clientes, la caja y los anticipos. Y el barbero ve solo su agenda, sus clientes y sus ventas.", hl: T.text("Barbero: Su agenda", false) });
    const invite = async () => {
      await T.go(P + "/equipo");
      await T.fill(page.locator("input[name=email]"), "kevin@imperio.test");
      await page.locator("select[name=role]").selectOption("BARBER");
      await page.getByRole("button", { name: "Invitar", exact: true }).click();
      await page.waitForTimeout(2500);
    };
    await invite();
    await ensurePinExists(invite);
    await T.fill(pinInput(), PIN);
    await T.step({ title: "Invitar", text: "Para invitar, ponés su correo, elegís el rol y tocás «Invitar». Como es algo delicado, te pide tu PIN de gerencia.", hl: page.getByRole("button", { name: "Desbloquear y continuar" }), scrollY: 200 });
    await T.tap(page.getByRole("button", { name: "Desbloquear y continuar" }), 3000);
    await T.step({ title: "Mandale el enlace", text: "Listo: te da un enlace de un solo uso, que vence en siete días. Se lo mandás por WhatsApp, la persona crea su cuenta y entra con el rol que elegiste. Si se va del local, le quitás el acceso desde acá.", hl: T.text("Invitación creada."), scrollY: 150 });

    // PIN de gerencia
    await T.go(P + "/gerencia");
    await T.step({ title: "PIN de gerencia", text: "Ahora, el PIN de gerencia. Cada dueño y cada gerente tiene el suyo, de cuatro números. Protege lo delicado: precios, equipo, ajustes, inventario y anular ventas. Lo ponés una vez y queda abierto diez minutos, solo en ese celular.", hl: page.locator("h1").first() });
    await T.step({ title: "Si alguien prueba", text: "¿Y si alguien prueba números al azar? Después de cinco intentos fallidos, el PIN se bloquea quince minutos, y queda registrado. Acá también podés cambiar tu PIN cuando quieras, con la contraseña de tu cuenta.", hl: T.text("intentos fallidos el PIN se bloquea") });

    // Ganancias y comisiones
    await T.go(P + "/ganancias", { wait: 1200 });
    await T.step({ title: "Ganancias", text: "En «Ganancias y comisiones» ves lo que cobró cada barbero, su comisión y sus propinas, por hoy, la semana o el mes. ¿El barbero ve lo que ganan los demás? No: cada barbero ve solo lo suyo. Al equipo completo lo ven el dueño y el gerente.", hl: page.getByRole("link", { name: "Esta semana" }) });
    const card = (name) => page.locator("h2", { hasText: new RegExp(`^${name}$`) }).locator("xpath=ancestor::*[.//details][1]");
    await card("Kevin").locator("summary", { hasText: "Cómo trabaja" }).click();
    await page.waitForTimeout(500);
    await T.step({ title: "La comisión", text: "Cada barbero tiene su porcentaje. Tocás «cambiar», ponés cuánto se lleva de sus servicios y guardás. Los productos no comisionan, y la propina es entera para el barbero.", hl: card("Kevin").locator('input[name=percent]') });
    await card("Bruno").locator("summary", { hasText: "Cómo trabaja" }).click();
    await page.waitForTimeout(400);
    await card("Bruno").getByRole("radio", { name: "Alquila la silla" }).click();
    await page.waitForTimeout(300);
    await T.fill(card("Bruno").locator("input[name=rent]"), "300");
    await card("Bruno").locator("select[name=period]").selectOption("WEEKLY");
    await T.step({ title: "¿Alquila la silla?", text: "¿Y si un barbero alquila la silla en vez de ir a comisión? Elegís «Alquila la silla», ponés cuánto paga y cada cuánto: por día, por semana o por mes. Lo que cobra por sus servicios es todo suyo.", hl: card("Bruno").getByRole("radio", { name: "Alquila la silla" }) });
    await card("Bruno").getByRole("button", { name: "Guardar" }).click();
    await page.waitForTimeout(2500);
    if (await pinInput().count()) {
      await pinInput().fill(PIN);
      await page.getByRole("button", { name: "Desbloquear y continuar" }).click();
      await page.waitForTimeout(2500);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await T.step({ title: "Pagos del alquiler", text: "Desde ahí ves si está al día o cuánto debe. Cuando te paga, tocás «Registrar un pago», con el monto y cómo pagó. Si es en efectivo, puede entrar directo a la caja del día.", hl: card("Bruno").locator("summary", { hasText: "Registrar un pago" }) });

    // Fuera de cámara: un adelanto para Kevin (Finanzas, «Sueldos y adelantos»)
    await T.go(P + "/finanzas", { wait: 1000 });
    await page.getByRole("button", { name: "Sueldos y adelantos" }).first().click();
    await page.locator("select[name=barberId]").selectOption({ label: "Adelanto / sueldo de Kevin" });
    await T.fill(page.locator("input[name=description]"), "Adelanto");
    await T.fill(page.locator("input[name=amount]"), "30");
    await page.getByRole("button", { name: "Cargar gasto" }).click();
    await page.waitForTimeout(2500);

    // Recibo de pago
    await T.go(P + "/ganancias", { wait: 1000 });
    await T.tap(card("Kevin").getByRole("link", { name: "Ver recibo de pago" }), 2000);
    await T.step({ title: "Recibo de pago", text: "Tocás «Ver recibo de pago». Elegís el barbero y el período: esta semana, la pasada, este mes o las fechas que quieras. Te arma el recibo con sus clientes, su comisión, sus propinas y los adelantos que le diste.", hl: page.getByRole("link", { name: "Esta semana" }) });
    await T.fill(page.locator("input[name=description]"), "Llegó tarde el sábado");
    await T.fill(page.locator("input[name=amount]"), "20");
    await T.step({ title: "Multas y bonos", text: "Abajo cargás multas o bonos: elegís cuál, ponés el motivo y el monto, y se suma o se resta en el recibo. Cada uno queda registrado con quién lo cargó.", hl: page.getByRole("button", { name: "Descontar" }) });
    await T.tap(page.getByRole("button", { name: "Descontar" }), 2500);
    if (await pinInput().count()) {
      await pinInput().fill(PIN);
      await T.tap(page.getByRole("button", { name: "Desbloquear y continuar" }), 2500);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await T.step({ title: "Total a pagar", text: "Y así queda: lo que ganó, más propinas, menos el adelanto y la multa. Abajo está el total a pagar, con lugar para las dos firmas.", hl: T.text("Total a pagar", true) });
    await T.step({ title: "Por WhatsApp", text: "Arriba tocás «Mandar por WhatsApp» y se abre tu WhatsApp con el recibo ya escrito, listo para enviárselo. O tocás «Imprimir» si preferís dárselo en papel.", hl: page.getByRole("link", { name: "Mandar por WhatsApp" }) });

    // Auditoría: una venta anulada dice quién la anuló (se prepara fuera de cámara)
    await T.go(P + "/caja", { wait: 1000 });
    if (await page.locator("input[name=opening]").count()) {
      await T.fill(page.locator("input[name=opening]"), "200");
      await page.getByRole("button", { name: "Abrir caja" }).click();
      await page.waitForTimeout(2500);
    }
    await T.go(P + "/caja/venta", { wait: 1000 });
    await page.locator("li").filter({ hasText: "Corte clásico" }).getByRole("button", { name: "Agregar" }).click();
    await page.locator("section").filter({ hasText: "Servicios sin reserva" }).locator("select").selectOption({ label: "Luis" });
    await page.getByRole("button", { name: /Registrar venta/ }).click();
    await page.waitForTimeout(3000);
    await T.fill(page.locator("input[name=reason]"), "Cobro duplicado");
    await page.getByRole("button", { name: "Anular venta" }).click();
    await page.waitForTimeout(2500);
    if (await pinInput().count()) {
      await pinInput().fill(PIN);
      await page.getByRole("button", { name: "Desbloquear y continuar" }).click();
      await page.waitForTimeout(2500);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await T.step({ title: "¿Quién anuló?", text: "Última pregunta: ¿se puede saber quién anuló una venta? Sí. En la venta anulada dice cuándo, quién la anuló y por qué. Y en cada turno, el historial muestra quién hizo cada cambio. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", hl: T.text(/Anulada el .* por /) });
  },
};
