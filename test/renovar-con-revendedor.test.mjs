// El cliente de un revendedor renueva con SU revendedor (decisión del dueño): en la tienda no ve el precio
// de la tienda ni puede renovar directo; el revendedor sí le renueva desde su panel. Clientes directos: igual que antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, DAY } from "../dist/store/index.js";

const owner = { id: "u_owner", role: "owner" };
const T0 = Date.UTC(2026, 10, 11, 15);

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "dis", supplierId: "prov", email: "d@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 120 * DAY, cost: 1500, profiles: [1, 2, 3, 4].map((n) => ({ label: `Perfil ${n}` })) });
  const rev = s.catalog.createCustomer(owner, { name: "Rosa Rev", phone: "+59171111111", kind: "reseller" });
  const asR = { id: "u_rev", role: "reseller", customerId: rev.id };
  s.wallet.adjust(owner, rev.id, 20000, "saldo de prueba");
  const cli = s.catalog.createCustomer(asR, { name: "Ana Cliente", phone: "70000001" });
  const a1 = s.orders.create(asR, { customerId: cli.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0];
  const direct = s.catalog.createCustomer(owner, { name: "Directo", phone: "+59170000002" });
  s.wallet.adjust(owner, direct.id, 20000, "saldo de prueba");
  const asD = { id: "u_dir", role: "customer", customerId: direct.id };
  const a2 = s.orders.create(asD, { customerId: direct.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0];
  return { s, rev, asR, cli, asC: { id: "u_cli", role: "customer", customerId: cli.id }, a1, asD, a2 };
}

test("el cliente de un revendedor no renueva directo: se le muestra su revendedor y no el precio de la tienda", () => {
  const { s, asC, a1 } = setup();
  assert.throws(() => s.orders.renew(asC, a1, { paymentMethod: "balance" }), (e) => e.code === "FORBIDDEN" && /Rosa Rev/.test(e.message));
  const svc = s.portal.services(asC).find((x) => x.assignmentId === a1);
  assert.deepEqual(svc.viaReseller, { name: "Rosa Rev", whatsapp: "59171111111", page: null });
  assert.equal(svc.renewPrice, null, "no ve el precio de la tienda");
});

test("su revendedor sí le renueva desde su panel, y un cliente directo renueva como siempre", () => {
  const { s, asR, a1, asD, a2 } = setup();
  assert.ok(s.orders.renew(asR, a1, { paymentMethod: "balance" }).assignment.customerExpiresAt > T0 + 30 * DAY);
  const mine = s.portal.services(asR).find((x) => x.assignmentId === a1);
  assert.equal(mine.viaReseller, undefined, "el revendedor ve el servicio de su cliente con su botón de renovar");
  assert.ok(s.orders.renew(asD, a2, { paymentMethod: "balance" }).assignment.customerExpiresAt > T0 + 30 * DAY);
  assert.equal(s.portal.services(asD)[0].viaReseller, undefined);
});
