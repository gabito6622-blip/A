import { devices, expect, test } from "@playwright/test";

// Recepción comparte el enlace; la madre de la paciente lo abre en el celular, verifica,
// acepta con firma; recepción ve el presupuesto "Aceptado".
test("presupuesto: enlace público verificado y aceptado con firma desde el celular", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await page.fill("#email", "recepcion.lpz@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.click('a:has-text("Presupuestos")');
  await expect(page.getByRole("region", { name: "Presentado sin respuesta" })).toBeVisible();
  await page.getByRole("tab", { name: "Listado" }).click();
  await page.getByRole("button", { name: "Borrador", exact: true }).click();
  await page.locator("tr", { hasText: "Camila Demo Enlace" }).click();
  const dlg = page.getByRole("dialog", { name: /Presupuesto N°/ });
  await expect(dlg.getByText("Descuento global")).toBeVisible();
  await dlg.getByRole("button", { name: "Compartir enlace" }).click();
  const url = await dlg.locator("#share-url").inputValue();
  expect(url).toContain("/p/presupuesto/");
  await expect(dlg.getByRole("link", { name: "Abrir en WhatsApp" })).toBeVisible();
  await expect(dlg.getByText("Presentado").first()).toBeVisible();

  // Celular de la madre, sin sesión
  const mobile = await browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "es-BO", timezoneId: "America/La_Paz" });
  const m = await mobile.newPage();
  await m.goto(new URL(url).pathname);
  await expect(m.getByRole("heading", { name: "Verifica tu identidad" })).toBeVisible();
  // Antes de verificar no se muestra la clínica ni el presupuesto
  await expect(m.getByText("Sonrisa Andina")).toHaveCount(0);
  await expect(m.getByText("Profilaxis")).toHaveCount(0);
  await m.getByLabel("Últimos 4 dígitos del celular").fill("0000");
  await m.getByRole("button", { name: "Continuar" }).click();
  await expect(m.getByRole("alert")).toContainText("Te quedan 4 intentos");
  await m.getByLabel("Últimos 4 dígitos del celular").fill("5678"); // celular de la madre
  await m.getByRole("button", { name: "Continuar" }).click();
  await expect(m.getByRole("heading", { name: /Hola Camila/ })).toBeVisible();
  await expect(m.getByText("Sonrisa Andina (demo)").first()).toBeVisible();
  await expect(m.getByText("Bs 354,00").first()).toBeVisible();
  await expect(m.getByText("Cuota 3")).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await m.getByRole("button", { name: "Acepto el presupuesto" }).click();
  await m.getByRole("button", { name: "Confirmar aceptación" }).click();
  await expect(m.getByText("Marca la casilla para confirmar.")).toBeVisible(); // validación junto al campo
  await m.getByLabel("Tu nombre completo").fill("Rosa Demo Enlace");
  await m.getByLabel("Soy su madre, padre o tutor").check();
  const pad = m.getByRole("img", { name: "Área de firma" });
  const box = (await pad.boundingBox())!;
  await m.mouse.move(box.x + 30, box.y + 40);
  await m.mouse.down();
  await m.mouse.move(box.x + 120, box.y + 110, { steps: 8 });
  await m.mouse.move(box.x + 220, box.y + 50, { steps: 8 });
  await m.mouse.up();
  await expect(m.getByText("Firma capturada")).toBeVisible();
  await m.getByLabel(/Leí el presupuesto/).check();
  await m.getByRole("button", { name: "Confirmar aceptación" }).click();
  await expect(m.getByText("Presupuesto aceptado")).toBeVisible();
  await expect(m.getByText(/Aceptado por Rosa Demo Enlace/)).toBeVisible();
  await mobile.close();

  // Recepción ve el presupuesto aceptado
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Aceptados", exact: true }).click();
  const row = page.locator("tr", { hasText: "Camila Demo Enlace" });
  await expect(row.getByText("Aceptado")).toBeVisible();
  await row.click();
  await expect(page.getByText(/Aceptado por el paciente en línea: Rosa Demo Enlace/)).toBeVisible();
  await expect(page.getByAltText("Firma de Rosa Demo Enlace")).toBeVisible();
});
