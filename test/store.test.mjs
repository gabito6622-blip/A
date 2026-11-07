// Pruebas del núcleo de Gabriel Store (sin red, reloj controlado).
// Ejecutar: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError, DAY, MINUTE } from "../dist/store/index.js";

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const system = { id: "sys", role: "system" };

const err = (code) => (e) => e instanceof DomainError && e.code === code;

/** Tienda con catálogo, 1 proveedor, cuentas y clientes de prueba. */
function setup(opts = {}) {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock, ...opts });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "gemini", name: "Gemini Pro", kind: "invite", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "oculto", name: "Producto privado", kind: "profile", durationDays: 30, price: 1000, published: false });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, gemini: 1800 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", active: true });
  const acc1 = s.inventory.addAccount(admin, {
    productId: "netflix", supplierId: "andes", email: "nf01@gabostore.lat", password: "Sup3r-Secreta#1",
    supplierExpiresAt: T0 + 90 * DAY, cost: 4000, profiles: [{ label: "Perfil 1", pin: "1111" }, { label: "Perfil 2", pin: "2222" }],
  });
  const acc2 = s.inventory.addAccount(admin, {
    productId: "netflix", supplierId: "andes", email: "nf02@gabostore.lat", password: "Otra-Clave#2",
    supplierExpiresAt: T0 + 40 * DAY, cost: 4000, profiles: [{ label: "Perfil 1", pin: "3333" }],
  });
  s.inventory.addAccount(admin, {
    productId: "oculto", supplierId: "andes", email: "x01@gabostore.lat", password: "Zz-Clave#3",
    supplierExpiresAt: T0 + 90 * DAY, cost: 100, profiles: [{ label: "Cuenta" }],
  });
  const maria = s.catalog.createCustomer(seller, { name: "María Quispe", phone: "+591 70011223", whatsappConsent: true });
  const luis = s.catalog.createCustomer(seller, { name: "Luis Choque", phone: "+591 78889900" });
  const carla = s.catalog.createCustomer(admin, { name: "Carla Vargas", phone: "+591 69990011", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true });
  const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });
  return { s, clock, acc1, acc2, maria, luis, carla, as };
}

describe("1. Inventario transaccional", () => {
  test("cuenta con perfiles queda disponible y la contraseña no se lista sin permiso", () => {
    const { s } = setup();
    assert.equal(s.inventory.stock().netflix.available, 3);
    const list = s.inventory.listAccounts(admin);
    assert.ok(list.every((a) => a.password === "••••••"));
    assert.throws(() => s.inventory.listAccounts(seller), err("FORBIDDEN"));
  });

  test("nunca se vende el mismo perfil dos veces: el tercer pedido sin stock falla y no deja rastros", () => {
    const { s, maria, luis, as } = setup();
    const o1 = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 2 }], paymentMethod: "qr" });
    const o2 = s.orders.create(as(luis), { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    assert.equal(new Set([...o1.reservedSlotIds, ...o2.reservedSlotIds]).size, 3);
    const before = s.snapshot().seq;
    assert.throws(() => s.orders.create(as(luis), { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }), err("OUT_OF_STOCK"));
    assert.equal(s.snapshot().seq, before, "rollback total: ni ids ni pedidos nuevos");
    assert.equal(s.inventory.stock().netflix.reserved, 3);
  });

  test("pedido de varios ítems es todo o nada", () => {
    const { s, maria, as } = setup();
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }, { productId: "gemini", qty: 1 }], paymentMethod: "qr" }), err("OUT_OF_STOCK"));
    assert.equal(s.inventory.stock().netflix.available, 3, "el perfil de Netflix no quedó reservado");
  });

  test("reservas vencidas se liberan; las que están en revisión no", () => {
    const { s, clock, maria, luis, as } = setup();
    const a = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    const b = s.orders.create(as(luis), { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(luis), b.id, { fileRef: "up/1.jpg", declaredReference: "DEP-1" });
    clock.t += 31 * MINUTE;
    assert.equal(s.orders.expireReservations(system), 1);
    assert.equal(s.inventory.stock().netflix.available, 2);
    assert.equal(s.inventory.stock().netflix.reserved, 1);
    assert.throws(() => s.orders.submitEvidence(as(maria), a.id, { fileRef: "x", declaredReference: "y" }), err("INVALID_STATE"));
  });

  test("perfiles de cuentas vencidas con el proveedor no se venden", () => {
    const { s, clock, maria, as } = setup();
    clock.t += 41 * DAY; // nf02 ya venció con el proveedor
    assert.equal(s.inventory.stock().netflix.available, 2);
    assert.equal(s.inventory.stock().netflix.unsellable, 1);
    s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 2 }], paymentMethod: "qr" });
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }), err("OUT_OF_STOCK"));
  });

  test("carga masiva informa fila por fila", () => {
    const { s } = setup();
    const r = s.inventory.addAccountsBulk(admin, [
      { productId: "gemini", supplierId: "andes", email: "g1@gabostore.lat", password: "a", supplierExpiresAt: T0 + 30 * DAY, cost: 0, profiles: [{ label: "Invitación" }] },
      { productId: "gemini", supplierId: "andes", email: "mal", password: "a", supplierExpiresAt: T0 + 30 * DAY, cost: 0, profiles: [{ label: "x" }] },
    ]);
    assert.deepEqual(r.map((x) => x.ok), [true, false]);
    assert.equal(s.inventory.stock().gemini.available, 1);
  });
});

describe("2. Ventas, pagos, asignaciones, reemplazos y renovaciones", () => {
  test("QR: comprobante → aprobación con referencia bancaria → asignación", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    assert.equal(o.status, "awaiting_payment");
    assert.equal(o.total, 3500, "precio calculado en el servidor");
    assert.throws(() => s.orders.approvePayment(admin, o.id, { confirmedReference: "BNB-1" }), err("INVALID_STATE"), "sin comprobante no se aprueba");
    s.orders.submitEvidence(as(maria), o.id, { fileRef: "up/comp.jpg", declaredReference: "DEP-55" });
    assert.throws(() => s.orders.approvePayment(admin, o.id, { confirmedReference: "  " }), err("VALIDATION"));
    const done = s.orders.approvePayment(admin, o.id, { confirmedReference: "BNB-1", idempotencyKey: "k1" });
    assert.equal(done.status, "fulfilled");
    assert.equal(done.assignmentIds.length, 1);
    assert.equal(s.inventory.stock().netflix.assigned, 1);
  });

  test("aprobar es idempotente y una referencia bancaria no se usa dos veces", () => {
    const { s, maria, luis, as } = setup();
    const a = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    const b = s.orders.create(as(luis), { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(maria), a.id, { fileRef: "1", declaredReference: "DEP-1" });
    s.orders.submitEvidence(as(luis), b.id, { fileRef: "2", declaredReference: "DEP-1" });
    const r1 = s.orders.approvePayment(admin, a.id, { confirmedReference: "BNB-777", idempotencyKey: "doble-click" });
    const r2 = s.orders.approvePayment(admin, a.id, { confirmedReference: "BNB-777", idempotencyKey: "doble-click" });
    assert.deepEqual(r1, r2);
    assert.equal(s.inventory.stock().netflix.assigned, 1, "el doble clic no asigna dos perfiles");
    assert.throws(() => s.orders.approvePayment(admin, a.id, { confirmedReference: "BNB-777", idempotencyKey: "otro" }), err("ALREADY_PROCESSED"));
    assert.throws(() => s.orders.approvePayment(admin, b.id, { confirmedReference: "BNB-777" }), err("ALREADY_PROCESSED"));
  });

  test("rechazo libera el stock; solo revisores aprueban o rechazan", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(maria), o.id, { fileRef: "1", declaredReference: "DEP-1" });
    assert.throws(() => s.orders.approvePayment(as(maria), o.id, { confirmedReference: "X" }), err("FORBIDDEN"));
    assert.throws(() => s.orders.approvePayment(seller, o.id, { confirmedReference: "X" }), err("FORBIDDEN"));
    s.orders.rejectPayment(admin, o.id, "Monto no coincide");
    assert.equal(s.inventory.stock().netflix.available, 3);
  });

  test("cliente no puede pagar en efectivo ni comprar productos ocultos ni pedir para otro", () => {
    const { s, maria, luis, as } = setup();
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }), err("FORBIDDEN"));
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "oculto", qty: 1 }], paymentMethod: "qr" }), err("NOT_FOUND"));
    assert.throws(() => s.orders.create(as(maria), { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }), err("FORBIDDEN"));
    const staff = s.orders.create(seller, { customerId: luis.id, items: [{ productId: "oculto", qty: 1 }], paymentMethod: "cash" });
    assert.equal(staff.status, "fulfilled", "el staff sí vende productos privados en efectivo");
  });

  test("renovar mueve solo la fecha del cliente, nunca la del proveedor", () => {
    const { s, maria, luis, acc1, as } = setup();
    // La primera venta usa nf02 (vence antes con el proveedor); la de María sale de nf01.
    s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    s.wallet.adjust(owner, maria.id, 10000, "carga inicial");
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const asg = o.assignmentIds[0];
    assert.equal(s.snapshot().slots[s.snapshot().assignments[asg].slotId].accountId, acc1.account.id);
    const r = s.orders.renew(as(maria), asg, { paymentMethod: "balance" });
    assert.equal(r.assignment.customerExpiresAt, T0 + 60 * DAY);
    const acc = s.snapshot().accounts[acc1.account.id];
    assert.equal(acc.supplierExpiresAt, T0 + 90 * DAY);
    assert.equal(s.wallet.balance(maria.id), 10000 - 3500 * 2);
  });

  test("no se renueva más allá del vencimiento del proveedor salvo el dueño", () => {
    const { s, maria, as } = setup();
    s.wallet.adjust(owner, maria.id, 20000, "carga");
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const asg = o.assignmentIds[0];
    const bal = s.wallet.balance(maria.id);
    assert.throws(() => s.orders.renew(as(maria), asg, { paymentMethod: "balance", periods: 3 }), err("SUPPLIER_EXPIRY_EXCEEDED"));
    assert.equal(s.wallet.balance(maria.id), bal, "no se cobró nada");
    assert.throws(() => s.orders.renew(admin, asg, { paymentMethod: "cash", periods: 3, allowBeyondSupplier: true }), err("FORBIDDEN"));
    const r = s.orders.renew(owner, asg, { paymentMethod: "cash", periods: 3, allowBeyondSupplier: true });
    assert.equal(r.assignment.customerExpiresAt, T0 + 120 * DAY);
  });

  test("renovación masiva informa éxito y fallo por ítem", () => {
    const { s, maria, luis, carla } = setup();
    const c = s.orders.create(seller, { customerId: carla.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }); // nf02, vence a +40 días
    const a = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const b = s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const res = s.orders.renewMany(admin, [...a.assignmentIds, ...b.assignmentIds, "asg_inexistente", ...c.assignmentIds], { paymentMethod: "cash", batchKey: "lote-1" });
    assert.deepEqual(res.map((r) => r.ok), [true, true, false, false]);
    assert.equal(res[2].code, "NOT_FOUND");
    assert.equal(res[3].code, "SUPPLIER_EXPIRY_EXCEEDED", "la cuenta del proveedor vence antes");
    const again = s.orders.renewMany(admin, a.assignmentIds, { paymentMethod: "cash", batchKey: "lote-1" });
    assert.equal(again[0].expiresAt, res[0].expiresAt, "repetir el lote no renueva dos veces");
  });

  test("reemplazo conserva el vencimiento, cuarentena el perfil viejo y guarda historial", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    const before = s.snapshot().assignments[id];
    assert.throws(() => s.orders.replace(seller, id, { reason: "x" }), err("FORBIDDEN"));
    const after = s.orders.replace(admin, id, { reason: "Perfil bloqueado" });
    assert.notEqual(after.slotId, before.slotId);
    assert.equal(after.customerExpiresAt, before.customerExpiresAt);
    assert.equal(s.snapshot().slots[before.slotId].status, "quarantined");
    assert.deepEqual(after.history.map((h) => h.event), ["assigned", "replaced"]);
    assert.equal(s.portal.services(as(maria))[0].access.profile, s.snapshot().slots[after.slotId].label);
  });

  test("cuenta caída: mueve a todos a otra cuenta y la retira", () => {
    const { s, maria, luis, acc1 } = setup();
    s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "nf03@gabostore.lat", password: "P#3", supplierExpiresAt: T0 + 90 * DAY, cost: 4000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }] });
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    // Las dos primeras ventas salieron de nf02 (vence antes) y nf01.
    const r = s.orders.replaceAccount(admin, acc1.account.id, "Cuenta suspendida por el proveedor");
    assert.equal(r.retired, true);
    const st = s.snapshot();
    assert.equal(st.accounts[acc1.account.id].status, "retired");
    for (const a of Object.values(st.assignments)) assert.notEqual(st.slots[a.slotId].accountId, acc1.account.id);
  });

  test("servicios vencidos se cierran y el perfil queda en cuarentena", () => {
    const { s, clock, maria } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    clock.t += 31 * DAY;
    assert.equal(s.orders.closeExpired(system, 2), 0, "dentro de la gracia");
    clock.t += 2 * DAY;
    assert.equal(s.orders.closeExpired(system, 2), 1);
    assert.equal(s.inventory.stock().netflix.quarantined, 1);
  });
});

describe("3. Portal privado de clientes y revendedores", () => {
  test("cada cliente ve solo sus accesos, y se audita", () => {
    const { s, maria, luis, as } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const mine = s.portal.services(as(maria));
    assert.equal(mine.length, 1);
    assert.ok(mine[0].access.password);
    assert.equal(s.portal.services(as(luis)).length, 0);
    assert.throws(() => s.portal.services(as(luis), maria.id), err("FORBIDDEN"));
    assert.ok(s.stats.audit(owner, { action: "credentials.view" }).length >= 1);
  });

  test("revendedor: crea sus clientes, vende a su precio con su saldo y ve sus servicios", () => {
    const { s, carla, maria, as } = setup();
    const r = as(carla);
    assert.throws(() => s.catalog.createCustomer(r, { name: "Otro rev", phone: "+591 7000001", kind: "reseller" }), err("FORBIDDEN"));
    const sub = s.catalog.createCustomer(r, { name: "Pedro Rojas", phone: "+591 72223344" });
    assert.equal(sub.resellerId, carla.id);
    assert.throws(() => s.orders.create(r, { customerId: sub.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" }), err("INSUFFICIENT_BALANCE"));
    s.wallet.adjust(owner, carla.id, 5000, "recarga en efectivo");
    const o = s.orders.create(r, { customerId: sub.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    assert.equal(o.total, 2500, "precio de revendedor");
    assert.equal(o.payerId, carla.id);
    assert.equal(s.wallet.balance(carla.id), 2500);
    assert.equal(s.portal.services(r).length, 1);
    assert.equal(s.portal.customers(r)[0].services, 1);
    assert.throws(() => s.portal.services(r, maria.id), err("FORBIDDEN"), "no ve clientes ajenos");
  });
});

describe("4. Saldo, recargas e historial contable", () => {
  test("recarga con comprobante → aprobación → saldo; historial con saldo acumulado", () => {
    const { s, maria, as } = setup();
    const t = s.orders.requestTopup(as(maria), maria.id, 10000, { fileRef: "up/r.jpg", declaredReference: "DEP-9" });
    assert.equal(s.wallet.balance(maria.id), 0, "el comprobante solo no acredita");
    s.orders.approvePayment(admin, t.id, { confirmedReference: "BNB-9" });
    assert.equal(s.wallet.balance(maria.id), 10000);
    s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    const h = s.wallet.history(as(maria), maria.id);
    assert.deepEqual(h.map((x) => [x.type, x.amount, x.balanceAfter]), [["topup", 10000, 10000], ["purchase", -3500, 6500]]);
  });

  test("el saldo nunca queda negativo y solo el dueño ajusta, con motivo", () => {
    const { s, maria, luis, as } = setup();
    assert.throws(() => s.wallet.adjust(admin, maria.id, 100, "x"), err("FORBIDDEN"));
    assert.throws(() => s.wallet.adjust(owner, maria.id, 100, ""), err("VALIDATION"));
    assert.throws(() => s.wallet.adjust(owner, maria.id, -1, "quitar"), err("INSUFFICIENT_BALANCE"));
    assert.throws(() => s.wallet.history(as(luis), maria.id), err("FORBIDDEN"));
    assert.throws(() => s.orders.requestTopup(as(maria), maria.id, 500, { fileRef: "a", declaredReference: "b" }), err("VALIDATION"));
  });

  test("compra con saldo insuficiente no reserva stock", () => {
    const { s, maria, as } = setup();
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" }), err("INSUFFICIENT_BALANCE"));
    assert.equal(s.inventory.stock().netflix.available, 3);
  });
});

describe("5. Tienda: catálogo público y precios del servidor", () => {
  test("catálogo muestra solo publicados, con precio según el grupo del cliente", () => {
    const { s, carla, maria } = setup();
    const pub = s.catalog.publicCatalog();
    assert.deepEqual(pub.map((p) => p.id).sort(), ["gemini", "netflix"]);
    assert.equal(s.catalog.publicCatalog(carla.id).find((p) => p.id === "netflix").price, 2500);
    assert.equal(s.catalog.publicCatalog(maria.id).find((p) => p.id === "netflix").price, 3500);
  });

  test("pedido con la misma clave de idempotencia no se duplica", () => {
    const { s, maria, as } = setup();
    const a = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr", idempotencyKey: "checkout-1" });
    const b = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr", idempotencyKey: "checkout-1" });
    assert.equal(a.id, b.id);
    assert.equal(s.inventory.stock().netflix.reserved, 1);
  });
});

describe("6. WhatsApp y códigos de acceso", () => {
  test("mensajes sin contraseñas, y sin consentimiento no se envían", async () => {
    const { s, maria, luis } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const out = s.notify.outbox(admin);
    assert.ok(out.every((m) => !/Sup3r|Otra-Clave|1111|2222|3333/.test(m.text)));
    assert.equal(out.find((m) => m.customerId === luis.id).status, "skipped_no_consent");
    const sent = [];
    const r = await s.notify.flush(system, { send: async (to, text) => { sent.push({ to, text }); } });
    assert.equal(r.sent, 1);
    assert.equal(sent[0].to, "+59170011223");
    await assert.rejects(() => s.notify.flush(seller, { send: async () => {} }), err("FORBIDDEN"));
  });

  test("las plantillas rechazan parámetros sensibles", async () => {
    const { renderTemplate } = await import("../dist/store/index.js");
    assert.throws(() => renderTemplate("order_confirmed", { order: "1", password: "x" }), err("SENSITIVE_DATA"));
  });

  test("errores del transporte quedan registrados por mensaje", async () => {
    const { s, maria } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const r = await s.notify.flush(system, { send: async () => { throw new Error("token vencido"); } });
    assert.equal(r.failed, 1);
    assert.equal(s.notify.outbox(owner).find((m) => m.status === "failed").error, "token vencido");
  });

  test("códigos: buzón autorizado por el dueño, asunto permitido, solo para quien tiene la cuenta", () => {
    const { s, clock, maria, luis, as } = setup();
    assert.throws(() => s.codes.configureMailbox(admin, { address: "codigos@gabostore.lat", host: "imap.gabostore.lat", subjectAllowlist: ["código"] }), err("FORBIDDEN"));
    const box = s.codes.configureMailbox(owner, { address: "codigos@gabostore.lat", host: "imap.gabostore.lat", subjectAllowlist: ["código de acceso", "verificá"] });
    clock.t += 1000;
    // Previo a la venta: no debe verlo el comprador nuevo.
    s.codes.ingest(system, box.id, { to: "nf02@gabostore.lat", subject: "Tu código de acceso temporal", body: "Usá 111 222", receivedAt: clock.t });
    clock.t += 1000;
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }); // recibe nf02 (vence antes)
    clock.t += 1000;
    assert.equal(s.codes.ingest(system, box.id, { to: "nf02@gabostore.lat", subject: "Promo de la semana", body: "123456", receivedAt: clock.t }), null);
    s.codes.ingest(system, box.id, { to: "NF02@gabostore.lat", subject: "Tu código de acceso temporal", body: "Tu código: 741 208", receivedAt: clock.t });
    s.codes.ingest(system, box.id, { to: "nf01@gabostore.lat", subject: "Tu código de acceso temporal", body: "999 000", receivedAt: clock.t });
    const mine = s.portal.codes(as(maria), maria.id);
    assert.deepEqual(mine.map((c) => c.code), ["741 208"]);
    assert.throws(() => s.portal.codes(as(luis), maria.id), err("FORBIDDEN"));
    assert.throws(() => s.codes.ingest(as(maria), box.id, { to: "a", subject: "b", body: "c", receivedAt: 0 }), err("FORBIDDEN"));
    clock.t += 31 * MINUTE;
    assert.equal(s.portal.codes(as(maria), maria.id).length, 0, "vencida la ventana, desaparece");
  });

  test("recordatorios de vencimiento, máximo uno por día", () => {
    const { s, clock, maria } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    clock.t += 28 * DAY;
    assert.equal(s.orders.queueExpiryReminders(system, 3), 1);
    assert.equal(s.orders.queueExpiryReminders(system, 3), 0);
    clock.t += DAY;
    assert.equal(s.orders.queueExpiryReminders(system, 3), 1);
  });
});

describe("7. Estadísticas, auditoría y proveedores", () => {
  test("resumen separa ingreso por ventas de caja y saldo adeudado", () => {
    const { s, maria, luis, as } = setup();
    const t = s.orders.requestTopup(as(maria), maria.id, 10000, { fileRef: "r", declaredReference: "d" });
    s.orders.approvePayment(admin, t.id, { confirmedReference: "BNB-1" });
    s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const r = s.stats.summary(admin, { from: T0 - DAY, to: T0 + DAY });
    assert.equal(r.revenue, 7000);
    assert.equal(r.cashIn, 10000 + 3500);
    assert.equal(r.balancesOwed, 6500);
    assert.equal(r.byProduct.netflix.units, 2);
    assert.throws(() => s.stats.summary(seller, { from: 0, to: 1 }), err("FORBIDDEN"));
  });

  test("reporte de proveedor: costo, ingreso atribuido, margen y cuentas por vencer", () => {
    const { s, clock, maria } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    clock.t += 35 * DAY;
    const [andes] = s.stats.suppliers(admin);
    assert.equal(andes.accounts, 3);
    assert.equal(andes.cost, 8100);
    assert.equal(andes.revenue, 3500);
    assert.equal(andes.margin, 3500 - 8100);
    assert.deepEqual(andes.expiringIn7Days.map((a) => a.email), ["nf02@gabostore.lat"]);
  });

  test("la auditoría registra quién hizo qué, sin secretos, y solo la ve el dueño", () => {
    const { s, maria } = setup();
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const log = s.stats.audit(owner);
    assert.ok(log.some((a) => a.action === "order.create" && a.actorId === "u_seller"));
    assert.ok(log.some((a) => a.action === "account.add"));
    assert.ok(!JSON.stringify(log).includes("Sup3r-Secreta"));
    assert.throws(() => s.stats.audit(admin), err("FORBIDDEN"));
  });

  test("ver contraseñas desde el panel requiere permiso y queda auditado", () => {
    const { s } = setup();
    assert.ok(s.inventory.listAccounts(owner, { withSecrets: true }).some((a) => a.password === "Sup3r-Secreta#1"));
    assert.ok(s.stats.audit(owner, { action: "secrets.view" }).length === 1);
  });

  test("proveedor inactivo no puede recibir cuentas nuevas", () => {
    const { s } = setup();
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", active: false });
    assert.throws(() => s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "n@x.y", password: "p", supplierExpiresAt: T0 + DAY, cost: 0, profiles: [{ label: "P" }] }), err("INVALID_STATE"));
  });
});

describe("8. Edición de cuentas, perfiles y clientes; transferencias", () => {
  test("cambiar la contraseña de la cuenta: clientes ven la nueva y reciben aviso sin la clave", () => {
    const { s, maria, luis, acc1, as } = setup();
    // nf02 vence antes y se vende primero; estas dos ventas caen en nf02 y nf01.
    s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    assert.throws(() => s.inventory.updateAccount(seller, acc1.account.id, { password: "x" }), err("FORBIDDEN"));
    assert.throws(() => s.inventory.updateAccount(admin, acc1.account.id, { password: "" }), err("VALIDATION"));
    const r = s.inventory.updateAccount(admin, acc1.account.id, { password: "Nueva-Clave#9", notes: "El proveedor la cambió" });
    assert.deepEqual(r.changed, ["password", "notes"]);
    assert.equal(r.notified, 1, "solo María está en esa cuenta");
    assert.equal(s.portal.services(as(maria))[0].access.password, "Nueva-Clave#9");
    const msgs = s.notify.outbox(admin).filter((m) => m.template === "access_updated");
    assert.equal(msgs.length, 1);
    assert.ok(!msgs[0].text.includes("Nueva-Clave"), "el aviso no lleva la clave");
    assert.ok(!JSON.stringify(s.stats.audit(owner)).includes("Nueva-Clave"), "la auditoría no guarda la clave");
  });

  test("extender el vencimiento del proveedor habilita renovaciones que antes se frenaban", () => {
    const { s, maria, acc2 } = setup();
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }); // nf02, vence a +40
    assert.throws(() => s.orders.renew(seller, o.assignmentIds[0], { paymentMethod: "cash" }), err("SUPPLIER_EXPIRY_EXCEEDED"));
    s.inventory.updateAccount(admin, acc2.account.id, { supplierExpiresAt: T0 + 120 * DAY });
    assert.equal(s.orders.renew(seller, o.assignmentIds[0], { paymentMethod: "cash" }).assignment.customerExpiresAt, T0 + 60 * DAY);
  });

  test("cambiar el PIN de un perfil vendido avisa a su cliente; uno en cuarentena se puede liberar", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const slotId = s.snapshot().assignments[o.assignmentIds[0]].slotId;
    assert.throws(() => s.inventory.updateSlot(admin, slotId, { pin: "12ab" }), err("VALIDATION"));
    assert.equal(s.inventory.updateSlot(admin, slotId, { pin: "4321" }).notified, true);
    assert.equal(s.portal.services(as(maria))[0].access.pin, "4321");
    const after = s.orders.replace(admin, o.assignmentIds[0], { reason: "bloqueado" });
    assert.equal(s.snapshot().slots[slotId].status, "quarantined");
    assert.throws(() => s.inventory.setSlotStatus(admin, after.slotId, "available", "x"), err("INVALID_STATE"), "uno vendido no se libera");
    s.inventory.setSlotStatus(admin, slotId, "available", "revisado, clave cambiada");
    assert.equal(s.snapshot().slots[slotId].status, "available");
  });

  test("editar cliente: datos, notas, teléfono único y permisos", () => {
    const { s, maria, luis } = setup();
    const c = s.catalog.updateCustomer(seller, maria.id, { name: "María Q. Rojas", phone: "+591 7001 9999", notes: "Paga siempre por QR" });
    assert.deepEqual([c.name, c.phone, c.notes], ["María Q. Rojas", "+59170019999", "Paga siempre por QR"]);
    assert.throws(() => s.catalog.updateCustomer(seller, maria.id, { phone: luis.phone }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateCustomer(seller, maria.id, { kind: "reseller" }), err("FORBIDDEN"));
    assert.equal(s.catalog.updateCustomer(admin, maria.id, { kind: "reseller", priceGroupId: "revendedor" }).kind, "reseller");
  });

  test("un revendedor con clientes no puede pasar a cliente final", () => {
    const { s, carla, as } = setup();
    s.catalog.createCustomer(as(carla), { name: "Pedro", phone: "+591 72223344" });
    assert.throws(() => s.catalog.updateCustomer(admin, carla.id, { kind: "customer" }), err("INVALID_STATE"));
  });

  test("transferir un perfil a otro cliente conserva perfil y fecha; el anterior deja de verlo", () => {
    const { s, maria, luis, as } = setup();
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    const before = s.snapshot().assignments[id];
    assert.throws(() => s.orders.transfer(seller, id, luis.id, "x"), err("FORBIDDEN"));
    assert.throws(() => s.orders.transfer(admin, id, maria.id, "x"), err("VALIDATION"));
    const t = s.orders.transfer(admin, id, luis.id, "Se cargó al cliente equivocado");
    assert.equal(t.slotId, before.slotId);
    assert.equal(t.customerExpiresAt, before.customerExpiresAt);
    assert.equal(t.history.at(-1).event, "transferred");
    assert.equal(s.portal.services(as(maria)).length, 0);
    assert.equal(s.portal.services(as(luis)).length, 1);
    assert.ok(s.notify.outbox(admin).some((m) => m.template === "access_transferred" && m.customerId === luis.id));
  });
});

describe("9. Importar servicios existentes", () => {
  const row = (n, extra = {}) => ({ row: n, customerName: "Ana Pérez", phone: "+59170033344", product: "Netflix perfil", email: "nf09@gabostore.lat", password: "Imp#1", profile: "Perfil 1", pin: "1111", customerExpiresAt: T0 + 20 * DAY, supplierExpiresAt: T0 + 60 * DAY, supplier: "Proveedor Nuevo", ...extra });

  test("la vista previa no guarda nada y muestra lo que se va a crear", () => {
    const { s } = setup();
    const before = JSON.stringify(s.snapshot());
    const r = s.inventory.importServices(admin, [row(2), row(3, { customerName: "Beto", phone: "+59170044455", profile: "Perfil 2" })], { dryRun: true });
    assert.deepEqual(r.summary, { ok: 2, errores: 0, clientesNuevos: 2, cuentasNuevas: 1, perfilesNuevos: 2, avisos: 0 });
    assert.equal(JSON.stringify(s.snapshot()), before, "nada cambió");
  });

  test("importar crea cliente, proveedor, cuenta, perfiles y servicio, sin avisos ni ventas", () => {
    const { s, as } = setup();
    const r = s.inventory.importServices(admin, [row(2), row(3, { customerName: "Beto", phone: "+59170044455", profile: "Perfil 2", pin: "" })], { dryRun: false });
    assert.equal(r.summary.ok, 2);
    const st = s.snapshot();
    const acc = Object.values(st.accounts).find((a) => a.email === "nf09@gabostore.lat");
    assert.equal(acc.supplierExpiresAt, T0 + 60 * DAY);
    assert.ok(Object.values(st.suppliers).some((x) => x.name === "Proveedor Nuevo"));
    const ana = Object.values(st.customers).find((c) => c.phone === "+59170033344");
    const svc = s.portal.services(as(ana));
    assert.deepEqual([svc[0].product, svc[0].access.profile, svc[0].access.pin, svc[0].expiresAt], ["Netflix perfil", "Perfil 1", "1111", T0 + 20 * DAY]);
    assert.equal(s.notify.outbox(admin).length, 0, "no se manda WhatsApp");
    assert.equal(s.stats.summary(admin, { from: 0, to: T0 + DAY }).orders, 0, "no cuenta como venta");
    assert.ok(s.engine.s.orders && Object.values(st.orders).every((o) => o.channel === "import" && o.total === 0));
  });

  test("errores por fila no frenan a las demás ni dejan nada a medias", () => {
    const { s, maria } = setup();
    const r = s.inventory.importServices(admin, [
      row(2),
      row(3, { customerName: "Beto", phone: "+59170044455" }), // mismo perfil 1 → ya asignado
      row(4, { product: "Spotify" }), // producto inexistente
      row(5, { customerName: "Otro nombre", phone: maria.phone, profile: "Perfil 3", email: "nueva@x.y", password: "" }), // cuenta nueva sin clave: se carga con aviso
      row(6, { customerName: "Carlos", phone: "+59170055566", profile: "Perfil 4" }),
    ], { dryRun: false });
    assert.deepEqual(r.rows.map((x) => x.status), ["ok", "error", "error", "ok", "ok"]);
    assert.match(r.rows[1].error, /ya está asignado a Ana Pérez/);
    assert.match(r.rows[2].error, /No existe el producto/);
    assert.ok(r.rows[3].warnings.some((w) => /Sin contraseña/.test(w)));
    const st = s.snapshot();
    assert.ok(!Object.values(st.customers).some((c) => c.name === "Beto"), "Beto no quedó creado a medias");
    const nueva = Object.values(st.accounts).find((a) => a.email === "nueva@x.y");
    assert.equal(nueva.password, "", "queda pendiente, sin inventar clave");
    assert.equal(s.inventory.listAccounts(admin).find((a) => a.email === "nueva@x.y").password, "(pendiente)");
    assert.throws(() => s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "z@z.z", password: "", supplierExpiresAt: T0 + DAY, cost: 0, profiles: [{ label: "P" }] }), err("VALIDATION"), "a mano sigue siendo obligatoria");
  });

  test("avisos: vencido, cliente que vence después que el proveedor, contraseña distinta", () => {
    const { s } = setup();
    s.inventory.importServices(admin, [row(2)], { dryRun: false });
    const r = s.inventory.importServices(admin, [row(3, { customerName: "Dora", phone: "+59170066677", profile: "Perfil 2", password: "OtraClave", customerExpiresAt: T0 - DAY }), row(4, { customerName: "Eli", phone: "+59170077788", profile: "Perfil 3", customerExpiresAt: T0 + 90 * DAY })], { dryRun: false });
    assert.ok(r.rows[0].warnings.some((w) => /distinta/.test(w)));
    assert.ok(r.rows[0].warnings.some((w) => /vencido/.test(w)));
    assert.ok(r.rows[1].warnings.some((w) => /después que la cuenta/.test(w)));
  });

  test("solo admin u owner importan", () => {
    const { s } = setup();
    assert.throws(() => s.inventory.importServices(seller, [row(2)], { dryRun: true }), err("FORBIDDEN"));
  });
});

describe("10. Recordatorios automáticos", () => {
  // T0 = 12:00 UTC = 08:00 en Bolivia. La venta vence a T0 + 30 días.
  const sell = (s, customerId) => s.orders.create(seller, { customerId, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
  const reminders = (s) => s.notify.outbox(admin).filter((m) => m.template === "expiry_reminder");

  test("por defecto: 2 días antes, una sola vez, en horario de Bolivia", () => {
    const { s, clock, maria } = setup();
    sell(s, maria.id);
    clock.t = T0 + 27 * DAY + 4 * 3600_000; // faltan 3 días
    assert.equal(s.orders.autoReminders(system), 0);
    clock.t = T0 + 28 * DAY + 14 * 3600_000; // faltan 2 días, pero son las 22:00 en Bolivia
    assert.equal(s.orders.autoReminders(system), 0, "fuera de horario no se manda");
    clock.t = T0 + 28 * DAY + 4 * 3600_000; // faltan 2 días, 12:00 en Bolivia
    assert.equal(s.orders.autoReminders(system), 1);
    assert.equal(s.orders.autoReminders(system), 0, "no se repite");
    clock.t += 3600_000;
    assert.equal(s.orders.autoReminders(system), 0);
    clock.t = T0 + 29 * DAY + 4 * 3600_000; // falta 1 día: no está configurado
    assert.equal(s.orders.autoReminders(system), 0);
    assert.equal(reminders(s).length, 1);
    assert.match(reminders(s)[0].text, /tu Netflix perfil vence el/);
  });

  test("después de renovar vuelve a avisar en el próximo vencimiento", () => {
    const { s, clock, maria, luis } = setup();
    sell(s, luis.id); // usa nf02 (vence antes con el proveedor)
    const o = sell(s, maria.id);
    clock.t = T0 + 28 * DAY + 4 * 3600_000;
    s.orders.autoReminders(system);
    s.orders.renew(seller, o.assignmentIds[0], { paymentMethod: "cash" }); // ahora vence a T0 + 60 días
    clock.t = T0 + 58 * DAY + 4 * 3600_000;
    assert.equal(s.orders.autoReminders(system), 1);
  });

  test("se pueden elegir varios días (p. ej. 3 y 1) y el horario", () => {
    const { s, clock, maria } = setup();
    sell(s, maria.id);
    assert.throws(() => s.orders.updateReminderSettings(seller, { daysBefore: [1] }), err("FORBIDDEN"));
    assert.throws(() => s.orders.updateReminderSettings(admin, { daysBefore: [31] }), err("VALIDATION"));
    assert.throws(() => s.orders.updateReminderSettings(admin, { fromHour: 20, toHour: 9 }), err("VALIDATION"));
    assert.deepEqual(s.orders.updateReminderSettings(admin, { daysBefore: [1, 3, 3], fromHour: 7 }).daysBefore, [3, 1]);
    let sent = 0;
    for (let d = 26; d <= 30; d++) { clock.t = T0 + d * DAY + 3600_000; sent += s.orders.autoReminders(system); } // 09:00 en Bolivia
    assert.equal(sent, 2);
  });

  test("apagados no mandan nada; uno manual reciente evita el duplicado", () => {
    const { s, clock, maria } = setup();
    sell(s, maria.id);
    s.orders.updateReminderSettings(admin, { enabled: false });
    clock.t = T0 + 28 * DAY + 4 * 3600_000;
    assert.equal(s.orders.autoReminders(system), 0);
    s.orders.updateReminderSettings(admin, { enabled: true });
    s.orders.queueExpiryReminders(seller, 3); // el vendedor ya mandó uno a mano
    assert.equal(s.orders.autoReminders(system), 0);
    assert.equal(reminders(s).length, 1);
  });
});

describe("11. Avisos para el dueño", () => {
  const staffMsgs = (s) => s.notify.outbox(owner).filter((m) => m.customerId === "staff");

  test("sin WhatsApp del dueño no se encola nada; solo el dueño lo configura y se valida", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(maria), o.id, { fileRef: "up/a.jpg", declaredReference: "DEP-1" });
    assert.equal(staffMsgs(s).length, 0);
    assert.throws(() => s.orders.updateStaffAlerts(admin, { phone: "+591 70000000" }), err("FORBIDDEN"));
    assert.throws(() => s.orders.updateStaffAlerts(seller, { phone: "+591 70000000" }), err("FORBIDDEN"));
    assert.throws(() => s.orders.updateStaffAlerts(owner, { phone: "abc12" }), err("VALIDATION"));
    assert.throws(() => s.orders.updateStaffAlerts(owner, { supplierDaysBefore: 40 }), err("VALIDATION"));
    assert.equal(s.orders.updateStaffAlerts(owner, { phone: "70000000" }).phone, "+59170000000", "8 dígitos = Bolivia");
  });

  test("pago o recarga de un cliente avisa al dueño una vez; lo que carga el staff no", () => {
    const { s, maria, luis, as } = setup();
    s.orders.updateStaffAlerts(owner, { phone: "+591 70000000" });
    const o = s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(maria), o.id, { fileRef: "up/a.jpg", declaredReference: "DEP-1" });
    s.orders.submitEvidence(as(maria), o.id, { fileRef: "up/b.jpg", declaredReference: "DEP-1b" }); // corrige el comprobante
    let m = staffMsgs(s);
    assert.equal(m.length, 1);
    assert.equal(m[0].to, "+59170000000");
    assert.equal(m[0].status, "queued");
    assert.match(m[0].text, /nuevo pago para revisar\. Pedido #\S+ de María Quispe por Bs 35\.00/);
    s.orders.requestTopup(as(luis), luis.id, 5000, { fileRef: "up/t.jpg", declaredReference: "DEP-2" });
    assert.equal(staffMsgs(s).length, 2);
    const p = s.orders.create(seller, { customerId: luis.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(seller, p.id, { fileRef: "up/c.jpg", declaredReference: "DEP-3" });
    s.orders.updateStaffAlerts(owner, { payments: false });
    s.orders.requestTopup(as(luis), luis.id, 5000, { fileRef: "up/t2.jpg", declaredReference: "DEP-4" });
    assert.equal(staffMsgs(s).length, 2, "ni lo del vendedor ni con el aviso apagado");
  });

  test("cuentas por vencer con el proveedor: un solo mensaje, en horario, una vez por vencimiento", () => {
    const { s, clock, acc2: { account: acc2 } } = setup();
    s.orders.updateStaffAlerts(owner, { phone: "+591 70000000", supplierDaysBefore: 2 });
    clock.t = acc2.supplierExpiresAt - 2 * DAY + 60_000; // faltan menos de 2 días, 08:01 en Bolivia
    assert.equal(s.orders.supplierExpiryAlerts(system), 0, "antes de las 9 no sale");
    clock.t += 2 * 60 * MINUTE; // 10:01
    assert.equal(s.orders.supplierExpiryAlerts(system), 1);
    assert.equal(s.orders.supplierExpiryAlerts(system), 0, "no se repite");
    const [m] = staffMsgs(s);
    assert.match(m.text, /1 cuenta\(s\) vencen con el proveedor: Netflix perfil nf02@gabostore\.lat/);
    assert.doesNotMatch(m.text, /Otra-Clave/);
    // El proveedor renovó: nueva fecha → vuelve a avisar cuando corresponda.
    s.inventory.updateAccount(admin, acc2.id, { supplierExpiresAt: clock.t + DAY });
    assert.equal(s.orders.supplierExpiryAlerts(system), 1);
    assert.throws(() => s.orders.supplierExpiryAlerts(seller), err("FORBIDDEN"));
  });
});

describe("12. Revendedor y apariencia", () => {
  test("el revendedor edita solo SUS clientes, sin tocar tipo ni precios", () => {
    const { s, carla, maria, as } = setup();
    const r = as(carla);
    const pedro = s.catalog.createCustomer(r, { name: "Pedro", phone: "+591 71230000" });
    const out = s.portal.updateClient(r, pedro.id, { name: "Pedro Mamani", phone: "+591 71239999", note: "paga los viernes", whatsappConsent: true, kind: "reseller" });
    assert.deepEqual(out, { id: pedro.id, name: "Pedro Mamani", phone: "+59171239999", whatsappConsent: true, note: "paga los viernes" });
    assert.equal(s.snapshot().customers[pedro.id].kind, "customer");
    assert.equal(s.portal.customers(r)[0].note, "paga los viernes");
    assert.throws(() => s.portal.updateClient(r, maria.id, { name: "X" }), err("FORBIDDEN"));
    assert.throws(() => s.portal.updateClient(as(maria), pedro.id, { name: "X" }), err("FORBIDDEN"));
    assert.throws(() => s.portal.updateClient(r, pedro.id, { phone: maria.phone }), err("VALIDATION"));
  });

  test("lista de precios del revendedor: costo, precio de venta y ganancia", () => {
    const { s, carla, maria, as } = setup();
    const r = as(carla);
    s.portal.setPrices(r, { netflix: 3500, gemini: 1500 });
    const list = s.portal.priceList(r);
    const nf = list.find((p) => p.productId === "netflix");
    assert.deepEqual([nf.cost, nf.sell, nf.profit], [2500, 3500, 1000]);
    assert.equal(list.find((p) => p.productId === "gemini").profit, -300);
    assert.ok(!list.some((p) => p.productId === "oculto"), "no muestra productos sin publicar");
    s.portal.setPrices(r, { gemini: null });
    assert.equal(s.portal.priceList(r).find((p) => p.productId === "gemini").sell, null);
    assert.throws(() => s.portal.setPrices(r, { nada: 100 }), err("NOT_FOUND"));
    assert.throws(() => s.portal.setPrices(r, { netflix: -1 }), err("VALIDATION"));
    assert.throws(() => s.portal.setPrices(as(maria), { netflix: 100 }), err("FORBIDDEN"));
  });

  test("apariencia: letra, bordes, textos y redes se validan y normalizan", () => {
    const { s } = setup();
    const st = s.catalog.updateSettings(owner, { fontFamily: "poppins", corners: "square", heroChip: "Hola", heroTicks: "A, B", footerText: "Pie",
      instagram: "@gabo.store", tiktok: "https://www.tiktok.com/@gabostore", facebook: "https://facebook.com/gabostore/", backgroundColor: "#f5f7fb" });
    assert.deepEqual([st.fontFamily, st.corners, st.instagram, st.tiktok, st.facebook, st.backgroundColor], ["poppins", "square", "gabo.store", "gabostore", "gabostore", "#f5f7fb"]);
    assert.throws(() => s.catalog.updateSettings(owner, { fontFamily: "comic" }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateSettings(owner, { corners: "x" }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateSettings(owner, { instagram: "mal usuario!" }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateSettings(owner, { heroTicks: "x".repeat(121) }), err("VALIDATION"));
    assert.throws(() => s.catalog.updateSettings(seller, { corners: "soft" }), err("FORBIDDEN"));
  });
});

describe("13. Página propia del revendedor", () => {
  test("arranca con valores iniciales, se personaliza y valida todo", () => {
    const { s, carla, as } = setup();
    const r = as(carla);
    const d = s.shops.mine(r);
    assert.equal(d.slug, "carla-vargas");
    assert.equal(d.saved, false);
    const out = s.shops.update(r, { title: "Carla Streaming", slug: "carla-tv", whatsapp: "70011223", accentColor: "#00e5ff", accent2Color: "#ff2bd6",
      bgStyle: "aurora", cardStyle: "neon", headingFont: "orbitron", fontFamily: "inter", heroTitle: "Hola", instagram: "@carla.tv", evil: "x" });
    assert.deepEqual([out.slug, out.whatsapp, out.headingFont, out.instagram, out.saved], ["carla-tv", "59170011223", "orbitron", "carla.tv", true]);
    assert.equal("evil" in out, false);
    for (const bad of [{ slug: "a" }, { slug: "Con Espacio" }, { slug: "panel" }, { headingFont: "comic" }, { bgStyle: "x" }, { cardStyle: "x" },
      { accentColor: "rojo" }, { title: "" }, { whatsapp: "12" }, { heroTitle: "x".repeat(41) }, { products: ["nada"] }]) {
      assert.throws(() => s.shops.update(r, bad), (e) => e instanceof DomainError, JSON.stringify(bad));
    }
  });

  test("solo revendedores; la dirección es única", () => {
    const { s, carla, maria, as } = setup();
    assert.throws(() => s.shops.mine(as(maria)), err("FORBIDDEN"));
    assert.throws(() => s.shops.update(owner, { title: "x" }), err("FORBIDDEN"));
    s.shops.update(as(carla), { slug: "mi-tienda" });
    const otro = s.catalog.createCustomer(admin, { name: "Otro Rev", phone: "+591 71110000", kind: "reseller", priceGroupId: "revendedor" });
    assert.throws(() => s.shops.update(as(otro), { slug: "mi-tienda" }), err("VALIDATION"));
  });

  test("la página pública muestra SOLO sus precios de venta, nunca su costo", () => {
    const { s, carla, as } = setup();
    const r = as(carla);
    s.portal.setPrices(r, { netflix: 4000 });
    s.shops.update(r, { slug: "carla-tv", enabled: true });
    const pub = s.shops.public("carla-tv");
    assert.deepEqual(pub.products.map((p) => [p.id, p.price]), [["netflix", 4000]]);
    assert.ok(!JSON.stringify(pub).includes("2500"), "no aparece el precio de revendedor");
    assert.equal(pub.slug, "carla-tv");
    assert.equal("blocked" in pub, false);
    s.portal.setPrices(r, { gemini: 3000 });
    s.shops.update(r, { products: ["gemini"] });
    assert.deepEqual(s.shops.public("carla-tv").products.map((p) => p.id), ["gemini"], "solo los elegidos");
  });

  test("apagada o bloqueada no se ve; el revendedor sí ve su vista previa", () => {
    const { s, carla, maria, as } = setup();
    const r = as(carla);
    s.shops.update(r, { slug: "carla-tv" });
    assert.throws(() => s.shops.public("carla-tv"), err("NOT_FOUND"));
    assert.equal(s.shops.public("carla-tv", r).published, false, "vista previa propia");
    assert.throws(() => s.shops.public("carla-tv", as(maria)), err("NOT_FOUND"));
    s.shops.update(r, { enabled: true });
    assert.equal(s.shops.public("carla-tv").title, "Carla Vargas");
    assert.throws(() => s.shops.setBlocked(seller, carla.id, true), err("FORBIDDEN"));
    s.shops.setBlocked(admin, carla.id, true);
    assert.throws(() => s.shops.public("carla-tv"), err("NOT_FOUND"));
    assert.throws(() => s.shops.public("carla-tv", r), err("NOT_FOUND"), "bloqueada ni en vista previa");
    s.shops.setBlocked(admin, carla.id, false);
    s.catalog.updateSettings(owner, { resellerShops: false });
    assert.throws(() => s.shops.public("carla-tv"), err("NOT_FOUND"));
    assert.throws(() => s.shops.update(r, { enabled: true }), err("FORBIDDEN"));
    assert.equal(s.shops.list(admin).length, 1);
  });

  test("tu tienda también acepta los estilos nuevos", () => {
    const { s } = setup();
    const st = s.catalog.updateSettings(owner, { accent2Color: "#ff2bd6", bgStyle: "grid", cardStyle: "glass", headingFont: "bebas" });
    assert.deepEqual([st.accent2Color, st.bgStyle, st.cardStyle, st.headingFont], ["#ff2bd6", "grid", "glass", "bebas"]);
    assert.throws(() => s.catalog.updateSettings(owner, { cardStyle: "x" }), err("VALIDATION"));
  });
});

describe("14. Página /revendedores", () => {
  test("datos reales: ganancia por producto, páginas publicadas y opción de ocultar precios", () => {
    const { s, carla, as } = setup();
    let pg = s.shops.program();
    assert.equal(pg.showPrices, true);
    assert.deepEqual(pg.products.map((p) => [p.id, p.public, p.reseller]), [["netflix", 3500, 2500], ["gemini", 2500, 1800]]);
    assert.equal(pg.stats.products, 2, "solo publicados");
    assert.equal(pg.shops.length, 0);
    s.shops.update(as(carla), { slug: "carla-tv", enabled: true });
    pg = s.shops.program();
    assert.deepEqual(pg.shops.map((x) => x.slug), ["carla-tv"]);
    assert.ok(!JSON.stringify(pg.shops).includes(carla.phone), "no expone el teléfono del revendedor");
    s.shops.setBlocked(admin, carla.id, true);
    assert.equal(s.shops.program().shops.length, 0, "bloqueada no aparece");
    s.catalog.updateSettings(owner, { resellerProgramPrices: false });
    pg = s.shops.program();
    assert.equal(pg.showPrices, false);
    assert.deepEqual(pg.products, []);
  });
});

describe("15. Opiniones y tiendas destacadas", () => {
  test("opiniones: solo dueño o admin, validadas, salen en /revendedores", () => {
    const { s } = setup();
    assert.deepEqual(s.shops.program().testimonials, [], "sin opiniones inventadas por defecto");
    const out = s.shops.setTestimonials(admin, [{ name: " Rosa M. ", business: "Rosa TV", text: "Vendo el doble.", rating: "5" }, { name: "Luis", text: "Muy rápido" }]);
    assert.deepEqual(out, [{ name: "Rosa M.", business: "Rosa TV", text: "Vendo el doble.", rating: 5 }, { name: "Luis", text: "Muy rápido" }]);
    assert.equal(s.shops.program().testimonials.length, 2);
    assert.throws(() => s.shops.setTestimonials(seller, []), err("FORBIDDEN"));
    for (const bad of [[{ name: "", text: "x" }], [{ name: "a", text: "" }], [{ name: "a", text: "x", rating: 6 }], Array(13).fill({ name: "a", text: "x" }), "nada"]) {
      assert.throws(() => s.shops.setTestimonials(owner, bad), err("VALIDATION"));
    }
  });

  test("destacadas: van primero en el directorio", () => {
    const { s, carla, as } = setup();
    const otro = s.catalog.createCustomer(admin, { name: "Otro Rev", phone: "+591 71110000", kind: "reseller", priceGroupId: "revendedor" });
    s.shops.update(as(carla), { slug: "carla-tv", enabled: true });
    s.shops.update(as(otro), { slug: "otro-tv", enabled: true });
    s.shops.setFeatured(admin, otro.id, true);
    const shops = s.shops.program().shops;
    assert.deepEqual(shops.map((x) => [x.slug, x.featured]), [["otro-tv", true], ["carla-tv", false]]);
    assert.throws(() => s.shops.setFeatured(seller, otro.id, true), err("FORBIDDEN"));
    assert.equal(s.shops.list(admin).find((x) => x.slug === "otro-tv").featured, true);
  });
});

describe("16. Logo de producto", () => {
  test("se guarda, se conserva al editar el producto y se puede quitar; solo staff con permiso", () => {
    const { s } = setup();
    assert.equal(s.catalog.setProductImage(admin, "netflix", "a".repeat(32) + ".png"), undefined);
    s.catalog.upsertProduct(admin, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 4000, published: true, evil: "x" });
    const p = s.snapshot().products.netflix;
    assert.equal(p.imageFileRef, "a".repeat(32) + ".png", "editar no borra el logo");
    assert.equal("evil" in p, false, "no guarda campos desconocidos");
    assert.equal(s.catalog.publicCatalog().find((x) => x.id === "netflix").hasImage, true);
    assert.throws(() => s.catalog.setProductImage(seller, "netflix", null), err("FORBIDDEN"));
    assert.equal(s.catalog.setProductImage(admin, "netflix", null), "a".repeat(32) + ".png");
    assert.equal(s.catalog.publicCatalog().find((x) => x.id === "netflix").hasImage, false);
    assert.throws(() => s.catalog.upsertProduct(admin, { name: "X", kind: "raro", durationDays: 30, price: 100, published: true }), err("VALIDATION"));
  });
});

describe("17. Importar vencidos y clientes sin WhatsApp", () => {
  const base = (k, o = {}) => ({ row: k, customerName: "Rosa", phone: "+59170012345", product: "netflix", email: "imp@x.y", password: "", profile: `Perfil ${k}`, customerExpiresAt: T0 + 10 * DAY, supplierExpiresAt: T0 + 60 * DAY, ...o });

  test("vencido importado no se cierra solo; al ponerle fecha vuelve a la normalidad", () => {
    const { s, clock } = setup();
    const r = s.inventory.importServices(admin, [base(1, { customerExpiresAt: T0 - 40 * DAY })], { dryRun: false });
    assert.equal(r.rows[0].status, "ok");
    assert.ok(r.rows[0].warnings.some((w) => /queda abierto/.test(w)));
    const id = Object.values(s.snapshot().assignments).find((a) => a.holdOpen).id;
    clock.t += 5 * DAY;
    assert.equal(s.orders.closeExpired(system, 2), 0, "no lo cierra");
    assert.throws(() => s.orders.setExpiry({ id: "c", role: "customer", customerId: "x" }, id, T0 + 30 * DAY), err("FORBIDDEN"));
    assert.throws(() => s.orders.setExpiry(seller, id, NaN), err("VALIDATION"));
    const a = s.orders.setExpiry(seller, id, clock.t + 20 * DAY, "pagó por QR");
    assert.equal(a.holdOpen, undefined);
    assert.equal(a.history.at(-1).event, "date_changed");
    clock.t += 23 * DAY;
    assert.equal(s.orders.closeExpired(system, 2), 1, "con fecha nueva, si vence, se cierra como siempre");
  });

  test("cliente sin WhatsApp: se crea, se reutiliza por nombre y no recibe mensajes", () => {
    const { s } = setup();
    const r = s.inventory.importServices(admin, [base(1, { customerName: "Dani strem", phone: "" }), base(2, { customerName: "Dani strem", phone: "" })], { dryRun: false });
    assert.deepEqual(r.rows.map((x) => x.status), ["ok", "ok"]);
    const danis = Object.values(s.snapshot().customers).filter((c) => c.name === "Dani strem");
    assert.equal(danis.length, 1, "un solo cliente para las dos filas");
    assert.equal(danis[0].phone, "");
    assert.throws(() => s.catalog.createCustomer(admin, { name: "Sin num", phone: "" }), err("VALIDATION"), "a mano el teléfono sigue siendo obligatorio");
    s.orders.queueExpiryReminders(seller, 15);
    assert.ok(s.notify.outbox(owner).filter((m) => m.customerId === danis[0].id).every((m) => m.status === "skipped_no_consent"));
    s.catalog.updateCustomer(admin, danis[0].id, { phone: "+591 70099911" });
    assert.equal(s.snapshot().customers[danis[0].id].phone, "+59170099911");
  });
});

describe("18. Varios clientes sin WhatsApp distintos", () => {
  test("se pueden importar varios clientes sin número (no chocan entre sí)", () => {
    const { s } = setup();
    const mk = (k, name) => ({ row: k, customerName: name, phone: "", product: "netflix", email: `sin${k}@x.y`, password: "", profile: "Cuenta completa", customerExpiresAt: T0 + 9 * DAY, supplierExpiresAt: T0 + 60 * DAY });
    const r = s.inventory.importServices(admin, [mk(1, "panama"), mk(2, "ANDROID"), mk(3, "aneliz")], { dryRun: false });
    assert.deepEqual(r.rows.map((x) => x.status), ["ok", "ok", "ok"]);
    assert.equal(Object.values(s.snapshot().customers).filter((c) => !c.phone).length, 3);
  });
});

describe("19. Control de alquileres", () => {
  test("precio, costo, pago, revendedor y nota se guardan; solo staff; validaciones", () => {
    const { s, maria, as } = setup();
    const o = s.orders.create(seller, { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    const c = s.orders.setControl(seller, id, { price: 6900, cost: 2000, payStatus: "pendiente", seller: " ARIT ", note: "paga viernes", startedAt: T0 - 30 * DAY });
    assert.deepEqual(c, { price: 6900, cost: 2000, payStatus: "pendiente", seller: "ARIT", note: "paga viernes", startedAt: T0 - 30 * DAY });
    assert.equal(s.admin.assignments(admin).find((a) => a.id === id).control.price, 6900);
    assert.deepEqual(s.orders.setControl(seller, id, { cost: null, note: "" }), { price: 6900, payStatus: "pendiente", seller: "ARIT", startedAt: T0 - 30 * DAY });
    assert.throws(() => s.orders.setControl(as(maria), id, { price: 1 }), err("FORBIDDEN"));
    assert.throws(() => s.orders.setControl(seller, id, { price: -5 }), err("VALIDATION"));
    assert.throws(() => s.orders.setControl(seller, id, { payStatus: "quizas" }), err("VALIDATION"));
  });

  test("renovar un alquiler 'esperando fecha' lo saca de esa espera", () => {
    const { s } = setup();
    s.inventory.importServices(admin, [{ row: 1, customerName: "Rosa", phone: "+59170012345", product: "netflix", email: "imp@x.y", password: "", profile: "P1", customerExpiresAt: T0 - 5 * DAY, supplierExpiresAt: T0 + 90 * DAY }], { dryRun: false });
    const a = Object.values(s.snapshot().assignments).find((x) => x.holdOpen);
    s.orders.renew(seller, a.id, { paymentMethod: "cash" });
    assert.equal(s.snapshot().assignments[a.id].holdOpen, undefined);
  });
});

describe("20. Alquileres: solo los renueva la tienda", () => {
  test("producto no publicado: el cliente/revendedor no puede renovarlo; el staff sí", () => {
    const { s, carla, as } = setup();
    s.wallet.adjust(owner, carla.id, 10000, "saldo");
    const o = s.orders.create(seller, { customerId: carla.id, items: [{ productId: "oculto", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    const mine = s.portal.services(as(carla)).find((x) => x.assignmentId === id);
    assert.equal(mine.canRenew, false);
    assert.throws(() => s.orders.renew(as(carla), id, { paymentMethod: "balance" }), err("FORBIDDEN"));
    assert.ok(s.orders.renew(seller, id, { paymentMethod: "cash" }).assignment.customerExpiresAt > o.createdAt);
    const pub = s.orders.create(seller, { customerId: carla.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    assert.equal(s.portal.services(as(carla)).find((x) => x.assignmentId === pub.assignmentIds[0]).canRenew, true);
  });
});

describe("21. Productos solo para revendedores + autorenovación con saldo", () => {
  test("el público no lo ve; el revendedor lo ve, lo renueva solo con saldo al precio acordado y se corre la fecha", () => {
    const { s, carla, maria, as } = setup();
    s.catalog.upsertProduct(owner, { id: "dsn", name: "Disney Premium + ESPN", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(owner, { id: "prov2", name: "Prov", active: true });
    s.inventory.addAccount(admin, { productId: "dsn", supplierId: "prov2", email: "d1@x.y", password: "", passwordPending: true, supplierExpiresAt: T0 + 120 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }, { label: "Pack 2" }] });
    assert.ok(!s.catalog.publicCatalog().some((p) => p.id === "dsn"), "la tienda pública no lo muestra");
    assert.ok(!s.catalog.publicCatalog(maria.id).some((p) => p.id === "dsn"), "un cliente común tampoco");
    assert.ok(s.catalog.publicCatalog(carla.id).some((p) => p.id === "dsn"), "el revendedor sí");
    assert.throws(() => s.orders.create(as(maria), { customerId: maria.id, items: [{ productId: "dsn", qty: 1 }], paymentMethod: "qr" }), err("NOT_FOUND"));
    // Alquiler asignado por el dueño, con precio acordado Bs 65
    const o = s.orders.create(seller, { customerId: carla.id, items: [{ productId: "dsn", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    s.orders.setControl(seller, id, { price: 6500 });
    const svc = s.portal.services(as(carla)).find((x) => x.assignmentId === id);
    assert.deepEqual([svc.canRenew, svc.renewPrice], [true, 6500]);
    s.wallet.adjust(owner, carla.id, 10000, "carga");
    const before = s.snapshot().assignments[id].customerExpiresAt;
    const r = s.orders.renew(as(carla), id, { paymentMethod: "balance" });
    assert.equal(r.order.total, 6500, "cobra el precio acordado");
    assert.equal(s.wallet.balance(carla.id), 10000 - 6500);
    assert.equal(r.assignment.customerExpiresAt, before + 30 * DAY, "la fecha se corre sola");
    assert.throws(() => s.orders.renew(as(carla), id, { paymentMethod: "balance" }), err("INSUFFICIENT_BALANCE"));
  });
});

describe("22. Lista de precios de revendedor", () => {
  test("si no existe, se crea sola al crear o cambiar a un revendedor", () => {
    const clock = { t: T0, now() { return this.t; } };
    const s = createStore({ clock, initialState: { priceGroups: { final: { id: "final", name: "Cliente final", prices: {} } } } });
    const r = s.catalog.createCustomer(owner, { name: "Rev Nuevo", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
    assert.equal(r.priceGroupId, "revendedor");
    assert.ok(s.snapshot().priceGroups.revendedor);
    const s2 = createStore({ clock, initialState: { priceGroups: { final: { id: "final", name: "Cliente final", prices: {} } } } });
    const c = s2.catalog.createCustomer(owner, { name: "Cli", phone: "+59171234568" });
    assert.equal(s2.catalog.updateCustomer(owner, c.id, { kind: "reseller", priceGroupId: "revendedor" }).priceGroupId, "revendedor");
  });
});
