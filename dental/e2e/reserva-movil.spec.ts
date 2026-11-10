import { expect, test, type Page } from "@playwright/test";

// Celular de gama baja: 360 px de ancho (proyecto "celular", Pixel 7 con pantalla táctil).
test.use({ viewport: { width: 360, height: 740 } });

const SLUG = "sonrisa-andina-demo";

async function noOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `desborde horizontal en ${where}`).toBeLessThanOrEqual(1);
}

test("paciente nuevo reserva desde el celular con código, ve la cita en Mi cuenta y la cancela", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/401|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  const phone = `7${Math.floor(1000000 + Math.random() * 8999999)}`;
  const ci = String(Math.floor(2e6 + Math.random() * 7e6));

  await page.goto(`/reservar/${SLUG}`);
  await expect(page.getByText("Sonrisa Andina (demo)")).toBeVisible();
  await expect(page.getByText("Paso 1 de 7: Sucursal")).toBeVisible();
  await noOverflow(page, "sucursal");
  const next = page.locator(".pt-sticky .btn-primary");
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: /La Paz Centro/ }).click();
  await next.click();

  await expect(page.getByText("Paso 2 de 7: Servicio")).toBeVisible();
  await page.getByRole("button", { name: /Consulta y diagnóstico/ }).click();
  await expect(page.getByText(/desde Bs/).first()).toBeVisible();
  await next.click();

  await page.getByRole("button", { name: /Cualquier profesional/ }).click();
  await next.click();

  await expect(page.getByRole("heading", { name: "Elige día y hora" })).toBeVisible();
  // Un día con al menos 48 h de margen, para poder cancelar en línea (plazo de 24 h)
  await page.locator(".pt-day:not([disabled])").nth(2).click();
  await page.locator(".pt-time").first().click();
  await noOverflow(page, "día y hora");
  await next.click();

  await expect(page.getByText("Paso 5 de 7: Tus datos")).toBeVisible();
  await page.getByRole("tab", { name: "Es mi primera vez" }).click();
  // Validación en línea: todos los errores a la vez, junto al campo
  await next.click();
  await expect(page.getByText("Escribe el nombre")).toBeVisible();
  await expect(page.getByText("Escribe el apellido")).toBeVisible();
  await expect(page.getByText(/Escribe un celular válido/)).toBeVisible();
  await page.getByLabel("Nombres").fill("Valeria");
  await page.getByLabel("Apellidos").fill("Condori Prueba");
  await page.getByLabel("Día").fill("14");
  await page.getByLabel("Mes").selectOption("3");
  await page.getByLabel("Año").fill("1994");
  await page.getByLabel("Número de carnet (CI)").fill(ci);
  await page.getByLabel("Celular (WhatsApp)").fill(phone);
  const fontSize = await page.getByLabel("Nombres").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);
  await noOverflow(page, "datos");
  await next.click();

  await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
  // El código se lee de la bandeja de mensajes simulados (nada sale fuera de producción)
  const login = await request.post("/api/auth/login", { data: { email: "propietaria@demo.local", password: "Demo2026dental" } });
  expect(login.ok()).toBeTruthy();
  const msgs = await (await request.get("/api/messages")).json();
  const otp = msgs.items.find((m: any) => m.recipient === `+591${phone}` && m.template === "portal.otp");
  expect(otp.status).toBe("simulated");
  const code = otp.body.match(/\d{6}/)[0];
  await page.getByLabel("Código de 6 dígitos").fill(code);
  await next.click();

  await expect(page.getByRole("heading", { name: "Revisa tu reserva" })).toBeVisible();
  await expect(page.getByText("Consulta y diagnóstico").first()).toBeVisible();
  await expect(page.getByText(/Puedes reprogramar o cancelar en línea hasta 24 h antes/)).toBeVisible();
  await noOverflow(page, "revisión");
  await next.click();
  await expect(page.getByText(/Para reservar necesitamos tu autorización/)).toBeVisible();
  await page.getByRole("checkbox", { name: /usar mis datos personales/ }).check();
  await next.click();

  await expect(page.getByText("¡Listo! Tu cita quedó reservada.")).toBeVisible();
  await expect(page.locator(".pt-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(page.getByRole("link", { name: /Agregar al calendario/ })).toHaveAttribute("href", /\/ics$/);
  await expect(page.getByRole("link", { name: /Cómo llegar/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /WhatsApp de La Paz Centro/ })).toHaveAttribute("href", /wa\.me\/59170000101/);
  await noOverflow(page, "confirmación");
  await page.getByRole("link", { name: "Ver, reprogramar o cancelar" }).click();

  await expect(page.getByRole("heading", { name: "Hola, Valeria" })).toBeVisible();
  await expect(page.getByText("Próximas citas")).toBeVisible();
  await expect(page.getByText("Consulta y diagnóstico").first()).toBeVisible();
  await noOverflow(page, "mi cuenta");
  await page.getByRole("button", { name: "Cancelar cita" }).click();
  await page.getByRole("button", { name: "Sí, cancelar la cita" }).click();
  await expect(page.getByText("Cancelamos tu cita.")).toBeVisible();
  await expect(page.getByText("No tienes citas por venir.")).toBeVisible();
  await page.getByRole("tab", { name: "Pagos" }).click();
  await expect(page.getByText("Pagos en la clínica o por transferencia; la clínica confirma el pago.")).toBeVisible();
  expect(errors).toEqual([]);
});
