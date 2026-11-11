module.exports = {
  number: 1,
  title: "Qué es Barbiño y cómo empiezo",
  learn: ["Qué es Barbiño", "Cómo registrar tu barbería", "Los primeros pasos", "Preguntas frecuentes"],
  async capture(T) {
    const { page } = T;
    await T.go("/");
    await T.step({ title: "Qué es Barbiño", text: "Hola, ¿qué tal? Te cuento qué es Barbiño. Es un sistema para manejar tu barbería desde el celular: la agenda, las reservas, la caja, tus clientes, tu equipo y WhatsApp, todo en un solo lugar. No tenés que instalar nada: funciona desde el navegador, en el celular o en la compu." });
    await T.step({ title: "Probar gratis", text: "Para empezar, tocás «Probar gratis». Tenés catorce días para usar todo, sin poner ninguna tarjeta, y nada se cobra solo.", hl: T.text("Probar gratis") });
    await T.tap(T.text("Probar gratis"), 1500);
    if (!page.url().includes("registro")) await T.go("/registro");
    await T.fill(T.label("Nombre de la barbería"), "Barbería El Corte");
    await T.fill(T.label("Dirección web"), "el-corte");
    await T.fill(T.label("Ciudad"), "Santa Cruz");
    await T.step({ title: "Datos de tu barbería", text: "Primero ponés el nombre de tu barbería, el nombre corto que va a tener tu página de reservas, por ejemplo «el corte», y tu ciudad.", hl: T.label("Nombre de la barbería") });
    await T.step({ title: "Plan y país", text: "Elegís con qué plan querés probar. Tranquilo, después lo podés cambiar, y durante la prueba tenés todo habilitado. Si estás en Bolivia, la moneda y la hora ya vienen listas.", hl: page.locator("select[name=planCode]") });
    await T.fill(T.label("Tu nombre"), "Martín Suárez");
    await T.fill(T.label("Correo"), "martin@elcorte.test");
    await T.fill(page.locator("input[name=password]"), "ElCorte2026!demo");
    await T.fill(page.locator("input[name=password2]"), "ElCorte2026!demo");
    await page.locator("input[name=terms]").check();
    await T.step({ title: "Tu cuenta", text: "Después van tus datos: tu nombre, tu correo y una contraseña de al menos diez caracteres. Aceptás las condiciones y tocás «Crear mi barbería».", hl: T.text("Crear mi barbería") });
    await T.tap(T.text("Crear mi barbería"), 5000);
    await T.step({ title: "Tu panel", text: "¡Y listo! Ya estás adentro de tu panel. Esta es la pantalla de inicio, donde vas a ver el resumen de tu día." });
    await T.step({ title: "Puesta en marcha", text: "Acá abajo aparece «Puesta en marcha», con los pasos que te faltan para dejar todo listo: cargar tus servicios, tus barberos, los horarios, el anticipo y la apariencia de tu página. Los vemos uno por uno en el próximo tutorial.", hl: T.text("Puesta en marcha") });
    await T.step({ title: "El menú", text: "Abajo tenés el menú: Inicio, Agenda, el botón grande para reservar, la Caja, y en «Más» está todo lo demás.", hl: T.text("Más", true).last() });
    await T.go("/imperio");
    await T.step({ title: "¿El cliente baja una app?", text: "Una pregunta que siempre me hacen: ¿el cliente tiene que bajar una aplicación? No. Tu cliente abre tu página desde un enlace o escaneando un QR, y reserva sin crear ninguna cuenta. Así se ve la página de una barbería." });
    await T.go("/#planes", { wait: 1800 });
    await page.evaluate(() => document.getElementById("planes")?.scrollIntoView());
    await page.waitForTimeout(1500);
    await T.step({ title: "Planes", text: "Otra pregunta: ¿cuánto cuesta? Hay un plan gratis para el barbero que trabaja solo, y planes para equipos más grandes, con más funciones. Si pagás el año completo, tenés descuento. Y si te atrasás con el pago, nunca se pierden tus datos." });
    await page.evaluate(() => document.getElementById("seguridad")?.scrollIntoView());
    await page.waitForTimeout(1200);
    await T.step({ title: "¿Están seguros mis datos?", text: "¿Y si se me rompe el celular? No pasa nada: tus datos no están en el teléfono, están guardados en el servidor. Entrás desde otro celular y sigue todo igual. Y ninguna otra barbería puede ver a tus clientes: cada una está separada. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!" });
  },
};
