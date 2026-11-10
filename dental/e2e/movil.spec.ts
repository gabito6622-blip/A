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
