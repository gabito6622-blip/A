const path = require("node:path");
const A = (f) => path.resolve(__dirname, "..", "assets-a", f);
const PIN = "3907";

module.exports = {
  number: 4,
  title: "Anticipo por QR",
  learn: ["Activar el anticipo", "Tu QR del banco", "Revisar y aprobar comprobantes", "Comprobantes repetidos o falsos", "Clientes sin anticipo"],
  async capture(T) {
    const { page } = T;
    page.on("dialog", (d) => d.accept());
    const main = page.locator("main");

    // Entrar y abrir el modo gerencia (si el PIN no existe todavía, se crea).
    await T.login();
    await T.go("/imperio/panel/gerencia");
    if (await page.getByRole("button", { name: "Crear PIN" }).count()) {
      await page.locator("input[name=pin]").last().fill(PIN);
      await page.locator("input[name=pinConfirm]").fill(PIN);
      await page.locator("input[name=currentPassword]").fill("DemoBarber2026!");
      await page.getByRole("button", { name: "Crear PIN" }).click();
      await page.waitForTimeout(2500);
      await T.go("/imperio/panel/gerencia");
    }
    await page.locator("input[name=pin]").first().fill(PIN);
    await page.getByRole("button", { name: "Desbloquear modo gerencia" }).click();
    await page.waitForTimeout(2500);

    // Reserva de un cliente: servicio → el primero libre → día → horario → datos.
    async function reservar(nombre, tel, dia, hora) {
      await T.go("/imperio/reservar");
      await main.getByRole("link", { name: /Degradado \(fade\)/ }).first().click();
      await page.waitForTimeout(1500);
      await main.getByRole("link", { name: /El primero libre/ }).click();
      await page.waitForTimeout(1500);
      await page.locator("nav[aria-label='Elegir día'] a").nth(dia).click();
      await page.waitForTimeout(1500);
      await page.locator("main ul.grid a").nth(hora).click();
      await page.waitForTimeout(1500);
      await T.fill(T.label("Tu nombre"), nombre);
      await T.fill(T.label("Tu WhatsApp"), tel);
      await page.locator("input[name=accept]").check();
    }
    async function subir(archivo, ref) {
      await page.locator("input[name=proof]").setInputFiles(A(archivo));
      await page.locator("summary", { hasText: "Datos del pago" }).click();
      await page.locator("select[name=method]").selectOption({ index: 1 });
      await T.fill(page.locator("input[name=amount]"), "13");
      await T.fill(page.locator("input[name=reference]"), ref);
    }

    // 1-4. Configuración
    await T.go("/imperio/panel/ajustes/reservas");
    await T.step({ title: "Anticipo por QR", text: "Hola, ¿qué tal? Hoy vemos el anticipo: que el cliente pague una parte por QR al reservar, así no te deja la silla vacía. Se configura en Ajustes, «Reservas y anticipo». Primero activás «Pedir anticipo».", hl: T.text("Pedir anticipo en las reservas en línea"), scrollY: 60 });
    await T.step({ title: "Cuánto y hasta cuándo", text: "Ponés el porcentaje, por ejemplo veinticinco por ciento: en un corte de Bs 80 son Bs 20. Y el plazo para pagar, por ejemplo sesenta minutos. Mientras tanto, el horario queda apartado para ese cliente.", hl: page.locator("input[name=depositPercent]"), scrollY: 80 });
    await T.fill(T.label("Titular de la cuenta que recibe los anticipos"), "Andrés Rojas");
    await T.fill(T.label("Instrucciones de pago para el cliente"), "Escaneá el QR desde la app de tu banco y pagá el anticipo. Después subí el comprobante acá mismo.");
    await T.step({ title: "Titular e instrucciones", text: "Abajo ponés el titular de la cuenta, tal como figura en el banco, y unas instrucciones cortas para el cliente. Tocás «Guardar reglas».", hl: T.label("Titular de la cuenta que recibe los anticipos"), scrollY: 60 });
    await T.tap(T.role("button", "Guardar reglas"), 2500);
    await page.locator("input[name=qr]").setInputFiles(A("qr-ejemplo.png"));
    await page.waitForTimeout(500);
    await T.step({ title: "La foto de tu QR", text: "Y al final subís la foto del QR que te da tu banco o billetera, bien derecha. Fijate que sea de tu cuenta, porque ahí te van a pagar. Tocás «Guardar QR».", hl: T.role("button", "Guardar QR"), scrollY: 120 });
    await T.tap(T.role("button", "Guardar QR"), 3000);

    // 5-8. Lo que ve el cliente
    await reservar("Carla Méndez", "70022001", 2, 3);
    await T.step({ title: "Lo que ve el cliente", text: "Ahora, del lado del cliente. Cuando reserva, antes de confirmar ve cuánto es el anticipo, que el turno queda apartado por sesenta minutos, y cuánto le queda por pagar en el local.", hl: page.getByText(/queda reservado por/).first(), scrollY: -200 });
    await T.tap(T.role("button", "Confirmar reserva"), 4000);
    const carlaUrl = page.url();
    await T.step({ title: "Paga con tu QR", text: "Al confirmar, en la página de su reserva le aparece tu QR con el monto exacto y a nombre de quién. Lo escanea desde la app de su banco y paga.", hl: page.locator("img[alt^='QR de pago']"), scrollY: 60 });
    await subir("comprobante.jpg", "EJ-0001234");
    await T.step({ title: "Sube el comprobante", text: "Después sube la foto o captura del comprobante, y si quiere pone el banco, el monto y el número de operación. Toca «Enviar comprobante», siempre antes de que venza el plazo.", hl: T.role("button", "Enviar comprobante"), scrollY: 100 });
    await T.tap(T.role("button", "Enviar comprobante"), 5000);
    await T.go(carlaUrl);
    await T.step({ title: "En revisión", text: "Listo: su reserva queda «en revisión». Si mandó el comprobante a tiempo, el horario ya no vence: queda guardado para él mientras vos lo revisás." });

    // 9-12. Revisar y aprobar en el panel
    await T.go("/imperio/panel/avisos", { wait: 1200 });
    const avisoCarla = page.locator("main a", { hasText: "Comprobante de Carla" }).first();
    await T.step({ title: "Te avisa el panel", text: "En tu panel, la campanita te avisa: «Comprobante de Carla para revisar». Y en el inicio, «Anticipos por verificar» te cuenta cuántos tenés pendientes. Lo tocás y vas directo a la reserva.", hl: avisoCarla });
    await avisoCarla.click();
    await page.waitForTimeout(2500);
    await T.step({ title: "Revisás el comprobante", text: "Ves la imagen del comprobante, lo que puso el cliente, y una comparación con lo que esperabas: el monto, la fecha y si ese número de operación ya se usó. Pero ojo: nada de esto confirma el pago.", hl: page.locator("img[alt='Comprobante enviado por el cliente']"), scrollY: 60 });
    await T.fill(page.locator("input[name=reference]"), "EJ-0001234");
    await page.locator("input[name=bankChecked]").check();
    await T.step({ title: "Aprobás vos", text: "Nada se aprueba solo. Abrís la app de tu banco, buscás el ingreso, y escribís acá el número de operación que ves en tu cuenta. Marcás que lo viste y tocás «Verifiqué el pago: aprobar».", hl: T.role("button", "Verifiqué el pago: aprobar"), scrollY: 120 });
    await T.tap(T.role("button", "Verifiqué el pago: aprobar"), 3500);
    const turnoCarla = page.url();
    await T.step({ title: "Reserva confirmada", text: "La reserva queda confirmada, con el anticipo verificado, quién lo aprobó y la referencia del banco. Al cliente le aparece «¡Reserva confirmada!» en su página.", hl: page.getByText(/verificado por/).first(), scrollY: 100 });

    // 13. Caja
    const reservaId = turnoCarla.split("/agenda/")[1].split(/[?#]/)[0];
    await T.go("/imperio/panel/caja/venta?reserva=" + reservaId, { wait: 1500 });
    await T.step({ title: "En la caja, se descuenta", text: "Y cuando el cliente viene y le cobrás en la caja, el anticipo ya está descontado solo. Le cobrás nada más el resto, sin hacer cuentas.", hl: page.getByText(/anticipo ya cobrado/).first() });

    // 14. Comprobante repetido
    await reservar("Pablo Suárez", "70022002", 3, 5);
    await T.tap(T.role("button", "Confirmar reserva"), 4000);
    const pabloUrl = page.url();
    await subir("comprobante.jpg", "EJ-0001234");
    await T.tap(T.role("button", "Enviar comprobante"), 5000);
    await T.step({ title: "¿Comprobante repetido?", text: "¿Y si te mandan un comprobante repetido? El mismo archivo no se puede usar dos veces: el sistema se lo rechaza al cliente. Y un número de operación ya aprobado tampoco sirve para otra reserva.", hl: page.getByText(/ya fue enviado antes/).first() });

    // 15-16. Rechazar con motivo
    await T.go(pabloUrl);
    await subir("comprobante2.jpg", "EJ-0005678");
    await T.tap(T.role("button", "Enviar comprobante"), 5000);
    await T.go("/imperio/panel/avisos", { wait: 1200 });
    await page.locator("main a", { hasText: "Comprobante de Pablo" }).first().click();
    await page.waitForTimeout(2500);
    await T.fill(page.locator("input[name=reason]"), "El pago no aparece en la cuenta");
    await T.step({ title: "¿Y si es falso?", text: "¿Y si parece falso, o el pago no aparece en tu cuenta? Lo rechazás escribiendo el motivo. El sistema también te marca en amarillo lo que no cuadra, como una imagen casi igual a otra ya enviada.", hl: T.role("button", "Rechazar comprobante"), scrollY: 120 });
    await T.tap(T.role("button", "Rechazar comprobante"), 3500);
    await T.step({ title: "¿Y si no paga?", text: "¿Y si no paga? Al rechazar, el cliente tiene un plazo nuevo para pagar bien. Y si no manda el comprobante a tiempo, la reserva vence sola y el horario se libera para otro. Si te paga por otro lado, lo registrás vos con «Recibí el anticipo».", hl: page.getByText(/El cliente tiene hasta/).first(), scrollY: -60 });

    // 17. Cliente de confianza
    const cliente = page.locator("main a[href*='/panel/clientes/']").first();
    await cliente.click();
    await page.waitForTimeout(2500);
    await T.fill(page.locator("input[name=reason]"), "Cliente de confianza desde hace años");
    await T.step({ title: "Clientes de confianza", text: "¿A un cliente de confianza le podés sacar el anticipo? Sí. En su ficha, en «Anticipo», ponés el motivo y tocás «Eximir del anticipo». Pide tu PIN y queda registrado.", hl: T.role("button", "Eximir del anticipo"), scrollY: 120 });
    await T.tap(T.role("button", "Eximir del anticipo"), 2500);

    // 18. Servicio sin anticipo
    await T.go("/imperio/panel/servicios");
    await page.locator("main a", { hasText: "Editar y fotos" }).nth(3).click();
    await page.waitForTimeout(2000);
    await T.step({ title: "Servicios sin anticipo", text: "Y si un servicio no querés que pida anticipo, en ese servicio ponés cero por ciento. Cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!", hl: page.locator("input[name=depositPercent]"), scrollY: 100 });
  },
};
