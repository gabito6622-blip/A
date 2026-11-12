// GaboHub etapa 5 (12/11/2026): suscripción mensual para TODOS los revendedores (decisión del dueño: Bs 49 o US$ 5
// fijos, sin "gratis si compra", cobro apagado hasta que él lo prenda). Se cobra sola del saldo; sin saldo, después de
// los días de gracia se pausan Mi control, Quién me debe y Mis ganancias (el servidor no las entrega). Comprar, cuentas,
// códigos, recargar, vender y anotar fiados NUNCA se bloquean. Datos ficticios; nada real.
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

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-suscr-"));
  const clock = { t: Date.now(), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" }, system = { id: "system:prueba", role: "system" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  s.catalog.upsertPriceGroup(owner, { id: "rev-usd", name: "Afuera (US$)", currency: "USD", prices: { nf: 400 } });
  const mk = (name, phone, group) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: group }); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const bo = mk("Beto Panel", "+59171234567", "rev"); // solo panel, en Bs
  const pa = mk("Paula Afuera", "+50760000001", "rev-usd"); // en dólares
  const pg = mk("Pía Página", "+59172345678", "rev"); // con página propia
  s.shops.setupFor(owner, pg.c.id, { slug: "pia-tv", title: "Pía TV", enabled: true });
  return { dir, app, s, owner, system, clock, bo, pa, pg, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const cfg = (x) => ({ enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", priceUsd: 500, ...x });

test("suscripción para todos: Bs 49 / US$ 5, días de gracia, pausa y vuelve al pagar", async () => {
  const t = await setup();
  const { s, owner, system, clock, bo, pa, pg } = t;
  try {
    // Apagada (como queda en la tienda real hasta que el dueño la prenda): no cobra a nadie ni pausa nada.
    s.catalog.updateSettings(owner, { shopRent: cfg({ enabled: false }) });
    assert.deepEqual(s.shops.chargeRents(system), { charged: 0, free: 0, suspended: 0, started: 0 });
    assert.equal(s.shops.hubLocked(bo.c.id), false);
    // Validación: "quién paga" solo page/all; US$ fijos de 0 a 1000.
    assert.throws(() => s.catalog.updateSettings(owner, { shopRent: cfg({ scope: "todos" }) }), /inválido/);
    assert.throws(() => s.catalog.updateSettings(owner, { shopRent: cfg({ priceUsd: -1 }) }), /inválido/);

    // Prendida para todos: saldo a Beto (Bs 100) y a Paula (US$ 6); Pía sin saldo.
    s.wallet.adjust(owner, bo.c.id, 10000, "carga de prueba");
    s.wallet.adjust(owner, pa.c.id, 600, "carga de prueba");
    s.catalog.updateSettings(owner, { shopRent: cfg() });
    const r1 = s.shops.chargeRents(system);
    assert.equal(r1.started, 3, "arranca para los 3 (también el de solo panel)");
    assert.equal(s.wallet.balance(bo.c.id), 10000 - 4900, "Beto: Bs 49");
    assert.equal(s.wallet.balance(pa.c.id), 600 - 500, "Paula: US$ 5 fijos (no Bs 49 con la tasa)");
    assert.equal(s.wallet.balance(pg.c.id), 0);
    const hist = s.wallet.history(owner, bo.c.id);
    assert.match(hist.at(-1).note ?? "", /Suscripción GaboHub/);
    // Info para el revendedor.
    const infoB = s.shops.mine(bo.A).rent;
    assert.deepEqual([infoB.enabled, infoB.hub, infoB.price, infoB.locked, infoB.paidUntil > clock.t + 29 * DAY], [true, true, 4900, false, true]);
    assert.equal(s.shops.mine(pa.A).rent.price, 500);

    // Pía no tiene saldo: los días de gracia sigue todo; después se pausa (y su página se apaga).
    clock.t += 2 * DAY; s.shops.chargeRents(system);
    assert.equal(s.shops.hubLocked(pg.c.id), false, "dentro de la gracia");
    clock.t += 2 * DAY;
    assert.equal(s.shops.chargeRents(system).suspended, 1);
    assert.equal(s.shops.hubLocked(pg.c.id), true);
    assert.equal(s.engine.s.customers[pg.c.id].shop.suspended, true, "con página: se apaga su página");
    assert.equal(s.shops.hubLocked(bo.c.id), false, "Beto pagó");
    // Paga desde su panel apenas recarga: se reactiva.
    assert.throws(() => s.shops.payRent(pg.A), /Te falta saldo: el mes cuesta 49 Bs/);
    s.wallet.adjust(owner, pg.c.id, 5000, "recarga");
    s.shops.payRent(pg.A);
    assert.equal(s.shops.hubLocked(pg.c.id), false);
    assert.equal(s.wallet.balance(pg.c.id), 100);
    assert.throws(() => s.shops.payRent(pg.A), /ya está pagada/, "no se cobra dos veces el mismo mes");

    // Beto, solo panel, al mes siguiente sin saldo: se pausa; su estado vive fuera de "página" y, si arma su página, pasa a ella.
    s.wallet.adjust(owner, bo.c.id, -s.wallet.balance(bo.c.id), "lo gastó todo (prueba)");
    clock.t += 31 * DAY; s.shops.chargeRents(system);
    clock.t += 4 * DAY; s.shops.chargeRents(system);
    assert.equal(s.shops.hubLocked(bo.c.id), true);
    assert.equal(s.engine.s.customers[bo.c.id].shop, undefined, "Beto no tiene página");
    assert.equal(s.engine.s.customers[bo.c.id].hubBill.suspended, true);
    // Si el dueño apaga el cobro, nadie queda pausado.
    s.catalog.updateSettings(owner, { shopRent: cfg({ enabled: false }) });
    assert.equal(s.shops.hubLocked(bo.c.id), false);
    s.shops.chargeRents(system);
    assert.equal(s.engine.s.customers[bo.c.id].hubBill.suspended, undefined, "apagado: se limpia la pausa");
    // Se vuelve a prender y le arman la página a Beto: lo pagado/pausado se muda a su página.
    s.catalog.updateSettings(owner, { shopRent: cfg() });
    s.wallet.adjust(owner, bo.c.id, 4900, "recarga");
    s.shops.payRent(bo.A);
    const paid = s.engine.s.customers[bo.c.id].hubBill.paidUntil;
    s.shops.setupFor(owner, bo.c.id, { slug: "beto-tv", title: "Beto TV", enabled: true });
    assert.equal(s.engine.s.customers[bo.c.id].hubBill, undefined);
    assert.equal(s.engine.s.customers[bo.c.id].shop.paidUntil, paid);

    // "Solo los que tienen página" (como antes): un revendedor sin página no paga ni se pausa.
    const solo = s.catalog.createCustomer(owner, { name: "Sole Panel", phone: "+59173456789", kind: "reseller", priceGroupId: "rev" });
    s.catalog.updateSettings(owner, { shopRent: cfg({ scope: "page" }) });
    s.shops.chargeRents(system);
    assert.equal(s.engine.s.customers[solo.id].hubBill, undefined);
    assert.equal(s.shops.hubLocked(solo.id), false);
  } finally { await t.close(); }
});

test("pausado: el servidor no entrega Mi control, Quién me debe ni Ganancias; vender, fiar, comprar y cuentas siguen", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const t = await setup();
  const { s, owner, system, clock, bo, app } = t;
  try {
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 1000, profiles: [1, 2, 3].map((i) => ({ label: `P${i}` })) });
    const cli = s.catalog.createCustomer(bo.A, { name: "Cliente Uno", phone: "+59160000001" });
    s.catalog.updateSettings(owner, { shopRent: cfg() });
    s.shops.chargeRents(system); clock.t += 4 * DAY; s.shops.chargeRents(system);
    assert.equal(s.shops.hubLocked(bo.c.id), true);
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${bo.c.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: bo.c.phone, pin })).headers.get("set-cookie").split(";")[0];
    const get = (p) => fetch(base + p, { headers: { cookie: rck } });
    for (const p of ["/api/me/control", "/api/me/fiado", "/api/me/earnings"]) {
      const r = await get(p);
      assert.equal(r.status, 402, p);
      assert.equal((await r.json()).error, "HUB_UNPAID");
    }
    for (const p of ["/api/me/services", "/api/me/customers", "/api/me/shop", "/api/me/own", "/api/me/prices"]) assert.equal((await get(p)).status, 200, `${p} nunca se bloquea`);
    // Anotar un fiado (lo usa "Me paga después" al vender) sigue funcionando.
    assert.equal((await post("/api/me/fiado/charge", { customerId: cli.id, amount: 1500, note: "Netflix" }, rck)).status, 200);
    // Recargar saldo y pagar desde el Inicio: se reactiva al instante.
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, bo.c.id);
      const [n, v] = rck.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(base + "/hub#inicio");
      await page.locator(".hbox.bad", { hasText: "Tu suscripción de GaboHub venció" }).waitFor();
      // Mi control: candado con Pagar (no la herramienta).
      await page.goto(base + "/hub#mas");
      await page.locator('.hubarea-i[data-rtool="control"]').click();
      await page.locator(".hublock").waitFor();
      assert.match(await page.locator(".hublock").innerText(), /Bs 49/);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll(".hublock button")].filter((x) => x.getBoundingClientRect().height < 44).length), 0);
      // Comprar y Mis cuentas siguen abiertos.
      await page.goto(base + "/hub#precios"); await page.locator(".sec-h h2", { hasText: "Precios para revendedores" }).waitFor();
      s.wallet.adjust(owner, bo.c.id, 4900, "recarga");
      await page.goto(base + "/hub#mas");
      await page.locator('.hubarea-i[data-rtool="control"]').click();
      await page.locator(".hublock [data-rentpay]").click();
      await page.waitForFunction(() => !document.querySelector(".hublock"), null, { timeout: 15_000 }).catch(() => {});
      assert.equal(s.shops.hubLocked(bo.c.id), false, "pagó y se reactivó");
      assert.equal((await get("/api/me/control")).status, 200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  } finally { await t.close(); }
});
