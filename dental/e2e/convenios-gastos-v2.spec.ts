// B-082 y B-083 en el navegador: trasladar al paciente una porción vencida de la empresa y verla en su
// ficha; registrar un gasto compartido entre sucursales con comprobante y verlo repartido en la rentabilidad.
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
// PNG de 1×1 (comprobante sintético).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.describe.configure({ mode: "serial" });

test("gerencia traslada al paciente una porción vencida de la empresa y el paciente la ve en su ficha", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|409)/.test(m.text())) errors.push(m.text()); });
  await login(page, "gerente@demo.local");
  await page.getByRole("link", { name: "Convenios" }).click();
  await page.getByRole("tab", { name: "Por cobrar a empresas" }).click();
  const row = page.locator("tr", { hasText: "Cooperativa Minera Illimani" });
  await expect(row.getByText(/porción\(es\) impaga\(s\)/)).toBeVisible();
  await row.getByRole("button", { name: "Porciones impagas" }).click();
  const dlg = page.getByRole("dialog", { name: /Porciones impagas · Cooperativa Minera Illimani/ });
  const overdue = dlg.locator("tbody tr", { has: page.locator(".badge", { hasText: "Vencida" }) }).first();
  await expect(overdue).toBeVisible();
  const patient = (await overdue.locator("td").first().locator("b").innerText()).trim();
  await overdue.getByRole("button", { name: "Trasladar al paciente" }).click();

  const form = page.getByRole("dialog", { name: "Trasladar al paciente" });
  await expect(form.getByLabel("La empresa no pagó en el plazo")).toBeChecked();
  // Sin motivo: el error aparece junto al campo (no se usa window.prompt).
  await form.getByRole("button", { name: /^Trasladar Bs/ }).click();
  await expect(form.getByText("Escribe el motivo (mínimo 5 caracteres)")).toBeVisible();
  await form.getByLabel("Motivo (queda en la ficha del paciente)").fill("La cooperativa no respondió en el plazo (prueba e2e)");
  await form.getByRole("button", { name: /^Trasladar Bs/ }).click();
  await expect(page.getByText("Porción trasladada al saldo del paciente")).toBeVisible();
  await expect(form).toBeHidden();
  const moved = dlg.locator("tr", { hasText: "prueba e2e" });
  await expect(moved).toContainText(patient);

  // La ficha del paciente muestra el aviso y el saldo ya lo incluye.
  await moved.getByRole("link", { name: patient }).click();
  const notice = page.getByTestId("payer-transfer-notice");
  await expect(notice).toContainText("Saldo trasladado desde un convenio");
  await expect(notice).toContainText("La cooperativa no respondió en el plazo (prueba e2e)");
  await expect(notice).toContainText("Cooperativa Minera Illimani");
  await page.getByRole("tab", { name: "Cuenta" }).click();
  await expect(page.locator(".kpi", { hasText: "Saldo" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("el gerente registra un gasto compartido con comprobante y lo ve repartido en la rentabilidad", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|409|415)/.test(m.text())) errors.push(m.text()); });
  await login(page, "gerente@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const [b0, b1] = me.branches as { id: string; name: string }[];
  const month = await page.evaluate(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }).slice(0, 7));
  const read = async () => {
    const d = await (await page.request.get(`/api/management/profitability?month=${month}`)).json();
    const v = (id: string) => d.branches.find((x: any) => x.branchId === id)?.expensesCents ?? 0;
    return { a: v(b0!.id), b: v(b1!.id) };
  };
  const before = await read();

  await page.getByRole("link", { name: "Gestión" }).click();
  await page.getByRole("tab", { name: "Gastos" }).click();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar gasto" });
  await dlg.getByLabel("Categoría").selectOption({ label: "Mantenimiento" });
  await dlg.getByLabel("Descripción").fill("Mantenimiento del ascensor compartido (prueba e2e)");
  await dlg.getByLabel("Monto (Bs)").fill("1.000,01");
  await dlg.getByLabel("Gasto compartido entre sucursales (repartir por porcentaje)").check();
  await dlg.locator(".mg-share select").nth(0).selectOption(b0!.id);
  await dlg.locator(".mg-share select").nth(1).selectOption(b1!.id);
  const pct = dlg.getByLabel("Porcentaje (%)");
  await pct.nth(0).fill("60");
  await pct.nth(1).fill("30");
  await dlg.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(dlg.getByRole("alert")).toContainText("deben sumar 100 %");
  await pct.nth(1).fill("40");
  // Vista previa del reparto exacto: el centavo que sobra va a la sucursal con mayor porcentaje.
  await expect(dlg.getByText(await bs(page, 60001))).toBeVisible();
  await expect(dlg.getByText(await bs(page, 40000))).toBeVisible();
  await dlg.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page.getByText("Gasto registrado")).toBeVisible();
  const row = page.locator("tr", { hasText: "Mantenimiento del ascensor compartido (prueba e2e)" });
  await expect(row).toContainText("Compartido");
  await expect(row).toContainText(`${b0!.name} 60 %`);

  // Comprobante real (imagen verificada por firma de bytes).
  await row.getByRole("button", { name: "Comprobantes de Mantenimiento del ascensor compartido (prueba e2e)" }).click();
  const files = page.getByRole("dialog", { name: /Comprobantes · Mantenimiento del ascensor/ });
  await files.getByLabel("Archivo del comprobante").setInputFiles({ name: "factura-ascensor.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Comprobante adjuntado")).toBeVisible();
  await expect(files.getByRole("img", { name: /Comprobante factura-ascensor\.png/ })).toBeVisible();
  // Un archivo que no es imagen ni PDF se rechaza con un mensaje claro en el diálogo.
  await files.getByLabel("Archivo del comprobante").setInputFiles({ name: "factura.png", mimeType: "image/png", buffer: Buffer.from("<html>no es una imagen</html>") });
  await expect(files.getByRole("alert")).toContainText("Tipo de archivo no permitido");
  await files.getByRole("button", { name: "Cerrar" }).last().click();
  await expect(row).toContainText("1 adjunto(s)");

  // Rentabilidad: cada sucursal sube exactamente su parte.
  const after = await read();
  expect(after.a - before.a).toBe(60001);
  expect(after.b - before.b).toBe(40000);
  await page.getByRole("tab", { name: "Rentabilidad" }).click();
  const line = page.locator("table.mg-matrix tr", { hasText: "Gastos de la sucursal" });
  await expect(line).toContainText(await bs(page, after.a));
  await expect(line).toContainText(await bs(page, after.b));
  expect(errors).toEqual([]);
});
