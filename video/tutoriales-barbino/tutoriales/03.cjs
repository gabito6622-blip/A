module.exports = {
  number: 3,
  title: "Cómo reservan tus clientes",
  learn: ["Tu página de reservas", "Reservar paso a paso", "Lista de espera", "Cancelar y volver a reservar", "El cartel con QR"],
  async capture(T) {
    const { page } = T;
    page.on("dialog", (d) => d.accept());
    const main = page.locator("main");

    // 1-2. La página pública
    await T.go("/imperio", { wait: 1500 });
    await T.step({ title: "Tu página", text: "Hola, ¿qué tal? Hoy vemos cómo reservan tus clientes. Esto es lo que ve el cliente cuando abre tu enlace o escanea tu QR: tu nombre, si estás abierto ahora y los próximos horarios libres.", hl: T.text("Reservar turno").first() });
    await T.step({ title: "¿Tiene que bajar algo?", text: "¿El cliente necesita bajar alguna aplicación? No. Abre tu página en el celular y listo. Ahí ve tus servicios con precio, tu equipo, las reseñas, el horario y cómo llegar.", long: 2600 });

    // 3. Servicio
    await T.go("/imperio/reservar");
    await T.step({ title: "1. El servicio", text: "Al tocar «Reservar turno», va paso a paso. Primero elige el servicio: ve el precio, cuánto dura y la foto si la cargaste.", hl: main.getByRole("link", { name: /Degradado \(fade\)/ }) });
    await T.tap(main.getByRole("link", { name: /Degradado \(fade\)/ }), 1500);

    // 4. Sumar otro servicio
    await T.step({ title: "Sumar otro servicio", text: "Si quiere algo más en el mismo turno, por ejemplo un diseño, lo suma con un toque. El sistema junta los tiempos y busca un horario donde entre todo.", hl: T.text("¿Sumás otro servicio al mismo turno?") });
    await T.tap(main.getByRole("link", { name: /Diseño \/ líneas/ }), 1500);

    // 5. Barbero
    await T.step({ title: "2. El barbero", text: "Después elige con quién: su barbero de siempre, por ejemplo Mateo, o «El primero libre», que le muestra más horarios porque busca entre todo el equipo.", hl: main.getByRole("link", { name: /Mateo/ }) });
    await T.tap(main.getByRole("link", { name: /Mateo/ }), 1500);

    // 6. Día y hora
    const days = page.locator("nav[aria-label='Elegir día'] a");
    await days.nth(1).click();
    await page.waitForTimeout(1500);
    const slot = page.locator("main ul.grid a").nth(4);
    const slotHref = await slot.getAttribute("href");
    await T.step({ title: "3. Día y hora", text: "Arriba elige el día, y abajo ve solo los horarios que de verdad están libres, según tus horarios, los descansos y los turnos que ya tenés.", hl: slot });
    await slot.click();
    await page.waitForTimeout(1500);

    // 7. Sus datos
    await T.fill(T.label("Tu nombre"), "Martín Pérez");
    await T.fill(T.label("Tu WhatsApp"), "70011001");
    await page.locator("input[name=accept]").check();
    await T.step({ title: "4. Sus datos", text: "Por último pone su nombre y su WhatsApp. No crea ninguna cuenta ni contraseña. Si tu barbería pide anticipo, le avisa cuánto es; eso lo vemos en el próximo tutorial. Toca «Confirmar reserva».", hl: T.role("button", "Confirmar reserva"), scrollY: 150 });

    // 8. No se pisan: otra persona confirma ese mismo horario un segundo antes
    const other = await page.context().newPage();
    await other.goto(T.B + slotHref, { waitUntil: "networkidle" });
    await other.getByLabel("Tu nombre").fill("Jorge Salinas");
    await other.getByLabel("Tu WhatsApp").fill("70011002");
    await other.locator("input[name=accept]").check();
    await other.getByRole("button", { name: "Confirmar reserva" }).click();
    await other.waitForURL(/\/reserva\//, { timeout: 15000 });
    await other.close();
    await T.tap(T.role("button", "Confirmar reserva"), 3500);
    await T.step({ title: "¿Y si piden lo mismo?", text: "¿Y si dos personas quieren el mismo horario? No se pisan nunca. El primero que confirma se lo queda, y al otro el sistema le avisa que ese horario se ocupó, para que elija otro.", hl: page.getByText(/acaba de ocuparse/).first(), scrollY: 120 });

    // 9. Elige otro horario y confirma
    await T.go(slotHref.replace(/&?hora=[^&]*/, ""), { wait: 1200 });
    await page.locator("main ul.grid a").nth(6).click();
    await page.waitForTimeout(1500);
    await T.fill(T.label("Tu nombre"), "Martín Pérez");
    await T.fill(T.label("Tu WhatsApp"), "70011001");
    await page.locator("input[name=accept]").check();
    await T.tap(T.role("button", "Confirmar reserva"), 4000);

    // 10-11. La página de la reserva
    await T.step({ title: "Su reserva", text: "Elige otro horario, confirma, y queda en la página de su reserva, con el servicio, el día, la hora y el barbero. Es su enlace privado: si lo guarda, vuelve cuando quiera.", hl: page.locator("section").first() });
    await T.step({ title: "¿Puede cancelar solo?", text: "¿Puede cancelar solo? Sí, desde acá, hasta cuatro horas antes, o lo que vos pongas en Ajustes. Después de eso, o para cambiar el horario, te escribe por WhatsApp. Y con «Reservar lo mismo otra vez» repite su corte en segundos.", hl: T.text("Reservar lo mismo otra vez"), scrollY: 120 });

    // 11. Lista de espera
    await T.go("/imperio/reservar");
    await T.tap(main.getByRole("link", { name: /Corte \+ barba/ }), 1500);
    await T.tap(main.getByRole("link", { name: /Kevin/ }), 1500);
    const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }));
    await T.go(page.url().replace(/&?fecha=[^&]*/, "") + "&fecha=" + today, { wait: 1200 });
    await T.fill(T.label("Tu nombre"), "Rodrigo Vaca");
    await T.fill(T.label("Tu WhatsApp"), "70011003");
    await T.fill(T.label("¿A qué hora te sirve? (opcional)"), "Después de las 18:00");
    await T.step({ title: "Lista de espera", text: "¿Y si no hay horario que le sirva? Se anota en la lista de espera con su nombre, su WhatsApp y la hora que prefiere. Así no se va a otra barbería.", hl: T.text("Avisame si se libera un lugar"), scrollY: -60 });
    await T.tap(T.role("button", "Anotarme"), 2500);

    // 12. Página del barbero
    await T.go("/imperio", { wait: 1200 });
    const perfil = page.getByRole("link", { name: "Ver perfil" }).first();
    const perfilHref = await perfil.getAttribute("href");
    await T.go(perfilHref, { wait: 1500 });
    await T.step({ title: "Página de cada barbero", text: "Cada barbero tiene su propia página, con su foto, su especialidad, sus trabajos y lo que opinan de él. Él la puede compartir en su Instagram y le reservan directo.", long: 1700 });

    // 13. Panel: quién espera
    await T.login();
    await T.go("/imperio/panel/avisos", { wait: 1200 });
    await T.step({ title: "Te llega solo", text: "¿Y vos cómo te enterás? Cada reserva entra sola a tu agenda, al barbero que eligió. Con la campanita de arriba ves las novedades: reservas nuevas, quién se anotó en la lista de espera y más.", hl: page.locator("main li", { hasText: "Reserva nueva de Martín" }).first() });
    await T.go("/imperio/panel/huecos?dia=" + today, { wait: 1200 });
    await T.step({ title: "Quién está esperando", text: "En tu panel, en «Huecos libres», ves quién se anotó en la lista de espera. Cuando se libera un lugar, le avisás por WhatsApp con un toque.", hl: page.locator("li", { hasText: "Rodrigo" }).first() });

    // 14. Cartel
    await T.go("/imperio/panel/ajustes/cartel", { wait: 1200 });
    await T.step({ title: "Cartel con QR", text: "Y para que te reserven desde el local: en Ajustes, «Carteles con QR», tenés un cartel listo con tu logo. Tocás «Imprimir cartel» y lo ponés en el mostrador o en el espejo. El cliente escanea con la cámara y reserva.", hl: T.text("Imprimir cartel") });

    await page.evaluate(() => scrollTo(0, 420));
    await T.step({ title: "¡A reservar!", text: "Así de fácil reservan tus clientes, de día o de noche, sin llamarte ni escribirte. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", scrollY: 420 });
  },
};
