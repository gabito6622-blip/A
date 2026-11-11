const path = require("node:path");
const A = (f) => path.resolve(__dirname, "..", "assets-a", f);
const PIN = "3907";

module.exports = {
  number: 2,
  title: "Configurá tu barbería",
  learn: ["Servicios, precios y fotos", "Barberos y horarios", "Feriados y vacaciones", "Tu PIN de gerencia", "Tu página y sus colores"],
  async capture(T) {
    const { page } = T;
    page.on("dialog", (d) => d.accept());
    await T.login();

    // 1. Inicio: Puesta en marcha
    await T.go("/imperio/panel");
    await T.step({ title: "Configurá tu barbería", text: "Hola, ¿cómo va? Hoy dejamos tu barbería lista: servicios, barberos, horarios, tu PIN de gerencia, tu página y los colores. En el inicio, «Puesta en marcha» te marca lo que todavía te falta.", hl: T.text("Puesta en marcha"), scrollY: -40 });

    // 2. Crear el PIN
    await T.go("/imperio/panel/gerencia");
    await T.fill(page.locator("input[name=pin]").last(), PIN);
    await T.fill(page.locator("input[name=pinConfirm]"), PIN);
    await T.fill(page.locator("input[name=currentPassword]"), "DemoBarber2026!");
    await T.step({ title: "Tu PIN de gerencia", text: "Lo primero: tu PIN de gerencia, cuatro números que solo sabés vos. Protege lo delicado: precios, tu equipo, los ajustes, anular ventas y el inventario. Lo ponés dos veces, tu contraseña, y tocás «Crear PIN».", hl: T.role("button", "Crear PIN") });
    await T.tap(T.role("button", "Crear PIN"), 2500);
    await T.go("/imperio/panel/gerencia");
    await T.fill(page.locator("input[name=pin]").first(), PIN);
    await T.step({ title: "Abrir con el PIN", text: "Cuando vas a cambiar algo de eso, ponés tu PIN y queda abierto diez minutos, solo en ese celular. Si alguien lo erra cinco veces, se bloquea un rato. Y cada cambio queda registrado con tu nombre.", hl: T.role("button", "Desbloquear modo gerencia") });
    await T.tap(T.role("button", "Desbloquear modo gerencia"), 2500);

    // 3. Servicios
    await T.go("/imperio/panel/servicios");
    await T.step({ title: "Tus servicios", text: "Ahora, tus servicios. En «Más», «Servicios», ves cada uno con su precio y cuánto dura. Para sumar uno nuevo, tocás «Nuevo servicio».", hl: T.text("Nuevo servicio") });
    await T.go("/imperio/panel/servicios/nuevo");
    await T.fill(T.label("Nombre del servicio"), "Corte + lavado");
    await T.fill(page.locator("input[name=price]"), "55");
    await T.fill(page.locator("input[name=durationMin]"), "40");
    await T.step({ title: "Precio y duración", text: "Ponés el nombre, el precio en bolivianos y cuánto dura: ese tiempo se aparta en la agenda. Si después necesitás unos minutos para limpiar, los ponés en «Preparación», y el cliente no los ve.", hl: page.locator("input[name=price]") });
    await page.locator("input[name=photos]").setInputFiles(A("servicio.jpg"));
    await T.fill(page.locator("textarea[name=description]"), "Lavado, corte a tijera y máquina, y peinado.");
    await page.waitForTimeout(500);
    await T.step({ title: "Fotos del servicio", text: "Abajo subís fotos de tus trabajos. La primera es la portada, y es lo que ve tu cliente cuando elige. Tocás «Crear servicio» y listo.", hl: T.role("button", "Crear servicio"), scrollY: 220 });
    await T.tap(T.role("button", "Crear servicio"), 4000);

    // 4. Desactivar sin borrar
    await T.go("/imperio/panel/servicios");
    const nino = page.locator("li", { has: page.getByRole("heading", { name: "Corte niño" }) });
    await T.step({ title: "Pausar un servicio", text: "¿Y si querés dejar de ofrecer un servicio sin borrarlo? Tocás «Desactivar». Deja de aparecer para reservar, pero guarda todo su historial, y lo reactivás cuando quieras.", hl: nino.getByRole("button", { name: "Desactivar" }) });
    await T.tap(nino.getByRole("button", { name: "Desactivar" }), 2500);

    // 5. Barberos
    await T.go("/imperio/panel/barberos");
    await T.step({ title: "Tu equipo", text: "Vamos con tu equipo. En «Barberos» están los que atienden, y cuántos podés tener depende de tu plan. Para sumar a alguien, tocás «Agregar barbero».", hl: T.text("Agregar barbero") });
    await T.go("/imperio/panel/barberos/nuevo");
    await page.locator("input[name=photo]").setInputFiles(A("barbero.jpg"));
    await T.fill(T.label("Nombre"), "Mateo");
    await T.fill(T.label("Especialidad"), "Fade y degradados");
    await page.waitForTimeout(400);
    await T.step({ title: "Foto y especialidad", text: "Subís su foto, ponés el nombre y la especialidad: elegís una de la lista o escribís la tuya. Eso sale en tu página, así el cliente sabe con quién se atiende.", hl: T.label("Especialidad") });
    await T.tap(T.role("button", "Agregar barbero").last(), 3500);

    // 6. Horarios
    await T.go("/imperio/panel/horarios");
    await T.step({ title: "Horario del local", text: "Ahora los horarios. En «Horarios y descansos» va primero el horario general: marcás qué días abrís, a qué hora abrís y cerrás, y si hay descanso al mediodía.", hl: page.locator("li", { hasText: "Lunes" }).first() });
    const mateo = page.getByRole("link", { name: "Mateo" });
    await mateo.click();
    await page.waitForTimeout(1500);
    const own = page.locator("form").filter({ has: page.getByRole("button", { name: "Crear horario propio" }) });
    await own.locator("input[name=open_1]").uncheck();
    await page.waitForTimeout(300);
    await T.step({ title: "¿Trabaja otros días?", text: "¿Y si un barbero trabaja otros días? Abajo lo elegís y le armás su horario propio. Por ejemplo, Mateo no viene los lunes: lo desmarcás y tocás «Crear horario propio». Los demás siguen con el general.", hl: own.locator("li").first() });
    await T.tap(T.role("button", "Crear horario propio"), 2500);

    // 7. Feriado
    await T.go("/imperio/panel/horarios#bloqueos");
    await page.locator("select[name=kind]").selectOption("HOLIDAY");
    await page.locator("input[name=allDay]").check({ force: true });
    await T.fill(page.locator("input[name=startDate]"), "2026-12-25");
    await T.fill(page.locator("input[name=reason]"), "Navidad");
    await T.step({ title: "¿Y un feriado?", text: "¿Y si cerrás un feriado? En «Nuevo descanso o bloqueo» elegís «Feriado», todo el local, día completo y la fecha. Ese día nadie puede reservar. Para las vacaciones de un barbero es igual, eligiéndolo a él.", hl: page.locator("select[name=kind]") });
    await T.tap(T.role("button", "Agregar bloqueo"), 2500);
    await T.step({ title: "Próximos bloqueos", text: "Abajo te queda la lista de bloqueos que vienen. Si cambiás de idea, lo borrás con el tachito y ese día vuelve a estar disponible.", hl: page.locator("li", { hasText: "Navidad" }), scrollY: 120 });

    // 8. Página pública
    await T.go("/imperio/panel/ajustes/pagina");
    await T.fill(T.label("Frase de presentación"), "Cortes con oficio en el corazón de Santa Cruz");
    await T.fill(T.label("Sobre la barbería"), "Barbería de barrio con más de diez años. Cortes clásicos, degradados y barba con toalla caliente.");
    await T.fill(T.label("Dirección"), "Av. Cañoto 345, zona centro");
    await T.fill(T.label("Instagram (opcional)"), "@barberiaimperio");
    await T.step({ title: "Tu página", text: "Ahora tu página. En Ajustes, «Página pública», ponés una frase de presentación, unas líneas sobre tu barbería, la dirección, el enlace del mapa si lo tenés, y tu Instagram.", hl: T.label("Frase de presentación"), scrollY: 120 });
    await T.tap(T.role("button", "Guardar").first(), 2500);
    await T.step({ title: "Secciones", text: "Más abajo elegís qué secciones se ven y en qué orden. Por ejemplo, poner los trabajos primero si tu fuerte son las fotos. Lo que no tiene contenido no se muestra.", hl: T.text("Secciones de tu página"), scrollY: 220 });

    // 9. Apariencia
    await T.go("/imperio/panel/ajustes/apariencia");
    const estilo = page.getByRole("radio", { name: /Negro y oro/ }).or(page.locator("label,button", { hasText: "Negro y oro" }));
    await T.step({ title: "Estilos listos", text: "En «Apariencia» está lo lindo. Hay estilos listos, como «Negro y oro» o «Poste clásico»: con un toque cambian los colores, las letras y el modo claro u oscuro.", hl: estilo });
    await estilo.first().click();
    await page.waitForTimeout(500);
    await page.locator("input[name=logo]").setInputFiles(A("logo.png"));
    await page.waitForTimeout(500);
    await T.step({ title: "Logo, colores y letras", text: "Después ajustás lo que quieras: subís tu logo y una portada, elegís el color principal y la tipografía de los títulos. Tocás «Guardar apariencia» y se aplica en tu página.", hl: T.text("Elegir logo"), scrollY: -120 });
    await T.tap(T.role("button", "Guardar apariencia"), 6000);

    // 10. Cierre
    await T.go("/imperio", { wait: 1500 });
    await T.step({ title: "¡Lista!", text: "Y así queda tu página, con tu logo y tus colores. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!" });
  },
};
