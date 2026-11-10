import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// El odontólogo receta amoxicilina a un paciente alérgico a la penicilina: ve el aviso,
// marca «Revisé la alergia», emite, descarga el PDF y una farmacia verifica el código
// en /verificar sin ver datos del paciente.
test("receta con aviso de alergia → PDF → verificación pública", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await page.fill("#email", "dr.mendoza@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
  const errors: string[] = []; // (antes del ingreso, /api/auth/me responde 401 a propósito)
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Demo Receta");
  await page.locator("tbody tr", { hasText: "Rodrigo Demo Receta" }).click();
  await page.getByRole("tab", { name: "Documentos", exact: true }).click();
  await expect(page.getByText("Certificado de atención odontológica C-000001")).toBeVisible();

  await page.getByRole("button", { name: "Nueva receta" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva receta" });
  await expect(dlg.getByText("Alergias registradas:")).toBeVisible();
  await dlg.getByLabel("Medicamento y presentación").fill("Amoxicilina — Cápsulas 500 mg");
  await expect(dlg.getByLabel("Dosis")).toHaveValue("1 cápsula");
  await expect(dlg.getByLabel("Frecuencia")).toHaveValue("Cada 8 horas");
  await expect(dlg.getByRole("alert").filter({ hasText: "Posible alergia" })).toContainText("Penicilina");
  await dlg.getByRole("button", { name: "Emitir receta" }).click();
  await expect(dlg.getByText("Marca «Revisé la alergia» para emitir")).toBeVisible(); // error junto a la casilla
  await dlg.getByLabel(/Revisé la alergia y decido emitir igualmente/).check();
  await dlg.getByRole("button", { name: "Emitir receta" }).click();
  await page.getByRole("dialog", { name: "Emitir receta" }).getByRole("button", { name: "Emitir", exact: true }).click();
  await expect(page.getByText(/Receta R-\d{6} emitida/)).toBeVisible();

  const row = page.locator("tbody tr", { hasText: "Amoxicilina Cápsulas 500 mg" });
  await expect(row.getByText("Aviso de alergia revisado al emitir")).toBeVisible();
  const code = /código ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(await row.innerText())![1]!;
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: /^PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^receta-R-\d{6}\.pdf$/);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 5).toString()).toBe("%PDF-");
  expect(file.length).toBeGreaterThan(5000);

  // Farmacia: sin sesión, en el celular
  const ctx = await browser.newContext({ baseURL, locale: "es-BO", timezoneId: "America/La_Paz", viewport: { width: 390, height: 800 }, isMobile: true });
  const m = await ctx.newPage();
  await m.goto(`/verificar/${code}`);
  await expect(m.getByRole("heading", { name: "Documento auténtico e íntegro" })).toBeVisible();
  const result = m.getByRole("region", { name: "Resultado de la verificación" });
  await expect(result).toContainText("Receta");
  await expect(result).toContainText("Sonrisa Andina (demo)");
  await expect(result).toContainText("Vigente");
  await expect(m.getByText("Rodrigo")).toHaveCount(0);
  await expect(m.getByText("Amoxicilina")).toHaveCount(0);
  // el mismo archivo descargado coincide con el emitido
  await m.getByLabel(/Comprobar un archivo PDF/).setInputFiles({ name: "receta.pdf", mimeType: "application/pdf", buffer: file });
  await expect(m.getByText("El archivo es idéntico al que emitió la clínica.")).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  // un código inexistente
  await m.getByLabel("Código de verificación").fill("0000-0000-0000");
  await m.getByRole("button", { name: "Verificar" }).click();
  await expect(m.getByRole("heading", { name: "Documento no encontrado" })).toBeVisible();
  await ctx.close();
  expect(errors).toEqual([]);
});
