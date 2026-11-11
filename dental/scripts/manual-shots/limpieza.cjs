// Pasos del manual de Limpieza y apoyo (docs/manuales/limpieza.md), en el celular, con
// limpieza.lpz@demo.local. Este rol no ve datos de pacientes.
module.exports = async ({ paso, shot, login, dialog, toast, settle, toTop, expect, MOBILE }) => {
  const page = await login("limpieza.lpz@demo.local", MOBILE);

  await paso("Al entrar se abre «Bioseguridad»: tus tareas, Mi asistencia y la limpieza de la sucursal", async () => {
    await expect(page).toHaveURL(/\/bioseguridad/);
    await expect(page.getByRole("heading", { name: "Bioseguridad", level: 1 })).toBeVisible();
    await expect(page.locator(".bottom-nav").getByRole("link", { name: /Tareas/ })).toBeVisible();
    await toTop(page);
    await shot("limpieza-inicio-movil", page);
  });

  await paso("«Marcar entrada» al llegar", async () => {
    await page.getByRole("button", { name: "Marcar entrada" }).click();
    await expect(page.getByRole("button", { name: "Marcar salida" })).toBeVisible();
  });

  await paso("Limpieza de un consultorio: «Apertura», «Entre pacientes», «Cierre» o «Desinf. profunda»", async () => {
    const room = page.locator(".card", { hasText: "Consultorio 1" }).filter({ has: page.getByRole("button", { name: "Apertura" }) }).last();
    await room.getByRole("button", { name: "Apertura" }).click();
    await toast(page, /Registrado/);
    await settle(page);
    await room.scrollIntoViewIfNeeded();
    await shot("limpieza-consultorio-movil", page);
    await room.getByRole("button", { name: "Entre pacientes" }).click();
    await toast(page, /Registrado/);
  });

  await paso("Áreas comunes: elegir el «Área» y la tarea (por ejemplo «Retiro de residuos»)", async () => {
    await page.getByLabel("Área").selectOption({ label: "Baños" });
    await page.getByRole("button", { name: "Retiro de residuos" }).click();
    await toast(page, /Registrado/);
    await settle(page);
  });

  await paso("Esterilización › «Registrar ciclo»: carga, paquetes, indicador químico y «Guardar ciclo»", async () => {
    await toTop(page);
    await page.getByRole("tab", { name: /^Esterilización/ }).click();
    await page.getByRole("button", { name: "Registrar ciclo" }).click();
    const d = dialog(page, "Registrar ciclo de esterilización");
    await d.getByLabel("Carga (qué se esterilizó)").fill("6 kits de examen, fórceps y curetas");
    await d.getByLabel("Paquetes").fill("6");
    await d.getByRole("button", { name: "Viró correctamente" }).click();
    await shot("esterilizacion-ciclo-movil", page);
    await d.getByRole("button", { name: "Guardar ciclo" }).click();
    await settle(page);
    await expect(d).toHaveCount(0);
  });

  await paso("Indicador biológico: «Registrar» en el ciclo y «Negativo (sin crecimiento)» › «Guardar»", async () => {
    await page.getByRole("button", { name: "Registrar", exact: true }).first().click();
    const d = page.getByRole("dialog", { name: /Indicador biológico/ });
    await d.getByRole("button", { name: "Negativo (sin crecimiento)" }).click();
    await d.getByRole("button", { name: "Guardar", exact: true }).click();
    await toast(page, /Resultado registrado/);
  });

  await paso("Tareas: abrir «Tareas» abajo, «Tomar» y «Marcar hecha»", async () => {
    await page.locator(".bottom-nav").getByRole("link", { name: /Tareas/ }).click();
    await settle(page);
    await page.getByRole("button", { name: "Tomar" }).first().click();
    await settle(page);
    await toTop(page);
    await shot("tareas-movil", page);
    await page.getByRole("button", { name: "Marcar hecha" }).first().click();
    await settle(page);
  });

  await paso("«Marcar salida» al irte (en Bioseguridad)", async () => {
    await page.locator(".bottom-nav").getByRole("link", { name: /Bioseguridad/ }).click();
    await page.getByRole("button", { name: "Marcar salida" }).click();
    await expect(page.getByText(/Salida/).first()).toBeVisible();
  });

  await paso("«Mi cuenta» (ícono de persona arriba) tiene «Aplicación en este dispositivo»", async () => {
    await page.getByRole("link", { name: /Mi cuenta/ }).first().click();
    await expect(page.getByText("Aplicación en este dispositivo")).toBeVisible();
    await page.locator(".bottom-nav").getByRole("link", { name: /Bioseguridad/ }).click();
  });

  await paso("Limpieza no ve pacientes, agenda ni caja", async () => {
    for (const name of ["Pacientes", "Agenda", "Caja"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  });

  await page.context().close();
};
