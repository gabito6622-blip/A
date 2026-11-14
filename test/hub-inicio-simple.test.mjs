// Inicio simple de GaboHub (14/11/2026). El dueño: «ven demasiadas cosas a la vez» y casi ningún revendedor entraba
// (2 de 25). Ahora el inicio tiene 4 botones grandes (Mis cuentas, Sacar código, Renovar, Comprar), una fila
// chica (Saldo, Mis clientes, Ayuda…) y todo lo demás plegado en «Todas mis herramientas» (nada se quitó).
// Y el dueño tiene «🔗 Link para entrar»: un link de un toque que no cambia el PIN. Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;

test("GaboHub: inicio con 4 botones, Renovar filtra, herramientas plegadas y link de un toque sin cambiar el PIN", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-simple-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.engine.s.settings.whatsapp = "59170000001";
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  for (const i of [1, 2, 3]) s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: `alq${i}@x.lat`, password: "Clave-Larga#" + i, supplierExpiresAt: Date.now() + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
  const ari = s.catalog.createCustomer(owner, { name: "ARIt · Aracely Prueba", phone: "+59171000044", kind: "reseller", priceGroupId: "rev" });
  s.wallet.adjust(owner, ari.id, 50000, "carga de prueba");
  const A = { id: "u_" + ari.id, role: "reseller", customerId: ari.id };
  // Tres cuentas: una vencida hace 2 días, una vence en 3 días y una al día (20 días).
  for (const [i, days] of [[0, -2], [1, 3], [2, 20]]) {
    const o = s.orders.create(A, { customerId: ari.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" + i });
    s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + days * DAY);
  }
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ari.phone, pin })).headers.get("set-cookie").split(";")[0];
    const newCtx = async (cookie) => {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, ari.id);
      if (cookie) { const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]); }
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      return { ctx, page, errs };
    };

    // ---- El revendedor ----
    const { ctx, page, errs } = await newCtx(rck);
    await page.goto(base + "/hub#inicio");
    await page.locator(".htiles.hsimple").waitFor();
    const big = (await page.locator(".hsimple .htile b").allInnerTexts()).map((x) => x.trim());
    assert.deepEqual(big, ["Mis cuentas", "Sacar código", "Renovar", "Comprar"]);
    assert.doesNotMatch(await page.locator(".hsimple").innerText(), /Gabriel/, "sin el nombre del dueño: muchos revendedores no lo conocen");
    assert.match(await page.locator(".hsimple [data-renewgo]").innerText(), /2 cuentas/, "1 vencida + 1 esta semana");
    assert.match(await page.locator(".hsimple .htile").first().innerText(), /3 · 2 por renovar/);
    for (const h of await page.locator(".hsimple .htile, .hsmall .sbtn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `botón de ${h}px`);
    // Lo demás está, pero plegado: no se ve hasta que lo abre.
    assert.equal(await page.locator(".hmore").evaluate((d) => d.open), false);
    assert.equal(await page.locator("#myPin").isVisible(), false);
    assert.equal(await page.locator('.hqrow [data-rtool="control"]').isVisible(), false);
    assert.deepEqual((await page.locator(".hsmall .sbtn").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim().split(" · ")[0]), ["💰 Saldo", "👥 Mis clientes", "🆘 Ayuda"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    // «Renovar» abre Mis cuentas filtrada en las vencidas.
    await page.locator(".hsimple [data-renewgo]").click();
    await page.locator('[data-mf="bad"][aria-pressed="true"]').waitFor();
    // Volver: las herramientas se abren y todo sigue ahí (Mi control, PIN…).
    await page.goto(base + "/hub#inicio");
    await page.locator(".hmore > summary").click();
    await page.locator("#myPin").waitFor();
    assert.equal(await page.locator('.hqrow [data-rtool="control"]').isVisible(), true);
    assert.deepEqual(errs, []);
    await ctx.close();

    // ---- El dueño manda «🔗 Link para entrar» (sin cambiar el PIN) ----
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await pctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [on, ov] = ock.split("="); await pctx.addCookies([{ name: on, value: ov, url: base }]);
    const pp = await pctx.newPage(); const perrs = []; pp.on("pageerror", (e) => perrs.push(e.message));
    await pp.goto(base + "/panel#revendedores");
    await pp.locator(`[data-rone="${ari.id}"]`).click();
    await pp.locator("#ronecard").waitFor();
    const url = (await pp.locator("#ronecard .linkbar b").innerText()).trim();
    assert.match(url, /\/hub#acceso=[\w-]+$/);
    const wa = decodeURIComponent(await pp.locator("#ronecard a.pbtn").getAttribute("href"));
    assert.match(wa, /Tocá acá y entrás directo/);
    assert.match(wa, /¡Hola Aracely!/);
    assert.deepEqual(perrs, []);
    await pctx.close();

    // El link deja adentro sin escribir nada…
    const fresh = await newCtx(null);
    await fresh.page.goto(url.replace(/^https?:\/\/[^/]+/, base));
    await fresh.page.locator(".htiles.hsimple").waitFor();
    assert.match(await fresh.page.locator(".hhead").innerText(), /Hola, ARIt/);
    await fresh.ctx.close();
    // …y su PIN de siempre sigue sirviendo.
    assert.equal((await post("/api/auth/customer/pin", { phone: ari.phone, pin })).status, 200);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
