import { expect, test } from "@playwright/test";

// B-095: el seguimiento de presupuestos muestra por defecto los últimos 90 días; se puede elegir
// otro período y el aviso explica qué se está viendo. Datos de la semilla demo.
test("seguimiento de presupuestos: período de 90 días por defecto, cambio de período y aviso", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/presupuestos");
  const period = page.getByLabel("Bandejas: presupuestos de");
  await expect(period).toHaveValue("90");
  await expect(page.getByRole("note")).toContainText("en los últimos 90 días");

  const waitFunnel = (listDays: string) => page.waitForResponse((r) => r.url().includes("/api/budget-funnel?") && r.url().includes(`listDays=${listDays}`) && r.ok());
  const all = waitFunnel("all");
  await period.selectOption("all");
  const body = await (await all).json();
  await expect(page.getByRole("note")).toContainText("sin límite de fecha");
  // El número de cada bandeja es el total, aunque la lista esté cortada.
  const expired = page.getByRole("region", { name: "Vencido" });
  await expect(expired.locator("h2 .badge")).toHaveText(String(body.counts.expired));
  if (body.counts.expired > body.buckets.expired.length) await expect(expired.getByRole("button", { name: "Ver más" })).toBeVisible();

  await period.selectOption("30");
  await expect(page.getByRole("note")).toContainText("en los últimos 30 días");
  // La descarga a Excel usa el mismo período.
  await expect(page.locator('a[href*="/api/budget-funnel.xlsx"]')).toHaveAttribute("href", /listDays=30/);
});
