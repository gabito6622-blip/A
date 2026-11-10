// Ganancia real: el pago de cada cuenta entra a Finanzas, el botón "Pagué la renovación" corre la fecha
// y el margen por producto avisa cuando una venta deja poco o nada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError, DAY } from "../dist/store/index.js";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const owner = { id: "u_owner", role: "owner" };
const seller = { id: "u_seller", role: "seller" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nfc", name: "Netflix completa", kind: "full_account", durationDays: 30, price: 7000, published: true });
  s.catalog.upsertProduct(owner, { id: "nfp", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { nfc: 6700, nfp: 1800 } });
  s.catalog.upsertSupplier(owner, { id: "tarjeta", name: "Mi tarjeta", active: true });
  const full = s.inventory.addAccount(owner, { productId: "nfc", supplierId: "tarjeta", email: "full@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 10 * DAY, cost: 6600, profiles: [{ label: "Cuenta completa" }] });
  const prof = s.inventory.addAccount(owner, { productId: "nfp", supplierId: "tarjeta", email: "perf@x.lat", password: "Clave-Larga#2", supplierExpiresAt: T0 + 10 * DAY, cost: 6600, profiles: [1, 2, 3, 4, 5].map((i) => ({ label: `P${i}` })) });
  return { s, clock, full: full.account, prof: prof.account };
}

describe("ganancia real", () => {
  test("margen por producto: la cuenta completa deja poco; el perfil, bastante", () => {
    const { s } = setup();
    const m = s.finance.margins(owner);
    const nfc = m.products.find((p) => p.productId === "nfc"), nfp = m.products.find((p) => p.productId === "nfp");
    assert.deepEqual(nfc.public, { price: 7000, gain: 400, pct: 6, state: "low" });
    assert.deepEqual(nfc.reseller, { price: 6700, gain: 100, pct: 1, state: "low" });
    assert.equal(nfp.unitCost, 1320, "6600 / 5 perfiles");
    assert.deepEqual(nfp.public, { price: 2500, gain: 1180, pct: 47, state: "ok" });
    assert.equal(m.products[0].productId, "nfc", "lo que menos deja va primero");
  });

  test("margen negativo = pérdida, y el mínimo se configura", () => {
    const { s } = setup();
    s.catalog.upsertProduct(owner, { id: "nfc", name: "Netflix completa", kind: "full_account", durationDays: 30, price: 6000, published: true });
    assert.equal(s.finance.margins(owner).products.find((p) => p.productId === "nfc").public.state, "loss");
    s.finance.setMinMargin(owner, 50);
    assert.equal(s.finance.margins(owner).products.find((p) => p.productId === "nfp").public.state, "low");
    assert.throws(() => s.finance.setMinMargin(owner, 200), err("VALIDATION"));
    assert.throws(() => s.finance.margins(seller), err("FORBIDDEN"), "el vendedor no ve costos");
  });

  test("Pagué la renovación: anota el gasto, corre un mes manteniendo el día y actualiza el costo", () => {
    const { s, full } = setup();
    const before = s.engine.s.accounts[full.id].supplierExpiresAt;
    const r = s.finance.payRenewal(owner, full.id, { amount: 6900 });
    const d0 = new Date(before), d1 = new Date(r.supplierExpiresAt);
    assert.equal(d1.getDate(), d0.getDate(), "mismo día de cobro");
    assert.equal((d1.getMonth() + 12 - d0.getMonth()) % 12, 1);
    assert.equal(s.engine.s.accounts[full.id].cost, 6900, "el costo queda en lo último que pagaste");
    const rep = s.finance.report(owner, 1);
    assert.equal(rep.current.gastos, 6900);
    assert.equal(rep.current.cuentas, 6900, "se ve como pago de cuentas");
    assert.ok(s.engine.s.audit.some((a) => a.action === "account.renew_paid"));
  });

  test("varios meses de una, y si ya estaba muy vencida arranca hoy", () => {
    const { s, clock, prof } = setup();
    const r = s.finance.payRenewal(owner, prof.id, { months: 3 });
    assert.equal(s.finance.report(owner, 1).current.gastos, 6600 * 3, "sin monto: costo × meses");
    assert.equal(s.engine.s.accounts[prof.id].cost, 6600);
    clock.t = r.supplierExpiresAt + 90 * DAY;
    const r2 = s.finance.payRenewal(owner, prof.id, { amount: 7000 });
    assert.ok(r2.supplierExpiresAt > clock.t, "no queda vencida después de pagar");
    assert.throws(() => s.finance.payRenewal(owner, prof.id, { months: 0 }), err("VALIDATION"));
    assert.throws(() => s.finance.payRenewal(seller, prof.id, {}), err("FORBIDDEN"));
  });

  test("al cargar una cuenta se puede anotar lo que costó", () => {
    const { s, full } = setup();
    s.finance.recordAccountCost(owner, full.id);
    const rep = s.finance.report(owner, 1);
    assert.equal(rep.current.cuentas, 6600);
    assert.equal(rep.current.ganancia, -6600, "sin ventas todavía, la ganancia es negativa: es la verdad");
  });
});

describe("proveedores: cuando el proveedor sos vos", () => {
  test("borrar un proveedor pasa sus cuentas a Propias, sin perder nada", () => {
    const { s, full, prof } = setup();
    assert.throws(() => s.catalog.deleteSupplier(seller, "tarjeta"), err("FORBIDDEN"));
    assert.deepEqual(s.catalog.deleteSupplier(owner, "tarjeta"), { moved: 2 });
    assert.equal(s.engine.s.suppliers.tarjeta, undefined);
    assert.equal(s.engine.s.accounts[full.id].supplierId, "propias");
    assert.equal(s.engine.s.accounts[prof.id].supplierId, "propias");
    assert.throws(() => s.catalog.deleteSupplier(owner, "propias"), err("VALIDATION"));
  });

  test("al editar una cuenta se puede elegir Propias aunque todavía no exista", () => {
    const { s, full } = setup();
    assert.equal(s.engine.s.suppliers.propias, undefined);
    s.inventory.updateAccount(owner, full.id, { supplierId: "propias" });
    assert.equal(s.engine.s.accounts[full.id].supplierId, "propias");
    assert.equal(s.engine.s.suppliers.propias.name, "Propias");
  });
});

describe("venta de varios meses de una vez", () => {
  test("3 meses: cobra 3 veces el precio y el perfil dura 90 días; un cliente no puede pedir meses", () => {
    const { s } = setup();
    const c = s.catalog.createCustomer(owner, { name: "Carla", phone: "+59171112222" });
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "nfp", qty: 1 }], paymentMethod: "cash", periods: 3 });
    assert.equal(o.total, 7500);
    const a = s.engine.s.assignments[o.assignmentIds[0]];
    assert.equal(Math.round((a.customerExpiresAt - a.startsAt) / DAY), 90);
    assert.equal(s.orders.quote(owner, { customerId: c.id, items: [{ productId: "nfp", qty: 1 }], periods: 3 }).total, 7500);
    assert.throws(() => s.orders.create(owner, { customerId: c.id, items: [{ productId: "nfp", qty: 1 }], paymentMethod: "cash", periods: 13 }), err("VALIDATION"));
    const me = { id: `web:${c.id}`, role: "customer", customerId: c.id };
    assert.equal(s.orders.quote(me, { customerId: c.id, items: [{ productId: "nfp", qty: 1 }], periods: 3 }).total, 2500, "los clientes siempre compran 1 período");
  });
});

describe("fiado: lo que te deben", () => {
  test("cargos, pagos parciales en orden y el alquiler pasa a Pagado cuando se cubre", () => {
    const { s } = setup();
    const c = s.catalog.createCustomer(owner, { name: "Rev Disney", phone: "+59171119999" });
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "nfp", qty: 2 }], paymentMethod: "cash" });
    const [a1, a2] = o.assignmentIds;
    s.orders.setControl(owner, a1, { payStatus: "pendiente", price: 3000 });
    s.orders.setControl(owner, a2, { payStatus: "no_pago", price: 2000 });
    assert.throws(() => s.fiado.fromControl(seller, c.id), err("FORBIDDEN"));
    assert.deepEqual(s.fiado.fromControl(owner, c.id), { added: 2, amount: 5000 });
    assert.deepEqual(s.fiado.fromControl(owner, c.id), { added: 0, amount: 0 }, "no se duplica");
    s.fiado.charge(owner, { customerId: c.id, amount: 1000, note: "le presté" });
    let ov = s.fiado.overview(owner).rows.find((r) => r.customerId === c.id);
    assert.equal(ov.owed, 6000);
    s.fiado.pay(owner, { customerId: c.id, amount: 3500, note: "QR" });
    assert.equal(s.engine.s.assignments[a1].control.payStatus, "pagado", "el más viejo se cubre primero");
    assert.equal(s.engine.s.assignments[a2].control.payStatus, "no_pago", "parcial: sigue sin pagar");
    const r = s.fiado.pay(owner, { customerId: c.id, amount: 2500 });
    assert.equal(r.owed, 0);
    assert.equal(s.engine.s.assignments[a2].control.payStatus, "pagado");
    const h = s.fiado.history(owner, c.id);
    assert.equal(h.entries.length, 5);
    s.fiado.remove(owner, h.entries.find((x) => x.kind === "pago" && x.amount === 2500).id);
    assert.equal(s.fiado.history(owner, c.id).owed, 2500, "borrar un pago lo vuelve a deber");
    assert.throws(() => s.fiado.pay(owner, { customerId: c.id, amount: 0 }), err("VALIDATION"));
  });
});

describe("todo Disponible: combos que se pagan por QR y se entregan al aprobar", () => {
  test("el combo reserva lo que hay; la app sin cuenta queda a pedido y se entrega al cargarla y aprobar", () => {
    const { s } = setup();
    s.catalog.upsertProduct(owner, { id: "hb", name: "HBO", kind: "profile", durationDays: 30, price: 1500, published: true });
    s.catalog.upsertProduct(owner, { id: "cmb", name: "Dúo", kind: "combo", durationDays: 30, price: 3500, published: true, comboProductIds: ["nfp", "hb"] });
    const c = s.catalog.createCustomer(owner, { name: "Ana", phone: "+59171113333" });
    const me = { id: `web:${c.id}`, role: "customer", customerId: c.id };
    assert.throws(() => s.orders.create(me, { customerId: c.id, items: [{ productId: "cmb", qty: 1 }], paymentMethod: "qr" }), err("OUT_OF_STOCK"), "sin 'todo Disponible' no se puede");
    s.catalog.updateSettings(owner, { alwaysAvailable: true });
    const o = s.orders.create(me, { customerId: c.id, items: [{ productId: "cmb", qty: 1 }], paymentMethod: "qr" });
    assert.equal(o.total, 3500);
    assert.deepEqual(o.backorder, [{ productId: "hb", qty: 1 }]);
    assert.equal(o.reservedSlotIds.length, 1, "el perfil de Netflix ya quedó reservado");
    assert.throws(() => s.orders.approvePayment(owner, o.id, { confirmedReference: "QR-1" }), err("OUT_OF_STOCK"));
    s.inventory.addAccount(owner, { productId: "hb", supplierId: "tarjeta", email: "hb@x.lat", password: "Clave-Larga#3", supplierExpiresAt: Date.UTC(2027, 0, 1), cost: 1000, profiles: [{ label: "P1" }] });
    const done = s.orders.approvePayment(owner, o.id, { confirmedReference: "QR-1" });
    assert.equal(done.status, "fulfilled");
    assert.equal(done.assignmentIds.length, 2, "recibe un perfil de cada app");
  });
});
