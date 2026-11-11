// Pasos del manual de Asistente dental (docs/manuales/asistente.md), con asistente@demo.local.
module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, expect }) => {
  const page = await login("asistente@demo.local");

  await paso("Al entrar ves el Inicio: avisos, tus tareas, Mi asistencia y las citas de hoy", async () => {
    await expect(page.getByRole("heading", { name: /Hola, Asistente/ })).toBeVisible();
    await toTop(page);
    await shot("asistente-inicio", page, { full: true, height: 600 });
  });

  await paso("«Marcar entrada» en «Mi asistencia»", async () => {
    await page.getByRole("button", { name: "Marcar entrada" }).click();
    await expect(page.getByRole("button", { name: "Marcar salida" })).toBeVisible();
  });

  await paso("Tareas: «Marcar hecha» en una tarea (también las vencidas)", async () => {
    await expect(page.getByText(/vencida/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Marcar hecha" }).first().click();
    await settle(page);
  });

  await paso("Sala de espera y Agenda: los mismos botones que recepción («Llegó», «Nueva cita»)", async () => {
    await menu(page, "Sala de espera");
    await expect(page.getByRole("button", { name: "Actualizar" })).toBeVisible();
    await menu(page, "Agenda");
    await expect(page.getByRole("button", { name: "Nueva cita" })).toBeVisible();
  });

  await paso("Ficha del paciente: puedes leer la historia clínica, pero no firmar evoluciones", async () => {
    await menu(page, "Pacientes");
    await page.locator("tr.clickable").first().click();
    await page.getByRole("tab", { name: "Historia clínica", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Antecedentes médicos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Firmar y guardar" })).toHaveCount(0);
  });

  await paso("Inventario › «Consumir»: «Insumo», «Cantidad» y «Registrar consumo»", async () => {
    await menu(page, "Inventario");
    await settle(page);
    await page.getByRole("button", { name: "Consumir", exact: true }).first().click();
    const d = dialog(page, "Consumir insumo");
    await d.getByLabel("Insumo").selectOption({ index: 1 });
    await d.getByLabel(/^Cantidad/).fill("1");
    await d.getByLabel("Nota (opcional)").fill("Consultorio 2");
    await shot("inventario-consumir", d);
    await d.getByRole("button", { name: "Registrar consumo" }).click();
    await settle(page);
    await expect(d).toHaveCount(0);
  });

  await paso("Corregir un consumo: «Ajustar», «Sumar (+)», cantidad, motivo y «Registrar ajuste»", async () => {
    await page.getByRole("button", { name: "Ajustar", exact: true }).first().click();
    const d = dialog(page, "Ajustar stock");
    await expect(d.getByRole("group", { name: "Tipo de ajuste" }).getByRole("button", { name: "Sumar (+)" })).toBeVisible();
    await expect(d.getByLabel("Motivo")).toBeVisible();
    await expect(d.getByRole("button", { name: "Registrar ajuste" })).toBeVisible();
    await d.getByRole("button", { name: "Cancelar" }).click();
  });

  await paso("Bioseguridad › «Limpieza»: «Entre pacientes» en el consultorio que limpiaste", async () => {
    await menu(page, "Bioseguridad");
    await settle(page);
    const room = page.locator(".card", { hasText: "Consultorio 2" }).filter({ has: page.getByRole("button", { name: "Entre pacientes" }) }).last();
    await room.getByRole("button", { name: "Entre pacientes" }).click();
    await toast(page, /Registrado/);
    await settle(page);
    await room.scrollIntoViewIfNeeded();
    await shot("bioseguridad-limpieza", page);
  });

  await paso("Bioseguridad › «Esterilización»: la lista de ciclos con «Registrar» para el biológico", async () => {
    await page.getByRole("tab", { name: /^Esterilización/ }).click();
    await expect(page.getByRole("button", { name: "Registrar ciclo" })).toBeVisible();
    await settle(page);
  });

  await page.context().close();
};
