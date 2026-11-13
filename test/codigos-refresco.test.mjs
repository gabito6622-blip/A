// La bandeja de «Códigos» del revendedor y «📩 Ver códigos» de cada cuenta se refrescan solos cada 10 s mientras
// están a la vista (13/11/2026, pedido del dueño): el revendedor pide el código en la app y lo ve llegar sin tocar
// Actualizar. Al salir de la pestaña dejan de consultar. Datos ficticios en carpeta temporal; nada real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5, MIN = 60_000;

test("códigos: la bandeja y «Ver códigos» muestran solos el código nuevo a los 10 s y dejan de consultar al salir", { skip: !chromium && "Playwright no instalado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-codref-"));
  const clock = { t: Date.now(), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, clock, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  let b;
  try {
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 2500, published: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "dis-rosa@x.lat", password: "Clave-Dis#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 900, profiles: [{ label: "P1", pin: "1111" }] });
    const mbx = s.codes.configureMailbox(owner, { address: "codigos.tienda@gmail.com", host: "imap.gmail.com" }).id;
    const rosa = s.catalog.createCustomer(owner, { name: "Rosa Ficticia", phone: "+59171111111", kind: "reseller" });
    s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
    const mail = (code, subject = "Tu código de acceso único para Disney+") => s.codes.ingest(owner, mbx, { to: "dis-rosa@x.lat", from: "Disney+ <disneyplus@mail.disneyplus.com>", subject, body: `Hola,\nTu código es:\n${code}\nVence en 15 minutos.`, receivedAt: clock.t });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${rosa.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: rosa.phone, pin })).headers.get("set-cookie").split(";")[0];
    clock.t += MIN; // la cuenta ya estaba asignada antes de que lleguen los códigos

    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, rosa.id);
    const [n, v] = rck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    let polls = 0; page.on("request", (r) => { if (r.url().endsWith("/api/me/codes")) polls++; });
    await page.clock.install({ time: clock.t });

    // 1) Bandeja vacía → llega un código → aparece solo a los 10 s, sin tocar nada.
    await page.goto(base + "/hub#codigos");
    await page.locator("text=No hay códigos nuevos").waitFor();
    const before = polls;
    mail("847 213");
    await page.clock.runFor(10_100);
    await page.locator(".code b", { hasText: "847 213" }).waitFor({ timeout: 8000 });
    assert.equal(polls, before + 1, "una consulta a los 10 s");
    // Sin novedades no se redibuja: lo escrito en el PIN del link se conserva.
    await page.clock.runFor(10_100);
    await page.waitForFunction((p) => performance.getEntriesByType("resource").filter((e) => e.name.endsWith("/api/me/codes")).length >= p, before + 2, { timeout: 8000 }).catch(() => {});
    assert.equal(await page.locator(".code b").count(), 1);

    // 2) Mis cuentas → «Ver códigos» abierto: el segundo código aparece solo.
    await page.goto(base + "/hub#cuentas"); await page.reload();
    const ver = page.getByRole("button", { name: "📩 Ver códigos" });
    await ver.waitFor(); await ver.click();
    await page.locator(".cs-code b", { hasText: "847 213" }).waitFor();
    mail("5521", "Tu código de inicio de sesión");
    await page.clock.runFor(10_100);
    await page.locator(".cs-code b", { hasText: "5521" }).waitFor({ timeout: 8000 });
    assert.equal(await page.locator(".cs-code b").count(), 2);

    // 3) Al irse al Inicio, deja de consultar.
    await page.goto(base + "/hub#inicio"); await page.reload();
    await page.locator(".htiles").waitFor();
    const idle = polls;
    await page.clock.runFor(30_500);
    await page.waitForTimeout(300);
    assert.equal(polls, idle, "en el Inicio no se consultan códigos");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally {
    await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});
