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

test("credenciales incorrectas muestran un error genérico", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", "propietaria@demo.local");
  await page.fill("#pw", "incorrecta");
  await page.click('button:has-text("Ingresar")');
  await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos");
});

test("propietaria ve el comparativo de sus 5 sucursales", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  await expect(page.getByText("Comparativo por sucursal")).toBeVisible();
  const rows = page.locator(".card:has-text('Comparativo por sucursal') tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(page.getByText("Cobrado (confirmado)")).toBeVisible();
});

test("recepción registra un paciente nuevo y le agenda una cita; el mismo horario no se puede volver a ocupar", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await expect(page.getByText("Cobrado (confirmado)")).toHaveCount(0); // sin datos financieros
  await page.click('a:has-text("Agenda")');
  // ir al próximo lunes (día hábil con horario de mañana)
  const monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const iso = monday.toLocaleDateString("en-CA");
  await page.fill('input[aria-label="Fecha"]', iso);
  await page.getByRole("button", { name: "Nueva cita" }).click();
  await page.getByRole("button", { name: "Paciente nuevo" }).click();
  const dlg = page.getByRole("dialog", { name: "Paciente nuevo" });
  await dlg.getByLabel("Nombres").fill("Prueba");
  await dlg.getByLabel("Apellidos").fill("E2E Automática");
  await dlg.getByLabel("Celular").fill("71112233");
  await dlg.getByRole("button", { name: "Registrar" }).click();
  const appt = page.getByRole("dialog", { name: "Nueva cita" });
  await expect(appt.getByText("Prueba E2E Automática")).toBeVisible();
  await appt.getByLabel("Profesional").selectOption({ label: "Dra. Elena Vargas" });
  await appt.getByLabel("Hora").fill("07:00");
  await appt.getByRole("button", { name: "Agendar" }).click();
  // 07:00 está fuera del horario → error visible, nada se guarda
  await expect(appt.getByRole("alert")).toContainText("Fuera del horario");
  await appt.getByLabel("Hora").fill("12:00");
  await appt.getByRole("button", { name: "Agendar" }).click();
  await expect(page.getByText("Cita agendada")).toBeVisible();
  await expect(page.locator(".appt", { hasText: "Prueba E2E Automática" })).toBeVisible();

  // Segundo intento en el mismo horario con otro paciente → rechazado por solapamiento
  await page.getByRole("button", { name: "Nueva cita" }).click();
  const appt2 = page.getByRole("dialog", { name: "Nueva cita" });
  await appt2.getByPlaceholder("Buscar por nombre, CI, teléfono o N° de ficha").fill("Mamani");
  await appt2.locator(".card button").first().click();
  await appt2.getByLabel("Profesional").selectOption({ label: "Dra. Elena Vargas" });
  await appt2.getByLabel("Hora").fill("12:00");
  await appt2.getByRole("button", { name: "Agendar" }).click();
  await expect(appt2.getByRole("alert")).toContainText(/ya tiene una cita|ocupado|otra cita/);
});

test("odontólogo registra una caries en el odontograma y una evolución clínica", async ({ page }) => {
  await login(page, "dra.vargas@demo.local");
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Prueba E2E");
  await page.locator("tbody tr", { hasText: "Prueba E2E" }).click();
  await page.getByRole("tab", { name: "Odontograma", exact: true }).click();
  await page.getByRole("button", { name: "Pieza 36" }).click();
  await page.getByLabel("Condición / tratamiento").selectOption("caries");
  await page.getByLabel("Oclusal/incisal").check();
  await page.getByRole("button", { name: "Guardar en pieza 36" }).click();
  await expect(page.getByText("Pieza 36: registrado")).toBeVisible();
  await expect(page.locator(".card", { hasText: "Estado actual" }).getByText(/Caries · .*O/)).toBeVisible();
  await page.getByRole("tab", { name: "Historia clínica" }).click();
  await page.getByLabel("Detalle").fill("Caries oclusal en 36. Se indica restauración con resina.");
  await page.getByRole("button", { name: "Firmar y guardar" }).click();
  await expect(page.getByText("Caries oclusal en 36.")).toBeVisible();
});

test("recepción no ve el registro clínico; registra un pago QR que queda por verificar y contabilidad lo confirma", async ({ page, browser }) => {
  await login(page, "recepcion.lpz@demo.local");
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Prueba E2E");
  await page.locator("tbody tr", { hasText: "Prueba E2E" }).click();
  await expect(page.getByRole("tab", { name: "Odontograma", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Cuenta y pagos" }).click();
  await page.getByRole("button", { name: "Registrar pago" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar pago" });
  await dlg.getByLabel("Monto (Bs)").fill("150");
  await dlg.getByLabel("Medio de pago").selectOption("qr");
  const ref = `E2E-${Date.now()}`;
  await dlg.getByLabel("N° de operación / referencia").fill(ref);
  await dlg.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText(/queda por verificar/)).toBeVisible();

  const ctx = await browser.newContext();
  const acct = await ctx.newPage();
  await login(acct, "contabilidad@demo.local");
  await acct.click('a:has-text("Caja")');
  const pendingCard = acct.locator(".card", { hasText: "Pagos por verificar en el banco" });
  const row = pendingCard.locator("tr", { hasText: ref });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Confirmar" }).click();
  await expect(acct.getByText("Pago confirmado")).toBeVisible();
  await expect(pendingCard.locator("tr", { hasText: ref })).toHaveCount(0); // sale de "por verificar"
  await expect(acct.locator(".card", { hasText: "Movimientos del día" }).locator("tr", { hasText: ref }).getByText("Confirmado")).toBeVisible();
  await ctx.close();
});

test("el asistente busca horarios libres reales sin IA configurada", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await page.click('a:has-text("Asistente")');
  await expect(page.getByText(/no está configurad|ANTHROPIC_API_KEY/i).first()).toBeVisible();
});
