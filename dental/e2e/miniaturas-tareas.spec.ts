import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

// B-081 y B-084: al subir una foto el navegador genera su miniatura y la galería la muestra sin
// pedir originales (el original solo se carga al abrir el visor); el contador de tareas pendientes
// aparece junto a «Tareas» (menú lateral y «Más» del celular) y se actualiza al marcar una hecha.
// Imágenes sintéticas generadas en la prueba.

function syntheticPng(w: number, h: number, seed: number): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { raw[o++] = (x + seed) % 256; raw[o++] = (y + seed * 3) % 256; raw[o++] = ((x ^ y) + seed) % 256; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
const loaded = (page: Page, sel: string) => page.locator(sel).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test("subir una foto: la galería muestra su miniatura y no carga originales hasta abrir el visor", async ({ page }) => {
  await login(page, "dr.mendoza@demo.local");
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const originals: string[] = [];
  page.on("request", (r) => { if (/\/api\/clinical-files\/[^/]+\/content/.test(r.url())) originals.push(r.url()); });
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Demo Imágenes");
  await page.locator("tbody tr", { hasText: "Valeria Demo Imágenes" }).click();
  await page.getByRole("tab", { name: "Imágenes y archivos" }).click();
  // las imágenes de la demo ya tienen miniatura
  await expect.poll(() => loaded(page, ".cf-thumb img")).toBe(true);
  expect(await page.locator(".cf-thumb img").first().getAttribute("src")).toMatch(/\/thumb\?t=/);

  await page.getByLabel("Elegir archivos para subir").setInputFiles({ name: "sonrisa.png", mimeType: "image/png", buffer: syntheticPng(1200, 900, 11) });
  const dlg = page.getByRole("dialog", { name: "Subir a la ficha" });
  await dlg.getByLabel("Tipo de archivo").selectOption({ label: "Foto extraoral" });
  await dlg.getByLabel("Piezas (opcional)").fill("17");
  await dlg.getByRole("button", { name: "Subir", exact: true }).click();
  await expect(page.getByText("1 archivo subido")).toBeVisible();

  const card = page.getByRole("button", { name: /Foto extraoral, pieza 17/ });
  await expect(card).toBeVisible();
  const img = card.locator(".cf-thumb img");
  await expect(img).toHaveAttribute("src", /\/api\/clinical-files\/[0-9a-f-]+\/thumb\?t=/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const size = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }));
  expect(size).toEqual({ w: 320, h: 240 }); // la miniatura, no el original de 1200 × 900
  expect(originals).toEqual([]); // la galería no pidió ningún original

  await card.click();
  const viewer = page.getByRole("dialog", { name: /Visor: Foto extraoral · pieza 17/ });
  await expect.poll(() => loaded(page, ".cf-full .cf-zoom img")).toBe(true);
  expect(await page.locator(".cf-full .cf-zoom img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1200);
  expect(originals.length).toBe(1); // solo al abrirlo
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("contador de tareas pendientes junto a «Tareas» (menú lateral y «Más» del celular)", async ({ page }) => {
  await login(page, "dr.mendoza@demo.local");
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const api = async () => (await page.request.get("/api/tasks/pending-count")).json() as Promise<{ total: number; overdue: number }>;
  const before = await api();
  expect(before.total).toBeGreaterThan(0); // la demo le asigna tareas a él y a su rol
  const navLink = page.locator('.sidebar a[href="/tareas"]');
  await expect(navLink.getByTestId("task-count")).toHaveText(String(before.total));
  await expect(navLink).toHaveAccessibleName(new RegExp(`Tareas.*${before.total} pendiente`));
  await expect(navLink.getByTestId("task-count")).toHaveClass(before.overdue ? /overdue/ : /^nav-count$/);

  // marcar una como hecha actualiza el contador sin recargar la página
  await navLink.click();
  await expect(page.getByRole("heading", { name: "Tareas" })).toBeVisible();
  await page.getByRole("button", { name: "Marcar hecha" }).first().click();
  await expect(page.getByText("Tarea marcada como hecha")).toBeVisible();
  const after = await api();
  expect(after.total).toBe(before.total - 1);
  if (after.total) await expect(navLink.getByTestId("task-count")).toHaveText(String(after.total));
  else await expect(navLink.getByTestId("task-count")).toHaveCount(0);

  // en el celular, «Tareas» queda dentro de «Más»: punto en el botón y número en el menú
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: /Agenda/ }).first().click();
  const more = page.locator(".bottom-nav").getByRole("button", { name: /Más/ });
  if (after.total) await expect(more.locator(".nav-dot")).toBeVisible();
  await more.click();
  const sheet = page.getByRole("dialog", { name: "Menú completo" });
  if (after.total) await expect(sheet.locator('a[href="/tareas"]').getByTestId("task-count")).toHaveText(String(after.total));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("cita atendida en la agenda: copiar el enlace de la encuesta y prepararla para WhatsApp", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page, "recepcion.lpz@demo.local");
  const me = await (await page.request.get("/api/auth/me")).json();
  const branchId = me.branches[0].id as string;
  // Una cita atendida de los últimos días cuya encuesta no se respondió (la demo es relativa a hoy).
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 12 * 86_400_000).toISOString();
  const list = await (await page.request.get(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&branchId=${branchId}`)).json() as any[];
  let appt: any = null;
  for (const a of list.filter((x) => x.status === "completed").reverse()) {
    const r = await page.request.post(`/api/appointments/${a.id}/survey-link`, { headers: { "x-csrf-token": me.csrfToken }, data: {} });
    if (r.ok()) { appt = a; break; }
  }
  expect(appt, "la demo debe tener alguna cita atendida reciente sin encuesta respondida").toBeTruthy();
  const day = new Date(appt.startsAt).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
  const time = new Date(appt.startsAt).toLocaleTimeString("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", hour12: false });

  await page.locator(".sidebar a[href=\"/agenda\"]").click();
  await page.getByLabel("Vista").selectOption("list");
  await page.getByLabel("Fecha", { exact: true }).fill(day);
  await page.locator("tbody tr", { hasText: appt.patientName }).filter({ hasText: time }).first().click();
  const drawer = page.getByRole("dialog").filter({ hasText: "Cita" });
  await expect(drawer.getByRole("button", { name: "Enviar encuesta" })).toBeVisible();

  await drawer.getByRole("button", { name: "Copiar enlace de encuesta" }).click();
  await expect(page.getByText(/Enlace de encuesta copiado/)).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/e\/.+/);

  await drawer.getByRole("button", { name: "Enviar encuesta" }).click();
  const dlg = page.getByRole("dialog", { name: "Encuesta de satisfacción" });
  await expect(dlg.getByLabel("Enlace de la encuesta")).toHaveValue(copied); // mismo enlace (un solo uso por cita)
  const wa = dlg.getByRole("link", { name: "Abrir WhatsApp" });
  if (await wa.count()) {
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
    await expect(dlg.getByLabel("Mensaje que se enviará")).toHaveValue(new RegExp(copied.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } else {
    await expect(dlg.getByRole("status")).toContainText(/no aceptó|teléfono/);
  }
  await dlg.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  await expect(dlg).toHaveCount(0);
});
