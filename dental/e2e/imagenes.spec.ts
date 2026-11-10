import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

// Imágenes y archivos (B-012): el odontólogo sube una foto desde la ficha (con barra de progreso),
// la abre en el visor con zoom, compara dos radiografías (antes/después) y llega a las imágenes de
// una pieza desde el odontograma. Recepción solo ve documentos escaneados. Todas las imágenes son
// sintéticas (generadas en código).

/** PNG sintético mínimo (RGB) generado en la prueba. */
function syntheticPng(w: number, h: number, seed: number): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { raw[o++] = (x * 3 + seed) % 256; raw[o++] = (y * 2 + seed) % 256; raw[o++] = 180; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function loginAs(page: Page, email: string) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  await expect(page.locator(".sidebar")).toBeVisible();
}
async function openPatient(page: Page) {
  await page.click('a:has-text("Pacientes")');
  await page.getByLabel("Buscar pacientes").fill("Demo Imágenes");
  await page.locator("tbody tr", { hasText: "Valeria Demo Imágenes" }).click();
  await page.getByRole("tab", { name: "Imágenes y archivos" }).click();
}
const imageLoaded = (page: Page, sel: string) => page.locator(sel).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test("subir desde la ficha, ver en el visor con zoom, comparar dos y llegar desde el odontograma", async ({ page }) => {
  await loginAs(page, "dr.mendoza@demo.local");
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openPatient(page);
  const gallery = page.locator(".cf-grid");
  await expect(page.getByRole("button", { name: /Radiografía panorámica/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Radiografía periapical, pieza 36/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Documento escaneado/ })).toBeVisible();
  await expect.poll(() => imageLoaded(page, ".cf-thumb img")).toBe(true);

  // Subir una foto (el navegador manda el archivo; el tipo lo verifica el servidor por la firma)
  await page.getByLabel("Elegir archivos para subir").setInputFiles({ name: "control.jpg", mimeType: "image/jpeg", buffer: syntheticPng(320, 240, 7) });
  const dlg = page.getByRole("dialog", { name: "Subir a la ficha" });
  await expect(dlg.getByText("control.jpg")).toBeVisible();
  await expect(dlg.getByText(/· PNG$/)).toBeVisible(); // el tipo real, no la extensión
  await dlg.getByLabel("Tipo de archivo").selectOption({ label: "Foto intraoral" });
  await dlg.getByLabel("Piezas (opcional)").fill("46, 99");
  await expect(dlg.getByText("Pieza inválida (notación FDI): 99")).toBeVisible();
  await dlg.getByLabel("Piezas (opcional)").fill("46");
  await dlg.getByLabel("Descripción (opcional)").fill("Control de la pieza 46 (prueba)");
  await dlg.getByRole("button", { name: "Subir", exact: true }).click();
  await expect(page.getByText("1 archivo subido")).toBeVisible();
  await expect(dlg).toHaveCount(0);
  const newCard = page.getByRole("button", { name: /Foto intraoral, pieza 46/ });
  await expect(newCard).toBeVisible();

  // Visor con zoom
  await newCard.click();
  const viewer = page.getByRole("dialog", { name: /Visor: Foto intraoral · pieza 46/ });
  await expect(viewer).toBeVisible();
  await expect.poll(() => imageLoaded(page, ".cf-full .cf-zoom img")).toBe(true);
  await expect(viewer.getByText("Control de la pieza 46 (prueba)")).toBeVisible();
  await viewer.getByRole("button", { name: "Acercar" }).click();
  await expect(viewer.getByText("150 %")).toBeVisible();
  expect(await viewer.locator(".cf-zoom img").getAttribute("style")).toContain("scale(1.5)");
  await viewer.getByRole("button", { name: "Restablecer zoom" }).click();
  await expect(viewer.getByText("100 %")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Comparar dos radiografías de la pieza 36
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  const rx = page.getByRole("button", { name: /Radiografía periapical, pieza 36/ });
  await rx.nth(0).click();
  await rx.nth(1).click();
  await page.getByRole("button", { name: "Comparar lado a lado" }).click();
  const cmp = page.getByRole("dialog", { name: "Comparar imágenes" });
  await expect(cmp.locator("figure")).toHaveCount(2);
  await expect(cmp.locator("figcaption").first()).toContainText("Antes");
  await expect.poll(async () => (await cmp.locator(".cf-zoom img").evaluateAll((imgs: HTMLImageElement[]) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length))).toBe(2);
  await cmp.getByRole("button", { name: "Acercar" }).first().click();
  // «Mover juntas»: el zoom se aplica a las dos
  await expect(cmp.getByText("150 %")).toHaveCount(2);
  await cmp.getByRole("button", { name: "Cerrar comparación" }).click();

  // Desde el odontograma: tocar la pieza 36 → sus imágenes
  await page.getByRole("tab", { name: "Odontograma", exact: true }).click();
  await page.getByRole("button", { name: "Pieza 36", exact: true }).click();
  await page.getByRole("button", { name: "Ver imágenes de la pieza 36" }).click();
  await expect(page.getByRole("combobox", { name: "Pieza", exact: true })).toHaveValue("36");
  await expect(gallery.getByRole("button")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("recepción solo ve documentos escaneados y en el celular no hay desborde", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, locale: "es-BO", timezoneId: "America/La_Paz", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.fill("#email", "recepcion.lpz@demo.local");
  await page.fill("#pw", "Demo2026dental");
  await page.click('button:has-text("Ingresar")');
  const nav = page.getByRole("navigation", { name: "Navegación móvil" });
  await nav.getByText("Pacientes").click();
  await page.getByLabel("Buscar pacientes").fill("Demo Imágenes");
  await page.locator("tbody tr", { hasText: "Valeria Demo Imágenes" }).first().click();
  await page.getByRole("tab", { name: "Imágenes y archivos" }).click();
  await expect(page.getByRole("button", { name: /Documento escaneado/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Radiografía/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tomar foto" })).toBeVisible();
  await expect(page.getByLabel("Tomar una foto con la cámara")).toHaveAttribute("capture", "environment");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await ctx.close();
});
