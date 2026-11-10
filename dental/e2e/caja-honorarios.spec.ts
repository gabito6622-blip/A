import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

async function openPaymentDialog(page: Page) {
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Mamani");
  await page.locator("tbody tr.clickable").first().click();
  await page.getByRole("tab", { name: "Cuenta y pagos" }).click();
  await page.getByRole("button", { name: "Registrar pago" }).click();
  return page.getByRole("dialog", { name: "Registrar pago" });
}

test("recepción abre su caja, cobra en efectivo y cierra con arqueo y motivo de la diferencia", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|409|400)/.test(m.text())) errors.push(m.text()); });
  await login(page, "recepcion.lpz@demo.local");

  // Sin caja abierta, la clínica demo no deja cobrar en efectivo
  let dlg = await openPaymentDialog(page);
  await dlg.getByLabel("Monto (Bs)").fill("150,50");
  await dlg.getByRole("button", { name: "Registrar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Abre tu caja");
  await dlg.getByRole("button", { name: "Cancelar" }).click();

  // Abrir caja con fondo de Bs 200
  await page.click('a:has-text("Caja")');
  const panel = page.locator(".card", { has: page.getByRole("heading", { name: "Mi caja" }) });
  await panel.getByLabel("Fondo inicial (Bs)").fill("200");
  await panel.getByRole("button", { name: "Abrir caja" }).click();
  await expect(panel.getByText(/Abierta · N° \d+/)).toBeVisible();

  // Cobro en efectivo
  dlg = await openPaymentDialog(page);
  await dlg.getByLabel("Monto (Bs)").fill("150,50");
  await dlg.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText(/Pago registrado · recibo \d+/)).toBeVisible();

  // Cierre: se cuentan Bs 350 y faltan 50 centavos
  await page.click('a:has-text("Caja")');
  await expect(panel.getByText(/Bs\s?350,50/)).toBeVisible();
  await panel.getByRole("button", { name: "Cerrar caja (arqueo)" }).click();
  const close = page.getByRole("dialog", { name: /Cerrar caja N°/ });
  await close.getByLabel("Cantidad de billetes de Bs 200").fill("1");
  await close.getByLabel("Cantidad de billetes de Bs 100").fill("1");
  await close.getByLabel("Cantidad de billetes de Bs 50").fill("1");
  await expect(close.getByText(/Faltante Bs\s?0,50/)).toBeVisible();
  await close.getByRole("button", { name: "Cerrar caja" }).click();
  await expect(close.getByText("Hay diferencia: explica el motivo")).toBeVisible();
  await close.getByLabel("Motivo de la diferencia (obligatorio)").fill("Se dio 50 centavos de más de cambio");
  await close.getByRole("button", { name: "Cerrar caja" }).click();

  // Reporte de cierre imprimible
  await expect(page.getByRole("heading", { name: /Cierre de caja N° \d+/ })).toBeVisible();
  await expect(page.getByText(/Faltante Bs\s?0,50/).first()).toBeVisible();
  await expect(page.getByText("Se dio 50 centavos de más de cambio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
  await page.click('a:has-text("Caja")');
  await expect(panel.getByRole("button", { name: "Abrir caja" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("administración cierra la liquidación del mes anterior y la exporta; la odontóloga la ve sin poder editarla", async ({ page, browser }) => {
  await login(page, "propietaria@demo.local");
  await page.click('a:has-text("Honorarios")');
  await page.getByRole("button", { name: "Preparar borradores del período" }).click();
  await expect(page.getByText(/borrador\(es\) preparados/)).toBeVisible();
  const row = page.locator("tbody tr", { hasText: "Dra. Elena Vargas" });
  await expect(row.getByText("Borrador")).toBeVisible();
  await row.getByRole("link", { name: "Dra. Elena Vargas" }).click();
  await expect(page.getByRole("heading", { name: "Liquidación de honorarios" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar liquidación" }).click();
  const dlg = page.getByRole("dialog", { name: "Cerrar liquidación" });
  await dlg.getByLabel("Nota (opcional)").fill("Prueba e2e");
  await dlg.getByRole("button", { name: /Cerrar por/ }).click();
  await expect(page.getByText(/Cerrada el .* Este documento ya no cambia/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar liquidación" })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^honorarios-.*\.xlsx$/);

  const ctx = await browser.newContext();
  const dent = await ctx.newPage();
  await login(dent, "dra.vargas@demo.local");
  await dent.click('a:has-text("Honorarios")');
  await expect(dent.getByText("Mis liquidaciones cerradas")).toBeVisible();
  await dent.locator("tbody tr a").first().click();
  await expect(dent.getByRole("heading", { name: "Liquidación de honorarios" })).toBeVisible();
  await expect(dent.getByRole("button", { name: "Cerrar liquidación" })).toHaveCount(0);
  await expect(dent.getByRole("button", { name: "Descartar" })).toHaveCount(0);
  await ctx.close();
});
