// Lista de precios en dólares con saldo en dólares (revendedores de Panamá y Paraguay que pagan en USDT).
// El revendedor ve, compra y guarda su saldo en US$; el dueño sigue viendo todo en Bs (con la tasa de cada pedido).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { overview as resellerOverview } from "../dist/store/resellerStats.js";
import { usdToBs, bsToUsd } from "../dist/store/usd.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const T0 = Date.UTC(2026, 10, 11, 15);
const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// Precios del dueño para Panamá y Paraguay (alquiler mensual de cuenta completa).
const USD_PRICES = { "disney-espn-alq": 700, "disney-alq": 350, "prime-alq": 300, "hbo-alq": 200 };
const PRODUCTS = [
  ["disney-espn-alq", "Disney + ESPN", 7000], ["disney-alq", "Disney sin ESPN", 3500],
  ["prime-alq", "Prime Video", 3000], ["hbo-alq", "HBO Max", 2000], ["netflix-alq", "Netflix", 9000],
];

function setup({ rate = 9.85 } = {}) {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Prov", active: true });
  for (const [id, name, price] of PRODUCTS) {
    s.catalog.upsertProduct(owner, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
    for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: id, supplierId: "prov", email: `${id}${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: T0 + 120 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  }
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-espn-alq": 6500, "disney-alq": 3200, "prime-alq": 2800, "hbo-alq": 1800, "netflix-alq": 8500 } });
  s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: USD_PRICES });
  if (rate) s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate } });
  const pa = s.catalog.createCustomer(owner, { name: "Ana Panamá", phone: "+50761234567", kind: "reseller", priceGroupId: "lp-usd" });
  const py = s.catalog.createCustomer(owner, { name: "Pedro Paraguay", phone: "+595981123456", kind: "reseller", priceGroupId: "lp-usd" });
  const bo = s.catalog.createCustomer(owner, { name: "Beto Bolivia", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
  const as = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
  return { s, clock, pa, py, bo, as };
}
const topup = (s, actor, cid, usdt, ref) => s.orders.requestTopup(actor, cid, 0, { fileRef: `${ref}.png`, declaredReference: ref }, "usdt", usdt);

describe("lista en dólares (núcleo)", () => {
  test("precios: el de la lista USD ve US$ 7 / 3,50 / 3 / 2 y nada sin precio; el de Bolivia ve Bs como antes", () => {
    const { s, pa, bo } = setup();
    const cat = s.catalog.publicCatalog(pa.id);
    assert.deepEqual(Object.fromEntries(cat.map((p) => [p.id, p.price])), USD_PRICES);
    assert.ok(cat.every((p) => p.currency === "USD" && p.publicPrice === undefined), "sin precio público en Bs al lado");
    assert.ok(!cat.some((p) => p.id === "netflix-alq"), "sin precio en su lista: no lo ve");
    assert.throws(() => s.catalog.priceFor(pa.id, "netflix-alq"), err("NOT_FOUND", /no tiene precio/));
    const bcat = s.catalog.publicCatalog(bo.id);
    assert.equal(bcat.find((p) => p.id === "disney-espn-alq").price, 6500);
    assert.equal(bcat.find((p) => p.id === "netflix-alq").price, 8500);
    assert.equal(bcat[0].currency, undefined);
    assert.deepEqual(s.usd.currency(pa.id), { code: "USD", symbol: "US$", decimals: 2, rate: 9.85 });
    assert.equal(s.usd.currency(bo.id).code, "BOB");
    // Con QR cargado igual no lo ve, ni métodos del país.
    s.engine.s.settings.qrFileRef = "qr.png";
    s.payMethods.save(owner, { name: "Yappy", country: "Panamá", account: "6123", priceGroupIds: ["lp-usd"], replacesQr: false });
    const pm = s.payMethods.mine({ id: "x", role: "reseller", customerId: pa.id });
    assert.deepEqual([pm.qr, pm.methods.length, pm.usdOnly], [false, 0, true]);
    assert.equal(s.payMethods.mine({ id: "y", role: "reseller", customerId: bo.id }).qr, true);
  });

  test("recarga 20 USDT → US$ 20; compra Disney + ESPN → US$ 13; el pedido guarda US$ y Bs; Finanzas suma Bs", () => {
    const { s, pa, as } = setup();
    const t = topup(s, as(pa), pa.id, 20, "TX-20");
    assert.equal(t.usd, 2000);
    assert.equal(t.total, 19700, "20 × 9,85 = Bs 197 para los números del dueño");
    assert.deepEqual(t.usdtQuote, { usdt: 20, rate: 9.85 });
    s.orders.approvePayment(owner, t.id, { confirmedReference: "TX-20" });
    assert.equal(s.wallet.balance(pa.id), 2000, "saldo US$ 20 (en centavos de dólar)");
    const ing0 = s.finance.report(owner, 1).current.ingresos;
    const o = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "balance" });
    assert.equal(o.status, "fulfilled");
    assert.equal(s.wallet.balance(pa.id), 1300, "le quedan US$ 13");
    assert.equal(o.usd, 700);
    assert.equal(o.total, 6895, "US$ 7 × 9,85 = Bs 68,95");
    assert.deepEqual(o.items.map((i) => [i.unitPrice, i.usd]), [[6895, 700]]);
    assert.deepEqual(o.usdtQuote, { usdt: 7, rate: 9.85 });
    assert.equal(s.finance.report(owner, 1).current.ingresos - ing0, 6895, "Finanzas suma los Bs");
    const st = s.stats.summary(owner, { from: T0 - DAY, to: T0 + DAY });
    assert.equal(st.revenue, 6895);
    assert.equal(st.byProduct["disney-espn-alq"].revenue, 6895, "por producto también en Bs");
    const led = s.wallet.history(as(pa), pa.id);
    assert.deepEqual(led.map((l) => [l.type, l.amount, l.cur, l.balanceAfter]), [["topup", 2000, "USD", 2000], ["purchase", -700, "USD", 1300]]);
    // Dashboard: "Cómo van" y la lista de revendedores, en Bs.
    const d = s.stats.dashboard(owner, 30);
    assert.equal(d.kpi.revenue, 6895);
    const r = d.resellers.find((x) => x.id === pa.id);
    assert.deepEqual([r.spent, r.balance, r.currency, r.monthly], [6895, 1300, "USD", 6895]);
    const ov = resellerOverview(s.engine, owner, T0);
    assert.equal(ov.list.find((x) => x.id === pa.id).paid30, 6895);
  });

  test("la tasa cambia: el saldo en US$ no se mueve y lo ya cobrado en Bs tampoco", () => {
    const { s, clock, pa, as } = setup();
    s.wallet.adjust(owner, pa.id, 2000, "recarga USDT por fuera");
    const o = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "balance" });
    clock.t += DAY;
    s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 10.5 } });
    assert.equal(s.wallet.balance(pa.id), 1300);
    assert.equal(s.engine.s.orders[o.id].total, 6895);
    assert.equal(s.finance.report(owner, 1).current.ingresos, 6895);
    // La próxima compra usa la tasa nueva: US$ 3 × 10,50 = Bs 31,50.
    const o2 = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "prime-alq", qty: 1 }], paymentMethod: "balance" });
    assert.deepEqual([o2.usd, o2.total, s.wallet.balance(pa.id)], [300, 3150, 1000]);
    // Un pago en USDT ya pedido conserva su tasa.
    const t = topup(s, as(pa), pa.id, 10, "TX-10");
    s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 11 } });
    s.orders.approvePayment(owner, t.id, { confirmedReference: "TX-10" });
    assert.deepEqual([s.engine.s.orders[t.id].total, s.wallet.balance(pa.id)], [10500, 2000], "acredita US$ 10 exactos; Bs con la tasa del pedido");
  });

  test("renovación de a uno y varias juntas con saldo en US$; pago USDT directo con el precio exacto", () => {
    const { s, clock, pa, as } = setup();
    s.wallet.adjust(owner, pa.id, 5000, "recarga");
    const a = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "disney-alq", qty: 1 }], paymentMethod: "balance" });
    const b = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" });
    assert.equal(s.wallet.balance(pa.id), 5000 - 350 - 200);
    // El Control en Bs no le cambia el precio en dólares.
    s.orders.setControl(owner, a.assignmentIds[0], { price: 9999 });
    clock.t += 20 * DAY;
    const r = s.orders.renew(as(pa), a.assignmentIds[0], { paymentMethod: "balance" });
    assert.deepEqual([r.order.usd, r.order.total, r.order.items[0].usd, r.order.status], [350, usdToBs(350, 9.85), 350, "fulfilled"]);
    assert.equal(s.wallet.balance(pa.id), 4450 - 350);
    // Disney ya se renovó recién (lo hizo el revendedor): el dueño confirma que es otro cobro (14/11: si no, frena «¿Es otro mes?»).
    assert.equal(s.orders.renewMany(owner, [a.assignmentIds[0]], { paymentMethod: "balance", periods: 2 })[0].code, "DOUBLE_CHARGE");
    const many = s.orders.renewMany(owner, [a.assignmentIds[0], b.assignmentIds[0]], { paymentMethod: "balance", periods: 2, confirmOther: true });
    assert.ok(many.every((x) => x.ok), JSON.stringify(many));
    assert.equal(s.wallet.balance(pa.id), 4100 - 700 - 400, "2 meses de Disney (US$ 7) + 2 de HBO (US$ 4)");
    const renewals = Object.values(s.engine.s.orders).filter((o) => o.kind === "renewal");
    assert.deepEqual(renewals.map((o) => o.usd), [350, 700, 400]);
    assert.deepEqual(renewals.map((o) => o.total), [3448, 6895, 3940]);
    // Pago USDT directo: monto exacto en US$ (1:1), queda esperando el comprobante; el saldo no se toca.
    const before = s.wallet.balance(pa.id);
    const u = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "disney-alq", qty: 1 }], paymentMethod: "usdt" });
    assert.deepEqual([u.status, u.usdtQuote.usdt, u.usd, u.total], ["awaiting_payment", 3.5, 350, 3448]);
    s.orders.submitEvidence(as(pa), u.id, { fileRef: "u.png", declaredReference: "BIN-1" });
    assert.equal(s.orders.approvePayment(owner, u.id, { confirmedReference: "BIN-1" }).status, "fulfilled");
    assert.equal(s.wallet.balance(pa.id), before);
    // Renovar con USDT también espera el pago (no se renueva gratis).
    const exp0 = s.engine.s.assignments[b.assignmentIds[0]].customerExpiresAt;
    const ru = s.orders.renew(as(pa), b.assignmentIds[0], { paymentMethod: "usdt" });
    assert.deepEqual([ru.order.status, ru.order.usdtQuote.usdt], ["awaiting_payment", 2]);
    assert.equal(s.engine.s.assignments[b.assignmentIds[0]].customerExpiresAt, exp0);
    // QR, cobro del país o Binance: no para un cliente en dólares.
    for (const m of ["qr", "local", "binance"]) assert.throws(() => s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "prime-alq", qty: 1 }], paymentMethod: m }), err("VALIDATION", /saldo o con USDT/));
    assert.throws(() => s.orders.renew(as(pa), b.assignmentIds[0], { paymentMethod: "qr" }), err("VALIDATION", /saldo o con USDT/));
    assert.throws(() => s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "prime-alq", qty: 1 }], paymentMethod: "balance", couponCode: "X" }), err("VALIDATION", /cupones/));
  });

  test("devolución y \"Era una prueba\" devuelven US$ al saldo en dólares", () => {
    const { s, clock, pa, as } = setup();
    s.wallet.adjust(owner, pa.id, 2000, "recarga");
    const o = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "balance" });
    s.orders.renew(as(pa), o.assignmentIds[0], { paymentMethod: "balance" });
    assert.equal(s.wallet.balance(pa.id), 600);
    const t = s.orders.markTest(owner, o.assignmentIds[0]);
    assert.deepEqual([t.refunded, t.refundedUsd, t.total], [6895 * 2, 1400, 6895 * 2], "vuelven US$ 14; el dueño ve los Bs que salen de sus números");
    assert.equal(s.wallet.balance(pa.id), 2000);
    assert.equal(s.finance.report(owner, 1).current.ingresos, 0);
    // Devolución proporcional: 15 de 30 días de Prime (US$ 3) = US$ 1,50.
    const p = s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "prime-alq", qty: 1 }], paymentMethod: "balance" });
    clock.t += 15 * DAY;
    const r = s.orders.refundAssignment(owner, p.assignmentIds[0]);
    assert.deepEqual([r.amount, r.currency, r.balance], [150, "USD", 2000 - 300 + 150]);
    assert.throws(() => s.orders.refundAssignment(owner, s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0], { amount: 201 }), err("VALIDATION"), "no más que su precio en US$");
  });

  test("ajuste de saldo del dueño en US$; el dashboard no mezcla monedas", () => {
    const { s, pa, py, bo } = setup();
    s.wallet.adjust(owner, pa.id, 1300, "Saldo inicial US$ 13");
    s.wallet.adjust(owner, py.id, 250, "US$ 2,50");
    s.wallet.adjust(owner, bo.id, 5000, "Bs 50");
    assert.throws(() => s.wallet.adjust(admin, pa.id, 100, "x"), err("FORBIDDEN"), "solo el dueño ajusta");
    assert.equal(s.engine.s.ledger.at(-1).cur, undefined, "el de Bolivia sigue en Bs");
    const k = s.stats.dashboard(owner, 30).kpi;
    assert.equal(k.balancesOwedUsd, 1550);
    assert.equal(k.balancesOwedBs, 5000);
    assert.equal(k.balancesOwed, 5000 + usdToBs(1550, 9.85), "US$ 15,50 a la tasa de hoy + Bs 50 (nunca 1550 + 5000)");
    assert.equal(s.stats.summary(owner, { from: 0, to: T0 + DAY }).balancesOwed, 5000 + 15268);
    const list = s.admin.customers(owner, "");
    assert.deepEqual(list.filter((c) => c.kind === "reseller").map((c) => [c.name, c.balance, c.currency]).sort(), [["Ana Panamá", 1300, "USD"], ["Beto Bolivia", 5000, "BOB"], ["Pedro Paraguay", 250, "USD"]]);
  });

  test("cambio de lista con saldo ≠ 0 o con pagos pendientes: rechazado; con saldo 0: permitido", () => {
    const { s, pa, bo, as } = setup();
    s.wallet.adjust(owner, bo.id, 1000, "Bs 10");
    assert.throws(() => s.catalog.updateCustomer(owner, bo.id, { priceGroupId: "lp-usd" }), err("INVALID_STATE", /saldo pasaría a dólares y tiene saldo/));
    s.wallet.adjust(owner, bo.id, -1000, "deja en 0");
    const t = s.orders.requestTopup({ id: "u_bo", role: "reseller", customerId: bo.id }, bo.id, 5000, { fileRef: "q.png", declaredReference: "QR-1" });
    assert.throws(() => s.catalog.updateCustomer(owner, bo.id, { priceGroupId: "lp-usd" }), err("INVALID_STATE", /pagos por revisar/));
    s.orders.rejectPayment(owner, t.id, "no llegó");
    assert.equal(s.catalog.updateCustomer(owner, bo.id, { priceGroupId: "lp-usd" }).priceGroupId, "lp-usd");
    assert.equal(s.usd.currency(bo.id).code, "USD");
    // Y de vuelta a Bs con saldo en dólares: tampoco.
    s.wallet.adjust(owner, pa.id, 100, "US$ 1");
    assert.throws(() => s.catalog.updateCustomer(owner, pa.id, { priceGroupId: "revendedor" }), err("INVALID_STATE", /pasaría a Bs/));
    // Pasar a TODOS a revendedores no le cambia la lista (ni la moneda) al de dólares.
    s.catalog.setCustomersKind(owner, [pa.id], "customer");
    assert.equal(s.engine.s.customers[pa.id].priceGroupId, "lp-usd");
    // La moneda de una lista con saldos no se cambia; "final" y "revendedor" no pueden ser en dólares.
    assert.throws(() => s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "x", prices: {}, currency: "BOB" }), err("INVALID_STATE", /moneda/));
    assert.throws(() => s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "R", prices: {}, currency: "USD" }), err("VALIDATION"));
    assert.throws(() => s.catalog.upsertPriceGroup(owner, { id: "lp-x", name: "x", prices: {}, currency: "EUR" }), err("VALIDATION"));
    // Guardar la lista sin mandar la moneda (como hace el panel viejo) no la pasa a Bs.
    s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Panamá y Paraguay (US$)", prices: { ...USD_PRICES, "hbo-alq": 250 } });
    assert.equal(s.engine.s.priceGroups["lp-usd"].currency, "USD");
    assert.equal(s.catalog.priceFor(as(pa).customerId, "hbo-alq"), 250);
  });

  test("sin tasa: un cliente en dólares no compra ni recarga (mensaje claro); Bolivia sigue igual", () => {
    const { s, pa, bo, as } = setup({ rate: 0 });
    s.wallet.adjust(owner, pa.id, 2000, "recarga");
    s.wallet.adjust(owner, bo.id, 10000, "recarga");
    assert.throws(() => s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }), err("VALIDATION", /todavía no tiene la tasa del dólar/));
    assert.throws(() => topup(s, as(pa), pa.id, 20, "TX"), err("VALIDATION", /todavía no tiene la tasa del dólar/));
    assert.throws(() => s.orders.renew(owner, "x", { paymentMethod: "balance" }));
    assert.equal(s.wallet.balance(pa.id), 2000);
    const ok = s.orders.create(as(bo), { customerId: bo.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" });
    assert.deepEqual([ok.total, ok.usd, s.wallet.balance(bo.id)], [1800, undefined, 8200], "Bolivia: Bs 18 como siempre");
    // Con tasa pero sin USDT activado: compra con saldo sí, pagar/recargar con USDT no.
    s.engine.s.settings.usdt = { enabled: false, rate: 9.85 };
    assert.equal(s.orders.create(as(pa), { customerId: pa.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }).usd, 200);
    assert.throws(() => topup(s, as(pa), pa.id, 20, "TX2"), err("VALIDATION", /no recibe USDT/));
  });

  test("permisos y separación: el revendedor no se cambia de lista ni ve lo de otro", () => {
    const { s, pa, py, as } = setup();
    s.wallet.adjust(owner, py.id, 900, "US$ 9");
    assert.throws(() => s.catalog.updateCustomer(as(pa), pa.id, { priceGroupId: "revendedor" }), err("FORBIDDEN"));
    assert.throws(() => s.catalog.updateCustomer(seller, pa.id, { priceGroupId: "revendedor" }), err("FORBIDDEN"));
    assert.throws(() => s.catalog.upsertPriceGroup(as(pa), { id: "lp-usd", name: "x", prices: { "hbo-alq": 1 } }), err("FORBIDDEN"));
    assert.throws(() => s.catalog.createCustomer(as(pa), { name: "Cli", phone: "+50760000000", priceGroupId: "lp-usd" }), err("FORBIDDEN"));
    assert.throws(() => s.wallet.history(as(pa), py.id), err("FORBIDDEN"));
    assert.throws(() => s.orders.create(as(pa), { customerId: py.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }), err("FORBIDDEN"));
    assert.throws(() => topup(s, as(pa), py.id, 10, "X"), err("FORBIDDEN"));
    assert.equal(s.wallet.balance(py.id), 900);
  });

  test("revendedor en dólares que vende a SU cliente: paga él en US$; su cliente sigue en su lista; Mi control y ganancias en US$", () => {
    const { s, pa, as } = setup();
    s.wallet.adjust(owner, pa.id, 1000, "US$ 10");
    const cli = s.catalog.createCustomer(as(pa), { name: "Cliente de Ana", phone: "+50769999999" });
    s.portal.setPrices(as(pa), { "prime-alq": 500 }); // él le cobra US$ 5
    const o = s.orders.create(as(pa), { customerId: cli.id, items: [{ productId: "prime-alq", qty: 1 }], paymentMethod: "balance" });
    assert.deepEqual([o.payerId, o.usd, o.total, s.wallet.balance(pa.id), s.wallet.balance(cli.id)], [pa.id, 300, 2955, 700, 0]);
    const row = s.rtools.control(as(pa)).find((r) => r.clientId === cli.id);
    assert.deepEqual([row.cost, row.price], [300, 500], "renovar le cuesta US$ 3; le cobra US$ 5");
    const g = s.rtools.earnings(as(pa)).month;
    assert.deepEqual([g.cost, g.revenue, g.profit], [300, 500, 200], "ganancia US$ 2, sin pasar por Bs");
    assert.equal(s.portal.services(as(pa)).find((x) => x.customerId === cli.id).renewPrice, 300);
    const mine = s.portal.orders(as(pa)).find((x) => x.id === o.id);
    assert.deepEqual([mine.total, mine.currency], [300, "USD"]);
    // El dueño lo ve en Bs (lo que le paga hoy por renovarlo).
    assert.equal(s.admin.assignments(owner, { customerId: cli.id })[0].effectivePrice, usdToBs(300, 9.85));
  });

  test("Paraguay con ₲ para SUS clientes: su moneda de compra es US$ y su tipo de cambio es 1 US$ = N ₲", () => {
    const { s, py, as } = setup();
    const v = s.locale.setFor(owner, py.id, { country: "PY", rate: 7300 });
    assert.equal(v.symbol, "₲");
    assert.deepEqual(v.store, { symbol: "US$", decimals: 2 }, "lo que le compra a la tienda va en US$, no en Bs");
    assert.equal(v.foreign, true);
    s.portal.setPrices(as(py), { "hbo-alq": 300 }); // US$ 3 en su lista
    s.wallet.adjust(owner, py.id, 1000, "US$ 10");
    const cli = s.catalog.createCustomer(as(py), { name: "Cliente de Pedro", phone: "0981 555 444" });
    assert.equal(cli.phone, "+595981555444", "su cliente con el código de su país");
    s.orders.create(as(py), { customerId: cli.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" });
    const row = s.rtools.control(as(py)).find((r) => r.clientId === cli.id);
    assert.equal(row.cost, 200, "renovar le cuesta US$ 2 (su moneda de compra)");
    assert.equal(row.price, 2190000, "le cobra US$ 3 × 7.300 = ₲ 21.900 (su moneda)");
    const g = s.rtools.earnings(as(py));
    assert.deepEqual(g.split.store, { symbol: "US$", decimals: 2 }, "\"le pagaste a la tienda\" en US$");
    assert.equal(g.month.cost, 200);
    // Un revendedor en dólares sin país cargado ve todo en US$ (no "foreign").
    const { s: s2, pa } = setup();
    const lv = s2.locale.of(pa.id);
    assert.deepEqual([lv.symbol, lv.foreign, lv.store.symbol], ["US$", false, "US$"]);
  });

  test("conversiones exactas (sin errores de coma flotante)", () => {
    assert.equal(usdToBs(700, 9.85), 6895);
    assert.equal(usdToBs(350, 6.96), 2436);
    assert.equal(usdToBs(1, 0.5), 1, "medio centavo redondea hacia arriba");
    assert.equal(bsToUsd(3000, 9.85, "up"), 305);
    assert.equal(bsToUsd(3000, 9.85, "down"), 304);
    assert.equal(bsToUsd(985, 9.85, "up"), 100);
    assert.equal(bsToUsd(985, 9.85, "down"), 100);
  });
});

test("renovar ya no sale gratis con un método sin pago (antes \"local\" o \"usdt\" renovaban al instante)", () => {
  const { s, bo, as } = setup();
  s.wallet.adjust(owner, bo.id, 10000, "Bs 100");
  const o = s.orders.create(as(bo), { customerId: bo.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" });
  const aid = o.assignmentIds[0], exp0 = s.engine.s.assignments[aid].customerExpiresAt;
  for (const m of ["local", "binance", "otro"]) assert.throws(() => s.orders.renew(as(bo), aid, { paymentMethod: m }), err("VALIDATION", /saldo, QR o USDT/));
  const r = s.orders.renew(as(bo), aid, { paymentMethod: "usdt" });
  assert.equal(r.order.status, "awaiting_payment");
  assert.equal(s.engine.s.assignments[aid].customerExpiresAt, exp0, "no se alarga hasta aprobar el pago");
  assert.deepEqual([r.order.usd, r.order.total, r.order.usdtQuote], [undefined, 1800, { usdt: 1.83, rate: 9.85 }], "Bolivia sigue en Bs");
});

/* ---------------- por la API (servidor real, sin navegador) ---------------- */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-usd-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const ck = lr.headers.get("set-cookie").split(";")[0];
  const call = (cookie) => async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const A = async (m, p, b) => { const r = await call(ck)(m, p, b); if (r.status >= 400) throw new Error(`${p}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  await A("POST", "/api/admin/settings", { usdt: { enabled: true, payId: "123456789", rate: 9.85 } });
  await A("POST", "/api/admin/settings/qr", { contentBase64: PNG.toString("base64") });
  await A("POST", "/api/admin/suppliers", { id: "prov", name: "Prov", active: true });
  for (const [id, name, price] of PRODUCTS) await A("POST", "/api/admin/products", { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  await A("POST", "/api/admin/price-groups", { id: "lp-usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: USD_PRICES });
  const pa = await A("POST", "/api/admin/customers", { name: "Ana Panamá", phone: "+50761234567", kind: "reseller", priceGroupId: "lp-usd" });
  const py = await A("POST", "/api/admin/customers", { name: "Pedro Paraguay", phone: "+595981123456", kind: "reseller", priceGroupId: "lp-usd" });
  const bo = await A("POST", "/api/admin/customers", { name: "Beto Bolivia", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
  const cookieOf = async (phone, id) => {
    const { pin } = await A("POST", `/api/admin/customers/${id}/login-pin`, {});
    const r = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin }) });
    return r.headers.get("set-cookie").split(";")[0];
  };
  return { dir, app, base, ck, A, call, pa, py, bo, cookieOf, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const addAccount = (t, productId, email) => t.A("POST", "/api/admin/accounts", { productId, supplierId: "prov", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });

test("por la API: /api/me trae la moneda, la recarga USDT suma US$ y el revendedor no toca listas", async () => {
  const t = await boot();
  try {
    const R = t.call(await t.cookieOf("+50761234567", t.pa.id));
    const me = (await R("GET", "/api/me")).body;
    assert.deepEqual(me.currency, { code: "USD", symbol: "US$", decimals: 2, rate: 9.85 });
    const cat = (await R("GET", "/api/catalog")).body;
    assert.deepEqual(Object.fromEntries(cat.map((p) => [p.id, p.price])), USD_PRICES);
    const tp = await R("POST", "/api/me/topups", { amount: 0, usdtAmount: 20, method: "usdt", contentBase64: PNG.toString("base64"), declaredReference: "0xabc" });
    assert.equal(tp.status, 200, JSON.stringify(tp.body));
    assert.deepEqual([tp.body.usd, tp.body.total], [2000, 19700]);
    const qr = await R("POST", "/api/me/topups", { amount: 10000, method: "qr", contentBase64: PNG.toString("base64"), declaredReference: "QR-9" });
    assert.equal(qr.status, 400, "con saldo en dólares no recarga por QR");
    const list = await t.A("GET", "/api/admin/orders?status=payment_review");
    const row = list.find((o) => o.id === tp.body.id);
    assert.deepEqual([row.usd, row.total, row.usdtQuote], [2000, 19700, { usdt: 20, rate: 9.85 }], "Aprobar pagos tiene US$ y Bs");
    await t.A("POST", `/api/admin/orders/${tp.body.id}/approve`, { confirmedReference: "0xabc" });
    await addAccount(t, "disney-espn-alq", "de@x.lat");
    const ok = await R("POST", "/api/orders", { items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "balance" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await R("GET", "/api/me")).body.balance, 1300, "US$ 13");
    const led = (await R("GET", "/api/me/ledger")).body;
    assert.deepEqual(led.map((l) => [l.amount, l.cur]), [[2000, "USD"], [-700, "USD"]]);
    const mo = (await R("GET", "/api/me/orders")).body.find((o) => o.id === ok.body.id);
    assert.deepEqual([mo.total, mo.currency], [700, "USD"]);
    // Permisos: nada del panel para el revendedor.
    for (const [m, p, b] of [["GET", "/api/admin/price-groups"], ["POST", "/api/admin/price-groups", { id: "lp-usd", name: "x", prices: {} }], ["POST", `/api/admin/customers/${t.pa.id}`, { priceGroupId: "revendedor" }], ["GET", `/api/admin/customers/${t.py.id}/ledger`], ["POST", `/api/admin/customers/${t.pa.id}/adjust`, { amount: 100000, reason: "yo" }]]) {
      const r = await R(m, p, b);
      assert.ok(r.status === 401 || r.status === 403, `${m} ${p} → ${r.status}`);
    }
    assert.equal((await R("GET", "/api/me")).body.balance, 1300);
    const other = await R("POST", "/api/orders", { customerId: t.py.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" });
    assert.equal(other.status, 403, "no compra a nombre de otro revendedor");
    // Dueño: cambiar de lista con saldo → rechazado con mensaje claro.
    const ch = await t.call(t.ck)("POST", `/api/admin/customers/${t.pa.id}`, { kind: "reseller", priceGroupId: "revendedor" });
    assert.equal(ch.status, 409, JSON.stringify(ch.body));
    assert.match(ch.body.message, /tiene saldo/);
    // Dashboard en Bs sin mezclar.
    const d = await t.A("GET", "/api/admin/dashboard?days=30");
    assert.deepEqual([d.kpi.revenue, d.kpi.balancesOwedUsd, d.kpi.balancesOwed], [6895, 1300, usdToBs(1300, 9.85)]);
    const sheet = await t.A("GET", `/api/admin/resellers/${t.pa.id}/sheet`);
    assert.deepEqual([sheet.balance, sheet.currency], [1300, "USD"]);
    // Bolivia: igual que siempre.
    const B = t.call(await t.cookieOf("+59171234567", t.bo.id));
    assert.equal((await B("GET", "/api/me")).body.currency.code, "BOB");
    assert.equal((await B("GET", "/api/catalog")).body.find((p) => p.id === "netflix-alq").price, 9000);
  } finally { await t.close(); }
});

test("en el navegador: revendedor en dólares a 360 y 390 px ve US$, recarga en USDT y sin QR; Bolivia sin cambios", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const t = await boot();
  const browser = await chromium.launch();
  const errors = [];
  try {
    // Saldo de US$ 13 (recarga de 20 y compra de Disney + ESPN).
    await addAccount(t, "disney-espn-alq", "de@x.lat");
    await t.A("POST", `/api/admin/customers/${t.pa.id}/adjust`, { amount: 2000, reason: "20 USDT" });
    const ckPa = await t.cookieOf("+50761234567", t.pa.id);
    assert.equal((await t.call(ckPa)("POST", "/api/orders", { items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "balance" })).status, 200);
    const ctxFor = async (cookie, width, colorScheme = "light") => {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, colorScheme });
      const [name, value] = cookie.split("="); await ctx.addCookies([{ name, value, url: t.base }]);
      return ctx;
    };
    const shots = process.env.GS_SHOTS;
    for (const [width, scheme] of [[360, "light"], [390, "dark"]]) {
      const c = await ctxFor(ckPa, width, scheme);
      const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(t.base + "/hub#recargas"); await p.locator("#topup").waitFor();
      assert.equal(await p.locator('#topup input[name="tm"][value="qr"]').count(), 0, "sin QR de Bolivia");
      assert.equal(await p.locator("#tmQr").isHidden(), true);
      assert.match(await p.locator("#tmUsdt").innerText(), /Enviá 20 USDT/);
      assert.match(await p.locator("#tmUsdt").innerText(), /1 USDT = US\$ 1/);
      assert.match(await p.locator("#topup .packs").innerText(), /\+ US\$ 20 de saldo/);
      assert.doesNotMatch(await p.locator("#topup .packs").innerText(), /Bs/);
      assert.match(await p.locator("#sout").innerText(), /US\$ 13/, "su saldo en US$");
      assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `sin desborde a ${width}px`);
      if (shots) await p.screenshot({ path: join(shots, `usd-recargas-${width}.png`), fullPage: true });
      await p.goto(t.base + "/hub#precios"); await p.waitForTimeout(700);
      const grid = await p.locator(".pgrid").innerText();
      assert.match(grid, /US\$ 7/); assert.match(grid, /US\$ 3,5/); assert.match(grid, /US\$ 2/);
      assert.doesNotMatch(grid, /Bs|≈|Netflix/, "sin Bs, sin conversión y sin productos fuera de su lista");
      assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
      if (shots) await p.screenshot({ path: join(shots, `usd-precios-${width}.png`), fullPage: true });
      await c.close();
    }
    // Bolivia: QR primero y precios en Bs, como antes.
    const cb = await ctxFor(await t.cookieOf("+59171234567", t.bo.id), 360);
    const q = await cb.newPage(); q.on("pageerror", (e) => errors.push(e.message));
    await q.goto(t.base + "/hub#recargas"); await q.locator("#topup").waitFor();
    assert.ok(await q.locator('#topup input[name="tm"][value="qr"]').isChecked());
    assert.match(await q.locator("#topup .packs").innerText(), /Bs 100/);
    await q.goto(t.base + "/hub#precios"); await q.waitForTimeout(700);
    assert.match(await q.locator(".pgrid").innerText(), /Bs 70/);
    // Dueño: Aprobar pagos muestra "US$ 20,00 (≈ Bs 197)" y Clientes el saldo en US$.
    await t.call(ckPa)("POST", "/api/me/topups", { amount: 0, usdtAmount: 20, method: "usdt", contentBase64: PNG.toString("base64"), declaredReference: "0xfeed" });
    const co = await ctxFor(t.ck, 390);
    const po = await co.newPage(); po.on("pageerror", (e) => errors.push(e.message));
    await po.goto(t.base + "/panel.html#aprobacion"); await po.waitForTimeout(900);
    assert.match(await po.locator("main").innerText(), /US\$ 20,00\s*\(≈ Bs 197\)/);
    if (shots) await po.screenshot({ path: join(shots, "usd-aprobar-390.png"), fullPage: true });
    await po.goto(t.base + "/panel.html#clientes"); await po.reload(); await po.waitForTimeout(900);
    assert.match(await po.locator("main").textContent(), /Saldo a favorUS\$ 13,00/, "en la ficha del cliente (desplegable)");
    assert.ok(!(await po.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await t.close(); }
});
