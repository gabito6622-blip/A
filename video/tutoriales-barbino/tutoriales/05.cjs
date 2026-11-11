// Esconde el aviso «Sin PIN de gerencia» ANTES de medir el recuadro (si no, el recuadro queda corrido).
const hideBanners = (page) => page.evaluate(() => {
  for (const e of document.querySelectorAll("body *")) {
    const h = e.getBoundingClientRect().height;
    if (e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp/.test(e.textContent) && h < 130 && h > 20 && !e.closest("[data-keep]")) e.style.display = "none";
  }
});
const wrap = (T) => { const step = T.step; T.step = async (o) => { await hideBanners(T.page).catch(() => {}); return step(o); }; };

module.exports = {
  number: 5,
  title: "La agenda del día a día",
  learn: ["El resumen de tu día", "Anotar una reserva", "Atender al que llega sin turno", "Llegó, no vino y reprogramar", "Turno fijo y cartel «Ya llegué»"],
  async capture(T) {
    wrap(T);
    const { page } = T;
    const base = "/imperio/panel/agenda";
    await T.login();
    await T.go("/imperio/panel");
    await T.step({ title: "Tu día", text: "Hola, ¿cómo andás? Hoy vemos lo que vas a usar todos los días: la agenda. Cuando entrás al panel, el Inicio te muestra el resumen de hoy: cuántos turnos tenés, cuántos ya atendiste y cuánto vas a hacer en el día.", hl: page.locator("section[aria-label='Resumen de hoy']").first() });
    await T.step({ title: "Lo que viene", text: "Más abajo está «Lo que viene hoy»: el próximo cliente, a qué hora, con qué barbero y qué servicio. Así sabés de un vistazo quién se sienta en la silla.", hl: T.text("Lo que viene hoy", true) });

    await T.go(base);
    await T.step({ title: "Agenda del día", text: "En «Agenda» ves todos los turnos del día en orden, con el estado de cada uno: confirmada, atendida, no vino. Con las flechitas pasás al día siguiente, y con «Hoy» volvés.", hl: page.locator("a:visible").filter({ hasText: /^Día$/ }) });
    await T.tap(T.text("Semana", true), 1500);
    await T.tap(page.getByRole("link", { name: "Kevin" }), 1500);
    await T.step({ title: "Semana y barbero", text: "Tocando «Semana» ves la semana entera. Y arriba elegís un barbero, por ejemplo Kevin, para ver solo sus turnos. Con «Todos» volvés a ver a todo el equipo.", hl: page.getByRole("link", { name: "Kevin" }) });

    // Nueva reserva desde el botón Reservar del menú
    await T.go("/imperio/panel");
    const navReservar = page.locator("nav").getByText("Reservar", { exact: true }).last();
    await T.step({ title: "¿Te escriben?", text: "¿Un cliente te escribe por WhatsApp o te llama para pedir turno? Lo anotás vos. Tocás el botón «Reservar» del menú de abajo.", hl: navReservar });
    await T.tap(navReservar, 1500);
    await page.locator("select[name=servicio]").selectOption({ label: "Corte clásico · 30 min · Bs 40" });
    await page.locator("select[name=barbero]").selectOption({ label: "Kevin" });
    await T.tap(T.text("Ver horarios", true), 2000);
    const firstSlot = page.locator("ul li a").filter({ hasText: /^\d\d:\d\d$/ }).first();
    await T.step({ title: "Servicio y horario", text: "Elegís el servicio, el barbero y la fecha, y te aparecen solo los horarios libres. Tocás el que te pidió el cliente.", hl: firstSlot });
    const hora = (await firstSlot.textContent()).trim();
    await T.tap(firstSlot, 1500);
    await T.fill(T.label("Nombre del cliente"), "Ramiro Justiniano");
    await T.fill(T.label("WhatsApp"), "71234567");
    await T.step({ title: "Datos del cliente", text: "Ponés su nombre y su WhatsApp, y tocás «Crear reserva confirmada». La reserva que cargás vos queda confirmada al toque y sin anticipo.", hl: T.text("Crear reserva confirmada") });
    await T.tap(T.text("Crear reserva confirmada"), 3000);
    const fichaUrl = page.url().split("?")[0];
    await T.step({ title: "La ficha del turno", text: "Esta es la ficha del turno. Arriba tenés «Cobrar» para pasarlo a la caja y «Reprogramar» por si el cliente te pide otro horario. Más abajo, el detalle, el precio y el WhatsApp del cliente." });

    // ¿Se pueden pisar dos turnos?
    const kevinId = new URL(page.url()).searchParams.get("barbero");
    await T.go("/imperio/panel/agenda/nueva");
    await page.locator("select[name=servicio]").selectOption({ label: "Corte clásico · 30 min · Bs 40" });
    await page.locator("select[name=barbero]").selectOption({ label: "Kevin" });
    await T.tap(T.text("Ver horarios", true), 1500);
    const u = new URL(page.url());
    u.searchParams.set("hora", hora);
    await T.go(u.pathname + u.search, { wait: 1200 });
    await T.step({ title: "¿Se pisan turnos?", text: "¿Y se pueden pisar dos turnos? No. Ese horario de Kevin ya no aparece como libre, y si alguien intenta tomarlo, el sistema le avisa que está ocupado. Ni desde el panel ni desde tu página se puede reservar dos veces lo mismo.", hl: T.text("Ese horario ya no está libre") });

    // Turno fijo
    await T.go(fichaUrl);
    await page.locator("select[name=weeks]").selectOption("4");
    await T.step({ title: "Turno fijo", text: "¿Tenés un cliente que viene siempre el mismo día? En la ficha está «Turno fijo»: elegís cuatro, ocho o doce semanas y tocás «Repetir cada semana». Se agenda solo, con el mismo barbero, servicio y hora.", hl: T.text("Repetir cada semana") });
    await T.tap(T.text("Repetir cada semana"), 3000);

    // Reprogramar
    await T.tap(page.getByRole("link", { name: "Reprogramar" }), 2000);
    await T.step({ title: "Reprogramar", text: "Si el cliente te pide cambiar el horario, tocás «Reprogramar», elegís el nuevo día y hora entre los libres, y confirmás el cambio. No hace falta cancelar y volver a crear.", hl: T.text("Nuevo horario", true) });

    // Cartel Ya llegué
    await T.go("/imperio/panel/ajustes/cartel?tipo=llegada", { wait: 1500 });
    await T.step({ title: "Cartel «Ya llegué»", text: "En Ajustes, «Cartel con QR», tenés el cartel «Ya llegué» para la puerta. Lo imprimís y lo pegás en la entrada.", hl: page.locator("a:visible").filter({ hasText: "«Ya llegué» (puerta)" }) });
    await T.go("/imperio/llegue", { wait: 1200 });
    await page.locator("input[name=phone]").fill("71234567");
    await T.tap(page.getByRole("button", { name: "Ya llegué" }), 2500);
    await T.step({ title: "El cliente avisa", text: "Cuando el cliente llega, escanea el QR con su celular, pone su número y toca «Ya llegué». En su turno queda marcado que llegó, y si tu barbero tiene los avisos activados, le llega un aviso al celular." });

    // ¿Y si se atrasa o no viene? Se leen los turnos de hoy desde la agenda (lista del celular).
    await T.go(base, { wait: 1200 });
    const now = await page.evaluate(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
    const items = [];
    for (const l of await page.locator("a:visible").filter({ hasText: "Confirmada" }).all()) {
      const t = ((await l.innerText()) || "").replace(/\s+/g, " ");
      const m = t.match(/(\d\d):(\d\d) (\d+) min .*· (Kevin|Diego|Luis|Bruno) /);
      if (m) items.push({ start: +m[1] * 60 + +m[2], end: +m[1] * 60 + +m[2] + +m[3], barber: m[4], href: await l.getAttribute("href") });
    }
    const started = items.filter((i) => i.start <= now - 3).pop();
    // Barbero que queda libre si se cancela UN turno (el que choca con los próximos 20 minutos).
    const win = (i) => i.start < now + 20 && i.end > now;
    let blocker = null;
    for (const b of ["Bruno", "Diego", "Luis", "Kevin"]) {
      const hits = items.filter((i) => i.barber === b && win(i));
      if (hits.length === 1) { blocker = hits[0]; break; }
      if (hits.length === 0 && !blocker) blocker = { barber: b, free: true };
    }
    if (!blocker) blocker = items.find(win);
    await T.go(started ? started.href : fichaUrl);
    await T.step({ title: "¿Se atrasa o no viene?", text: "¿Y si el cliente se atrasa o no viene? Cuando llega, tocás «Llegó». Al terminar, «Atendida». Y si no aparece, tocás «No vino»: queda en su historial, y si querés, en Ajustes le podés pedir anticipo al que falta seguido cuando reserve por tu página.", hl: page.getByRole("button", { name: "No vino" }) });
    if (blocker && !blocker.free) await T.go(blocker.href);
    await T.fill(page.locator("input[name=reason]"), "Avisó que no puede venir");
    await T.step({ title: "Cancelar", text: "Si el cliente te avisa que no viene, en su ficha tocás «Cancelar reserva», con el motivo si querés. El horario queda libre al toque para otro cliente.", hl: page.getByRole("button", { name: "Cancelar reserva" }) });
    if (blocker && !blocker.free) {
      await T.tap(page.getByRole("button", { name: "Cancelar reserva" }), 2500);
      // otros turnos del mismo barbero en la ventana (si los hubiera) se liberan igual
      for (const i of items.filter((i) => i.barber === blocker.barber && win(i) && i.href !== blocker.href)) {
        await T.go(i.href);
        await page.getByRole("button", { name: "Cancelar reserva" }).click();
        await page.waitForTimeout(2000);
      }
    }
    const who = blocker ? blocker.barber : "Bruno";

    // Atender ahora
    await T.go(base + "/ahora");
    await page.locator("label").filter({ hasText: who }).first().click();
    await page.locator("label").filter({ hasText: "Diseño / líneas" }).first().click();
    await T.step({ title: "Atender ahora", text: `¿Y el que entra sin reserva? Tocás «Atender ahora». Elegís quién lo atiende, acá ${who}, que justo quedó libre, y el servicio. El nombre y el WhatsApp son opcionales. Tocás «Empezar turno» y queda en la agenda desde ya.`, hl: T.text("Empezar turno") });
    await T.tap(page.getByRole("button", { name: "Empezar turno" }), 3000);
    if (!/agenda\/[0-9a-f-]{36}/.test(page.url())) throw new Error("Atender ahora: el barbero sigue ocupado");
    await T.step({ title: "Cobrar y listo", text: "Y cuando termina, tocás «Cobrar» y lo pasás a la caja; eso lo vemos en el próximo tutorial. Así de fácil manejás tu día. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", hl: page.getByRole("link", { name: "Cobrar" }) });
  },
};
