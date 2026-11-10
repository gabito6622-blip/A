// Pago en USDT manual (plan B sin API): el cliente manda a la dirección y sube el comprobante; el dueño aprueba.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");

describe("USDT manual", () => {
  let dir, app, base, owner, custCookie, clock, orderId;
  const call = async (method, path, body, cookie) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  const loginOwner = async () => { const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) }); return r.headers.get("set-cookie").split(";")[0]; };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-usdt-"));
    clock = { t: Date.now(), now() { return this.t; } };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await loginOwner();
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: clock.now() + 90 * 864e5, cost: 0, profiles: [{ label: "Perfil 1", pin: "4321" }] }, owner);
    const maria = await call("POST", "/api/admin/customers", { name: "María", phone: "+591 70011223" }, owner);
    await call("POST", `/api/admin/customers/${maria.json.id}/login-pin`, { pin: "2468" }, owner);
    const lr = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+591 70011223", pin: "2468" }) });
    custCookie = lr.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("sin configurar, la tienda no ofrece USDT manual", async () => {
    assert.equal((await call("GET", "/api/settings")).json.usdt, null);
  });

  test("no se activa sin dirección/Pay ID ni tasa", async () => {
    assert.equal((await call("POST", "/api/admin/settings", { usdt: { enabled: true } }, owner)).status, 400);
    assert.equal((await call("POST", "/api/admin/settings", { usdt: { enabled: true, address: "TAbc123", rate: 0 } }, owner)).status, 400);
  });

  test("el dueño lo configura y la tienda lo ofrece con la dirección y la tasa", async () => {
    assert.equal((await call("POST", "/api/admin/settings", { usdt: { enabled: true, address: "TAbcWallet123", network: "TRC20", rate: 13, note: "Solo TRC20" } }, owner)).status, 200);
    const s = (await call("GET", "/api/settings")).json;
    assert.ok(s.usdt);
    assert.equal(s.usdt.address, "TAbcWallet123");
    assert.equal(s.usdt.network, "TRC20");
    assert.equal(s.usdt.rate, 13);
    const admin = (await call("GET", "/api/admin/usdt", undefined, owner)).json;
    assert.equal(admin.enabled, true);
    assert.equal(admin.address, "TAbcWallet123");
  });

  test("el cliente paga con USDT, sube el comprobante y queda en revisión", async () => {
    const o = await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "usdt" }, custCookie);
    assert.equal(o.status, 200);
    orderId = o.json.id;
    assert.equal(o.json.status, "awaiting_payment");
    const ev = await call("POST", `/api/orders/${orderId}/evidence`, { contentBase64: PNG, declaredReference: "0xHASH-USDT-1" }, custCookie);
    assert.equal(ev.status, 200);
    assert.equal(ev.json.status, "payment_review");
  });

  test("el dueño aprueba y el pedido se entrega; el hash no se puede reusar", async () => {
    const ap = await call("POST", `/api/admin/orders/${orderId}/approve`, { confirmedReference: "0xHASH-USDT-1" }, owner);
    assert.equal(ap.status, 200);
    assert.equal(ap.json.status, "fulfilled");
    assert.equal(ap.json.assignmentIds.length, 1);
    // Otra venta con el mismo hash no se puede aprobar (referencia única).
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf2@x.lat", password: "Secreta#99", supplierExpiresAt: clock.now() + 90 * 864e5, cost: 0, profiles: [{ label: "P1" }] }, owner);
    const o2 = await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "usdt" }, custCookie);
    await call("POST", `/api/orders/${o2.json.id}/evidence`, { contentBase64: PNG, declaredReference: "0xHASH-USDT-1" }, custCookie);
    const dup = await call("POST", `/api/admin/orders/${o2.json.id}/approve`, { confirmedReference: "0xHASH-USDT-1" }, owner);
    assert.equal(dup.status, 409, "el mismo hash no se reusa");
  });
});
