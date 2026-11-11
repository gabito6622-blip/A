// "🧪 Era una prueba": una venta que hizo el dueño para probar sale de los números, libera los perfiles
// sin cuarentena, devuelve el saldo si se pagó con saldo, y no le avisa a nadie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const owner = { id: "u_owner", role: "owner" };
const seller = { id: "u_seller", role: "seller" };
const T0 = Date.UTC(2026, 10, 5, 16);

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ sin ESPN", kind: "profile", durationDays: 30, price: 1700, published: true });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "dis", supplierId: "prov", email: "d@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 1500, profiles: [1, 2, 3, 4].map((n) => ({ label: `Perfil ${n}` })) });
  const gabo = s.catalog.createCustomer(owner, { name: "gabo", phone: "+59170000001" });
  const real = s.catalog.createCustomer(owner, { name: "Cliente Real", phone: "+59170000002" });
  return { s, clock, gabo, real };
}

test("marca la venta como prueba: perfiles libres sin cuarentena, fuera de los números, sin avisos", () => {
  const { s, clock, gabo, real } = setup();
  const prueba = s.orders.create(owner, { customerId: gabo.id, items: [{ productId: "dis", qty: 2 }], paymentMethod: "cash" });
  const venta = s.orders.create(owner, { customerId: real.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
  clock.t += 2 * DAY;
  s.orders.renew(owner, prueba.assignmentIds[0], { paymentMethod: "cash" }); // también era prueba
  const before = s.finance.report(owner, 1).current.ingresos;
  const outbox0 = s.engine.s.outbox.length;

  const r = s.orders.markTest(owner, prueba.assignmentIds[1]);
  assert.equal(r.services, 2, "toda la venta, aunque se marque desde uno de sus servicios");
  assert.equal(r.closed, 2);
  assert.equal(r.renewals, 1);
  assert.equal(r.total, 1700 * 2 + 1700);
  const E = s.engine.s;
  for (const id of prueba.assignmentIds) {
    assert.equal(E.assignments[id].status, "revoked");
    assert.equal(E.slots[E.assignments[id].slotId].status, "available", "vuelve libre, sin cuarentena");
  }
  assert.equal(E.assignments[venta.assignmentIds[0]].status, "active", "la venta real no se toca");
  assert.equal(s.inventory.stock().dis.available, 3);
  assert.equal(E.outbox.length, outbox0, "no se manda ningún aviso");
  const after = s.finance.report(owner, 1).current.ingresos;
  assert.equal(before - after, 1700 * 3, "sale de Finanzas: la venta de prueba y su renovación");
  assert.throws(() => s.orders.markTest(owner, prueba.assignmentIds[0]), /ya está marcada como prueba/);
});

test("si se pagó con saldo, el saldo vuelve", () => {
  const { s, gabo } = setup();
  s.wallet.adjust(owner, gabo.id, 5000, "carga para probar");
  const o = s.orders.create(owner, { customerId: gabo.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "balance" });
  assert.equal(s.wallet.balance(gabo.id), 5000 - 1700);
  const r = s.orders.markTest(owner, o.assignmentIds[0]);
  assert.equal(r.refunded, 1700);
  assert.equal(s.wallet.balance(gabo.id), 5000);
});

test("solo dueño o admin; Atención no puede", () => {
  const { s, gabo } = setup();
  const o = s.orders.create(owner, { customerId: gabo.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
  assert.throws(() => s.orders.markTest(seller, o.assignmentIds[0]), (e) => e.code === "FORBIDDEN");
  assert.equal(s.orders.markTest({ id: "u_admin", role: "admin" }, o.assignmentIds[0]).closed, 1);
});

test("por HTTP: dueño 200, revendedor y cliente sin acceso", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-prueba-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const ck = lr.headers.get("set-cookie").split(";")[0];
    const A = (m, p, b, cookie = ck) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie }, body: b ? JSON.stringify(b) : undefined });
    await A("POST", "/api/admin/products", { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 1700, published: true });
    await A("POST", "/api/admin/suppliers", { id: "prov", name: "Prov", active: true });
    await A("POST", "/api/admin/accounts", { productId: "dis", supplierId: "prov", email: "d@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1500, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }] });
    const rev = await (await A("POST", "/api/admin/customers", { name: "Rev", phone: "+59177700011", kind: "reseller" })).json();
    const o = await (await A("POST", "/api/admin/orders", { customerId: rev.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" })).json();
    const { pin } = await (await A("POST", `/api/admin/customers/${rev.id}/login-pin`, {})).json();
    const li = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "77700011", pin }) });
    const rck = li.headers.get("set-cookie").split(";")[0];
    assert.ok([401, 403].includes((await A("POST", `/api/admin/assignments/${o.assignmentIds[0]}/test`, {}, rck)).status), "un revendedor no puede");
    const ok = await A("POST", `/api/admin/assignments/${o.assignmentIds[0]}/test`, {});
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).closed, 1);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
