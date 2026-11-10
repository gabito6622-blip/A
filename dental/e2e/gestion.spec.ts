import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const bs = (page: Page, cents: number) => page.evaluate((c) => new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(c / 100).replace("BOB", "Bs"), cents);

test("el gerente registra un gasto y lo ve en la rentabilidad de la sucursal; al anularlo deja de contar", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|409)/.test(m.text())) errors.push(m.text()); });
  await login(page, "gerente@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const eal = me.branches.find((b: any) => b.code === "EAL");
  const month = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }).slice(0, 7));
  const read = async () => (await (await page.request.get(`/api/management/profitability?month=${month}&branchId=${eal.id}`)).json()).branches[0].expensesCents ?? 0;
  const before = await read();

  await page.getByRole("link", { name: "Gestión" }).click();
  await page.locator("header.topbar select").selectOption(eal.id);
  await page.getByRole("tab", { name: "Gastos" }).click();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar gasto" });
  await dlg.getByLabel("Categoría").selectOption({ label: "Mantenimiento" });
  await dlg.getByLabel("Descripción").fill("Reparación del sillón (prueba e2e)");
  // Sin monto: el error aparece junto al campo
  await dlg.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(dlg.getByText("Escribe un monto mayor que cero")).toBeVisible();
  await dlg.getByLabel("Monto (Bs)").fill("777,77");
  await dlg.getByLabel("Comprobante (opcional)").fill("Factura 4711");
  await dlg.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page.getByText("Gasto registrado")).toBeVisible();
  const row = page.locator("tr", { hasText: "Reparación del sillón (prueba e2e)" });
  await expect(row).toContainText("Confirmado");

  // Rentabilidad de El Alto: los gastos suben exactamente Bs 777,77
  await page.getByRole("tab", { name: "Rentabilidad" }).click();
  const line = page.locator("table.mg-matrix tr", { hasText: "Gastos de la sucursal" });
  await expect(line).toContainText(await bs(page, before + 77777));
  // De dónde sale el número
  await line.getByRole("button", { name: /De dónde sale «Gastos de la sucursal»/ }).click();
  await expect(page.locator("tr.mg-explain")).toContainText("Gastos confirmados y no anulados");
  await expect(page.locator("table.mg-matrix tr", { hasText: "Costo de materiales" })).toBeVisible();

  // Anular con motivo (diálogo propio, no window.prompt): deja de contar
  await page.getByRole("tab", { name: "Gastos" }).click();
  await page.getByRole("button", { name: "Anular Reparación del sillón (prueba e2e)" }).click();
  const ask = page.getByRole("dialog", { name: "Anular gasto" });
  await ask.getByLabel("Motivo de la anulación").fill("Se cargó en la sucursal equivocada");
  await ask.getByRole("button", { name: "Anular gasto" }).click();
  await expect(row).toContainText("Anulado");
  expect(await read()).toBe(before);
  expect(errors).toEqual([]);
});

test("el panel admite un rango libre y lo compara con el período anterior", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  await page.getByRole("button", { name: "Rango libre" }).click();
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }));
  const from = new Date(Date.parse(today + "T12:00:00Z") - 6 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Desde").fill(from);
  await page.getByLabel("Hasta").fill(today);
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Comparación con el período anterior" }) });
  const prevTo = new Date(Date.parse(from + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const [y, m, d] = prevTo.split("-");
  await expect(card).toContainText(`${d}/${m}/${y}`);
  await expect(card.locator("tbody tr")).toHaveCount(5);
  await expect(card.getByRole("link", { name: "Exportar a Excel" })).toHaveAttribute("href", new RegExp(`from=${from}`));
  await page.getByRole("button", { name: "Ver por mes" }).click();
  await expect(page.getByRole("button", { name: "Mes anterior" })).toBeVisible();
});
