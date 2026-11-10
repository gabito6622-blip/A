import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
/** Llamada a la API con la sesión de la página (cookie + token CSRF). */
async function apiPost(page: Page, url: string, data: unknown) {
  const me = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.post(url, { data, headers: { "x-csrf-token": me.csrfToken } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
const todayLaPaz = () => new Intl.DateTimeFormat("en-GB", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());

test.describe.configure({ mode: "serial" });

test("convenio con precio especial, afiliado, presupuesto con precio del convenio y conciliación de un QR pendiente", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|409|400)/.test(m.text())) errors.push(m.text()); });
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const agName = `Empresa E2E ${tag} (ficticia)`;

  // 1) La propietaria crea el convenio: la empresa paga 70 % y la resina de 1 superficie cuesta Bs 123,45.
  await login(page, "propietaria@demo.local");
  await page.click('a:has-text("Convenios")');
  await page.getByRole("button", { name: "Nuevo convenio" }).click();
  const dlg = page.getByRole("dialog", { name: "Nuevo convenio" });
  await dlg.getByLabel("Nombre del convenio").fill(agName);
  await dlg.getByLabel("NIT (opcional)").fill("998877665");
  await dlg.getByLabel("La empresa paga (%)").fill("70");
  await dlg.getByRole("button", { name: "Agregar regla" }).click();
  const target = dlg.getByLabel("Regla 1: se aplica a");
  await target.selectOption(await target.locator("option", { hasText: "OPE-01" }).getAttribute("value"));
  await dlg.getByLabel("Tipo de regla").selectOption("price");
  await dlg.getByLabel("Precio (Bs)").fill("123,45");
  await dlg.getByRole("button", { name: "Crear convenio" }).click();
  await expect(page.getByText("Convenio creado")).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(agName.replace(/[()]/g, ".")) })).toBeVisible();

  // 2) Un paciente nuevo se afilia desde su ficha.
  const p = await apiPost(page, "/api/patients", { firstName: "Afiliada", lastName: `E2E ${tag}`, documentType: "CI", documentNumber: `77${Date.now() % 1e7}`, phone: "70012345", allowDuplicate: true });
  await page.goto(`/pacientes/${p.id}`);
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Convenio" }) });
  await card.getByRole("button", { name: "Afiliar" }).click();
  const en = page.getByRole("dialog", { name: "Afiliar a un convenio" });
  const agSel = en.getByLabel("Convenio");
  await agSel.selectOption(await agSel.locator("option", { hasText: agName }).getAttribute("value"));
  await en.getByLabel("N° de afiliado").fill(`AF-${tag}`);
  await en.getByRole("button", { name: "Guardar afiliación" }).click();
  await expect(en).toBeHidden();
  await expect(card.locator(".badge", { hasText: "Vigente" })).toBeVisible();
  await expect(card.getByText(`AF-${tag}`)).toBeVisible();

  // 3) Presupuesto: el precio del convenio se aplica y queda copiado en la línea.
  await page.getByRole("tab", { name: "Presupuestos" }).click();
  await page.getByRole("button", { name: "Nuevo presupuesto" }).click();
  const ed = page.getByRole("dialog", { name: "Nuevo presupuesto" });
  await expect(ed.getByText(`Paciente afiliado a ${agName}`)).toBeVisible();
  const prof = ed.getByLabel("Profesional");
  await prof.selectOption({ index: 1 });
  const add = ed.getByLabel("Agregar prestación");
  await add.selectOption(await add.locator("option", { hasText: "OPE-01" }).getAttribute("value"));
  const row = ed.locator("tbody tr").first();
  await row.locator('input[placeholder="Req."]').fill("36");
  await row.getByRole("button", { name: "O", exact: true }).click();
  await expect(row.locator('input[inputmode="decimal"]').first()).toHaveValue("123,45");
  await expect(row.getByText(/precio especial · lista Bs\s?250,00/)).toBeVisible();
  await ed.getByRole("button", { name: "Guardar borrador" }).click();
  const det = page.getByRole("dialog", { name: /Presupuesto N° \d+/ });
  await expect(det.getByText(`Convenio ${agName}: precio especial`)).toBeVisible();
  await expect(det.getByText(/Lista: Bs\s?250,00/)).toBeVisible();
  await expect(det.getByText(/Paga la empresa · .*Bs\s?86,42/)).toBeVisible();
  await det.getByRole("button", { name: "Cerrar" }).first().click();

  // 4) Recepción registra un pago QR: queda por verificar.
  const recCtx = await browser.newContext();
  const rec = await recCtx.newPage();
  await login(rec, "recepcion.lpz@demo.local");
  const ref = `QR-E2E-${tag}`;
  const branchId = (await (await rec.request.get("/api/auth/me")).json()).branches[0].id;
  const pay = await apiPost(rec, "/api/payments", { branchId, patientId: p.id, amountCents: 9876, method: "qr", bankReference: ref, idempotencyKey: `e2e-${tag}` });
  expect(pay.status).toBe("pending_verification");
  await recCtx.close();

  // 5) Contabilidad sube el extracto, revisa la vista previa, importa y confirma el emparejamiento exacto.
  const accCtx = await browser.newContext();
  const acc = await accCtx.newPage();
  acc.on("console", (m) => { if (m.type() === "error" && !/status of (401|409|400)/.test(m.text())) errors.push(m.text()); });
  await login(acc, "contabilidad@demo.local");
  await acc.click('a:has-text("Conciliación")');
  const csv = `Banco Ficticio S.A. - extracto (datos inventados)\nFecha;Descripción;Nro. operación;Abono\n${todayLaPaz()};Pago QR recibido;${ref};98,76\n${todayLaPaz()};Depósito sin identificar;DEP-${tag};1.234,00\n`;
  await acc.getByLabel("Archivo del extracto").setInputFiles({ name: "extracto.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(acc.getByText("2 abonos nuevos")).toBeVisible();
  await expect(acc.getByText("1 exactos")).toBeVisible();
  await expect(acc.getByText("Coincidencia exacta").first()).toBeVisible();
  await acc.getByLabel("Cuenta o banco del extracto").fill("Banco Ficticio cta. 1-000000");
  await acc.getByRole("button", { name: "Importar 2 movimientos" }).click();
  await expect(acc.getByText(/Ningún pago se verificó solo/)).toBeVisible();
  const line = acc.getByTestId("bank-line").filter({ hasText: ref });
  await expect(line.getByText("Coincidencia exacta")).toBeVisible();
  await line.getByRole("button", { name: "Confirmar" }).click();
  await acc.getByRole("dialog", { name: "Confirmar pago con el extracto" }).getByRole("button", { name: "Confirmar pago" }).click();
  await expect(acc.getByText("Pago confirmado con el extracto")).toBeVisible();
  await expect(acc.getByTestId("bank-line").filter({ hasText: ref })).toHaveCount(0);
  await acc.getByRole("tab", { name: "Conciliados" }).click();
  await expect(acc.getByTestId("bank-line").filter({ hasText: ref }).getByText("Coincidencia exacta")).toBeVisible();
  const confirmed = await (await acc.request.get("/api/payments?status=confirmed")).json();
  expect(confirmed.find((x: any) => x.bankReference === ref)).toBeTruthy();
  await accCtx.close();
  expect(errors).toEqual([]);
});
