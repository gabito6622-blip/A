// Seguridad y plata después de la lista en dólares:
//  - B15: el cliente final de un revendedor nunca ve lo que pagó su revendedor (su costo) en ninguna
//    respuesta de /api/me*, ni en el bot de WhatsApp, ni en los avisos.
//  - Dos revendedores no se ven ni se tocan.
//  - B16: precio acordado en US$ en el Control para quien paga en dólares, y la renovación lo usa.
//  - Mezcla de monedas: bot, Excel y "Que vuelvan" dicen US$ a quien paga en dólares.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { usdToBs } from "../dist/store/usd.js";
import { createApp } from "../dist/server/app.js";
import { botAnswer } from "../dist/server/bot.js";
import { buildExport } from "../dist/server/exports.js";
import { readSheet } from "../dist/server/xlsx.js";

const owner = { id: "u_owner", role: "owner" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const RATE = 9.85;
// Montos "raros" para encontrarlos en cualquier JSON: si aparecen, se filtró un costo.
const COST_BS = 2347;          // lista de revendedor (lo que paga el revendedor en Bs)
const AGREED_BS = 2291;        // precio acordado en el Control del dueño (lo que le paga el revendedor)
const COST_USD = 613;          // lista en dólares (US$ 6,13)
const AGREED_USD = 587;        // acordado en US$ en el Control (US$ 5,87)
const SELL_A = 4111;           // precio de venta de Ana a sus clientes (su lista)
const leakRe = new RegExp(`\\b(${[COST_BS, AGREED_BS, COST_USD, AGREED_USD, usdToBs(COST_USD, RATE), usdToBs(AGREED_USD, RATE)].join("|")})\\b|23[.,]47|22[.,]91|6[.,]13|5[.,]87`);

/* ---------------- núcleo (sin servidor) ---------------- */
function core() {
  const clock = { t: Date.UTC(2026, 10, 11, 15), now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Prov", active: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  for (let i = 0; i < 3; i++) s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: `n${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: clock.t + 200 * DAY, cost: 3000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }] });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: COST_BS } });
  s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Afuera (US$)", currency: "USD", prices: { netflix: COST_USD } });
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: RATE } });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Bolivia", phone: "+59171111111", kind: "reseller", priceGroupId: "revendedor" });
  const uri = s.catalog.createCustomer(owner, { name: "Uri Panamá", phone: "+50761111111", kind: "reseller", priceGroupId: "lp-usd" });
  const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });
  s.wallet.adjust(owner, ana.id, 100000, "Bs 1000");
  s.wallet.adjust(owner, uri.id, 10000, "US$ 100");
  const cA = s.catalog.createCustomer(as(ana), { name: "Clara de Ana", phone: "71222222" });
  const cU = s.catalog.createCustomer(as(uri), { name: "Ulises de Uri", phone: "+50762222222" });
  return { s, clock, ana, uri, cA, cU, as };
}

describe("B16: precio acordado en US$ en el Control", () => {
  test("el dueño anota US$ 5,87: el Control lo muestra en US$, Bs con la tasa de hoy, y la renovación lo cobra", () => {
    const { s, uri, cU, as } = core();
    const o = s.orders.create(as(uri), { customerId: cU.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const aid = o.assignmentIds[0];
    let row = s.admin.assignments(owner, { customerId: cU.id })[0];
    assert.deepEqual([row.payCurrency, row.payUsd, row.effectivePrice], ["USD", COST_USD, usdToBs(COST_USD, RATE)], "sin acordado: su lista en US$");
    s.orders.setControl(owner, aid, { priceUsd: AGREED_USD });
    row = s.admin.assignments(owner, { customerId: cU.id })[0];
    assert.deepEqual([row.payCurrency, row.payUsd, row.effectivePrice], ["USD", AGREED_USD, usdToBs(AGREED_USD, RATE)]);
    // Lo que ve Uri en su control como costo de renovar, y lo que se le cobra.
    assert.equal(s.rtools.control(as(uri)).find((r) => r.id === aid).cost, AGREED_USD);
    const before = s.wallet.balance(uri.id);
    const r = s.orders.renew(as(uri), aid, { paymentMethod: "balance" });
    assert.deepEqual([r.order.usd, r.order.total, s.wallet.balance(uri.id)], [AGREED_USD, usdToBs(AGREED_USD, RATE), before - AGREED_USD]);
    // Borrarlo vuelve a su lista.
    s.orders.setControl(owner, aid, { priceUsd: null });
    assert.equal(s.orders.renew(as(uri), aid, { paymentMethod: "balance" }).order.usd, COST_USD);
  });

  test("su propio alquiler (revendedor en dólares) también usa el acordado en US$; el viejo precio en Bs no se mezcla", () => {
    const { s, uri, as } = core();
    const o = s.orders.create(as(uri), { customerId: uri.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const aid = o.assignmentIds[0];
    s.orders.setControl(owner, aid, { price: 9999, priceUsd: AGREED_USD });
    assert.equal(s.admin.assignments(owner, { customerId: uri.id })[0].effectivePrice, usdToBs(AGREED_USD, RATE), "manda el de US$, no los Bs 99,99");
    assert.equal(s.orders.renew(as(uri), aid, { paymentMethod: "balance" }).order.usd, AGREED_USD);
    // Fiado del dueño: lo que debe va en Bs a la tasa de hoy del precio en US$ acordado.
    s.orders.setControl(owner, aid, { payStatus: "pendiente" });
    assert.equal(s.fiado.overview(owner).rows.find((x) => x.customerId === uri.id).unlinked.amount, usdToBs(AGREED_USD, RATE));
  });

  test("a un cliente que paga en Bs no se le anota en US$; Bolivia sigue igual (acordado en Bs)", () => {
    const { s, ana, cA, as } = core();
    const o = s.orders.create(as(ana), { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const aid = o.assignmentIds[0];
    assert.throws(() => s.orders.setControl(owner, aid, { priceUsd: 500 }), err("VALIDATION", /paga en Bs/));
    s.orders.setControl(owner, aid, { price: AGREED_BS });
    const row = s.admin.assignments(owner, { customerId: cA.id })[0];
    assert.equal(row.payCurrency, undefined);
    assert.equal(row.effectivePrice, AGREED_BS);
    assert.equal(s.orders.renew(as(ana), aid, { paymentMethod: "balance" }).order.total, AGREED_BS, "Ana renueva a su precio acordado");
    assert.throws(() => s.orders.setControl(owner, aid, { priceUsd: -1 }), err("VALIDATION"));
  });
});

describe("B15: el cliente final no ve el costo de su revendedor (núcleo)", () => {
  test("Mis pedidos sin montos de lo que pagó su revendedor; para renovar lo mandamos a su revendedor (no ve ningún precio)", () => {
    const { s, ana, cA, as } = core();
    const o = s.orders.create(as(ana), { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const aid = o.assignmentIds[0];
    s.orders.setControl(owner, aid, { price: AGREED_BS });
    const me = as(cA);
    const orders = s.portal.orders(me);
    assert.deepEqual(orders.map((x) => [x.total, x.paidBy, x.method]), [[null, "reseller", undefined]]);
    const svc = s.portal.services(me)[0];
    // Decisión del dueño (11/11): el cliente de un revendedor renueva con su revendedor. No ve ni el costo ni el precio de la tienda.
    assert.equal(svc.renewPrice, null, "no ve ningún precio");
    assert.match(svc.viaReseller.name, /^Ana/);
    assert.throws(() => s.orders.renew(me, aid, { paymentMethod: "qr" }), (e) => e.code === "FORBIDDEN" && /Ana/.test(e.message));
    // Ana sigue viendo todo lo suyo.
    assert.equal(s.portal.orders(as(ana)).find((x) => x.id === o.id).total, COST_BS);
    assert.equal(s.portal.services(as(ana)).find((x) => x.assignmentId === aid).renewPrice, AGREED_BS);
  });

  test("pedido por QR de Ana para su cliente: el aviso con el monto le llega a Ana; el cliente no le cancela ni le sube comprobante", () => {
    const { s, ana, cA, as } = core();
    s.engine.s.settings.qrFileRef = "qr.png";
    const o = s.orders.create(as(ana), { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    const msgs = s.engine.s.outbox.filter((m) => m.template === "order_received");
    assert.deepEqual(msgs.map((m) => m.customerId), [ana.id]);
    assert.ok(!s.engine.s.outbox.some((m) => m.customerId === cA.id && JSON.stringify(m).match(leakRe)));
    assert.throws(() => s.orders.cancel(as(cA), o.id), err("FORBIDDEN"));
    assert.throws(() => s.orders.submitEvidence(as(cA), o.id, { fileRef: "x.png", declaredReference: "123" }), err("FORBIDDEN"));
    s.orders.submitEvidence(as(ana), o.id, { fileRef: "x.png", declaredReference: "123" });
    s.orders.rejectPayment(owner, o.id, "no llegó");
    assert.deepEqual(s.engine.s.outbox.filter((m) => m.template === "payment_rejected").map((m) => m.customerId), [ana.id]);
  });

  test("bot de WhatsApp: 'mis pedidos' del cliente final no dice cuánto pagó su revendedor", () => {
    const { s, ana, cA, as } = core();
    s.orders.create(as(ana), { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const ctx = { store: s, origin: undefined, loginLink: () => null };
    const txt = botAnswer(ctx, cA.phone, "7").replies.join("\n");
    assert.match(txt, /lo pagó tu revendedor/);
    assert.doesNotMatch(txt, leakRe);
    assert.match(botAnswer(ctx, ana.phone, "7").replies.join("\n"), /23,47/, "Ana sí ve lo que pagó");
  });
});

describe("monedas: quien paga en dólares ve US$, el dueño suma Bs", () => {
  test("bot: precios, saldo y pedidos de un revendedor en dólares en US$ (Bolivia sigue en Bs)", () => {
    const { s, ana, uri, cU, as } = core();
    s.orders.create(as(uri), { customerId: cU.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const ctx = { store: s, origin: undefined, loginLink: () => null };
    const say = (phone, t) => botAnswer(ctx, phone, t).replies.join("\n");
    assert.match(say(uri.phone, "saldo"), /US\$ 93,87/);
    assert.match(say(uri.phone, "precios"), /Netflix: \*US\$ 6,13\*/);
    assert.match(say(uri.phone, "netflix"), /US\$ 6,13/);
    assert.match(say(uri.phone, "7"), /US\$ 6,13/);
    assert.doesNotMatch(say(uri.phone, "saldo") + say(uri.phone, "precios") + say(uri.phone, "7"), /Bs/);
    assert.match(say(ana.phone, "saldo"), /Bs 1\.000|Bs 1000/);
    assert.match(say(ana.phone, "precios"), /Bs 23,47/);
  });

  test("Excel: saldos y movimientos con su moneda; ventas en Bs con lo cobrado en US$ aparte", () => {
    const { s, ana, uri, cU, as } = core();
    const o = s.orders.create(as(uri), { customerId: cU.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const sheet = (kind) => readSheet(buildExport(s, owner, kind).file);
    const cli = sheet("clientes");
    const h = cli[0], iS = h.indexOf("Saldo"), iM = h.indexOf("Moneda del saldo");
    assert.ok(iS > 0 && iM === iS + 1, JSON.stringify(h));
    const rowOf = (rows, name) => rows.find((r) => r[0] === name);
    assert.deepEqual([rowOf(cli, uri.name)[iS], rowOf(cli, uri.name)[iM]], ["93.87", "US$"]);
    assert.deepEqual([rowOf(cli, ana.name)[iS], rowOf(cli, ana.name)[iM]], ["1000", "Bs"]);
    const mov = sheet("movimientos");
    const iMon = mov[0].indexOf("Moneda");
    assert.ok(mov.filter((r) => r[1] === uri.name).every((r) => r[iMon] === "US$"));
    assert.ok(mov.filter((r) => r[1] === ana.name).every((r) => r[iMon] === "Bs"));
    const ven = sheet("ventas");
    const iT = ven[0].indexOf("Total (Bs)"), iU = ven[0].indexOf("Cobrado en US$");
    const vr = ven.find((r) => r[1] === o.id);
    assert.deepEqual([vr[iT], vr[iU]], [String(usdToBs(COST_USD, RATE) / 100), "6.13"]);
  });

  test("Que vuelvan: al revendedor en dólares se le escribe en US$; el total del dueño sigue en Bs", () => {
    const { s, clock, uri, ana, as } = core();
    const ou = s.orders.create(as(uri), { customerId: uri.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const oa = s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    s.orders.setControl(owner, ou.assignmentIds[0], { priceUsd: AGREED_USD });
    clock.t += 35 * DAY;
    const wb = s.winback.list(owner);
    const iu = wb.vencidos.find((x) => x.customerId === uri.id), ia = wb.vencidos.find((x) => x.customerId === ana.id);
    assert.ok(iu && ia, JSON.stringify(wb));
    assert.match(iu.message, /US\$ 5,87/);
    assert.doesNotMatch(iu.message, /Bs/);
    assert.equal(iu.amount, usdToBs(AGREED_USD, RATE), "para el dueño, en Bs");
    assert.equal(iu.things[0].usd, AGREED_USD);
    assert.match(ia.message, /Bs 23,47/);
    assert.equal(ia.things[0].usd, undefined);
    void oa;
  });
});

/* ---------------- por la API: todas las rutas del portal como cliente final y entre revendedores ---------------- */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** Rutas GET del portal (/api/me*) tal como están en el servidor: si se agrega una, esta prueba la recorre. */
function portalGetRoutes() {
  const src = ["src/server/app.ts", "src/server/ownStockRoutes.ts"].map((f) => readFileSync(resolve(f), "utf8")).join("\n");
  return [...new Set([...src.matchAll(/route\("GET", "(\/api\/me[^"]*)"/g)].map((m) => m[1]))];
}

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-segplata-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = (cookie) => async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const text = await r.text();
    let body = {}; try { body = JSON.parse(text); } catch { /* imagen o vacío */ }
    return { status: r.status, text, body };
  };
  const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const A = async (m, p, b) => { const r = await call(lr.headers.get("set-cookie").split(";")[0])(m, p, b); if (r.status >= 400) throw new Error(`${p}: ${r.status} ${r.text}`); return r.body; };
  await A("POST", "/api/admin/settings", { usdt: { enabled: true, payId: "123456789", rate: RATE }, resellerShops: true });
  await A("POST", "/api/admin/settings/qr", { contentBase64: PNG.toString("base64") });
  await A("POST", "/api/admin/suppliers", { id: "prov", name: "Prov", active: true });
  await A("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  for (let i = 0; i < 3; i++) await A("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "prov", email: `n${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 3000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }] });
  await A("POST", "/api/admin/price-groups", { id: "revendedor", name: "Revendedor", prices: { netflix: COST_BS } });
  await A("POST", "/api/admin/price-groups", { id: "lp-usd", name: "Afuera (US$)", currency: "USD", prices: { netflix: COST_USD } });
  const cookieOf = async (phone, id) => {
    const { pin } = await A("POST", `/api/admin/customers/${id}/login-pin`, {});
    const r = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin }) });
    return r.headers.get("set-cookie").split(";")[0];
  };
  return { dir, app, A, call, cookieOf, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("por la API: el cliente final de un revendedor (Bs y US$) no ve el costo en NINGUNA ruta del portal ni de las páginas", async () => {
  const t = await boot();
  try {
    const { A, call, cookieOf } = t;
    const ana = await A("POST", "/api/admin/customers", { name: "Ana Bolivia", phone: "+59171111111", kind: "reseller", priceGroupId: "revendedor" });
    const uri = await A("POST", "/api/admin/customers", { name: "Uri Panamá", phone: "+50761111111", kind: "reseller", priceGroupId: "lp-usd" });
    await A("POST", `/api/admin/customers/${ana.id}/adjust`, { amount: 100000, reason: "x" });
    await A("POST", `/api/admin/customers/${uri.id}/adjust`, { amount: 10000, reason: "x" });
    for (const r of [ana, uri]) await A("POST", `/api/admin/customers/${r.id}/reseller-page`, { allowed: true });
    const RA = call(await cookieOf("+59171111111", ana.id)), RU = call(await cookieOf("+50761111111", uri.id));
    assert.equal((await RA("PUT", "/api/me/shop", { slug: "ana-tienda", title: "Ana", enabled: true })).status, 200);
    assert.equal((await RA("PUT", "/api/me/prices", { prices: { netflix: SELL_A } })).status, 200);
    const cA = (await RA("POST", "/api/me/customers", { name: "Clara de Ana", phone: "71222222" })).body;
    const cU = (await RU("POST", "/api/me/customers", { name: "Ulises de Uri", phone: "62222222" })).body;
    const oA = (await RA("POST", "/api/orders", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" })).body;
    const oU = (await RU("POST", "/api/orders", { customerId: cU.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" })).body;
    assert.deepEqual([oA.total, oU.usd], [COST_BS, COST_USD]);
    // Un pedido por QR de Ana para Clara, todavía sin pagar.
    const oQ = (await RA("POST", "/api/orders", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" })).body;
    await A("POST", `/api/admin/assignments/${oA.assignmentIds[0]}/control`, { price: AGREED_BS });
    await A("POST", `/api/admin/assignments/${oU.assignmentIds[0]}/control`, { priceUsd: AGREED_USD });
    // Ana anota en su control lo que le cobra a Clara (eso sí es de Clara: no es el costo).
    await RA("POST", `/api/me/control/${oA.assignmentIds[0]}`, { price: SELL_A, payStatus: "pendiente" });

    const routes = portalGetRoutes();
    assert.ok(routes.length >= 25, `rutas del portal: ${routes.length}`);
    const fill = (p, me) => p.replace(":id", me.id).replace(":slug", "ana-tienda");
    for (const [who, cookie, other] of [["Clara (cliente de Ana, Bs)", await cookieOf(cA.phone, cA.id), cA], ["Ulises (cliente de Uri, US$)", await cookieOf(cU.phone, cU.id), cU]]) {
      const C = call(cookie);
      const paths = [...routes.map((p) => fill(p, other)), "/api/catalog", "/api/settings", "/api/shops/ana-tienda", "/api/me/codes?customerId=" + ana.id];
      for (const p of paths) {
        const r = await C("GET", p);
        assert.ok(r.status < 500, `${who} ${p}: ${r.status}`);
        assert.doesNotMatch(r.text, leakRe, `${who} ve un costo de su revendedor en ${p}: ${r.text.slice(0, 300)}`);
        assert.doesNotMatch(r.text, other === cA ? /Ulises|62222222/ : /Clara|71222222/, `${who} ve otro cliente en ${p}`);
      }
      const orders = (await C("GET", "/api/me/orders")).body;
      assert.ok(orders.length && orders.every((o) => o.total === null && o.paidBy === "reseller"), JSON.stringify(orders));
      // No toca el pedido de su revendedor.
      if (other === cA) {
        // Decisión del dueño: no renueva directo, lo mandamos a su revendedor. El rechazo tampoco filtra montos.
        const rn = await C("POST", "/api/me/renew", { assignmentId: oA.assignmentIds[0], paymentMethod: "qr" });
        assert.equal(rn.status, 403, rn.text);
        assert.doesNotMatch(rn.text, leakRe);
        assert.equal((await C("POST", `/api/orders/${oQ.id}/cancel`)).status, 403);
        assert.equal((await C("POST", `/api/orders/${oQ.id}/evidence`, { contentBase64: PNG.toString("base64"), declaredReference: "1" })).status, 403);
      }
    }
    // El revendedor que renueva tampoco recibe el Control del dueño (costo de la cuenta, notas internas).
    await A("POST", `/api/admin/assignments/${oA.assignmentIds[0]}/control`, { cost: 1777, note: "nota interna del dueño" });
    const ra = await RA("POST", "/api/me/renew", { assignmentId: oA.assignmentIds[0], paymentMethod: "balance" });
    assert.equal(ra.status, 200, ra.text);
    assert.equal(ra.body.order.total, AGREED_BS, "Ana renueva a su precio acordado");
    assert.equal(ra.body.assignment.control, undefined);
    // \b: el costo como número suelto. Sin eso, «1777» podía aparecer por casualidad dentro de una fecha-hora (falso positivo).
    assert.doesNotMatch(ra.text, /\b1777\b|nota interna/);
    // La página pública de Ana: su precio de venta, nunca su costo.
    const shop = (await call()("GET", "/api/shops/ana-tienda")).text;
    assert.match(shop, new RegExp(String(SELL_A)));
    assert.doesNotMatch(shop, leakRe);
    const page = await call()("GET", "/r/ana-tienda");
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, leakRe);
  } finally { await t.close(); }
});

test("por la API: dos revendedores no se ven ni se tocan (leer, crear, editar, cobrar, renovar)", async () => {
  const t = await boot();
  try {
    const { A, call, cookieOf } = t;
    const ana = await A("POST", "/api/admin/customers", { name: "Ana Bolivia", phone: "+59171111111", kind: "reseller", priceGroupId: "revendedor" });
    const beto = await A("POST", "/api/admin/customers", { name: "Beto Bolivia", phone: "+59173333333", kind: "reseller", priceGroupId: "revendedor" });
    for (const r of [ana, beto]) await A("POST", `/api/admin/customers/${r.id}/adjust`, { amount: 100000, reason: "x" });
    const RA = call(await cookieOf("+59171111111", ana.id)), RB = call(await cookieOf("+59173333333", beto.id));
    await RA("PUT", "/api/me/prices", { prices: { netflix: SELL_A } });
    const cA = (await RA("POST", "/api/me/customers", { name: "Clara de Ana", phone: "71222222" })).body;
    const oA = (await RA("POST", "/api/orders", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" })).body;
    const aid = oA.assignmentIds[0];
    const oQ = (await RA("POST", "/api/orders", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" })).body;
    await RA("POST", `/api/me/control/${aid}`, { price: SELL_A, payStatus: "pendiente" });
    await RA("POST", "/api/me/fiado/charge", { customerId: cA.id, amount: 1500, note: "debe" });

    // Beto lee todo su portal: nada de Ana ni de Clara.
    for (const p of portalGetRoutes().map((x) => x.replace(":id", cA.id).replace(":slug", "ana-tienda"))) {
      const r = await RB("GET", p);
      assert.ok(r.status < 500, `${p}: ${r.status}`);
      assert.doesNotMatch(r.text, /Clara|71222222|Ana Bolivia|4111/, `Beto ve algo de Ana en ${p}: ${r.text.slice(0, 200)}`);
    }
    // Y no puede tocar nada de Ana ni de sus clientes.
    const tries = [
      ["GET", `/api/me/codes?customerId=${cA.id}`], ["GET", `/api/me/fiado/${cA.id}`], ["GET", `/api/me/clients/${cA.id}/code-link`],
      ["POST", `/api/me/clients/${cA.id}/code-link`, {}], ["POST", `/api/me/control/${aid}`, { price: 1 }], ["PUT", `/api/me/customers/${cA.id}`, { name: "Hackeado" }],
      ["POST", "/api/orders", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" }],
      ["POST", "/api/orders/quote", { customerId: cA.id, items: [{ productId: "netflix", qty: 1 }] }],
      ["POST", "/api/me/renew", { assignmentId: aid, paymentMethod: "balance" }], ["POST", `/api/orders/${oQ.id}/cancel`],
      ["POST", `/api/orders/${oQ.id}/evidence`, { contentBase64: PNG.toString("base64"), declaredReference: "1" }],
      ["POST", "/api/me/tickets", { assignmentId: aid, kind: "no_entra" }], ["POST", "/api/me/fiado/charge", { customerId: cA.id, amount: 100 }],
      ["POST", "/api/me/fiado/payment", { customerId: cA.id, amount: 100 }], ["POST", `/api/me/fiado/${cA.id}/from-control`],
      ["POST", `/api/me/subs/${aid}`, { name: "x", expiresAt: Date.now() + DAY }],
    ];
    for (const [m, p, b] of tries) {
      const r = await RB(m, p, b);
      assert.ok(r.status === 403 || r.status === 404, `Beto ${m} ${p} → ${r.status} ${r.text.slice(0, 200)}`);
    }
    // Nada cambió del lado de Ana.
    const mine = (await RA("GET", "/api/me/customers")).body;
    assert.deepEqual(mine.map((c) => c.name), ["Clara de Ana"]);
    assert.equal((await RA("GET", `/api/me/fiado/${cA.id}`)).body.owed, 1500 + SELL_A);
  } finally { await t.close(); }
});

test("CSP: el Control del panel y Mis pedidos de la tienda conocen los campos nuevos (sin scripts en línea)", () => {
  const panel = readFileSync(resolve("public/panel.js"), "utf8"), usdJs = readFileSync(resolve("public/usd.js"), "utf8"), shop = readFileSync(resolve("public/shop.js"), "utf8");
  assert.match(usdJs, /f: "priceUsd"/);
  assert.match(panel, /payField\(r, r\.price\)/);
  assert.match(panel, /f === "priceUsd"/);
  assert.match(shop, /Lo pagó tu revendedor/);
  assert.match(shop, /!o\.paidBy && \(o\.status === "awaiting_payment"/);
});
