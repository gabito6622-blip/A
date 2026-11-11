// Pasos del manual de Gerencia (docs/manuales/gerencia.md), con gerente@demo.local (rol Administrador).
module.exports = async ({ paso, shot, login, newPage, base, menu, dialog, toast, settle, toTop, mark, unmark, expect }) => {
  const page = await login("gerente@demo.local");

  await paso("Al entrar ves el Inicio con el mes por sucursal y la comparación con el período anterior", async () => {
    await expect(page.getByRole("heading", { name: /Hola, Lic\. Marco/ })).toBeVisible();
    await expect(page.getByText("Comparación con el período anterior")).toBeVisible();
    await expect(page.getByRole("button", { name: "Rango libre" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Primeros pasos" })).toBeVisible();
    // La captura muestra los números (debajo de «Primeros pasos», que ya se ve en el manual de la dueña).
    await page.getByText("Comparación con el período anterior").evaluate((el) => { el.closest(".card")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -240); });
    await shot("gerencia-inicio", page, { full: true, height: 600 });
  });

  await paso("Anular un pago cobrado de más: Caja › «Fecha» › «Movimientos del día» › «Anular» con motivo", async () => {
    await menu(page, "Caja");
    await settle(page);
    const moves = page.locator(".card", { has: page.getByRole("heading", { name: "Movimientos del día" }) });
    // Busca hacia atrás el último día con cobros confirmados (la semilla es relativa a hoy).
    for (let back = 0; back < 10 && !(await moves.getByRole("button", { name: "Anular" }).count()); back++) {
      const d = new Date(Date.now() - back * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
      await page.getByLabel("Fecha", { exact: true }).fill(d);
      await settle(page);
    }
    const anular = moves.getByRole("button", { name: "Anular" }).first();
    await anular.click();
    const d = dialog(page, "Anular pago");
    await d.getByLabel("Motivo de la anulación").fill("Se cobró Bs 50 de más; se devolvió al paciente y se registró el monto correcto");
    await shot("anular-pago", d);
    await d.getByRole("button", { name: "Anular pago" }).click();
    await toast(page, "Pago anulado");
  });

  await paso("Anular un cargo: ficha › «Cuenta y pagos» › «Anular» en el cargo", async () => {
    await menu(page, "Pacientes");
    await page.locator("tr.clickable").first().click();
    await page.getByRole("tab", { name: "Cuenta y pagos", exact: true }).click();
    const charges = page.locator(".card", { has: page.getByRole("heading", { name: "Cargos" }) });
    await expect(charges.getByRole("button", { name: "Anular" }).first()).toBeVisible();
    await menu(page, "Caja");
    await settle(page);
  });

  await paso("Revisar cierres de caja: «Cierres de caja» › N° › «Marcar revisada»", async () => {
    await expect(page.getByRole("heading", { name: "Cierres de caja" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Pendiente" }).first()).toBeVisible();
  });

  await paso("Cerrar una liquidación de honorarios: abrir el borrador › «Cerrar liquidación» › «Cerrar por Bs …»", async () => {
    await menu(page, "Honorarios");
    await settle(page);
    await page.getByRole("button", { name: "Preparar borradores del período" }).click();
    await settle(page);
    await page.locator("tr", { hasText: "Borrador" }).first().getByRole("link").first().click();
    await settle(page);
    await page.getByRole("button", { name: "Cerrar liquidación" }).click();
    const d = dialog(page, "Cerrar liquidación");
    await d.getByLabel("Nota (opcional)").fill("Se paga por transferencia");
    await d.getByRole("button", { name: /^Cerrar por Bs/ }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Cerrar liquidación" })).toHaveCount(0);
  });

  await paso("Personal: Configuración › «Personal» › «Agregar persona», rol, sucursales y «Guardar»", async () => {
    await menu(page, "Configuración");
    await page.getByRole("tab", { name: "Personal", exact: true }).click();
    await page.getByRole("button", { name: "Agregar persona" }).click();
    const d = dialog(page, "Agregar persona");
    await d.getByLabel("Nombre completo").fill("Recepción Nueva (demo)");
    await d.getByLabel("Correo").fill("recepcion.nueva@demo.local");
    await d.getByLabel("Rol").selectOption({ label: "Recepción" });
    await d.getByText("La Paz Centro", { exact: true }).click();
    await shot("personal-agregar", d);
    await d.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ya la entregué" })).toBeVisible();
    const temp = (await page.getByText(/^Tmp-/).first().textContent()).trim();
    const alert = page.locator("div", { has: page.getByRole("button", { name: "Ya la entregué" }) }).filter({ hasText: "Contraseña temporal de" }).last();
    // La contraseña de ejemplo se difumina en la captura (aunque sea de un usuario ficticio).
    await alert.locator("code, b, strong, .mono, [class*=pw]").filter({ hasText: /^Tmp-/ }).evaluateAll((els) => els.forEach((e) => { e.style.filter = "blur(6px)"; }));
    await page.getByText(/^Tmp-/).evaluateAll((els) => els.forEach((e) => { e.style.filter = "blur(6px)"; }));
    await shot("personal-contrasena", alert, { fit: true });
    await page.getByRole("button", { name: "Ya la entregué" }).click();
    // La persona nueva entra con la temporal y el sistema le pide cambiarla.
    const first = await newPage();
    await first.goto(`${base()}/`);
    await first.fill("#email", "recepcion.nueva@demo.local");
    await first.fill("#pw", temp);
    await first.click('button:has-text("Ingresar")');
    await expect(first.getByRole("heading", { name: "Cambia tu contraseña temporal" })).toBeVisible();
    await expect(first.getByLabel("Contraseña temporal")).toBeVisible();
    await expect(first.getByLabel("Nueva contraseña", { exact: true })).toBeVisible();
    await first.context().close();
  });

  await paso("Horarios: Configuración › «Horarios», elegir el «Profesional», «Agregar turno» y «Guardar horario»", async () => {
    await page.getByRole("tab", { name: "Horarios", exact: true }).click();
    await page.getByLabel("Profesional").selectOption({ label: "Dra. Elena Vargas" });
    await expect(page.getByRole("button", { name: /Agregar turno/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar horario" }).first()).toBeVisible();
  });

  await paso("Fichaje: Gestión › «Fichaje» para ver horas y «Agregar marca» con motivo", async () => {
    await menu(page, "Gestión");
    await page.getByRole("tab", { name: "Fichaje", exact: true }).click();
    await settle(page);
    await page.getByRole("button", { name: "Agregar marca" }).first().click();
    const mk = dialog(page, "Agregar marca (corrección)");
    await expect(mk.getByLabel("Motivo")).toBeVisible();
    await expect(mk.getByRole("button", { name: "Guardar corrección" })).toBeVisible();
    await mk.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("button", { name: /Exportar a Excel/ }).or(page.getByRole("link", { name: /Exportar a Excel/ })).first()).toBeVisible();
    await toTop(page);
    await shot("gestion-fichaje", page);
  });

  await paso("Rentabilidad: Gestión › «Rentabilidad» por sucursal y sillón", async () => {
    await page.getByRole("tab", { name: "Rentabilidad", exact: true }).click();
    await settle(page);
    await toTop(page);
    await shot("gestion-rentabilidad", page, { height: 640 });
  });

  await paso("Mensajes: panel de envíos (simulados fuera de producción)", async () => {
    await menu(page, "Mensajes");
    await settle(page);
    await toTop(page);
    await shot("mensajes", page);
  });

  await paso("Actividad: quién hizo qué y cuándo", async () => {
    await menu(page, "Actividad");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Excel/ }).or(page.getByRole("button", { name: /Excel/ })).first()).toBeVisible();

  });

  await page.context().close();
};
