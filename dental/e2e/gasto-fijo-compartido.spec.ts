import { expect, test } from "@playwright/test";

// B-097: el gerente crea un gasto fijo mensual repartido entre dos sucursales, genera el borrador
// del mes y lo ve repartido. Datos ficticios; el gasto se crea con un nombre único.
test("gasto fijo compartido: se crea repartido y el borrador del mes sale con el mismo reparto", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "gerente@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
  const tag = `Seguro compartido ${Date.now().toString(36)}`;

  await page.getByRole("link", { name: "Gestión" }).click();
  await page.getByRole("tab", { name: "Gastos" }).click();
  await page.getByRole("button", { name: "Nuevo gasto fijo" }).click();
  const dlg = page.getByRole("dialog", { name: "Nuevo gasto fijo mensual" });
  await dlg.getByLabel("Descripción").fill(tag);
  await dlg.getByLabel("Monto mensual (Bs)").fill("1000,01");
  await dlg.getByLabel(/Gasto fijo compartido entre sucursales/).check();
  const rows = dlg.getByRole("group", { name: "Reparto entre sucursales" });
  await rows.getByLabel("Porcentaje (%)").nth(0).fill("60");
  await rows.getByLabel("Porcentaje (%)").nth(1).fill("40");
  await dlg.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Gasto fijo guardado")).toBeVisible();
  const row = page.locator("tr", { hasText: tag });
  await expect(row).toContainText("Compartido");
  await expect(row).toContainText("60 %");

  const generated = page.waitForResponse((r) => r.url().endsWith("/api/expenses/recurring/generate") && r.ok());
  await page.getByRole("button", { name: /Generar/ }).first().click();
  await generated;
  const draft = page.locator("tr", { hasText: tag }).filter({ hasText: "fijo" });
  await expect(draft.first()).toContainText("Compartido");
});
