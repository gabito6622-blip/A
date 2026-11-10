import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.locator("#email")).toBeVisible();
}
const inDays = (n: number) => {
  const d = new Date(Date.now() + n * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
};

test.describe.configure({ mode: "serial" });

test("orden de laboratorio: crear y enviar → registrar llegada → pista al agendar → pago al laboratorio", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|409|400)/.test(m.text())) errors.push(m.text()); });

  // 1) El odontólogo crea la orden de una corona en la pieza 11 y la envía
  await login(page, "dr.mendoza@demo.local");
  await page.click('a:has-text("Laboratorio")');
  await expect(page.getByRole("heading", { name: "Laboratorio" })).toBeVisible();
  await page.getByRole("button", { name: "Nueva orden" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva orden de laboratorio" });
  await dlg.getByPlaceholder("Buscar por nombre, CI, teléfono o N° de ficha").fill("Mamani");
  const first = dlg.locator(".card button").first();
  const patientName = (await first.locator("span").first().innerText()).trim();
  await first.click();
  await dlg.getByRole("combobox", { name: "Laboratorio", exact: true }).selectOption({ label: "Laboratorio Dental Andes (ficticio)" });
  await dlg.getByRole("combobox", { name: "Sucursal", exact: true }).selectOption({ label: "La Paz Centro" });
  await dlg.getByRole("button", { name: "Pieza 11", exact: true }).click();
  await expect(dlg.getByRole("button", { name: "Pieza 11", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dlg.getByLabel("Color (guía Vita clásica)").selectOption("A2");
  await dlg.getByRole("button", { name: "Digital" }).click();
  await expect(dlg.getByLabel("Costo del laboratorio (Bs)")).toHaveValue("450,00"); // sugerido por la lista de precios
  await dlg.getByLabel("Fecha prometida de entrega").fill(inDays(3));
  await dlg.getByRole("button", { name: "Guardar y enviar" }).click();
  const toast = page.locator(".toast", { hasText: /Orden N° \d+ enviada al laboratorio/ });
  await expect(toast).toBeVisible();
  const number = (await toast.innerText()).match(/N° (\d+)/)![1]!;
  const detail = page.getByRole("dialog", { name: `Orden de laboratorio N° ${number}` });
  await expect(detail.locator(".badge", { hasText: "Enviado" })).toBeVisible();
  await detail.getByRole("button", { name: "Cerrar" }).click();
  await logout(page);

  // 2) Recepción registra la llegada del trabajo (el costo queda fijo)
  await login(page, "recepcion.lpz@demo.local");
  await page.click('a:has-text("Laboratorio")');
  await page.locator("tbody tr", { hasText: "corona 11" }).filter({ hasText: patientName }).first().click();
  const d2 = page.getByRole("dialog", { name: `Orden de laboratorio N° ${number}` });
  await d2.getByRole("button", { name: "Registrar llegada" }).click();
  await expect(d2.getByLabel("Costo del laboratorio (Bs)")).toHaveValue("450,00");
  await d2.getByRole("button", { name: "Confirmar" }).click();
  await expect(d2.locator(".badge", { hasText: "Recibido" })).toBeVisible();
  await expect(d2.getByText(/Bs\s?450,00 \(fijo\)/)).toBeVisible();
  await d2.getByRole("button", { name: "Cerrar" }).click();

  // 3) Al agendar, la recepción ve que el trabajo está listo
  await page.click('a:has-text("Agenda")');
  await page.getByRole("button", { name: "Nueva cita" }).click();
  const appt = page.getByRole("dialog", { name: "Nueva cita" });
  await appt.getByPlaceholder("Buscar por nombre, CI, teléfono o N° de ficha").fill("Mamani");
  await appt.locator(".card button").first().click();
  await expect(appt.getByText("Trabajo de laboratorio listo: corona 11")).toBeVisible();
  await appt.getByRole("button", { name: "Cancelar" }).click();
  await logout(page);

  // 4) Contabilidad registra el pago al laboratorio
  await login(page, "contabilidad@demo.local");
  await page.click('a:has-text("Laboratorio")');
  await page.getByRole("tab", { name: "Por pagar" }).click();
  await page.getByLabel(`Seleccionar orden N° ${number}`).check();
  await page.getByRole("button", { name: "Pagar 1 seleccionada(s)" }).click();
  const pay = page.getByRole("dialog", { name: "Registrar pago al laboratorio" });
  await expect(pay.getByLabel("Monto total (Bs)")).toHaveValue("450,00");
  await pay.getByRole("button", { name: "Registrar pago" }).click();
  await expect(pay.getByText("Indica el N° de transferencia, cheque o comprobante")).toBeVisible(); // error junto al campo
  await pay.getByRole("textbox", { name: "Referencia" }).fill(`E2E-LAB-${number}`);
  await pay.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText(/Pago de Bs\s?450,00 registrado/)).toBeVisible();
  await expect(page.getByLabel(`Seleccionar orden N° ${number}`)).toHaveCount(0);
  await expect(page.locator("section[aria-label='Pagos registrados']").getByText(`ref. E2E-LAB-${number}`)).toBeVisible();
  expect(errors).toEqual([]);
});
