import { expect, test, type Page } from "@playwright/test";

// Agenda: serie mensual con un conflicto resuelto, arrastrar en la vista semanal y deshacer,
// e historial del paciente. Datos ficticios creados por la API en la misma sesión.
const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const laPaz = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
const weekday = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = domingo
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit" });

async function ctx(page: Page) {
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  const lpz = me.branches.find((b: any) => b.code === "LPZ").id;
  const staff = await (await page.request.get("/api/staff?professionals=1")).json();
  const vargas = staff.find((s: any) => s.fullName === "Dra. Elena Vargas").userId;
  const patient = async (lastName: string) => {
    const r = await page.request.post("/api/patients", { headers, data: { firstName: "Paciente", lastName, documentType: "SIN", phone: "70000001", allowDuplicate: true } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).id as string;
  };
  const book = async (patientId: string, date: string, time: string, durationMin = 30) => {
    const r = await page.request.post("/api/appointments", { headers, data: { branchId: lpz, dentistId: vargas, patientId, startsAt: `${date}T${time}:00-04:00`, durationMin } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).id as string;
  };
  return { headers, lpz, vargas, patient, book };
}

async function openAgenda(page: Page, view: "grid" | "week", date: string) {
  await page.click('a:has-text("Agenda")');
  const sel = page.getByLabel("Sucursal de la agenda");
  if (await sel.count()) await sel.selectOption({ label: "La Paz Centro" });
  await page.getByLabel("Vista").selectOption(view);
  await page.fill('input[aria-label="Fecha"]', date);
}

test("serie mensual de ortodoncia: se muestra un conflicto, se usa el horario sugerido y se agendan las 3 citas", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  const c = await ctx(page);
  // Primera fecha cuyos 3 meses caen de lunes a viernes (la Dra. Vargas atiende hasta las 19:00).
  let start = laPaz(new Date(Date.now() + 3 * 86_400_000));
  const ok = (d: string) => [0, 1, 2].every((k) => ![0, 6].includes(weekday(addMonths(d, k))));
  for (let i = 0; i < 60 && !ok(start); i++) start = laPaz(new Date(Date.parse(start + "T12:00:00Z") + 86_400_000));
  const pid = await c.patient("Serie Ortodoncia E2E");
  // La segunda fecha ya está ocupada por otra paciente a la misma hora.
  await c.book(await c.patient("Ocupa Horario E2E"), addMonths(start, 1), "18:30");

  await openAgenda(page, "grid", start);
  await page.getByRole("button", { name: "Nueva cita" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva cita" });
  await dlg.getByPlaceholder("Buscar por nombre, CI, teléfono o N° de ficha").fill("Serie Ortodoncia E2E");
  await dlg.locator(".card button", { hasText: "Serie Ortodoncia E2E" }).first().click();
  await dlg.getByLabel("Profesional").selectOption({ label: "Dra. Elena Vargas" });
  await dlg.getByLabel("Tipo de cita").selectOption({ label: "Ortodoncia (30 min)" });
  await expect(dlg.getByLabel("Duración (min)")).toHaveValue("30");
  await dlg.getByLabel("Fecha", { exact: true }).fill(start);
  await dlg.getByLabel("Hora").fill("18:30");
  await dlg.getByLabel(/Repetir esta cita/).check();
  await dlg.getByLabel("Cada cuántas").fill("1");
  await dlg.getByLabel("Unidad").selectOption("monthly");
  await dlg.getByLabel("Cantidad de citas").fill("3");
  await dlg.getByRole("button", { name: "Revisar fechas" }).click();

  await expect(dlg.getByText("3 fechas: 2 libres, 1 con conflicto")).toBeVisible();
  const second = dlg.getByRole("listitem", { name: "Cita 2" });
  await expect(second).toContainText("El profesional ya tiene una cita en ese horario");
  await expect(dlg.getByRole("button", { name: "Agendar 2 citas" })).toBeVisible();
  await second.getByRole("button", { name: /^Usar / }).click();
  await dlg.getByRole("button", { name: "Agendar 3 citas" }).click();
  await expect(page.getByText("Serie agendada: 3 citas")).toBeVisible();

  const from = `${start}T00:00:00-04:00`, to = `${start}T23:59:00-04:00`;
  const list = await (await page.request.get(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&patientId=${pid}`)).json();
  const series = await (await page.request.get(`/api/appointment-series/${list[0].seriesId}`)).json();
  expect(series.appointments).toHaveLength(3);
  expect(series.appointments.map((a: any) => a.index)).toEqual([1, 2, 3]);
  expect(list[0].typeName).toBe("Ortodoncia");
  expect(hm(series.appointments[1].startsAt)).not.toBe("18:30");
});

test("vista semanal: arrastrar una cita a otro horario, conflicto revertido y Deshacer", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  const c = await ctx(page);
  let day = laPaz(new Date(Date.now() + 2 * 86_400_000));
  while ([0, 6].includes(weekday(day))) day = laPaz(new Date(Date.parse(day + "T12:00:00Z") + 86_400_000));
  const pid = await c.patient("Arrastre E2E");
  const apptId = await c.book(pid, day, "18:30");
  // Dos huecos libres de la Dra. Vargas cerca de las 18:30: uno queda libre y el otro se ocupa (conflicto).
  const av = await (await page.request.get(`/api/availability?date=${day}&branchId=${c.lpz}&dentistId=${c.vargas}&durationMin=30`)).json();
  const toMin = (iso: string) => Number(hm(iso).slice(0, 2)) * 60 + Number(hm(iso).slice(3));
  const free = (av[0]?.slots ?? []).map(toMin).filter((m: number) => m >= 16 * 60 && m !== 18 * 60 + 30 && Math.abs(m - (18 * 60 + 30)) >= 30)
    .sort((a: number, b: number) => Math.abs(a - 1110) - Math.abs(b - 1110));
  expect(free.length).toBeGreaterThanOrEqual(2);
  const target = free[0] as number;
  const busy = free.find((m: number) => Math.abs(m - target) >= 30) as number; // sin chocar con el destino libre
  expect(busy).toBeDefined();
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  await c.book(await c.patient("Ocupante Semana E2E"), day, hhmm(busy));

  await openAgenda(page, "week", day);
  await expect(page.getByRole("heading", { name: /^Semana del/ })).toBeVisible();
  const block = page.locator(".wk-appt", { hasText: "Arrastre E2E" });
  await expect(block).toContainText("18:30");
  const col = page.locator(`.wk-col[data-drop-col="${day}"]`);

  const dragTo = async (min: number) => {
    await block.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const b = (await block.boundingBox())!;
    const cb = (await col.boundingBox())!;
    const y = cb.y + ((min - 7 * 60) / 15) * 15 + 4;
    await page.mouse.move(b.x + b.width / 2, b.y + 4);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2, b.y + 4 + ((y - b.y - 4) * i) / 8);
    await expect(page.locator(".wk-ghost")).toContainText(hhmm(min));
    await page.mouse.up();
  };

  // 1) Horario ocupado: el servidor rechaza, se ve el error y la cita vuelve a su lugar.
  await dragTo(busy);
  await expect(page.getByRole("dialog")).toHaveCount(0); // soltar no abre "Nueva cita"
  await expect(page.getByRole("alert")).toContainText("No se pudo mover la cita de Paciente Arrastre E2E");
  await expect(block).toContainText("18:30");

  // 2) Horario libre: se mueve y se puede deshacer durante 8 segundos.
  await dragTo(target);
  await expect(page.getByRole("status").filter({ hasText: "Cita de Paciente Arrastre E2E movida" })).toBeVisible();
  await expect(block).toContainText(hhmm(target));
  let a = await (await page.request.get(`/api/appointments/${apptId}`)).json();
  expect(hm(a.startsAt)).toBe(hhmm(target));
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(block).toContainText("18:30");
  a = await (await page.request.get(`/api/appointments/${apptId}`)).json();
  expect(hm(a.startsAt)).toBe("18:30");

  // Teclado: la flecha derecha pasa a la semana siguiente.
  const h = await page.getByRole("heading", { name: /^Semana del/ }).textContent();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: /^Semana del/ })).not.toHaveText(h!);
});

test("historial del paciente: línea de tiempo con filtros y sin datos clínicos para quien no los puede ver", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  const c = await ctx(page);
  const pid = await c.patient("Historial E2E");
  let day = laPaz(new Date(Date.now() + 4 * 86_400_000));
  while ([0, 6].includes(weekday(day))) day = laPaz(new Date(Date.parse(day + "T12:00:00Z") + 86_400_000));
  await c.book(pid, day, "18:30");
  const pay = await page.request.post("/api/payments", { headers: c.headers, data: { branchId: c.lpz, patientId: pid, amountCents: 12000, method: "transfer", bankReference: `E2E-${Date.now()}`, idempotencyKey: `e2e-tl-${pid}` } });
  expect(pay.ok(), await pay.text()).toBeTruthy();

  await page.goto(`/pacientes/${pid}`);
  const hist = page.getByRole("region", { name: "Historial" });
  await expect(hist).toBeVisible();
  await expect(hist.getByText("Horas de La Paz")).toBeVisible();
  await expect(hist.getByText("Cita agendada")).toBeVisible();
  await expect(hist.getByText(new RegExp(`Para el .* 18:30`))).toBeVisible();
  await expect(hist.getByText("Pago recibido · Transferencia")).toBeVisible();
  // La propietaria no es profesional: no hay filtros ni datos clínicos.
  await expect(hist.getByRole("button", { name: "Notas clínicas" })).toHaveCount(0);
  await hist.getByRole("button", { name: "Cargos y pagos" }).click();
  await expect(hist.getByRole("button", { name: "Cargos y pagos" })).toHaveAttribute("aria-pressed", "true");
  await expect(hist.getByText("Pago recibido · Transferencia")).toBeVisible();
  await expect(hist.getByText("Cita agendada")).toHaveCount(0);
  await hist.getByRole("button", { name: "Todo" }).click();
  await expect(hist.getByText("Cita agendada")).toBeVisible();
});
