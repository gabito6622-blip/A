// Tutorial 09 — WhatsApp y avisos: bandeja, configuración, huecos libres, avisos, resumen del día e instalar la app.
// Oculta los avisos de arriba ANTES de medir el recuadro (si no, el recuadro queda corrido),
// y los avisos técnicos para quien administra el sistema (no son para el barbero).
const hideBanners = (page) =>
  page.evaluate(() => {
    for (const e of document.querySelectorAll("body *")) {
      const h = e.getBoundingClientRect().height;
      if (e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp|Modo gerencia (activo|bloqueado)/.test(e.textContent) && h < 130 && h > 20) e.style.display = "none";
    }
    for (const e of document.querySelectorAll("[role=alert], .rounded-xl, .rounded-2xl"))
      if (/WHATSAPP_ENCRYPTION_KEY|npm run|claves VAPID/.test(e.textContent) && e.getBoundingClientRect().height < 260) e.style.display = "none";
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
  number: 9,
  title: "WhatsApp y avisos",
  learn: ["Mandar recordatorios con un toque", "Configurar tu número y tus mensajes", "Llenar los huecos libres", "Avisos y resumen del día", "Barbiño como app en el celular"],
  async capture(T) {
    const { page } = T;
    const step = T.step;
    T.step = async (o) => { await hideBanners(page); await step(o); };
    await T.login();
    await gerencia(T);

    // 1. Bandeja
    await T.go("/imperio/panel/whatsapp");
    await T.step({ title: "La bandeja", text: "Hola, ¿qué tal? Hoy vemos WhatsApp y los avisos. En «Más», «WhatsApp», está tu bandeja del día: los recordatorios de turnos ya escritos, listos para mandar. Arriba ves cuántos hay para ahora, para más tarde y cuántos ya resolviste." });
    const first = page.locator("article").first();
    await T.step({ title: "Abrir en WhatsApp", text: "Cada mensaje ya viene armado con el nombre del cliente, el servicio, el barbero, el día, la hora y tu dirección. Si querés, cambiás algo. Tocás «Abrir en WhatsApp» y se abre tu WhatsApp con el texto escrito.", hl: first.getByRole("button", { name: /Abrir en WhatsApp/ }), scrollY: 260 });
    const popup = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
    await first.getByRole("button", { name: /Abrir en WhatsApp/ }).click();
    const p2 = await popup;
    await page.waitForTimeout(2500);
    if (p2) await p2.close().catch(() => {});
    await page.bringToFront();
    await T.go("/imperio/panel/whatsapp");
    await T.step({ title: "Marcar como enviado", text: "Lo mandás desde tu teléfono y volvés: tocás «Marcar como enviado» y sale de la lista. Así sabés a quién ya le escribiste, aunque lo haya mandado otro del equipo.", hl: () => page.getByRole("button", { name: /Marcar como enviado/ }) });
    await page.getByRole("button", { name: /Marcar como enviado/ }).first().click();
    await page.waitForTimeout(2500);
    await T.go("/imperio/panel/whatsapp/historial");
    await T.step({ title: "Historial", text: "¿Los mensajes se mandan solos? En el modo normal, no: Barbiño te los prepara y vos los mandás desde tu WhatsApp. En «Historial» queda anotado cada mensaje: quién lo abrió, cuándo y qué decía." });

    // 2. Configuración
    await T.go("/imperio/panel/whatsapp/configuracion");
    await T.fill(page.locator("input[name=whatsappPhone]"), "+591 7000 0000");
    await T.step({ title: "Tu número", text: "En «Configuración» cargás el WhatsApp de tu local, con el código de país. ¿Necesito WhatsApp Business? No: sirve tu número normal o el de Business. Ese número lo ven tus clientes en tu página.", hl: page.locator("input[name=whatsappPhone]"), scrollY: 250 });
    await T.tap(T.role("button", "Guardar número"), 2500);
    await T.step({ title: "Recordatorios", text: "Más abajo elegís cuándo aparece cada recordatorio en la bandeja: por ejemplo, uno veinticuatro horas antes y otro dos horas antes. Y si querés que te avise cuando alguien cancela o cambia de horario.", hl: page.locator("select[name=reminderFirstHours]") });
    await page.evaluate(() => document.getElementById("plantillas-seccion")?.scrollIntoView());
    await page.waitForTimeout(400);
    await T.step({ title: "Plantillas", text: "Y en «Plantillas» escribís los mensajes con tu estilo. Las palabras entre llaves, como cliente o fecha, se completan solas en cada reserva. Abajo ves cómo le va a llegar.", hl: page.locator("textarea").first() });
    await T.text("WhatsApp oficial de Meta").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, -120));
    await T.step({ title: "¿Cuesta algo?", text: "¿Cuesta algo? Mandarlos vos desde tu WhatsApp es gratis. Si querés que salgan solos, existe la conexión oficial de WhatsApp, que es opcional: Meta cobra unos centavos de dólar por mensaje y pide un chip aparte. Esa la configuramos juntos." });

    // 3. Huecos libres
    await T.go("/imperio/reservar");
    await T.tap(T.text("Corte clásico").first(), 1500);
    const any = page.getByText("El primero libre").first();
    if (await any.count()) await T.tap(any, 1500);
    const wl = page.getByText(/Avisame si se libera/).first();
    if (await wl.count()) await T.tap(wl, 1000);
    await T.fill(page.locator("input[name=name]"), "Rolando Paz");
    await T.fill(page.locator("input[name=phone]"), "70055667");
    await T.fill(page.locator("input[name=note]"), "Después de las 18:00");
    await T.step({ title: "Lista de espera", text: "Ahora, los huecos libres. Cuando un cliente no encuentra horario en tu página, se puede anotar en la lista de espera: deja su nombre, su WhatsApp y a qué hora le sirve.", hl: page.locator("input[name=name]") });
    await T.tap(page.locator("form", { has: page.locator("input[name=note]") }).getByRole("button").last(), 2500);
    await T.go("/imperio/panel/huecos");
    await T.step({ title: "Huecos libres", text: "En «Huecos libres» ves quién está esperando cada día y qué horarios le quedan libres. Si alguien cancela, tocás «Avisar por WhatsApp» y le llega el mensaje con el enlace para reservar.", hl: T.text("Avisar por WhatsApp") });
    await T.text("Oferta de último momento").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, -80));
    await T.step({ title: "Último momento", text: "Y abajo está la oferta de último momento: un mensaje con los lugares que te quedan hoy. Tocás «Compartir en WhatsApp» y lo subís a tus estados o a tus grupos.", hl: T.text("Compartir en WhatsApp"), scrollY: 250 });

    // 4. Avisos
    await T.go("/imperio/panel");
    await T.step({ title: "La campanita", text: "Arriba, en la campanita, están los avisos del panel.", hl: page.locator('a[aria-label="Avisos"]') });
    await T.tap(page.locator('a[aria-label="Avisos"]').first(), 2000);
    await T.step({ title: "Avisos", text: "Acá ves lo nuevo de la semana: las reservas que entraron por tu página, los comprobantes de anticipo para revisar, las reseñas y quién se anotó para esperar un lugar." });
    await T.tap(T.text("espera un lugar").first(), 2500);
    await T.step({ title: "Avisos al celular", text: "Tocás un aviso y vas directo a lo que pasó. Y en la pantalla de Avisos, con «Activar avisos», también te llega al celular apenas entra una reserva o un comprobante, aunque tengas el panel cerrado. Se activa en cada teléfono; en iPhone, primero instalás la app." });

    // 5. Resumen e instalar
    await T.go("/imperio/panel");
    await T.step({ title: "Resumen del día", text: "Al final del día, en el inicio tenés el resumen: lo cobrado, los atendidos, quién faltó y cuánto hizo cada barbero. Con «Mandar el resumen por WhatsApp» se lo mandás a tu socio o a tu grupo.", hl: T.text("Mandar el resumen por WhatsApp") });
    await page.evaluate(() => scrollTo(0, 0));
    await T.step({ title: "Instalar la app", text: "Y un truco: abrí el panel en el celular, tocá el menú del navegador y elegí «Agregar a la pantalla de inicio». Te queda un ícono con el nombre de tu barbería, como una app. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", scrollY: 0 });
  },
};
