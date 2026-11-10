import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const laPazDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

test("atender una cita propone el próximo control; aparece en Controles y se registra un intento", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  // Preparación por la API (misma sesión): paciente ficticio con consentimiento y una profilaxis mañana a las 20:00,
  // fuera del horario habitual para no chocar con la agenda de demostración.
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  const lpz = me.branches.find((b: any) => b.code === "LPZ").id;
  const staff = await (await page.request.get("/api/staff?professionals=1")).json();
  const vargas = staff.find((s: any) => s.fullName === "Dra. Elena Vargas").userId;
  const pre = (await (await page.request.get("/api/procedures")).json()).find((p: any) => p.code === "PRE-01").id;
  const pat = await page.request.post("/api/patients", { headers, data: { firstName: "Control", lastName: "E2E Seis Meses", documentType: "SIN", phone: "71234567", consentReminders: true, allowDuplicate: true } });
  expect(pat.ok()).toBeTruthy();
  const date = laPazDate(new Date(Date.now() + 86_400_000));
  const appt = await page.request.post("/api/appointments", {
    headers, data: { branchId: lpz, dentistId: vargas, patientId: (await pat.json()).id, procedureId: pre, startsAt: `${date}T20:00:00-04:00`, durationMin: 30, allowOutsideSchedule: true },
  });
  expect(appt.ok(), await appt.text()).toBeTruthy();

  // Agenda → abrir la cita → Llegó → En atención → Atendido
  await page.click('a:has-text("Agenda")');
  await page.getByLabel("Sucursal de la agenda").selectOption({ label: "La Paz Centro" });
  await page.fill('input[aria-label="Fecha"]', date);
  await page.locator(".appt", { hasText: "Control E2E Seis Meses" }).click();
  const drawer = page.locator(".drawer");
  for (const step of ["Llegó", "En atención", "Atendido"]) {
    await drawer.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByText("Estado actualizado").first()).toBeVisible();
  }

  // Diálogo "Próximo control": motivo e intervalo vienen de la prestación (profilaxis → 6 meses)
  const dlg = page.getByRole("dialog", { name: "Próximo control" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel("Motivo del control")).toHaveValue("Profilaxis (limpieza dental)");
  await expect(dlg.getByRole("button", { name: "6 meses" })).toHaveAttribute("aria-pressed", "true");
  await dlg.getByRole("button", { name: "Programar control" }).click();
  await expect(page.getByText(/Control programado para/)).toBeVisible();

  // Aparece en Controles en el mes objetivo
  const month = addMonths(date, 6).slice(0, 7);
  await page.click('a:has-text("Controles")');
  await expect(page.getByRole("heading", { name: "Controles" })).toBeVisible();
  await page.goto(`/controles?mes=${month}`);
  const card = page.getByRole("article", { name: "Control de Control E2E Seis Meses" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Profilaxis (limpieza dental)")).toBeVisible();
  await expect(card.getByText("Sin intentos de contacto")).toBeVisible();
  // WhatsApp solo con consentimiento y sin datos clínicos en el mensaje
  const wa = await card.getByRole("link", { name: "WhatsApp" }).getAttribute("href");
  expect(wa).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  expect(decodeURIComponent(wa!)).not.toContain("Profilaxis");

  // Registrar un intento: sin resultado muestra el error junto al campo
  await card.getByRole("button", { name: "Registrar intento" }).click();
  const att = page.getByRole("dialog", { name: "Registrar intento de contacto" });
  await att.getByRole("button", { name: "Guardar intento" }).click();
  await expect(att.getByRole("alert")).toHaveText("Elige el resultado del intento");
  await att.getByRole("button", { name: "Llamada" }).click();
  await att.getByRole("button", { name: "No contesta" }).click();
  await att.getByLabel("Nota (opcional)").fill("Llamar después de las 18:00");
  await att.getByRole("button", { name: "Guardar intento" }).click();
  await expect(page.getByText("Intento registrado")).toBeVisible();
  await expect(card.getByText(/1 intento\(s\) · último: Llamada, no contesta/)).toBeVisible();
});

test("la sala de espera muestra las citas pasadas sin cerrar y se resuelven con un clic", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await page.click('a:has-text("Sala de espera")');
  const box = page.getByRole("region", { name: "Citas pasadas sin cerrar" });
  await expect(box).toBeVisible();
  const rows = box.locator("tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  const btn = box.getByRole("button", { name: "No asistió" }).first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByText(/: no asistió/)).toBeVisible();
  await expect(rows).toHaveCount(before - 1);
});
