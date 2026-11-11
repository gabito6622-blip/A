// Tutorial 08 — Tus clientes: lista, ficha, importar, «Ya les toca», fidelidad y reseñas.
const blurUrlPlaceholders = (page) =>
  page.evaluate(() => {
    for (const i of document.querySelectorAll("input,textarea")) if (/https?:|\.com|\.gl/i.test(i.placeholder || "")) i.style.filter = "blur(7px)";
  });

// Oculta los avisos de arriba ANTES de medir el recuadro (si no, el recuadro queda corrido).
const hideBanners = (page) =>
  page.evaluate(() => {
    for (const e of document.querySelectorAll("body *")) {
      const h = e.getBoundingClientRect().height;
      if (e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp|Modo gerencia (activo|bloqueado)/.test(e.textContent) && h < 130 && h > 20) e.style.display = "none";
    }
  });
// Prepara el PIN de gerencia (4718) y desbloquea el modo gerencia, sin mostrarlo en el video.
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
  number: 8,
  title: "Tus clientes",
  learn: ["Buscar y ordenar tu lista", "La ficha de cada cliente", "Importar desde Excel o el celular", "Traer de vuelta a los que no vienen", "Sellos de fidelidad y reseñas"],
  async capture(T) {
    const { page } = T;
    const step = T.step;
    T.step = async (o) => { await hideBanners(page); await step(o); };
    await T.login();
    await gerencia(T);

    // 1. Lista
    await T.go("/imperio/panel/clientes");
    await T.step({ title: "Tus clientes", text: "Hola, ¿qué tal? Hoy vemos tus clientes. En «Más», «Clientes», tenés a todos los que alguna vez reservaron. No tenés que cargarlos: cada vez que alguien reserva por tu página, queda registrado solo." });
    await T.step({ title: "Grupos y búsqueda", text: "Arriba los ves por grupo: nuevos, frecuentes, los que hace rato no vienen. Y en el buscador ponés un nombre o un número de WhatsApp y lo encontrás al toque.", hl: T.page.locator("input[name=q]") });
    await T.tap(page.locator("a", { hasText: /^VIP/ }), 1500);
    await T.step({ title: "Etiquetas", text: "Las etiquetas te sirven para separar a tu gente. Por ejemplo, tocás «VIP» y te quedan solo esos clientes. Vos elegís las etiquetas: VIP, niño, barba, lo que quieras.", hl: page.locator("a", { hasText: /^VIP/ }) });

    // 2. Nuevo cliente
    await T.go("/imperio/panel/clientes/nuevo");
    await T.fill(T.label("Nombre"), "Mateo Quiroga");
    await T.fill(page.locator("input[name=phone]"), "70123456");
    await T.step({ title: "Nuevo cliente", text: "¿Y el cliente que no reservó por la página? Tocás «Nuevo cliente» y ponés su nombre y su WhatsApp. Si ese número ya estaba, no se crea otro: te lleva a la ficha que ya existe.", hl: page.locator("input[name=phone]") });
    await T.fill(page.locator("textarea[name=preferences]"), "Degradado bajo, tijera arriba.");
    await T.fill(page.locator("textarea[name=privateNotes]"), "Siempre llega diez minutos tarde.");
    await T.fill(page.locator("input[name=tags]"), "VIP");
    await T.step({ title: "Notas privadas", text: "Abajo anotás cómo le gusta el corte, que lo ve todo el equipo. Y las observaciones internas, que son privadas: solo las ven el dueño y el gerente. Si aceptó recibir promociones, marcás la casilla.", hl: page.locator("textarea[name=privateNotes]") });
    await T.tap(T.text("Crear cliente"), 3000);

    // 3. Ficha
    await T.go("/imperio/panel/clientes?q=Iv%C3%A1n");
    await T.tap(T.text("Iván Justiniano"), 2500);
    await T.step({ title: "La ficha", text: "Así se ve la ficha de un cliente. Cuántas veces vino, cuándo fue la última, cada cuántos días suele venir y su próxima reserva. Abajo está todo su historial: turnos, servicios y compras.", long: 1500 });

    // 4. Importar
    await T.go("/imperio/panel/clientes/importar");
    await T.step({ title: "Importar", text: "Una pregunta que siempre me hacen: ya tengo mis clientes en el celular, ¿los tengo que cargar uno por uno? No. Tocás «Importar» y traés tu lista de Excel, o los contactos que exportás del celular." });
    await T.fill(page.locator("#import-text"), "Nombre\tTeléfono\nRamiro Flores\t70011223\nTomás Vargas\t70022334\nCarlos Méndez\t71000000\nPedro\t123");
    await T.tap(T.role("button", "Revisar"), 2500);
    await T.step({ title: "Revisar antes", text: "Antes de guardar, Barbiño te muestra cuántos son nuevos, cuántos ya estaban y qué filas tienen problemas, por ejemplo un número mal escrito. Los que ya estaban no se tocan, así que nada se duplica.", hl: T.text("Nuevos para importar") });
    await T.tap(T.role("button", /Importar 2 clientes/), 3000);

    // 5. Ya les toca
    await T.go("/imperio/panel/clientes/volver");
    await T.step({ title: "Ya les toca", text: "Ahora, «Ya les toca». Acá aparecen los clientes que ya deberían haber vuelto según su ritmo y no tienen reserva. Te dice hace cuánto vino, cada cuánto suele venir y con quién se cortó.", long: 1300 });
    await T.step({ title: "Invitar por WhatsApp", text: "Tocás «Invitar por WhatsApp» y se abre tu WhatsApp con el mensaje escrito y el enlace para reservar. Solo lo revisás y lo mandás.", hl: T.text("Invitar por WhatsApp") });
    await T.go("/imperio/panel/clientes?q=Mateo");
    await T.tap(T.text("Mateo Quiroga"), 2500);
    await page.evaluate(() => document.querySelector("aside.space-y-4")?.scrollIntoView());
    await page.waitForTimeout(400);
    await T.step({ title: "¿Promos a todos?", text: "¿Le puedo mandar promos a todos? No: solo a los que aceptaron. Mirá, Mateo no aceptó promociones, entonces en su ficha te avisa que le escribas solo por sus reservas, y en «Ya les toca» no aparece el botón de invitar.", hl: T.text("No aceptó promociones") });

    // 6. Fidelidad
    await T.go("/imperio/panel/ajustes/fidelidad");
    await page.locator("input[name=enabled]").check({ force: true });
    await T.step({ title: "Tarjeta de sellos", text: "Vamos a la tarjeta de fidelidad, en «Ajustes», «Fidelidad». La activás, ponés cuántas visitas hacen falta, lo más común son diez, y el premio, por ejemplo un corte gratis. Cada visita atendida suma un sello sola.", hl: T.text("Tarjeta de fidelidad activada") });
    await T.tap(T.role("button", "Guardar"), 2500);
    await T.go("/imperio/panel/clientes?q=Iv%C3%A1n");
    await T.tap(T.text("Iván Justiniano"), 2500);
    await T.step({ title: "Canjear el premio", text: "En la ficha del cliente ves su tarjeta. Cuando la completa, aparece «Entregar premio». Lo tocás al darle su corte gratis, y la tarjeta vuelve a empezar.", hl: T.text("Entregar premio") });

    // 7. Reseñas
    await T.go("/imperio/panel/clientes?q=Carlos%20M%C3%A9ndez");
    await T.tap(T.text("Carlos Méndez"), 2500);
    await T.tap(page.locator("a", { hasText: "Atendida" }).first(), 2500);
    await T.step({ title: "Pedir reseña", text: "Las reseñas. Abrís un turno que ya atendiste y tocás «Pedir reseña por WhatsApp». Le llega un enlace privado y el cliente opina en diez segundos, sin crear ninguna cuenta.", hl: T.text("Pedir reseña por WhatsApp") });
    await T.go("/imperio/panel/resenas");
    await T.step({ title: "Tus reseñas", text: "En «Reseñas» ves tu promedio de estrellas, cuántas tenés de cada una y cómo le va a cada barbero. Y abajo, lo que escribió cada cliente. Si alguna no te gusta, la podés ocultar de tu página.", long: 1500 });
    await T.go("/imperio/panel/ajustes/pagina");
    await blurUrlPlaceholders(page);
    await T.step({ title: "Reseñas en Google", text: "¿Y Google? En «Ajustes», «Página pública», pegás el enlace de reseñas de tu perfil de Google. Así, al que te pone cuatro o cinco estrellas, Barbiño le ofrece dejarla también en Google. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", hl: T.label("Enlace para reseñas en Google (opcional)") });
  },
};
