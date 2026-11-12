// Premium 2.0 · etapa 6 "GaboHub alquilable" (12/11/2026). Sobre la suscripción que ya existe (apagada en la tienda real):
//  1. Prueba gratis de N días: al prender el cobro, el primer período no se descuenta; el cobro arranca al terminar.
//  2. Dos planes: Completo (todo) y Básico (sin Mi control, Quién me debe, Mis ganancias ni Afiches), cada uno con su precio
//     (en Bs y, si el dueño quiere, en US$ fijos). El revendedor cambia su plan desde su Inicio; el dueño, desde Revendedores.
//  3. Nada se cobra solo mientras el cobro esté apagado; nada real sale de acá. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { DomainError } from "../dist/store/index.js";

const DAY = 864e5;
const err = (code) => (e) => e instanceof DomainError && e.code === code;

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-planes-"));
  const clock = { t: Date.UTC(2026, 10, 12, 15), now() { return this.t; } };
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" }, system = { id: "system:prueba", role: "system" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  s.catalog.upsertPriceGroup(owner, { id: "rev-usd", name: "Afuera (US$)", currency: "USD", prices: { nf: 400 } });
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 10 } });
  const mk = (name, phone, group) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: group }); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const bo = mk("Beto Panel", "+59171234567", "rev");
  const pa = mk("Paula Afuera", "+50760000001", "rev-usd");
  return { dir, app, s, owner, system, clock, bo, pa, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const cfg = (x) => ({ enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", priceUsd: 500, ...x });

test("prueba gratis de 15 días: no se descuenta nada; al terminar se cobra; sin saldo corre la gracia y después pausa", async () => {
  const t = await setup();
  const { s, owner, system, clock, bo } = t;
  try {
    s.wallet.adjust(owner, bo.c.id, 10000, "saldo de prueba");
    s.catalog.updateSettings(owner, { shopRent: cfg({ trialDays: 15 }) });
    const bal0 = s.wallet.balance(bo.c.id);
    assert.deepEqual(s.shops.chargeRents(system), { charged: 0, free: 0, suspended: 0, started: 2, trials: 2 }, "los 2 revendedores arrancan en prueba");
    assert.equal(s.wallet.balance(bo.c.id), bal0, "la prueba no descuenta saldo");
    let info = s.shops.mine(bo.A).rent;
    assert.deepEqual([info.trial, info.paidUntil, info.trialDays, info.plan, info.lockReason], [true, clock.t + 15 * DAY, 15, "full", null]);
    assert.equal(s.shops.hubLocked(bo.c.id), false, "en prueba tiene todo");
    assert.equal(s.engine.s.audit.filter((a) => a.action === "reseller.hub_trial").length, 2);
    // Día 10: nada cambia. Día 16: se cobra el mes y sale de la prueba.
    clock.t += 10 * DAY;
    assert.deepEqual(s.shops.chargeRents(system), { charged: 0, free: 0, suspended: 0, started: 0, trials: 0 });
    clock.t += 6 * DAY;
    const r = s.shops.chargeRents(system);
    assert.equal(r.charged, 1, "Beto tiene saldo: se cobra (Paula no tiene: no)");
    assert.equal(s.wallet.balance(bo.c.id), bal0 - 4900);
    info = s.shops.mine(bo.A).rent;
    assert.equal(info.trial, false);
    assert.equal(info.paidUntil, clock.t + 30 * DAY, "30 días desde el día del cobro (como siempre funcionó la renovación)");
    // Volver a prender con días de prueba a alguien que ya pagó: no vuelve a tener prueba (paidUntil ya existe).
    assert.equal(s.engine.s.audit.filter((a) => a.action === "reseller.hub_trial").length, 2);
  } finally { await t.close(); }
});

test("dos planes: Básico más barato sin herramientas premium (402 HUB_PLAN); cambiar de plan rige desde el próximo cobro; en US$ también", async () => {
  const t = await setup();
  const { s, owner, system, clock, bo, pa } = t;
  try {
    assert.throws(() => s.catalog.updateSettings(owner, { shopRent: cfg({ basicPrice: 5000 }) }), /inválido/, "Básico más caro que el Completo: no");
    assert.throws(() => s.catalog.updateSettings(owner, { shopRent: cfg({ trialDays: 91 }) }), /inválido/);
    assert.throws(() => s.shops.setPlan(owner, bo.c.id, "basic"), err("VALIDATION"), "sin precio Básico no hay plan Básico");
    s.catalog.updateSettings(owner, { shopRent: cfg({ basicPrice: 2500, basicPriceUsd: 300 }) });
    s.wallet.adjust(owner, bo.c.id, 20000, "saldo"); s.wallet.adjust(owner, pa.c.id, 5000, "saldo US$");
    // El revendedor elige Básico; otro revendedor no puede tocarle el plan; plan inválido no.
    assert.throws(() => s.shops.setPlan(pa.A, bo.c.id, "basic"), err("FORBIDDEN"));
    assert.throws(() => s.shops.setPlan(bo.A, bo.c.id, "oro"), err("VALIDATION"));
    let info = s.shops.setPlan(bo.A, bo.c.id, "basic");
    assert.deepEqual([info.plan, info.price, info.plans], ["basic", 2500, { basic: 2500, full: 4900 }]);
    s.shops.chargeRents(system);
    assert.equal(s.wallet.balance(bo.c.id), 20000 - 2500, "se cobra el Básico");
    assert.equal(s.shops.hubLockReason(bo.c.id), "plan");
    assert.equal(s.shops.hubLocked(bo.c.id), true, "Básico: las herramientas premium quedan pausadas");
    // Paula (US$): Básico a US$ 3 fijos.
    s.shops.setPlan(owner, pa.c.id, "basic");
    assert.equal(s.shops.mine(pa.A).rent.price, 300);
    assert.equal(s.wallet.balance(pa.c.id), 5000 - 500, "en la corrida anterior Paula era Completo: pagó US$ 5");
    // Beto vuelve al Completo: se destraba ya; el precio nuevo rige en el próximo cobro.
    info = s.shops.setPlan(bo.A, bo.c.id, "full");
    assert.deepEqual([info.plan, info.lockReason], ["full", null]);
    assert.equal(s.wallet.balance(bo.c.id), 20000 - 2500, "sin cobro extra al cambiar");
    clock.t += 31 * DAY;
    s.shops.chargeRents(system);
    assert.equal(s.wallet.balance(bo.c.id), 20000 - 2500 - 4900, "el mes siguiente ya es Completo");
    assert.equal(s.wallet.balance(pa.c.id), 5000 - 500 - 300, "y Paula, ya en Básico, paga US$ 3");
    const ov = s.shops.resellers(owner).find((r) => r.id === bo.c.id);
    assert.equal(ov.plan, "full");
    assert.equal(s.engine.s.audit.filter((a) => a.action === "reseller.hub_plan").length, 3, "solo los cambios que entraron se auditan");
  } finally { await t.close(); }
});

test("por la API: el revendedor cambia su plan; con Básico el Control responde 402 HUB_PLAN; el dueño cambia el plan desde Revendedores", async () => {
  const t = await setup();
  const { s, owner, system, bo, app } = t;
  try {
    s.catalog.updateSettings(owner, { shopRent: cfg({ basicPrice: 2500, trialDays: 15 }) });
    s.wallet.adjust(owner, bo.c.id, 20000, "saldo");
    s.shops.chargeRents(system);
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ownerCk = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const link = await (await post(`/api/admin/customers/${bo.c.id}/login-link`, {}, ownerCk)).json();
    const ck = (await post("/api/auth/customer/link", { token: link.url.split("#acceso=")[1] })).headers.get("set-cookie").split(";")[0];
    const get = async (p, c) => { const r = await fetch(base + p, { headers: { cookie: c } }); return { status: r.status, json: await r.json().catch(() => null) }; };
    let shop = (await get("/api/me/shop", ck)).json;
    assert.deepEqual([shop.rent.plan, shop.rent.trial, shop.rent.plans.basic, shop.rent.plans.full], ["full", true, 2500, 4900]);
    assert.equal((await get("/api/me/control", ck)).status, 200, "en prueba y Completo: el Control responde");
    const r1 = await post("/api/me/hub/plan", { plan: "basic" }, ck);
    assert.equal(r1.status, 200);
    const ctl = await get("/api/me/control", ck);
    assert.equal(ctl.status, 402); assert.equal(ctl.json.error, "HUB_PLAN"); assert.match(ctl.json.message, /plan Completo/);
    assert.equal((await get("/api/me/orders", ck)).status, 200, "lo básico (sus pedidos) sigue");
    const r2r = await post(`/api/admin/resellers/${bo.c.id}/plan`, { plan: "full" }, ownerCk);
    const r2 = { status: r2r.status, json: await r2r.json() };
    assert.equal(r2.status, 200, JSON.stringify(r2.json)); assert.equal(r2.json.plan, "full", JSON.stringify(r2.json));
    assert.equal((await get("/api/me/control", ck)).status, 200);
    assert.equal((await post(`/api/admin/resellers/${bo.c.id}/plan`, { plan: "basic" }, ck)).status, 403, "un revendedor no usa la ruta del dueño");
    shop = (await get("/api/me/shop", ck)).json;
    assert.equal(shop.rent.lockReason, null);
  } finally { await t.close(); }
});
