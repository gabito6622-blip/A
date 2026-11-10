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
const laPazHM = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", hour12: false });

test("recordatorio 24 h → ejecutar → mensaje simulado → confirmar desde /c/:token → la cita queda «Confirmada»", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await login(page, "propietaria@demo.local");

  // Configuración → Mensajes automáticos
  await page.click('a:has-text("Configuración")');
  await page.getByRole("tab", { name: "Mensajes automáticos" }).click();
  await expect(page.getByText("Modo de pruebas: ningún mensaje sale del sistema")).toBeVisible();

  // Sin horario de silencio para que la prueba no dependa de la hora real.
  await page.getByLabel("Silencio desde").fill("00:00");
  await page.getByLabel("Silencio hasta").fill("00:00");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Horario de silencio guardado")).toBeVisible();

  // Un solo aviso claro: se apaga la confirmación al agendar y se crea el recordatorio 24 h.
  await page.getByRole("button", { name: "Desactivar regla Confirmación al agendar" }).click();
  await expect(page.getByText("Regla «Confirmación al agendar» desactivada")).toBeVisible();

  // Plantilla con variable inexistente: error junto al campo, sin guardar.
  await page.getByRole("button", { name: "Nueva plantilla" }).click();
  const tdlg = page.getByRole("dialog", { name: "Nueva plantilla" });
  await tdlg.getByLabel("Nombre de la plantilla").fill("Prueba E2E");
  await tdlg.getByLabel("Texto del mensaje").fill("Hola {nombre}, tu {tratamiento} es mañana");
  await expect(tdlg.getByText(/No se permiten datos clínicos/)).toBeVisible();
  await expect(tdlg.getByRole("button", { name: "Guardar plantilla" })).toBeDisabled();
  await tdlg.getByLabel("Texto del mensaje").fill("Hola {nombre}, te esperamos el {fecha} a las {hora}");
  await expect(tdlg.getByTestId("tpl-preview")).toHaveText("Hola Lucía, te esperamos el jueves 12 de noviembre a las 10:30");
  await tdlg.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: "Nueva regla" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva regla" });
  await dlg.getByLabel("Nombre de la regla").fill("Recordatorio 24 h E2E");
  await expect(dlg.getByLabel("Cuándo se envía")).toHaveValue("appointment_reminder");
  await expect(dlg.getByLabel("Cantidad")).toHaveValue("24");
  await dlg.getByLabel("Sucursal").selectOption({ label: "La Paz Centro" });
  await dlg.getByLabel("Plantilla").selectOption({ label: "Recordatorio de cita (Recordatorios)" });
  await dlg.getByRole("button", { name: "Guardar regla" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("button", { name: "Desactivar regla Recordatorio 24 h E2E" })).toBeVisible();

  // Paciente ficticio con consentimiento y una cita dentro de las próximas 24 h (por la API, misma sesión).
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  const lpz = me.branches.find((b: any) => b.code === "LPZ").id;
  const staff = await (await page.request.get("/api/staff?professionals=1")).json();
  const vargas = staff.find((s: any) => s.fullName === "Dra. Elena Vargas").userId;
  const pat = await page.request.post("/api/patients", { headers, data: { firstName: "Mensaje", lastName: "E2E Recordatorio", documentType: "SIN", phone: "71230000", consentReminders: true, allowDuplicate: true } });
  expect(pat.ok()).toBeTruthy();
  const patientId = (await pat.json()).id;
  let apptId = "";
  let startsAt = new Date();
  // Dentro de las próximas 24 h y en el horario visible de la agenda (07:00–21:00), de la última hora hacia atrás.
  for (let h = 23.5; h >= 1 && !apptId; h -= 0.5) {
    startsAt = new Date(Math.ceil((Date.now() + h * 3_600_000) / 1_800_000) * 1_800_000);
    if (startsAt.getTime() > Date.now() + 23.9 * 3_600_000) continue;
    const hh = Number(laPazHM(startsAt).slice(0, 2));
    if (hh < 8 || hh > 19) continue;
    const r = await page.request.post("/api/appointments", {
      headers, data: { branchId: lpz, dentistId: vargas, patientId, startsAt: startsAt.toISOString(), durationMin: 30, allowOutsideSchedule: true },
    });
    if (r.ok()) apptId = (await r.json()).id;
  }
  expect(apptId).not.toBe("");

  // Ejecutar ahora → el mensaje simulado aparece en el panel de entregas.
  await page.getByRole("button", { name: "Ejecutar ahora" }).click();
  await expect(page.getByText(/Última ejecución: \d+ a la bandeja/)).toBeVisible();
  await page.getByRole("link", { name: "Ver entregas" }).click();
  await expect(page.getByRole("heading", { name: "Mensajes" })).toBeVisible();
  await page.getByLabel("Regla").selectOption({ label: "Recordatorio 24 h E2E" });
  const row = page.getByRole("row", { name: /Mensaje E2E Recordatorio/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Simulado (no enviado)")).toBeVisible();
  const text = await row.innerText();
  expect(text).toContain(`a las ${laPazHM(startsAt)}`);
  const path = /\/c\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(text)?.[0];
  expect(path).toBeTruthy();

  // Por día: el conteo incluye el simulado.
  await page.getByRole("tab", { name: "Por día" }).click();
  await expect(page.getByRole("table", { name: "Mensajes por día" })).toBeVisible();

  // El paciente abre el enlace (página pública) y confirma.
  await page.goto(path!);
  await expect(page.getByRole("heading", { name: "Hola Mensaje, ¿confirmas tu cita?" })).toBeVisible();
  await expect(page.getByText(laPazHM(startsAt), { exact: true })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "La Paz Centro" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmo" }).click();
  await expect(page.getByRole("heading", { name: /Tu cita quedó confirmada/ })).toBeVisible();
  // Reutilizar el enlace ya no confirma de nuevo.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Este enlace ya se usó" })).toBeVisible();

  // En la agenda la cita aparece «Confirmada».
  await page.goto("/agenda");
  await page.getByLabel("Sucursal de la agenda").selectOption({ label: "La Paz Centro" });
  await page.fill('input[aria-label="Fecha"]', laPazDate(startsAt));
  await page.locator(".appt", { hasText: "Mensaje E2E Recordatorio" }).click();
  await expect(page.locator(".drawer").getByText("Confirmada").first()).toBeVisible();
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
