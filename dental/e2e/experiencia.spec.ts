import { devices, expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

/** Paciente ficticio y una cita que empieza ahora en La Paz Centro (fuera de horario: solo administración). */
async function patientWithAppointmentNow(req: APIRequestContext, csrf: string, birthDate: string) {
  const headers = { "x-csrf-token": csrf };
  const me = await (await req.get("/api/auth/me")).json();
  const lpz = me.branches.find((b: any) => b.code === "LPZ").id;
  const tag = Math.random().toString(36).slice(2, 7);
  const phone = `7${Math.floor(1000000 + Math.random() * 8999999)}`;
  const p = await (await req.post("/api/patients", { headers, data: { firstName: "Llegada", lastName: `E2E ${tag}`, documentType: "SIN", birthDate, phone, allowDuplicate: true } })).json();
  const staff = await (await req.get("/api/staff?professionals=1")).json();
  // La semilla demo llena la agenda según la hora del día: si a esta hora no hay nadie libre, se prueba
  // unos minutos antes o después (la llegada sigue dentro de la ventana de la cita).
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  for (const offsetMin of [0, -10, 10, -20, 20]) {
    const start = new Date(now + offsetMin * 60_000).toISOString();
    for (const d of staff) {
      const r = await req.post("/api/appointments", { headers, data: { branchId: lpz, dentistId: d.userId, patientId: p.id, startsAt: start, durationMin: 20, allowOutsideSchedule: true, source: "walk_in" } });
      if (r.ok()) return { patientId: p.id, name: `Llegada E2E ${tag}`, phone, appointmentId: (await r.json()).id, lpz };
    }
  }
  throw new Error("No hubo un profesional libre para la cita de prueba");
}

const mobile = (browser: Browser) => browser.newContext({ ...devices["Pixel 7"], locale: "es-BO", timezoneId: "America/La_Paz" });

test("llegada con QR desde el celular → el paciente aparece «En sala de espera»", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await login(page, "propietaria@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const pt = await patientWithAppointmentNow(page.request, me.csrfToken, "1993-04-18");

  // El QR impreso de la sucursal (la semilla crea uno por sucursal)
  await page.click('a:has-text("Experiencia")');
  await page.getByRole("tab", { name: "Llegada con QR" }).click();
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "La Paz Centro" }) });
  await expect(card.getByRole("img", { name: /Código QR de llegada de La Paz Centro/ })).toBeVisible();
  const url = (await card.locator(".xp-url").textContent())!.trim();
  const path = new URL(url).pathname;

  // El paciente escanea con su celular
  const ctx = await mobile(browser);
  const phonePage = await ctx.newPage();
  const phoneErrors: string[] = [];
  phonePage.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) phoneErrors.push(m.text()); });
  await phonePage.goto(path);
  await expect(phonePage.getByRole("heading", { name: "¿Ya estás en la sucursal?" })).toBeVisible();
  await expect(phonePage.getByText("La Paz Centro")).toBeVisible();
  // Validación junto al campo
  await phonePage.getByRole("button", { name: "Ya llegué" }).click();
  await expect(phonePage.getByText("Escribe los 4 últimos dígitos de tu celular")).toBeVisible();
  // Datos que no corresponden: no revela nada
  await phonePage.getByLabel("4 últimos dígitos de tu celular").fill("0000");
  await phonePage.getByLabel("Día").fill("18");
  await phonePage.getByLabel("Mes").fill("4");
  await phonePage.getByLabel("Año").fill("1993");
  await phonePage.getByRole("button", { name: "Ya llegué" }).click();
  await expect(phonePage.getByText(/No encontramos una cita próxima/)).toBeVisible();
  await phonePage.getByLabel("4 últimos dígitos de tu celular").fill(pt.phone.slice(-4));
  await phonePage.getByRole("button", { name: "Ya llegué" }).click();
  await expect(phonePage.getByRole("heading", { name: "¡Llegada registrada!" })).toBeVisible();
  await expect(phonePage.locator("body")).not.toContainText("Llegada E2E");
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();

  // Recepción la ve en la sala de espera
  await page.getByLabel("Sucursal").first().selectOption({ label: "La Paz Centro" });
  await page.click('a:has-text("Sala de espera")');
  const waiting = page.locator('section[aria-label^="En sala de espera"]');
  await expect(waiting.getByRole("link", { name: pt.name })).toBeVisible();
  expect(errors).toEqual([]);
  expect(phoneErrors).toEqual([]);
});

test("encuesta de satisfacción: el paciente responde y gerencia la ve en el panel con su aviso", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await login(page, "propietaria@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  const pt = await patientWithAppointmentNow(page.request, me.csrfToken, "1988-08-08");
  for (const status of ["arrived", "completed"]) {
    expect((await page.request.post(`/api/appointments/${pt.appointmentId}/status`, { headers, data: { status } })).ok()).toBe(true);
  }
  const link = await (await page.request.post(`/api/appointments/${pt.appointmentId}/survey-link`, { headers, data: {} })).json();

  const ctx = await mobile(browser);
  const p2 = await ctx.newPage();
  await p2.goto(new URL(link.url).pathname);
  await expect(p2.getByRole("heading", { name: /recomiendes/ })).toBeVisible();
  await expect(p2.locator("body")).not.toContainText("Llegada E2E");
  await p2.getByRole("button", { name: "Enviar mi opinión" }).click();
  await expect(p2.getByText("Elige una nota del 0 al 10")).toBeVisible();
  await p2.getByRole("button", { name: "3", exact: true }).click();
  await p2.getByLabel(/contarnos algo más/).fill("E2E: la espera fue larga");
  await p2.getByRole("button", { name: "Enviar mi opinión" }).click();
  await expect(p2.getByRole("heading", { name: "¡Gracias por tu opinión!" })).toBeVisible();
  // Un solo uso
  await p2.reload();
  await expect(p2.getByText("Ya recibimos tu respuesta para esta visita.")).toBeVisible();
  await ctx.close();

  await page.goto("/experiencia?tab=encuestas");
  const alerts = page.locator(".card", { has: page.getByRole("heading", { name: /Requieren atención de gerencia/ }) });
  const row = alerts.locator("li", { hasText: pt.name });
  await expect(row).toContainText("3/10");
  await expect(row).toContainText("E2E: la espera fue larga");
  await row.getByRole("button", { name: "Registrar seguimiento" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar seguimiento" });
  await dlg.getByLabel("Seguimiento realizado").fill("Llamamos y reprogramamos con prioridad");
  await dlg.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Seguimiento registrado")).toBeVisible();
  await expect(alerts.locator("li", { hasText: pt.name })).toHaveCount(0);
  await expect(page.locator(".kpi", { hasText: "NPS" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("familia en la ficha y segmento con vista previa de campaña", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await login(page, "propietaria@demo.local");
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Sofía Pérez Arce");
  await page.getByRole("row", { name: /Sofía Pérez Arce Demo/ }).click();
  const fam = page.locator(".card", { has: page.getByRole("heading", { name: "Familia" }) });
  await expect(fam.locator("li", { hasText: "Rodrigo Pérez Demo" })).toContainText("Tutor legal");
  await expect(fam.locator("li", { hasText: "Tomás Pérez Arce Demo" })).toContainText("Hermano/a");
  await expect(fam.locator("li", { hasText: "Lucía Arce Demo" })).toContainText("Madre");
  await expect(page.getByLabel("Etiquetas del paciente")).toContainText("Ortodoncia activa");

  await page.click('a:has-text("Experiencia")');
  await page.getByRole("group", { name: "Segmentos guardados" }).getByRole("button", { name: "Ortodoncia activa", exact: true }).click();
  await expect(page.getByRole("heading", { name: /\d+ pacientes?/ })).toBeVisible();
  await page.getByRole("button", { name: "Preparar campaña" }).click();
  const dlg = page.getByRole("dialog", { name: "Campaña manual" });
  await dlg.getByLabel("Mensaje").fill("Hola {nombre}, tu {tratamiento} te espera");
  await dlg.getByRole("button", { name: "Revisar destinatarios" }).click();
  await expect(dlg.getByText(/No se permiten datos clínicos/)).toBeVisible();
  await dlg.getByLabel("Mensaje").fill("Hola {nombre}, en {clinica} tenemos horarios los sábados.");
  await dlg.getByRole("button", { name: "Revisar destinatarios" }).click();
  await expect(dlg.getByText("Por qué se excluyen")).toBeVisible();
  await expect(dlg.getByText(/Menor de edad/)).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^Enviar a/ })).toBeDisabled();
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  expect(errors).toEqual([]);
});
