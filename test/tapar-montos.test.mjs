// 🙈 Tapar montos (14/11/2026). El dueño: «a veces usamos el panel en lugares públicos y no queremos que la demás gente
// sepa cuánto ganamos». Un botón en el panel del dueño y en GaboHub difumina todos los montos; queda guardado en el
// celular y se puede volver a mostrar. Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Tapar montos: panel del dueño y GaboHub, guardado en el celular", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-mny-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }, { label: "P2" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Quispe", phone: "+59170011223" });
  s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  const rev = s.catalog.createCustomer(owner, { name: "Rita Prueba", phone: "+59171000055", kind: "reseller", priceGroupId: "revendedor" });
  s.wallet.adjust(owner, rev.id, 43000, "carga de prueba");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  const blurred = (p) => p.evaluate(() => [...document.querySelectorAll(".mny")].filter((e) => e.offsetParent && getComputedStyle(e).filter.includes("blur")).length);
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];

    // Panel del dueño: «Tu mes» y los montos se tapan con un toque y siguen tapados al recargar.
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [on, ov] = ock.split("="); await ctx.addCookies([{ name: on, value: ov, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel#inicio");
    await p.locator(".hm-hero").waitFor();
    await p.waitForFunction(() => /Bs\s?\d/.test(document.querySelector("#pout").innerText));
    assert.equal(await blurred(p), 0, "al principio se ven");
    const btn = p.locator("[data-hidemoney]").first();
    assert.ok((await btn.boundingBox()).height >= 44);
    await btn.click();
    assert.ok(await blurred(p) > 0, "tapados al tocar");
    assert.equal(await btn.getAttribute("aria-pressed"), "true");
    assert.match(await p.locator("#pout").innerText(), /Bs\s?\d/, "el texto sigue ahí (solo se difumina)");
    await p.reload(); await p.locator(".hm-hero").waitFor();
    await p.waitForFunction(() => document.querySelectorAll(".mny").length > 0);
    assert.ok(await blurred(p) > 0, "siguen tapados al recargar");
    await p.evaluate(() => { location.hash = "finanzas"; });
    await p.waitForFunction(() => location.hash === "#finanzas" && document.querySelectorAll("#pout .mny").length > 0);
    await p.locator("[data-hidemoney]").first().click();
    assert.equal(await blurred(p), 0, "otro toque los muestra");
    assert.deepEqual(errs, []);
    await ctx.close();

    // GaboHub: el revendedor tapa su saldo.
    const { pin } = await (await post(`/api/admin/customers/${rev.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: rev.phone, pin })).headers.get("set-cookie").split(";")[0];
    const rctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await rctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await rctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, rev.id);
    const [n, v] = rck.split("="); await rctx.addCookies([{ name: n, value: v, url: base }]);
    const rp = await rctx.newPage(); const rerrs = []; rp.on("pageerror", (e) => rerrs.push(e.message));
    await rp.goto(base + "/hub#inicio");
    await rp.locator(".htiles").waitFor();
    const rb = rp.locator(".mnybtn");
    assert.equal(await rb.isVisible(), true, "en GaboHub está el botón");
    await rb.click();
    assert.ok(await rp.evaluate(() => [...document.querySelectorAll(".hbal .mny")].some((e) => getComputedStyle(e).filter.includes("blur"))), "el saldo quedó tapado");
    assert.deepEqual(rerrs, []);
    await rctx.close();

    // En la tienda de los clientes no aparece el botón.
    const sctx = await b.newContext(); const sp = await sctx.newPage();
    await sp.goto(base + "/tienda/"); await sp.locator("#sout").waitFor();
    assert.equal(await sp.locator(".mnybtn").isVisible(), false);
    await sctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
