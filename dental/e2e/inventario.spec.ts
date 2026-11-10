import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", "Demo2026dental");
  const me = page.waitForResponse((r) => r.url().endsWith("/api/auth/me") && r.request().method() === "GET");
  await page.click('button:has-text("Ingresar")');
  await me;
}

const stockRow = (page: Page, name: string) => page.locator("tr", { has: page.getByText(name, { exact: true }) });

test("recibir una OC con lote, realizar un tratamiento que lo consume y ver bajar el stock con la alerta de mínimo", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("401")) errors.push(m.text()); }); // 401: /api/auth/me al cambiar de usuario

  // 1) La asistente de La Paz Centro ve la pasta profiláctica en cero y bajo el mínimo
  await login(page, "asistente@demo.local");
  await page.getByRole("link", { name: "Inventario" }).first().click();
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible();
  const pasta = stockRow(page, "Pasta profiláctica");
  await expect(pasta.getByText("0", { exact: true })).toBeVisible();
  await expect(pasta.getByText("Bajo mínimo").last()).toBeVisible();

  // 2) Registra la llegada de la orden de compra con número de lote y vencimiento
  await page.getByRole("tab", { name: "Compras" }).click();
  await page.locator("tr", { hasText: "OC-0001" }).click();
  const po = page.getByRole("dialog", { name: /Orden OC-0001/ });
  await expect(po.getByText("Enviada")).toBeVisible();
  await po.getByRole("button", { name: "Registrar lo que llegó" }).click();
  const rcv = page.getByRole("dialog", { name: /Registrar lo que llegó/ });
  await rcv.getByLabel("Factura o nota de entrega del proveedor").fill("F-E2E-001");
  await rcv.getByRole("button", { name: "Ingresar al stock" }).click();
  await expect(rcv.getByText("Indica el número de lote")).toBeVisible(); // error junto al campo, sin ventanas emergentes
  await rcv.getByLabel("Número de lote").fill("PP-E2E-1");
  await rcv.getByLabel("Vencimiento").fill("2027-12-31");
  await rcv.getByRole("button", { name: "Ingresar al stock" }).click();
  await expect(page.getByText("Mercadería recibida: la orden está completa")).toBeVisible();
  await expect(po.getByText("Recibida", { exact: true })).toBeVisible();
  await expect(po.getByText(/lote PP-E2E-1/)).toBeVisible();
  await po.getByRole("button", { name: "Cerrar", exact: true }).click();

  await page.getByRole("tab", { name: "Stock" }).click();
  await expect(pasta.getByText("50", { exact: true })).toBeVisible();
  await expect(pasta.getByText("Bajo mínimo")).toHaveCount(0);

  // 3) La odontóloga marca la profilaxis como realizada (consume 1 dosis de pasta)
  await login(page, "dra.vargas@demo.local");
  await page.getByRole("link", { name: "Presupuestos" }).first().click();
  await page.getByRole("tab", { name: "Listado" }).click();
  await page.getByRole("button", { name: "Aceptados" }).click();
  await page.locator("tr", { hasText: "Inés Demo Inventario" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Realizado" }).click();
  await expect(page.getByText("Tratamiento registrado como realizado")).toBeVisible();

  // 4) De vuelta en inventario: 49 (bajo el mínimo de 50) y la alerta aparece
  await login(page, "asistente@demo.local");
  await page.getByRole("link", { name: "Inventario" }).first().click();
  await expect(pasta.getByText("49", { exact: true })).toBeVisible();
  await expect(pasta.getByText("Bajo mínimo").last()).toBeVisible();
  await page.getByRole("tab", { name: /Alertas/ }).click();
  const low = page.locator("section", { has: page.getByRole("heading", { name: /Bajo el mínimo/ }) });
  await expect(low.getByText("49 / mín. 50 dosis")).toBeVisible();
  await page.getByRole("tab", { name: "Movimientos" }).click();
  await expect(page.locator("tr", { hasText: "Tratamiento realizado" }).filter({ hasText: "Pasta profiláctica" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("consumo rápido: error claro junto al campo si no alcanza y registro con FEFO", async ({ page }) => {
  await login(page, "asistente@demo.local");
  await page.goto("/inventario");
  await page.getByRole("button", { name: "Consumir", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Consumir insumo" });
  await dlg.getByRole("button", { name: "Registrar consumo" }).click();
  await expect(dlg.getByText("Elige el insumo")).toBeVisible();
  await dlg.getByLabel("Insumo").selectOption({ label: "Sutura de seda 3-0 · SUT-30" });
  await dlg.getByLabel(/Cantidad/).fill("5000");
  await dlg.getByRole("button", { name: "Registrar consumo" }).click();
  await expect(dlg.getByRole("alert").filter({ hasText: /Stock insuficiente de «Sutura de seda 3-0»/ })).toBeVisible();
  await expect(dlg.getByText(/Máximo disponible/)).toBeVisible();
  await dlg.getByLabel(/Cantidad/).fill("1");
  await dlg.getByRole("button", { name: "Registrar consumo" }).click();
  await expect(page.getByText("Consumo registrado: 1 sobre de Sutura de seda 3-0")).toBeVisible();
});

test("en el celular la asistente llega a Inventario por la barra inferior, sin desborde horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "asistente@demo.local");
  const nav = page.getByRole("navigation", { name: "Navegación móvil" });
  await nav.getByText("Inventario").click();
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible();
  for (const tab of ["Stock", "Alertas", "Lotes", "Movimientos", "Transferencias", "Conteo físico", "Compras", "Proveedores"]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `desborde en ${tab}`).toBeLessThanOrEqual(1);
  }
});
