import { expect, test } from "@playwright/test";
import { encodePng } from "../server/src/lib/png";

// B-096: la propietaria sube el logo (se ve en la barra lateral) y marca una plantilla de
// consentimiento como revisada. Datos de la semilla demo; la imagen se genera en la prueba.
test("logo de la clínica en la barra lateral y «Marcar revisada» en un consentimiento", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();

  await page.goto("/configuracion");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Logo de la clínica" }) });
  await expect(card).toBeVisible();
  const png = encodePng(240, 90, (x, y) => [(x * 3) % 256, (y * 5) % 256, 120]);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/clinic/logo") && r.request().method() === "POST");
  await card.getByLabel("Elegir imagen del logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Logo guardado")).toBeVisible();
  await expect(card.getByAltText("Logo actual de la clínica")).toBeVisible();
  const side = page.locator(".sidebar").getByAltText("Logo de la clínica");
  await expect(side).toBeVisible();
  expect(await side.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Consentimientos" }).click();
  const row = page.locator("tr", { has: page.getByRole("button", { name: "Marcar revisada" }) }).first();
  const title = (await row.locator("td").first().innerText()).trim();
  await row.getByRole("button", { name: "Marcar revisada" }).click();
  const dlg = page.getByRole("dialog", { name: "Marcar revisada" });
  await dlg.getByLabel("Nota (opcional)").fill("Revisada por la asesoría (prueba)");
  await dlg.getByRole("button", { name: "Marcar revisada" }).click();
  await expect(page.getByText("Plantilla marcada como revisada")).toBeVisible();
  const done = page.locator("tr", { hasText: title }).first();
  await expect(done.getByText("Revisada", { exact: true })).toBeVisible();
  await expect(done.getByRole("button", { name: "Marcar revisada" })).toHaveCount(0);

  // Se quita el logo para no afectar otras pruebas que revisan la barra lateral.
  await page.getByRole("tab", { name: "Clínica" }).click();
  await card.getByRole("button", { name: "Quitar logo" }).click();
  await page.getByRole("dialog", { name: "Quitar logo" }).getByRole("button", { name: "Quitar logo" }).click();
  await expect(page.getByText("Logo quitado")).toBeVisible();
  await expect(side).toHaveCount(0);
});
