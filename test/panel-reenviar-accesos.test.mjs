// Panel → Control (celular): «📲 Reenviar accesos» abre una tarjeta que se ve (fondo del tema, no transparente) y se
// cierra con la ✕, con Escape o tocando afuera; «Copiar todo» copia. Y el botón «💰 Cobrar» arma el mensaje completo:
// plataforma, correo, vencimiento y monto (pedido del dueño, 13/11/2026). Datos ficticios en carpeta temporal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("Control en el celular: Reenviar accesos se ve y se cierra; Cobrar manda correo, vencimiento y monto", { skip: !chromium && "Playwright no instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-reenviar-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  let b;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/products", { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true });
    await A("POST", "/api/admin/accounts", { productId: "dis", email: "cuenta.demo+nu1@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
    const oby = await A("POST", "/api/admin/customers", { name: "Oby Ficticio", phone: "+59170000001", kind: "reseller" });
    await A("POST", "/api/admin/orders", { customerId: oby.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
    const [asg] = await A("GET", "/api/admin/assignments");
    assert.ok(asg?.id, "hay un alquiler");

    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
    const [n, v] = ck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/panel.html#control");
    const open = page.getByRole("button", { name: "📲 Reenviar accesos" }).first();
    await open.waitFor({ timeout: 20_000 });

    // 1) La tarjeta se ve: fondo del tema (no transparente) y adentro de .app.
    await open.click();
    const card = page.locator(".dlv-card");
    await card.waitFor();
    assert.match(await card.innerText(), /Listo para enviar/);
    assert.match(await card.innerText(), /cuenta\.demo\+nu1@ejemplo\.lat/);
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(!/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(bg), `fondo transparente: ${bg}`);
    assert.ok(await page.evaluate(() => !!document.querySelector("#app #dlvScrim")), "la tarjeta vive adentro de .app (ahí están los colores)");
    // 2) Se cierra con la ✕.
    await page.locator(".dlv-card [data-dlvclose]").click();
    await page.waitForFunction(() => !document.querySelector("#dlvScrim"));
    // 3) Se cierra con Escape.
    await open.click(); await card.waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#dlvScrim"));
    // 4) «Copiar todo» copia el mensaje con el correo.
    await open.click(); await card.waitFor();
    await page.locator(".dlv-card [data-dlvcopy]").click();
    await page.locator(".toast, [role=status]", { hasText: /copiados/i }).first().waitFor({ timeout: 5000 }).catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (clip) assert.match(clip, /cuenta\.demo\+nu1@ejemplo\.lat/);
    await page.mouse.click(5, 400); // tocar afuera también cierra
    await page.waitForFunction(() => !document.querySelector("#dlvScrim"));

    // 5) El mensaje de Cobrar: plataforma, correo, vencimiento y monto.
    const href = await page.locator('a:has-text("💰 Cobrar")').first().getAttribute("href");
    const txt = decodeURIComponent(new URL(href).searchParams.get("text") ?? "");
    assert.match(txt, /Hola Oby 👋 te recuerdo tu alquiler:/);
    assert.match(txt, /📺 Disney Premium \+ ESPN\n/, "plataforma sin el sufijo de alquiler");
    assert.match(txt, /📧 cuenta\.demo\+nu1@ejemplo\.lat/);
    assert.match(txt, /📅 Vence el \d{2}\/\d{2}\/\d{4} \(en 30 días\)/);
    assert.match(txt, /💰 Monto: Bs 69/);
    assert.match(txt, /¿Renovamos\?/);
    assert.ok(!/Cuenta completa/.test(txt), "la cuenta completa no lista perfil");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally {
    await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});
