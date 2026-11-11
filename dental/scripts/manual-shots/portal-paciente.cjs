// Pasos de la guía del portal del paciente (docs/manuales/portal-paciente.md), en el celular.
// Paciente demo ficticia: Carmen Mamani Demo (CI 9000001, nacida el 12/05/1990), madre de Mateo.
// Los códigos «por WhatsApp» se leen de la bandeja simulada (fuera de producción nada se envía).
module.exports = async ({ paso, shot, newPage, login, settle, expect, base, SLUG, MOBILE }) => {
  const staff = await login("propietaria@demo.local");
  const used = new Set();
  /** Código del último mensaje simulado que aún no se usó (espera a que llegue). */
  const lastCode = async () => {
    for (let i = 0; i < 40; i++) {
      const msgs = await (await staff.request.get(`${base()}/api/messages`)).json();
      const otp = msgs.items.find((m) => m.recipient === "+59170000123" && m.template === "portal.otp" && !used.has(m.id));
      if (otp) { used.add(otp.id); return otp.body.match(/\d{6}/)[0]; }
      await staff.waitForTimeout(250);
    }
    throw new Error("No llegó el código simulado");
  };
  const page = await newPage(MOBILE);
  const next = page.locator(".pt-sticky .btn-primary");

  async function existingLogin() {
    await page.getByLabel("Número de carnet (CI)").fill("9000001");
    await page.getByLabel("Día").fill("12");
    await page.getByLabel("Mes").selectOption("5");
    await page.getByLabel("Año").fill("1990");
  }

  await paso("Reservar: abrir el enlace de la clínica y elegir la sucursal", async () => {
    await page.goto(`${base()}/reservar/${SLUG}`);
    await expect(page.getByText("Paso 1 de 7: Sucursal")).toBeVisible();
    await page.getByRole("button", { name: /La Paz Centro/ }).click();
    await shot("portal-sucursal-movil", page);
    await next.click();
  });

  await paso("Elegir el servicio y el profesional («Cualquier profesional»)", async () => {
    await expect(page.getByText("Paso 2 de 7: Servicio")).toBeVisible();
    await page.getByRole("button", { name: /Consulta y diagnóstico/ }).click();
    await next.click();
    await page.getByRole("button", { name: /Cualquier profesional/ }).click();
    await expect(next).toHaveText(/Ver horarios/);
    await next.click();
  });

  await paso("«Elige día y hora» y «Continuar»", async () => {
    await expect(page.getByRole("heading", { name: "Elige día y hora" })).toBeVisible();
    await page.locator(".pt-day:not([disabled])").nth(2).click();
    await page.locator(".pt-time").first().click();
    await shot("portal-dia-hora-movil", page);
    await next.click();
  });

  await paso("«Ya me atendí aquí»: carnet y fecha de nacimiento, «Enviarme el código»", async () => {
    await expect(page.getByText("Paso 5 de 7: Tus datos")).toBeVisible();
    await page.getByRole("tab", { name: "Ya me atendí aquí" }).click();
    await existingLogin();
    await shot("portal-datos-movil", page);
    await next.click();
  });

  await paso("Escribir el «Código de 6 dígitos» que llega por WhatsApp y «Verificar código»", async () => {
    await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
    await expect(page.getByText(/Vence en 10 minutos/)).toBeVisible();
    await expect(page.getByText(/Pedir otro código/)).toBeVisible();
    await page.getByLabel("Código de 6 dígitos").fill(await lastCode());
    await next.click();
  });

  await paso("«Revisa tu reserva», elegir para quién es la cita y confirmar", async () => {
    await expect(page.getByRole("heading", { name: /Revisa tu (reserva|solicitud)/ })).toBeVisible();
    const who = page.getByRole("radiogroup", { name: "¿Para quién es la cita?" });
    if (await who.count()) await who.getByRole("radio").first().check();
    await shot("portal-revisar-movil", page);
    await expect(next).toHaveText(/Confirmar reserva|Enviar solicitud/);
    await next.click();
    const auth = page.getByRole("checkbox", { name: /usar mis datos personales/ });
    if (await auth.count()) { await auth.check(); await next.click(); }
    await expect(page.getByText("¡Listo! Tu cita quedó reservada.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Agregar al calendario/ })).toBeVisible();
    await shot("portal-listo-movil", page);
  });

  await paso("Mi cuenta: «Ver, reprogramar o cancelar» lleva a tus citas", async () => {
    await page.getByRole("link", { name: "Ver, reprogramar o cancelar" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Carmen" })).toBeVisible();
    await expect(page.getByText("Próximas citas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reprogramar" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar cita" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
    await shot("portal-mi-cuenta-movil", page);
  });

  await paso("«Pagos» y «Presupuestos» (solo lectura); con hijos a cargo, elegir a quién ver arriba («Mateo (a tu cargo)»)", async () => {
    await page.getByRole("tab", { name: "Pagos" }).click();
    await expect(page.getByText("Pagos en la clínica o por transferencia; la clínica confirma el pago.")).toBeVisible();
    const kids = page.getByRole("group", { name: "Paciente" });
    await kids.getByRole("button", { name: /Mateo \(a tu cargo\)/ }).click();
    await expect(kids.getByRole("button", { name: /Mateo/ })).toHaveAttribute("aria-pressed", "true");
    await shot("portal-pagos-movil", page);
    await page.getByRole("tab", { name: "Presupuestos" }).click();
    await settle(page);
  });

  await paso("Reprogramar: elegir otro horario y «Confirmar el cambio»", async () => {
    await page.getByRole("tab", { name: "Citas" }).click();
    await page.getByRole("button", { name: "Reprogramar" }).first().click();
    const g = page.getByRole("group", { name: "Reprogramar cita" });
    await expect(g.getByRole("button", { name: "Confirmar el cambio" })).toBeVisible();
    await g.getByRole("button", { name: "Volver" }).click();
  });

  await paso("Cancelar: «Cancelar cita» › «Sí, cancelar la cita»", async () => {
    await page.getByRole("button", { name: "Cancelar cita" }).first().click();
    await shot("portal-cancelar-movil", page);
    await page.getByRole("button", { name: "Sí, cancelar la cita" }).click();
    await expect(page.getByText("Cancelamos tu cita.")).toBeVisible();
  });

  await paso("«Mensajes de la clínica»: «Dejar de recibir mensajes» y «Salir»", async () => {
    const msgs = page.getByRole("region", { name: "Mensajes de la clínica" });
    await msgs.getByRole("button", { name: "Dejar de recibir mensajes" }).click();
    await expect(msgs.getByText(/Listo: ya no te enviaremos recordatorios ni promociones/)).toBeVisible();
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page.getByRole("heading", { name: "Ingresa a tu cuenta" })).toBeVisible();
  });

  await paso("Volver a entrar a Mi cuenta: carnet, fecha de nacimiento y código", async () => {
    await page.goto(`${base()}/mi-cuenta/${SLUG}`);
    await existingLogin();
    await page.getByRole("button", { name: "Enviarme el código" }).click();
    await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
    await page.getByLabel("Código de 6 dígitos").fill(await lastCode());
    await page.getByRole("button", { name: "Verificar código" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Carmen" })).toBeVisible();
  });

  await page.context().close();
  await staff.context().close();
};
