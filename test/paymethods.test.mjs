// Cobro por país: cada cliente ve los métodos de su lista de precios, paga con comprobante y una persona aprueba.
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
  const s = createStore({ clock: { t: T0, now() { return this.t; } } });
  s.catalog.upsertProduct(owner, { id: "flujo", name: "Flujo TV", kind: "profile", durationDays: 30, price: 290, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "panama", name: "Panamá", prices: { flujo: 290 } });
  s.catalog.upsertPriceGroup(owner, { id: "paraguay", name: "Paraguay", prices: { flujo: 250 } });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Panel", active: true });
  s.inventory.addAccount(owner, { productId: "flujo", supplierId: "p", email: "f1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 1, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
  const ana = s.catalog.createCustomer(seller, { name: "Ana (Panamá)", phone: "+507 61234567", priceGroupId: "panama" });
  const pedro = s.catalog.createCustomer(seller, { name: "Pedro (Paraguay)", phone: "+595 981123456", priceGroupId: "paraguay" });
  const bo = s.catalog.createCustomer(seller, { name: "Beto (Bolivia)", phone: "+591 70011223" });
  const as = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });
  const yappy = s.payMethods.save(owner, { name: "Yappy", country: "Panamá", account: "6123-4567", holder: "Gabriel", priceGroupIds: ["panama"], replacesQr: true });
  const tigo = s.payMethods.save(owner, { name: "Tigo Money", country: "Paraguay", account: "0981 123 456", priceGroupIds: ["paraguay"] });
  s.engine.s.settings.qrFileRef = "qr-bolivia.png"; // la tienda cargó su QR (sin QR no se ofrece "pagar con QR")
  return { s, ana, pedro, bo, as, yappy, tigo };
}

describe("cobro por país (núcleo)", () => {
  test("cada cliente ve solo los métodos de su país", () => {
    const { s, ana, pedro, bo, as } = setup();
    const a = s.payMethods.mine(as(ana)), p = s.payMethods.mine(as(pedro)), b = s.payMethods.mine(as(bo));
    assert.deepEqual(a.methods.map((m) => m.name), ["Yappy"]);
    assert.equal(a.qr, false, "Yappy reemplaza el QR de Bolivia");
    assert.deepEqual(p.methods.map((m) => m.name), ["Tigo Money"]);
    assert.equal(p.qr, true);
    assert.deepEqual(b.methods, []);
    assert.equal(b.qr, true);
  });

  test("pagar con Yappy: comprobante → revisión → aprobado y entregado", () => {
    const { s, ana, as, yappy } = setup();
    const o = s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "local", localMethodId: yappy.id });
    assert.equal(o.status, "awaiting_payment");
    assert.deepEqual(o.localPay, { id: yappy.id, name: "Yappy" });
    assert.equal(o.total, 290);
    const r = s.orders.submitEvidence(as(ana), o.id, { fileRef: "a.png", declaredReference: "YP-123" });
    assert.equal(r.status, "payment_review");
    const ok = s.orders.approvePayment(owner, o.id, { confirmedReference: "YP-123" });
    assert.equal(ok.status, "fulfilled");
    const a = s.engine.s.audit.find((x) => x.action === "order.create" && x.entityId === o.id);
    assert.equal(a.data.via, "Yappy");
  });

  test("no se puede usar el método de otro país ni el QR cuando está reemplazado", () => {
    const { s, ana, pedro, as, yappy, tigo } = setup();
    assert.throws(() => s.orders.create(as(pedro), { customerId: pedro.id, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "local", localMethodId: yappy.id }), err("VALIDATION", /no está disponible/));
    assert.throws(() => s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "qr" }), err("VALIDATION", /otro método/));
    assert.equal(s.orders.create(as(pedro), { customerId: pedro.id, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "qr" }).status, "awaiting_payment", "Paraguay conserva el QR");
    s.payMethods.save(owner, { ...tigo, enabled: false });
    assert.throws(() => s.orders.create(as(pedro), { customerId: pedro.id, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "local", localMethodId: tigo.id }), err("VALIDATION"));
  });

  test("solo dueño/admin los configuran; se validan los datos y queda en auditoría", () => {
    const { s } = setup();
    assert.throws(() => s.payMethods.save(seller, { name: "X", account: "1" }), err("FORBIDDEN"));
    assert.throws(() => s.payMethods.save(owner, { name: "Giros", account: "" }), err("VALIDATION"));
    assert.throws(() => s.payMethods.save(owner, { name: "Giros", account: "1", priceGroupIds: ["marte"] }), err("VALIDATION"));
    assert.throws(() => s.payMethods.save(owner, { name: "yappy", country: "panamá", account: "1" }), err("VALIDATION", /Ya tenés/), "no se repite el mismo método en el mismo país");
    const g = s.payMethods.save(owner, { name: "Giros Tigo", account: "0981", instructions: "Mandá la foto del recibo" });
    assert.equal(s.payMethods.mine({ id: "x", role: "customer", customerId: Object.keys(s.engine.s.customers)[2] }).methods.some((m) => m.id === g.id), true, "sin listas = todos");
    assert.deepEqual(s.payMethods.remove(owner, g.id), {});
    assert.ok(s.engine.s.audit.some((a) => a.action === "paymethod.delete"));
  });
});

describe("cobro por país (API)", () => {
  let dir, app, base, ownerCk;
  const call = async (method, path, body, cookie = ownerCk) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j, type: r.headers.get("content-type") };
  };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-pm-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    ownerCk = lr.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("crear, subir QR, ver como cliente y borrar", async () => {
    const st = app.store, sys = { id: "t", role: "owner" };
    st.engine.s.settings.qrFileRef = "qr-bolivia.png";
    st.catalog.upsertPriceGroup(sys, { id: "panama", name: "Panamá", prices: {} });
    const m = await call("POST", "/api/admin/paymethods", { name: "Yappy", account: "6123-4567", priceGroupIds: ["panama"], replacesQr: true });
    assert.equal(m.status, 200);
    assert.equal(m.json.hasQr, false);
    const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
    assert.equal((await call("POST", `/api/admin/paymethods/${m.json.id}/qr`, { contentBase64: PNG })).status, 200);
    assert.equal((await call("POST", `/api/admin/paymethods/${m.json.id}/qr`, { contentBase64: Buffer.from("%PDF-1.4").toString("base64") })).status, 400);
    const list = await call("GET", "/api/admin/paymethods");
    assert.equal(list.json[0].hasQr, true);
    assert.equal(list.json[0].qrFileRef, undefined, "el nombre del archivo no sale");
    assert.equal((await call("GET", `/api/admin/paymethods/${m.json.id}/qr`)).type, "image/png");
    // Cliente de Panamá
    const ana = st.catalog.createCustomer(sys, { name: "Ana", phone: "+507 61234567", priceGroupId: "panama" });
    const link = (await call("POST", `/api/admin/customers/${ana.id}/login-link`, {})).json.url;
    const r = await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link.split("#acceso=")[1] }) });
    const anaCk = r.headers.get("set-cookie").split(";")[0];
    const mine = await call("GET", "/api/me/paymethods", undefined, anaCk);
    assert.deepEqual({ qr: mine.json.qr, names: mine.json.methods.map((x) => x.name), hasQr: mine.json.methods[0].hasQr }, { qr: false, names: ["Yappy"], hasQr: true });
    assert.equal((await call("GET", `/api/paymethods/${m.json.id}/qr`, undefined, anaCk)).type, "image/png");
    assert.equal((await call("GET", "/api/me/paymethods", undefined, "")).status, 401);
    assert.equal((await call("POST", `/api/admin/paymethods/${m.json.id}/delete`, {})).status, 200);
    assert.deepEqual((await call("GET", "/api/me/paymethods", undefined, anaCk)).json, { qr: true, methods: [] });
  });
});

describe("cobro: sin QR cargado no se ofrece pagar con QR", () => {
  test("la tienda sin QR no ofrece QR (el cliente no queda pagando algo imposible)", () => {
    const { s, bo, as } = setup();
    delete s.engine.s.settings.qrFileRef;
    assert.equal(s.payMethods.mine(as(bo)).qr, false);
  });
});
