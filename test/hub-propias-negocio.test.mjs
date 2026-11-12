// GaboHub etapa 3 (12/11/2026): Mi control, Quién me debe y Mis ganancias también muestran las cuentas propias del
// revendedor (las que consigue por su lado), con los mismos botones de "Mis cuentas propias": Renovó y Me pagó.
// Datos ficticios, 360 px; nunca sale un WhatsApp real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("cuentas propias en Mi control, Quién me debe y Mis ganancias, con Renovó y Me pagó", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubneg-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller" }); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Propias", "+59171234567"), otro = mk("Otro Revendedor", "+59172345678");
  const id = (x) => x.id ?? x.product?.id ?? x.account?.id;
  const pFl = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const acc = s.own.saveAccount(ana.A, { productId: id(pFl), user: "flujo.uno", password: "Clave-1234", slots: 3 });
  const carla = s.own.assign(ana.A, { accountId: id(acc), name: "Carla Rojas", phone: "70011111", price: 3000, pay: "pendiente" });
  const mario = s.own.assign(ana.A, { accountId: id(acc), name: "Mario Soto", phone: "70022222", price: 2500, pay: "pagado" });
  s.own.updateSale(ana.A, carla.id, { expiresAt: Date.now() + 2 * DAY }); // vence en 2 días
  s.own.updateSale(ana.A, mario.id, { expiresAt: Date.now() + 20 * DAY }); // al día
  // El otro revendedor tiene una venta propia pendiente que Ana nunca debe ver.
  const pX = s.own.saveProduct(otro.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line", slots: 1 });
  const aX = s.own.saveAccount(otro.A, { productId: id(pX), user: "secreto", password: "Clave-1234", slots: 1 });
  s.own.assign(otro.A, { accountId: id(aX), name: "Cliente Ajeno", phone: "70099999", price: 1000, pay: "pendiente" });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, ana.c.id);
    const [n, v] = rck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const tab = async (t) => { await page.goto(base + "/hub#mas"); await page.locator(`.hubarea-i[data-rtool="${t}"]`).click(); await page.waitForFunction((k) => document.querySelector(`[data-rtab="${k}"]`)?.getAttribute("aria-selected") === "true", t); };
    const check = () => page.evaluate(() => ({ over: document.documentElement.scrollWidth > document.documentElement.clientWidth, small: [...document.querySelectorAll(".ownbox button, .ownbox a.sbtn")].filter((x) => x.getBoundingClientRect().height < 44).length }));

    // Mi control: solo Carla (vence en 2 días); 🔄 Renovó le suma 30 días y sale de la lista.
    await tab("control");
    await page.locator(".ownbox").waitFor();
    let box = await page.locator(".ownbox").innerText();
    assert.match(box, /Tus cuentas propias que vencen\s*1/);
    assert.match(box, /Carla Rojas/); assert.doesNotMatch(box, /Mario Soto|Cliente Ajeno/);
    assert.match(await page.locator('.ownbox a[href*="wa.me"]').first().getAttribute("href"), /Carla.*Flujo%20TV.*vence/);
    assert.deepEqual(await check(), { over: false, small: 0 });
    await page.locator('.ownbox [data-os="renew"]').click();
    await page.waitForFunction(() => !document.querySelector(".ownbox"));
    const after = (await (await fetch(base + "/api/me/own", { headers: { cookie: rck } })).json()).sales.find((x) => x.id === carla.id);
    assert.ok(after.expiresAt > Date.now() + 30 * DAY, "renovó +30 días");

    // Quién me debe: Carla quedó pagada al renovar ("Renovó" = pagado); se marca Mario pendiente y aparece.
    s.own.updateSale(ana.A, mario.id, { pay: "pendiente" });
    await tab("debe");
    await page.locator(".ownbox").waitFor();
    box = await page.locator(".ownbox").innerText();
    assert.match(box, /Ventas propias sin pagar · Bs 25/);
    assert.match(box, /Mario Soto/); assert.doesNotMatch(box, /Carla Rojas|Cliente Ajeno/);
    assert.deepEqual(await check(), { over: false, small: 0 });
    // Le deben por una cuenta propia: la libreta vacía no dice "Nadie te debe nada".
    assert.doesNotMatch(await page.locator("#sout").innerText(), /Nadie te debe nada/);
    assert.match(await page.locator("#sout").innerText(), /No tenés fiados anotados/);
    await page.locator('.ownbox [data-os="pay"]').click();
    await page.waitForFunction(() => !document.querySelector(".ownbox"));
    assert.equal((await (await fetch(base + "/api/me/own", { headers: { cookie: rck } })).json()).sales.find((x) => x.id === mario.id).pay, "pagado");
    assert.match(await page.locator("#sout").innerText(), /Nadie te debe nada/, "ya nadie le debe");

    // Mis ganancias: 2 clientes, Bs 55 por mes, no le deben nada.
    await tab("ganancias");
    await page.locator(".ownbox").waitFor();
    box = (await page.locator(".ownbox").innerText()).replace(/\s+/g, " ");
    assert.match(box, /Clientes 2 Cobrás por mes Bs 55,00 Te deben Bs 0,00|Clientes 2 Cobrás por mes Bs 55 Te deben Bs 0/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
