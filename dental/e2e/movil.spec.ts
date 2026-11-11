import { expect, test } from "@playwright/test";

test("en el celular se navega con la barra inferior y no hay desborde horizontal", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "recepcion.lpz@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  const nav = page.getByRole("navigation", { name: "Navegación móvil" });
  await expect(nav).toBeVisible();
  for (const label of ["Agenda", "Pacientes", "Caja", "Inicio"]) {
    await nav.getByText(label).click();
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `desborde en ${label}`).toBeLessThanOrEqual(1);
  }
});

test("en el celular, «Más» abre el menú completo por secciones y lleva a pantallas fuera de la barra inferior", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  const nav = page.getByRole("navigation", { name: "Navegación móvil" });
  await nav.getByRole("button", { name: "Más" }).click();
  const sheet = page.getByRole("dialog", { name: "Menú completo" });
  await expect(sheet.getByRole("group", { name: "Clínica" })).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Ajustes" })).toBeVisible();
  await sheet.getByRole("link", { name: "Laboratorio" }).click();
  await expect(page.getByRole("heading", { name: "Laboratorio" })).toBeVisible();
  await expect(sheet).toHaveCount(0); // se cierra al navegar
  await expect(nav.getByRole("button", { name: "Más" })).toHaveClass(/active/);
  await nav.getByRole("button", { name: "Más" }).click();
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(page.getByRole("dialog", { name: "Menú completo" })).toHaveCount(0);
});
