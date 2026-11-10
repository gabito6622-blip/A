import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}

test("recepción crea una tarea para el odontólogo; él la ve en su Inicio y la marca hecha", async ({ page }) => {
  const title = `Firmar la orden de laboratorio E2E ${Date.now().toString(36)}`;
  await login(page, "recepcion.lpz@demo.local");
  await page.getByRole("link", { name: "Tareas" }).click();
  await expect(page.getByRole("heading", { name: "Tareas" })).toBeVisible();
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  const dlg = page.getByRole("dialog", { name: "Nueva tarea" });
  // Sin título ni persona: errores junto al campo
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await expect(dlg.getByText("Escribe un título de al menos 3 caracteres")).toBeVisible();
  await dlg.getByLabel("¿Qué hay que hacer?").fill(title);
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await expect(dlg.getByText("Elige a quién se la asignas")).toBeVisible();
  await dlg.getByLabel("Persona").selectOption({ label: "Dr. Luis Mendoza · Odontólogo" });
  await dlg.getByRole("button", { name: "Alta" }).click();
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await expect(page.getByText("Tarea creada")).toBeVisible();
  await page.getByRole("tab", { name: "Creadas por mí" }).click();
  await expect(page.getByRole("article", { name: `Tarea: ${title}` })).toBeVisible();

  // El odontólogo la ve en su Inicio y la marca hecha
  await login(page, "dr.mendoza@demo.local");
  await expect(page.getByRole("heading", { name: "Tus tareas" })).toBeVisible();
  const card = page.getByRole("article", { name: `Tarea: ${title}` });
  await expect(card).toBeVisible();
  await expect(card.getByText("Prioridad alta")).toBeVisible();
  await expect(card.getByText("Dr. Luis Mendoza")).toBeVisible();
  await card.getByRole("button", { name: "Marcar hecha" }).click();
  await expect(page.getByText("Tarea marcada como hecha")).toBeVisible();
  await expect(card).toHaveCount(0);

  // Recepción la ve como hecha
  await login(page, "recepcion.lpz@demo.local");
  await page.goto("/tareas?vista=creadas");
  await page.getByRole("button", { name: "Hechas" }).click();
  const done = page.getByRole("article", { name: `Tarea: ${title}` });
  await expect(done).toBeVisible();
  await expect(done.getByText("Hecha")).toBeVisible();
});

test("registrar una llamada desde la ficha: aparece en el historial y crea la tarea de volver a llamar", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { "x-csrf-token": me.csrfToken };
  const last = `Llamada E2E ${Date.now().toString(36)}`;
  const pat = await page.request.post("/api/patients", { headers, data: { firstName: "Paciente", lastName: last, documentType: "SIN", phone: "71234568", allowDuplicate: true } });
  expect(pat.ok(), await pat.text()).toBeTruthy();
  await page.goto(`/pacientes/${(await pat.json()).id}`);
  await expect(page.getByRole("heading", { name: `Paciente ${last}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Llamar a Paciente/ })).toHaveAttribute("href", /^tel:\+?\d+$/);
  await page.getByRole("button", { name: "Registrar llamada" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar llamada" });
  await dlg.getByRole("button", { name: "Guardar llamada" }).click();
  await expect(dlg.getByText("Elige el resultado de la llamada")).toBeVisible();
  await dlg.getByRole("button", { name: "Pidió volver a llamar" }).click();
  await dlg.getByLabel("Duración (minutos)").fill("abc");
  await dlg.getByRole("button", { name: "Guardar llamada" }).click();
  await expect(dlg.getByText(/número entero/)).toBeVisible();
  await dlg.getByLabel("Duración (minutos)").fill("2");
  await dlg.getByLabel("Nota (opcional)").fill("Prefiere que lo llamen en la tarde");
  await expect(dlg.getByLabel("Crear una tarea para volver a llamar (a tu cargo)")).toBeChecked();
  await dlg.getByRole("button", { name: "Guardar llamada" }).click();
  await expect(page.getByText("Llamada registrada y tarea creada para volver a llamar")).toBeVisible();
  const hist = page.locator("section", { has: page.getByRole("heading", { name: "Historial" }) });
  await expect(hist.getByText("Llamada: pidió que lo volvamos a llamar")).toBeVisible();
  await expect(hist.getByText(/2 min · Prefiere que lo llamen en la tarde/)).toBeVisible();
  // La tarea de seguimiento queda en "Mis tareas", ligada al paciente
  await page.getByRole("link", { name: "Tareas" }).click();
  const task = page.getByRole("article", { name: "Tarea: Volver a llamar al paciente" }).filter({ hasText: last });
  await expect(task).toBeVisible();
  await expect(task.getByText("Por una llamada")).toBeVisible();
});

test("el diario de actividad muestra frases claras y limpieza ve sus tareas sin pacientes", async ({ page }) => {
  await login(page, "propietaria@demo.local");
  await page.getByRole("link", { name: "Actividad" }).click();
  await expect(page.getByRole("heading", { name: "Actividad del equipo" })).toBeVisible();
  await expect(page.getByText(/Recepción LPZ registró una llamada a /).first()).toBeVisible();
  await page.getByLabel("Tipo").selectOption({ label: "Cobros y caja" });
  await page.getByLabel("Desde").fill(new Date(Date.now() - 31 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" }));
  await expect(page.getByText(/registró un pago .* de Bs [\d.,]+ a .+\./).first()).toBeVisible();
  await page.getByLabel("Desde").fill("2026-12-31");
  await page.getByLabel("Hasta").fill("2026-01-01");
  await expect(page.getByText("La fecha «Desde» es posterior a «Hasta».")).toBeVisible();

  await login(page, "limpieza.lpz@demo.local");
  await expect(page).toHaveURL(/\/bioseguridad$/);
  await expect(page.getByRole("heading", { name: "Tus tareas" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Tarea: Desinfección profunda del Consultorio 3 el sábado" })).toBeVisible();
  await page.getByRole("link", { name: "Tareas" }).click();
  await page.getByRole("tab", { name: "Tablero" }).click();
  const linked = page.getByRole("article", { name: "Tarea: Confirmar por teléfono el control del paciente" });
  await expect(linked.getByText("Paciente (sin acceso)")).toBeVisible();
  await expect(page.getByRole("link", { name: "Pacientes" })).toHaveCount(0);
});
