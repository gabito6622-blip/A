import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const PW = "Demo2026dental";

function totp(secretB32: string, at = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** Ingresa y espera a que la sesión quede establecida (respuesta de /api/auth/me tras el login). */
async function login(page: Page, email: string, password = PW) {
  await page.goto("/");
  await page.fill("#email", email);
  await page.fill("#pw", password);
  const me = page.waitForResponse((r) => r.url().endsWith("/api/auth/me") && r.request().method() === "GET");
  await page.click('button:has-text("Ingresar")');
  await me;
}

test.describe.configure({ mode: "serial" });

test("gerente activa la verificación en dos pasos y luego ingresa con el código de su app", async ({ page }) => {
  await login(page, "gerente@demo.local");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/cuenta");
  await page.getByRole("button", { name: "Activar" }).click();
  await page.getByLabel("Confirma tu contraseña").fill(PW);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByAltText("Código QR para la app autenticadora")).toBeVisible();
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmar y activar" }).click();
  await expect(page.getByTestId("recovery-codes").locator("span")).toHaveCount(10);
  await page.getByRole("button", { name: "Ya los guardé" }).click();
  await expect(page.locator(".badge", { hasText: /^Activa$/ })).toBeVisible();

  await page.getByRole("button", { name: "Salir" }).click();
  await login(page, "gerente@demo.local");
  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  await page.getByLabel("Código").fill("000000");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Código incorrecto");
  await page.getByLabel("Código").fill(totp(secret));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("la propietaria restablece la contraseña de una recepcionista y esta debe cambiarla al ingresar", async ({ page, browser }) => {
  await login(page, "propietaria@demo.local");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/configuracion");
  await page.getByRole("tab", { name: "Personal" }).click();
  const row = page.locator("tr", { hasText: "recepcion.sur@demo.local" });
  await row.getByRole("button", { name: /Restablecer contraseña/ }).click();
  await page.getByRole("dialog", { name: "Restablecer contraseña" }).getByRole("button", { name: "Generar contraseña temporal" }).click();
  const temp = (await page.getByText(/^Tmp-/).first().innerText()).trim();
  expect(temp).toMatch(/^Tmp-/);

  const ctx = await browser.newContext();
  const rec = await ctx.newPage();
  await login(rec, "recepcion.sur@demo.local", temp);
  await expect(rec.getByRole("heading", { name: "Cambia tu contraseña temporal" })).toBeVisible();
  await rec.getByLabel("Contraseña temporal").fill(temp);
  await rec.getByLabel("Nueva contraseña", { exact: true }).fill("RecepcionSur2026");
  await rec.getByLabel("Repetir nueva contraseña").fill("RecepcionSur2026");
  await rec.getByRole("button", { name: "Guardar" }).click();
  await expect(rec.locator(".sidebar")).toBeVisible();
  await ctx.close();
});

test("recepción registra el consentimiento de datos con firma en pantalla y queda verificado", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/pacientes");
  await page.locator("tbody tr").first().click();
  await page.getByRole("tab", { name: "Consentimientos" }).click();
  await page.getByRole("button", { name: "Registrar consentimiento" }).click();
  const dlg = page.getByRole("dialog", { name: "Registrar consentimiento" });
  await dlg.getByLabel("Documento").selectOption({ label: "Tratamiento de datos personales y de salud — Aviso de privacidad y tratamiento de datos (v1)" });
  await dlg.getByRole("button", { name: "Guardar documento" }).click();
  await expect(dlg.getByRole("alert")).toHaveText("Falta la firma");
  const box = (await dlg.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 90);
  await page.mouse.down();
  for (let i = 0; i < 15; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + 90 + (i % 2 ? 30 : -30));
  await page.mouse.up();
  await dlg.getByRole("button", { name: "Guardar documento" }).click();
  await expect(page.getByText("Integridad verificada")).toBeVisible();
  await page.locator(".dialog-foot").getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByText("Tratamiento de datos: Acepta")).toBeVisible();
});

test("en la sala de espera, marcar 'Llegó' pasa al paciente a la columna de espera", async ({ page }) => {
  await login(page, "recepcion.lpz@demo.local");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/sala-espera");
  const column = (title: string) => page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(column("Por llegar")).toBeVisible();
  const card = column("Por llegar").locator("article").first();
  test.skip(!(await card.count()), "No hay citas por llegar hoy en esta sucursal");
  const name = (await card.getByRole("link").innerText()).trim();
  await card.getByRole("button", { name: "Llegó" }).click();
  await expect(column("En sala de espera").locator("article", { hasText: name })).toBeVisible();
});
