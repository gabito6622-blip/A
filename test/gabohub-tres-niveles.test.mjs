// Tres niveles de GaboHub (13/11/2026, decisión del dueño): Gratis / Vendedor / Negocio.
//  - Gratis: comprar, sus cuentas, códigos, fallas, recargas y su catálogo (WhatsApp y PDF). Nunca se cobra ni se pausa.
//  - Vendedor (Bs 28): + su página con QR, combos, cupones, afiches, repartir perfiles y links de cobro.
//  - Negocio (Bs 49): + Mi día, Mi control, Quién me debe, Mis ganancias, Excel y el recordatorio diario de Tito.
//  - Con el cobro apagado rige Negocio para todos (nada cambia en la tienda real mientras siga apagado).
//  - Sin pagar (después de la gracia) rige Gratis. En prueba rige Negocio. Los nombres viejos basic/full valen como Vendedor/Negocio.
//  Datos ficticios en una carpeta temporal; nada real sale de acá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";
import { DomainError } from "../dist/store/index.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const RENT = { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, sellerPrice: 2800 };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-niveles-"));
  const clock = { t: Date.UTC(2026, 10, 13, 15), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" }, system = { id: "system:prueba", role: "system" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  const mk = (name, phone, slug) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" }); s.shops.setupFor(owner, c.id, { slug, title: name, enabled: true }); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Ficticia", "+59171000001", "ana-tv"), beto = mk("Beto Ficticio", "+59171000002", "beto-tv");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = async (p, body, ck) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null), raw: r }; };
  const put = async (p, body, ck) => { const r = await fetch(base + p, { method: "PUT", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).raw.headers.get("set-cookie").split(";")[0];
  const login = async (id) => { const ok = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).raw.headers.get("set-cookie").split(";")[0]; const link = (await post(`/api/admin/customers/${id}/login-link`, {}, ok)).json; return (await post("/api/auth/customer/link", { token: link.url.split("#acceso=")[1] })).raw.headers.get("set-cookie").split(";")[0]; };
  const ckA = await login(ana.c.id), ckB = await login(beto.c.id);
  return { dir, app, s, owner, system, clock, ana, beto, base, post, put, get, ock, ckA, ckB, login, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("cobro apagado: rige Negocio para todos, nada se bloquea ni se cobra; los nombres viejos basic/full valen como Vendedor/Negocio", async () => {
  const t = await setup();
  const { s, owner, system, ana, get, ckA } = t;
  try {
    // Como en la tienda real hoy: cobro apagado, precio Básico viejo guardado como basicPrice.
    s.catalog.updateSettings(owner, { shopRent: { enabled: false, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 15, basicPrice: 2800 } });
    assert.equal(s.engine.s.settings.shopRent.sellerPrice, 2800, "el precio viejo se guarda como Vendedor");
    s.engine.tx(() => { s.engine.s.customers[ana.c.id].hubPlan = "basic"; });
    assert.equal(s.shops.mine(ana.A).rent.enabled, false, "apagado: no hay cobro que mostrar");
    for (const f of ["catalogo", "pagina", "links", "dia", "control", "excel", "tito"]) assert.equal(s.shops.planGate(ana.c.id, f), null, f);
    s.wallet.adjust(owner, ana.c.id, 1000, "saldo");
    s.shops.chargeRents(system);
    assert.equal(s.wallet.balance(ana.c.id), 1000, "apagado: no cobra");
    for (const p of ["/api/me/dia", "/api/me/control", "/api/me/fiado", "/api/me/earnings", "/api/me/descargas/catalogo", "/api/me/shop"]) assert.equal((await get(p, ckA)).status, 200, p);
    assert.equal((await get("/api/shops/ana-tv")).status, 200, "su página se ve");
    assert.equal(s.shops.resellers(owner).find((r) => r.id === ana.c.id).plan, "seller");
    s.engine.tx(() => { s.engine.s.customers[ana.c.id].hubPlan = "full"; });
    assert.equal(s.shops.resellers(owner).find((r) => r.id === ana.c.id).plan, "business");
  } finally { await t.close(); }
});

test("cobro prendido: Gratis no paga y solo tiene lo básico; Vendedor se cobra al elegirlo y abre la vidriera; Negocio abre la oficina", async () => {
  const t = await setup();
  const { s, owner, system, ana, get, put, post } = t;
  try {
    assert.throws(() => s.catalog.updateSettings(owner, { shopRent: { ...RENT, sellerPrice: 5000 } }), /inválido/, "Vendedor más caro que Negocio: no");
    s.catalog.updateSettings(owner, { shopRent: { ...RENT, sellerPrice: undefined } });
    assert.throws(() => s.shops.setPlan(ana.A, ana.c.id, "seller"), err("VALIDATION"), "sin precio Vendedor no hay plan Vendedor");
    s.catalog.updateSettings(owner, { shopRent: RENT });
    s.wallet.adjust(owner, ana.c.id, 10000, "saldo");
    // Gratis.
    let info = s.shops.setPlan(ana.A, ana.c.id, "free");
    assert.deepEqual([info.plan, info.chosen, info.price, info.plans, info.planNames], ["free", "free", 0, { free: 0, seller: 2800, business: 4900 }, { free: "Gratis", seller: "Vendedor", business: "Negocio" }]);
    s.shops.chargeRents(system); t.clock.t += 40 * DAY; s.shops.chargeRents(system);
    const ckA = await t.login(ana.c.id); // la sesión anterior venció con el salto de 40 días
    assert.equal(s.wallet.balance(ana.c.id), 10000, "Gratis: nunca se cobra");
    assert.equal(s.shops.mine(ana.A).rent.suspended, false, "Gratis: nunca se pausa");
    assert.deepEqual([s.shops.planGate(ana.c.id, "catalogo"), s.shops.planGate(ana.c.id, "pagina"), s.shops.planGate(ana.c.id, "dia")], [null, "seller", "business"]);
    for (const p of ["/api/me/services", "/api/me/orders", "/api/me/prices", "/api/me/descargas/catalogo", "/api/me/descargas/whatsapp", "/api/me/shop"]) assert.equal((await get(p, ckA)).status, 200, `${p} es de Gratis`);
    for (const [p, plan] of [["/api/me/dia", "Negocio"], ["/api/me/control", "Negocio"], ["/api/me/fiado", "Negocio"], ["/api/me/earnings", "Negocio"], ["/api/me/descargas/reporte.xlsx", "Negocio"]]) {
      const r = await get(p, ckA); assert.equal(r.status, 402, p); assert.equal(r.json.error, "HUB_PLAN"); assert.match(r.json.message, new RegExp(`plan ${plan}`));
    }
    let r = await put("/api/me/shop", { title: "Ana TV" }, ckA);
    assert.equal(r.status, 402); assert.match(r.json.message, /plan Vendedor/);
    r = await post("/api/me/shop/coupons", { code: "HOLA", pct: 10 }, ckA);
    assert.equal(r.status, 402, "cupones: Vendedor");
    assert.equal((await get("/api/shops/ana-tv")).status, 404, "en Gratis su página no se ve");
    assert.throws(() => s.shops.payRent(ana.A), err("VALIDATION"), "en Gratis no hay nada que pagar");
    // Vendedor: se cobra ya (sale de Gratis) y abre la vidriera.
    info = s.shops.setPlan(ana.A, ana.c.id, "seller");
    assert.deepEqual([info.plan, info.price, info.suspended], ["seller", 2800, false]);
    assert.equal(s.wallet.balance(ana.c.id), 10000 - 2800, "al salir de Gratis se cobra el mes ya");
    assert.equal(info.paidUntil, t.clock.t + 30 * DAY);
    assert.equal((await put("/api/me/shop", { title: "Ana TV" }, ckA)).status, 200);
    assert.equal((await get("/api/shops/ana-tv")).status, 200, "Vendedor: su página se ve");
    assert.equal((await get("/api/me/dia", ckA)).status, 402, "Mi día sigue siendo de Negocio");
    assert.equal((await get("/api/me/descargas/reporte.xlsx", ckA)).status, 402, "el Excel también");
    // Negocio: abre la oficina; el precio nuevo rige en el próximo cobro.
    s.shops.setPlan(ana.A, ana.c.id, "business");
    assert.equal(s.wallet.balance(ana.c.id), 10000 - 2800, "sin cobro extra al subir entre planes pagos");
    assert.equal((await get("/api/me/dia", ckA)).status, 200);
    t.clock.t += 31 * DAY; s.shops.chargeRents(system);
    assert.equal(s.wallet.balance(ana.c.id), 10000 - 2800 - 4900, "el mes siguiente ya es Negocio");
    const ov = s.shops.resellers(owner).find((x) => x.id === ana.c.id);
    assert.deepEqual([ov.plan, ov.planToday], ["business", "business"]);
  } finally { await t.close(); }
});

test("sin pagar: después de la gracia rige Gratis (catálogo sí, oficina y página no); si elige Gratis deja de deber; si vuelve a pagar, vuelve todo", async () => {
  const t = await setup();
  const { s, owner, system, beto, get } = t;
  try {
    s.catalog.updateSettings(owner, { shopRent: RENT });
    s.shops.chargeRents(system); t.clock.t += 4 * DAY; s.shops.chargeRents(system);
    let ckB = await t.login(beto.c.id);
    let info = s.shops.mine(beto.A).rent;
    assert.deepEqual([info.suspended, info.plan, info.chosen, info.lockReason], [true, "free", "business", "suspended"]);
    let r = await get("/api/me/control", ckB);
    assert.equal(r.status, 402); assert.equal(r.json.error, "HUB_UNPAID"); assert.match(r.json.message, /hoy estás en Gratis.*plan Negocio/);
    assert.equal((await get("/api/me/descargas/catalogo", ckB)).status, 200, "pausado: el catálogo igual sale");
    assert.equal((await get("/api/shops/beto-tv")).status, 404, "pausado: su página no se ve");
    const ov = s.shops.resellers(owner).find((x) => x.id === beto.c.id);
    assert.deepEqual([ov.plan, ov.planToday], ["business", "free"]);
    // Elige Gratis: ya no debe nada y no se lo vuelve a pausar ni cobrar.
    info = s.shops.setPlan(beto.A, beto.c.id, "free");
    assert.deepEqual([info.suspended, info.plan, info.lockReason], [false, "free", "plan"]);
    t.clock.t += 60 * DAY; s.shops.chargeRents(system);
    assert.deepEqual([s.shops.mine(beto.A).rent.suspended, s.wallet.balance(beto.c.id)], [false, 0]);
    ckB = await t.login(beto.c.id);
    // Quiere Negocio pero sin saldo: vence hoy, corre la gracia y después vuelve a Gratis.
    s.shops.setPlan(beto.A, beto.c.id, "business");
    assert.equal(s.shops.mine(beto.A).rent.paidUntil, t.clock.t, "sin saldo: vence hoy");
    assert.equal((await get("/api/me/control", ckB)).status, 200, "en la gracia tiene Negocio");
    t.clock.t += 4 * DAY; s.shops.chargeRents(system);
    assert.equal(s.shops.mine(beto.A).rent.plan, "free");
    ckB = await t.login(beto.c.id);
    // Recarga y paga: vuelve Negocio al instante.
    s.wallet.adjust(owner, beto.c.id, 5000, "recarga");
    info = s.shops.payRent(beto.A);
    assert.deepEqual([info.plan, info.suspended, s.wallet.balance(beto.c.id)], ["business", false, 100]);
    assert.equal((await get("/api/me/control", ckB)).status, 200);
  } finally { await t.close(); }
});

test("en el celular (360 px): en Gratis, Mi día muestra el candado del plan Negocio con botones de 44 px; el Inicio dice Gratis", { skip: !chromium && "Playwright no instalado" }, async () => {
  const t = await setup();
  const { s, owner, ana, base, ckA } = t;
  try {
    s.catalog.updateSettings(owner, { shopRent: RENT });
    s.shops.setPlan(ana.A, ana.c.id, "free");
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, ana.c.id);
      const [n, v] = ckA.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(base + "/hub#dia");
      await page.locator(".hublock").waitFor();
      const txt = await page.locator(".hublock").innerText();
      assert.match(txt, /plan Negocio/); assert.match(txt, /Bs 49/); assert.match(txt, /Gratis/);
      const small = await page.evaluate(() => [...document.querySelectorAll(".hublock button")].filter((x) => x.getBoundingClientRect().height < 44).length);
      assert.equal(small, 0, "botones de 44 px");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 360), true, "sin desborde horizontal");
      await page.screenshot({ path: join(process.env.GS_SHOTS ?? t.dir, "niveles-candado-360.png"), fullPage: true });
      // Inicio: dice que está en Gratis y ofrece los otros dos planes (el cambio de # no recarga: se vuelve a cargar la página).
      await page.goto(base + "/hub#inicio"); await page.reload();
      await page.locator("text=plan Gratis").first().waitFor();
      assert.equal(await page.locator('[data-hubplan="seller"]').count() + await page.locator('[data-hubplan="business"]').count(), 2, "botones Vendedor y Negocio");
      await page.screenshot({ path: join(process.env.GS_SHOTS ?? t.dir, "niveles-inicio-360.png"), fullPage: true });
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  } finally { await t.close(); }
});
