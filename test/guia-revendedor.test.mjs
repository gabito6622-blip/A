// Revendedores más fácil (17/11/2026). El dueño: «todavía no entienden cómo entrar, ver sus cuentas, pagar y ver sus
// códigos». 1) Bienvenida de 4 pasos (antes 13); la guía completa sigue en «📖 Guía». 2) Guía con fotos en
// /guia-revendedor. 3) El mensaje de invitación dice cómo se paga y cómo se saca un código, con el link de la guía.
// Datos ficticios; nada se manda.
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

test("revendedor: bienvenida de 4 pasos, guía con fotos e invitación clara", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-guiarev-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.updateSettings(owner, { storeName: "Tienda Ficticia", whatsapp: "59170000000", platformName: "Hub Ficticio" });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", category: "Streaming", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { dis: 6900 } });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: "c1@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const rev = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  const nuevo = s.catalog.createCustomer(owner, { name: "Beto Ficticio", phone: "+59170000002", kind: "reseller", priceGroupId: "revendedor" });
  const o = s.orders.create(owner, { customerId: rev.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r1" });
  s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + 2 * DAY);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b ?? {}) });
  const b = await chromium.launch();
  try {
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post(`/api/admin/customers/${rev.id}/login-pin`, {}, ock);
    const link = (await (await post(`/api/admin/customers/${rev.id}/login-link`, {}, ock)).json()).url.replace(/^https?:\/\/[^/]+/, base);

    // 1) Bienvenida corta la primera vez; la completa con «📖 Guía».
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    await p.goto(link, { waitUntil: "networkidle" });
    await p.locator("#tour .tour-dots").waitFor();
    assert.equal(await p.locator("#tour .tour-dots").innerText(), "1 / 4");
    assert.match(await p.locator("#tour .tour-ttl").innerText(), /Bienvenido a Hub Ficticio.*Mis cuentas/);
    const next = async (to) => {
      const prev = await p.locator("#tour .tour-tx").innerText();
      await p.locator("#tour .tour-next").click();
      if (to) await p.waitForFunction(([t, old]) => document.querySelector("#tour .tour-dots")?.textContent === t && document.querySelector("#tour .tour-tx")?.textContent !== old, [to, prev]);
    };
    await next("2 / 4"); await next("3 / 4");
    assert.match(await p.locator("#tour .tour-tx").innerText(), /un solo QR/);
    await next("4 / 4");
    assert.match(await p.locator("#tour .tour-tx").innerText(), /📖 Guía/);
    await next();
    await p.waitForFunction(() => !document.getElementById("tour"));
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    assert.equal(await p.locator("#tour").count(), 0, "no vuelve a salir");
    await p.locator("[data-tour]").first().click();
    await p.locator("#tour .tour-dots").waitFor();
    assert.ok(Number((await p.locator("#tour .tour-dots").innerText()).split("/ ")[1]) > 4, "la guía completa sigue");
    await p.locator("#tour .tour-x").click();

    // 2) Guía con fotos: se abre sin sesión, las 4 fotos cargan, sin desborde a 360 px, WhatsApp de la tienda.
    const g = await b.newPage({ viewport: { width: 360, height: 780 } });
    const gr = await g.goto(base + "/guia-revendedor", { waitUntil: "networkidle" });
    assert.equal(gr.status(), 200);
    assert.match(await g.locator("h1").innerText(), /Hub Ficticio/);
    assert.equal(await g.evaluate(async () => { const imgs = [...document.images]; for (const i of imgs) { i.loading = "eager"; if (!i.complete) await new Promise((r) => { i.onload = i.onerror = r; }); } return imgs.filter((i) => i.naturalWidth > 0).length; }), 4);
    assert.equal(await g.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.match(await g.locator("#wa").getAttribute("href"), /^https:\/\/wa\.me\/59170000000\?text=/);
    for (const a of await g.locator("a.btn").all()) assert.ok((await a.boundingBox()).height >= 44);

    // 3) Invitación desde el panel: link directo, cómo pagar, cómo sacar un código y la guía con fotos.
    const oc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const [n, v] = ock.split("="); await oc.addCookies([{ name: n, value: v, url: base }]);
    await oc.route(/wa\.me|whatsapp\.com/, (r) => r.abort());
    const op = await oc.newPage(); op.on("pageerror", (x) => errs.push(x.message));
    await op.goto(base + "/panel.html#inicio");
    await op.locator(".hm-invite").getByRole("button", { name: /Invitarlos ahora/ }).click();
    const step = op.locator(".invstep"); await step.waitFor();
    assert.match(await step.innerText(), /Beto/);
    await step.getByRole("button", { name: /Generar PIN/ }).click();
    const wa = step.locator("a[data-invsent]"); await wa.waitFor();
    const msg = decodeURIComponent((await wa.getAttribute("href")).split("text=")[1]);
    assert.match(msg, /Tocá acá y entrás directo/);
    assert.match(msg, /tocás \*Renovar\*, pagás todo junto con un solo QR y subís la foto del comprobante/);
    assert.match(msg, /tocás \*Sacar código\* y aparece solo/);
    assert.match(msg, new RegExp(`Guía con fotos \\(2 minutos\\): ${base.replace(/[.:/]/g, "\\$&")}/guia-revendedor`));
    void nuevo;
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
