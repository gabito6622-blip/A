// Cupones de descuento: reglas, conteo de usos, carrito, venta manual y API.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const owner = { id: "u_owner", role: "owner" };
const seller = { id: "u_seller", role: "seller" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", kind: "profile", durationDays: 30, price: 2000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, disney: 1500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  for (const [pid, n] of [["netflix", 1], ["netflix", 2], ["disney", 3]])
    s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}${n}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 100,
      profiles: [1, 2, 3, 4].map((i) => ({ label: `Perfil ${i}` })) });
  const maria = s.catalog.createCustomer(seller, { name: "María", phone: "+591 70011223" });
  const luis = s.catalog.createCustomer(seller, { name: "Luis", phone: "+591 78889900" });
  const carla = s.catalog.createCustomer(owner, { name: "Carla", phone: "+591 69990011", kind: "reseller", priceGroupId: "revendedor" });
  const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });
  return { s, clock, maria, luis, carla, as };
}
const buy = (s, actor, cust, couponCode, items = [{ productId: "netflix", qty: 1 }], paymentMethod = "qr") =>
  s.orders.create(actor, { customerId: cust.id, items, paymentMethod, couponCode });

describe("cupones (núcleo)", () => {
  test("el dueño crea un cupón; el código se normaliza y no se repite", () => {
    const { s } = setup();
    const c = s.coupons.save(owner, { code: " verano10 ", type: "percent", value: 10 });
    assert.equal(c.code, "VERANO10");
    assert.equal(c.resellers, false, "por defecto es solo para clientes");
    assert.throws(() => s.coupons.save(owner, { code: "VERANO10", type: "fixed", value: 500 }), err("VALIDATION", /Ya hay/));
    assert.throws(() => s.coupons.save(owner, { code: "x", type: "percent", value: 10 }), err("VALIDATION"));
    assert.throws(() => s.coupons.save(owner, { code: "MUCHO", type: "percent", value: 95 }), err("VALIDATION"));
    assert.throws(() => s.coupons.save(seller, { code: "VENDE", type: "percent", value: 5 }), err("FORBIDDEN"), "el vendedor no crea cupones");
    const log = s.engine.s.audit.filter((a) => a.action === "coupon.create");
    assert.equal(log.length, 1);
  });

  test("porcentaje y monto fijo se restan del total y quedan guardados en el pedido", () => {
    const { s, maria, luis, as } = setup();
    s.coupons.save(owner, { code: "DIEZ", type: "percent", value: 10 });
    s.coupons.save(owner, { code: "MENOS5", type: "fixed", value: 500 });
    const o1 = buy(s, as(maria), maria, "diez");
    assert.equal(o1.total, 3150);
    assert.deepEqual({ code: o1.coupon.code, amount: o1.coupon.amount }, { code: "DIEZ", amount: 350 });
    const o2 = buy(s, as(luis), luis, "MENOS5");
    assert.equal(o2.total, 3000);
    const a = s.engine.s.audit.find((x) => x.action === "order.create" && x.entityId === o1.id);
    assert.equal(a.data.coupon, "DIEZ");
  });

  test("vencido, pausado, sin usos o ya usado por el cliente: no aplica y no crea el pedido", () => {
    const { s, clock, maria, luis, as } = setup();
    s.coupons.save(owner, { code: "UNAVEZ", type: "percent", value: 20, maxUses: 1 });
    s.coupons.save(owner, { code: "PORCLIENTE", type: "percent", value: 20, perCustomer: 1 });
    s.coupons.save(owner, { code: "VENCE", type: "percent", value: 20, expiresAt: T0 + DAY });
    const p = s.coupons.save(owner, { code: "PAUSA", type: "percent", value: 20 });
    s.coupons.save(owner, { ...p, active: false });
    buy(s, as(maria), maria, "UNAVEZ");
    const n = Object.keys(s.engine.s.orders).length;
    assert.throws(() => buy(s, as(luis), luis, "UNAVEZ"), err("VALIDATION", /todas las veces/));
    assert.equal(Object.keys(s.engine.s.orders).length, n, "no queda pedido a medias");
    buy(s, as(maria), maria, "PORCLIENTE");
    assert.throws(() => buy(s, as(maria), maria, "PORCLIENTE"), err("VALIDATION", /Ya usaste/));
    buy(s, as(luis), luis, "PORCLIENTE");
    assert.throws(() => buy(s, as(luis), luis, "PAUSA"), err("VALIDATION", /no existe o ya no está activo/));
    assert.throws(() => buy(s, as(luis), luis, "NOEXISTE"), err("VALIDATION"));
    clock.t += 2 * DAY;
    assert.throws(() => buy(s, as(luis), luis, "VENCE"), err("VALIDATION", /venció/));
  });

  test("si el pedido se cancela, el uso vuelve", () => {
    const { s, maria, luis, as } = setup();
    s.coupons.save(owner, { code: "UNAVEZ", type: "percent", value: 20, maxUses: 1 });
    const o = buy(s, as(maria), maria, "UNAVEZ");
    assert.equal(s.coupons.list(owner)[0].state, "used_up");
    s.orders.cancel(as(maria), o.id);
    assert.equal(s.coupons.list(owner)[0].uses, 0);
    assert.equal(buy(s, as(luis), luis, "UNAVEZ").coupon.code, "UNAVEZ");
  });

  test("revendedores solo si el dueño lo permite", () => {
    const { s, carla, as } = setup();
    s.wallet?.adjust?.(owner, carla.id, 100000, "carga");
    s.coupons.save(owner, { code: "CLIENTES", type: "percent", value: 10 });
    s.coupons.save(owner, { code: "REVE", type: "percent", value: 10, resellers: true });
    assert.throws(() => buy(s, as(carla), carla, "CLIENTES"), err("VALIDATION", /solo para clientes/));
    assert.equal(buy(s, as(carla), carla, "REVE").total, 2250);
  });

  test("compra mínima, productos elegidos y nunca deja el total en cero", () => {
    const { s, maria, luis, as } = setup();
    s.coupons.save(owner, { code: "MIN50", type: "fixed", value: 500, minTotal: 5000 });
    assert.throws(() => buy(s, as(maria), maria, "MIN50"), err("VALIDATION", /compra mínima/));
    s.coupons.save(owner, { code: "DISNEY", type: "percent", value: 50, productIds: ["disney"] });
    assert.throws(() => buy(s, as(maria), maria, "DISNEY"), err("VALIDATION", /no aplica/));
    s.coupons.save(owner, { code: "GRATIS", type: "fixed", value: 999999 });
    assert.equal(buy(s, as(luis), luis, "GRATIS").total, 100, "siempre queda algo a pagar");
  });

  test("se suma al descuento de Armá tu combo, calculado sobre lo que queda", () => {
    const { s, maria, as } = setup();
    s.engine.s.settings.comboDiscounts = [500, 800, 1000];
    s.coupons.save(owner, { code: "DIEZ", type: "percent", value: 10 });
    const items = [{ productId: "netflix", qty: 1 }, { productId: "disney", qty: 1 }];
    const q = s.orders.quote(as(maria), { customerId: maria.id, items, couponCode: "DIEZ", channel: "store" });
    assert.deepEqual([q.gross, q.discount, q.coupon.amount, q.total], [5500, 500, 500, 4500]);
    const o = s.orders.create(as(maria), { customerId: maria.id, items, paymentMethod: "qr", couponCode: "DIEZ" });
    assert.equal(o.total, 4500);
  });

  test("el presupuesto explica por qué no aplica sin cortar", () => {
    const { s, maria, as } = setup();
    const q = s.orders.quote(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], couponCode: "NADA" });
    assert.equal(q.coupon, null);
    assert.match(q.couponError, /no existe/);
    assert.equal(q.total, 3500);
  });

  test("venta manual del panel con cupón", () => {
    const { s, maria } = setup();
    s.coupons.save(owner, { code: "AMIGO", type: "fixed", value: 1000 });
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash", couponCode: "AMIGO" });
    assert.equal(o.status, "fulfilled");
    assert.equal(o.total, 2500);
  });
});

describe("cupones (API)", () => {
  let dir, app, base, ownerCk;
  const call = async (method, path, body, cookie) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-cup-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    ownerCk = lr.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("crear, listar, presupuestar y borrar", async () => {
    await call("POST", "/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, ownerCk);
    const cust = (await call("POST", "/api/admin/customers", { name: "María", phone: "+591 70011223" }, ownerCk)).json;
    const c = await call("POST", "/api/admin/coupons", { code: "hola20", type: "percent", value: 20 }, ownerCk);
    assert.equal(c.status, 200);
    assert.equal(c.json.code, "HOLA20");
    const list = await call("GET", "/api/admin/coupons", undefined, ownerCk);
    assert.equal(list.json[0].state, "active");
    const q = await call("POST", "/api/admin/orders/quote", { customerId: cust.id, items: [{ productId: "nf", qty: 1 }], couponCode: "HOLA20" }, ownerCk);
    assert.equal(q.json.total, 2800);
    assert.equal((await call("GET", "/api/admin/coupons")).status, 401, "sin sesión no se ven");
    assert.equal((await call("POST", `/api/admin/coupons/${c.json.id}/delete`, {}, ownerCk)).status, 200);
    assert.equal((await call("GET", "/api/admin/coupons", undefined, ownerCk)).json.length, 0);
  });
});
