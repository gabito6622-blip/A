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
