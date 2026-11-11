// Pasos del manual de Recepción (docs/manuales/recepcion.md), con recepcion.lpz@demo.local.
module.exports = async ({ paso, shot, login, menu, dialog, toast, settle, toTop, mark, unmark, expect }) => {
  const page = await login("recepcion.lpz@demo.local");

  await paso("Al entrar ves el Inicio: avisos, tus tareas, Mi asistencia y las citas de hoy", async () => {
    await expect(page.getByRole("heading", { name: /Hola, Recepción/ })).toBeVisible();
    await expect(page.getByText("Citas de hoy", { exact: true })).toBeVisible();
    await expect(page.getByText("Mi asistencia")).toBeVisible();
    await toTop(page);
    await shot("recepcion-inicio", page, { full: true });
  });

  await paso("Marcar entrada en «Mi asistencia»", async () => {
    await page.getByRole("button", { name: "Marcar entrada" }).click();
    await expect(page.getByRole("button", { name: "Marcar salida" })).toBeVisible();
  });

  await paso("Registrar un paciente nuevo: Pacientes › «Nuevo paciente», datos y «Guardar»", async () => {
    await menu(page, "Pacientes");
    await page.getByRole("button", { name: "Nuevo paciente" }).click();
    const d = dialog(page, "Nuevo paciente");
    await d.getByLabel("Nombres *").fill("Lucía");
    await d.getByLabel("Apellidos *").fill("Manual Demo");
    await d.getByLabel("Número de documento").fill("7700123");
    await d.getByLabel("Celular (WhatsApp)").fill("70012345");
    await d.getByLabel("Fecha de nacimiento").fill("1992-04-18");
    await d.getByText("Acepta recibir recordatorios de citas por WhatsApp/SMS").click();
    await shot("pacientes-nuevo", d);
    await d.getByRole("button", { name: "Guardar", exact: true }).click();
    await toast(page, /Paciente registrado|ficha/);
    await settle(page);
  });

  await paso("Si el paciente ya existe aparece «Ya hay pacientes parecidos» y «Es otra persona: registrar igual»", async () => {
    await menu(page, "Pacientes");
    await page.getByRole("button", { name: "Nuevo paciente" }).click();
    const d = dialog(page, "Nuevo paciente");
    await d.getByLabel("Nombres *").fill("Lucía");
    await d.getByLabel("Apellidos *").fill("Manual Demo");
    await d.getByLabel("Número de documento").fill("7700123");
    await d.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(d.getByText("Ya hay pacientes parecidos")).toBeVisible();
    await expect(d.getByRole("button", { name: "Es otra persona: registrar igual" })).toBeVisible();
    await d.getByRole("button", { name: "Cancelar" }).click();
  });

  await paso("Buscar un paciente por nombre, CI, celular o N° de ficha", async () => {
    await menu(page, "Pacientes");
    await page.getByLabel("Buscar pacientes").fill("Manual Demo");
    const row = page.locator("tr.clickable", { hasText: "Lucía Manual Demo" });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole("tab", { name: "Resumen", exact: true })).toBeVisible();
  });

  await paso("Agendar: Agenda › «Buscar horario» › «Agendar» en un hueco libre", async () => {
    await menu(page, "Agenda");
    await page.getByRole("button", { name: "Buscar horario" }).click();
    const d = dialog(page, "Buscar horario libre");
    await d.getByRole("button", { name: "Buscar" }).click().catch(() => {});
    await expect(d.getByRole("button", { name: "Agendar" }).first()).toBeVisible({ timeout: 15_000 });
    await shot("agenda-buscar-horario", page);
    await d.getByRole("button", { name: "Agendar" }).first().click();
  });

  await paso("En «Nueva cita» buscar al paciente, revisar profesional, fecha y hora y pulsar «Agendar»", async () => {
    const d = dialog(page, "Nueva cita");
    await d.getByPlaceholder("Buscar por nombre, CI, teléfono o N° de ficha").fill("Manual Demo");
    await d.getByRole("button", { name: /Lucía Manual Demo/ }).click();
    await expect(d.getByLabel("Profesional")).not.toHaveValue("");
    await shot("agenda-nueva-cita", d);
    await d.getByRole("button", { name: "Agendar", exact: true }).click();
    await toast(page, "Cita agendada");
    await settle(page);
  });

  await paso("Abrir una cita en la Agenda: «Confirmar», «Reprogramar» y «Cancelar cita»", async () => {
    // La Agenda quedó en el día de la cita recién agendada.
    // La cita recién agendada (u otra por confirmar) muestra todos los botones.
    const appt = page.locator(".appt.s-scheduled").first();
    await expect(appt).toBeVisible();
    await appt.click();
    const d = page.locator(".drawer");
    await expect(d.getByRole("button", { name: "Reprogramar" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Cancelar cita" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Confirmar" })).toBeVisible();
    await expect(page.getByText("Arrastra una cita para cambiarle el horario")).toBeVisible();
    await shot("agenda-cita", d, { fit: true });
    await d.getByRole("button", { name: "Reprogramar" }).click();
    await expect(d.getByLabel("Nueva fecha")).toBeVisible();
    await expect(d.getByLabel("Nueva hora")).toBeVisible();
    await expect(d.getByRole("button", { name: "Guardar nuevo horario" })).toBeVisible();
    await d.getByRole("button", { name: "Cancelar cita" }).click();
    await d.getByLabel("Motivo de la cancelación").fill("El paciente pidió otro día");
    await expect(d.getByRole("button", { name: "Confirmar cancelación" })).toBeEnabled();
    await d.getByRole("button", { name: "Cerrar" }).click();
  });

  await paso("Recordatorios: Agenda › «Recordatorios» › «Enviar» abre WhatsApp con el mensaje", async () => {
    await page.getByRole("button", { name: "Recordatorios" }).click();
    const d = dialog(page, "Recordatorios por WhatsApp");
    await expect(d.getByLabel("Citas del día")).toBeVisible();
    await expect(d.getByText(/Solo aparecen habilitados los pacientes que aceptaron recibir recordatorios/)).toBeVisible();
    await shot("agenda-recordatorios", d);
    await page.keyboard.press("Escape");
  });

  await paso("Sala de espera: «Llegó», «Pasar a atención» y «Atendido»", async () => {
    await menu(page, "Sala de espera");
    await settle(page);
    const llego = page.getByRole("button", { name: "Llegó", exact: true }).first();
    await expect(llego).toBeVisible();
    await llego.click();
    await settle(page);
    await expect(page.getByRole("button", { name: "Pasar a atención" }).first()).toBeVisible();
    await expect(page.getByText("Se actualiza automáticamente cada 30 segundos.")).toBeVisible();
    await toTop(page);
    await shot("sala-espera", page);
  });

  await paso("Citas pasadas sin cerrar: elegir «Atendida» o «No asistió»", async () => {
    await expect(page.getByText("Citas pasadas sin cerrar")).toBeVisible();
    await expect(page.getByRole("button", { name: "No asistió" }).first()).toBeVisible();
  });

  await paso("Controles: «Registrar intento», elegir el resultado y «Guardar intento»", async () => {
    await menu(page, "Controles");
    await settle(page);
    await page.getByRole("button", { name: "Registrar intento" }).first().click();
    const d = dialog(page, "Registrar intento de contacto");
    await d.getByRole("button", { name: "No contesta" }).click().catch(async () => { await d.getByLabel("No contesta").check(); });
    await shot("controles-intento", d);
    await d.getByRole("button", { name: "Guardar intento" }).click();
    await toast(page, "Intento registrado");
  });

  await paso("Solicitudes web: Agenda › «Solicitudes web» (aprobar o rechazar)", async () => {
    await menu(page, "Agenda");
    await page.getByRole("button", { name: /Solicitudes web/ }).click();
    const d = dialog(page, "Solicitudes web");
    await expect(d.getByRole("button", { name: /Pendientes/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await paso("Tareas: «Tomar» y «Marcar hecha»", async () => {
    await menu(page, "Tareas");
    await settle(page);
    await expect(page.getByRole("tab", { name: /Mis tareas/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tablero", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nueva tarea" })).toBeVisible();
    await toTop(page);
    await shot("tareas", page);
    await page.getByRole("button", { name: "Tomar" }).first().click();
    await settle(page);
    await page.getByRole("button", { name: "Marcar hecha" }).first().click();
    await settle(page);
  });

  await page.context().close();
};
