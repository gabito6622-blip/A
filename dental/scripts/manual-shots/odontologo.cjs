// Pasos del manual del Odontólogo (docs/manuales/odontologo.md), con dr.mendoza@demo.local.
module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, mark, unmark, expect }) => {
  const page = await login("dr.mendoza@demo.local");
  const home = page.locator(".card", { has: page.getByRole("heading", { name: /Mis pacientes de hoy/ }) }).first();

  await paso("Al entrar ves «Mis pacientes de hoy» con hora, prestación y alertas", async () => {
    await expect(page.getByRole("heading", { name: /Hola, Dr\. Luis/ })).toBeVisible();
    await expect(page.getByText("Mis pacientes de hoy")).toBeVisible();
    await toTop(page);
    await shot("odontologo-inicio", page, { full: true, height: 600 });
  });

  await paso("Abrir la ficha pulsando el nombre del paciente", async () => {
    const link = home.getByRole("link").first();
    if (await link.count()) await link.click();
    else { // día sin citas (domingo): se abre desde «Pacientes»
      await menu(page, "Pacientes");
      await page.locator("tr.clickable").first().click();
    }
    await expect(page.getByRole("tab", { name: "Historia clínica", exact: true })).toBeVisible();
  });

  await paso("Historia clínica › «Antecedentes médicos» › «Actualizar» y «Guardar versión»", async () => {
    await page.getByRole("tab", { name: "Historia clínica", exact: true }).click();
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await page.getByLabel("Alergias").fill("Penicilina");
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await settle(page);
    await expect(page.getByText("Penicilina").first()).toBeVisible();
  });

  await paso("«Nueva evolución»: «Tipo», «Detalle» y «Firmar y guardar»; «Enmendar» para corregir", async () => {
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "Nueva evolución" }) }).first();
    await card.getByLabel("Detalle").fill("Control de rutina. Encías sanas. Se indica cepillado tres veces al día.");
    await toTop(page);
    await card.scrollIntoViewIfNeeded();
    await shot("historia-evolucion", page);
    await card.getByRole("button", { name: "Firmar y guardar" }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Enmendar" }).first()).toBeVisible();
  });

  await paso("Odontograma: pulsar la pieza, elegir «Condición / tratamiento» y «Estado», «Guardar en pieza»", async () => {
    await page.getByRole("tab", { name: "Odontograma", exact: true }).click();
    await page.getByRole("button", { name: "Pieza 16", exact: true }).click();
    await page.getByLabel("Condición / tratamiento").selectOption({ index: 1 });
    await page.getByRole("radio", { name: "Planificado" }).check();
    await page.setViewportSize({ width: 1440, height: 1240 });
    await page.getByRole("heading", { name: "Pieza 16" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await shot("odontograma", page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Guardar en pieza 16" }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Anular" }).first()).toBeVisible(); // en «Estado actual» de la pieza
  });

  await paso("Presupuestos › «Nuevo presupuesto»: «Agregar prestación» y «Guardar borrador»", async () => {
    await page.getByRole("tab", { name: "Presupuestos", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo presupuesto" }).click();
    const d = dialog(page, "Nuevo presupuesto");
    const add = async (text) => {
      const sel = d.getByLabel("Agregar prestación");
      await expect(sel.locator("option", { hasText: text })).toHaveCount(1);
      const value = await sel.evaluate((el, t) => [...el.options].find((o) => o.text.includes(t))?.value, text);
      await sel.selectOption(value);
    };
    await add("Profilaxis");
    await add("Restauración con resina (1 superficie)");
    const row = d.locator("tr", { hasText: "Restauración con resina" });
    await row.getByPlaceholder("Req.").fill("16");
    await row.getByRole("button", { name: "O", exact: true }).click();
    await shot("presupuesto-nuevo", d);
    await d.getByRole("button", { name: "Guardar borrador" }).click();
    await toast(page, /Presupuesto N° \d+ creado/);
    await settle(page);
  });

  await paso("En el presupuesto: «Marcar como presentado», «Paciente aceptó» y «Realizado» en cada línea", async () => {
    const actions = page.getByRole("button", { name: "Marcar como presentado" });
    if (!(await actions.count())) await page.locator("tr.clickable").first().click();
    await page.getByRole("button", { name: "Marcar como presentado" }).click();
    await settle(page);
    for (const name of ["Compartir enlace", "Entregado en mano", "Imprimir", "Nueva versión"]) await expect(page.getByRole("button", { name }).first()).toBeVisible();
    await page.getByRole("button", { name: "Paciente aceptó" }).click();
    const ok = dialog(page, "Paciente aceptó");
    await ok.getByLabel("Nota (opcional)").fill("Firmó en papel");
    await ok.getByRole("button", { name: "Confirmar" }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Realizado", exact: true }).first()).toBeVisible();
    await shot("presupuesto-realizado", page);
    await page.getByRole("button", { name: "Realizado", exact: true }).first().click();
    await settle(page);
    await expect(page.getByText("Realizado").first()).toBeVisible();
  });

  await paso("Documentos › «Nueva receta»: medicamento, dosis, frecuencia, duración y «Emitir receta» › «Emitir»", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Documentos", exact: true }).click();
    await page.getByRole("button", { name: "Nueva receta" }).click();
    const d = dialog(page, "Nueva receta");
    await expect(d.getByLabel("Sucursal (membrete)")).toBeVisible();
    await expect(d.getByRole("button", { name: "Agregar medicamento" })).toBeVisible();
    await d.getByLabel("Medicamento y presentación").first().fill("Ibuprofeno 400 mg comprimidos");
    await d.getByLabel("Dosis").first().fill("1 comprimido");
    await d.getByLabel("Frecuencia").first().fill("cada 8 horas");
    await d.getByLabel("Duración").first().fill("3 días");
    await shot("receta-nueva", d);
    await d.getByRole("button", { name: "Emitir receta" }).click();
    await dialog(page, "Emitir receta").getByRole("button", { name: "Emitir", exact: true }).click();
    await settle(page);
    await expect(page.getByRole("button", { name: /^PDF/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Nuevo certificado" })).toBeVisible();
  });

  await paso("Sala de espera: «Pasar a atención» y «Atendido»", async () => {
    await menu(page, "Sala de espera");
    await settle(page);
    await expect(page.getByRole("heading", { name: "Sala de espera", level: 1 })).toBeVisible();
    const card = page.locator("article.card").filter({ has: page.getByRole("button", { name: "Llegó", exact: true }) }).last();
    if (await card.count()) {
      await card.getByRole("button", { name: "Llegó", exact: true }).click();
      await settle(page);
      await page.getByRole("button", { name: "Pasar a atención" }).first().click();
      await settle(page);
      await expect(page.getByRole("button", { name: "Atendido", exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Atendido", exact: true }).first().click();
      const d = dialog(page, "Próximo control");
      await expect(d).toBeVisible();
      await d.getByRole("button", { name: "Ahora no" }).click();
      await settle(page);
      await expect(page.getByRole("button", { name: "Enviar encuesta" }).first()).toBeVisible();
    }
  });

  await paso("Cita pasada sin cerrar: «Atendida» y, si corresponde, «Próximo control» (o «Ahora no»)", async () => {
    const row = page.locator("section", { has: page.getByRole("heading", { name: "Citas pasadas sin cerrar" }) }).locator("tr", { hasText: "Dr. Luis Mendoza" }).first();
    await row.getByRole("button", { name: "Atendida", exact: true }).click();
    const d = dialog(page, "Próximo control");
    await expect(d).toBeVisible();
    await shot("proximo-control", d);
    await d.getByRole("button", { name: "Ahora no" }).click();
    await settle(page);
  });

  await paso("Honorarios: ver lo tuyo del período", async () => {
    await menu(page, "Honorarios");
    await settle(page);
    await toTop(page);
    await shot("honorarios-odontologo", page);
  });

  await page.context().close();
};
